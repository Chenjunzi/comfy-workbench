import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveFaceParameters, faceParametersBody, isMossModel, mossUpscaleBody, mossOptionsBody } from '../shared/moss.mjs'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { WorkbenchConflictError, WorkbenchStore } from './workbench-store.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.resolve(process.env.COMFY_PRESET_DATA_DIR || path.join(repoRoot, 'data'))
const pinFile = path.join(dataDir, 'share-pin.txt')
const sharedStateFile = process.env.COMFY_PRESET_SHARED_STATE_FILE || path.join(dataDir, 'shared-state.json')
const sqliteFile = process.env.COMFY_PRESET_SQLITE_FILE || path.join(dataDir, 'workbench.sqlite')
const accessKeysFile = process.env.COMFY_PRESET_ACCESS_KEYS_FILE || path.join(dataDir, 'access-keys.txt')
const previewCacheDir = path.resolve(process.env.COMFY_PRESET_PREVIEW_CACHE_DIR || path.join(dataDir, 'preview-cache'))
const comfyOutputDir = path.resolve(
  process.env.COMFY_PRESET_OUTPUT_DIR || path.join(process.env.COMFY_ROOT || path.join(repoRoot, '..', 'ComfyUI'), 'output'),
)
const gatewayTarget = (process.env.COMFY_PRESET_GATEWAY_URL || 'http://127.0.0.1:8765').replace(/\/$/, '')
const allowedHostnames = new Set(
  String(process.env.COMFY_PRESET_ALLOWED_HOSTS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
)
const shareCookieName = 'comfy_share_session'
const legacyCookieName = 'comfy_share_pin'
const lockMs = 10 * 60 * 1000
const sessionTtlMs = 24 * 60 * 60 * 1000
const lockedUntilByClient = new Map()
const failedUnlocks = new Map()
const unlockRequests = new Map()
const sessions = new Map()
const pngPresetKeyword = 'comfy-preset-workflow-ui'
const sourceImageDownloadMaxBytes = 64 * 1024 * 1024
const store = new WorkbenchStore({ dataDir, legacySharedStateFile: sharedStateFile, dbFile: sqliteFile, accessKeysFile, previewCacheDir })
const outputThumbnailJobs = new Map()
const maintenanceTimer = setInterval(() => {
  store.pruneOperationLog()
  void store.createScheduledBackupIfDue().catch((error) => {
    console.error(`[backup] scheduled backup failed: ${error instanceof Error ? error.message : error}`)
  })
}, 15 * 60 * 1000)
maintenanceTimer.unref()

let operationQueue = Promise.resolve()
let generationQueue = Promise.resolve()
let generationQueueDepth = 0

export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Cache-Control': 'no-store',
}

const logSecurity = (event, req, extra = '') => {
  const remote = req?.socket?.remoteAddress || 'unknown'
  console.log(`[security] ${new Date().toISOString()} ${event} remote=${remote}${extra ? ` ${extra}` : ''}`)
}

const enqueueOperation = (work) => {
  const next = operationQueue.then(work, work)
  operationQueue = next.catch(() => {})
  return next
}

const enqueueGeneration = (work) => {
  const next = generationQueue.then(work, work)
  generationQueue = next.catch(() => {})
  return next
}

const parseCookies = (req) =>
  Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf('=')
        if (index === -1) return [item, '']
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))]
      }),
  )

const readBody = (req, maxBytes = 4096) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

export const sendJson = (res, status, payload, headers = {}) => {
  res.writeHead(status, {
    ...securityHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  })
  res.end(JSON.stringify(payload))
}

export const sendText = (res, status, text, headers = {}) => {
  res.writeHead(status, {
    ...securityHeaders,
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers,
  })
  res.end(text)
}

const sendFile = (res, filePath, cache = true) => {
  const ext = path.extname(filePath).toLowerCase()
  const contentType =
    ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : ''
  if (!contentType) {
    sendJson(res, 415, { ok: false, error: 'Unsupported file type' })
    return
  }
  res.writeHead(200, {
    ...securityHeaders,
    'Content-Type': contentType,
    'Cache-Control': cache ? 'private, max-age=86400' : 'no-store',
  })
  fs.createReadStream(filePath).pipe(res)
}

const crcTable = new Uint32Array(256)
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  crcTable[index] = value >>> 0
}

