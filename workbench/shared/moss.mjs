export const isMossModel = (model) => /^moss(?:_|$)/i.test(String(model || ''))

export const resolveFaceParameters = (model, profiles = {}, overrides = {}) => {
  const name = String(model || '').toLowerCase()
  const base = /krea[ _-]?2|dasiwa_k2/.test(name) ? 'krea2'
    : /anima|^miaomiao_(harem|realskin)|^tekito_mix_v21$/.test(name) ? 'anima' : ''
  const defaults = base === 'krea2' ? { steps: 7, cfg: 1 } : base === 'anima' ? { steps: 28, cfg: 6 } : {}
  const profile = profiles?.[base]
  if (profile?.steps !== undefined) defaults.steps = profile.steps
  if (profile?.cfg !== undefined) defaults.cfg = profile.cfg
  if (base) {
    defaults.sampler = profile?.sampler ?? (base === 'krea2' ? 'euler' : 'euler_ancestral')
    defaults.scheduler = profile?.scheduler ?? (base === 'krea2' ? 'simple' : 'normal')
  } else if (isMossModel(model)) {
    defaults.sampler = 'euler'
    defaults.scheduler = 'simple'
  }
  return { ...defaults, ...Object.fromEntries(Object.entries(overrides || {}).filter(([, value]) => value !== undefined)) }
}

export const faceParametersBody = (enabled, parameters = {}) => {
  if (!enabled) return {}
  const body = {}
  for (const [key, min, max] of [['steps', 1, 100], ['cfg', 0, 100], ['denoise', 0.0001, 1]]) {
    if (parameters?.[key] === undefined) continue
    const value = Number(parameters[key])
    if (!Number.isFinite(value) || value < min || value > max || (key === 'steps' && !Number.isInteger(value))) throw new Error(`Invalid face ${key}`)
    body[`face_${key}`] = value
  }
  if (parameters?.sampler) body.face_sampler_name = String(parameters.sampler)
  if (parameters?.scheduler) body.face_scheduler = String(parameters.scheduler)
  return body
}

const legacyDmdModels = new Set(['moss_image_sft_dmd8', 'moss_dmd8', 'moss_8step', 'moss_image_8step'])

export const normalizeMossGeneration = (value = {}) => {
  const legacyDmd = legacyDmdModels.has(String(value.model || '').toLowerCase())
  const faceDetail = typeof value.faceDetail === 'boolean' ? value.faceDetail : value.mossOptions?.faceRedraw === true
  return {
    ...value,
    ...(legacyDmd ? { width: value.width ?? 1024, height: value.height ?? 1024, steps: value.steps ?? 8 } : {}),
    model: legacyDmd ? 'moss_image_sft' : value.model,
    faceDetail,
    mossOptions: {
      dmd: legacyDmd || value.mossOptions?.dmd === true,
      faceRedraw: faceDetail,
    },
  }
}

export const mossOptionsBody = (value) => {
  const normalized = normalizeMossGeneration(value)
  return { model: normalized.model, moss_dmd: normalized.mossOptions.dmd, face_detail: normalized.mossOptions.faceRedraw }
}

export const mossResultMessage = (result) => {
  const face = result?.face_detail_result
  if (face?.status === 'no_face') return '未检测到人脸，已保留主图'
  if (face?.status === 'completed') return `面部重绘完成${Number.isInteger(face.detected_faces) ? `（检测到 ${face.detected_faces} 张脸）` : ''}`
  if (face?.status === 'unknown') return '面部重绘状态未确认，请检查输出图片'
  if (face?.status === 'pending') return '面部重绘待完成'
  return ''
}

export const normalizeMossUpscale = (value = {}) => {
  const method = value?.method || 'none'
  if (!['none', 'omnisr', 'seedvr2'].includes(method)) throw new Error('Unknown MOSS upscale method')
  const scale = Number(value?.scale ?? 2)
  const resolution = Number(value?.resolution ?? 2560)
  const maxResolution = Number(value?.maxResolution ?? 2560)
  if (![2, 3, 4].includes(scale)) throw new Error('OmniSR scale must be 2, 3 or 4')
  if (!Number.isInteger(resolution) || resolution < 16 || resolution % 2) throw new Error('SeedVR2 short edge must be a positive even number (at least 16)')
  if (!Number.isInteger(maxResolution) || maxResolution < 0 || maxResolution % 2) throw new Error('SeedVR2 max edge must be an even number or 0')
  return { method, scale, resolution, maxResolution }
}

export const mossUpscaleBody = (value) => {
  const settings = normalizeMossUpscale(value)
  return {
    upscale_method: settings.method,
    ...(settings.method === 'omnisr' ? { upscale_scale: settings.scale } : {}),
    ...(settings.method === 'seedvr2'
      ? { seedvr2_resolution: settings.resolution, seedvr2_max_resolution: settings.maxResolution }
      : {}),
  }
}
