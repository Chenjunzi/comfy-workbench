import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

const listen = async (server) => {
  if (!server.listening) await once(server, 'listening')
  return server.address().port
}

const closeServer = (server) => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))

class SessionClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl
    this.cookie = ''
  }

  async request(pathName, options = {}) {
    const headers = { ...(options.body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}), ...(options.headers || {}) }
    if (this.cookie) headers.Cookie = this.cookie
    const response = await fetch(`${this.baseUrl}${pathName}`, { ...options, headers })
    const cookie = response.headers.get('set-cookie')
    if (cookie) this.cookie = cookie.split(';')[0]
    const text = await response.text()
    const contentType = response.headers.get('content-type') || ''
    return { status: response.status, data: text && contentType.includes('application/json') ? JSON.parse(text) : text }
  }

  async requestBuffer(pathName, options = {}) {
    const headers = { ...(options.headers || {}) }
    if (this.cookie) headers.Cookie = this.cookie
    const response = await fetch(`${this.baseUrl}${pathName}`, { ...options, headers })
    return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) }
  }

  async login(key) {
    const result = await this.request('/share-auth/unlock', { method: 'POST', body: JSON.stringify({ key }) })
    assert.equal(result.status, 200)
    return result.data
  }
}

const startMcp = ({ workbenchUrl, accessKey, sourceCacheDir }) => {
  const child = spawn(process.execPath, [path.join(repoRoot, 'mcp', 'comfy-preset-mcp.mjs')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      COMFY_PRESET_WORKBENCH_URL: workbenchUrl,
      COMFY_PRESET_ACCESS_KEY: accessKey,
      COMFY_PRESET_GATEWAY_URL: 'http://127.0.0.1:1',
      ...(sourceCacheDir ? { COMFY_PRESET_SOURCE_CACHE_DIR: sourceCacheDir } : {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let buffer = ''
  let nextId = 1
  const pending = new Map()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        const message = JSON.parse(line)
        const request = pending.get(message.id)
        if (request) {
          pending.delete(message.id)
          if (message.error) request.reject(new Error(message.error.message))
          else request.resolve(message.result)
        }
      }
      newline = buffer.indexOf('\n')
    }
  })
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId
      nextId += 1
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`MCP request timed out: ${method}`))
      }, 10_000)
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  const call = async (name, args = {}) => {
    const result = await request('tools/call', { name, arguments: args })
    return JSON.parse(result.content[0].text)
  }
  return { child, request, call }
}