const pngCrc32 = (buffer) => {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const createPngChunk = (type, data) => {
  const typeBuffer = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBuffer.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(pngCrc32(Buffer.concat([typeBuffer, data])), 8 + data.length)
  return chunk
}

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const assertOutputImagePath = (imagePath) => {
  const requestedPath = path.resolve(String(imagePath || ''))
  const relative = path.relative(comfyOutputDir, requestedPath)
  const insideOutput = Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
  if (!insideOutput || !fs.existsSync(requestedPath) || !fs.statSync(requestedPath).isFile()) throw new Error('Image not found')
  if (path.extname(requestedPath).toLowerCase() !== '.png') throw new Error('Only PNG metadata is supported')
  return requestedPath
}

const assertPreviewCacheImageUrl = (imageUrl, { pngOnly = true } = {}) => {
  const parsed = new URL(String(imageUrl || ''), 'http://local')
  if (parsed.pathname === '/preview-cache/import' || parsed.pathname === '/preview-cache/upload-source') {
    throw new Error('Image not found')
  }
  if (!parsed.pathname.startsWith('/preview-cache/')) throw new Error('Image not found')
  const fileName = decodeURIComponent(parsed.pathname.replace(/^\/preview-cache\//, ''))
  const requestedPath = path.resolve(previewCacheDir, fileName)
  const relative = path.relative(previewCacheDir, requestedPath)
  const insideCache = Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
  if (!insideCache || !fs.existsSync(requestedPath) || !fs.statSync(requestedPath).isFile()) throw new Error('Image not found')
  if (pngOnly && path.extname(requestedPath).toLowerCase() !== '.png') throw new Error('Only PNG metadata is supported')
  return requestedPath
}

const resolvePngPresetImagePath = (body) => {
  if (body.imagePath) return assertOutputImagePath(body.imagePath)
  if (body.imageUrl) return assertPreviewCacheImageUrl(body.imageUrl)
  throw new Error('Image not found')
}

const hasPngTextChunk = (filePath, keyword) => {
  const source = fs.readFileSync(filePath)
  if (source.length < 33 || !source.subarray(0, 8).equals(pngSignature)) throw new Error('Invalid PNG file')
  let offset = 8
  while (offset + 12 <= source.length) {
    const length = source.readUInt32BE(offset)
    const type = source.subarray(offset + 4, offset + 8).toString('ascii')
    const chunkEnd = offset + 12 + length
    if (chunkEnd > source.length) throw new Error('Invalid PNG chunk')
    const data = source.subarray(offset + 8, offset + 8 + length)
    if (type === 'tEXt' && data.subarray(0, keyword.length).toString('latin1') === keyword && data[keyword.length] === 0) return true
    offset = chunkEnd
  }
  return false
}

const readPngTextChunk = (filePath, keyword) => {
  const source = fs.readFileSync(filePath)
  if (source.length < 33 || !source.subarray(0, 8).equals(pngSignature)) throw new Error('Invalid PNG file')
  let offset = 8
  while (offset + 12 <= source.length) {
    const length = source.readUInt32BE(offset)
    const type = source.subarray(offset + 4, offset + 8).toString('ascii')
    const chunkEnd = offset + 12 + length
    if (chunkEnd > source.length) throw new Error('Invalid PNG chunk')
    const data = source.subarray(offset + 8, offset + 8 + length)
    if (type === 'tEXt' && data.subarray(0, keyword.length).toString('latin1') === keyword && data[keyword.length] === 0) {
      return data.subarray(keyword.length + 1).toString('utf8')
    }
    offset = chunkEnd
  }
  return ''
}

const upsertPngTextChunk = (filePath, keyword, text) => {
  const source = fs.readFileSync(filePath)
  if (source.length < 33 || !source.subarray(0, 8).equals(pngSignature)) throw new Error('Invalid PNG file')
  const chunks = [source.subarray(0, 8)]
  let offset = 8
  let inserted = false
  while (offset + 12 <= source.length) {
    const length = source.readUInt32BE(offset)
    const type = source.subarray(offset + 4, offset + 8).toString('ascii')
    const chunkEnd = offset + 12 + length
    if (chunkEnd > source.length) throw new Error('Invalid PNG chunk')
    const chunk = source.subarray(offset, chunkEnd)
    const data = source.subarray(offset + 8, offset + 8 + length)
    const isExistingPreset = type === 'tEXt' && data.subarray(0, keyword.length).toString('latin1') === keyword && data[keyword.length] === 0
    if (!isExistingPreset) chunks.push(chunk)
    if (!inserted && type === 'IHDR') {
      chunks.push(createPngChunk('tEXt', Buffer.from(`${keyword}\0${text}`, 'utf8')))
      inserted = true
    }
    offset = chunkEnd
  }
  if (!inserted) throw new Error('PNG missing IHDR chunk')
  fs.writeFileSync(filePath, Buffer.concat(chunks))
}

const getClientKey = (req) => req.socket.remoteAddress || 'unknown'

const getLockSeconds = (clientKey) => {
  const lockedUntil = lockedUntilByClient.get(clientKey) || 0
  const remaining = lockedUntil - Date.now()
  if (remaining <= 0) {
    lockedUntilByClient.delete(clientKey)
    if (lockedUntil) failedUnlocks.delete(clientKey)
    return 0
  }
  return Math.ceil(remaining / 1000)
}

const createSession = (req, actor) => {
  const token = crypto.randomBytes(32).toString('base64url')
  sessions.set(token, {
    expiresAt: Date.now() + sessionTtlMs,
    clientKey: getClientKey(req),
    actor,
  })
  return token
}

const getShareSession = (req) => {
  const token = parseCookies(req)[shareCookieName]
  if (!token) return null
  const session = sessions.get(token)
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token)
    return null
  }
  return session
}

const hasShareSession = (req) => Boolean(getShareSession(req))

const actorFromRequest = (req) => getShareSession(req)?.actor ?? { userId: 'anonymous', userName: 'anonymous' }
const isOwner = (actor) => actor?.role === 'owner'

const requireOwner = (req, res) => {
  const actor = actorFromRequest(req)
  if (isOwner(actor)) return actor
  sendJson(res, 403, { ok: false, error: 'Owner access required' })
  return null
}

const ownerIdForRequest = (req, requestedOwnerId = '') => {
  const actor = actorFromRequest(req)
  return isOwner(actor) && requestedOwnerId ? String(requestedOwnerId) : actor.workspaceOwnerId || actor.userId || 'default'
}

const sessionCookie = (token) => [
  `${shareCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(sessionTtlMs / 1000)}`,
  `${legacyCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
]

const stripHostPort = (hostHeader = '') => {
  const host = String(hostHeader).trim().toLowerCase().replace(/\.$/, '')
  if (!host) return ''
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? '' : host.slice(1, end)
  }
  if (host.includes(':')) {
    const parts = host.split(':')
    if (parts.length === 2 && /^\d+$/.test(parts[1])) return parts[0]
    return host
  }
  return host
}

const normalizeHostPort = (hostHeader = '') => String(hostHeader).trim().toLowerCase().replace(/\.$/, '')

const isAllowedHostHeader = (hostHeader) => {
  const hostname = stripHostPort(hostHeader)
  if (!hostname) return false
  if (allowedHostnames.has(hostname) || allowedHostnames.has(normalizeHostPort(hostHeader))) return true
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true
  return net.isIP(hostname) !== 0
}

const isSameOriginHeader = (value, hostHeader) => {
  if (!value) return true
  try {
    const url = new URL(String(value))
    return normalizeHostPort(url.host) === normalizeHostPort(hostHeader)
  } catch {
    return false
  }
}

const isAllowedRequestOrigin = (req) =>
  isSameOriginHeader(req.headers.origin, req.headers.host) && isSameOriginHeader(req.headers.referer, req.headers.host)

const readSharedState = () => store.readSharedContent()

const makePreviewCacheUrl = (fileName) => `/preview-cache/${encodeURIComponent(fileName)}`

const asStringArray = (value) => (Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [])
const joinPrompt = (parts) => parts.filter(Boolean).join(', ')
const isKrea2Model = (value) => /krea[ _-]?2|dasiwa_k2/i.test(String(value || ''))

const promptPrefixForGateway = (value, hasPrompt) => {
  const prefix = String(value || '').trim()
  if (!prefix || !hasPrompt) return prefix
  return /[,，]\s*$/.test(prefix) ? `${prefix} ` : `${prefix}, `
}

const formatDatePart = (date, format) =>
  String(format || '')
    .replaceAll('yyyy', String(date.getFullYear()))
    .replaceAll('MM', String(date.getMonth() + 1).padStart(2, '0'))
    .replaceAll('dd', String(date.getDate()).padStart(2, '0'))
    .replaceAll('hh', String(date.getHours()).padStart(2, '0'))
    .replaceAll('mm', String(date.getMinutes()).padStart(2, '0'))
    .replaceAll('ss', String(date.getSeconds()).padStart(2, '0'))

const applyFilenameTemplate = (template, characterName) => {
  const safeCharacter = String(characterName || '未指定角色')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\p{Cc}/gu, '_')
    .slice(0, 80)
  return String(template || 'Preset/%character%/%date:yyyyMMddhhmmss%')
    .replaceAll('%character%', safeCharacter)
    .replace(/%date:([^%]+)%/g, (_, format) => formatDatePart(new Date(), format))
}

const composeCurrentWorkbench = (workspaceOwnerId) => {
  const uiState = store.readUiState(workspaceOwnerId)
  const draft = uiState.generationDraft
  if (!draft) throw Object.assign(new Error('The current workbench has not published its generation parameters yet'), { statusCode: 409 })
  const shared = store.readSharedContent()
  const blockById = new Map(shared.blocks.map((block) => [block.id, block]))
  const selectedBlockIds = asStringArray(uiState.selectedBlockIds)
  const selectedBlocks = selectedBlockIds.map((id) => blockById.get(id)).filter(Boolean)
  const missingBlockIds = selectedBlockIds.filter((id) => !blockById.has(id))
  const selectedColorPrompts = asStringArray(uiState.selectedColorPrompts)
  const customPositivePrompt = String(draft.customPositivePrompt || '')
  const prompt = joinPrompt([...selectedColorPrompts, ...selectedBlocks.flatMap((block) => asStringArray(block.positive)), customPositivePrompt.trim()])
  const negative = joinPrompt([draft.negativePrefix, ...selectedBlocks.flatMap((block) => asStringArray(block.negative))])
  const loras = selectedBlocks.flatMap((block) => (Array.isArray(block.loras) ? block.loras : []))
  const characterName = selectedBlocks.filter((block) => block.categoryId === 'character').map((block) => block.name).join('+') || '未指定角色'
  const generationPreset = {
    id: `current_workbench_${Date.now().toString(36)}`,
    name: `${characterName} ${draft.width}x${draft.height}`,
    createdAt: new Date().toISOString(),
    selectedBlockIds,
    selectedColorPrompts,
    customPositivePrompt,
    gatewayUrl: '/gateway',
    positivePrefix: draft.positivePrefix,
    negativePrefix: draft.negativePrefix,
    model: draft.model,
    preset: draft.preset,
    filenamePrefix: draft.filenamePrefix,
    width: draft.width,
    height: draft.height,
    steps: draft.steps,
    cfg: draft.cfg,
    seed: draft.seed,
    sampler: draft.sampler,
    scheduler: draft.scheduler,
    upscaleSteps: draft.upscaleSteps.map((step) => ({ ...step })),
    mossUpscale: draft.mossUpscale,
    mossOptions: draft.mossOptions,
    faceDetail: draft.faceDetail,
    faceParameters: resolveFaceParameters(draft.model, shared.baseModelProfiles, draft.faceParameters),
  }
  const requestBody = {
    prompt,
    prefix: promptPrefixForGateway(draft.positivePrefix, Boolean(prompt)),
    negative,
    preset: draft.preset,
    model: draft.model,
    filename_prefix: applyFilenameTemplate(draft.filenamePrefix, characterName),
    width: draft.width,
    height: draft.height,
    steps: draft.steps,
    cfg: draft.cfg,
    sampler_name: draft.sampler,
    scheduler: draft.scheduler,
    loras,
  }
  if (String(draft.seed || '').trim()) {
    const seed = Number(draft.seed)
    if (!Number.isFinite(seed)) throw Object.assign(new Error('The current workbench seed is invalid'), { statusCode: 409 })
    requestBody.seed = seed
    if (isKrea2Model(draft.model)) requestBody.second_seed = seed
  }
  const enabledUpscales = isMossModel(draft.model) ? [] : draft.upscaleSteps.filter((step) => step.enabled)
  requestBody.face_detail = draft.faceDetail === true
  Object.assign(requestBody, faceParametersBody(draft.faceDetail, generationPreset.faceParameters))
  if (isMossModel(draft.model)) Object.assign(requestBody, mossUpscaleBody(draft.mossUpscale), mossOptionsBody(draft))
  if (isKrea2Model(draft.model) && enabledUpscales.length === 0) {
    throw Object.assign(new Error('K2 requires one latent hires upscale stage'), { statusCode: 409 })
  }
  if (isKrea2Model(draft.model) && enabledUpscales.length > 2) {
    throw Object.assign(new Error('K2 supports at most latent hires and USD upscale stages'), { statusCode: 409 })
  }
  if (enabledUpscales.length >= 1) {
    requestBody.second_steps = enabledUpscales[0].steps
    requestBody.second_cfg = enabledUpscales[0].cfg
    requestBody.second_denoise = enabledUpscales[0].denoise
    requestBody.second_sampler_name = enabledUpscales[0].sampler || draft.sampler
    requestBody.second_scheduler = enabledUpscales[0].scheduler || draft.scheduler
  }
  if (enabledUpscales.length === 1) {
    requestBody.upscale_scale = enabledUpscales[0].scale
    if (isKrea2Model(draft.model)) {
      requestBody.upscale_mode = 'krea2_hires'
      requestBody.upscale_stages = 1
    }
  }
  if (enabledUpscales.length > 1) {
    requestBody.upscale_mode = 'two_stage'
    if (isKrea2Model(draft.model)) {
      requestBody.upscale_stages = 2
      requestBody.upscale_scale = enabledUpscales[0].scale
      requestBody.second_stage_upscale_model = 'OmniSR_X4_DIV2K.safetensors'
      if (requestBody.seed !== undefined) requestBody.third_seed = Number(requestBody.seed) + 1
    } else {
      requestBody.stage_upscale_scale = enabledUpscales[0].scale
    }
    requestBody.second_stage_upscale_scale = enabledUpscales[1].scale
    requestBody.third_steps = enabledUpscales[1].steps
    requestBody.third_cfg = enabledUpscales[1].cfg
    requestBody.third_denoise = enabledUpscales[1].denoise
    requestBody.third_sampler_name = enabledUpscales[1].sampler || draft.sampler
    requestBody.third_scheduler = enabledUpscales[1].scheduler || draft.scheduler
  }
  Object.keys(requestBody).forEach((key) => (requestBody[key] === undefined || requestBody[key] === '') && delete requestBody[key])
  const composed = { positive: joinPrompt([draft.positivePrefix, prompt]), negative, loras }
  const pngMetadata = {
    app: 'comfy-preset-workflow-ui',
    version: 1,
    createdAt: new Date().toISOString(),
    generationPreset,
    selectedBlocks: selectedBlocks.map((block) => ({
      id: block.id,
      categoryId: block.categoryId,
      name: block.name,
      positive: asStringArray(block.positive),
      negative: asStringArray(block.negative),
      loras: Array.isArray(block.loras) ? block.loras : [],
    })),
    composed,
    requestBody,
  }
  return {
    workspaceOwnerId,
    revision: uiState.revision,
    updatedAt: uiState.updatedAt,
    selectedBlockIds,
    selectedColorPrompts,
    customPositivePrompt,
    selectedBlocks,
    missingBlockIds,
    generationDraft: draft,
    composed,
    requestBody,
    pngMetadata,
  }
}

const sourceImageMimeFromMagic = (filePath) => {
  const header = Buffer.alloc(12)
  const handle = fs.openSync(filePath, 'r')
  let bytesRead = 0
  try {
    bytesRead = fs.readSync(handle, header, 0, header.length, 0)
  } finally {
    fs.closeSync(handle)
  }
  const value = header.subarray(0, bytesRead)
  if (value.length >= 8 && value.subarray(0, 8).equals(pngSignature)) return { mimeType: 'image/png', extension: 'png' }
  if (value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) return { mimeType: 'image/jpeg', extension: 'jpg' }
  if (value.length >= 12 && value.subarray(0, 4).toString('ascii') === 'RIFF' && value.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp' }
  }
  throw Object.assign(new Error('Source resource is not a supported image'), { statusCode: 415 })
}

const resolveControlledImagePath = (imagePath) => {
  const requestedPath = path.resolve(String(imagePath || ''))
  if (!fs.existsSync(requestedPath) || !fs.statSync(requestedPath).isFile()) {
    throw Object.assign(new Error('Source image not found'), { statusCode: 404 })
  }
  const realPath = fs.realpathSync(requestedPath)
  for (const root of [previewCacheDir, comfyOutputDir]) {
    if (!fs.existsSync(root)) continue
    const realRoot = fs.realpathSync(root)
    const relative = path.relative(realRoot, realPath)
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return { filePath: realPath, root: realRoot }
  }
  throw Object.assign(new Error('Source image is outside controlled resource directories'), { statusCode: 403 })
}

const resolvePreviewSourceUrl = (imageUrl) => {
  const value = String(imageUrl || '').trim()
  if (!value.startsWith('/preview-cache/')) throw Object.assign(new Error('Invalid source resource URL'), { statusCode: 400 })
  try {
    const filePath = assertPreviewCacheImageUrl(value, { pngOnly: false })
    return { ...resolveControlledImagePath(filePath), sourceResourceUrl: makePreviewCacheUrl(path.basename(filePath)) }
  } catch (error) {
    if (error?.statusCode) throw error
    throw Object.assign(new Error('Source image not found'), { statusCode: 404 })
  }
}

const resolveBlockSourceImage = ({ blockId, variantId = '', baseModel = '' }) => {
  const cleanBlockId = String(blockId || '').trim()
  if (!cleanBlockId) throw Object.assign(new Error('blockId is required'), { statusCode: 400 })
  const block = store.readBlock(cleanBlockId)
  if (!block) throw Object.assign(new Error(`Preset block not found: ${cleanBlockId}`), { statusCode: 404 })

  const cleanVariantId = String(variantId || '').trim()
  const cleanBaseModel = String(baseModel || '').trim()
  if (cleanBaseModel && !['none', 'illustrious', 'anima', 'krea2', 'moss'].includes(cleanBaseModel)) {
    throw Object.assign(new Error(`Unsupported preview base model: ${cleanBaseModel}`), { statusCode: 400 })
  }
  const variants = Array.isArray(block.previewVariants)
    ? block.previewVariants.filter((variant) => variant && (variant.sourceImageUrl || variant.sourceImagePath))
    : []
  let variant
  if (cleanVariantId) {
    variant = variants.find((item) => item.id === cleanVariantId)
    if (!variant) throw Object.assign(new Error(`Source preview variant not found: ${cleanVariantId}`), { statusCode: 404 })
    if (cleanBaseModel && String(variant.baseModel || 'none') !== cleanBaseModel) {
      throw Object.assign(new Error('Preview variant does not match the requested base model'), { statusCode: 400 })
    }
  } else if (cleanBaseModel) {
    const candidates = variants.filter((item) => String(item.baseModel || 'none') === cleanBaseModel)
    const activeId = String(block.activePreviewVariantIds?.[cleanBaseModel] || '')
    variant = candidates.find((item) => item.id === activeId) || candidates[0]
    if (!variant && !(cleanBaseModel === 'none' && (block.previewSourceImageUrl || block.previewSourceImagePath))) {
      throw Object.assign(new Error(`No source image is stored for base model: ${cleanBaseModel}`), { statusCode: 404 })
    }
  } else {
    const activeIds = Object.values(block.activePreviewVariantIds || {}).map(String)
    variant = variants.find((item) => activeIds.includes(String(item.id))) || variants.find((item) => String(item.baseModel || 'none') === 'none') || variants[0]
  }

  const imageUrl = String(variant?.sourceImageUrl || (!variant ? block.previewSourceImageUrl : '') || '').trim()
  const imagePath = String(variant?.sourceImagePath || (!variant ? block.previewSourceImagePath : '') || '').trim()
  let resource
  if (imageUrl) resource = resolvePreviewSourceUrl(imageUrl)
  else if (imagePath) {
    resource = resolveControlledImagePath(imagePath)
    if (resource.root === fs.realpathSync(previewCacheDir)) resource.sourceResourceUrl = makePreviewCacheUrl(path.basename(resource.filePath))
  } else {
    throw Object.assign(new Error('No original source image is stored on the block'), { statusCode: 404 })
  }

  const fileStat = fs.statSync(resource.filePath)
  if (fileStat.size <= 0) throw Object.assign(new Error('Source image is empty'), { statusCode: 415 })
  if (fileStat.size > sourceImageDownloadMaxBytes) throw Object.assign(new Error('Source image exceeds the 64 MiB download limit'), { statusCode: 413 })
  const imageType = sourceImageMimeFromMagic(resource.filePath)
  return {
    block,
    variant,
    baseModel: String(variant?.baseModel || cleanBaseModel || 'none'),
    filePath: resource.filePath,
    fileStat,
    sourceResourceUrl: resource.sourceResourceUrl,
    ...imageType,
  }
}

const sendBlockSourceImage = (req, res, source) => {
  const requestUrl = new URL(req.url || '/', 'http://local')
  const sourceResourceUrl = source.sourceResourceUrl || `${requestUrl.pathname}${requestUrl.search}`
  const filename = `${safeResourceStem(source.block.name || source.block.id)}.${source.extension}`
  res.writeHead(200, {
    ...securityHeaders,
    'Content-Type': source.mimeType,
    'Content-Length': source.fileStat.size,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
    'X-Comfy-Block-Id': encodeURIComponent(source.block.id),
    'X-Comfy-Block-Name': encodeURIComponent(source.block.name || source.block.id),
    'X-Comfy-Preview-Variant-Id': encodeURIComponent(source.variant?.id || ''),
    'X-Comfy-Preview-Base-Model': encodeURIComponent(source.baseModel),
    'X-Comfy-Source-Resource-Url': encodeURIComponent(sourceResourceUrl),
  })
  fs.createReadStream(source.filePath).pipe(res)
}

const ensureOutputThumbnail = async (sourcePath) => {
  const stat = fs.statSync(sourcePath)
  const cacheKey = crypto
    .createHash('sha256')
    .update(`${sourcePath}\0${stat.size}\0${stat.mtimeMs}`)
    .digest('hex')
  const fileName = `album-thumb-${cacheKey.slice(0, 32)}.webp`
  const filePath = path.join(previewCacheDir, fileName)
  if (fs.existsSync(filePath)) return filePath
  if (outputThumbnailJobs.has(filePath)) return outputThumbnailJobs.get(filePath)

  const job = (async () => {
    fs.mkdirSync(previewCacheDir, { recursive: true })
    const buffer = await sharp(sourcePath)
      .rotate()
      .resize({ width: 320, height: 320, fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 70, effort: 4 })
      .toBuffer()
    fs.writeFileSync(filePath, buffer)
    const albumThumbnails = fs
      .readdirSync(previewCacheDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith('album-thumb-'))
      .map((entry) => ({ path: path.join(previewCacheDir, entry.name), mtimeMs: fs.statSync(path.join(previewCacheDir, entry.name)).mtimeMs }))
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
    for (const stale of albumThumbnails.slice(120)) fs.rmSync(stale.path, { force: true })
    return filePath
  })()
  outputThumbnailJobs.set(filePath, job)
  try {
    return await job
  } finally {
    outputThumbnailJobs.delete(filePath)
  }
}

const isBlockedIPv4 = (address) => {
  const parts = address.split('.').map((item) => Number(item))
  if (parts.length !== 4 || parts.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return true
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 168 ||
    a === 100 && b >= 64 && b <= 127 ||
    a >= 224
  )
}

const isBlockedIPv6 = (address) => {
  const normalized = address.toLowerCase()
  if (normalized === '::1' || normalized === '::') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) return true
  if (normalized.startsWith('::ffff:')) return isBlockedIPv4(normalized.replace('::ffff:', ''))
  return false
}

const assertPublicPreviewUrl = async (sourceUrl) => {
  const url = new URL(sourceUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) preview URLs are supported')
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw new Error('Preview URL host is not allowed')
  const literalIp = net.isIP(hostname)
  if (literalIp === 4 && isBlockedIPv4(hostname)) throw new Error('Preview URL address is not allowed')
  if (literalIp === 6 && isBlockedIPv6(hostname)) throw new Error('Preview URL address is not allowed')
  const records = await dns.lookup(hostname, { all: true })
  if (records.length === 0) throw new Error('Preview URL host did not resolve')
  for (const record of records) {
    if (record.family === 4 && isBlockedIPv4(record.address)) throw new Error('Preview URL resolved to a blocked address')
    if (record.family === 6 && isBlockedIPv6(record.address)) throw new Error('Preview URL resolved to a blocked address')
  }
  return url
}

const downloadPreviewBuffer = async (sourceUrl) => {
  let currentUrl = String(sourceUrl)
  for (let redirect = 0; redirect < 5; redirect += 1) {
    const safeUrl = await assertPublicPreviewUrl(currentUrl)
    const response = await fetch(safeUrl, {
      redirect: 'manual',
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
        'User-Agent': 'comfy-preset-workflow-ui/1.0',
      },
    })
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      currentUrl = new URL(response.headers.get('location'), safeUrl).toString()
      continue
    }
    if (!response.ok) throw new Error(`Preview download failed: ${response.status}`)
    const contentType = response.headers.get('content-type') || ''
    if (contentType && !contentType.startsWith('image/')) throw new Error('Preview URL did not return an image')
    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > 24 * 1024 * 1024) throw new Error('Preview image is too large')
    return Buffer.from(arrayBuffer)
  }
  throw new Error('Preview URL redirected too many times')
}

const cachePreviewBuffer = async (sourceBuffer, cacheKey) => {
  const fileName = `${cacheKey}.webp`
  const filePath = path.join(previewCacheDir, fileName)
  if (fs.existsSync(filePath)) return makePreviewCacheUrl(fileName)

  fs.mkdirSync(previewCacheDir, { recursive: true })
  const buffer = await sharp(sourceBuffer)
    .rotate()
    .resize({ width: 384, height: 384, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72, effort: 4 })
    .toBuffer()
  fs.writeFileSync(filePath, buffer)
  return makePreviewCacheUrl(fileName)
}

const cacheGatewayLoraPreview = async (sourcePath) => {
  const parsed = new URL(String(sourcePath || ''), 'http://local')
  const queryKeys = [...parsed.searchParams.keys()]
  const name = String(parsed.searchParams.get('name') || '').trim()
  if (parsed.origin !== 'http://local' || parsed.pathname !== '/gateway/lora-preview' || !name || queryKeys.some((key) => key !== 'name')) {
    throw new Error('Invalid Gateway LoRA preview path')
  }
  const response = await fetch(`${gatewayTarget}/lora-preview?name=${encodeURIComponent(name)}`, {
    redirect: 'manual',
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' },
  })
  if (response.status >= 300 && response.status < 400) throw new Error('Gateway LoRA preview redirected unexpectedly')
  if (!response.ok) throw new Error(`Gateway LoRA preview failed: ${response.status}`)
  const contentType = response.headers.get('content-type') || ''
  if (contentType && !contentType.startsWith('image/')) throw new Error('Gateway LoRA preview did not return an image')
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > 24 * 1024 * 1024) throw new Error('Preview image is too large')
  const sourceBuffer = Buffer.from(await response.arrayBuffer())
  if (sourceBuffer.length > 24 * 1024 * 1024) throw new Error('Preview image is too large')
  const cacheKey = crypto.createHash('sha256').update(sourceBuffer).digest('hex')
  return cachePreviewBuffer(sourceBuffer, cacheKey)
}

const cacheRemotePreview = async (sourceUrl) => {
  const source = String(sourceUrl || '').trim()
  if (source.startsWith('/gateway/lora-preview?')) return cacheGatewayLoraPreview(source)
  const safeUrl = await assertPublicPreviewUrl(source)
  const cacheKey = crypto.createHash('sha256').update(safeUrl.toString()).digest('hex')
  const fileName = `${cacheKey}.webp`
  const filePath = path.join(previewCacheDir, fileName)
  if (fs.existsSync(filePath)) return makePreviewCacheUrl(fileName)
  const sourceBuffer = await downloadPreviewBuffer(safeUrl.toString())
  return cachePreviewBuffer(sourceBuffer, cacheKey)
}

const imageExtensionFromMime = (mimeType) => {
  const normalized = String(mimeType || '').toLowerCase()
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg'
  if (normalized === 'image/webp') return 'webp'
  throw new Error('Unsupported image type')
}

const mimeFromSharpFormat = (format) => {
  if (format === 'png') return 'image/png'
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'webp') return 'image/webp'
  throw new Error('Unsupported image type')
}

const safeResourceStem = (fileName) =>
  path
    .basename(String(fileName || ''), path.extname(String(fileName || '')))
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'uploaded-image'

const cacheImageResourceBuffer = async (buffer, { fileName = '', declaredMimeType = '', maxBytes = 32 * 1024 * 1024 } = {}) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Invalid image data')
  if (buffer.length > maxBytes) throw new Error('Image is too large')

  const metadata = await sharp(buffer, { animated: false }).metadata()
  const mimeType = mimeFromSharpFormat(metadata.format)
  if (declaredMimeType && imageExtensionFromMime(declaredMimeType) !== imageExtensionFromMime(mimeType)) {
    throw new Error('Image content does not match its declared type')
  }
  const width = Number(metadata.width || 0)
  const height = Number(metadata.height || 0)
  if (!width || !height) throw new Error('Image dimensions are unavailable')

  const extension = imageExtensionFromMime(mimeType)
  const hash = crypto.createHash('sha256').update(buffer).digest('hex')
  const sourceFileName = `source-${safeResourceStem(fileName)}-${hash.slice(0, 16)}.${extension}`
  const thumbnailFileName = `resource-thumb-${hash.slice(0, 24)}.webp`
  const sourcePath = path.join(previewCacheDir, sourceFileName)
  const thumbnailPath = path.join(previewCacheDir, thumbnailFileName)
  fs.mkdirSync(previewCacheDir, { recursive: true })
  if (!fs.existsSync(sourcePath)) fs.writeFileSync(sourcePath, buffer)
  if (!fs.existsSync(thumbnailPath)) {
    await sharp(buffer)
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 76, effort: 4 })
      .toFile(thumbnailPath)
  }

  return {
    id: `image_${hash}`,
    sourceImageUrl: makePreviewCacheUrl(sourceFileName),
    previewImage: makePreviewCacheUrl(thumbnailFileName),
    thumbnailUrl: makePreviewCacheUrl(thumbnailFileName),
    mimeType,
    size: buffer.length,
    width,
    height,
    previewFit: height / Math.max(1, width) >= 1.15 ? 'background' : 'crop',
    hasPreset: extension === 'png' ? hasPngTextChunk(sourcePath, pngPresetKeyword) : false,
  }
}

const cacheImageResourceFile = async (filePath) => {
  const requestedPath = path.resolve(filePath)
  const stat = fs.statSync(requestedPath)
  if (!stat.isFile()) throw new Error('Image not found')
  if (stat.size > 64 * 1024 * 1024) throw new Error('Image is too large')
  return cacheImageResourceBuffer(fs.readFileSync(requestedPath), {
    fileName: path.basename(requestedPath),
    maxBytes: 64 * 1024 * 1024,
  })
}

const cacheUploadedPreviewSource = async (dataUrl, fileName = '') => {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(String(dataUrl || ''))
  if (!match) throw new Error('Invalid image data')
  const mimeType = match[1].toLowerCase()
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
  return cacheImageResourceBuffer(buffer, { fileName, declaredMimeType: mimeType })
}

const protectedPrefixes = ['/gateway', '/share-state', '/workbench', '/local-image', '/preview-cache', '/png-preset']
const allowedGatewayRoutes = new Map([
  ['/gateway/health', new Set(['GET'])],
  ['/gateway/models', new Set(['GET'])],
  ['/gateway/loras', new Set(['GET'])],
  ['/gateway/lora-info', new Set(['GET'])],
  ['/gateway/lora-preview', new Set(['GET'])],
  ['/gateway/txt2img', new Set(['POST'])],
  ['/gateway/interrupt', new Set(['POST'])],
])
const blockedDevPrefixes = ['/src/', '/@vite/', '/@react-refresh', '/@fs/', '/data/', '/server/', '/.git/']
const blockedDevFiles = new Set([
  '/vite.config.ts',
  '/package.json',
  '/tsconfig.json',
  '/tsconfig.app.json',
  '/tsconfig.node.json',
  '/.env',
  '/.env.local',
  '/robots.txt',
])

const requestPath = (req) => {
  try {
    const rawPathname = new URL(req.url || '/', 'http://local').pathname
    let pathname = rawPathname
    for (let index = 0; index < 3; index += 1) {
      const decoded = decodeURIComponent(pathname)
      if (decoded === pathname) break
      pathname = decoded
    }
    pathname = pathname.replace(/\\/g, '/')
    if (!pathname.startsWith('/')) pathname = `/${pathname}`
    return path.posix.normalize(pathname)
  } catch {
    return '/__invalid_request_path__'
  }
}

const isBlockedDevAsset = (pathname) => blockedDevFiles.has(pathname) || blockedDevPrefixes.some((prefix) => pathname.startsWith(prefix))

const hasFileExtension = (pathname) => /\.[A-Za-z0-9][A-Za-z0-9_-]*$/.test(path.posix.basename(pathname))

const isDotPath = (pathname) => pathname === '/.' || pathname.startsWith('/.') || pathname.includes('/.')

const canFallbackToSpa = (pathname) => {
  if (pathname === '/' || pathname === '/index.html') return true
  if (isBlockedDevAsset(pathname) || isDotPath(pathname) || hasFileExtension(pathname)) return false
  if (pathname.startsWith('/assets/')) return false
  return true
}

const proxyGateway = async (req, res, pathname) => {
  const targetUrl = new URL(`${pathname.replace(/^\/gateway/, '')}${new URL(req.url || '/', 'http://local').search}`, gatewayTarget)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || ['host', 'connection', 'content-length', 'cookie', 'origin', 'referer'].includes(key.toLowerCase())) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.from(await readBody(req, 64 * 1024 * 1024))
  const response = await fetch(targetUrl, { method: req.method, headers, body })
  const responseHeaders = {}
  for (const [key, value] of response.headers.entries()) {
    if (!['connection', 'keep-alive', 'transfer-encoding'].includes(key.toLowerCase())) responseHeaders[key] = value
  }
  res.writeHead(response.status, responseHeaders)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  res.end(buffer)
}

const executeWorkbenchGeneration = async ({ req, actor, requestBody, pngMetadata, includeResource, recordHistory, manageGenerationState, source }) => {
  const startedAt = Date.now()
  if (manageGenerationState) {
    await enqueueOperation(() =>
      store.setGenerationState(
        {
          active: true,
          phase: requestBody.dry_run ? 'dry_run' : 'generating',
          owner: actor.userId,
          actorName: actor.userName,
          source,
          prompt: requestBody.prompt,
          model: requestBody.model,
          width: requestBody.width,
          height: requestBody.height,
          queueLength: generationQueueDepth,
        },
        actor,
      ),
    )
  }
  try {
    const gatewayResponse = await fetch(`${gatewayTarget}/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(requestBody),
    })
    const responseText = await gatewayResponse.text()
    let gatewayData
    try {
      gatewayData = JSON.parse(responseText || '{}')
    } catch {
      return { status: 502, payload: { ok: false, error: 'Gateway returned invalid JSON' } }
    }
    if (!gatewayResponse.ok) return { status: gatewayResponse.status, payload: gatewayData }

    let pngPresetWritten = false
    let pngPresetError = ''
    let resource
    let historyItem
    const imagePath = gatewayData.image_path ?? gatewayData.images?.[0]?.path ?? gatewayData.images?.[0]?.image_path ?? ''
    if (!requestBody.dry_run && imagePath) {
      try {
        const outputPath = assertOutputImagePath(imagePath)
        if (pngMetadata) {
          upsertPngTextChunk(outputPath, pngPresetKeyword, JSON.stringify(pngMetadata))
          pngPresetWritten = true
          logSecurity('png_preset_write', req, 'source=workbench_generate')
        }
        if (includeResource) resource = await cacheImageResourceFile(outputPath)
      } catch (error) {
        pngPresetError = error instanceof Error ? error.message : 'Generated image resource failed'
      }
    }
    if (recordHistory && imagePath && !requestBody.dry_run) {
      historyItem = await enqueueOperation(() =>
        store.addGenerationHistory(
          {
            id: `history_${crypto.randomUUID()}`,
            createdAt: new Date(startedAt).toISOString(),
            prompt: requestBody.prompt || '',
            negative: requestBody.negative || '',
            width: Number(requestBody.width || resource?.width || 0),
            height: Number(requestBody.height || resource?.height || 0),
            outputWidth: Number(resource?.width || requestBody.width || 0),
            outputHeight: Number(resource?.height || requestBody.height || 0),
            model: requestBody.model || '',
            imagePath,
            imageUrl: gatewayData.image_url ?? gatewayData.images?.[0]?.url ?? resource?.sourceImageUrl ?? '',
            durationMs: Date.now() - startedAt,
            submittedBy: actor.userName,
            source,
            mossOptions: pngMetadata?.generationPreset?.mossOptions,
            faceDetailResult: gatewayData.face_detail_result,
            faceDetail: requestBody.face_detail === true,
          },
          actor,
        ),
      )
    }
    return {
      status: 200,
      payload: {
        ...gatewayData,
        png_preset_written: pngPresetWritten,
        ...(resource ? { resource } : {}),
        ...(historyItem ? { historyItem } : {}),
        ...(pngPresetError ? { png_preset_error: pngPresetError } : {}),
      },
    }
  } finally {
    if (manageGenerationState) {
      await enqueueOperation(() =>
        store.setGenerationState(
          generationQueueDepth > 0
            ? { active: true, phase: 'queued', queueLength: generationQueueDepth, source: 'agent' }
            : { active: false, phase: 'idle', owner: actor.userId, actorName: actor.userName, source, queueLength: 0 },
          actor,
        ),
      )
    }
  }
}

