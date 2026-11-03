import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { WorkbenchConflictError, WorkbenchStore } from '../server/workbench-store.mjs'

process.env.COMFY_PRESET_BACKUP_INTERVAL_HOURS = '0'

const fixture = () => ({
  categories: [
    { id: 'character', name: '人物' },
    { id: 'custom', name: '自定义' },
  ],
  blocks: [
    {
      id: 'block_a',
      categoryId: 'custom',
      name: '块 A',
      enabled: true,
      positive: ['alpha'],
      negative: [],
      loras: [],
      tags: [],
      previewVariants: [
        { id: 'preview_a', baseModel: 'anima', image: '/preview-cache/a.webp', createdAt: '2026-07-10T00:00:00.000Z' },
      ],
    },
    {
      id: 'block_b',
      categoryId: 'custom',
      name: '块 B',
      enabled: true,
      positive: ['beta'],
      negative: [],
      loras: [],
      tags: [],
    },
  ],
  baseModelProfiles: { anima: { positivePrefix: 'quality' } },
  generationPresets: [{ id: 'preset_a', name: '方案 A', createdAt: '2026-07-10T00:00:00.000Z' }],
})

const createStore = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-workbench-test-'))
  const dataDir = path.join(root, 'data')
  const previewCacheDir = path.join(dataDir, 'preview-cache')
  fs.mkdirSync(previewCacheDir, { recursive: true })
  const legacyFile = path.join(dataDir, 'shared-state.json')
  fs.writeFileSync(legacyFile, JSON.stringify(fixture()), 'utf8')
  const store = new WorkbenchStore({
    dataDir,
    legacySharedStateFile: legacyFile,
    dbFile: path.join(dataDir, 'workbench.sqlite'),
    accessKeysFile: path.join(dataDir, 'access-keys.txt'),
    previewCacheDir,
  })
  return { root, dataDir, previewCacheDir, store }
}

test('migrates shared content into entity tables and enforces block revisions', async (context) => {
  const environment = createStore()
  context.after(() => {
    environment.store.close()
    fs.rmSync(environment.root, { recursive: true, force: true })
  })

  const initial = environment.store.readSharedContent()
  assert.equal(initial.blocks.length, 2)
  assert.equal(initial.blocks[0].previewVariants.length, 1)
  assert.ok(initial.blocks[0].revision > 0)

  const blockA = initial.blocks.find((block) => block.id === 'block_a')
  const updated = environment.store.mutateSharedContent(
    'block.update',
    { id: blockA.id, block: { ...blockA, notes: 'first update' }, baseRevision: blockA.revision },
    { userId: 'owner', userName: 'owner', role: 'owner' },
  )
  assert.equal(updated.entity.notes, 'first update')

  assert.throws(
    () => environment.store.mutateSharedContent('block.update', { id: blockA.id, block: { ...blockA, notes: 'stale' }, baseRevision: blockA.revision }),
    WorkbenchConflictError,
  )

  const blockB = initial.blocks.find((block) => block.id === 'block_b')
  assert.doesNotThrow(() =>
    environment.store.mutateSharedContent('block.update', {
      id: blockB.id,
      block: { ...blockB, notes: 'independent update' },
      baseRevision: blockB.revision,
    }),
  )

  environment.store.addGenerationHistory({ id: 'history_a', imagePath: 'output/a.png' })
  assert.equal(environment.store.listGenerationHistory().length, 1)
  assert.deepEqual(environment.store.clearGenerationHistory({ userId: 'owner', userName: 'owner', role: 'owner' }), { count: 1 })
  assert.equal(environment.store.listGenerationHistory().length, 0)
})

test('backs up sqlite and controlled preview resources', async (context) => {
  const environment = createStore()
  context.after(() => {
    environment.store.close()
    fs.rmSync(environment.root, { recursive: true, force: true })
  })
  fs.writeFileSync(path.join(environment.previewCacheDir, 'thumb.webp'), Buffer.from('preview-resource'))
  const backupFile = await environment.store.createBackup('test')
  assert.ok(fs.existsSync(backupFile))
  assert.ok(fs.existsSync(backupFile.replace(/\.sqlite$/i, '.json')))
  assert.ok(fs.existsSync(path.join(environment.dataDir, 'backups', 'resources', 'preview-cache', 'thumb.webp')))
})

test('keeps owner and member access-key capabilities distinct', (context) => {
  const environment = createStore()
  context.after(() => {
    environment.store.close()
    fs.rmSync(environment.root, { recursive: true, force: true })
  })
  const ownerToken = fs.readFileSync(path.join(environment.dataDir, 'access-keys.txt'), 'utf8').match(/cwui_[A-Za-z0-9_-]+/)?.[0]
  assert.equal(environment.store.verifyAccessKey(ownerToken).role, 'owner')

  const member = environment.store.createAccessKey({ userName: 'friend', keyName: 'test' }, { userId: 'owner', userName: 'owner', role: 'owner' })
  assert.equal(environment.store.verifyAccessKey(member.key).role, 'member')
  assert.throws(() => environment.store.revokeAccessKey(environment.store.listAccessKeys().find((key) => key.role === 'owner').id), /last active owner key/)
  environment.store.revokeAccessKey(member.id, { userId: 'owner', userName: 'owner', role: 'owner' })
  assert.equal(environment.store.verifyAccessKey(member.key), null)
})