test('remote MCP uses authenticated workbench resources and gateway bridge', { timeout: 60_000 }, async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-remote-workbench-'))
  const dataDir = path.join(root, 'data')
  const outputDir = path.join(root, 'output')
  const previewDir = path.join(dataDir, 'preview-cache')
  fs.mkdirSync(outputDir, { recursive: true })
  fs.mkdirSync(previewDir, { recursive: true })
  const uploadPng = await sharp({ create: { width: 24, height: 40, channels: 4, background: '#446688ff' } }).png().toBuffer()
  const uploadJpeg = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#884422' } }).jpeg().toBuffer()
  const generatedPath = path.join(outputDir, 'agent-generated.png')
  let inspectedGatewayPath = ''
  let lastLoraRequestUrl = ''
  let lastTxt2ImgBody = {}
  const mockLoras = [
    ...Array.from({ length: 5000 }, (_, index) => `library/filler_${String(index).padStart(5, '0')}.safetensors`),
    'Krea2/mingyun_oc_krea2_quick_v1-total00600.safetensors',
  ]

  const gateway = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    if (req.url === '/health') return void res.end(JSON.stringify({ ok: true, service: 'mock-gateway' }))
    if (req.url === '/models') return void res.end(JSON.stringify({ models: ['test_model'] }))
    if (req.url?.startsWith('/loras')) {
      lastLoraRequestUrl = req.url
      const url = new URL(req.url, 'http://local')
      const query = String(url.searchParams.get('query') || '').trim().toLowerCase()
      const requestedLimit = Number(url.searchParams.get('limit') || mockLoras.length)
      const filtered = query ? mockLoras.filter((item) => item.toLowerCase().includes(query)) : mockLoras
      const loras = filtered.slice(0, Math.max(1, requestedLimit))
      const payload = JSON.stringify({ ok: true, total: mockLoras.length, filtered: filtered.length, returned: loras.length, loras })
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Length', String(Buffer.byteLength(payload)))
      return void res.end(payload)
    }
    if (req.url?.startsWith('/lora-info?')) {
      res.setHeader('Content-Type', 'application/json')
      return void res.end(JSON.stringify({ ok: true, preview_image_url: '/lora-preview?name=test_lora.safetensors' }))
    }
    if (req.url?.startsWith('/lora-preview?')) {
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Content-Length', String(uploadPng.length))
      return void res.end(uploadPng)
    }
    if (req.url === '/image/prompt') {
      inspectedGatewayPath = body.image_path
      res.setHeader('Content-Type', 'application/json')
      return void res.end(JSON.stringify({ ok: true, prompt: 'remote prompt' }))
    }
    if (req.url === '/txt2img') {
      lastTxt2ImgBody = body
      await sharp({ create: { width: 32, height: 48, channels: 4, background: '#224466ff' } }).png().toFile(generatedPath)
      res.setHeader('Content-Type', 'application/json')
      return void res.end(JSON.stringify({ ok: true, image_path: generatedPath }))
    }
    res.statusCode = 404
    res.end(JSON.stringify({ ok: false, error: 'not found' }))
  })
  gateway.listen(0, '127.0.0.1')
  const gatewayPort = await listen(gateway)

  process.env.COMFY_PRESET_DATA_DIR = dataDir
  process.env.COMFY_PRESET_SQLITE_FILE = path.join(dataDir, 'workbench.sqlite')
  process.env.COMFY_PRESET_SHARED_STATE_FILE = path.join(dataDir, 'shared-state.json')
  process.env.COMFY_PRESET_ACCESS_KEYS_FILE = path.join(dataDir, 'access-keys.txt')
  process.env.COMFY_PRESET_PREVIEW_CACHE_DIR = previewDir
  process.env.COMFY_PRESET_OUTPUT_DIR = outputDir
  process.env.COMFY_PRESET_GATEWAY_URL = `http://127.0.0.1:${gatewayPort}`
  process.env.COMFY_PRESET_BACKUP_INTERVAL_HOURS = '0'

  let serverModule = await import(`../server/comfy-server.mjs?remote-test=first`)
  let shareServer = serverModule.createStaticShareServer({ host: '127.0.0.1', port: 0, distDir: path.join(repoRoot, 'dist') })
  let sharePort = await listen(shareServer)
  let baseUrl = `http://127.0.0.1:${sharePort}`
  const ownerKey = fs.readFileSync(path.join(dataDir, 'access-keys.txt'), 'utf8').match(/cwui_[A-Za-z0-9_-]+/)?.[0]
  assert.ok(ownerKey)

  context.after(async () => {
    try {
      if (shareServer.listening) await closeServer(shareServer)
    } catch {}
    try {
      serverModule.closeComfyServices()
    } catch {}
    await closeServer(gateway)
    fs.rmSync(root, { recursive: true, force: true })
  })

  const anonymous = new SessionClient(baseUrl)
  const denied = await anonymous.request('/workbench/resources/upload', {
    method: 'POST',
    body: JSON.stringify({ dataUrl: `data:image/png;base64,${uploadPng.toString('base64')}`, fileName: 'x.png' }),
  })
  assert.equal(denied.status, 401)
  assert.equal((await anonymous.requestBuffer('/workbench/blocks/source-image?blockId=anything')).status, 401)

  const owner = new SessionClient(baseUrl)
  const ownerLogin = await owner.login(ownerKey)
  const memberCreated = await owner.request('/workbench/access-keys', {
    method: 'POST',
    body: JSON.stringify({ userName: 'linux-agent-test', keyName: 'astrbot', bindToOwnerWorkspace: true }),
  })
  assert.equal(memberCreated.status, 200)
  assert.equal(memberCreated.data.key.workspaceOwnerId, ownerLogin.user.id)
  const memberKey = memberCreated.data.key.key
  const member = new SessionClient(baseUrl)
  await member.login(memberKey)

  const filteredLoras = await member.request('/gateway/loras?query=mingyun_oc_krea2_quick_v1-total00600&limit=3')
  assert.equal(filteredLoras.status, 200)
  assert.equal(filteredLoras.data.total, 5001)
  assert.equal(filteredLoras.data.filtered, 1)
  assert.deepEqual(filteredLoras.data.loras, ['Krea2/mingyun_oc_krea2_quick_v1-total00600.safetensors'])

  const loraInfo = await member.request('/gateway/lora-info?name=test_lora.safetensors')
  assert.equal(loraInfo.status, 200)
  assert.equal(loraInfo.data.preview_image_url, '/lora-preview?name=test_lora.safetensors')
  const proxiedLoraPreview = await member.requestBuffer('/gateway/lora-preview?name=test_lora.safetensors')
  assert.equal(proxiedLoraPreview.status, 200)
  assert.equal(proxiedLoraPreview.headers.get('content-type'), 'image/png')
  assert.deepEqual(proxiedLoraPreview.buffer, uploadPng)
  const cachedLoraPreview = await member.request('/preview-cache/import', {
    method: 'POST',
    body: JSON.stringify({ url: '/gateway/lora-preview?name=test_lora.safetensors' }),
  })
  assert.equal(cachedLoraPreview.status, 200)
  assert.match(cachedLoraPreview.data.previewImage, /^\/preview-cache\/[a-f0-9]{64}\.webp$/)
  assert.equal((await member.requestBuffer(cachedLoraPreview.data.previewImage)).headers.get('content-type'), 'image/webp')
  assert.equal(
    (
      await member.request('/preview-cache/import', {
        method: 'POST',
        body: JSON.stringify({ url: '/gateway/health?name=test_lora.safetensors' }),
      })
    ).status,
    400,
  )

  const mismatch = await member.request('/workbench/resources/upload', {
    method: 'POST',
    body: JSON.stringify({ dataUrl: `data:image/png;base64,${uploadJpeg.toString('base64')}`, fileName: '../../wrong.png' }),
  })
  assert.equal(mismatch.status, 400)

  const tooLarge = await member.request('/workbench/resources/upload', {
    method: 'POST',
    body: JSON.stringify({ dataUrl: `data:image/png;base64,${Buffer.alloc(33 * 1024 * 1024).toString('base64')}`, fileName: 'large.png' }),
  })
  assert.equal(tooLarge.status, 400)

  const uploaded = await member.request('/workbench/resources/upload', {
    method: 'POST',
    body: JSON.stringify({ dataUrl: `data:image/png;base64,${uploadPng.toString('base64')}`, fileName: '../../portrait.png' }),
  })
  assert.equal(uploaded.status, 200)
  assert.match(uploaded.data.resource.sourceImageUrl, /^\/preview-cache\/source-/)
  assert.match(uploaded.data.resource.previewImage, /^\/preview-cache\/resource-thumb-/)
  assert.equal(uploaded.data.resource.previewFit, 'background')
  assert.equal(fs.readdirSync(previewDir).some((name) => name.includes('..')), false)

  const uploadedJpegResource = await member.request('/workbench/resources/upload', {
    method: 'POST',
    body: JSON.stringify({ dataUrl: `data:image/jpeg;base64,${uploadJpeg.toString('base64')}`, fileName: 'landscape.jpg' }),
  })
  assert.equal(uploadedJpegResource.status, 200)

  const createSourceBlock = async (id, sourceFields) => {
    const result = await member.request('/workbench/operation', {
      method: 'POST',
      body: JSON.stringify({
        type: 'block.create',
        payload: { block: { id, categoryId: 'character', name: id, positive: [id], ...sourceFields } },
      }),
    })
    assert.equal(result.status, 200)
    return result.data.operation.entity
  }

  await createSourceBlock('download_valid', { previewSourceImageUrl: uploaded.data.resource.sourceImageUrl })
  const validSource = await member.requestBuffer('/workbench/blocks/source-image?blockId=download_valid')
  assert.equal(validSource.status, 200)
  assert.equal(validSource.headers.get('content-type'), 'image/png')
  assert.equal(Number(validSource.headers.get('content-length')), uploadPng.length)
  assert.deepEqual(validSource.buffer, uploadPng)

  const disposablePath = path.join(outputDir, 'delete-album-test.png')
  fs.writeFileSync(disposablePath, uploadPng)
  await owner.request('/workbench/history', { method: 'POST', body: JSON.stringify({ id: 'delete_album_test', imagePath: disposablePath }) })
  assert.equal((await member.request('/workbench/history?id=delete_album_test', { method: 'DELETE' })).status, 403)
  assert.equal(fs.existsSync(disposablePath), true)
  const deletion = await owner.request('/workbench/history?id=delete_album_test', { method: 'DELETE' })
  assert.equal(deletion.status, 200)
  assert.equal(fs.existsSync(disposablePath), false)
  assert.ok(!(await owner.request('/workbench/history')).data.history.some((item) => item.id === 'delete_album_test'))

  await owner.request('/workbench/history', { method: 'POST', body: JSON.stringify({ id: 'delete_referenced_test', imageUrl: uploaded.data.resource.sourceImageUrl }) })
  assert.equal((await owner.request('/workbench/history?id=delete_referenced_test', { method: 'DELETE' })).status, 400)
  assert.equal((await member.requestBuffer('/workbench/blocks/source-image?blockId=download_valid')).status, 200)

  await createSourceBlock('download_missing', { previewSourceImageUrl: '/preview-cache/missing-source.png' })
  assert.equal((await member.requestBuffer('/workbench/blocks/source-image?blockId=download_missing')).status, 404)

  await createSourceBlock('download_bad_url', { previewSourceImageUrl: 'https://example.com/preview-cache/source.png' })
  assert.equal((await member.requestBuffer('/workbench/blocks/source-image?blockId=download_bad_url')).status, 400)

  const outsideSource = path.join(root, 'outside.png')
  fs.writeFileSync(outsideSource, uploadPng)
  assert.equal((await anonymous.request('/workbench/image/open', { method: 'POST', body: '{}' })).status, 401)
  assert.equal((await member.request('/workbench/image/open', { method: 'POST', body: '{}' })).status, 403)
  assert.equal((await owner.request('/workbench/image/open', { method: 'POST', body: JSON.stringify({ action: 'folder', imagePath: outsideSource }) })).status, 400)
  assert.equal((await owner.request('/workbench/image/open', { method: 'POST', body: JSON.stringify({ action: 'execute', imagePath: generatedPath }) })).status, 400)
  await createSourceBlock('download_outside', { previewSourceImagePath: outsideSource })
  assert.equal((await member.requestBuffer('/workbench/blocks/source-image?blockId=download_outside')).status, 403)

  fs.writeFileSync(path.join(previewDir, 'fake-source.png'), Buffer.from('not an image'))
  await createSourceBlock('download_fake', { previewSourceImageUrl: '/preview-cache/fake-source.png' })
  assert.equal((await member.requestBuffer('/workbench/blocks/source-image?blockId=download_fake')).status, 415)

  const oversizedSource = path.join(previewDir, 'oversized-source.png')
  fs.writeFileSync(oversizedSource, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  fs.truncateSync(oversizedSource, 64 * 1024 * 1024 + 1)
  await createSourceBlock('download_oversized', { previewSourceImageUrl: '/preview-cache/oversized-source.png' })
  assert.equal((await member.requestBuffer('/workbench/blocks/source-image?blockId=download_oversized')).status, 413)

  const missing = await member.request('/png-preset/read', {
    method: 'POST',
    body: JSON.stringify({ imageUrl: '/preview-cache/missing.png' }),
  })
  assert.equal(missing.status, 400)
  assert.equal((await member.request('/preview-cache/%2e%2e/workbench.sqlite')).status, 404)

  const fixtureMetadata = {
    app: 'comfy-preset-workflow-ui',
    version: 1,
    generationPreset: { name: 'remote fixture', selectedBlockIds: [], width: 32, height: 48 },
    selectedBlocks: [],
    composed: { positive: 'test', negative: '', loras: [] },
    requestBody: { prompt: 'test', width: 32, height: 48 },
  }
  assert.equal(
    (
      await member.request('/png-preset/write', {
        method: 'POST',
        body: JSON.stringify({ imageUrl: uploaded.data.resource.sourceImageUrl, metadata: fixtureMetadata }),
      })
    ).status,
    200,
  )
  const readPreset = await member.request('/png-preset/read', {
    method: 'POST',
    body: JSON.stringify({ imageUrl: uploaded.data.resource.sourceImageUrl }),
  })
  assert.equal(readPreset.data.metadata.generationPreset.name, 'remote fixture')

  const promptResult = await member.request('/workbench/image-prompt', {
    method: 'POST',
    body: JSON.stringify({ imageUrl: uploaded.data.resource.sourceImageUrl }),
  })
  assert.equal(promptResult.data.prompt, 'remote prompt')
  assert.equal(path.dirname(inspectedGatewayPath), previewDir)
  assert.equal((await member.request('/gateway/health')).status, 200)
  assert.equal((await member.request('/gateway/image/prompt', { method: 'POST', body: '{}' })).status, 404)
  assert.equal(
    (
      await member.request('/workbench/client-log', {
        method: 'POST',
        body: JSON.stringify({ event: 'image_drop_preset', message: 'types=[Files] · files=1 · result=recognized' }),
      })
    ).status,
    200,
  )

  const generated = await member.request('/workbench/generate', {
    method: 'POST',
    body: JSON.stringify({
      requestBody: { prompt: 'agent test', model: 'test_model', width: 32, height: 48 },
      pngMetadata: fixtureMetadata,
      includeResource: true,
      recordHistory: true,
      manageGenerationState: true,
    }),
  })
  assert.equal(generated.status, 200)
  assert.equal(generated.data.png_preset_written, true)
  assert.match(generated.data.resource.previewImage, /^\/preview-cache\/resource-thumb-/)
  assert.equal((await member.request('/share-state/generation')).data.active, false)
  assert.equal((await member.request('/workbench/history?limit=10')).data.history[0].model, 'test_model')
  const operations = (await member.request('/workbench/operations?limit=30')).data.operations
  assert.ok(operations.some((item) => item.type === 'generation_history.add' && item.actorName === 'linux-agent-test'))

  const created = await member.request('/workbench/operation', {
    method: 'POST',
    body: JSON.stringify({
      type: 'block.create',
      payload: { block: { id: 'remote_conflict', categoryId: 'character', name: 'Remote conflict', positive: ['one'] } },
    }),
  })
  const revision = created.data.operation.entity.revision
  assert.equal(
    (
      await member.request('/workbench/operation', {
        method: 'POST',
        body: JSON.stringify({ type: 'block.update', payload: { id: 'remote_conflict', patch: { notes: 'first' }, baseRevision: revision } }),
      })
    ).status,
    200,
  )
  assert.equal(
    (
      await member.request('/workbench/operation', {
        method: 'POST',
        body: JSON.stringify({ type: 'block.update', payload: { id: 'remote_conflict', patch: { notes: 'stale' }, baseRevision: revision } }),
      })
    ).status,
    409,
  )

  const sourceCacheDir = path.join(root, 'linux-source-cache')
  const mcp = startMcp({ workbenchUrl: baseUrl, accessKey: memberKey, sourceCacheDir })
  context.after(() => mcp.child.kill())
  await mcp.request('initialize', { protocolVersion: '2024-11-05' })
  const toolList = await mcp.request('tools/list')
  assert.ok(toolList.tools.some((tool) => tool.name === 'comfy_get_current_selection'))
  assert.ok(toolList.tools.some((tool) => tool.name === 'comfy_get_current_workbench'))
  assert.ok(toolList.tools.some((tool) => tool.name === 'comfy_generate_current_workbench'))
  assert.ok(toolList.tools.some((tool) => tool.name === 'comfy_update_custom_prompt'))
  assert.ok(toolList.tools.some((tool) => tool.name === 'comfy_download_block_source_image'))
  const generateFromBlockTool = toolList.tools.find((tool) => tool.name === 'comfy_generate_from_block_preset')
  assert.ok(generateFromBlockTool.inputSchema.properties.imagePath)
  assert.ok(generateFromBlockTool.inputSchema.properties.imageUrl)
  assert.ok(toolList.tools.find((tool) => tool.name === 'comfy_create_preset_block').inputSchema.properties.loraBaseModels.items.enum.includes('moss'))
  assert.ok(toolList.tools.find((tool) => tool.name === 'comfy_download_block_source_image').inputSchema.properties.baseModel.enum.includes('moss'))
  const mossBlock = await mcp.call('comfy_create_preset_block', {
    categoryId: 'style',
    name: 'MOSS classification fixture',
    positive: ['test'],
    loras: [{ name: 'MOSS-Image/test.safetensors', strength_model: 1, strength_clip: 1 }],
    loraBaseModels: ['moss'],
  })
  await mcp.call('comfy_update_preset_block', { id: mossBlock.block.id, notes: 'retain MOSS tag' })
  const mossStored = (await mcp.call('comfy_list_preset_blocks', { query: 'MOSS classification fixture' })).blocks.find((block) => block.id === mossBlock.block.id)
  assert.deepEqual(mossStored.loraBaseModels, ['moss'])
  assert.ok(toolList.tools.find((tool) => tool.name === 'comfy_update_category').inputSchema.properties.description)
  assert.equal((await mcp.call('comfy_gateway_health')).service, 'mock-gateway')
  const filteredMcpLoras = await mcp.call('comfy_list_loras', { query: 'mingyun_oc_krea2_quick_v1-total00600', limit: 3 })
  assert.equal(filteredMcpLoras.total, 5001)
  assert.equal(filteredMcpLoras.filtered, 1)
  assert.equal(filteredMcpLoras.total_returned, 1)
  assert.deepEqual(filteredMcpLoras.loras, ['Krea2/mingyun_oc_krea2_quick_v1-total00600.safetensors'])
  assert.match(lastLoraRequestUrl, /^\/loras\?limit=3&query=mingyun_oc_krea2_quick_v1-total00600$/)
  const baseModelProfiles = await mcp.call('comfy_get_base_model_profiles')
  assert.deepEqual(baseModelProfiles.profiles.krea2, {
    positivePrefix: '',
    negativePrefix: '',
    preset: 'anime_manga_fast',
    steps: 7,
    cfg: 1,
    sampler: 'euler',
    scheduler: 'simple',
    width: 720,
    height: 1280,
    upscaleSteps: [
      {
        id: 'krea2_latent_hires',
        enabled: true,
        scale: 1.5,
        steps: 10,
        cfg: 1,
        denoise: 0.4,
        sampler: 'euler',
        scheduler: 'simple',
      },
    ],
  })
  const mcpCategory = await mcp.call('comfy_create_category', {
    id: 'mcp_category_description',
    name: 'MCP category description',
    description: 'Before update',
  })
  assert.equal(mcpCategory.category.description, 'Before update')
  const updatedMcpCategory = await mcp.call('comfy_update_category', {
    id: mcpCategory.category.id,
    description: 'After update',
  })
  assert.equal(updatedMcpCategory.category.description, 'After update')
  assert.equal(
    (await mcp.call('comfy_list_categories')).categories.find((category) => category.id === mcpCategory.category.id).description,
    'After update',
  )
  const mcpBlock = await mcp.call('comfy_create_preset_block', {
    categoryId: 'character',
    name: 'Remote uploaded block',
    positive: ['remote block'],
    loras: [{ name: 'krea2_darkbrush.safetensors', strength_model: 0.8, strength_clip: 0.8 }],
    loraBaseModels: ['krea2'],
    previewImagePath: generatedPath,
    previewSourceImagePath: generatedPath,
  })
  assert.match(mcpBlock.block.previewImage, /^\/preview-cache\/resource-thumb-/)
  assert.deepEqual(mcpBlock.block.loraBaseModels, ['krea2'])
  assert.match(mcpBlock.block.previewSourceImageUrl, /^\/preview-cache\/source-/)
  assert.equal(mcpBlock.block.previewSourceImagePath, undefined)
  assert.equal((await mcp.call('comfy_read_block_source_preset', { blockId: mcpBlock.block.id })).generationPreset.name, 'remote fixture')

  const explicitSourceBlock = await createSourceBlock('explicit_source_override', {
    previewSourceImageUrl: uploaded.data.resource.sourceImageUrl,
    previewVariants: [
      {
        id: 'legacy_missing_krea2_source',
        baseModel: 'krea2',
        sourceImageUrl: '/preview-cache/legacy-missing-krea2.png',
      },
    ],
    activePreviewVariantIds: { krea2: 'legacy_missing_krea2_source' },
  })
  const explicitSourceDryRun = await mcp.call('comfy_generate_from_block_preset', {
    sourceBlockId: explicitSourceBlock.id,
    sourcePreviewBaseModel: 'krea2',
    imageUrl: explicitSourceBlock.previewSourceImageUrl,
    dry_run: true,
  })
  assert.equal(explicitSourceDryRun.dry_run, true)
  assert.equal(explicitSourceDryRun.sourceImageUrl, uploaded.data.resource.sourceImageUrl)
  assert.equal(explicitSourceDryRun.generationPreset.name, 'remote fixture')

  const generatedFromBlock = await mcp.call('comfy_generate_from_block_preset', {
    sourceBlockId: mcpBlock.block.id,
    targetPreviewBlockId: mcpBlock.block.id,
    targetPreviewBaseModel: 'krea2',
  })
  assert.equal(generatedFromBlock.result.png_preset_written, true)
  assert.match(generatedFromBlock.resource.sourceImageUrl, /^\/preview-cache\/source-/)
  assert.match(generatedFromBlock.previewUpdatedBlock.previewSourceImageUrl, /^\/preview-cache\/source-/)
  assert.equal(
    (await mcp.call('comfy_read_block_source_preset', { blockId: mcpBlock.block.id, sourcePreviewBaseModel: 'krea2' })).generationPreset.name,
    'remote fixture',
  )

  const blockBeforeVariants = (await member.request(`/workbench/blocks?query=${encodeURIComponent(mcpBlock.block.id)}&limit=20`)).data.blocks.find(
    (block) => block.id === mcpBlock.block.id,
  )
  const variantUpdate = await member.request('/workbench/operation', {
    method: 'POST',
    body: JSON.stringify({
      type: 'block.update',
      payload: {
        id: mcpBlock.block.id,
        baseRevision: blockBeforeVariants.revision,
        patch: {
          previewVariants: [
            ...(blockBeforeVariants.previewVariants || []),
            {
              id: 'remote_illustrious_source',
              baseModel: 'illustrious',
              image: uploadedJpegResource.data.resource.previewImage,
              sourceImageUrl: uploadedJpegResource.data.resource.sourceImageUrl,
            },
          ],
          activePreviewVariantIds: { ...(blockBeforeVariants.activePreviewVariantIds || {}), illustrious: 'remote_illustrious_source' },
        },
      },
    }),
  })
  assert.equal(variantUpdate.status, 200)

  const downloadedKrea2 = await mcp.call('comfy_download_block_source_image', { blockId: mcpBlock.block.id, baseModel: 'krea2' })
  const krea2ResourcePath = path.join(
    previewDir,
    decodeURIComponent(new URL(generatedFromBlock.resource.sourceImageUrl, 'http://local').pathname.replace(/^\/preview-cache\//, '')),
  )
  const krea2Resource = fs.readFileSync(krea2ResourcePath)
  assert.equal(downloadedKrea2.baseModel, 'krea2')
  assert.equal(downloadedKrea2.bytes, krea2Resource.length)
  assert.equal(downloadedKrea2.sha256, crypto.createHash('sha256').update(krea2Resource).digest('hex'))
  assert.deepEqual(fs.readFileSync(downloadedKrea2.absolutePath), krea2Resource)
  assert.equal(path.dirname(downloadedKrea2.absolutePath), sourceCacheDir)

  const downloadedIllustrious = await mcp.call('comfy_download_block_source_image', {
    blockId: mcpBlock.block.id,
    variantId: 'remote_illustrious_source',
    baseModel: 'illustrious',
  })
  assert.equal(downloadedIllustrious.variantId, 'remote_illustrious_source')
  assert.equal(downloadedIllustrious.baseModel, 'illustrious')
  assert.equal(downloadedIllustrious.mimeType, 'image/jpeg')
  assert.equal(downloadedIllustrious.sha256, crypto.createHash('sha256').update(uploadJpeg).digest('hex'))
  assert.deepEqual(fs.readFileSync(downloadedIllustrious.absolutePath), uploadJpeg)
  await assert.rejects(
    () => mcp.call('comfy_download_block_source_image', { blockId: 'download_valid', baseModel: 'anima' }),
    /No source image is stored for base model/,
  )

  await createSourceBlock('download_legacy_output', { previewSourceImagePath: generatedPath })
  const downloadedLegacy = await mcp.call('comfy_download_block_source_image', { blockId: 'download_legacy_output' })
  assert.equal(downloadedLegacy.mimeType, 'image/png')
  assert.match(downloadedLegacy.sourceResourceUrl, /^\/workbench\/blocks\/source-image\?/)
  assert.equal(downloadedLegacy.sourceResourceUrl.includes(outputDir), false)
  assert.deepEqual(fs.readFileSync(downloadedLegacy.absolutePath), fs.readFileSync(generatedPath))
  const plainGeneration = await mcp.call('comfy_generate_image', {
    prompt: 'remote MCP generation',
    model: 'test_model',
    width: 32,
    height: 48,
  })
  assert.equal(plainGeneration.png_preset_written, true)
  assert.match(plainGeneration.resource.previewImage, /^\/preview-cache\/resource-thumb-/)
  assert.equal((await mcp.call('comfy_get_current_selection')).ok, true)
  assert.equal(
    (
      await mcp.call('comfy_update_current_selection', {
        action: 'set',
        selectedBlockIds: [mcpBlock.block.id],
      })
    ).ok,
    true,
  )
  assert.equal((await mcp.call('comfy_get_current_selection')).count, 1)
  const kreaSingleUpscale = {
    id: 'krea-single-upscale',
    enabled: true,
    scale: 1.5,
    steps: 10,
    cfg: 1,
    denoise: 0.4,
    sampler: 'euler',
    scheduler: 'simple',
  }
  const currentUiState = await owner.request('/workbench/ui-state', {
    method: 'POST',
    body: JSON.stringify({
      selectedBlockIds: [mcpBlock.block.id],
      selectedColorPrompts: ['teal'],
      generationDraft: {
        gatewayUrl: '/gateway',
        positivePrefix: 'owner quality',
        negativePrefix: 'owner negative',
        customPositivePrompt: 'owner custom',
        model: 'krea2_turbo',
        preset: 'anime_manga_fast',
        filenamePrefix: 'Preset/%character%/%date:yyyyMMddhhmmss%',
        width: 32,
        height: 48,
        steps: 17,
        cfg: 4.5,
        seed: '1234',
        sampler: 'euler_ancestral',
        scheduler: 'normal',
        upscaleSteps: [kreaSingleUpscale],
      },
    }),
  })
  assert.equal(currentUiState.status, 200)
  const currentWorkbench = await mcp.call('comfy_get_current_workbench')
  assert.equal(currentWorkbench.generationDraft.steps, 17)
  assert.equal(currentWorkbench.requestBody.model, 'krea2_turbo')
  assert.deepEqual(currentWorkbench.selectedBlockIds, [mcpBlock.block.id])
  assert.equal(currentWorkbench.customPositivePrompt, 'owner custom')
  assert.equal(currentWorkbench.requestBody.prompt, 'teal, remote block, owner custom')
  assert.equal(currentWorkbench.requestBody.upscale_scale, 1.5)
  assert.equal(currentWorkbench.requestBody.upscale_mode, 'krea2_hires')
  assert.equal(currentWorkbench.requestBody.upscale_stages, 1)
  assert.equal(currentWorkbench.requestBody.second_seed, 1234)
  assert.equal(currentWorkbench.requestBody.second_steps, 10)
  assert.equal(currentWorkbench.requestBody.second_cfg, 1)
  assert.equal(currentWorkbench.requestBody.second_denoise, 0.4)
  assert.equal(currentWorkbench.requestBody.second_sampler_name, 'euler')
  assert.equal(currentWorkbench.requestBody.second_scheduler, 'simple')
  assert.match(currentWorkbench.composed.positive, /owner quality/)
  assert.match(currentWorkbench.composed.positive, /remote block/)
  const kreaMissingRequiredStage = await owner.request('/workbench/ui-state', {
    method: 'POST',
    body: JSON.stringify({
      selectedBlockIds: currentUiState.data.selectedBlockIds,
      selectedColorPrompts: currentUiState.data.selectedColorPrompts,
      generationDraft: { ...currentUiState.data.generationDraft, upscaleSteps: [] },
    }),
  })
  assert.equal(kreaMissingRequiredStage.status, 200)
  assert.equal((await member.request('/workbench/current')).status, 409)
  const kreaTwoStageUiState = await owner.request('/workbench/ui-state', {
    method: 'POST',
    body: JSON.stringify({
      selectedBlockIds: currentUiState.data.selectedBlockIds,
      selectedColorPrompts: currentUiState.data.selectedColorPrompts,
      generationDraft: {
        ...currentUiState.data.generationDraft,
        upscaleSteps: [
          kreaSingleUpscale,
          {
            id: 'krea-second-upscale',
            enabled: true,
            scale: 1.5,
            steps: 3,
            cfg: 1,
            denoise: 0.12,
            sampler: 'euler',
            scheduler: 'simple',
          },
        ],
      },
    }),
  })
  assert.equal(kreaTwoStageUiState.status, 200)
  const kreaTwoStageWorkbench = await mcp.call('comfy_get_current_workbench')
  assert.equal(kreaTwoStageWorkbench.requestBody.upscale_mode, 'two_stage')
  assert.equal(kreaTwoStageWorkbench.requestBody.upscale_stages, 2)
  assert.equal(kreaTwoStageWorkbench.requestBody.upscale_scale, 1.5)
  assert.equal(kreaTwoStageWorkbench.requestBody.stage_upscale_scale, undefined)
  assert.equal(kreaTwoStageWorkbench.requestBody.second_stage_upscale_scale, 1.5)
  assert.equal(kreaTwoStageWorkbench.requestBody.second_stage_upscale_model, 'OmniSR_X4_DIV2K.safetensors')
  assert.equal(kreaTwoStageWorkbench.requestBody.third_seed, 1235)
  assert.equal(kreaTwoStageWorkbench.requestBody.third_steps, 3)
  assert.equal(kreaTwoStageWorkbench.requestBody.third_cfg, 1)
  assert.equal(kreaTwoStageWorkbench.requestBody.third_denoise, 0.12)
  assert.equal(kreaTwoStageWorkbench.requestBody.third_sampler_name, 'euler')
  assert.equal(kreaTwoStageWorkbench.requestBody.third_scheduler, 'simple')
  const restoredSingleStage = await owner.request('/workbench/ui-state', {
    method: 'POST',
    body: JSON.stringify({
      selectedBlockIds: currentUiState.data.selectedBlockIds,
      selectedColorPrompts: currentUiState.data.selectedColorPrompts,
      generationDraft: { ...currentUiState.data.generationDraft, upscaleSteps: [kreaSingleUpscale] },
    }),
  })
  assert.equal(restoredSingleStage.status, 200)
  const updatedCustomPrompt = await mcp.call('comfy_update_custom_prompt', { prompt: 'agent custom' })
  assert.equal(updatedCustomPrompt.uiState.generationDraft.customPositivePrompt, 'agent custom')
  const updatedWorkbench = await mcp.call('comfy_get_current_workbench')
  assert.equal(updatedWorkbench.requestBody.prompt, 'teal, remote block, agent custom')
  assert.equal(
    (
      await member.request('/workbench/generate-current', {
        method: 'POST',
        body: JSON.stringify({ width: 999 }),
      })
    ).status,
    400,
  )
  const currentGeneration = await mcp.call('comfy_generate_current_workbench')
  assert.equal(currentGeneration.png_preset_written, true)
  assert.equal(currentGeneration.historyItem.submittedBy, 'linux-agent-test')
  assert.equal(currentGeneration.historyItem.source, 'agent-current-workbench')
  assert.deepEqual(currentGeneration.selectedBlockIds, [mcpBlock.block.id])
  assert.equal(lastTxt2ImgBody.prompt, 'teal, remote block, agent custom')
  assert.equal(lastTxt2ImgBody.upscale_scale, 1.5)
  assert.equal(lastTxt2ImgBody.upscale_stages, 1)
  assert.equal(lastTxt2ImgBody.second_seed, 1234)
  assert.equal(lastTxt2ImgBody.second_steps, 10)
  assert.equal(lastTxt2ImgBody.second_denoise, 0.4)

  const mossUi = (await owner.request('/workbench/ui-state')).data
  for (const method of ['none', 'omnisr', 'seedvr2']) {
    const savedMoss = await owner.request('/workbench/ui-state', {
      method: 'POST',
      body: JSON.stringify({ ...mossUi, generationDraft: {
        ...mossUi.generationDraft, model: 'moss_image_sft_dmd8',
        mossUpscale: { method, scale: 3, resolution: 1536, maxResolution: 0 },
      } }),
    })
    assert.equal(savedMoss.status, 200)
    const view = await mcp.call('comfy_get_current_workbench')
    assert.equal(view.generationDraft.mossUpscale.method, method)
    assert.equal(view.requestBody.upscale_method, method)
    assert.equal(view.requestBody.second_steps, undefined)
    assert.equal(view.requestBody.third_steps, undefined)
    assert.equal(view.requestBody.upscale_mode, undefined)
    if (method === 'seedvr2') {
      assert.equal(view.requestBody.seedvr2_resolution, 1536)
      assert.equal(view.requestBody.seedvr2_max_resolution, 0)
    }
    if (method === 'omnisr') assert.equal(view.requestBody.upscale_scale, 3)
  }

  for (const dmd of [false, true]) {
    for (const faceRedraw of [false, true]) {
      const response = await owner.request('/workbench/ui-state', {
        method: 'POST', body: JSON.stringify({ ...mossUi, generationDraft: {
          ...mossUi.generationDraft, model: 'moss_image_sft', faceDetail: faceRedraw, mossOptions: { dmd, faceRedraw },
        } }),
      })
      assert.equal(response.status, 200)
      const current = (await owner.request('/workbench/current')).data
      assert.equal(current.requestBody.moss_dmd, dmd)
      assert.equal(current.requestBody.face_detail, faceRedraw)
      assert.deepEqual(current.generationDraft.mossOptions, { dmd, faceRedraw })
      const generatedMoss = await owner.request('/workbench/generate-current', { method: 'POST', body: '{}' })
      assert.equal(generatedMoss.status, 200)
      const savedPng = await owner.request('/png-preset/read', { method: 'POST', body: JSON.stringify({ imagePath: generatedPath }) })
      assert.deepEqual(savedPng.data.metadata.generationPreset.mossOptions, { dmd, faceRedraw })
      assert.equal(current.requestBody.second_steps, undefined)
    }
  }
  for (const model of ['krea2_turbo', 'dasiwa_krea2_turbo_raw', 'wai_anima_v10', 'miaomiao_harem']) {
    for (const faceDetail of [true, false]) {
      const response = await owner.request('/workbench/ui-state', { method: 'POST', body: JSON.stringify({ ...mossUi,
        generationDraft: { ...mossUi.generationDraft, model, faceDetail, faceParameters: { steps: 17, cfg: 2.5, denoise: 0.35 }, upscaleSteps: [kreaSingleUpscale] },
      }) })
      assert.equal(response.status, 200)
      const view = await mcp.call('comfy_get_current_workbench')
      assert.equal(view.generationDraft.faceDetail, faceDetail)
      assert.equal(view.requestBody.face_detail, faceDetail)
      assert.deepEqual(view.generationDraft.faceParameters, { steps: 17, cfg: 2.5, denoise: 0.35 })
      assert.equal(view.requestBody.face_denoise, faceDetail ? 0.35 : undefined)
      assert.equal(view.requestBody.face_steps, faceDetail ? 17 : undefined)
      assert.equal(view.requestBody.face_cfg, faceDetail ? 2.5 : undefined)
      assert.equal(view.requestBody.moss_dmd, undefined)
    }
  }
  mcp.child.kill()
  await once(mcp.child, 'exit')
  await closeServer(shareServer)
  serverModule.closeComfyServices()

  serverModule = await import(`../server/comfy-server.mjs?remote-test=restart`)
  shareServer = serverModule.createStaticShareServer({ host: '127.0.0.1', port: 0, distDir: path.join(repoRoot, 'dist') })
  sharePort = await listen(shareServer)
  baseUrl = `http://127.0.0.1:${sharePort}`
  const afterRestart = new SessionClient(baseUrl)
  await afterRestart.login(memberKey)
  const recoveredUiState = await afterRestart.request('/workbench/ui-state')
  assert.equal(recoveredUiState.data.generationDraft.customPositivePrompt, 'agent custom')
  const recovered = await afterRestart.request('/workbench/blocks?query=Remote%20uploaded%20block')
  assert.equal(recovered.status, 200)
  assert.equal(recovered.data.blocks[0].previewSourceImagePath, undefined)
  assert.match(recovered.data.blocks[0].previewSourceImageUrl, /^\/preview-cache\/source-/)
  assert.equal((await afterRestart.request(recovered.data.blocks[0].previewImage)).status, 200)
  const authProbe = new SessionClient(baseUrl)
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await authProbe.request('/share-auth/unlock', { method: 'POST', body: JSON.stringify({ key: 'invalid-test-key' }) })
    assert.equal(result.status, attempt < 5 ? 401 : 423)
    assert.equal(result.data.attemptsRemaining, 5 - attempt)
    assert.equal(result.data.lockSeconds > 0, attempt === 5)
  }
  assert.equal((await authProbe.request('/share-auth/status')).data.locked, true)
  await authProbe.login(ownerKey)
  assert.equal((await authProbe.request('/share-auth/status')).data.locked, false)
  const resetFailure = await authProbe.request('/share-auth/unlock', { method: 'POST', body: JSON.stringify({ key: 'invalid-test-key' }) })
  assert.equal(resetFailure.data.attemptsRemaining, 4)
  let throttled
  for (let attempt = 0; attempt < 21; attempt += 1) {
    throttled = await authProbe.request('/share-auth/unlock', { method: 'POST', body: JSON.stringify({ key: 'invalid-test-key' }) })
    if (throttled.status === 429) break
  }
  assert.equal(throttled.status, 429)
  assert.ok(throttled.data.retryAfter > 0 && throttled.data.retryAfter <= 60)
})
