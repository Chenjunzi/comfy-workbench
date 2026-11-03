import crypto from 'node:crypto'
import { normalizeMossUpscale, normalizeMossGeneration } from '../shared/moss.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'

export const defaultCategories = [
  { id: 'character', name: '人物', description: '角色身份、外貌特征与人物 LoRA' },
  { id: 'outfit', name: '服装', description: '服装、制服、配饰与穿着材质' },
  { id: 'pose', name: '姿势', description: '通用姿态、动作与身体朝向' },
  { id: 'background', name: '背景', description: '地点、环境、天气与场景布置' },
  { id: 'style', name: '画风', description: '画风、渲染质感与全局风格 LoRA' },
  { id: 'negative', name: '负面词', description: '排除缺陷、构图问题与不需要的内容' },
]

export class WorkbenchConflictError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'WorkbenchConflictError'
    this.details = details
  }
}

const now = () => Date.now()
const isoNow = () => new Date().toISOString()
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex')
const makeToken = () => `cwui_${crypto.randomBytes(30).toString('base64url')}`

const parseJson = (text, fallback) => {
  try {
    return text ? JSON.parse(text) : fallback
  } catch {
    return fallback
  }
}

const withDefaultCategories = (categories) => {
  const source = Array.isArray(categories) ? categories : []
  const merged = [...source]
  for (const category of defaultCategories) {
    if (!merged.some((item) => item && typeof item === 'object' && item.id === category.id)) merged.push(category)
  }
  return merged
}

const sanitizePreviewImage = (previewImage) => {
  if (typeof previewImage !== 'string') return ''
  if (previewImage.startsWith('data:') && previewImage.length > 240_000) return ''
  if (/^https?:\/\//i.test(previewImage)) return ''
  return previewImage
}

const sanitizeBlocks = (blocks) => {
  if (!Array.isArray(blocks)) return []
  return blocks.map((block) => {
    if (!block || typeof block !== 'object') return block
    return {
      ...block,
      previewImage: sanitizePreviewImage(block.previewImage),
    }
  })
}

const emptySharedContent = () => ({
  categories: defaultCategories,
  blocks: [],
  baseModelProfiles: {},
  generationPresets: [],
  updatedAt: now(),
  revision: 0,
})

const normalizeSharedContent = (payload = {}) => ({
  categories: withDefaultCategories(payload.categories),
  blocks: sanitizeBlocks(payload.blocks),
  baseModelProfiles: payload.baseModelProfiles && typeof payload.baseModelProfiles === 'object' ? payload.baseModelProfiles : {},
  generationPresets: Array.isArray(payload.generationPresets) ? payload.generationPresets : [],
  updatedAt: Number(payload.updatedAt || now()),
  revision: Number(payload.revision || 0),
})

const normalizeUpscaleStep = (step = {}, index = 0) => ({
  id: String(step.id || `upscale_${index + 1}`).slice(0, 80),
  enabled: step.enabled !== false,
  scale: Number.isFinite(Number(step.scale)) ? Number(step.scale) : 2,
  steps: Number.isFinite(Number(step.steps)) ? Number(step.steps) : 10,
  cfg: Number.isFinite(Number(step.cfg)) ? Number(step.cfg) : 6,
  denoise: Number.isFinite(Number(step.denoise)) ? Number(step.denoise) : 0.2,
  sampler: String(step.sampler ?? 'euler_ancestral').slice(0, 80),
  scheduler: String(step.scheduler ?? 'normal').slice(0, 80),
})

const finiteNumberOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

const normalizeGenerationDraft = (draft) => {
  if (!draft || typeof draft !== 'object') return undefined
  draft = normalizeMossGeneration(draft)
  return {
    gatewayUrl: String(draft.gatewayUrl || '/gateway').slice(0, 512),
    positivePrefix: String(draft.positivePrefix || '').slice(0, 32768),
    negativePrefix: String(draft.negativePrefix || '').slice(0, 32768),
    customPositivePrompt: String(draft.customPositivePrompt || '').slice(0, 32768),
    model: String(draft.model || '').slice(0, 512),
    preset: String(draft.preset || 'anime_manga_fast').slice(0, 160),
    filenamePrefix: String(draft.filenamePrefix || 'Preset/%character%/%date:yyyyMMddhhmmss%').slice(0, 512),
    width: Math.max(64, Math.min(16384, finiteNumberOr(draft.width, 480))),
    height: Math.max(64, Math.min(16384, finiteNumberOr(draft.height, 832))),
    steps: Math.max(1, Math.min(1000, finiteNumberOr(draft.steps, 24))),
    cfg: Math.max(0, Math.min(100, finiteNumberOr(draft.cfg, 5))),
    seed: String(draft.seed || '').slice(0, 64),
    sampler: String(draft.sampler || 'euler').slice(0, 80),
    scheduler: String(draft.scheduler || 'normal').slice(0, 80),
    upscaleSteps: Array.isArray(draft.upscaleSteps) ? draft.upscaleSteps.slice(0, 8).map(normalizeUpscaleStep) : [],
    mossUpscale: normalizeMossUpscale(draft.mossUpscale),
    mossOptions: draft.mossOptions,
    faceDetail: draft.faceDetail,
    faceParameters: draft.faceParameters && typeof draft.faceParameters === 'object' ? Object.fromEntries(['steps', 'cfg', 'denoise', 'sampler', 'scheduler'].filter((key) => draft.faceParameters[key] !== undefined).map((key) => [key, ['sampler', 'scheduler'].includes(key) ? String(draft.faceParameters[key]).slice(0, 80) : Number(draft.faceParameters[key])])) : undefined,
  }
}

const normalizeUiState = (payload = {}) => ({
  selectedBlockIds: Array.isArray(payload.selectedBlockIds) ? payload.selectedBlockIds.map(String).filter(Boolean) : [],
  selectedColorPrompts: Array.isArray(payload.selectedColorPrompts) ? payload.selectedColorPrompts.map(String).filter(Boolean) : [],
  ...(payload.generationDraft && typeof payload.generationDraft === 'object'
    ? { generationDraft: normalizeGenerationDraft(payload.generationDraft) }
    : {}),
  revision: Number(payload.revision || 0),
  updatedAt: Number(payload.updatedAt || now()),
})

const normalizeGenerationState = (payload = {}) => ({
  active: Boolean(payload.active),
  phase: payload.phase ? String(payload.phase) : undefined,
  owner: payload.owner ? String(payload.owner) : undefined,
  actorName: payload.actorName ? String(payload.actorName) : undefined,
  source: payload.source ? String(payload.source) : undefined,
  createdAt: payload.createdAt ? String(payload.createdAt) : undefined,
  dryRun: payload.dryRun === undefined ? undefined : Boolean(payload.dryRun),
  prompt: payload.prompt ? String(payload.prompt) : undefined,
  model: payload.model ? String(payload.model) : undefined,
  width: Number.isFinite(Number(payload.width)) ? Number(payload.width) : undefined,
  height: Number.isFinite(Number(payload.height)) ? Number(payload.height) : undefined,
  queueLength: Number.isFinite(Number(payload.queueLength)) ? Number(payload.queueLength) : undefined,
  updatedAt: Number(payload.updatedAt || now()),
})

const makeCategoryId = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)