const runManagedWorkbenchGeneration = async (options) => {
  generationQueueDepth += 1
  const current = store.readGenerationState()
  await enqueueOperation(() =>
    store.setGenerationState(
      current.active
        ? { ...current, queueLength: generationQueueDepth }
        : {
            active: true,
            phase: 'queued',
            owner: options.actor.userId,
            actorName: options.actor.userName,
            source: options.source,
            prompt: options.requestBody.prompt,
            model: options.requestBody.model,
            width: options.requestBody.width,
            height: options.requestBody.height,
            queueLength: generationQueueDepth,
          },
      options.actor,
    ),
  )
  return enqueueGeneration(async () => {
    generationQueueDepth = Math.max(0, generationQueueDepth - 1)
    return executeWorkbenchGeneration({ ...options, manageGenerationState: true })
  })
}

export const createComfyMiddleware = () => async (req, res, next = () => {}) => {
  const pathname = requestPath(req)
  if (isBlockedDevAsset(pathname)) {
    sendJson(res, 404, { ok: false, error: 'Not found' })
    return
  }
  const isSensitivePath = protectedPrefixes.some((prefix) => pathname.startsWith(prefix)) || pathname.startsWith('/share-auth')
  if (isSensitivePath && !isAllowedRequestOrigin(req)) {
    logSecurity('bad_origin', req, `path=${pathname}`)
    sendJson(res, 403, { ok: false, error: 'Forbidden origin' })
    return
  }

  const clientKey = getClientKey(req)
  const lockSeconds = getLockSeconds(clientKey)

  if (pathname === '/share-auth/status') {
    const session = getShareSession(req)
    sendJson(res, 200, {
      authenticated: Boolean(session),
      user: session?.actor
        ? {
            id: session.actor.userId,
            name: session.actor.userName,
            role: session.actor.role || 'member',
            workspaceOwnerId: session.actor.workspaceOwnerId || session.actor.userId,
          }
        : undefined,
      locked: lockSeconds > 0,
      lockSeconds,
      mode: 'access-key',
    })
    return
  }

  if (pathname === '/share-auth/unlock') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    const timestamp = Date.now()
    for (const [key, window] of unlockRequests) {
      if (timestamp - window.start >= 60_000) unlockRequests.delete(key)
    }
    for (const [key, failure] of failedUnlocks) {
      if (timestamp - failure.last >= lockMs) failedUnlocks.delete(key)
    }
    const window = unlockRequests.get(clientKey) || { start: timestamp, count: 0 }
    window.count += 1
    unlockRequests.set(clientKey, window)
    if (window.count > 20) {
      const retryAfter = Math.max(1, Math.ceil((window.start + 60_000 - timestamp) / 1000))
      sendJson(res, 429, { ok: false, error: 'Too many unlock requests', retryAfter }, { 'Retry-After': String(retryAfter) })
      return
    }
    try {
      const body = JSON.parse((await readBody(req)) || '{}')
      const actor = store.verifyAccessKey(body.key || body.accessKey || body.token || '')
      if (actor) {
        failedUnlocks.delete(clientKey)
        lockedUntilByClient.delete(clientKey)
        const token = createSession(req, actor)
        logSecurity('unlock_success', req, `user=${actor.userName}`)
        sendJson(
          res,
          200,
          {
            ok: true,
            user: {
              id: actor.userId,
              name: actor.userName,
              role: actor.role || 'member',
              workspaceOwnerId: actor.workspaceOwnerId || actor.userId,
            },
          },
          { 'Set-Cookie': sessionCookie(token) },
        )
        return
      }
      if (lockSeconds > 0) {
        sendJson(res, 423, { ok: false, error: 'Access key locked', lockSeconds, attemptsRemaining: 0 })
        return
      }
      const failures = (failedUnlocks.get(clientKey)?.count || 0) + 1
      failedUnlocks.set(clientKey, { count: failures, last: Date.now() })
      if (failures >= 5) lockedUntilByClient.set(clientKey, Date.now() + lockMs)
      logSecurity('unlock_failed', req)
      sendJson(res, failures >= 5 ? 423 : 401, {
        ok: false, error: 'Invalid access key',
        lockSeconds: failures >= 5 ? lockMs / 1000 : 0,
        attemptsRemaining: Math.max(0, 5 - failures),
      })
    } catch {
      sendJson(res, 400, { ok: false, error: 'Invalid request' })
    }
    return
  }

  if (protectedPrefixes.some((prefix) => pathname.startsWith(prefix)) && !hasShareSession(req)) {
    logSecurity('auth_required', req, `path=${pathname}`)
    sendJson(res, 401, { ok: false, error: 'Access key required' })
    return
  }

  if (pathname === '/workbench/client-log') {
    // Client diagnostics are handled separately from native image actions.
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const body = JSON.parse((await readBody(req, 8192)) || '{}')
      const event = String(body.event || 'client_debug').replace(/[^a-z0-9_-]/gi, '').slice(0, 48) || 'client_debug'
      const message = Array.from(String(body.message || ''))
        .map((character) => {
          const code = character.charCodeAt(0)
          return code < 32 || code === 127 ? ' ' : character
        })
        .join('')
        .slice(0, 4000)
      const actor = actorFromRequest(req)
      logSecurity('client_drop_debug', req, `user=${actor.userName} event=${event} message=${JSON.stringify(message)}`)
      sendJson(res, 200, { ok: true })
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Client debug log failed' })
    }
    return
  }

  if (pathname === '/workbench/image/open') {
    if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'Method not allowed' }); return }
    if (!requireOwner(req, res)) return
    try {
      const body = JSON.parse((await readBody(req, 8192)) || '{}')
      if (!['open', 'folder'].includes(body.action)) throw new Error('Invalid image action')
      const resource = body.imagePath ? resolveControlledImagePath(body.imagePath) : resolvePreviewSourceUrl(body.imageUrl)
      sourceImageMimeFromMagic(resource.filePath)
      if (!['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(resource.filePath).toLowerCase())) throw new Error('Unsupported image extension')
      if (process.platform !== 'win32') throw new Error('System image actions require the Windows workbench host')
      const target = body.action === 'folder' ? path.dirname(resource.filePath) : resource.filePath
      const encodedPath = Buffer.from(target, 'utf8').toString('base64')
      const script = `$ErrorActionPreference='Stop'; $target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}')); Start-Process -FilePath $target`
      await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000 })
      sendJson(res, 200, { ok: true })
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Open image failed' })
    }
    return
  }

  if (pathname === '/preview-cache/upload-source' || pathname === '/workbench/resources/upload') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const body = JSON.parse((await readBody(req, 48 * 1024 * 1024)) || '{}')
      const resource = await cacheUploadedPreviewSource(body.dataUrl, body.fileName)
      logSecurity('preview_source_upload', req, `resource=${resource.id}`)
      sendJson(res, 200, { ok: true, resource, sourceImageUrl: resource.sourceImageUrl, previewImage: resource.previewImage })
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Preview source upload failed' })
    }
    return
  }

  if (pathname === '/preview-cache/import') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}')
      const previewImage = await cacheRemotePreview(String(body.url || '').trim())
      logSecurity('preview_import', req)
      sendJson(res, 200, { ok: true, previewImage })
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Preview import failed' })
    }
    return
  }

  if (pathname.startsWith('/preview-cache/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const fileName = decodeURIComponent(pathname.replace(/^\/preview-cache\//, ''))
      const requestedPath = path.resolve(previewCacheDir, fileName)
      const relative = path.relative(previewCacheDir, requestedPath)
      const insideCache = Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
      if (!insideCache || !fs.existsSync(requestedPath) || !fs.statSync(requestedPath).isFile()) {
        sendJson(res, 404, { ok: false, error: 'Preview not found' })
        return
      }
      sendFile(res, requestedPath)
    } catch {
      sendJson(res, 400, { ok: false, error: 'Invalid preview request' })
    }
    return
  }

  if (pathname === '/png-preset/write') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const body = JSON.parse((await readBody(req, 1024 * 1024)) || '{}')
      const imagePath = resolvePngPresetImagePath(body)
      const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
      upsertPngTextChunk(imagePath, pngPresetKeyword, JSON.stringify(metadata))
      logSecurity('png_preset_write', req)
      sendJson(res, 200, { ok: true, imagePath })
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'PNG preset write failed' })
    }
    return
  }

  if (pathname === '/png-preset/status') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}')
      const imagePath = resolvePngPresetImagePath(body)
      sendJson(res, 200, { ok: true, imagePath, hasPreset: hasPngTextChunk(imagePath, pngPresetKeyword) })
    } catch (error) {
      sendJson(res, 400, { ok: false, hasPreset: false, error: error instanceof Error ? error.message : 'PNG preset status failed' })
    }
    return
  }

  if (pathname === '/png-preset/read') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}')
      const imagePath = resolvePngPresetImagePath(body)
      const raw = readPngTextChunk(imagePath, pngPresetKeyword)
      if (!raw) {
        sendJson(res, 200, { ok: true, imagePath, hasPreset: false })
        return
      }
      sendJson(res, 200, { ok: true, imagePath, hasPreset: true, metadata: JSON.parse(raw) })
    } catch (error) {
      sendJson(res, 400, { ok: false, hasPreset: false, error: error instanceof Error ? error.message : 'PNG preset read failed' })
    }
    return
  }

  if (pathname === '/local-image') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const url = new URL(req.url || '/', 'http://local')
      const requestedPath = path.resolve(String(url.searchParams.get('path') || ''))
      const relative = path.relative(comfyOutputDir, requestedPath)
      const insideOutput = Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
      if (!insideOutput || !fs.existsSync(requestedPath) || !fs.statSync(requestedPath).isFile()) {
        sendJson(res, 404, { ok: false, error: 'Image not found' })
        return
      }
      const thumbnail = url.searchParams.get('thumbnail') === '1'
      sendFile(res, thumbnail ? await ensureOutputThumbnail(requestedPath) : requestedPath, thumbnail)
    } catch {
      sendJson(res, 400, { ok: false, error: 'Invalid image request' })
    }
    return
  }

  if (pathname === '/workbench/categories') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    const state = readSharedState()
    const counts = new Map()
    for (const block of state.blocks) counts.set(block.categoryId, (counts.get(block.categoryId) || 0) + 1)
    sendJson(res, 200, {
      ok: true,
      revision: state.revision,
      categories: state.categories.map((category) => ({ ...category, blockCount: counts.get(category.id) || 0 })),
    })
    return
  }

  if (pathname === '/workbench/blocks/source-image') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const url = new URL(req.url || '/', 'http://local')
      const source = resolveBlockSourceImage({
        blockId: url.searchParams.get('blockId'),
        variantId: url.searchParams.get('variantId'),
        baseModel: url.searchParams.get('baseModel'),
      })
      logSecurity('block_source_download', req, `block=${encodeURIComponent(source.block.id)} variant=${encodeURIComponent(source.variant?.id || '')}`)
      sendBlockSourceImage(req, res, source)
    } catch (error) {
      const status = Number(error?.statusCode || 400)
      sendJson(res, status, { ok: false, error: error instanceof Error ? error.message : 'Source image download failed' })
    }
    return
  }

  if (pathname === '/workbench/blocks') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    const url = new URL(req.url || '/', 'http://local')
    const categoryId = String(url.searchParams.get('categoryId') || '').trim()
    const query = String(url.searchParams.get('query') || '').trim().toLowerCase()
    const includeDisabled = url.searchParams.get('includeDisabled') !== 'false'
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 80)))
    const state = readSharedState()
    const blocks = state.blocks
      .filter((block) => !categoryId || block.categoryId === categoryId)
      .filter((block) => includeDisabled || block.enabled !== false)
      .filter((block) => {
        if (!query) return true
        const haystack = [
          block.id,
          block.name,
          block.notes,
          ...(Array.isArray(block.tags) ? block.tags : []),
          ...(Array.isArray(block.positive) ? block.positive : []),
          ...(Array.isArray(block.negative) ? block.negative : []),
          ...(Array.isArray(block.loras) ? block.loras.map((lora) => lora?.name) : []),
        ]
          .join(' ')
          .toLowerCase()
        return haystack.includes(query)
      })
      .slice(0, limit)
    sendJson(res, 200, { ok: true, revision: state.revision, count: blocks.length, blocks })
    return
  }

  if (pathname === '/workbench/ui-state') {
    const actor = actorFromRequest(req)
    const ownerId = ownerIdForRequest(req, new URL(req.url || '/', 'http://local').searchParams.get('ownerId') || '')
    if (req.method === 'GET') {
      sendJson(res, 200, { ok: true, ownerId, ...store.readUiState(ownerId) })
      return
    }
    if (req.method === 'POST') {
      try {
        const body = JSON.parse((await readBody(req, 1024 * 1024)) || '{}')
        const uiState = await enqueueOperation(() => store.setUiState(ownerId, body, actor))
        sendJson(res, 200, { ok: true, ownerId, ...uiState })
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Invalid UI state' })
      }
      return
    }
    sendJson(res, 405, { ok: false, error: 'Method not allowed' })
    return
  }

  if (pathname === '/workbench/operation') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const body = JSON.parse((await readBody(req, 16 * 1024 * 1024)) || '{}')
      const type = String(body.type || '').trim()
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}
      const actor = actorFromRequest(req)
      const ownerId = ownerIdForRequest(req, body.ownerId || '')
      const result = await enqueueOperation(() => {
        if (type.startsWith('selection.') || type.startsWith('ui.')) return { uiState: store.mutateUiState(ownerId, type, payload, actor) }
        return { operation: store.mutateSharedContent(type, payload, actor) }
      })
      sendJson(res, 200, { ok: true, ownerId, ...result })
    } catch (error) {
      if (error instanceof WorkbenchConflictError) {
        sendJson(res, 409, { ok: false, error: error.message, conflict: error.details })
      } else {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Operation failed' })
      }
    }
    return
  }

  if (pathname === '/workbench/image-prompt') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}')
      const imagePath = body.imageUrl ? assertPreviewCacheImageUrl(body.imageUrl, { pngOnly: false }) : assertOutputImagePath(body.imagePath)
      const gatewayResponse = await fetch(`${gatewayTarget}/image/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ image_path: imagePath }),
      })
      const text = await gatewayResponse.text()
      let data
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        sendJson(res, 502, { ok: false, error: 'Gateway returned invalid JSON' })
        return
      }
      logSecurity('image_prompt_read', req)
      sendJson(res, gatewayResponse.status, data)
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Image prompt read failed' })
    }
    return
  }

  if (pathname === '/workbench/generate') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const body = JSON.parse((await readBody(req, 16 * 1024 * 1024)) || '{}')
      const requestBody = body.requestBody && typeof body.requestBody === 'object' ? body.requestBody : {}
      const pngMetadata = body.pngMetadata && typeof body.pngMetadata === 'object' ? body.pngMetadata : null
      const actor = actorFromRequest(req)
      const manageGenerationState = Boolean(body.manageGenerationState)
      const options = {
        req,
        actor,
        requestBody,
        pngMetadata,
        includeResource: Boolean(body.includeResource),
        recordHistory: Boolean(body.recordHistory),
        source: String(body.source || 'web'),
      }
      const result = manageGenerationState
        ? await runManagedWorkbenchGeneration(options)
        : await executeWorkbenchGeneration({ ...options, manageGenerationState: false })
      sendJson(res, result.status, result.payload)
    } catch (error) {
      sendJson(res, 502, { ok: false, error: error instanceof Error ? error.message : 'Workbench generation failed' })
    }
    return
  }

  if (pathname === '/workbench/current') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const workspace = composeCurrentWorkbench(ownerIdForRequest(req))
      sendJson(res, 200, { ok: true, ...workspace, pngMetadata: undefined })
    } catch (error) {
      sendJson(res, Number(error?.statusCode || 400), { ok: false, error: error instanceof Error ? error.message : 'Current workbench read failed' })
    }
    return
  }

  if (pathname === '/workbench/generate-current') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const body = JSON.parse((await readBody(req, 4096)) || '{}')
      if (body && typeof body === 'object' && Object.keys(body).length > 0) {
        sendJson(res, 400, { ok: false, error: 'Current workbench generation does not accept generation parameters' })
        return
      }
      const actor = actorFromRequest(req)
      const workspace = composeCurrentWorkbench(ownerIdForRequest(req))
      const result = await runManagedWorkbenchGeneration({
        req,
        actor,
        requestBody: workspace.requestBody,
        pngMetadata: workspace.pngMetadata,
        includeResource: true,
        recordHistory: true,
        source: 'agent-current-workbench',
      })
      sendJson(res, result.status, {
        ...result.payload,
        workspaceOwnerId: workspace.workspaceOwnerId,
        uiRevision: workspace.revision,
        selectedBlockIds: workspace.selectedBlockIds,
      })
    } catch (error) {
      sendJson(res, Number(error?.statusCode || 502), { ok: false, error: error instanceof Error ? error.message : 'Current workbench generation failed' })
    }
    return
  }

  if (pathname === '/workbench/history') {
    if (req.method === 'GET') {
      const url = new URL(req.url || '/', 'http://local')
      sendJson(res, 200, { ok: true, history: store.listGenerationHistory({ limit: Number(url.searchParams.get('limit') || 30) }) })
      return
    }
    if (req.method === 'POST') {
      try {
        const body = JSON.parse((await readBody(req, 1024 * 1024)) || '{}')
        const item = await enqueueOperation(() => store.addGenerationHistory(body, actorFromRequest(req)))
        sendJson(res, 200, { ok: true, item })
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'History write failed' })
      }
      return
    }
    if (req.method === 'DELETE') {
      const owner = requireOwner(req, res)
      if (!owner) return
      const id = new URL(req.url || '/', 'http://local').searchParams.get('id')
      if (id) {
        try {
          const result = await enqueueOperation(() => {
            const history = store.listGenerationHistory({ limit: 200 })
            const item = history.find((entry) => entry.id === id)
            if (!item) throw new Error('相册记录不存在，请刷新后重试')
            const source = item.imagePath || item.imageUrl
            const candidate = item.imagePath
              ? path.resolve(item.imagePath)
              : assertPreviewCacheImageUrl(item.imageUrl, { pngOnly: false })
            const resource = resolveControlledImagePath(candidate)
            sourceImageMimeFromMagic(resource.filePath)
            const references = store.readSharedContent().blocks.filter((block) => {
              const sources = [
                { imagePath: block.previewSourceImagePath, imageUrl: block.previewSourceImageUrl || block.previewImage },
                ...(block.previewVariants || []).map((variant) => ({ imagePath: variant.sourceImagePath, imageUrl: variant.sourceImageUrl || variant.image })),
              ]
              return sources.some((ref) => {
                try {
                  const file = ref.imagePath || (ref.imageUrl?.startsWith('/preview-cache/') ? assertPreviewCacheImageUrl(ref.imageUrl, { pngOnly: false }) : '')
                  return file && fs.realpathSync(file) === resource.filePath
                } catch { return false }
              })
            })
            if (references.length) throw new Error(`原图仍被预制块引用：${references.map((block) => block.name).join('、')}。请先更换或删除对应预览图。`)
            fs.unlinkSync(resource.filePath)
            const deletedIds = history.filter((entry) => entry.id === id || (entry.imagePath || entry.imageUrl) === source).map((entry) => entry.id)
            store.deleteGenerationHistory(deletedIds, owner)
            return { deletedIds, fileDeleted: true }
          })
          sendJson(res, 200, { ok: true, ...result })
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : '删除图片失败' })
        }
        return
      }
      const result = await enqueueOperation(() => store.clearGenerationHistory(owner))
      sendJson(res, 200, { ok: true, ...result })
      return
    }
    sendJson(res, 405, { ok: false, error: 'Method not allowed' })
    return
  }

  if (pathname === '/workbench/operations') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    const url = new URL(req.url || '/', 'http://local')
    sendJson(res, 200, {
      ok: true,
      operations: store.listOperations({ limit: Number(url.searchParams.get('limit') || 100), since: url.searchParams.get('since') || '' }),
    })
    return
  }

  if (pathname === '/workbench/access-keys') {
    const owner = requireOwner(req, res)
    if (!owner) return
    if (req.method === 'GET') {
      sendJson(res, 200, { ok: true, users: store.listUsers(), keys: store.listAccessKeys() })
      return
    }
    if (req.method === 'POST') {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}')
        const key = await enqueueOperation(() => store.createAccessKey(body, owner))
        sendJson(res, 200, { ok: true, key })
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Access key create failed' })
      }
      return
    }
    sendJson(res, 405, { ok: false, error: 'Method not allowed' })
    return
  }

  if (pathname === '/workbench/access-keys/revoke') {
    const owner = requireOwner(req, res)
    if (!owner) return
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}')
      const key = await enqueueOperation(() => store.revokeAccessKey(body.id, owner))
      for (const [token, session] of sessions) {
        if (session.actor?.keyId === key.id) sessions.delete(token)
      }
      sendJson(res, 200, { ok: true, key })
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Access key revoke failed' })
    }
    return
  }

  if (pathname === '/workbench/access-keys/workspace') {
    const owner = requireOwner(req, res)
    if (!owner) return
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}')
      const workspaceOwnerId = String(body.workspaceOwnerId || owner.userId)
      const key = await enqueueOperation(() => store.bindAccessKeyWorkspace(body.id, workspaceOwnerId, owner))
      for (const [token, session] of sessions) {
        if (session.actor?.keyId === key.id) sessions.delete(token)
      }
      sendJson(res, 200, { ok: true, key })
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Access key workspace bind failed' })
    }
    return
  }

  if (pathname === '/workbench/backup') {
    const owner = requireOwner(req, res)
    if (!owner) return
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const filePath = await enqueueOperation(() => store.createBackup('manual'))
      sendJson(res, 200, { ok: true, filePath })
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Backup failed' })
    }
    return
  }

  if (pathname === '/share-state/content') {
    if (req.method === 'GET') {
      sendJson(res, 200, readSharedState())
      return
    }
    sendJson(res, 405, { ok: false, error: 'Method not allowed' })
    return
  }

  if (pathname === '/share-state/generation') {
    if (req.method === 'GET') {
      sendJson(res, 200, store.readGenerationState())
      return
    }
    if (req.method === 'POST') {
      try {
        const body = JSON.parse((await readBody(req, 1024 * 1024)) || '{}')
        const sharedGeneration = await enqueueOperation(() => store.setGenerationState(body, actorFromRequest(req)))
        logSecurity('shared_generation_write', req)
        sendJson(res, 200, sharedGeneration)
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Invalid generation state' })
      }
      return
    }
    sendJson(res, 405, { ok: false, error: 'Method not allowed' })
    return
  }

  if (pathname.startsWith('/gateway')) {
    const allowedMethods = allowedGatewayRoutes.get(pathname)
    if (!allowedMethods) {
      sendJson(res, 404, { ok: false, error: 'Gateway route not available' })
      return
    }
    if (!allowedMethods.has(req.method || 'GET')) {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    logSecurity('gateway_access', req, `path=${pathname}`)
    try {
      await proxyGateway(req, res, pathname)
    } catch (error) {
      sendJson(res, 502, { ok: false, error: error instanceof Error ? error.message : 'Gateway proxy failed' })
    }
    return
  }

  next()
}

export const createStaticShareServer = ({ host = '127.0.0.1', port = 5173, distDir = path.join(repoRoot, 'dist') } = {}) => {
  const middleware = createComfyMiddleware()
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
  }

  const serveStatic = (req, res) => {
    const pathname = requestPath(req)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    if (isBlockedDevAsset(pathname) || isDotPath(pathname)) {
      sendJson(res, 404, { ok: false, error: 'Not found' })
      return
    }
    const staticPathname = pathname === '/' ? '/index.html' : pathname
    const requestedPath = path.resolve(distDir, `.${staticPathname}`)
    const relative = path.relative(distDir, requestedPath)
    const insideDist = !relative.startsWith('..') && !path.isAbsolute(relative)
    const existingFile = insideDist && fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile()
    if (!existingFile && !canFallbackToSpa(pathname)) {
      sendJson(res, 404, { ok: false, error: 'Not found' })
      return
    }
    const filePath = existingFile ? requestedPath : path.join(distDir, 'index.html')
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, {
      ...securityHeaders,
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    fs.createReadStream(filePath).pipe(res)
  }

  return http.createServer((req, res) => {
    if (!isAllowedHostHeader(req.headers.host)) {
      logSecurity('bad_host', req, `host=${String(req.headers.host || '')}`)
      sendJson(res, 403, { ok: false, error: 'Forbidden host' })
      return
    }
    if (req.method && !['GET', 'HEAD', 'POST', 'OPTIONS'].includes(req.method) && !(req.method === 'DELETE' && requestPath(req) === '/workbench/history')) {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    if (req.method === 'OPTIONS') {
      const pathname = requestPath(req)
      const isSensitivePath = protectedPrefixes.some((prefix) => pathname.startsWith(prefix)) || pathname.startsWith('/share-auth')
      if (isSensitivePath && !isAllowedRequestOrigin(req)) {
        logSecurity('bad_origin', req, `path=${pathname}`)
        sendJson(res, 403, { ok: false, error: 'Forbidden origin' })
        return
      }
      res.writeHead(204, securityHeaders)
      res.end()
      return
    }
    void middleware(req, res, () => serveStatic(req, res)).catch((error) => {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Internal server error' })
    })
  }).listen(port, host, () => {
    console.log(`Comfy preset share server listening on http://${host.includes(':') ? `[${host}]` : host}:${port}/`)
  })
}

export const repoPaths = {
  repoRoot,
  dataDir,
  pinFile,
  sqliteFile,
  accessKeysFile,
  sharedStateFile,
  previewCacheDir,
  comfyOutputDir,
}

export const closeComfyServices = () => {
  clearInterval(maintenanceTimer)
  store.close()
}
