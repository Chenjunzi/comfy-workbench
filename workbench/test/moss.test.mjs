import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveFaceParameters, mossUpscaleBody, isMossModel, normalizeMossGeneration } from '../shared/moss.mjs'

test('face defaults follow K2 and Anima profiles while preserving explicit overrides', () => {
  const profiles = { krea2: { steps: 9, cfg: 1.5, sampler: 'euler', scheduler: 'simple' }, anima: { steps: 32, cfg: 4, sampler: 'euler_ancestral', scheduler: 'normal' } }
  assert.deepEqual(resolveFaceParameters('dasiwa_krea2_turbo_raw', profiles), profiles.krea2)
  assert.deepEqual(resolveFaceParameters('wai_anima_v10', profiles), profiles.anima)
  assert.deepEqual(resolveFaceParameters('miaomiao_harem', profiles, { steps: 12, denoise: 0.3, sampler: 'dpmpp_2m' }), { ...profiles.anima, steps: 12, denoise: 0.3, sampler: 'dpmpp_2m' })
  assert.deepEqual(resolveFaceParameters('moss_image_sft', profiles), { sampler: 'euler', scheduler: 'simple' })
  assert.deepEqual(resolveFaceParameters('krea2_turbo', profiles, { steps: undefined }), profiles.krea2)
})

test('legacy DMD presets preserve explicit parameters and acceleration intent', () => {
  for (const model of ['moss_image_sft_dmd8', 'moss_dmd8', 'moss_8step', 'moss_image_8step']) {
    const preset = { model, width: 1232, height: 896, steps: 6, seed: '123', mossOptions: { faceRedraw: true } }
    const migrated = normalizeMossGeneration(preset)
    assert.equal(migrated.model, 'moss_image_sft')
    assert.deepEqual(migrated.mossOptions, { dmd: true, faceRedraw: true })
    assert.equal(migrated.steps, 6)
    assert.equal(migrated.width, 1232)
    assert.deepEqual(normalizeMossGeneration(migrated), migrated)
  }
  assert.deepEqual(normalizeMossGeneration({ model: 'moss_image_sft' }).mossOptions, { dmd: false, faceRedraw: false })
})

test('MOSS methods produce exclusive gateway fields', () => {
  assert.equal(normalizeMossGeneration({ model: 'wai_anima_v10', faceDetail: false, mossOptions: { faceRedraw: true } }).faceDetail, false)
  assert.equal(normalizeMossGeneration({ model: 'moss_image_sft', mossOptions: { faceRedraw: true } }).faceDetail, true)
  assert.equal(isMossModel('moss_image_sft_dmd8'), true)
  assert.equal(isMossModel('dasiwa_krea2_turbo_raw'), false)
  assert.deepEqual(mossUpscaleBody(), { upscale_method: 'none' })
  assert.deepEqual(mossUpscaleBody({ method: 'omnisr', scale: 3 }), { upscale_method: 'omnisr', upscale_scale: 3 })
  assert.deepEqual(mossUpscaleBody({ method: 'seedvr2', resolution: 1536, maxResolution: 0 }), {
    upscale_method: 'seedvr2', seedvr2_resolution: 1536, seedvr2_max_resolution: 0,
  })
  assert.throws(() => mossUpscaleBody({ method: 'seedvr2', resolution: 1537 }))
  assert.throws(() => mossUpscaleBody({ method: 'omnisr', scale: 1.5 }))
})