const makeBlockId = (state, categoryId, name) => {
  const base =
    `${categoryId}_${name}`
      .toLowerCase()
      .replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/gu, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || `${categoryId}_block`
  const used = new Set(state.blocks.map((block) => block.id))
  let id = base
  let index = 2
  while (used.has(id)) {
    id = `${base}_${index}`
    index += 1
  }
  return id
}

export class WorkbenchStore {
  constructor({ dataDir, legacySharedStateFile, dbFile, accessKeysFile, backupDir, previewCacheDir } = {}) {
    this.dataDir = dataDir
    this.legacySharedStateFile = legacySharedStateFile
    this.dbFile = dbFile || path.join(dataDir, 'workbench.sqlite')
    this.accessKeysFile = accessKeysFile || path.join(dataDir, 'access-keys.txt')
    this.backupDir = backupDir || path.join(dataDir, 'backups')
    this.previewCacheDir = previewCacheDir || path.join(dataDir, 'preview-cache')
    this.backupInFlight = null
    fs.mkdirSync(dataDir, { recursive: true })
    this.db = new DatabaseSync(this.dbFile)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.initSchema()
    this.migrateLegacySharedState()
    this.migrateNormalizedSharedState()
    this.ensureInitialAccessKey()
    this.compactLegacyOperationLog()
    this.pruneOperationLog()
    void this.createScheduledBackupIfDue().catch((error) => {
      console.error(`[backup] scheduled backup failed: ${error instanceof Error ? error.message : error}`)
    })
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        key TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'member',
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS access_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        workspace_owner_id TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS ui_states (
        owner_id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS generation_history (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        actor_id TEXT,
        actor_name TEXT
      );
      CREATE TABLE IF NOT EXISTS operation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        actor_id TEXT,
        actor_name TEXT,
        type TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        before_json TEXT,
        after_json TEXT,
        details_json TEXT
      );
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        position INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY,
        category_id TEXT NOT NULL REFERENCES categories(id) ON UPDATE CASCADE,
        json TEXT NOT NULL,
        position INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS preview_variants (
        id TEXT PRIMARY KEY,
        block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE ON UPDATE CASCADE,
        base_model TEXT NOT NULL,
        json TEXT NOT NULL,
        position INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS generation_presets (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        position INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS blocks_category_position_idx ON blocks(category_id, position);
      CREATE INDEX IF NOT EXISTS preview_variants_block_position_idx ON preview_variants(block_id, position);
      CREATE INDEX IF NOT EXISTS generation_presets_position_idx ON generation_presets(position);
    `)
    const userColumns = this.db.prepare('PRAGMA table_info(users)').all()
    if (!userColumns.some((column) => column.name === 'role')) {
      this.db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'")
    }
    const accessKeyColumns = this.db.prepare('PRAGMA table_info(access_keys)').all()
    if (!accessKeyColumns.some((column) => column.name === 'workspace_owner_id')) {
      this.db.exec('ALTER TABLE access_keys ADD COLUMN workspace_owner_id TEXT')
    }
    const uiStateColumns = this.db.prepare('PRAGMA table_info(ui_states)').all()
    if (!uiStateColumns.some((column) => column.name === 'revision')) {
      this.db.exec('ALTER TABLE ui_states ADD COLUMN revision INTEGER NOT NULL DEFAULT 0')
    }
    this.db.prepare('UPDATE access_keys SET workspace_owner_id = user_id WHERE workspace_owner_id IS NULL OR workspace_owner_id = ?').run('')
    this.db.prepare("UPDATE users SET role = 'owner' WHERE name = 'owner'").run()
  }

  document(key, fallback) {
    const row = this.db.prepare('SELECT json, revision, updated_at FROM documents WHERE key = ?').get(key)
    if (!row) return { ...fallback, revision: 0, updatedAt: now() }
    return { ...parseJson(row.json, fallback), revision: Number(row.revision || 0), updatedAt: Number(row.updated_at || now()) }
  }

  setDocument(key, value) {
    const existing = this.db.prepare('SELECT revision FROM documents WHERE key = ?').get(key)
    const revision = Number(existing?.revision || 0) + 1
    const updatedAt = now()
    const next = { ...value, updatedAt, revision }
    this.db
      .prepare(
        `INSERT INTO documents (key, json, revision, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET json = excluded.json, revision = excluded.revision, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(next), revision, updatedAt)
    return next
  }

  migrateLegacySharedState() {
    const existing = this.db.prepare('SELECT key FROM documents WHERE key = ?').get('shared_content')
    if (existing) return
    let state = emptySharedContent()
    if (this.legacySharedStateFile && fs.existsSync(this.legacySharedStateFile)) {
      state = normalizeSharedContent(parseJson(fs.readFileSync(this.legacySharedStateFile, 'utf8'), state))
    }
    this.setDocument('shared_content', state)
    this.setDocument('generation_state', { active: false, updatedAt: now() })
  }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  migrateNormalizedSharedState() {
    const existing = this.db.prepare('SELECT id FROM categories LIMIT 1').get()
    if (existing) return
    const legacy = normalizeSharedContent(this.document('shared_content', emptySharedContent()))
    this.replaceNormalizedContent(legacy, false)
  }

  stripEntityMeta(value = {}) {
    const next = { ...value }
    delete next.revision
    delete next.updatedAt
    delete next.position
    return next
  }

  replacePreviewVariants(blockId, variants = []) {
    const existingById = new Map(
      this.db
        .prepare('SELECT id, json, revision FROM preview_variants WHERE block_id = ?')
        .all(blockId)
        .map((row) => [row.id, row]),
    )
    this.db.prepare('DELETE FROM preview_variants WHERE block_id = ?').run(blockId)
    const insert = this.db.prepare(
      'INSERT INTO preview_variants (id, block_id, base_model, json, position, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    const timestamp = now()
    variants.forEach((variant, index) => {
      const clean = this.stripEntityMeta(variant)
      const id = String(clean.id || `preview_${crypto.randomUUID()}`)
      const json = JSON.stringify(clean)
      const existing = existingById.get(id)
      const revision = existing ? Number(existing.revision || 1) + (existing.json === json ? 0 : 1) : Number(variant.revision || 1)
      insert.run(id, blockId, String(clean.baseModel || 'none'), json, index, revision, timestamp)
    })
  }

  writeBlockRow(block, position, revision = 1) {
    const clean = this.stripEntityMeta(block)
    const variants = Array.isArray(clean.previewVariants) ? clean.previewVariants : []
    delete clean.previewVariants
    this.db
      .prepare(
        `INSERT INTO blocks (id, category_id, json, position, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, json = excluded.json, position = excluded.position,
           revision = excluded.revision, updated_at = excluded.updated_at`,
      )
      .run(clean.id, clean.categoryId, JSON.stringify(clean), position, revision, now())
    this.replacePreviewVariants(clean.id, variants)
  }

  replaceNormalizedContent(payload, bumpRevision = true) {
    const state = normalizeSharedContent(payload)
    return this.transaction(() => {
      this.db.prepare('DELETE FROM preview_variants').run()
      this.db.prepare('DELETE FROM blocks').run()
      this.db.prepare('DELETE FROM categories').run()
      this.db.prepare('DELETE FROM generation_presets').run()
      const categoryInsert = this.db.prepare(
        'INSERT INTO categories (id, name, description, position, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      state.categories.forEach((category, index) =>
        categoryInsert.run(category.id, category.name, category.description || null, index, Number(category.revision || 1), now()),
      )
      state.blocks.forEach((block, index) => this.writeBlockRow(block, index, Number(block.revision || 1)))
      const presetInsert = this.db.prepare(
        'INSERT INTO generation_presets (id, json, position, revision, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      state.generationPresets.forEach((preset, index) => {
        const clean = this.stripEntityMeta(preset)
        presetInsert.run(clean.id, JSON.stringify(clean), index, Number(preset.revision || 1), now())
      })
      this.setDocument('base_model_profiles', { profiles: state.baseModelProfiles })
      if (bumpRevision || !this.db.prepare("SELECT key FROM documents WHERE key = 'shared_meta'").get()) this.bumpSharedMeta()
      return this.readSharedContent()
    })
  }

  ensureInitialAccessKey() {
    const row = this.db.prepare('SELECT id FROM access_keys WHERE active = 1 LIMIT 1').get()
    if (row) return
    const existingOwner = this.db.prepare("SELECT id FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1").get()
    const userId = existingOwner?.id || `user_${crypto.randomUUID()}`
    const keyId = `key_${crypto.randomUUID()}`
    const token = makeToken()
    const createdAt = now()
    if (!existingOwner) {
      this.db.prepare("INSERT INTO users (id, name, role, active, created_at) VALUES (?, ?, 'owner', 1, ?)").run(userId, 'owner', createdAt)
    } else {
      this.db.prepare("UPDATE users SET active = 1, role = 'owner' WHERE id = ?").run(userId)
    }
    this.db
      .prepare('INSERT INTO access_keys (id, user_id, name, key_hash, key_prefix, workspace_owner_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
      .run(keyId, userId, 'owner-default', sha256(token), token.slice(0, 12), userId, createdAt)
    fs.mkdirSync(path.dirname(this.accessKeysFile), { recursive: true })
    fs.appendFileSync(
      this.accessKeysFile,
      [
        `# Comfy Preset Workflow UI access keys`,
        `# Created: ${isoNow()}`,
        `# Keep this file private. The web UI no longer uses the old 6-digit PIN.`,
        `owner owner-default ${token}`,
        ``,
      ].join('\n'),
      'utf8',
    )
  }

  verifyAccessKey(token) {
    const key = String(token || '').trim()
    if (!key) return null
    const row = this.db
      .prepare(
        `SELECT access_keys.id AS key_id, access_keys.name AS key_name, access_keys.workspace_owner_id,
                users.id AS user_id, users.name AS user_name, users.role AS user_role
         FROM access_keys
         JOIN users ON users.id = access_keys.user_id
         WHERE access_keys.key_hash = ? AND access_keys.active = 1 AND users.active = 1`,
      )
      .get(sha256(key))
    if (!row) return null
    this.db.prepare('UPDATE access_keys SET last_used_at = ? WHERE id = ?').run(now(), row.key_id)
    return {
      userId: row.user_id,
      userName: row.user_name,
      role: row.user_role || 'member',
      keyId: row.key_id,
      keyName: row.key_name,
      workspaceOwnerId: row.workspace_owner_id || row.user_id,
    }
  }

  listUsers() {
    return this.db.prepare('SELECT id, name, role, active, created_at AS createdAt FROM users ORDER BY created_at ASC').all()
  }

  listAccessKeys() {
    return this.db
      .prepare(
        `SELECT access_keys.id, users.name AS userName, users.role, access_keys.name, access_keys.key_prefix AS keyPrefix,
                access_keys.workspace_owner_id AS workspaceOwnerId,
                access_keys.active, access_keys.created_at AS createdAt, access_keys.last_used_at AS lastUsedAt
         FROM access_keys JOIN users ON users.id = access_keys.user_id
         ORDER BY access_keys.created_at ASC`,
      )
      .all()
  }

  createAccessKey({ userName = 'guest', keyName = 'shared', role = 'member', bindToOwnerWorkspace = false } = {}, actor = {}) {
    const cleanUserName = String(userName || 'guest').trim().slice(0, 64) || 'guest'
    const cleanKeyName = String(keyName || 'shared').trim().slice(0, 64) || 'shared'
    const cleanRole = role === 'owner' ? 'owner' : 'member'
    let user = this.db.prepare('SELECT id, role FROM users WHERE name = ?').get(cleanUserName)
    if (!user) {
      const userId = `user_${crypto.randomUUID()}`
      this.db.prepare('INSERT INTO users (id, name, role, active, created_at) VALUES (?, ?, ?, 1, ?)').run(userId, cleanUserName, cleanRole, now())
      user = { id: userId, role: cleanRole }
    }
    const token = makeToken()
    const keyId = `key_${crypto.randomUUID()}`
    const workspaceOwnerId = bindToOwnerWorkspace && actor.role === 'owner' ? actor.userId : user.id
    this.db
      .prepare('INSERT INTO access_keys (id, user_id, name, key_hash, key_prefix, workspace_owner_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
      .run(keyId, user.id, cleanKeyName, sha256(token), token.slice(0, 12), workspaceOwnerId, now())
    const result = { id: keyId, userName: cleanUserName, role: user.role || cleanRole, name: cleanKeyName, key: token, keyPrefix: token.slice(0, 12), workspaceOwnerId }
    this.logOperation(actor, 'access_key.create', 'access_key', keyId, null, { ...result, key: undefined }, {})
    return result
  }

  bindAccessKeyWorkspace(keyId, workspaceOwnerId, actor = {}) {
    const cleanKeyId = String(keyId || '').trim()
    const cleanWorkspaceOwnerId = String(workspaceOwnerId || '').trim()
    const current = this.db
      .prepare('SELECT id, user_id AS userId, workspace_owner_id AS workspaceOwnerId FROM access_keys WHERE id = ?')
      .get(cleanKeyId)
    if (!current) throw new Error(`Unknown access key: ${cleanKeyId}`)
    if (!this.db.prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(cleanWorkspaceOwnerId)) {
      throw new Error(`Unknown workspace owner: ${cleanWorkspaceOwnerId}`)
    }
    this.db.prepare('UPDATE access_keys SET workspace_owner_id = ? WHERE id = ?').run(cleanWorkspaceOwnerId, cleanKeyId)
    const next = { ...current, workspaceOwnerId: cleanWorkspaceOwnerId }
    this.logOperation(actor, 'access_key.workspace.bind', 'access_key', cleanKeyId, current, next, {})
    return next
  }

  revokeAccessKey(keyId, actor = {}) {
    const current = this.db
      .prepare('SELECT access_keys.id, access_keys.name, users.name AS userName, users.role FROM access_keys JOIN users ON users.id = access_keys.user_id WHERE access_keys.id = ?')
      .get(String(keyId || '').trim())
    if (!current) throw new Error(`Unknown access key: ${keyId}`)
    if (current.role === 'owner') {
      const activeOwnerKeys = Number(
        this.db
          .prepare("SELECT count(*) AS count FROM access_keys JOIN users ON users.id = access_keys.user_id WHERE access_keys.active = 1 AND users.active = 1 AND users.role = 'owner'")
          .get().count,
      )
      if (activeOwnerKeys <= 1) throw new Error('Cannot revoke the last active owner key')
    }
    this.db.prepare('UPDATE access_keys SET active = 0 WHERE id = ?').run(current.id)
    this.logOperation(actor, 'access_key.revoke', 'access_key', current.id, current, { ...current, active: 0 }, {})
    return { ...current, active: 0 }
  }

  readSharedContent() {
    const categories = this.db
      .prepare('SELECT id, name, description, revision, updated_at AS updatedAt FROM categories ORDER BY position, id')
      .all()
      .map((row) => ({ ...row, description: row.description || undefined }))
    const variantsByBlock = new Map()
    for (const row of this.db
      .prepare('SELECT id, block_id AS blockId, json, revision, updated_at AS updatedAt FROM preview_variants ORDER BY block_id, position, id')
      .all()) {
      const variant = { ...parseJson(row.json, {}), id: row.id, revision: row.revision, updatedAt: row.updatedAt }
      const items = variantsByBlock.get(row.blockId) || []
      items.push(variant)
      variantsByBlock.set(row.blockId, items)
    }
    const blocks = this.db
      .prepare('SELECT id, category_id AS categoryId, json, revision, updated_at AS updatedAt FROM blocks ORDER BY position, id')
      .all()
      .map((row) => ({
        ...parseJson(row.json, {}),
        id: row.id,
        categoryId: row.categoryId,
        previewVariants: variantsByBlock.get(row.id) || undefined,
        revision: row.revision,
        updatedAt: row.updatedAt,
      }))
    const generationPresets = this.db
      .prepare('SELECT id, json, revision, updated_at AS updatedAt FROM generation_presets ORDER BY position, id')
      .all()
      .map((row) => ({ ...parseJson(row.json, {}), id: row.id, revision: row.revision, updatedAt: row.updatedAt }))
    const profiles = this.document('base_model_profiles', { profiles: {} })
    const meta = this.document('shared_meta', {})
    return {
      categories,
      blocks,
      baseModelProfiles: profiles.profiles && typeof profiles.profiles === 'object' ? profiles.profiles : {},
      baseModelProfilesRevision: profiles.revision,
      generationPresets,
      updatedAt: meta.updatedAt,
      revision: meta.revision,
    }
  }

  replaceSharedContent(payload, actor = {}, details = {}) {
    const before = this.readSharedContent()
    const next = this.replaceNormalizedContent(payload)
    this.logOperation(
      actor,
      'shared_content.replace',
      'shared_content',
      'shared_content',
      { revision: before.revision, categories: before.categories.length, blocks: before.blocks.length, generationPresets: before.generationPresets.length },
      { revision: next.revision, categories: next.categories.length, blocks: next.blocks.length, generationPresets: next.generationPresets.length },
      details,
    )
    return next
  }

  bumpSharedMeta() {
    return this.setDocument('shared_meta', {})
  }

  assertEntityRevision(entity, payload, targetType, targetId) {
    const baseRevision = Number(payload.baseRevision || 0)
    const currentRevision = Number(entity?.revision || 0)
    if (!payload.force && baseRevision && currentRevision && baseRevision !== currentRevision) {
      throw new WorkbenchConflictError(`${targetType} revision conflict`, {
        targetType,
        targetId,
        baseRevision,
        currentRevision,
        currentEntity: entity,
      })
    }
  }

  operationDetails(payload = {}) {
    const details = { ...payload }
    delete details.block
    delete details.category
    delete details.preset
    delete details.patch
    delete details.baseModelProfiles
    return details
  }

  readCategory(id) {
    const row = this.db.prepare('SELECT id, name, description, position, revision, updated_at AS updatedAt FROM categories WHERE id = ?').get(id)
    return row ? { ...row, description: row.description || undefined } : null
  }

  readBlock(id) {
    const row = this.db.prepare('SELECT id, category_id AS categoryId, json, position, revision, updated_at AS updatedAt FROM blocks WHERE id = ?').get(id)
    if (!row) return null
    const previewVariants = this.db
      .prepare('SELECT id, json, revision, updated_at AS updatedAt FROM preview_variants WHERE block_id = ? ORDER BY position, id')
      .all(id)
      .map((variant) => ({ ...parseJson(variant.json, {}), id: variant.id, revision: variant.revision, updatedAt: variant.updatedAt }))
    return { ...parseJson(row.json, {}), id: row.id, categoryId: row.categoryId, previewVariants: previewVariants.length ? previewVariants : undefined, position: row.position, revision: row.revision, updatedAt: row.updatedAt }
  }

  readGenerationPreset(id) {
    const row = this.db.prepare('SELECT id, json, position, revision, updated_at AS updatedAt FROM generation_presets WHERE id = ?').get(id)
    return row ? { ...parseJson(row.json, {}), id: row.id, position: row.position, revision: row.revision, updatedAt: row.updatedAt } : null
  }

  moveEntity(table, id, requestedIndex) {
    const rows = this.db.prepare(`SELECT id FROM ${table} ORDER BY position, id`).all().map((row) => row.id)
    const fromIndex = rows.indexOf(id)
    if (fromIndex < 0) throw new Error(`Unknown ${table} entity: ${id}`)
    const [moved] = rows.splice(fromIndex, 1)
    const targetIndex = Math.max(0, Math.min(rows.length, Math.round(Number(requestedIndex) || 0)))
    rows.splice(targetIndex, 0, moved)
    const update = this.db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`)
    rows.forEach((rowId, index) => update.run(index, rowId))
    return targetIndex
  }

  mutateSharedContent(type, payload = {}, actor = {}) {
    return this.transaction(() => {
      let before = null
      let after = null
      let targetType = type.split('.')[0]
      let targetId = String(payload.id || payload.categoryId || payload.name || '').trim()
      switch (type) {
      case 'category.create': {
        const source = payload.category && typeof payload.category === 'object' ? payload.category : payload
        const name = String(source.name || '新类目').trim() || '新类目'
        let id = makeCategoryId(source.id || name) || 'category'
        const used = new Set(this.db.prepare('SELECT id FROM categories').all().map((row) => row.id))
        let index = 2
        while (used.has(id)) {
          id = `${id}_${index}`
          index += 1
        }
        const count = Number(this.db.prepare('SELECT count(*) AS count FROM categories').get().count)
        const insertIndex = Number.isFinite(Number(payload.index)) ? Math.max(0, Math.min(count, Number(payload.index))) : count
        this.db.prepare('UPDATE categories SET position = position + 1 WHERE position >= ?').run(insertIndex)
        this.db.prepare('INSERT INTO categories (id, name, description, position, revision, updated_at) VALUES (?, ?, ?, ?, 1, ?)').run(id, name, String(source.description || '').trim() || null, insertIndex, now())
        targetId = id
        before = null
        after = this.readCategory(id)
        break
      }
      case 'category.update': {
        const id = String(payload.id || '').trim()
        const current = this.readCategory(id)
        if (!current) throw new Error(`Unknown category: ${id}`)
        this.assertEntityRevision(current, payload, 'category', id)
        const source = payload.category && typeof payload.category === 'object' ? payload.category : payload.patch && typeof payload.patch === 'object' ? payload.patch : payload
        const newId = source.newId ? makeCategoryId(source.newId) : source.id && source.id !== id ? makeCategoryId(source.id) : id
        if (newId !== id && this.readCategory(newId)) throw new Error(`Category already exists: ${newId}`)
        const name = source.name === undefined ? current.name : String(source.name || '').trim() || current.name
        const description = source.description === undefined ? current.description : String(source.description || '').trim() || null
        this.db.prepare('UPDATE categories SET id = ?, name = ?, description = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(newId || id, name, description || null, now(), id)
        targetId = newId || id
        before = current
        after = this.readCategory(targetId)
        break
      }
      case 'category.move': {
        const id = String(payload.id || '').trim()
        const current = this.readCategory(id)
        if (!current) throw new Error(`Unknown category: ${id}`)
        this.assertEntityRevision(current, payload, 'category', id)
        before = current
        this.moveEntity('categories', id, payload.index)
        this.db.prepare('UPDATE categories SET revision = revision + 1, updated_at = ? WHERE id = ?').run(now(), id)
        after = this.readCategory(id)
        break
      }
      case 'category.delete': {
        const id = String(payload.id || '').trim()
        const moveBlocksTo = String(payload.moveBlocksTo || '').trim()
        if (defaultCategories.some((category) => category.id === id)) throw new Error('Built-in categories cannot be deleted')
        const current = this.readCategory(id)
        if (!current) throw new Error(`Unknown category: ${id}`)
        this.assertEntityRevision(current, payload, 'category', id)
        if (moveBlocksTo) {
          if (!this.readCategory(moveBlocksTo)) throw new Error(`Unknown category: ${moveBlocksTo}`)
          this.db.prepare('UPDATE blocks SET category_id = ?, revision = revision + 1, updated_at = ? WHERE category_id = ?').run(moveBlocksTo, now(), id)
        }
        if (this.db.prepare('SELECT id FROM blocks WHERE category_id = ? LIMIT 1').get(id)) throw new Error('Category is not empty')
        before = current
        this.db.prepare('DELETE FROM categories WHERE id = ?').run(id)
        after = null
        break
      }
      case 'block.create': {
        const source = payload.block && typeof payload.block === 'object' ? payload.block : payload
        const categoryId = String(source.categoryId || '').trim()
        if (!this.readCategory(categoryId)) throw new Error(`Unknown category: ${categoryId}`)
        const state = this.readSharedContent()
        const name = String(source.name || '新预制块').trim() || '新预制块'
        const id = String(source.id || '').trim() || makeBlockId(state, categoryId, name)
        if (this.readBlock(id)) throw new Error(`Block already exists: ${id}`)
        const count = Number(this.db.prepare('SELECT count(*) AS count FROM blocks').get().count)
        const insertIndex = Number.isFinite(Number(payload.index)) ? Math.max(0, Math.min(count, Number(payload.index))) : count
        this.db.prepare('UPDATE blocks SET position = position + 1 WHERE position >= ?').run(insertIndex)
        const block = {
          ...source,
          id,
          categoryId,
          name,
          enabled: source.enabled === undefined ? true : Boolean(source.enabled),
          positive: Array.isArray(source.positive) ? source.positive.map(String).filter(Boolean) : [],
          negative: Array.isArray(source.negative) ? source.negative.map(String).filter(Boolean) : [],
          loras: Array.isArray(source.loras) ? source.loras : [],
          tags: Array.isArray(source.tags) ? source.tags.map(String).filter(Boolean) : [],
          notes: String(source.notes || ''),
          previewImage: sanitizePreviewImage(source.previewImage),
        }
        this.writeBlockRow(block, insertIndex, 1)
        targetId = id
        before = null
        after = this.readBlock(id)
        break
      }
      case 'block.update': {
        const id = String(payload.id || '').trim()
        const current = this.readBlock(id)
        if (!current) throw new Error(`Unknown block: ${id}`)
        this.assertEntityRevision(current, payload, 'block', id)
        const patch = payload.block && typeof payload.block === 'object' ? payload.block : payload.patch && typeof payload.patch === 'object' ? payload.patch : { ...payload }
        delete patch.baseRevision
        delete patch.force
        if (patch.previewImage !== undefined) patch.previewImage = sanitizePreviewImage(patch.previewImage)
        const next = { ...current, ...patch, id }
        if (!this.readCategory(next.categoryId)) throw new Error(`Unknown category: ${next.categoryId}`)
        before = current
        this.writeBlockRow(next, current.position, current.revision + 1)
        after = this.readBlock(id)
        break
      }
      case 'block.delete': {
        const id = String(payload.id || '').trim()
        const current = this.readBlock(id)
        if (!current) throw new Error(`Unknown block: ${id}`)
        this.assertEntityRevision(current, payload, 'block', id)
        before = current
        this.db.prepare('DELETE FROM blocks WHERE id = ?').run(id)
        after = null
        break
      }
      case 'block.move': {
        const id = String(payload.id || '').trim()
        const current = this.readBlock(id)
        if (!current) throw new Error(`Unknown block: ${id}`)
        this.assertEntityRevision(current, payload, 'block', id)
        before = current
        this.moveEntity('blocks', id, payload.index)
        this.db.prepare('UPDATE blocks SET revision = revision + 1, updated_at = ? WHERE id = ?').run(now(), id)
        after = this.readBlock(id)
        break
      }
      case 'generation_preset.create': {
        const preset = payload.preset
        if (!preset?.id) throw new Error('preset.id is required')
        if (this.readGenerationPreset(preset.id)) throw new Error(`Generation preset already exists: ${preset.id}`)
        const count = Number(this.db.prepare('SELECT count(*) AS count FROM generation_presets').get().count)
        const insertIndex = Number.isFinite(Number(payload.index)) ? Math.max(0, Math.min(count, Number(payload.index))) : 0
        this.db.prepare('UPDATE generation_presets SET position = position + 1 WHERE position >= ?').run(insertIndex)
        const clean = this.stripEntityMeta(preset)
        this.db.prepare('INSERT INTO generation_presets (id, json, position, revision, updated_at) VALUES (?, ?, ?, 1, ?)').run(clean.id, JSON.stringify(clean), insertIndex, now())
        targetId = clean.id
        before = null
        after = this.readGenerationPreset(clean.id)
        break
      }
      case 'generation_preset.update': {
        const preset = payload.preset
        if (!preset?.id) throw new Error('preset.id is required')
        const current = this.readGenerationPreset(preset.id)
        if (!current) throw new Error(`Unknown generation preset: ${preset.id}`)
        this.assertEntityRevision(current, payload, 'generation_preset', preset.id)
        const clean = this.stripEntityMeta(preset)
        before = current
        this.db.prepare('UPDATE generation_presets SET json = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(JSON.stringify(clean), now(), clean.id)
        targetId = clean.id
        after = this.readGenerationPreset(clean.id)
        break
      }
      case 'generation_preset.delete': {
        const id = String(payload.id || '').trim()
        const current = this.readGenerationPreset(id)
        if (!current) throw new Error(`Unknown generation preset: ${id}`)
        this.assertEntityRevision(current, payload, 'generation_preset', id)
        before = current
        this.db.prepare('DELETE FROM generation_presets WHERE id = ?').run(id)
        after = null
        break
      }
      case 'base_model_profiles.update': {
        const current = this.document('base_model_profiles', { profiles: {} })
        this.assertEntityRevision({ ...current, revision: current.revision }, payload, 'base_model_profiles', 'base_model_profiles')
        before = { profiles: current.profiles, revision: current.revision }
        const profiles = payload.replace
          ? payload.baseModelProfiles || {}
          : { ...(current.profiles || {}), ...(payload.baseModelProfiles || {}) }
        const saved = this.setDocument('base_model_profiles', { profiles })
        after = { profiles: saved.profiles, revision: saved.revision }
        targetId = 'base_model_profiles'
        break
      }
      default:
        throw new Error(`Unknown operation type: ${type}`)
      }
      const meta = this.bumpSharedMeta()
      this.logOperation(actor, type, targetType, targetId, before, after, this.operationDetails(payload))
      return { type, targetType, targetId, entity: after, deleted: after === null, sharedRevision: meta.revision, updatedAt: meta.updatedAt }
    })
  }

  readUiState(ownerId = 'default') {
    const row = this.db.prepare('SELECT json, revision, updated_at FROM ui_states WHERE owner_id = ?').get(ownerId)
    return row ? normalizeUiState({ ...parseJson(row.json, {}), revision: row.revision, updatedAt: row.updated_at }) : normalizeUiState()
  }

  setUiState(ownerId = 'default', payload = {}, actor = {}, log = true) {
    const before = this.readUiState(ownerId)
    const state = normalizeUiState({ ...payload, revision: Number(before.revision || 0) + 1, updatedAt: now() })
    this.db
      .prepare(
        `INSERT INTO ui_states (owner_id, json, revision, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(owner_id) DO UPDATE SET json = excluded.json, revision = excluded.revision, updated_at = excluded.updated_at`,
      )
      .run(ownerId, JSON.stringify(state), state.revision, state.updatedAt)
    if (log) this.logOperation(actor, 'ui_state.set', 'ui_state', ownerId, before, state, {})
    return state
  }

  mutateUiState(ownerId = 'default', type, payload = {}, actor = {}) {
    const before = this.readUiState(ownerId)
    const selected = new Set(before.selectedBlockIds)
    let ordered = [...before.selectedBlockIds]
    switch (type) {
      case 'selection.set':
        ordered = Array.isArray(payload.selectedBlockIds) ? payload.selectedBlockIds.map(String).filter(Boolean) : []
        break
      case 'selection.add':
        for (const id of Array.isArray(payload.blockIds) ? payload.blockIds : [payload.blockId]) {
          const clean = String(id || '').trim()
          if (clean && !selected.has(clean)) {
            selected.add(clean)
            ordered.push(clean)
          }
        }
        break
      case 'selection.remove':
        for (const id of Array.isArray(payload.blockIds) ? payload.blockIds : [payload.blockId]) selected.delete(String(id || '').trim())
        ordered = ordered.filter((id) => selected.has(id))
        break
      case 'selection.clear':
        ordered = []
        break
      case 'selection.move': {
        const fromId = String(payload.fromBlockId || '').trim()
        const toId = String(payload.toBlockId || '').trim()
        const fromIndex = ordered.indexOf(fromId)
        const toIndex = ordered.indexOf(toId)
        if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
          const [moved] = ordered.splice(fromIndex, 1)
          ordered.splice(toIndex, 0, moved)
        }
        break
      }
      case 'ui.custom_prompt.set': {
        if (!before.generationDraft) throw new Error('The current workbench has not published its generation parameters yet')
        const customPositivePrompt = String(payload.prompt || '').slice(0, 32768)
        const next = this.setUiState(
          ownerId,
          { ...before, generationDraft: { ...before.generationDraft, customPositivePrompt } },
          actor,
          false,
        )
        this.logOperation(actor, type, 'ui_state', ownerId, before, next, { customPositivePrompt })
        return next
      }
      default:
        throw new Error(`Unknown UI operation type: ${type}`)
      }
    const next = this.setUiState(ownerId, { ...before, selectedBlockIds: ordered }, actor, false)
    this.logOperation(actor, type, 'selection', ownerId, before, next, payload)
    return next
  }

  readGenerationState() {
    const state = normalizeGenerationState(this.document('generation_state', { active: false, updatedAt: now() }))
    const staleMinutes = Number(process.env.COMFY_PRESET_GENERATION_STALE_MINUTES || 180)
    if (state.active && Number.isFinite(staleMinutes) && staleMinutes > 0 && now() - Number(state.updatedAt || 0) > staleMinutes * 60 * 1000) {
      return { ...state, active: false, phase: 'idle', stale: true }
    }
    return state
  }

  setGenerationState(payload = {}, actor = {}) {
    const before = this.readGenerationState()
    const after = this.setDocument('generation_state', normalizeGenerationState(payload))
    this.logOperation(actor, 'generation_state.set', 'generation_state', 'current', before, after, {})
    return after
  }

  addGenerationHistory(item = {}, actor = {}) {
    const id = String(item.id || `history_${crypto.randomUUID()}`)
    const createdAt = now()
    const json = { ...item, id }
    this.db
      .prepare('INSERT OR REPLACE INTO generation_history (id, json, created_at, actor_id, actor_name) VALUES (?, ?, ?, ?, ?)')
      .run(id, JSON.stringify(json), createdAt, actor.userId || null, actor.userName || null)
    this.logOperation(actor, 'generation_history.add', 'generation_history', id, null, json, {})
    this.db.prepare('DELETE FROM generation_history WHERE id NOT IN (SELECT id FROM generation_history ORDER BY created_at DESC LIMIT 200)').run()
    return json
  }

  listGenerationHistory({ limit = 30 } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 30))
    return this.db
      .prepare('SELECT json FROM generation_history ORDER BY created_at DESC LIMIT ?')
      .all(safeLimit)
      .map((row) => parseJson(row.json, {}))
  }

  clearGenerationHistory(actor = {}) {
    const count = Number(this.db.prepare('SELECT COUNT(*) AS count FROM generation_history').get()?.count || 0)
    this.db.prepare('DELETE FROM generation_history').run()
    this.logOperation(actor, 'generation_history.clear', 'generation_history', 'all', { count }, { count: 0 }, {})
    return { count }
  }

  deleteGenerationHistory(ids, actor = {}) {
    for (const id of ids) {
      const row = this.db.prepare('SELECT json FROM generation_history WHERE id = ?').get(id)
      this.db.prepare('DELETE FROM generation_history WHERE id = ?').run(id)
      this.logOperation(actor, 'generation_history.delete_image', 'generation_history', id, row ? parseJson(row.json, {}) : null, null, { fileDeleted: true })
    }
  }

  logOperation(actor = {}, type, targetType = '', targetId = '', before = null, after = null, details = {}) {
    this.db
      .prepare(
        `INSERT INTO operation_log (created_at, actor_id, actor_name, type, target_type, target_id, before_json, after_json, details_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        now(),
        actor.userId || null,
        actor.userName || null,
        type,
        targetType || null,
        targetId || null,
        before === null ? null : JSON.stringify(before),
        after === null ? null : JSON.stringify(after),
        JSON.stringify(details || {}),
      )
  }

  listOperations({ limit = 100, since } = {}) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100))
    const sinceMs = since ? Date.parse(since) : 0
    const rows = sinceMs
      ? this.db
          .prepare('SELECT id, created_at AS createdAt, actor_name AS actorName, type, target_type AS targetType, target_id AS targetId, details_json AS detailsJson FROM operation_log WHERE created_at >= ? ORDER BY id DESC LIMIT ?')
          .all(sinceMs, safeLimit)
      : this.db
          .prepare('SELECT id, created_at AS createdAt, actor_name AS actorName, type, target_type AS targetType, target_id AS targetId, details_json AS detailsJson FROM operation_log ORDER BY id DESC LIMIT ?')
          .all(safeLimit)
    return rows.map((row) => ({ ...row, details: parseJson(row.detailsJson, {}) }))
  }

  pruneOperationLog(retentionDays = Number(process.env.COMFY_PRESET_OPERATION_LOG_DAYS || 90)) {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return
    const cutoff = now() - retentionDays * 24 * 60 * 60 * 1000
    this.db.prepare('DELETE FROM operation_log WHERE created_at < ?').run(cutoff)
  }

  compactLegacyOperationLog() {
    const result = this.db
      .prepare('UPDATE operation_log SET before_json = NULL, after_json = NULL WHERE length(COALESCE(before_json, \'\')) + length(COALESCE(after_json, \'\')) > 131072')
      .run()
    if (Number(result.changes || 0) > 0) {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      this.db.exec('VACUUM')
    }
  }

  syncPreviewResources() {
    const resourceDir = path.join(this.backupDir, 'resources', 'preview-cache')
    fs.mkdirSync(resourceDir, { recursive: true })
    if (!fs.existsSync(this.previewCacheDir)) return { count: 0, copied: 0 }
    let count = 0
    let copied = 0
    for (const entry of fs.readdirSync(this.previewCacheDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      count += 1
      const source = path.join(this.previewCacheDir, entry.name)
      const destination = path.join(resourceDir, entry.name)
      if (fs.existsSync(destination)) continue
      fs.copyFileSync(source, destination)
      copied += 1
    }
    return { count, copied }
  }

  pruneBackups() {
    const configuredMax = Number(process.env.COMFY_PRESET_BACKUP_MAX_COUNT || 14)
    const maxBackups = Number.isFinite(configuredMax) ? Math.max(2, Math.round(configuredMax)) : 14
    const sqliteBackups = fs
      .readdirSync(this.backupDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^workbench-.*\.sqlite$/i.test(entry.name))
      .map((entry) => ({ name: entry.name, path: path.join(this.backupDir, entry.name), mtimeMs: fs.statSync(path.join(this.backupDir, entry.name)).mtimeMs }))
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
    for (const stale of sqliteBackups.slice(maxBackups)) {
      fs.rmSync(stale.path, { force: true })
      const manifest = stale.path.replace(/\.sqlite$/i, '.json')
      fs.rmSync(manifest, { force: true })
    }
  }

  async createBackup(reason = 'manual') {
    fs.mkdirSync(this.backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filePath = path.join(this.backupDir, `workbench-${stamp}-${String(reason).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 32)}.sqlite`)
    await backup(this.db, filePath)
    const resources = this.syncPreviewResources()
    fs.writeFileSync(
      filePath.replace(/\.sqlite$/i, '.json'),
      JSON.stringify({ createdAt: isoNow(), reason, sqliteFile: path.basename(filePath), previewResources: resources }, null, 2),
      'utf8',
    )
    this.pruneBackups()
    return filePath
  }

  async createScheduledBackupIfDue() {
    const intervalHours = Number(process.env.COMFY_PRESET_BACKUP_INTERVAL_HOURS || 24)
    if (!Number.isFinite(intervalHours) || intervalHours <= 0) return
    const meta = this.document('backup_meta', { lastBackupAt: 0 })
    if (now() - Number(meta.lastBackupAt || 0) < intervalHours * 60 * 60 * 1000) return
    if (this.backupInFlight) return this.backupInFlight
    this.backupInFlight = this.createBackup('scheduled')
      .then((filePath) => {
        this.setDocument('backup_meta', { lastBackupAt: now(), lastBackupFile: path.basename(filePath) })
        this.pruneOperationLog()
        return filePath
      })
      .finally(() => {
        this.backupInFlight = null
      })
    return this.backupInFlight
  }

  close() {
    this.db.close()
  }
}
