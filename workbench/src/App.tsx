import { resolveFaceParameters, faceParametersBody, type FaceParameters, isMossModel, mossUpscaleBody, mossOptionsBody, mossResultMessage, normalizeMossGeneration, type MossOptions, type MossUpscale } from '../shared/moss.mjs'
import { stepResolution } from '../shared/resolution.mjs'
import {
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ArrowLeftRight,
  ArrowDown,
  ArrowUp,
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  Eye,
  FolderOpen,
  GripVertical,
  ImagePlus,
  Languages,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Save,
  Send,
  ShieldCheck,
  Settings2,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react'
import './App.css'

type Category = {
  id: string
  name: string
  description?: string
  revision?: number
  updatedAt?: number
}

type PreviewBaseModel = LoraBaseModel | 'none'

type PreviewVariant = {
  id: string
  baseModel: PreviewBaseModel
  image: string
  fit?: PreviewImageMode
  sourceImagePath?: string
  sourceImageUrl?: string
  note?: string
  createdAt: string
  revision?: number
  updatedAt?: number
}

type PresetBlock = {
  id: string
  categoryId: string
  name: string
  enabled: boolean
  positive: string[]
  negative: string[]
  loras: LoraRef[]
  loraBaseModels?: LoraBaseModel[]
  tags: string[]
  notes?: string
  previewImage?: string
  previewSourceImagePath?: string
  previewSourceImageUrl?: string
  previewFit?: PreviewImageMode
  previewVariants?: PreviewVariant[]
  activePreviewVariantIds?: Partial<Record<PreviewBaseModel, string>>
  revision?: number
  updatedAt?: number
}

type LoraBaseModel = 'illustrious' | 'anima' | 'krea2' | 'moss'
type GenerationBaseModel = Exclude<LoraBaseModel, 'moss'>
type ModelTrainingBase = GenerationBaseModel | 'none'
type PreviewImageMode = 'crop' | 'fit' | 'background'
type CardSizeMode = 'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge'
type CardAspectMode = 'default' | 'portrait916' | 'portrait34' | 'masonry'
type PresetSourceFilter = 'all' | 'with' | 'without'
type PresetSourceStatus = 'checking' | 'ready' | 'none' | 'error'
type DragImagePayload = {
  source?: string
  imagePath?: string
  imageUrl?: string
}
type PresetSourceReference = Pick<DragImagePayload, 'imagePath' | 'imageUrl'>

type ImagePreviewTarget = DragImagePayload & {
  title: string
  detail?: string
  albumItemId?: string
}

type DroppedImage = {
  file?: File
  source?: string
  imagePath?: string
  imageUrl?: string
}

type BaseModelProfile = {
  positivePrefix: string
  negativePrefix: string
  preset: string
  steps: number
  cfg: number
  sampler: string
  scheduler: string
  width?: number
  height?: number
  upscaleSteps?: UpscaleStep[]
}

type LoraRef = {
  name: string
  strength_model: number
  strength_clip: number
}

type UpscaleStep = {
  id: string
  enabled: boolean
  scale: number
  steps: number
  cfg: number
  denoise: number
  sampler?: string
  scheduler?: string
}

type HistoryItem = {
  faceDetail?: boolean
  mossOptions?: MossOptions
  faceDetailResult?: { status: string; detected_faces?: number | null }
  id: string
  createdAt: string
  prompt: string
  negative: string
  width: number
  height: number
  outputWidth?: number
  outputHeight?: number
  model: string
  imagePath?: string
  imageUrl?: string
  durationMs?: number
  timingKey?: string
  submittedBy?: string
  source?: string
}

type GenerationJob = {
  id: string
  createdAt: string
  dryRun: boolean
  body: Record<string, unknown>
  pngMetadata: PngPresetMetadata
  prompt: string
  negative: string
  width: number
  height: number
  outputWidth: number
  outputHeight: number
  model: string
  timingKey: string
  estimatedMs: number
}

type ModelOption = {
  trainingFamily?: GenerationBaseModel
  generationDefaults?: Partial<Pick<AppState, 'width' | 'height' | 'steps' | 'cfg' | 'sampler' | 'scheduler'>>
  mossCapabilities?: Record<string, { available?: boolean; missing?: string[]; default?: number; min?: number; max?: number }>
  id: string
  label: string
  detail?: string
  aliases: string[]
  upscaleContract?: {
    type: string
    minStages: number
    maxStages: number
  }
}

type GenerationPreset = {
  faceParameters?: FaceParameters
  faceDetail?: boolean
  mossOptions?: MossOptions
  mossUpscale?: MossUpscale
  id: string
  name: string
  createdAt: string
  selectedBlockIds: string[]
  selectedColorPrompts?: string[]
  customPositivePrompt?: string
  gatewayUrl: string
  positivePrefix: string
  negativePrefix: string
  model: string
  preset: string
  filenamePrefix: string
  width: number
  height: number
  steps: number
  cfg: number
  seed: string
  sampler: string
  scheduler: string
  upscaleSteps: UpscaleStep[]
  revision?: number
  updatedAt?: number
}

type PngPresetMetadata = {
  app: 'comfy-preset-workflow-ui'
  version: 1
  createdAt: string
  generationPreset: GenerationPreset
  selectedBlocks: Array<{
    id: string
    categoryId: string
    name: string
    positive: string[]
    negative: string[]
    loras: LoraRef[]
  }>
  composed: {
    positive: string
    negative: string
    loras: LoraRef[]
  }
  requestBody: Record<string, unknown>
}

type ShareAuthStatus = {
  authenticated: boolean
  locked: boolean
  lockSeconds: number
}

type SharedContent = {
  categories: Category[]
  blocks: PresetBlock[]
  baseModelProfiles?: Partial<Record<GenerationBaseModel, Partial<BaseModelProfile>>>
  generationPresets: GenerationPreset[]
  updatedAt: number
  revision?: number
  baseModelProfilesRevision?: number
}

type SharedContentPayload = Omit<SharedContent, 'updatedAt'>

type SharedOperation = {
  type: string
  payload: Record<string, unknown>
  label: string
}

type SharedGenerationStatus = {
  active: boolean
  phase?: string
  owner?: string
  actorName?: string
  source?: string
  createdAt?: string
  dryRun?: boolean
  prompt?: string
  model?: string
  width?: number
  height?: number
  queueLength?: number
  updatedAt?: number
}

type WorkbenchGenerationDraft = {
  faceParameters?: FaceParameters
  faceDetail?: boolean
  mossOptions?: MossOptions
  mossUpscale?: MossUpscale
  gatewayUrl: string
  positivePrefix: string
  negativePrefix: string
  customPositivePrompt: string
  model: string
  preset: string
  filenamePrefix: string
  width: number
  height: number
  steps: number
  cfg: number
  seed: string
  sampler: string
  scheduler: string
  upscaleSteps: UpscaleStep[]
}

type WorkbenchUiState = {
  selectedBlockIds: string[]
  selectedColorPrompts: string[]
  generationDraft: WorkbenchGenerationDraft
}

type WorkbenchMessage = {
  id: string
  text: string
  createdAt: number
  tone: 'info' | 'success' | 'warning' | 'error'
}

type ConfirmDialogState = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}

type AppState = {
  faceParameters?: FaceParameters
  faceDetail?: boolean
  mossOptions?: MossOptions
  mossUpscale?: MossUpscale
  categories: Category[]
  blocks: PresetBlock[]
  selectedBlockIds: string[]
  selectedColorPrompts: string[]
  customPositivePrompt: string
  gatewayUrl: string
  positivePrefix: string
  negativePrefix: string
  model: string
  modelTrainingBases: Record<string, ModelTrainingBase>
  baseModelProfiles: Record<GenerationBaseModel, BaseModelProfile>
  preset: string
  filenamePrefix: string
  width: number
  height: number
  steps: number
  cfg: number
  seed: string
  sampler: string
  scheduler: string
  upscaleSteps: UpscaleStep[]
  generationPresets: GenerationPreset[]
  history: HistoryItem[]
}

const storageKey = 'comfy-preset-workflow-ui:v1'
const clientIdKey = 'comfy-preset-workflow-ui:client-id'
const categoryCollapseKey = 'comfy-preset-workflow-ui:collapsed-categories'
const loraBaseVisibilityKey = 'comfy-preset-workflow-ui:lora-base-visibility'
const loraBaseFilterKey = 'comfy-preset-workflow-ui:lora-base-filter'
const recentBlockIdsKey = 'comfy-preset-workflow-ui:recent-block-ids'
const cardSizeKey = 'comfy-preset-workflow-ui:card-size'
const cardAspectKey = 'comfy-preset-workflow-ui:card-aspect'
const albumCollapseKey = 'comfy-preset-workflow-ui:album-collapsed'
const messageHistoryKey = 'comfy-preset-workflow-ui:message-history'
const pngPresetKeyword = 'comfy-preset-workflow-ui'
const dragImageMime = 'application/x-comfy-preset-image'
const selectedBlockDragMime = 'application/x-comfy-preset-selected-block'
const legacyFilenamePrefix = 'Preset/%date:yyyyMMddhhmmss%'
const defaultFilenamePrefix = 'Preset/%character%/%date:yyyyMMddhhmmss%'

const makeId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const readCollapsedCategoryIds = () => {
  try {
    const saved = localStorage.getItem(categoryCollapseKey)
    if (!saved) return ['negative']
    const parsed = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : ['negative']
  } catch {
    return ['negative']
  }
}

const readLoraBaseVisibility = (): Record<LoraBaseModel, boolean> => {
  try {
    const saved = localStorage.getItem(loraBaseVisibilityKey)
    const parsed = saved ? JSON.parse(saved) : {}
    return {
      illustrious: typeof parsed?.illustrious === 'boolean' ? parsed.illustrious : true,
      anima: typeof parsed?.anima === 'boolean' ? parsed.anima : true,
      krea2: typeof parsed?.krea2 === 'boolean' ? parsed.krea2 : true,
      moss: typeof parsed?.moss === 'boolean' ? parsed.moss : true,
    }
  } catch {
    return { illustrious: true, anima: true, krea2: true, moss: true }
  }
}

const readLoraBaseFilter = (): 'all' | LoraBaseModel | 'unknown' => {
  const saved = localStorage.getItem(loraBaseFilterKey)
  return saved === 'illustrious' || saved === 'anima' || saved === 'krea2' || saved === 'moss' || saved === 'unknown' ? saved : 'all'
}

const readRecentBlockIds = () => {
  try {
    const saved = localStorage.getItem(recentBlockIdsKey)
    if (!saved) return []
    const parsed = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 16) : []
  } catch {
    return []
  }
}

const readCardSize = (): CardSizeMode => {
  const saved = localStorage.getItem(cardSizeKey)
  return saved === 'small' || saved === 'large' || saved === 'xlarge' || saved === 'xxlarge' ? saved : 'medium'
}

const readCardAspect = (): CardAspectMode => {
  const saved = localStorage.getItem(cardAspectKey)
  return saved === 'portrait916' || saved === 'portrait34' || saved === 'masonry' ? saved : 'default'
}

const cardSizeMinPixels: Record<CardSizeMode, number> = {
  small: 118,
  medium: 150,
  large: 190,
  xlarge: 240,
  xxlarge: 310,
}

const cardSizeGapPixels: Record<CardSizeMode, number> = {
  small: 7,
  medium: 10,
  large: 12,
  xlarge: 14,
  xxlarge: 16,
}

const readAlbumCollapsed = () => localStorage.getItem(albumCollapseKey) === '1'

const readWorkbenchMessages = (): WorkbenchMessage[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(messageHistoryKey) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item.text === 'string' && Number.isFinite(Number(item.createdAt)))
      .slice(0, 80)
  } catch {
    return []
  }
}

const messageTone = (text: string): WorkbenchMessage['tone'] => {
  if (/失败|错误|冲突|不可用|不存在/.test(text)) return 'error'
  if (/取消|警告|缺少|跳过|等待|锁定/.test(text)) return 'warning'
  if (/完成|成功|已保存|已连接|已读取|已设置|已缓存|已提取|已覆盖/.test(text)) return 'success'
  return 'info'
}

const getClientId = () => {
  const saved = localStorage.getItem(clientIdKey)
  if (saved) return saved
  const id = makeId('viewer')
  localStorage.setItem(clientIdKey, id)
  return id
}

const defaultBaseModelProfiles: Record<GenerationBaseModel, BaseModelProfile> = {
  illustrious: {
    positivePrefix: 'masterpiece, best quality, newest, highres, very aesthetic, absurdres, anime illustration',
    negativePrefix:
      'lowres, worst quality, bad quality, bad anatomy, blurry, cropped, extra limbs, deformed hands, bad face, sketch, jpeg artifacts, signature, watermark, old, oldest, text, logo',
    preset: 'anime_manga_fast',
    steps: 24,
    cfg: 5,
    sampler: 'euler',
    scheduler: 'normal',
  },
  anima: {
    positivePrefix: 'masterpiece, best quality, highres, anime style, detailed, clean lineart, vivid colors',
    negativePrefix:
      'lowres, worst quality, bad quality, bad anatomy, bad hands, extra fingers, missing fingers, blurry, cropped, jpeg artifacts, signature, watermark, text, logo',
    preset: 'anime_manga_fast',
    steps: 28,
    cfg: 6,
    sampler: 'euler_ancestral',
    scheduler: 'normal',
  },
  krea2: {
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
  },
}

const krea2UsdUpscaleStep = (): UpscaleStep => ({
  id: makeId('krea2_usd'),
  enabled: true,
  scale: 1.5,
  steps: 3,
  cfg: 1,
  denoise: 0.12,
  sampler: 'euler',
  scheduler: 'simple',
})

const initialState: AppState = {
  categories: [
    { id: 'character', name: '人物', description: '角色身份、外貌特征与人物 LoRA' },
    { id: 'outfit', name: '服装', description: '服装、制服、配饰与穿着材质' },
    { id: 'pose', name: '姿势', description: '通用姿态、动作与身体朝向' },
    { id: 'background', name: '背景', description: '地点、环境、天气与场景布置' },
    { id: 'style', name: '画风', description: '画风、渲染质感与全局风格 LoRA' },
    { id: 'negative', name: '负面词', description: '排除缺陷、构图问题与不需要的内容' },
  ],
  blocks: [
    {
      id: 'char_silver_glasses',
      categoryId: 'character',
      name: '银发眼镜少女',
      enabled: true,
      positive: ['1girl', 'solo', 'silver hair', 'round glasses', 'soft smile'],
      negative: [],
      loras: [],
      tags: ['anime', 'portrait'],
    },
    {
      id: 'outfit_maid',
      categoryId: 'outfit',
      name: '黑白女仆装',
      enabled: true,
      positive: ['black maid dress', 'white apron', 'frills', 'ribbon'],
      negative: ['messy clothes'],
      loras: [],
      tags: ['dress'],
    },
    {
      id: 'pose_window',
      categoryId: 'pose',
      name: '窗边回眸',
      enabled: true,
      positive: ['looking back', 'standing near window', 'relaxed pose'],
      negative: ['stiff pose'],
      loras: [],
      tags: ['standing'],
    },
    {
      id: 'bg_rainy_room',
      categoryId: 'background',
      name: '雨夜房间',
      enabled: true,
      positive: ['cozy bedroom', 'rainy night', 'city lights outside window', 'warm lamp light'],
      negative: ['empty background'],
      loras: [],
      tags: ['indoor'],
    },
    {
      id: 'style_anime_detail',
      categoryId: 'style',
      name: '清晰二次元',
      enabled: true,
      positive: ['anime illustration', 'clean lineart', 'high detail', 'soft lighting'],
      negative: ['lowres', 'blurry', 'bad anatomy', 'extra fingers', 'text', 'watermark'],
      loras: [],
      tags: ['quality'],
    },
  ],
  selectedBlockIds: ['char_silver_glasses', 'outfit_maid', 'pose_window', 'bg_rainy_room', 'style_anime_detail'],
  selectedColorPrompts: [],
  customPositivePrompt: '',
  gatewayUrl: '/gateway',
  positivePrefix: 'masterpiece, best quality, ultra high res, hyper-detailed, anime realism, 8K, newest',
  negativePrefix:
    'lowres, worst quality, bad quality, bad anatomy, simple background, blurry, cropped, extra limbs, deformed hands, bad face, sketch, jpeg artifacts, signature, watermark, old, oldest, text, logo',
  model: 'gembyte_emerald',
  modelTrainingBases: {},
  baseModelProfiles: defaultBaseModelProfiles,
  preset: 'anime_manga_fast',
  filenamePrefix: defaultFilenamePrefix,
  width: 480,
  height: 832,
  steps: 24,
  cfg: 5,
  seed: '',
  sampler: 'euler',
  scheduler: 'normal',
  upscaleSteps: [
    {
      id: 'upscale_default',
      enabled: true,
      scale: 2,
      steps: 10,
      cfg: 6,
      denoise: 0.2,
      sampler: 'euler_ancestral',
      scheduler: 'normal',
    },
  ],
  generationPresets: [],
  history: [],
}

const defaultCategoryIds = new Set(initialState.categories.map((category) => category.id))

const snap8 = (value: number) => Math.max(64, Math.round(value / 8) * 8)

function ResolutionInput({ value, alignment, onCommit }: { value: number; alignment: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return <input type="number" step={alignment} value={draft ?? value}
    onChange={(event) => setDraft(event.currentTarget.value)}
    onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
    }}
    onBlur={() => {
      setDraft(null)
      if (!draft?.trim() || !Number.isFinite(Number(draft))) return
      const aligned = Math.max(64, Math.round(Number(draft) / alignment) * alignment)
      if (aligned !== value) onCommit(aligned)
    }} />
}
const floor8 = (value: number) => Math.max(64, Math.floor(value / 8) * 8)

const sizePresets = [
  { label: '480 x 832', width: 480, height: 832 },
  { label: '832 x 480', width: 832, height: 480 },
  { label: '512 x 768', width: 512, height: 768 },
  { label: '768 x 1024', width: 768, height: 1024 },
  { label: '832 x 1216', width: 832, height: 1216 },
  { label: '1024 x 1024', width: 1024, height: 1024 },
]

const samplerOptions = ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_3m_sde', 'ddim', 'uni_pc']
const schedulerOptions = ['normal', 'simple', 'karras', 'exponential', 'sgm_uniform', 'beta']
const colorPromptPresets = [
  { label: '红', prompt: 'red', color: '#ef4444' },
  { label: '黄', prompt: 'yellow', color: '#facc15' },
  { label: '蓝', prompt: 'blue', color: '#3b82f6' },
  { label: '绿', prompt: 'green', color: '#22c55e' },
  { label: '粉', prompt: 'pink', color: '#f472b6' },
  { label: '紫', prompt: 'purple', color: '#a855f7' },
  { label: '橙', prompt: 'orange', color: '#fb923c' },
  { label: '金', prompt: 'gold', color: '#d4af37' },
  { label: '银', prompt: 'silver', color: '#c0c7d1' },
  { label: '黑', prompt: 'black', color: '#111827' },
  { label: '白', prompt: 'white', color: '#f8fafc' },
]
const loraBaseModelOptions: Array<{ id: LoraBaseModel; label: string; name: string }> = [
  { id: 'illustrious', label: 'IL', name: 'Illustrious / 光辉' },
  { id: 'anima', label: 'A', name: 'Anima' },
  { id: 'krea2', label: 'K2', name: 'Krea 2' },
  { id: 'moss', label: 'MOSS', name: 'MOSS Image' },
]
const previewBaseModelOptions: Array<{ id: PreviewBaseModel; label: string; name: string }> = [
  { id: 'none', label: '通用', name: '不区分底模' },
  ...loraBaseModelOptions,
]
const modelTrainingBaseOptions: Array<{ id: ModelTrainingBase; label: string; name: string }> = [
  { id: 'none', label: '未标', name: '不自动套用训练族配置' },
  ...loraBaseModelOptions.filter((option): option is { id: GenerationBaseModel; label: string; name: string } => option.id !== 'moss'),
]

const gcd = (left: number, right: number): number => (right === 0 ? Math.abs(left) : gcd(right, left % right))

const splitLines = (value: string) =>
  value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)

const joinPrompt = (parts: string[]) => parts.filter(Boolean).join(', ')

const inferLoraBaseModels = (value: string): LoraBaseModel[] => {
  const normalized = value.toLowerCase()
  const result = new Set<LoraBaseModel>()
  if (/(^|[\\/_\-\s])moss([\\/_\-\s.]|$)/i.test(value)) result.add('moss')
  if (normalized.includes('krea2') || normalized.includes('krea 2') || normalized.includes('krea-2') || normalized.includes('krea_2')) {
    result.add('krea2')
  }
  if (/(^|[\\/_\-\s])(anima|ani)([\\/_\-\s.]|$)/i.test(value) || normalized.includes('anima')) result.add('anima')
  if (
    normalized.includes('illustrious') ||
    /(^|[\\/_\-\s])(ill|il)([\\/_\-\s.]|$)/i.test(value) ||
    normalized.includes('_il') ||
    normalized.includes('-il')
  ) {
    result.add('illustrious')
  }
  return [...result]
}

const blockLoraBaseModels = (block: PresetBlock): LoraBaseModel[] => {
  if (!block.loras.length) return []
  if (block.loraBaseModels) return block.loraBaseModels
  return [...new Set(block.loras.flatMap((lora) => inferLoraBaseModels(lora.name)))]
}

const inferModelTrainingBase = (model?: ModelOption): GenerationBaseModel | undefined => {
  if (!model) return undefined
  if (model.trainingFamily) return model.trainingFamily
  const text = [model.id, model.label, model.detail, ...model.aliases].filter(Boolean).join(' ')
  const normalized = text.toLowerCase()
  if (normalized.includes('krea2') || normalized.includes('krea 2') || normalized.includes('krea-2')) return 'krea2'
  if (/(^|[\\/_\-\s])(anima|ani)([\\/_\-\s.]|$)/i.test(text) || normalized.includes('anima')) return 'anima'
  if (
    normalized.includes('illustrious') ||
    /(^|[\\/_\-\s])(ill|il)([\\/_\-\s.]|$)/i.test(text) ||
    normalized.includes('_il') ||
    normalized.includes('-il')
  ) {
    return 'illustrious'
  }
  return undefined
}

const modelTrainingBaseLabel = (base?: ModelTrainingBase) =>
  modelTrainingBaseOptions.find((option) => option.id === base)?.label ?? '未识别'

const previewBaseModelLabel = (base?: PreviewBaseModel) =>
  previewBaseModelOptions.find((option) => option.id === base)?.label ?? '通用'

const nonNoneBase = (base?: ModelTrainingBase): LoraBaseModel | undefined =>
  base === 'illustrious' || base === 'anima' || base === 'krea2' ? base : undefined

const previewBaseForFilter = (filter: 'all' | LoraBaseModel | 'unknown', block?: PresetBlock): PreviewBaseModel => {
  if (filter !== 'all' && filter !== 'unknown') return filter
  const blockBases = block ? blockLoraBaseModels(block) : []
  return blockBases.length === 1 ? blockBases[0] : 'none'
}

const blockPreviewDisplay = (block: PresetBlock, filter: 'all' | LoraBaseModel | 'unknown') => {
  const variants = (block.previewVariants ?? []).filter((variant) => Boolean(variant.image))
  const targetBase = previewBaseForFilter(filter, block)
  const isSpecificFilter = filter !== 'all' && filter !== 'unknown'
  const pickVariant = (baseModel: PreviewBaseModel) => {
    const candidates = variants.filter((variant) => variant.baseModel === baseModel)
    if (candidates.length === 0) return undefined
    const activeId = block.activePreviewVariantIds?.[baseModel]
    return candidates.find((variant) => variant.id === activeId) ?? candidates[0]
  }
  const preferred = pickVariant(targetBase)
  const generic = pickVariant('none')
  const fallback = variants[0]
  const variant = preferred ?? generic ?? (isSpecificFilter ? undefined : fallback)
  if (variant) {
    const baseVariants = variants.filter((item) => item.baseModel === variant.baseModel)
    const legacySourceMatchesVariant = Boolean(block.previewImage && variant.image === block.previewImage)
    return {
      variantId: variant.id,
      image: variant.image,
      fit: variant.fit ?? 'crop',
      sourceImagePath: variant.sourceImagePath ?? (legacySourceMatchesVariant ? block.previewSourceImagePath : undefined),
      sourceImageUrl: variant.sourceImageUrl ?? (legacySourceMatchesVariant ? block.previewSourceImageUrl : undefined),
      baseModel: variant.baseModel,
      variantCount: variants.length,
      baseVariantCount: baseVariants.length,
      variantIndex: Math.max(0, baseVariants.findIndex((item) => item.id === variant.id)) + 1,
    }
  }
  return {
    variantId: '',
    image: block.previewImage ?? '',
    fit: block.previewFit ?? 'crop',
    sourceImagePath: block.previewSourceImagePath,
    sourceImageUrl: block.previewSourceImageUrl,
    baseModel: 'none' as PreviewBaseModel,
    variantCount: variants.length,
    baseVariantCount: 0,
    variantIndex: 0,
  }
}

const promptTranslationGlossary: Record<string, string> = {
  '1girl': '一名女孩',
  solo: '单人',
  blush: '脸红',
  smile: '微笑',
  'soft smile': '柔和微笑',
  'silver hair': '银发',
  'white hair': '白发',
  'long hair': '长发',
  'very long hair': '超长发',
  'long silver-white hair': '银白长发',
  'blue hair': '蓝发',
  'purple eyes': '紫色眼睛',
  'red eyes': '红眼',
  'amber eyes': '琥珀色眼睛',
  'lavender-pink eyes': '薰衣草粉色眼睛',
  glasses: '眼镜',
  'round glasses': '圆框眼镜',
  'gold glasses': '金色眼镜',
  'golden round glasses': '金色圆框眼镜',
  'thin gold round glasses': '细金色圆框眼镜',
  'cat ears': '猫耳',
  'black cat ears': '黑色猫耳',
  'cat tail': '猫尾',
  'long cat tail': '长猫尾',
  horns: '角',
  'black horns': '黑角',
  wings: '翅膀',
  'leather wings': '皮革翼',
  'dragon tail': '龙尾',
  'large breasts': '大胸',
  'huge breasts': '巨乳',
  'small breasts': '小胸',
  nude: '裸露',
  naked: '裸体',
  'completely nude': '全裸',
  'completely naked': '全裸',
  dress: '连衣裙',
  shirt: '衬衫',
  'white shirt': '白衬衫',
  skirt: '裙子',
  'pleated skirt': '百褶裙',
  'short jacket': '短外套',
  'school uniform': '校服',
  leotard: '紧身连体衣',
  'black leotard': '黑色紧身连体衣',
  swimsuit: '泳装',
  'one-piece swimsuit': '连体泳装',
  'see-through': '半透明',
  transparent: '透明',
  'transparent fabric': '透明布料',
  wet: '湿润',
  panties: '内裤',
  bra: '胸罩',
  'lace bra': '蕾丝胸罩',
  stockings: '长袜',
  pantyhose: '连裤袜',
  'high heels': '高跟鞋',
  shoes: '鞋子',
  gloves: '手套',
  'paw gloves': '爪形手套',
  lying: '躺着',
  sitting: '坐着',
  standing: '站立',
  kneeling: '跪姿',
  'looking back': '回头看',
  'close-up view': '近景视角',
  'upper body': '上半身',
  'full body': '全身',
  'from behind': '背后视角',
  'lying on back': '仰躺',
  'lying on side': '侧躺',
  'lying on bed': '躺在床上',
  'sitting on bed': '坐在床上',
  'legs raised': '抬腿',
  'legs spread': '张开双腿',
  'hugging legs': '抱腿',
  'arms around neck': '双臂环颈',
  bedroom: '卧室',
  bathroom: '浴室',
  classroom: '教室',
  school: '学校',
  office: '办公室',
  street: '街道',
  bed: '床',
  couch: '沙发',
  window: '窗户',
  mirror: '镜子',
  water: '水',
  'water spraying': '喷水',
  'water droplets on skin': '皮肤水珠',
  'dark background': '深色背景',
  'soft lighting': '柔和光照',
  'pink lighting': '粉色光照',
  'dark red lighting': '暗红光照',
  'warm bedroom lighting': '卧室暖光',
  manga: '漫画',
  comic: '漫画',
  realistic: '写实',
  cinematic: '电影感',
  'depth of field': '景深',
  lowres: '低分辨率',
  blurry: '模糊',
  cropped: '裁切',
  'bad anatomy': '错误人体结构',
  'bad hands': '手部错误',
  'extra fingers': '多余手指',
  'extra limbs': '多余肢体',
  'deformed hands': '畸形手',
  'bad face': '脸部错误',
  sketch: '草图',
  signature: '签名',
  watermark: '水印',
  text: '文字',
  logo: '标志',
}

const promptTranslationOverrides: Record<string, string> = {
  masterpiece: '\u6770\u4f5c',
  'best quality': '\u6700\u4f73\u8d28\u91cf',
  'anime realism': '\u52a8\u753b\u5199\u5b9e\u98ce',
  newest: '\u6700\u65b0',
  'hyper-detailed': '\u8d85\u7ec6\u8282',
  '8k': '8K',
  'ultra high res': '\u8d85\u9ad8\u5206\u8fa8\u7387',
  'worst quality': '\u6700\u5dee\u8d28\u91cf',
  'bad quality': '\u4f4e\u8d28\u91cf',
  'simple background': '\u7b80\u5355\u80cc\u666f',
  'jpeg artifacts': 'JPEG\u538b\u7f29\u75d5\u8ff9',
  old: '\u8001\u65e7',
  oldest: '\u6700\u8001\u65e7',
  'long bangs': '\u957f\u5218\u6d77',
  'bangs braid': '\u5218\u6d77\u7f16\u53d1',
  clean: '\u5e72\u51c0\u753b\u9762',
  nsfw: '\u6210\u4eba\u5411',
  erotic: '\u60c5\u8272\u611f',
  explicit: '\u660e\u663e\u6210\u4eba\u5185\u5bb9',
  nipples: '\u4e73\u5934',
  nipple: '\u4e73\u5934',
  'large areolae': '\u5927\u4e73\u6655',
  sex: '\u6027\u884c\u4e3a',
  pussy: '\u5973\u6027\u79c1\u5904',
  penis: '\u7537\u6027\u79c1\u5904',
  penetration: '\u63d2\u5165',
  'female masturbation': '\u5973\u6027\u81ea\u6170',
  'doggy style': '\u540e\u5165\u4f53\u4f4d',
  'cowgirl position': '\u5973\u4e0a\u4f4d',
  'bending forward': '\u5411\u524d\u4fef\u8eab',
  'kneeling on bed': '\u8dea\u5728\u5e8a\u4e0a',
  'lying on back': '\u4ef0\u8eba',
  'looking at viewer': '\u770b\u5411\u89c2\u8005',
  'looking away': '\u770b\u5411\u522b\u5904',
  'looking back over shoulder': '\u56de\u5934\u8d8a\u80a9\u770b',
  'helpless expression': '\u65e0\u52a9\u8868\u60c5',
  'blushing heavily': '\u6df1\u5ea6\u8138\u7ea2',
  inviting: '\u9080\u8bf7\u611f',
  embarrassed: '\u5bb3\u7f9e',
  aroused: '\u5174\u594b',
  'sultry expression': '\u59a9\u5a9a\u8868\u60c5',
  'playful sultry expression': '\u4fcf\u76ae\u59a9\u5a9a\u8868\u60c5',
  'submissive sultry expression': '\u987a\u4ece\u59a9\u5a9a\u8868\u60c5',
  'exhausted expression': '\u75b2\u60eb\u8868\u60c5',
  'shy smile': '\u5bb3\u7f9e\u5fae\u7b11',
  'shy blush': '\u5bb3\u7f9e\u8138\u7ea2',
  'sultry smile': '\u59a9\u5a9a\u5fae\u7b11',
  sweat: '\u6c57',
  sweaty: '\u51fa\u6c57',
  glistening: '\u6cdb\u5149',
  'fluids dripping': '\u6db2\u4f53\u6ef4\u843d',
  'wet thighs': '\u6e7f\u6da6\u5927\u817f',
  steam: '\u84b8\u6c7d',
  'cat girl': '\u732b\u5a18',
  succubus: '\u9b45\u9b54',
  'dragon girl': '\u9f99\u5a18',
  '1boy': '\u4e00\u540d\u7537\u5b69',
  '1man': '\u4e00\u540d\u7537\u6027',
  male: '\u7537\u6027',
  'side braid': '\u4fa7\u8fb9\u7f16\u53d1',
  'single braid': '\u5355\u9ebb\u82b1\u8fab',
  'light purple eyes': '\u6d45\u7d2b\u8272\u773c\u775b',
  'amethyst eyes': '\u7d2b\u6c34\u6676\u8272\u773c\u775b',
  'slit eyes': '\u7ec6\u957f\u773c',
  'long golden blonde hair': '\u957f\u91d1\u8272\u5934\u53d1',
  'silver-white hair with purple gradient': '\u5e26\u7d2b\u8272\u6e10\u53d8\u7684\u94f6\u767d\u53d1',
  'silver-grey long straight hair': '\u94f6\u7070\u8272\u957f\u76f4\u53d1',
  'long bangs partly covering one eye': '\u957f\u5218\u6d77\u90e8\u5206\u906e\u4f4f\u4e00\u53ea\u773c',
  'low angle': '\u4f4e\u89d2\u5ea6',
  'foreground foot': '\u524d\u666f\u811a',
  'extreme foreshortening': '\u6781\u5f3a\u900f\u89c6\u7f29\u77ed',
  sole: '\u811a\u5e95',
  'foot close to camera': '\u811a\u9760\u8fd1\u955c\u5934',
  toe: '\u811a\u8dbe',
  'one leg bent': '\u4e00\u6761\u817f\u5f2f\u66f2',
  'one leg up': '\u4e00\u6761\u817f\u62ac\u8d77',
  'knees close to chest': '\u819d\u76d6\u9760\u8fd1\u80f8\u53e3',
  'long legs': '\u957f\u817f',
  skinny: '\u7ea4\u7626',
  'bare leg': '\u88f8\u817f',
  'bare shoulders': '\u88f8\u80a9',
  cleavage: '\u4e73\u6c9f',
  cameltoe: '\u9a86\u9a7c\u8dbe',
  'pussy visible': '\u79c1\u5904\u53ef\u89c1',
  'pussy fully exposed': '\u79c1\u5904\u5b8c\u5168\u66b4\u9732',
  'exposed pussy': '\u66b4\u9732\u79c1\u5904',
  'nipples visible': '\u4e73\u5934\u53ef\u89c1',
  'nipple outline': '\u4e73\u5934\u8f6e\u5ed3',
  'no panties': '\u65e0\u5185\u88e4',
  'no panties under': '\u4e0b\u8eab\u65e0\u5185\u88e4',
  'no shoes': '\u65e0\u978b',
  'black thigh highs': '\u9ed1\u8272\u8fc7\u819d\u889c',
  'fishnet thigh highs': '\u9c7c\u7f51\u8fc7\u819d\u889c',
  'white pantyhose': '\u767d\u8272\u8fde\u88e4\u889c',
  'completely nude except black pantyhose': '\u9664\u9ed1\u8272\u8fde\u88e4\u889c\u5916\u5168\u88f8',
  'completely nude except black garter stockings': '\u9664\u9ed1\u8272\u540a\u5e26\u889c\u5916\u5168\u88f8',
  'completely nude except white garter stockings': '\u9664\u767d\u8272\u540a\u5e26\u889c\u5916\u5168\u88f8',
  'completely nude except black pantyhose stockings': '\u9664\u9ed1\u8272\u8fde\u88e4\u889c\u5916\u5168\u88f8',
  'black lace panties pulled to side': '\u9ed1\u8272\u857e\u4e1d\u5185\u88e4\u62c9\u5230\u4e00\u4fa7',
  'black lace thigh highs': '\u9ed1\u8272\u857e\u4e1d\u8fc7\u819d\u889c',
  'black lace garter belt': '\u9ed1\u8272\u857e\u4e1d\u540a\u889c\u5e26',
  'lace garter belt': '\u857e\u4e1d\u540a\u889c\u5e26',
  'garter belt': '\u540a\u889c\u5e26',
  'lace trim': '\u857e\u4e1d\u8fb9',
  'detailed lace texture': '\u7cbe\u7ec6\u857e\u4e1d\u7eb9\u7406',
  'pink nail polish': '\u7c89\u8272\u6307\u7532\u6cb9',
  'bell choker': '\u94c3\u94db\u9888\u5708',
  tie: '\u9886\u5e26',
  'dark blue blazer': '\u6df1\u84dd\u897f\u88c5\u5916\u5957',
  'black micro miniskirt': '\u9ed1\u8272\u8d85\u77ed\u8ff7\u4f60\u88d9',
  'white blouse open': '\u767d\u8272\u5973\u886c\u886b\u655e\u5f00',
  'white long sleeves': '\u767d\u8272\u957f\u8896',
  'white wide sleeves': '\u767d\u8272\u5bbd\u8896',
  'red silk qipao': '\u7ea2\u8272\u4e1d\u7ef8\u65d7\u888d',
  qipao: '\u65d7\u888d',
  cheongsam: '\u65d7\u888d',
  'high slit cheongsam': '\u9ad8\u5f00\u8869\u65d7\u888d',
  'side slit to hip': '\u4fa7\u5f00\u8869\u5230\u81c0\u90e8',
  hanfu: '\u6c49\u670d',
  'chinese clothes': '\u4e2d\u5f0f\u670d\u88c5',
  'white dress': '\u767d\u8272\u8fde\u8863\u88d9',
  'wearing black negligee': '\u7a7f\u9ed1\u8272\u7761\u88d9',
  'naked apron': '\u88f8\u56f4\u88d9',
  'shiny black full body tight suit': '\u4eae\u9762\u9ed1\u8272\u5168\u8eab\u7d27\u8eab\u8863',
  'black latex leotard': '\u9ed1\u8272\u4e73\u80f6\u7d27\u8eab\u8fde\u4f53\u8863',
  'latex catsuit': '\u4e73\u80f6\u732b\u8863',
  'zipper pulled low': '\u62c9\u94fe\u62c9\u4f4e',
  'gold fasteners': '\u91d1\u8272\u642d\u6263',
  'gold trim': '\u91d1\u8272\u9970\u8fb9',
  'gold embroidery': '\u91d1\u8272\u523a\u7ee3',
  'gold round glasses': '\u91d1\u8272\u5706\u6846\u773c\u955c',
  'gold thin round glasses': '\u7ec6\u91d1\u8272\u5706\u6846\u773c\u955c',
  'mature gentle face': '\u6210\u719f\u6e29\u67d4\u8138',
  'purple dragon horns': '\u7d2b\u8272\u9f99\u89d2',
  'small translucent purple wings': '\u5c0f\u578b\u534a\u900f\u660e\u7d2b\u8272\u7fc5\u8180',
  'train interior': '\u5217\u8f66\u5185\u90e8',
  'candid shot': '\u6293\u62cd\u611f',
  'not looking at camera': '\u4e0d\u770b\u955c\u5934',
  'neon red lighting': '\u9713\u8679\u7ea2\u5149',
  'warm lighting': '\u6696\u5149',
  'lantern light': '\u706f\u7b3c\u5149',
  'simple black background': '\u7b80\u5355\u9ed1\u8272\u80cc\u666f',
  'elegant pose': '\u4f18\u96c5\u59ff\u52bf',
  intimate: '\u4eb2\u5bc6\u611f',
  upskirt: '\u88d9\u5e95\u89c6\u89d2',
  'other hand touching self': '\u53e6\u4e00\u53ea\u624b\u89e6\u78b0\u81ea\u5df1',
  'just the tip': '\u4ec5\u63a5\u89e6\u524d\u7aef',
  'riding crop': '\u9a6c\u97ad',
  'dildo under panties': '\u5185\u88e4\u4e0b\u7684\u5047\u9633\u5177',
  'mingyun_oc': '\u547d\u8fd0OC',
  'mingyun_oc_v2': '\u547d\u8fd0OC v2',
  'xiujia-wai14-v3-000008': '\u79c0\u7532 LoRA',
  'rhasta_il_style_2-000035': 'Rhasta IL\u98ce\u683c LoRA',
  rhasta_style: 'Rhasta\u98ce\u683c',
  'head_size_slider': '\u5934\u90e8\u5927\u5c0f\u8c03\u8282',
  'toybox-xl-ill-v2': 'Toybox XL\u63d2\u753b\u98ce',
  'moria luluka': 'Moria Luluka\u89d2\u8272',
  'togawa sakiko': 'Togawa Sakiko\u89d2\u8272',
}

const translatePromptTag = (tag: string) => {
  const normalized = tag.trim().toLowerCase()
  if (!normalized) return ''
  const direct = promptTranslationOverrides[normalized] || promptTranslationGlossary[normalized]
  if (direct) return direct
  const translated = normalized
    .split(/([_\-\s]+)/)
    .map((part) => promptTranslationOverrides[part] || promptTranslationGlossary[part] || part)
    .join('')
    .replaceAll('_', ' ')
    .trim()
  return translated !== normalized ? translated : '\uFF08\u672A\u6536\u5F55\uFF09'
}

const makeCategoryId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)

const promptPrefixForGateway = (value: string, hasPrompt: boolean) => {
  const prefix = value.trim()
  if (!prefix || !hasPrompt) return prefix
  return /[,，]\s*$/.test(prefix) ? `${prefix} ` : `${prefix}, `
}

const collectStrings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectStrings)
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => {
      if (typeof child === 'string') return [child]
      if (Array.isArray(child)) return collectStrings(child)
      if (child && typeof child === 'object') return collectStrings(child)
      return [key]
    })
  }
  return []
}

const uniqueStrings = (items: string[]) =>
  [...new Set(items.map((item) => item.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right))

const withDefaultCategories = (categories: Category[]) => {
  const merged = [...categories]
  for (const category of initialState.categories) {
    if (!merged.some((item) => item.id === category.id)) merged.push(category)
  }
  return merged.map((category) => {
    const defaultCategory = initialState.categories.find((item) => item.id === category.id)
    if (!defaultCategory?.description || category.description) return category
    return { ...category, description: defaultCategory.description }
  })
}

const withDefaultBaseModelProfiles = (profiles?: Partial<Record<GenerationBaseModel, Partial<BaseModelProfile>>>) => ({
  illustrious: { ...defaultBaseModelProfiles.illustrious, ...(profiles?.illustrious ?? {}) },
  anima: { ...defaultBaseModelProfiles.anima, ...(profiles?.anima ?? {}) },
  krea2: { ...defaultBaseModelProfiles.krea2, ...(profiles?.krea2 ?? {}) },
})

const defaultModelUpscale = (model: string, step: UpscaleStep) =>
  ['sickanime_krea2_v10', 'sickanime', 'krea2_sickanime'].includes(model)
    ? { ...step, sampler: '', scheduler: '' }
    : { ...step }

const baseModelProfileStatePatch = (profile: BaseModelProfile, model: string): Partial<AppState> => ({
  positivePrefix: profile.positivePrefix,
  negativePrefix: profile.negativePrefix,
  preset: profile.preset,
  steps: profile.steps,
  cfg: profile.cfg,
  sampler: profile.sampler,
  scheduler: profile.scheduler,
  ...(profile.width === undefined ? {} : { width: snap8(profile.width) }),
  ...(profile.height === undefined ? {} : { height: snap8(profile.height) }),
  ...(profile.upscaleSteps === undefined ? {} : { upscaleSteps: profile.upscaleSteps.map((step) => defaultModelUpscale(model, step)) }),
})

const withCurrentFilenameDefault = (state: AppState): AppState => {
  state = normalizeMossGeneration(state)
  const nextState = state.filenamePrefix === legacyFilenamePrefix ? { ...state, filenamePrefix: defaultFilenamePrefix } : state
  return {
    ...nextState,
    categories: withDefaultCategories(nextState.categories),
    modelTrainingBases: nextState.modelTrainingBases ?? {},
    baseModelProfiles: withDefaultBaseModelProfiles(nextState.baseModelProfiles),
  }
}

const applyFilenameTemplate = (template: string, characterName: string) =>
  template.replaceAll('%character%', characterName.trim() || '未指定角色')

const extractModelOptions = (payload: unknown): ModelOption[] => {
  const models = payload && typeof payload === 'object' && 'models' in payload ? (payload as { models?: unknown }).models : payload
  if (models && typeof models === 'object' && !Array.isArray(models)) {
    return Object.entries(models)
      .map(([id, value]) => {
        const meta = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
        const label = typeof meta.label === 'string' ? meta.label : id
        const checkpoint = typeof meta.checkpoint === 'string' ? meta.checkpoint : undefined
        const unet = typeof meta.unet === 'string' ? meta.unet : undefined
        const aliases = Array.isArray(meta.aliases) ? meta.aliases.filter((item): item is string => typeof item === 'string') : []
        const contract = meta.upscale_contract && typeof meta.upscale_contract === 'object'
          ? (meta.upscale_contract as Record<string, unknown>)
          : undefined
        const contractType = typeof contract?.type === 'string' ? contract.type : ''
        const minStages = Number(contract?.min_stages)
        const maxStages = Number(contract?.max_stages)
        const upscaleContract = contractType && Number.isFinite(minStages) && Number.isFinite(maxStages)
          ? { type: contractType, minStages, maxStages }
          : undefined
        const trainingFamily = meta.training_family === 'krea2' || meta.training_family === 'anima' || meta.training_family === 'illustrious' ? meta.training_family as GenerationBaseModel : undefined
        const generationDefaults: ModelOption['generationDefaults'] = {}
        for (const [key, field] of [['width', 'default_width'], ['height', 'default_height'], ['steps', 'steps'], ['cfg', 'cfg']] as const) {
          if (typeof meta[field] === 'number' && Number.isFinite(meta[field])) generationDefaults[key] = meta[field]
        }
        if (typeof meta.sampler_name === 'string') generationDefaults.sampler = meta.sampler_name
        if (typeof meta.scheduler === 'string') generationDefaults.scheduler = meta.scheduler
        return { id, label, detail: checkpoint ?? unet, aliases, trainingFamily, generationDefaults, upscaleContract, mossCapabilities: meta.options && typeof meta.options === 'object' ? meta.options as ModelOption['mossCapabilities'] : undefined }
      })
      .filter((item) => item.id)
      .sort((left, right) => left.label.localeCompare(right.label))
  }
  return uniqueStrings(collectStrings(models)).map((id) => ({ id, label: id, aliases: [] }))
}

const normalizeGatewayModel = (model: string, options: ModelOption[], fallback?: string) => {
  const trimmed = model.trim()
  if (!trimmed) return fallback
  if (options.some((option) => option.id === trimmed)) return trimmed
  const lower = trimmed.toLowerCase()
  const matched = options.find((option) =>
    [option.label, option.detail, ...option.aliases].filter(Boolean).some((value) => value?.toLowerCase() === lower),
  )
  return matched?.id ?? fallback
}

const gatewayBase = (gatewayUrl: string) => {
  const trimmed = gatewayUrl.trim().replace(/\/$/, '')
  if (trimmed === 'http://127.0.0.1:8765' || trimmed === 'http://localhost:8765') return '/gateway'
  return trimmed || '/gateway'
}

const isWindowsPath = (value: string) => /^[a-z]:[\\/]/i.test(value) || value.startsWith('\\\\')

const localImageSource = (imagePath?: string) => {
  const trimmed = String(imagePath || '').trim()
  if (!trimmed || !isWindowsPath(trimmed)) return ''
  return `/local-image?path=${encodeURIComponent(trimmed)}`
}

const browserImageSource = (imagePath?: string, imageUrl?: string) => {
  const localSource = localImageSource(imagePath)
  if (localSource) return localSource
  const url = String(imageUrl || imagePath || '').trim()
  if (!url) return ''
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/')) return url
  try {
    const parsed = new URL(url)
    if ((parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.port === '8765') {
      return `/gateway${parsed.pathname}${parsed.search}`
    }
  } catch {
    return url
  }
  return url
}

const localImagePathFromSource = (source: string) => {
  try {
    const parsed = new URL(source, window.location.origin)
    return parsed.pathname === '/local-image' ? parsed.searchParams.get('path') || '' : ''
  } catch {
    return ''
  }
}

const workbenchImageUrlFromSource = (source: string) => {
  try {
    const parsed = new URL(source, window.location.origin)
    if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith('/preview-cache/')) return ''
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return ''
  }
}

const historyImageSource = (item: HistoryItem) => browserImageSource(item.imagePath, item.imageUrl)

const historyThumbnailSource = (item: HistoryItem) => {
  const imagePath = String(item.imagePath || '').trim()
  if (!isWindowsPath(imagePath)) return historyImageSource(item)
  const version = encodeURIComponent(item.createdAt || item.id)
  return `/local-image?path=${encodeURIComponent(imagePath)}&thumbnail=1&v=${version}`
}

const readPngTextChunks = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer)
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 8 || !signature.every((byte, index) => bytes[index] === byte)) throw new Error('不是有效 PNG 文件')
  const view = new DataView(buffer)
  const decoder = new TextDecoder('utf-8')
  const chunks: Record<string, string> = {}
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8))
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > bytes.length) throw new Error('PNG chunk 损坏')
    if (type === 'tEXt') {
      const data = bytes.subarray(dataStart, dataEnd)
      const separator = data.indexOf(0)
      if (separator > 0) {
        const keyword = decoder.decode(data.subarray(0, separator))
        const text = decoder.decode(data.subarray(separator + 1))
        chunks[keyword] = text
      }
    }
    offset = dataEnd + 4
  }
  return chunks
}

const readPresetMetadataFromPng = async (file: File): Promise<PngPresetMetadata> => {
  const chunks = readPngTextChunks(await file.arrayBuffer())
  const raw = chunks[pngPresetKeyword]
  if (!raw) throw new Error('这个 PNG 里没有工作台预设元数据')
  const metadata = JSON.parse(raw) as PngPresetMetadata
  if (metadata.app !== 'comfy-preset-workflow-ui' || metadata.version !== 1 || !metadata.generationPreset) {
    throw new Error('PNG 预设格式不兼容')
  }
  return metadata
}

const blockHasReadablePreset = (block: PresetBlock, statusById: Record<string, PresetSourceStatus>) => statusById[block.id] === 'ready'

const compactPreviewForStorage = (previewImage?: string) => {
  if (!previewImage) return previewImage
  if (previewImage.startsWith('data:') && previewImage.length > 240_000) return ''
  if (/^https?:\/\//i.test(previewImage)) return ''
  return previewImage
}

const compactStateForStorage = (state: AppState): AppState => ({
  ...state,
  blocks: state.blocks.map((block) => ({
    ...block,
    previewImage: compactPreviewForStorage(block.previewImage),
    previewVariants: block.previewVariants
      ?.map((variant) => ({
        ...variant,
        image: compactPreviewForStorage(variant.image) ?? '',
      }))
      .filter((variant) => Boolean(variant.image)),
  })),
  history: state.history.slice(0, 80).map((item) => ({
    ...item,
    imageUrl: item.imageUrl?.startsWith('data:') ? '' : item.imageUrl,
  })),
})

const sharedContentFromState = (state: AppState): SharedContentPayload => ({
  categories: state.categories,
  blocks: state.blocks,
  baseModelProfiles: state.baseModelProfiles,
  generationPresets: state.generationPresets,
})

const stripSyncMetadata = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripSyncMetadata)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'revision' && key !== 'updatedAt' && key !== 'position')
      .map(([key, item]) => [key, stripSyncMetadata(item)]),
  )
}

const sameSharedEntity = (left: unknown, right: unknown) => JSON.stringify(stripSyncMetadata(left)) === JSON.stringify(stripSyncMetadata(right))

const buildSharedOperations = (base: SharedContent, target: SharedContentPayload): SharedOperation[] => {
  const operations: SharedOperation[] = []
  const baseCategories = new Map(base.categories.map((item) => [item.id, item]))
  const targetCategories = new Map(target.categories.map((item) => [item.id, item]))
  const baseBlocks = new Map(base.blocks.map((item) => [item.id, item]))
  const targetBlocks = new Map(target.blocks.map((item) => [item.id, item]))
  const basePresets = new Map(base.generationPresets.map((item) => [item.id, item]))
  const targetPresets = new Map(target.generationPresets.map((item) => [item.id, item]))

  target.categories.forEach((category, index) => {
    const current = baseCategories.get(category.id)
    if (!current) {
      operations.push({ type: 'category.create', payload: { category: stripSyncMetadata(category), index }, label: `新增类目「${category.name}」` })
    } else if (!sameSharedEntity(current, category)) {
      operations.push({
        type: 'category.update',
        payload: { id: category.id, category: stripSyncMetadata(category), baseRevision: current.revision },
        label: `更新类目「${category.name}」`,
      })
    }
  })

  target.blocks.forEach((block, index) => {
    const current = baseBlocks.get(block.id)
    if (!current) {
      operations.push({ type: 'block.create', payload: { block: stripSyncMetadata(block), index }, label: `新增预制块「${block.name}」` })
    } else if (!sameSharedEntity(current, block)) {
      operations.push({
        type: 'block.update',
        payload: { id: block.id, block: stripSyncMetadata(block), baseRevision: current.revision },
        label: `更新预制块「${block.name}」`,
      })
    }
  })

  for (const block of base.blocks) {
    if (!targetBlocks.has(block.id)) {
      operations.push({ type: 'block.delete', payload: { id: block.id, baseRevision: block.revision }, label: `删除预制块「${block.name}」` })
    }
  }
  for (const category of base.categories) {
    if (!targetCategories.has(category.id)) {
      operations.push({ type: 'category.delete', payload: { id: category.id, baseRevision: category.revision }, label: `删除类目「${category.name}」` })
    }
  }

  target.categories.forEach((category, index) => {
    const current = baseCategories.get(category.id)
    if (current && base.categories.findIndex((item) => item.id === category.id) !== index) {
      operations.push({ type: 'category.move', payload: { id: category.id, index }, label: `移动类目「${category.name}」` })
    }
  })
  target.blocks.forEach((block, index) => {
    const current = baseBlocks.get(block.id)
    if (current && base.blocks.findIndex((item) => item.id === block.id) !== index) {
      operations.push({ type: 'block.move', payload: { id: block.id, index }, label: `移动预制块「${block.name}」` })
    }
  })

  target.generationPresets.forEach((preset, index) => {
    const current = basePresets.get(preset.id)
    if (!current) {
      operations.push({ type: 'generation_preset.create', payload: { preset: stripSyncMetadata(preset), index }, label: `新增生成预设「${preset.name}」` })
    } else if (!sameSharedEntity(current, preset)) {
      operations.push({
        type: 'generation_preset.update',
        payload: { preset: stripSyncMetadata(preset), baseRevision: current.revision },
        label: `更新生成预设「${preset.name}」`,
      })
    }
  })
  for (const preset of base.generationPresets) {
    if (!targetPresets.has(preset.id)) {
      operations.push({ type: 'generation_preset.delete', payload: { id: preset.id, baseRevision: preset.revision }, label: `删除生成预设「${preset.name}」` })
    }
  }

  if (!sameSharedEntity(base.baseModelProfiles ?? {}, target.baseModelProfiles ?? {})) {
    operations.push({
      type: 'base_model_profiles.update',
      payload: { baseModelProfiles: stripSyncMetadata(target.baseModelProfiles ?? {}), replace: true, baseRevision: base.baseModelProfilesRevision },
      label: '更新基模基础配置',
    })
  }
  return operations
}

const applySharedOperationsLocally = (source: SharedContent, operations: SharedOperation[]): SharedContentPayload => {
  const next: SharedContentPayload = {
    categories: source.categories.map((item) => ({ ...item })),
    blocks: source.blocks.map((item) => structuredClone(item)),
    baseModelProfiles: structuredClone(source.baseModelProfiles ?? {}),
    generationPresets: source.generationPresets.map((item) => structuredClone(item)),
    revision: source.revision,
    baseModelProfilesRevision: source.baseModelProfilesRevision,
  }
  const move = <T extends { id: string }>(items: T[], id: string, index: number) => {
    const currentIndex = items.findIndex((item) => item.id === id)
    if (currentIndex < 0) return
    const [item] = items.splice(currentIndex, 1)
    items.splice(Math.max(0, Math.min(items.length, index)), 0, item)
  }
  for (const operation of operations) {
    const payload = operation.payload
    const id = String(payload.id || '')
    if (operation.type === 'category.create') {
      next.categories.splice(Number(payload.index ?? next.categories.length), 0, structuredClone(payload.category as Category))
    } else if (operation.type === 'category.update') {
      next.categories = next.categories.map((item) => (item.id === id ? { ...item, ...(payload.category as Category), revision: item.revision } : item))
    } else if (operation.type === 'category.delete') {
      next.categories = next.categories.filter((item) => item.id !== id)
    } else if (operation.type === 'category.move') {
      move(next.categories, id, Number(payload.index || 0))
    } else if (operation.type === 'block.create') {
      next.blocks.splice(Number(payload.index ?? next.blocks.length), 0, structuredClone(payload.block as PresetBlock))
    } else if (operation.type === 'block.update') {
      next.blocks = next.blocks.map((item) => (item.id === id ? { ...item, ...(structuredClone(payload.block) as PresetBlock), revision: item.revision } : item))
    } else if (operation.type === 'block.delete') {
      next.blocks = next.blocks.filter((item) => item.id !== id)
    } else if (operation.type === 'block.move') {
      move(next.blocks, id, Number(payload.index || 0))
    } else if (operation.type === 'generation_preset.create') {
      next.generationPresets.splice(Number(payload.index ?? 0), 0, structuredClone(payload.preset as GenerationPreset))
    } else if (operation.type === 'generation_preset.update') {
      const preset = payload.preset as GenerationPreset
      next.generationPresets = next.generationPresets.map((item) => (item.id === preset.id ? { ...item, ...structuredClone(preset), revision: item.revision } : item))
    } else if (operation.type === 'generation_preset.delete') {
      next.generationPresets = next.generationPresets.filter((item) => item.id !== id)
    } else if (operation.type === 'base_model_profiles.update') {
      next.baseModelProfiles = structuredClone((payload.baseModelProfiles as SharedContentPayload['baseModelProfiles']) ?? {})
    }
  }
  return next
}

const generationTimingKey = (body: Record<string, unknown>) =>
  JSON.stringify({
    model: body.model,
    preset: body.preset,
    width: body.width,
    height: body.height,
    steps: body.steps,
    cfg: body.cfg,
    sampler_name: body.sampler_name,
    scheduler: body.scheduler,
    loras: body.loras,
    upscale_scale: body.upscale_scale,
    upscale_mode: body.upscale_mode,
    stage_upscale_scale: body.stage_upscale_scale,
    second_stage_upscale_scale: body.second_stage_upscale_scale,
    second_steps: body.second_steps,
    second_cfg: body.second_cfg,
    second_denoise: body.second_denoise,
    second_sampler_name: body.second_sampler_name,
    second_scheduler: body.second_scheduler,
    third_steps: body.third_steps,
    third_cfg: body.third_cfg,
    third_denoise: body.third_denoise,
    third_sampler_name: body.third_sampler_name,
    third_scheduler: body.third_scheduler,
  })

const estimateGenerationMs = (history: HistoryItem[], timingKey: string) => {
  const exact = history.find((item) => item.timingKey === timingKey && item.durationMs)
  if (exact?.durationMs) return exact.durationMs
  const recent = history.map((item) => item.durationMs).filter((value): value is number => Boolean(value)).slice(0, 5)
  if (recent.length === 0) return 45_000
  return Math.round(recent.reduce((sum, value) => sum + value, 0) / recent.length)
}

const formatRemainingTime = (milliseconds: number) => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`
}

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  })

const getImageDimensionsFromSource = (source: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onerror = () => reject(new Error('图片尺寸读取失败'))
    image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height })
    image.src = source
  })

const getImageDimensionsFromFile = async (file: File) => getImageDimensionsFromSource(await fileToDataUrl(file))

const previewFitForDimensions = ({ width, height }: { width: number; height: number }): PreviewImageMode | undefined =>
  height / Math.max(1, width) >= 1.15 ? 'background' : undefined

const imageFileFromSource = async (source: string, fileName = 'dragged-image.png') => {
  const response = await fetch(source)
  if (!response.ok) throw new Error(`图片读取失败: ${response.status}`)
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) throw new Error('拖入内容不是图片')
  return new File([blob], fileName, { type: blob.type || 'image/png' })
}

const isImageFile = (file: File) => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name)

const imageFileFromDataTransfer = (dataTransfer: DataTransfer) => {
  const directFile = Array.from(dataTransfer.files).find(isImageFile)
  if (directFile) return directFile
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file && isImageFile(file)) return file
  }
  return undefined
}

const imageSourceFromHtml = (htmlValue: string) => {
  const html = htmlValue.trim()
  if (!html) return ''
  try {
    return new DOMParser().parseFromString(html, 'text/html').querySelector('img[src]')?.getAttribute('src')?.trim() || ''
  } catch {
    return ''
  }
}

const readDataTransferString = (dataTransfer: DataTransfer, type: string) => {
  const direct = dataTransfer.getData(type)
  if (direct) return Promise.resolve(direct)
  const item = Array.from(dataTransfer.items).find((candidate) => candidate.kind === 'string' && candidate.type === type)
  if (!item) return Promise.resolve('')
  return new Promise<string>((resolve) => {
    let settled = false
    const finish = (value: string) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      item.getAsString((value) => finish(value || ''))
      window.setTimeout(() => finish(''), 300)
    } catch {
      finish('')
    }
  })
}

const dragSourceKind = (value: string) => {
  const source = value.trim()
  if (!source) return '无'
  if (source.startsWith('data:image')) return 'data:image'
  if (source.startsWith('blob:')) return 'blob'
  if (source.startsWith('/preview-cache/')) return '工作台资源'
  if (source.startsWith('/local-image')) return '工作台本地图'
  if (/^https?:\/\//i.test(source)) return 'HTTP图片'
  if (source.startsWith('/')) return '站内路径'
  return '非图片文本'
}

const describeImageDrop = (dataTransfer: DataTransfer) => {
  const types = Array.from(dataTransfer.types)
  const files = Array.from(dataTransfer.files)
  const items = Array.from(dataTransfer.items)
  const uri = dataTransfer.getData('text/uri-list').split(/\r?\n/).find((line) => line && !line.startsWith('#')) || ''
  const text = dataTransfer.getData('text/plain')
  const htmlSource = imageSourceFromHtml(dataTransfer.getData('text/html'))
  return [
    `types=[${types.join(',') || '无'}]`,
    `files=${files.length}${files[0] ? `(${files[0].name || '未命名'}:${files[0].type || '未知'}:${files[0].size}B)` : ''}`,
    `items=[${items.map((item) => `${item.kind}:${item.type || '未知'}`).join(',') || '无'}]`,
    `内部载荷=${dataTransfer.getData(dragImageMime) ? '有' : '无'}`,
    `URI=${dragSourceKind(uri)}`,
    `文本=${dragSourceKind(text)}`,
    `HTML图片=${dragSourceKind(htmlSource)}`,
  ].join(' · ')
}

const dragImagePayloadFromDataTransfer = (dataTransfer: DataTransfer): DragImagePayload | undefined => {
  const payloadText = dataTransfer.getData(dragImageMime)
  if (!payloadText) return undefined
  try {
    const payload = JSON.parse(payloadText) as DragImagePayload
    return payload && typeof payload === 'object' ? payload : undefined
  } catch {
    return undefined
  }
}

const makePreviewThumbnailFromSource = (source: string, maxSize = 512) =>
  new Promise<string>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onerror = () => reject(new Error('预览图解码失败'))
    image.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height))
      const width = Math.max(1, Math.round(image.width * scale))
      const height = Math.max(1, Math.round(image.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')?.drawImage(image, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(canvas.toDataURL('image/jpeg', 0.82))
            return
          }
          const blobReader = new FileReader()
          blobReader.onerror = () => reject(new Error('缩略图缓存失败'))
          blobReader.onload = () => resolve(String(blobReader.result ?? ''))
          blobReader.readAsDataURL(blob)
        },
        'image/webp',
        0.82,
      )
    }
    image.src = source
  })

const makePreviewThumbnail = (file: File, maxSize = 512) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('预览图读取失败'))
    reader.onload = () => {
      makePreviewThumbnailFromSource(String(reader.result ?? ''), maxSize).then(resolve, reject)
    }
    reader.readAsDataURL(file)
  })

function App() {
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem(storageKey)
    if (!saved) return initialState
    try {
      return withCurrentFilenameDefault({ ...initialState, ...JSON.parse(saved) })
    } catch {
      return initialState
    }
  })
  const [activeCategoryId, setActiveCategoryId] = useState(state.categories[0]?.id ?? 'character')
  const [editMode, setEditMode] = useState(false)
  const [editingBlockDraft, setEditingBlockDraft] = useState<PresetBlock | null>(null)
  const [editingBlockBase, setEditingBlockBase] = useState<PresetBlock | null>(null)
  const [editingBlockInsertIndex, setEditingBlockInsertIndex] = useState(0)
  const [editorOpen, setEditorOpen] = useState(false)
  const [translatedPromptField, setTranslatedPromptField] = useState<'positive' | 'negative' | null>(null)
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false)
  const [categorySearch, setCategorySearch] = useState('')
  const [cardSize, setCardSize] = useState<CardSizeMode>(readCardSize)
  const [cardAspect, setCardAspect] = useState<CardAspectMode>(readCardAspect)
  const [recentBlockIds, setRecentBlockIds] = useState<string[]>(readRecentBlockIds)
  const [colorPromptCollapsed, setColorPromptCollapsed] = useState(true)
  const [presetSourceFilter, setPresetSourceFilter] = useState<PresetSourceFilter>('all')
  const [blockPresetStatus, setBlockPresetStatus] = useState<Record<string, PresetSourceStatus>>({})
  const [blockPresetSources, setBlockPresetSources] = useState<Record<string, PresetSourceReference>>({})
  const [visibleLoraBaseModels, setVisibleLoraBaseModels] = useState<Record<LoraBaseModel, boolean>>(readLoraBaseVisibility)
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<string[]>(readCollapsedCategoryIds)
  const [loraDraft, setLoraDraft] = useState('')
  const [selectedBlockDragId, setSelectedBlockDragId] = useState('')
  const [selectedBlockDropId, setSelectedBlockDropId] = useState('')
  const [loraDragIndex, setLoraDragIndex] = useState<number | null>(null)
  const [loraDropIndex, setLoraDropIndex] = useState<number | null>(null)
  const [loraBaseFilter, setLoraBaseFilter] = useState<'all' | LoraBaseModel | 'unknown'>(readLoraBaseFilter)
  const [models, setModels] = useState<ModelOption[]>([])
  const [loras, setLoras] = useState<string[]>([])
  const [status, setStatusValue] = useState('未连接')
  const [messages, setMessages] = useState<WorkbenchMessage[]>(readWorkbenchMessages)
  const [messageCenterOpen, setMessageCenterOpen] = useState(false)
  const [messageUnread, setMessageUnread] = useState(0)
  const [isGenerating, setIsGenerating] = useState(false)
  const [resultImage, setResultImage] = useState('')
  const [resultImagePath, setResultImagePath] = useState('')
  const [resultHistoryId, setResultHistoryId] = useState('')
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false)
  const [imagePreviewTarget, setImagePreviewTarget] = useState<ImagePreviewTarget | null>(null)
  const [albumCollapsed, setAlbumCollapsed] = useState(readAlbumCollapsed)
  const [albumMenu, setAlbumMenu] = useState<{ item?: HistoryItem; source?: DragImagePayload; x: number; y: number } | null>(null)
  const albumMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!albumMenu) return
    albumMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const close = () => setAlbumMenu(null)
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', keydown, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', keydown, true)
    }
  }, [albumMenu])
  const [albumLongPressItemId, setAlbumLongPressItemId] = useState('')
  const [focusedCategoryId, setFocusedCategoryId] = useState('')
  const [pageImageDragActive, setPageImageDragActive] = useState(false)
  const [presetDropActive, setPresetDropActive] = useState(false)
  const [promptDropActive, setPromptDropActive] = useState(false)
  const [blockDropTargetId, setBlockDropTargetId] = useState('')
  const [generationQueue, setGenerationQueue] = useState<GenerationJob[]>([])
  const [currentJob, setCurrentJob] = useState<GenerationJob | null>(null)
  const [currentJobStartedAt, setCurrentJobStartedAt] = useState(0)
  const [nowMs, setNowMs] = useState(Date.now())
  const [authStatus, setAuthStatus] = useState<ShareAuthStatus>({
    authenticated: false,
    locked: false,
    lockSeconds: 0,
  })
  const [authChecked, setAuthChecked] = useState(false)
  const [accessKeyInput, setAccessKeyInput] = useState('')
  const [authError, setAuthError] = useState('')
  const [sharedGeneration, setSharedGeneration] = useState<SharedGenerationStatus>({ active: false })
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const clientIdRef = useRef(getClientId())
  const lastSharedContentRef = useRef('')
  const lastSharedContentValueRef = useRef<SharedContent | null>(null)
  const currentSharedContentRef = useRef<SharedContentPayload>(sharedContentFromState(state))
  const lastSharedRevisionRef = useRef(0)
  const lastWorkbenchUiStateRef = useRef('')
  const categoryGridRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const sharedContentTimerRef = useRef<number | null>(null)
  const suppressSelectedBlockClickRef = useRef(false)
  const selectedBlockDragIdRef = useRef('')
  const draggedWorkbenchImage = useRef<DragImagePayload | null>(null)
  const selectedBlockPointerTimerRef = useRef<number | null>(null)
  const selectedBlockPointerDragRef = useRef<{
    pointerId: number
    blockId: string
    targetBlockId: string
    startX: number
    startY: number
    active: boolean
  } | null>(null)
  const albumLongPressTimerRef = useRef<number | null>(null)
  const albumLongPressRef = useRef<{ itemId: string; clientX: number; clientY: number; triggered: boolean } | null>(null)
  const suppressAlbumClickRef = useRef(false)
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null)
  const messageCenterOpenRef = useRef(false)
  const lastSharedGenerationEventRef = useRef('')
  const generationQueueRef = useRef<GenerationJob[]>([])
  const sharedSyncQueueRef = useRef<Promise<void>>(Promise.resolve())
  const sharedSyncActiveRef = useRef(false)
  const [masonryColumnCounts, setMasonryColumnCounts] = useState<Record<string, number>>({})

  const setStatus = useCallback((value: string) => {
    const text = String(value || '').trim()
    if (!text) return
    setStatusValue(text)
    const createdAt = Date.now()
    setMessages((current) => {
      if (current[0]?.text === text && createdAt - current[0].createdAt < 1200) return current
      return [{ id: makeId('message'), text, createdAt, tone: messageTone(text) }, ...current].slice(0, 80)
    })
    if (!messageCenterOpenRef.current) setMessageUnread((current) => Math.min(99, current + 1))
  }, [])

  const toggleMessageCenter = useCallback(() => {
    setMessageCenterOpen((current) => {
      const next = !current
      messageCenterOpenRef.current = next
      if (next) setMessageUnread(0)
      return next
    })
  }, [])

  useEffect(() => {
    localStorage.setItem(messageHistoryKey, JSON.stringify(messages))
  }, [messages])

  const askConfirm = useCallback((dialog: ConfirmDialogState) => {
    confirmResolverRef.current?.(false)
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve
      setConfirmDialog(dialog)
    })
  }, [])

  const activeVisiblePreviewBase = useMemo<LoraBaseModel | undefined>(() => {
    const visibleBases = loraBaseModelOptions.map((option) => option.id).filter((baseModel) => visibleLoraBaseModels[baseModel])
    return visibleBases.length === 1 ? visibleBases[0] : undefined
  }, [visibleLoraBaseModels])

  const previewFilterForBlock = useCallback(
    (block?: PresetBlock): 'all' | LoraBaseModel | 'unknown' => {
      if (loraBaseFilter !== 'all' && loraBaseFilter !== 'unknown') return loraBaseFilter
      if (activeVisiblePreviewBase) return activeVisiblePreviewBase
      const blockBases = block ? blockLoraBaseModels(block) : []
      return blockBases.length === 1 ? blockBases[0] : 'all'
    },
    [activeVisiblePreviewBase, loraBaseFilter],
  )

  const previewBaseForBlock = useCallback((block?: PresetBlock) => previewBaseForFilter(previewFilterForBlock(block), block), [previewFilterForBlock])

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(compactStateForStorage(state)))
    } catch {
      try {
        const slimState = compactStateForStorage({ ...state, blocks: [], history: [] })
        localStorage.setItem(storageKey, JSON.stringify(slimState))
      } catch {
        localStorage.removeItem(storageKey)
      }
    }
  }, [state])

  useEffect(() => {
    const validCategoryIds = new Set(state.categories.map((category) => category.id))
    const validCollapsedCategoryIds = collapsedCategoryIds.filter((id) => validCategoryIds.has(id))
    try {
      localStorage.setItem(categoryCollapseKey, JSON.stringify(validCollapsedCategoryIds))
    } catch {
      localStorage.removeItem(categoryCollapseKey)
    }
    if (validCollapsedCategoryIds.length !== collapsedCategoryIds.length) setCollapsedCategoryIds(validCollapsedCategoryIds)
  }, [collapsedCategoryIds, state.categories])

  useEffect(() => {
    try {
      localStorage.setItem(loraBaseVisibilityKey, JSON.stringify(visibleLoraBaseModels))
    } catch {
      localStorage.removeItem(loraBaseVisibilityKey)
    }
  }, [visibleLoraBaseModels])

  useEffect(() => {
    try {
      localStorage.setItem(loraBaseFilterKey, loraBaseFilter)
    } catch {
      localStorage.removeItem(loraBaseFilterKey)
    }
  }, [loraBaseFilter])

  useEffect(() => {
    const availableBlockIds = new Set(state.blocks.map((block) => block.id))
    const validRecentBlockIds = recentBlockIds.filter((id) => availableBlockIds.has(id)).slice(0, 16)
    try {
      localStorage.setItem(recentBlockIdsKey, JSON.stringify(validRecentBlockIds))
    } catch {
      localStorage.removeItem(recentBlockIdsKey)
    }
    if (validRecentBlockIds.length !== recentBlockIds.length) setRecentBlockIds(validRecentBlockIds)
  }, [recentBlockIds, state.blocks])

  useEffect(() => {
    try {
      localStorage.setItem(cardSizeKey, cardSize)
    } catch {
      localStorage.removeItem(cardSizeKey)
    }
  }, [cardSize])

  useEffect(() => {
    try {
      localStorage.setItem(cardAspectKey, cardAspect)
    } catch {
      localStorage.removeItem(cardAspectKey)
    }
  }, [cardAspect])

  useEffect(() => {
    try {
      localStorage.setItem(albumCollapseKey, albumCollapsed ? '1' : '0')
    } catch {
      localStorage.removeItem(albumCollapseKey)
    }
  }, [albumCollapsed])

  useEffect(() => {
    if (!currentJob) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [currentJob])

  useEffect(() => {
    let dragDepth = 0
    const hasImageLikeDragData = (event: globalThis.DragEvent) => {
      const types = Array.from(event.dataTransfer?.types ?? [])
      if (selectedBlockDragIdRef.current || types.includes(selectedBlockDragMime)) return false
      return types.includes('Files') || types.includes(dragImageMime) || types.includes('text/uri-list') || types.includes('text/plain') || types.includes('text/html')
    }
    const handleDragEnter = (event: globalThis.DragEvent) => {
      if (!hasImageLikeDragData(event)) return
      dragDepth += 1
      setPageImageDragActive(true)
    }
    const handleDragOver = (event: globalThis.DragEvent) => {
      if (!hasImageLikeDragData(event)) return
      event.preventDefault()
      setPageImageDragActive(true)
    }
    const handleDragLeave = () => {
      dragDepth = Math.max(0, dragDepth - 1)
      if (dragDepth === 0) setPageImageDragActive(false)
    }
    const handleDragEnd = () => {
      dragDepth = 0
      draggedWorkbenchImage.current = null
      setPageImageDragActive(false)
      setPromptDropActive(false)
      setPresetDropActive(false)
      setBlockDropTargetId('')
    }
    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDragEnd)
    window.addEventListener('dragend', handleDragEnd)
    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDragEnd)
      window.removeEventListener('dragend', handleDragEnd)
    }
  }, [])

  useEffect(() => {
    const loadAuthStatus = async () => {
      try {
        const res = await fetch('/share-auth/status')
        const data = await res.json()
        setAuthStatus({
          authenticated: Boolean(data.authenticated),
          locked: Boolean(data.locked),
          lockSeconds: Number(data.lockSeconds || 0),
        })
      } catch {
        setAuthStatus({ authenticated: true, locked: false, lockSeconds: 0 })
      } finally {
        setAuthChecked(true)
      }
    }
    void loadAuthStatus()
  }, [])

  useEffect(() => {
    if (!authStatus.authenticated) return
    let cancelled = false
    const previewSourcesForBlock = (block: PresetBlock) => {
      const preview = blockPreviewDisplay(block, previewFilterForBlock(block))
      const candidates: PresetSourceReference[] = [
        { imagePath: preview.sourceImagePath?.trim(), imageUrl: preview.sourceImageUrl?.trim() },
        { imagePath: block.previewSourceImagePath?.trim(), imageUrl: block.previewSourceImageUrl?.trim() },
        ...(block.previewVariants ?? []).map((variant) => ({
          imagePath: variant.sourceImagePath?.trim(),
          imageUrl: variant.sourceImageUrl?.trim(),
        })),
      ]
      const seen = new Set<string>()
      return candidates.filter((candidate) => {
        if (!candidate.imagePath && !candidate.imageUrl) return false
        const key = `${candidate.imagePath || ''}\n${candidate.imageUrl || ''}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
    const blocksWithSources = state.blocks
      .map((block) => ({ block, sources: previewSourcesForBlock(block) }))
      .filter((item) => item.sources.length > 0)
    const sourceIds = new Set(blocksWithSources.map((item) => item.block.id))

    setBlockPresetStatus((current) => {
      const next: Record<string, PresetSourceStatus> = {}
      for (const block of state.blocks) next[block.id] = sourceIds.has(block.id) ? current[block.id] ?? 'checking' : 'none'
      return next
    })

    if (blocksWithSources.length === 0) {
      setBlockPresetSources({})
      return
    }

    const checkBlock = async (item: { block: PresetBlock; sources: PresetSourceReference[] }): Promise<{
      id: string
      status: PresetSourceStatus
      source?: PresetSourceReference
    }> => {
      for (const source of item.sources) {
        try {
          const response = await fetch('/png-preset/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(source),
          })
          const data = await response.json()
          if (response.ok && data?.hasPreset) return { id: item.block.id, status: 'ready', source }
        } catch {
          // Try the next backend-owned source attached to this block.
        }
      }
      return { id: item.block.id, status: 'none' }
    }

    void Promise.all(blocksWithSources.map(checkBlock)).then((results) => {
      if (cancelled) return
      setBlockPresetStatus(Object.fromEntries(state.blocks.map((block) => [block.id, results.find((item) => item.id === block.id)?.status ?? 'none'])))
      setBlockPresetSources(
        Object.fromEntries(results.filter((item) => item.status === 'ready' && item.source).map((item) => [item.id, item.source as PresetSourceReference])),
      )
    })

    return () => {
      cancelled = true
    }
  }, [authStatus.authenticated, previewFilterForBlock, state.blocks])

  const selectedBlocks = useMemo(
    () => state.selectedBlockIds.map((id) => state.blocks.find((block) => block.id === id)).filter(Boolean) as PresetBlock[],
    [state.blocks, state.selectedBlockIds],
  )
  const recentBlocks = useMemo(
    () =>
      recentBlockIds
        .map((id) => state.blocks.find((block) => block.id === id))
        .filter((block): block is PresetBlock => Boolean(block))
        .filter((block) => !state.selectedBlockIds.includes(block.id)),
    [recentBlockIds, state.blocks, state.selectedBlockIds],
  )

  const modelOptions = useMemo(() => {
    if (models.length > 0) return models
    return state.model ? [{ id: state.model, label: state.model, aliases: [] }] : []
  }, [models, state.model])

  const selectedModelOption = useMemo(
    () => modelOptions.find((model) => model.id === state.model) ?? { id: state.model, label: state.model, aliases: [] },
    [modelOptions, state.model],
  )

  const selectedModelTrainingBase = useMemo<ModelTrainingBase>(() => {
    const marked = state.modelTrainingBases[state.model]
    if (marked) return marked
    return inferModelTrainingBase(selectedModelOption) ?? 'none'
  }, [selectedModelOption, state.model, state.modelTrainingBases])

  const selectedUsesKrea2Hires = selectedModelOption.upscaleContract?.type === 'krea2_hires'
    || (selectedModelTrainingBase === 'krea2' && !selectedModelOption.upscaleContract)

  const selectedBaseModelProfile = selectedModelTrainingBase === 'none' ? undefined : state.baseModelProfiles[selectedModelTrainingBase]
  const resolutionAlignment = isMossModel(state.model) ? 16 : 8
  const resolutionMaximum = isMossModel(state.model) ? 4096 : 2048
  const smallerResolution = stepResolution(state.width, state.height, -1, resolutionAlignment, resolutionMaximum)
  const largerResolution = stepResolution(state.width, state.height, 1, resolutionAlignment, resolutionMaximum)

  const krea2UpscaleValidation = useMemo(() => {
    if (state.faceDetail && (!selectedModelOption.mossCapabilities?.face_detail || selectedModelOption.mossCapabilities.face_detail.available === false)) return `重绘面部不可用：${selectedModelOption.mossCapabilities?.face_detail?.missing?.join('、') || '当前模型未提供修脸能力'}`
    if (isMossModel(state.model)) {
      for (const [enabled, field] of [[state.mossOptions?.dmd, 'moss_dmd'], [state.mossOptions?.faceRedraw, 'face_detail']] as const) {
        const capability = selectedModelOption.mossCapabilities?.[field]
        if (enabled && (!capability || capability.available === false)) return `MOSS ${field === 'moss_dmd' ? 'DMD 加速' : '重绘面部'}不可用：${capability?.missing?.join('、') || '请更新网关或刷新模型能力'}`
      }
    }
    if (isMossModel(state.model)) return state.width % 16 || state.height % 16 || state.width < 64 || state.height < 64 || state.width > 4096 || state.height > 4096 ? 'MOSS 基础宽高须为 64–4096 内的 16 倍数' : ''
    if (!selectedUsesKrea2Hires) return ''
    const enabledCount = state.upscaleSteps.filter((step) => step.enabled).length
    const minStages = selectedModelOption.upscaleContract?.minStages ?? 1
    const maxStages = selectedModelOption.upscaleContract?.maxStages ?? 2
    if (enabledCount < minStages) return `K2 至少需要 ${minStages} 个潜空间高清重绘阶段`
    if (enabledCount > maxStages) return `K2 最多支持 ${maxStages} 个高清阶段`
    return ''
  }, [selectedModelOption.upscaleContract, selectedModelOption.mossCapabilities, selectedUsesKrea2Hires, state.upscaleSteps, state.model, state.width, state.height, state.mossOptions, state.faceDetail])

  const inferPreviewBaseFromMetadata = (metadata: Partial<PngPresetMetadata>): LoraBaseModel | undefined => {
    const generationPreset = metadata.generationPreset as Partial<GenerationPreset> | undefined
    const requestBody = metadata.requestBody ?? {}
    const modelId = String(generationPreset?.model || requestBody.model || requestBody.diffusion_model || requestBody.unet || '').trim()
    const marked = nonNoneBase(state.modelTrainingBases[modelId])
    if (marked) return marked
    const modelOption = modelOptions.find((model) => model.id === modelId || model.aliases.includes(modelId))
    const inferredModel = nonNoneBase(inferModelTrainingBase(modelOption ?? { id: modelId, label: modelId, aliases: [] }))
    if (inferredModel) return inferredModel
    const selectedLoraBases = [
      ...new Set(
        (metadata.selectedBlocks ?? [])
          .flatMap((block) => block.loras ?? [])
          .flatMap((lora) => inferLoraBaseModels(lora.name)),
      ),
    ]
    return selectedLoraBases.length === 1 ? selectedLoraBases[0] : undefined
  }

  const sizePresetValue = useMemo(() => {
    const preset = sizePresets.find((item) => item.width === state.width && item.height === state.height)
    return preset ? `${preset.width}x${preset.height}` : 'custom'
  }, [state.height, state.width])

  const aspectRatio = useMemo(() => {
    const width = snap8(state.width)
    const height = snap8(state.height)
    const divisor = gcd(width, height)
    return `${width / divisor}:${height / divisor}`
  }, [state.height, state.width])

  const aspectPreviewStyle = useMemo(() => {
    const maxWidth = 56
    const maxHeight = 56
    const width = snap8(state.width)
    const height = snap8(state.height)
    const scale = Math.min(maxWidth / width, maxHeight / height)
    return {
      width: `${Math.max(8, Math.round(width * scale))}px`,
      height: `${Math.max(8, Math.round(height * scale))}px`,
    }
  }, [state.height, state.width])

  const visibleCategories = useMemo(() => {
    const query = categorySearch.trim().toLowerCase()
    const selectedIds = new Set(state.selectedBlockIds)
    return state.categories
      .map((category) => {
        const blocks = state.blocks.filter((block) => {
          if (block.categoryId !== category.id) return false
          const blockBaseModels = blockLoraBaseModels(block)
          if (blockBaseModels.some((baseModel) => !visibleLoraBaseModels[baseModel])) return false
          const hasReadablePreset = blockHasReadablePreset(block, blockPresetStatus)
          if (presetSourceFilter === 'with' && !hasReadablePreset) return false
          if (presetSourceFilter === 'without' && hasReadablePreset) return false
          if (!query) return true
          return [block.name, block.notes ?? '', ...block.positive, ...block.negative, ...block.tags].join(' ').toLowerCase().includes(query)
        })
        const selectedCount = state.blocks.filter((block) => block.categoryId === category.id && selectedIds.has(block.id)).length
        return { ...category, blocks, selectedCount }
      })
      .filter((category) => category.blocks.length > 0 || category.name.toLowerCase().includes(query))
  }, [blockPresetStatus, categorySearch, presetSourceFilter, state.blocks, state.categories, state.selectedBlockIds, visibleLoraBaseModels])

  const displayedCategories = useMemo(() => {
    if (!focusedCategoryId) return visibleCategories
    const focused = visibleCategories.filter((category) => category.id === focusedCategoryId)
    return focused.length ? focused : visibleCategories
  }, [focusedCategoryId, visibleCategories])

  const displayedCategoryIds = useMemo(() => displayedCategories.map((category) => category.id).join('|'), [displayedCategories])

  useEffect(() => {
    if (cardAspect !== 'masonry') return
    const updateColumnCounts = () => {
      const minWidth = cardSizeMinPixels[cardSize]
      const gap = cardSizeGapPixels[cardSize]
      const next: Record<string, number> = {}
      for (const category of displayedCategories) {
        const grid = categoryGridRefs.current[category.id]
        const width = grid?.clientWidth || 0
        next[category.id] = width > 0 ? Math.max(1, Math.floor((width + gap) / (minWidth + gap))) : 1
      }
      setMasonryColumnCounts((current) => {
        const currentJson = JSON.stringify(current)
        const nextJson = JSON.stringify(next)
        return currentJson === nextJson ? current : next
      })
    }

    updateColumnCounts()
    const observer = new ResizeObserver(updateColumnCounts)
    for (const category of displayedCategories) {
      const grid = categoryGridRefs.current[category.id]
      if (grid) observer.observe(grid)
    }
    window.addEventListener('resize', updateColumnCounts)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateColumnCounts)
    }
  }, [cardAspect, cardSize, displayedCategories, displayedCategoryIds])

  const filteredLoras = useMemo(() => {
    const terms = loraDraft
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
    const baseFiltered =
      loraBaseFilter === 'all'
        ? loras
        : loras.filter((lora) => {
            const inferred = inferLoraBaseModels(lora)
            return loraBaseFilter === 'unknown' ? inferred.length === 0 : inferred.includes(loraBaseFilter)
          })
    const source = terms.length > 0 ? baseFiltered.filter((lora) => terms.every((term) => lora.toLowerCase().includes(term))) : baseFiltered
    return source.slice(0, 80)
  }, [loraBaseFilter, loraDraft, loras])

  const composed = useMemo(() => {
    const promptParts = [...state.selectedColorPrompts, ...selectedBlocks.flatMap((block) => block.positive), state.customPositivePrompt.trim()]
    const negative = [state.negativePrefix, ...selectedBlocks.flatMap((block) => block.negative)]
    const selectedLoras = selectedBlocks.flatMap((block) => block.loras)
    const prompt = joinPrompt(promptParts)
    const prefix = promptPrefixForGateway(state.positivePrefix, Boolean(prompt))
    return {
      prefix,
      prompt,
      previewPrompt: joinPrompt([state.positivePrefix, prompt]),
      negative: joinPrompt(negative),
      loras: selectedLoras,
    }
  }, [selectedBlocks, state.customPositivePrompt, state.negativePrefix, state.positivePrefix, state.selectedColorPrompts])

  const selectedCharacterName = useMemo(() => {
    const characterBlocks = selectedBlocks.filter((block) => block.categoryId === 'character')
    return characterBlocks.map((block) => block.name).join('+') || '未指定角色'
  }, [selectedBlocks])

  const defaultGenerationPresetName = useMemo(
    () => `${selectedCharacterName} ${state.width}x${state.height}`,
    [selectedCharacterName, state.height, state.width],
  )

  const sharedGenerationLabel = useMemo(() => {
    if (!sharedGeneration.active) return '全局: 空闲'
    const phase = sharedGeneration.phase === 'queued' ? '排队' : sharedGeneration.phase === 'dry_run' ? 'Dry Run' : sharedGeneration.phase === 'canceling' ? '取消中' : '生图中'
    const owner = sharedGeneration.source?.startsWith('agent')
      ? sharedGeneration.actorName || 'Agent'
      : sharedGeneration.owner === clientIdRef.current
        ? '本机'
        : '远端'
    const size = sharedGeneration.width && sharedGeneration.height ? `${sharedGeneration.width}x${sharedGeneration.height}` : ''
    const waitingCount = Math.max(0, Number(sharedGeneration.queueLength) || 0)
    const counts = sharedGeneration.phase === 'queued'
      ? ` · 队列中: ${waitingCount}`
      : ` · 当前: 1 · 等待: ${waitingCount}`
    return `全局: ${owner} ${phase}${size ? ` · ${size}` : ''}${sharedGeneration.model ? ` · ${sharedGeneration.model}` : ''}${counts}`
  }, [sharedGeneration])

  useEffect(() => {
    const eventKey = `${sharedGeneration.updatedAt || 0}:${sharedGeneration.phase || ''}:${sharedGeneration.active ? 1 : 0}`
    if (eventKey === lastSharedGenerationEventRef.current) return
    const hadPreviousEvent = Boolean(lastSharedGenerationEventRef.current)
    lastSharedGenerationEventRef.current = eventKey
    if (!sharedGeneration.source?.startsWith('agent')) return
    const actorName = sharedGeneration.actorName || 'Agent'
    if (!sharedGeneration.active) {
      if (hadPreviousEvent) setStatus(`${actorName} 的生图任务已结束，成功结果会同步到小相册`)
      return
    }
    if (sharedGeneration.phase === 'queued') {
      setStatus(`${actorName} 已提交当前工作台生图，队列中 ${Math.max(1, Number(sharedGeneration.queueLength) || 0)} 个任务`)
    } else if (sharedGeneration.phase === 'generating') {
      setStatus(`${actorName} 正在按当前工作台参数生图`)
    }
  }, [setStatus, sharedGeneration])

  const albumItems = useMemo(() => state.history.filter((item) => historyImageSource(item)), [state.history])
  const imagePreviewAlbumIndex = useMemo(
    () => (imagePreviewTarget?.albumItemId ? albumItems.findIndex((item) => item.id === imagePreviewTarget.albumItemId) : -1),
    [albumItems, imagePreviewTarget?.albumItemId],
  )

  const generationProgress = useMemo(() => {
    if (!currentJob || !currentJobStartedAt) return null
    const elapsed = Math.max(0, nowMs - currentJobStartedAt)
    const estimated = Math.max(1000, currentJob.estimatedMs)
    const percent = Math.min(98, (elapsed / estimated) * 100)
    return {
      percent,
      labelPercent: Math.floor(percent),
      elapsed,
      remaining: Math.max(0, estimated - elapsed),
      estimated,
    }
  }, [currentJob, currentJobStartedAt, nowMs])

  const outputResolution = useMemo(() => {
    if (isMossModel(state.model)) {
      const settings = state.mossUpscale
      const method = settings?.method || 'none'
      let scale = method === 'omnisr' ? settings?.scale ?? 2 : 1
      if (method === 'seedvr2') {
        scale = (settings?.resolution ?? 2560) / Math.min(state.width, state.height)
        const maximum = settings?.maxResolution ?? 2560
        if (maximum > 0) scale = Math.min(scale, maximum / Math.max(state.width, state.height))
      }
      const width = Math.round(state.width * scale / 2) * 2
      const height = Math.round(state.height * scale / 2) * 2
      return { base: `${state.width}x${state.height}`, final: `${method === 'seedvr2' ? '约 ' : ''}${width}x${height}`, finalWidth: width, finalHeight: height, scale: Number(scale.toFixed(3)), enabledCount: method === 'none' ? 0 : 1, chain: `${state.width}x${state.height} → ${method} → ${width}x${height}` }
    }
    const enabledUpscales = state.upscaleSteps.filter((step) => step.enabled && Number.isFinite(step.scale) && step.scale > 0)
    let width = snap8(state.width)
    let height = snap8(state.height)
    const chain = [`${width}x${height}`]
    let totalScale = 1
    for (const [index, step] of enabledUpscales.entries()) {
      totalScale *= step.scale
      const alignStage = selectedUsesKrea2Hires && index === 1 ? floor8 : snap8
      width = alignStage(width * step.scale)
      height = alignStage(height * step.scale)
      chain.push(`x${step.scale}`, `${width}x${height}`)
    }
    return {
      base: chain[0],
      final: `${width}x${height}`,
      finalWidth: width,
      finalHeight: height,
      scale: Number(totalScale.toFixed(3)),
      enabledCount: enabledUpscales.length,
      chain: chain.join(' -> '),
    }
  }, [selectedUsesKrea2Hires, state.height, state.upscaleSteps, state.width, state.model, state.mossUpscale])

  const effectiveFilenamePrefix = useMemo(
    () => applyFilenameTemplate(state.filenamePrefix || defaultFilenamePrefix, selectedCharacterName),
    [selectedCharacterName, state.filenamePrefix],
  )

  const requestBody = useMemo(() => {
    const enabledUpscales = state.upscaleSteps.filter((step) => step.enabled)
    const body: Record<string, unknown> = {
      prompt: composed.prompt,
      prefix: composed.prefix,
      negative: composed.negative,
      preset: state.preset,
      model: normalizeGatewayModel(state.model, models) ?? state.model,
      filename_prefix: effectiveFilenamePrefix,
      width: state.width,
      height: state.height,
      steps: state.steps,
      cfg: state.cfg,
      sampler_name: state.sampler,
      scheduler: state.scheduler,
      loras: composed.loras,
    }
    if (state.seed.trim()) {
      const seed = Number(state.seed)
      body.seed = seed
      if (selectedUsesKrea2Hires && enabledUpscales.length >= 1) body.second_seed = seed
      if (selectedUsesKrea2Hires && enabledUpscales.length > 1) body.third_seed = seed + 1
    }
    Object.assign(body, faceParametersBody(state.faceDetail, resolveFaceParameters(state.model, state.baseModelProfiles, state.faceParameters)))
    if (isMossModel(state.model)) return { ...body, ...mossUpscaleBody(state.mossUpscale), ...mossOptionsBody(state) }
    body.face_detail = state.faceDetail === true
    if (enabledUpscales.length >= 1) {
      body.second_steps = enabledUpscales[0].steps
      body.second_cfg = enabledUpscales[0].cfg
      body.second_denoise = enabledUpscales[0].denoise
      body.second_sampler_name = enabledUpscales[0].sampler || state.sampler
      body.second_scheduler = enabledUpscales[0].scheduler || state.scheduler
    }
    if (enabledUpscales.length === 1) {
      body.upscale_scale = enabledUpscales[0].scale
      if (selectedUsesKrea2Hires) {
        body.upscale_mode = 'krea2_hires'
        body.upscale_stages = 1
      }
    }
    if (enabledUpscales.length > 1) {
      body.upscale_mode = 'two_stage'
      if (selectedUsesKrea2Hires) {
        body.upscale_stages = 2
        body.upscale_scale = enabledUpscales[0].scale
        body.second_stage_upscale_model = 'OmniSR_X4_DIV2K.safetensors'
      } else {
        body.stage_upscale_scale = enabledUpscales[0].scale
      }
      body.second_stage_upscale_scale = enabledUpscales[1].scale
      body.third_steps = enabledUpscales[1].steps
      body.third_cfg = enabledUpscales[1].cfg
      body.third_denoise = enabledUpscales[1].denoise
      body.third_sampler_name = enabledUpscales[1].sampler || state.sampler
      body.third_scheduler = enabledUpscales[1].scheduler || state.scheduler
    }
    return body
  }, [composed, effectiveFilenamePrefix, models, selectedUsesKrea2Hires, state])

  const resolvedGatewayUrl = useMemo(() => gatewayBase(state.gatewayUrl), [state.gatewayUrl])

  const editingBlock = editingBlockDraft
  const editingPreview = editingBlock ? blockPreviewDisplay(editingBlock, previewFilterForBlock(editingBlock)) : undefined
  const translatedPromptItems = useMemo(() => {
    if (!editingBlock || !translatedPromptField) return []
    return editingBlock[translatedPromptField].map((item) => ({
      source: item,
      target: translatePromptTag(item),
    }))
  }, [editingBlock, translatedPromptField])

  const updateState = (patch: Partial<AppState>) => setState((current) => ({ ...current, ...patch }))

  const applyBaseModelProfilePatch = (base: GenerationBaseModel, patch: Partial<AppState> = {}) => {
    setState((current) => {
      const profiles = withDefaultBaseModelProfiles(current.baseModelProfiles)
      const profile = profiles[base]
      return {
        ...current,
        ...baseModelProfileStatePatch(profile, patch.model ?? current.model),
        ...patch,
      }
    })
  }

  const selectModel = (modelId: string) => {
    if (modelId !== state.model) updateState({ faceParameters: undefined })
    if (isMossModel(modelId)) {
      const normalized = normalizeMossGeneration({ model: modelId })
      updateState({ model: normalized.model, mossOptions: normalized.mossOptions, width: 1184, height: 896, steps: normalized.mossOptions.dmd ? 8 : 30, cfg: 3, sampler: 'euler', scheduler: 'simple', positivePrefix: '', negativePrefix: '' })
      return
    }
    const option = modelOptions.find((model) => model.id === modelId) ?? { id: modelId, label: modelId, aliases: [] }
    const base = state.modelTrainingBases[modelId] ?? inferModelTrainingBase(option) ?? 'none'
    if (base === 'none') {
      updateState({ model: modelId })
      return
    }
    const familyDefaults = models.find((model) => model.id === 'krea2_turbo')?.generationDefaults
    const modelOverrides = base === 'krea2' && familyDefaults && option.generationDefaults
      ? Object.fromEntries(Object.entries(option.generationDefaults).filter(([key, value]) => familyDefaults[key as keyof typeof familyDefaults] !== value))
      : {}
    applyBaseModelProfilePatch(base, { model: modelId, ...modelOverrides })
    setStatus(`已切换基模并套用 ${modelTrainingBaseLabel(base)} 基础配置`)
  }

  const setCurrentModelTrainingBase = (base: ModelTrainingBase) => {
    setState((current) => {
      const modelTrainingBases = { ...current.modelTrainingBases, [current.model]: base }
      if (base === 'none') return { ...current, modelTrainingBases }
      const profile = withDefaultBaseModelProfiles(current.baseModelProfiles)[base]
      return {
        ...current,
        modelTrainingBases,
        ...baseModelProfileStatePatch(profile, current.model),
      }
    })
    setStatus(base === 'none' ? '当前基模已标记为未标训练族' : `当前基模已标记并套用 ${modelTrainingBaseLabel(base)} 配置`)
  }

  const updateBaseModelProfile = (base: GenerationBaseModel, patch: Partial<BaseModelProfile>) => {
    setState((current) => {
      const profiles = withDefaultBaseModelProfiles(current.baseModelProfiles)
      const baseModelProfiles = {
        ...profiles,
        [base]: { ...profiles[base], ...patch },
      }
      const currentBase = current.modelTrainingBases[current.model] ?? inferModelTrainingBase(modelOptions.find((model) => model.id === current.model)) ?? 'none'
      const nextState = { ...current, baseModelProfiles }
      if (currentBase !== base) return nextState
      const profile = baseModelProfiles[base]
      return {
        ...nextState,
        ...baseModelProfileStatePatch(profile, current.model),
      }
    })
  }

  const sharedContent = useMemo(
    () => ({
      categories: state.categories,
      blocks: state.blocks,
      baseModelProfiles: state.baseModelProfiles,
      generationPresets: state.generationPresets,
    }),
    [state.baseModelProfiles, state.blocks, state.categories, state.generationPresets],
  )

  const sharedContentJson = useMemo(() => JSON.stringify(sharedContent), [sharedContent])

  useEffect(() => {
    currentSharedContentRef.current = sharedContent
  }, [sharedContent])

  const workbenchUiState = useMemo(
    () => ({
      selectedBlockIds: state.selectedBlockIds,
      selectedColorPrompts: state.selectedColorPrompts,
      generationDraft: {
        gatewayUrl: state.gatewayUrl,
        positivePrefix: state.positivePrefix,
        negativePrefix: state.negativePrefix,
        customPositivePrompt: state.customPositivePrompt,
        model: state.model,
        preset: state.preset,
        filenamePrefix: state.filenamePrefix,
        width: state.width,
        height: state.height,
        steps: state.steps,
        cfg: state.cfg,
        seed: state.seed,
        sampler: state.sampler,
        scheduler: state.scheduler,
        upscaleSteps: state.upscaleSteps.map((step) => ({ ...step })),
        mossUpscale: state.mossUpscale,
        mossOptions: state.mossOptions,
        faceDetail: state.faceDetail,
        faceParameters: state.faceParameters,
      },
    }),
    [
      state.cfg,
      state.customPositivePrompt,
      state.filenamePrefix,
      state.gatewayUrl,
      state.height,
      state.model,
      state.negativePrefix,
      state.positivePrefix,
      state.preset,
      state.sampler,
      state.scheduler,
      state.seed,
      state.selectedBlockIds,
      state.selectedColorPrompts,
      state.steps,
      state.upscaleSteps,
      state.mossUpscale,
      state.mossOptions,
      state.faceDetail,
      state.faceParameters,
      state.width,
    ],
  )

  const workbenchUiStateJson = useMemo(() => JSON.stringify(workbenchUiState), [workbenchUiState])

  const normalizeServerSharedContent = useCallback((data: SharedContent): SharedContent => ({
    categories: withDefaultCategories(Array.isArray(data.categories) ? data.categories : []),
    blocks: Array.isArray(data.blocks) ? data.blocks : [],
    baseModelProfiles: withDefaultBaseModelProfiles(data.baseModelProfiles),
    baseModelProfilesRevision: Number(data.baseModelProfilesRevision || 0),
    generationPresets: Array.isArray(data.generationPresets) ? data.generationPresets : [],
    updatedAt: Number(data.updatedAt || Date.now()),
    revision: Number(data.revision || 0),
  }), [])

  const sharedPayloadJson = useCallback((content: SharedContent | SharedContentPayload) =>
    JSON.stringify({
      categories: content.categories,
      blocks: content.blocks,
      baseModelProfiles: withDefaultBaseModelProfiles(content.baseModelProfiles),
      generationPresets: content.generationPresets,
    }), [])

  const fetchSharedContent = useCallback(async () => {
    const res = await fetch('/share-state/content')
    const data = (await res.json()) as SharedContent
    if (!res.ok) throw new Error(JSON.stringify(data))
    return normalizeServerSharedContent(data)
  }, [normalizeServerSharedContent])

  const submitSharedOperation = useCallback(async (operation: SharedOperation) => {
    let payload = operation.payload
    for (;;) {
      const res = await fetch('/workbench/operation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ type: operation.type, payload }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) return true
      if (res.status === 409 && data?.conflict) {
        const localEntity = payload.block ?? payload.category ?? payload.preset ?? payload.baseModelProfiles ?? payload
        const currentEntity = data.conflict.currentEntity
        const changedKeys = [...new Set([...Object.keys((localEntity as Record<string, unknown>) || {}), ...Object.keys(currentEntity || {})])]
          .filter((key) => key !== 'revision' && key !== 'updatedAt' && !sameSharedEntity((localEntity as Record<string, unknown>)?.[key], currentEntity?.[key]))
          .slice(0, 8)
        const confirmed = await askConfirm({
          title: '编辑冲突',
          message: `${operation.label}时发现远端数据已经变化。冲突字段：${changedKeys.join('、') || '内容或顺序'}。\n\n本地版本：${JSON.stringify(stripSyncMetadata(localEntity)).slice(0, 420)}\n\n远端版本：${JSON.stringify(stripSyncMetadata(currentEntity)).slice(0, 420)}\n\n选择覆盖会以本地版本替换远端；取消则采用远端版本。`,
          confirmLabel: '覆盖远端',
          cancelLabel: '采用远端',
          tone: 'danger',
        })
        if (!confirmed) return false
        payload = { ...payload, force: true, baseRevision: data.conflict.currentRevision }
        continue
      }
      const retry = await askConfirm({
        title: '保存失败',
        message: `${operation.label}没有保存成功。\n\n${String(data?.error || `HTTP ${res.status}`)}\n\n本地修改仍然保留，是否立即重试？`,
        confirmLabel: '重试',
        cancelLabel: '暂不重试',
        tone: 'danger',
      })
      if (!retry) throw new Error(String(data?.error || `HTTP ${res.status}`))
    }
  }, [askConfirm])

  const syncSharedContent = useCallback(async (target: SharedContentPayload) => {
    const base = lastSharedContentValueRef.current
    if (!base) return
    const operations = buildSharedOperations(base, target)
    if (operations.length === 0) {
      lastSharedContentRef.current = sharedPayloadJson(target)
      return
    }
    sharedSyncActiveRef.current = true
    try {
      for (const operation of operations) {
        if (!(await submitSharedOperation(operation))) {
          break
        }
      }
      const server = await fetchSharedContent()
      const current = currentSharedContentRef.current
      const localDelta = buildSharedOperations({ ...target, updatedAt: server.updatedAt } as SharedContent, current)
      const merged = applySharedOperationsLocally(server, localDelta)
      lastSharedContentValueRef.current = server
      lastSharedRevisionRef.current = Number(server.revision || 0)
      lastSharedContentRef.current = sharedPayloadJson(server)
      setState((existing) => ({
        ...existing,
        categories: merged.categories,
        blocks: merged.blocks,
        baseModelProfiles: withDefaultBaseModelProfiles(merged.baseModelProfiles),
        generationPresets: merged.generationPresets,
        selectedBlockIds: existing.selectedBlockIds.filter((id) => merged.blocks.some((block) => block.id === id)),
      }))
    } finally {
      sharedSyncActiveRef.current = false
    }
  }, [fetchSharedContent, sharedPayloadJson, submitSharedOperation])

  const queueSharedSync = useCallback((content: SharedContentPayload) => {
    const snapshot = structuredClone(content)
    sharedSyncQueueRef.current = sharedSyncQueueRef.current
      .then(() => syncSharedContent(snapshot))
      .catch((error) => {
        setStatus(error instanceof Error ? `同步失败: ${error.message}` : '同步失败')
      })
  }, [setStatus, syncSharedContent])

  const persistSharedContentNow = useCallback(
    (content: SharedContentPayload) => {
      if (!authStatus.authenticated || !lastSharedContentRef.current) return
      if (sharedContentTimerRef.current) {
        window.clearTimeout(sharedContentTimerRef.current)
        sharedContentTimerRef.current = null
      }
      queueSharedSync(content)
    },
    [authStatus.authenticated, queueSharedSync],
  )

  const pullSharedContent = useCallback(async () => {
    if (sharedSyncActiveRef.current) return
    if (lastSharedContentRef.current && sharedContentJson !== lastSharedContentRef.current) return
    const data = await fetchSharedContent()
    const nextJson = sharedPayloadJson(data)
    lastSharedContentValueRef.current = data
    lastSharedRevisionRef.current = Number(data.revision || 0)
    if (nextJson !== lastSharedContentRef.current) {
      lastSharedContentRef.current = nextJson
      setState((current) => ({
        ...current,
        categories: data.categories.length ? data.categories : current.categories,
        blocks: data.blocks.length ? data.blocks : current.blocks,
        baseModelProfiles: withDefaultBaseModelProfiles(data.baseModelProfiles),
        generationPresets: data.generationPresets,
        selectedBlockIds: current.selectedBlockIds.filter((id) => data.blocks.some((block) => block.id === id)),
      }))
    }
  }, [fetchSharedContent, sharedContentJson, sharedPayloadJson])

  const pushWorkbenchUiState = useCallback(async (content: WorkbenchUiState) => {
    const res = await fetch('/workbench/ui-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(content),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(JSON.stringify(data))
    lastWorkbenchUiStateRef.current = JSON.stringify({
      selectedBlockIds: Array.isArray(data.selectedBlockIds) ? data.selectedBlockIds : [],
      selectedColorPrompts: Array.isArray(data.selectedColorPrompts) ? data.selectedColorPrompts : [],
      generationDraft: data.generationDraft || content.generationDraft,
    })
    return data
  }, [])

  const pullWorkbenchUiState = useCallback(async () => {
    const res = await fetch('/workbench/ui-state')
    const data = await res.json()
    if (!res.ok) throw new Error(JSON.stringify(data))
    const availableBlockIds = new Set(state.blocks.map((block) => block.id))
    const remoteDraft = data.generationDraft && typeof data.generationDraft === 'object'
      ? {
          ...workbenchUiState.generationDraft,
          ...data.generationDraft,
          upscaleSteps: Array.isArray(data.generationDraft.upscaleSteps)
            ? data.generationDraft.upscaleSteps.map((step: UpscaleStep) => ({ ...step }))
            : workbenchUiState.generationDraft.upscaleSteps,
        }
      : null
    const remoteSelection = {
      selectedBlockIds: Array.isArray(data.selectedBlockIds)
        ? data.selectedBlockIds.filter((id: unknown): id is string => typeof id === 'string' && availableBlockIds.has(id))
        : [],
      selectedColorPrompts: Array.isArray(data.selectedColorPrompts)
        ? data.selectedColorPrompts.filter((item: unknown): item is string => typeof item === 'string')
        : [],
    }
    const applyWorkbenchContent = (content: WorkbenchUiState) => {
      setState((current) => ({
        ...current,
        ...content.generationDraft,
        upscaleSteps: content.generationDraft.upscaleSteps.map((step) => ({ ...step })),
        selectedBlockIds: content.selectedBlockIds,
        selectedColorPrompts: content.selectedColorPrompts,
      }))
    }
    const nextContent: WorkbenchUiState = {
      ...remoteSelection,
      generationDraft: remoteDraft || workbenchUiState.generationDraft,
    }
    const nextJson = JSON.stringify(nextContent)
    if (!lastWorkbenchUiStateRef.current) {
      if (remoteDraft) {
        lastWorkbenchUiStateRef.current = nextJson
        applyWorkbenchContent(nextContent)
        return
      }
      const migratedContent: WorkbenchUiState = {
        ...workbenchUiState,
        selectedBlockIds: remoteSelection.selectedBlockIds.length ? remoteSelection.selectedBlockIds : workbenchUiState.selectedBlockIds,
        selectedColorPrompts: remoteSelection.selectedColorPrompts.length
          ? remoteSelection.selectedColorPrompts
          : workbenchUiState.selectedColorPrompts,
      }
      applyWorkbenchContent(migratedContent)
      await pushWorkbenchUiState(migratedContent)
      return
    }
    if (nextJson !== lastWorkbenchUiStateRef.current && nextJson !== workbenchUiStateJson) {
      lastWorkbenchUiStateRef.current = nextJson
      applyWorkbenchContent(nextContent)
    }
  }, [pushWorkbenchUiState, state.blocks, workbenchUiState, workbenchUiStateJson])

  const pullGenerationHistory = useCallback(async () => {
    const res = await fetch('/workbench/history?limit=30')
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || '生成历史读取失败')
    const history = Array.isArray(data.history) ? (data.history as HistoryItem[]) : []
    setState((current) => (sameSharedEntity(current.history, history) ? current : { ...current, history }))
  }, [])

  const pushSharedGeneration = useCallback(async (payload: SharedGenerationStatus) => {
    try {
      const res = await fetch('/share-state/generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json()) as SharedGenerationStatus
      if (res.ok) setSharedGeneration(data)
    } catch {
      // Sharing is best-effort; generation should not fail because status sync failed.
    }
  }, [])

  const pullSharedGeneration = useCallback(async () => {
    try {
      const res = await fetch('/share-state/generation')
      const data = (await res.json()) as SharedGenerationStatus
      if (res.ok) setSharedGeneration(data)
    } catch {
      // Ignore temporary share-state failures.
    }
  }, [])

  useEffect(() => {
    if (!authStatus.authenticated) return
    void pullSharedContent()
    void pullWorkbenchUiState()
    void pullSharedGeneration()
    void pullGenerationHistory()
    const timer = window.setInterval(() => {
      void pullSharedContent()
      void pullWorkbenchUiState()
      void pullSharedGeneration()
    }, 2500)
    const historyTimer = window.setInterval(() => void pullGenerationHistory(), 3500)
    return () => {
      window.clearInterval(timer)
      window.clearInterval(historyTimer)
    }
  }, [authStatus.authenticated, pullGenerationHistory, pullSharedContent, pullSharedGeneration, pullWorkbenchUiState])

  useEffect(() => {
    if (!authStatus.authenticated || !lastSharedContentRef.current) return
    if (sharedContentJson === lastSharedContentRef.current) return
    if (sharedContentTimerRef.current) window.clearTimeout(sharedContentTimerRef.current)
    sharedContentTimerRef.current = window.setTimeout(() => {
      sharedContentTimerRef.current = null
      queueSharedSync(sharedContent)
    }, 400)
    return () => {
      if (sharedContentTimerRef.current) window.clearTimeout(sharedContentTimerRef.current)
    }
  }, [authStatus.authenticated, queueSharedSync, sharedContent, sharedContentJson])

  useEffect(() => {
    if (!authStatus.authenticated || !lastWorkbenchUiStateRef.current) return
    if (workbenchUiStateJson === lastWorkbenchUiStateRef.current) return
    void pushWorkbenchUiState(workbenchUiState).catch((error) => {
      setStatus(error instanceof Error ? `工作台参数同步失败: ${error.message}` : '工作台参数同步失败')
    })
  }, [authStatus.authenticated, pushWorkbenchUiState, setStatus, workbenchUiState, workbenchUiStateJson])

  const closeConfirmDialog = useCallback((confirmed: boolean) => {
    confirmResolverRef.current?.(confirmed)
    confirmResolverRef.current = null
    setConfirmDialog(null)
  }, [])

  useEffect(
    () => () => {
      confirmResolverRef.current?.(false)
      confirmResolverRef.current = null
    },
    [],
  )

  useEffect(() => {
    if (!confirmDialog) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeConfirmDialog(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeConfirmDialog, confirmDialog])

  const unlockShare = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthError('')
    try {
      const res = await fetch('/share-auth/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ key: accessKeyInput }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAuthStatus({
          authenticated: false,
          locked: Boolean(data.lockSeconds),
          lockSeconds: Number(data.lockSeconds || 0),
        })
        setAuthError(res.status === 429
          ? `请求过于频繁，请 ${Number(data.retryAfter || 60)} 秒后重试`
          : data.lockSeconds
            ? `连续输错密匙，保护期约 ${Math.ceil(Number(data.lockSeconds) / 60)} 分钟；正确密匙仍可登录`
            : `密匙错误，还可尝试 ${Number(data.attemptsRemaining ?? 5)} 次`)
        return
      }
      setAuthStatus({ authenticated: true, locked: false, lockSeconds: 0 })
      setAccessKeyInput('')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : '解锁失败')
    }
  }

  const toggleBlock = (blockId: string) => {
    setState((current) => {
      const exists = current.selectedBlockIds.includes(blockId)
      if (!exists) setRecentBlockIds((ids) => [blockId, ...ids.filter((id) => id !== blockId)].slice(0, 16))
      return {
        ...current,
        selectedBlockIds: exists
          ? current.selectedBlockIds.filter((id) => id !== blockId)
          : [...current.selectedBlockIds, blockId],
      }
    })
  }

  const moveSelectedBlock = (fromBlockId: string, toBlockId: string) => {
    if (!fromBlockId || !toBlockId || fromBlockId === toBlockId) return
    setState((current) => {
      const fromIndex = current.selectedBlockIds.indexOf(fromBlockId)
      const toIndex = current.selectedBlockIds.indexOf(toBlockId)
      if (fromIndex < 0 || toIndex < 0) return current
      const selectedBlockIds = [...current.selectedBlockIds]
      const [moved] = selectedBlockIds.splice(fromIndex, 1)
      selectedBlockIds.splice(toIndex, 0, moved)
      return { ...current, selectedBlockIds }
    })
  }

  const startSelectedBlockDrag = (event: DragEvent<HTMLButtonElement>, blockId: string) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(selectedBlockDragMime, blockId)
    event.dataTransfer.setData('text/plain', blockId)
    selectedBlockDragIdRef.current = blockId
    setSelectedBlockDragId(blockId)
    setSelectedBlockDropId(blockId)
  }

  const finishSelectedBlockDrag = () => {
    if (selectedBlockDragIdRef.current) {
      suppressSelectedBlockClickRef.current = true
      window.setTimeout(() => {
        suppressSelectedBlockClickRef.current = false
      }, 0)
    }
    selectedBlockDragIdRef.current = ''
    setSelectedBlockDragId('')
    setSelectedBlockDropId('')
  }

  const clearSelectedBlockPointerDrag = () => {
    if (selectedBlockPointerTimerRef.current !== null) window.clearTimeout(selectedBlockPointerTimerRef.current)
    selectedBlockPointerTimerRef.current = null
    selectedBlockPointerDragRef.current = null
  }

  const startSelectedBlockPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>, blockId: string) => {
    if (event.pointerType === 'mouse' || event.button !== 0) return
    clearSelectedBlockPointerDrag()
    selectedBlockPointerDragRef.current = {
      pointerId: event.pointerId,
      blockId,
      targetBlockId: blockId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    }
    selectedBlockPointerTimerRef.current = window.setTimeout(() => {
      const pending = selectedBlockPointerDragRef.current
      if (!pending || pending.pointerId !== event.pointerId) return
      pending.active = true
      selectedBlockDragIdRef.current = blockId
      setSelectedBlockDragId(blockId)
      setSelectedBlockDropId(blockId)
      window.navigator.vibrate?.(20)
    }, 320)
  }

  const moveSelectedBlockPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const pending = selectedBlockPointerDragRef.current
    if (!pending || pending.pointerId !== event.pointerId) return
    if (!pending.active) {
      if (Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) > 10) clearSelectedBlockPointerDrag()
      return
    }
    event.preventDefault()
    const target = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-selected-block-id]')
    const targetBlockId = target?.dataset.selectedBlockId || ''
    if (!targetBlockId) return
    pending.targetBlockId = targetBlockId
    setSelectedBlockDropId(targetBlockId)
  }

  const endSelectedBlockPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>, commit: boolean) => {
    const pending = selectedBlockPointerDragRef.current
    if (!pending || pending.pointerId !== event.pointerId) return
    const active = pending.active
    const fromBlockId = pending.blockId
    const toBlockId = pending.targetBlockId
    clearSelectedBlockPointerDrag()
    if (!active) return
    event.preventDefault()
    event.stopPropagation()
    if (commit) moveSelectedBlock(fromBlockId, toBlockId)
    finishSelectedBlockDrag()
  }

  const removeSelectedBlock = (blockId: string) => {
    if (suppressSelectedBlockClickRef.current) return
    toggleBlock(blockId)
  }

  const toggleColorPrompt = (prompt: string) => {
    setState((current) => {
      const exists = current.selectedColorPrompts.includes(prompt)
      return {
        ...current,
        selectedColorPrompts: exists
          ? current.selectedColorPrompts.filter((item) => item !== prompt)
          : [...current.selectedColorPrompts, prompt],
      }
    })
  }

  const openBlock = (blockId: string) => {
    if (!editMode) {
      toggleBlock(blockId)
      return
    }
    editBlock(blockId)
  }

  const openImagePreview = (target: ImagePreviewTarget) => {
    const source = target.source || browserImageSource(target.imagePath, target.imageUrl)
    if (!source) return
    const albumItem = target.albumItemId
      ? albumItems.find((item) => item.id === target.albumItemId)
      : albumItems.find((item) => historyImageSource(item) === source && (!target.imagePath || item.imagePath === target.imagePath))
    setImagePreviewTarget({ ...target, source, albumItemId: albumItem?.id })
    setImagePreviewOpen(true)
  }

  const closeImagePreview = useCallback(() => {
    setImagePreviewOpen(false)
  }, [])

  const showAlbumPreview = useCallback(
    (index: number) => {
      const item = albumItems[index]
      if (!item) return
      const source = historyImageSource(item)
      const displayWidth = item.outputWidth ?? item.width
      const displayHeight = item.outputHeight ?? item.height
      setResultImage(source)
      setResultImagePath(item.imagePath || '')
      setResultHistoryId(item.id)
      setImagePreviewTarget({
        source,
        imagePath: item.imagePath,
        imageUrl: item.imageUrl,
        albumItemId: item.id,
        title: '小相册',
        detail: `${item.createdAt} · ${displayWidth}x${displayHeight}${item.imagePath ? ` · ${item.imagePath}` : ''}`,
      })
      setImagePreviewOpen(true)
    },
    [albumItems],
  )

  const editBlock = (blockId: string) => {
    const block = state.blocks.find((item) => item.id === blockId)
    if (!block) return
    setEditingBlockDraft(structuredClone(block))
    setEditingBlockBase(structuredClone(block))
    setEditingBlockInsertIndex(state.blocks.findIndex((item) => item.id === blockId))
    setLoraDraft('')
    setEditorOpen(true)
  }

  const toggleFocusedCategory = (categoryId: string) => {
    setFocusedCategoryId((current) => (current === categoryId ? '' : categoryId))
    setActiveCategoryId(categoryId)
    setCollapsedCategoryIds((current) => current.filter((id) => id !== categoryId))
  }

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategoryIds((current) =>
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId],
    )
  }

  const addBlock = (categoryId = activeCategoryId) => {
    const block: PresetBlock = {
      id: makeId('block'),
      categoryId,
      name: '新预制块',
      enabled: true,
      positive: ['new prompt'],
      negative: [],
      loras: [],
      tags: [],
      notes: '',
      previewImage: '',
    }
    setActiveCategoryId(categoryId)
    setEditingBlockDraft(block)
    setEditingBlockBase(null)
    setEditingBlockInsertIndex(state.blocks.length)
    setEditMode(true)
    setEditorOpen(true)
  }

  const updateBlock = (blockId: string, patch: Partial<PresetBlock>) => {
    if (editingBlockDraft?.id === blockId) {
      setEditingBlockDraft((current) => (current?.id === blockId ? { ...current, ...patch } : current))
      return
    }
    setState((current) => ({
      ...current,
      blocks: current.blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block)),
    }))
  }

  const addCategory = () => {
    const id = makeId('category')
    const category: Category = { id, name: '新类目' }
    setState((current) => ({ ...current, categories: [...current.categories, category] }))
    setActiveCategoryId(id)
    setCollapsedCategoryIds((current) => current.filter((item) => item !== id))
  }

  const updateCategory = (categoryId: string, patch: Partial<Category>) => {
    setState((current) => {
      const category = current.categories.find((item) => item.id === categoryId)
      if (!category) return current
      const nextName = patch.name === undefined ? category.name : patch.name
      const nextDescription = patch.description === undefined ? category.description : patch.description
      const requestedId = patch.id === undefined ? category.id : makeCategoryId(patch.id)
      const nextId = requestedId || category.id
      if (nextId !== category.id && current.categories.some((item) => item.id === nextId)) return current
      return {
        ...current,
        categories: current.categories.map((item) =>
          item.id === categoryId ? { ...item, id: nextId, name: nextName, description: nextDescription?.trim() || undefined } : item,
        ),
        blocks: nextId === categoryId ? current.blocks : current.blocks.map((block) => (block.categoryId === categoryId ? { ...block, categoryId: nextId } : block)),
      }
    })
    if (patch.id !== undefined) {
      const nextId = makeCategoryId(patch.id)
      if (nextId && activeCategoryId === categoryId) setActiveCategoryId(nextId)
      if (nextId) {
        setCollapsedCategoryIds((current) => current.map((id) => (id === categoryId ? nextId : id)))
      }
    }
  }

  const moveCategory = (categoryId: string, direction: -1 | 1) => {
    setState((current) => {
      const index = current.categories.findIndex((category) => category.id === categoryId)
      const targetIndex = index + direction
      if (index < 0 || targetIndex < 0 || targetIndex >= current.categories.length) return current
      const categories = [...current.categories]
      const [category] = categories.splice(index, 1)
      categories.splice(targetIndex, 0, category)
      const nextState = { ...current, categories }
      window.setTimeout(() => persistSharedContentNow(sharedContentFromState(nextState)), 0)
      return nextState
    })
  }

  const closeCategoryEditor = useCallback(() => {
    persistSharedContentNow(sharedContent)
    setCategoryEditorOpen(false)
  }, [persistSharedContentNow, sharedContent])

  const closeBlockEditor = useCallback(async () => {
    if (editingBlockDraft && !sameSharedEntity(editingBlockDraft, editingBlockBase)) {
      const discard = await askConfirm({
        title: '放弃未保存修改',
        message: `「${editingBlockDraft.name}」还有未保存的修改。关闭后会恢复为服务器中的版本。`,
        confirmLabel: '放弃修改',
        cancelLabel: '继续编辑',
        tone: 'danger',
      })
      if (!discard) return
    }
    setEditorOpen(false)
    setEditingBlockDraft(null)
    setEditingBlockBase(null)
  }, [askConfirm, editingBlockBase, editingBlockDraft])

  const saveEditingBlock = useCallback(async () => {
    if (!editingBlockDraft) return
    const operation: SharedOperation = editingBlockBase
      ? {
          type: 'block.update',
          payload: { id: editingBlockDraft.id, block: stripSyncMetadata(editingBlockDraft), baseRevision: editingBlockBase.revision },
          label: `保存预制块「${editingBlockDraft.name}」`,
        }
      : {
          type: 'block.create',
          payload: { block: stripSyncMetadata(editingBlockDraft), index: editingBlockInsertIndex },
          label: `新增预制块「${editingBlockDraft.name}」`,
        }
    const accepted = await submitSharedOperation(operation)
    const server = await fetchSharedContent()
    lastSharedContentValueRef.current = server
    lastSharedRevisionRef.current = Number(server.revision || 0)
    lastSharedContentRef.current = sharedPayloadJson(server)
    const saved = server.blocks.find((block) => block.id === editingBlockDraft.id)
    setState((current) => ({
      ...current,
      categories: server.categories,
      blocks: server.blocks,
      baseModelProfiles: withDefaultBaseModelProfiles(server.baseModelProfiles),
      generationPresets: server.generationPresets,
      selectedBlockIds: current.selectedBlockIds.filter((id) => server.blocks.some((block) => block.id === id)),
    }))
    if (!accepted) {
      if (saved) {
        setEditingBlockDraft(structuredClone(saved))
        setEditingBlockBase(structuredClone(saved))
        setStatus(`已采用远端版本: ${saved.name}`)
      } else {
        setEditorOpen(false)
        setEditingBlockDraft(null)
        setEditingBlockBase(null)
        setStatus('远端版本已被删除')
      }
      return
    }
    setEditorOpen(false)
    setEditingBlockDraft(null)
    setEditingBlockBase(null)
    setStatus(`已保存预制块: ${saved?.name || editingBlockDraft.name}`)
  }, [editingBlockBase, editingBlockDraft, editingBlockInsertIndex, fetchSharedContent, setStatus, sharedPayloadJson, submitSharedOperation])

  useEffect(() => {
    if (confirmDialog) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (imagePreviewOpen && imagePreviewAlbumIndex >= 0 && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        const nextIndex = imagePreviewAlbumIndex + (event.key === 'ArrowLeft' ? -1 : 1)
        if (nextIndex >= 0 && nextIndex < albumItems.length) {
          event.preventDefault()
          showAlbumPreview(nextIndex)
        }
        return
      }
      if (event.key !== 'Escape') return
      if (messageCenterOpen) {
        event.preventDefault()
        messageCenterOpenRef.current = false
        setMessageCenterOpen(false)
        return
      }
      if (imagePreviewOpen) {
        event.preventDefault()
        closeImagePreview()
        return
      }
      if (categoryEditorOpen) {
        event.preventDefault()
        closeCategoryEditor()
        return
      }
      if (editorOpen) {
        event.preventDefault()
        void closeBlockEditor()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [albumItems.length, categoryEditorOpen, closeBlockEditor, closeCategoryEditor, closeImagePreview, confirmDialog, editorOpen, imagePreviewAlbumIndex, imagePreviewOpen, messageCenterOpen, showAlbumPreview])

  const removeCategory = async (categoryId: string) => {
    const category = state.categories.find((item) => item.id === categoryId)
    if (!category) return
    if (defaultCategoryIds.has(categoryId)) {
      window.alert('内置类目会自动兜底，建议只改名或排序。')
      return
    }
    const usedCount = state.blocks.filter((block) => block.categoryId === categoryId).length
    if (usedCount > 0) {
      window.alert(`这个类目里还有 ${usedCount} 个预制块，请先移动或删除这些块。`)
      return
    }
    const confirmed = await askConfirm({
      title: '删除类目',
      message: `删除空类目「${category.name}」？这个操作会从分类列表中移除它。`,
      confirmLabel: '删除',
      tone: 'danger',
    })
    if (!confirmed) return
    setState((current) => ({
      ...current,
      categories: current.categories.filter((item) => item.id !== categoryId),
    }))
    if (activeCategoryId === categoryId) setActiveCategoryId(state.categories[0]?.id ?? 'character')
  }

  const duplicateEditingBlock = () => {
    if (!editingBlock) return
    const nextBlock: PresetBlock = {
      ...editingBlock,
      id: makeId('block'),
      name: `${editingBlock.name} 副本`,
      positive: [...editingBlock.positive],
      negative: [...editingBlock.negative],
      loras: editingBlock.loras.map((lora) => ({ ...lora })),
      loraBaseModels: editingBlock.loraBaseModels ? [...editingBlock.loraBaseModels] : undefined,
      tags: [...editingBlock.tags],
      notes: editingBlock.notes ?? '',
      revision: undefined,
      updatedAt: undefined,
      previewVariants: editingBlock.previewVariants?.map((variant) => ({ ...variant, id: makeId('preview'), revision: undefined, updatedAt: undefined })),
    }
    const sourceIndex = state.blocks.findIndex((block) => block.id === editingBlock.id)
    setEditingBlockDraft(nextBlock)
    setEditingBlockBase(null)
    setEditingBlockInsertIndex(sourceIndex < 0 ? state.blocks.length : sourceIndex + 1)
    setLoraDraft('')
    setEditorOpen(true)
  }

  const removeBlock = async (blockId: string) => {
    const block = state.blocks.find((item) => item.id === blockId) ?? (editingBlockDraft?.id === blockId ? editingBlockDraft : undefined)
    if (!block) return
    const confirmed = await askConfirm({
      title: '删除预制块',
      message: `删除预制块「${block.name}」？它会从分类和已选列表中移除。`,
      confirmLabel: '删除',
      tone: 'danger',
    })
    if (!confirmed) return
    if (!state.blocks.some((item) => item.id === blockId)) {
      setEditorOpen(false)
      setEditingBlockDraft(null)
      setEditingBlockBase(null)
      return
    }
    setState((current) => ({
      ...current,
      blocks: current.blocks.filter((block) => block.id !== blockId),
      selectedBlockIds: current.selectedBlockIds.filter((id) => id !== blockId),
    }))
    setEditorOpen(false)
    setEditingBlockDraft(null)
    setEditingBlockBase(null)
  }

  const addLoraToEditingBlock = () => {
    if (!editingBlock || !loraDraft.trim()) return
    const loraName = loraDraft.trim()
    const inferredBaseModels = inferLoraBaseModels(loraName)
    const nextBaseModels = inferredBaseModels.length
      ? [...new Set([...blockLoraBaseModels(editingBlock), ...inferredBaseModels])]
      : editingBlock.loraBaseModels
    updateBlock(editingBlock.id, {
      loras: [
        ...editingBlock.loras,
        {
          name: loraName,
          strength_model: 0.7,
          strength_clip: 0.7,
        },
      ],
      ...(nextBaseModels ? { loraBaseModels: nextBaseModels } : {}),
    })
    setLoraDraft('')
  }

  const toggleEditingBlockLoraBaseModel = (baseModel: LoraBaseModel) => {
    if (!editingBlock) return
    const next = new Set(blockLoraBaseModels(editingBlock))
    if (next.has(baseModel)) next.delete(baseModel)
    else next.add(baseModel)
    updateBlock(editingBlock.id, { loraBaseModels: [...next] })
  }

  const extractLoraPromptToEditingBlock = async () => {
    if (!editingBlock || !loraDraft.trim()) return
    try {
      setStatus('读取 LoRA 触发词中')
      const res = await fetch(`${resolvedGatewayUrl}/lora-info?name=${encodeURIComponent(loraDraft.trim())}`)
      const data = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(data))
      const prompt = String(data?.prompt || (Array.isArray(data?.triggers) ? data.triggers[0] : '') || '').trim()
      if (!prompt) {
        setStatus('这个 LoRA 没有找到触发词元数据')
        return
      }
      if (editingBlock.positive.includes(prompt)) {
        setStatus('触发词已存在')
        return
      }
      updateBlock(editingBlock.id, {
        positive: [...editingBlock.positive, prompt],
      })
      setStatus(`已提取触发词: ${prompt}`)
    } catch (error) {
      setStatus(error instanceof Error ? `触发词提取失败: ${error.message}` : '触发词提取失败')
    }
  }

  const cachePreviewImage = async (url: string) => {
    const trimmed = url.trim()
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('/preview-cache/')) return trimmed
    const sourceUrl = trimmed.startsWith('/') ? `${resolvedGatewayUrl}${trimmed}` : trimmed
    if (!/^https?:\/\//i.test(sourceUrl)) return trimmed
    const res = await fetch('/preview-cache/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ url: sourceUrl }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || 'preview cache failed')
    return String(data.previewImage || '').trim()
  }

  const cacheDroppedSourceFile = async (file: File, debug?: string[]) => {
    try {
      const res = await fetch('/preview-cache/upload-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ fileName: file.name, dataUrl: await fileToDataUrl(file) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'preview source cache failed')
      const sourceImageUrl = String(data.sourceImageUrl || '').trim()
      debug?.push(sourceImageUrl ? '后端资源上传=成功' : '后端资源上传=未返回URL')
      return sourceImageUrl
    } catch (error) {
      debug?.push(`后端资源上传=失败(${error instanceof Error ? error.message : '未知错误'})`)
      return ''
    }
  }

  const reportDropDebug = (target: 'preset' | 'block-preview', debug: string[], outcome: string) => {
    const message = `${debug.join(' · ') || '无输入摘要'} · 结果=${outcome}`
    void fetch('/workbench/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ event: `image_drop_${target}`, message }),
    }).catch(() => {})
  }

  const cachePreviewDataUrl = async (dataUrl: string, fileName = 'preview.webp') => {
    if (!dataUrl.startsWith('data:image/')) return dataUrl
    try {
      const res = await fetch('/preview-cache/upload-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ fileName, dataUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'preview cache failed')
      return String(data.sourceImageUrl || '').trim() || dataUrl
    } catch {
      return dataUrl
    }
  }

  const importLoraPreviewToEditingBlock = async () => {
    if (!editingBlock || !loraDraft.trim()) return
    try {
      setStatus('读取 LoRA 预览图中')
      const res = await fetch(`${resolvedGatewayUrl}/lora-info?name=${encodeURIComponent(loraDraft.trim())}`)
      const data = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(data))
      const previewImage = String(data?.preview_image_url || '').trim()
      if (!previewImage) {
        setStatus('这个 LoRA 没有找到可用预览图')
        return
      }
      const cachedPreviewImage = await cachePreviewImage(previewImage)
      const targetBase = previewBaseForBlock(editingBlock)
      const currentPreview = blockPreviewDisplay(editingBlock, targetBase === 'none' ? 'all' : targetBase)
      setBlockPreviewVariant(editingBlock.id, targetBase, { previewImage: cachedPreviewImage, previewFit: currentPreview.fit })
      setStatus(`已缓存 LoRA 预览缩略图到 ${previewBaseModelLabel(targetBase)}`)
    } catch (error) {
      setStatus(error instanceof Error ? `预览图读取失败: ${error.message}` : '预览图读取失败')
    }
  }

  const updateEditingLora = (index: number, patch: Partial<LoraRef>) => {
    if (!editingBlock) return
    updateBlock(editingBlock.id, {
      loras: editingBlock.loras.map((lora, currentIndex) => (currentIndex === index ? { ...lora, ...patch } : lora)),
    })
  }

  const moveEditingLora = (fromIndex: number, toIndex: number) => {
    if (!editingBlock || fromIndex === toIndex) return
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= editingBlock.loras.length || toIndex >= editingBlock.loras.length) return
    const nextLoras = [...editingBlock.loras]
    const [moved] = nextLoras.splice(fromIndex, 1)
    nextLoras.splice(toIndex, 0, moved)
    updateBlock(editingBlock.id, { loras: nextLoras })
  }

  const startEditingLoraDrag = (event: DragEvent<HTMLElement>, index: number) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
    setLoraDragIndex(index)
    setLoraDropIndex(index)
  }

  const finishEditingLoraDrag = () => {
    setLoraDragIndex(null)
    setLoraDropIndex(null)
  }

  const removeEditingLora = (index: number) => {
    if (!editingBlock) return
    updateBlock(editingBlock.id, {
      loras: editingBlock.loras.filter((_, currentIndex) => currentIndex !== index),
    })
  }

  const importPreviewImage = async (file?: File) => {
    if (!editingBlock || !file) return
    try {
      const preview = await makeBlockPreviewFromFile(file)
      const targetBase = previewBaseForBlock(editingBlock)
      setBlockPreviewVariant(editingBlock.id, targetBase, preview)
      setStatus(`预览图已缓存到 ${previewBaseModelLabel(targetBase)}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '预览图缓存失败')
    }
  }

  const imageFromDrop = async (event: DragEvent, debug: string[] = []): Promise<DroppedImage> => {
    const stringDataPromise = Promise.all([
      readDataTransferString(event.dataTransfer, 'text/uri-list'),
      readDataTransferString(event.dataTransfer, 'text/plain'),
      readDataTransferString(event.dataTransfer, 'text/html'),
    ])
    debug.push(describeImageDrop(event.dataTransfer))
    const payload = dragImagePayloadFromDataTransfer(event.dataTransfer) ?? draggedWorkbenchImage.current
    if (payload) {
      const source = payload.source || browserImageSource(payload.imagePath, payload.imageUrl)
      debug.push(`内部来源=${dragSourceKind(source)} · 路径=${payload.imagePath ? '有' : '无'} · 资源URL=${payload.imageUrl ? '有' : '无'}`)
      if (source) {
        const file = await imageFileFromSource(source, payload.imagePath?.split(/[\\/]/).pop() || 'comfy-output.png')
        return {
          file,
          source,
          imagePath: payload.imagePath,
          imageUrl: workbenchImageUrlFromSource(payload.imageUrl || source) || payload.imageUrl,
        }
      }
    }

    const droppedFile = imageFileFromDataTransfer(event.dataTransfer)
    if (droppedFile) {
      debug.push(`文件识别=成功(${droppedFile.name || '未命名'}:${droppedFile.type || '未知'}:${droppedFile.size}B)`)
      const cachedSourceUrl = await cacheDroppedSourceFile(droppedFile, debug)
      return {
        file: droppedFile,
        source: cachedSourceUrl,
        imageUrl: cachedSourceUrl || undefined,
      }
    }

    const [uriValue, text, html] = await stringDataPromise
    const uri = uriValue.split(/\r?\n/).find((line) => line && !line.startsWith('#'))
    const htmlSource = imageSourceFromHtml(html)
    debug.push(`异步字符串=URI:${dragSourceKind(uri || '')} · 文本:${dragSourceKind(text)} · HTML:${dragSourceKind(htmlSource)}(${html.length}字符)`)
    const source = (uri || (/^(data:image|blob:|https?:\/\/|\/)/i.test(text.trim()) ? text : '') || htmlSource || '').trim()
    debug.push(`候选来源=${dragSourceKind(source)}`)
    if (source && (/^(data:image|blob:|https?:\/\/|\/)/i.test(source))) {
      const imagePath = localImagePathFromSource(source)
      const workbenchImageUrl = workbenchImageUrlFromSource(source)
      const file = await imageFileFromSource(source)
      debug.push(`URL图片读取=成功(${file.type || '未知'}:${file.size}B)`)
      const cachedSourceUrl = imagePath || workbenchImageUrl ? '' : await cacheDroppedSourceFile(file, debug)
      return {
        file,
        source,
        imagePath: imagePath || undefined,
        imageUrl: workbenchImageUrl || cachedSourceUrl || (!imagePath && /^https?:\/\//i.test(source) ? source : undefined),
      }
    }
    return {}
  }

  const makeBlockPreviewFromFile = async (file: File) => {
    const [thumbnail, dimensions] = await Promise.all([makePreviewThumbnail(file), getImageDimensionsFromFile(file)])
    const cachedThumbnail = await cachePreviewDataUrl(thumbnail, file.name || 'block-preview.webp')
    return {
      previewImage: cachedThumbnail,
      previewFit: previewFitForDimensions(dimensions),
    }
  }

  const mutateBlock = (blockId: string, updater: (block: PresetBlock) => PresetBlock) => {
    if (editingBlockDraft?.id === blockId) {
      setEditingBlockDraft((current) => (current?.id === blockId ? updater(current) : current))
      return
    }
    setState((current) => ({
      ...current,
      blocks: current.blocks.map((block) => (block.id === blockId ? updater(block) : block)),
    }))
  }

  const setBlockPreviewVariant = (
    blockId: string,
    baseModel: PreviewBaseModel,
    preview: { previewImage: string; previewFit?: PreviewImageMode },
    source?: { imagePath?: string; imageUrl?: string },
    options?: { replace?: boolean },
  ) => {
    mutateBlock(blockId, (block) => {
        const baseVariants = (block.previewVariants ?? []).filter((variant) => variant.baseModel === baseModel)
        const activeId = block.activePreviewVariantIds?.[baseModel]
        const duplicate = baseVariants.find((variant) => {
          if (source?.imagePath && variant.sourceImagePath === source.imagePath) return true
          if (source?.imageUrl && variant.sourceImageUrl === source.imageUrl) return true
          return !source?.imagePath && !source?.imageUrl && variant.image === preview.previewImage
        })
        const existing = options?.replace ? baseVariants.find((variant) => variant.id === activeId) ?? baseVariants[0] : duplicate
        const nextVariant: PreviewVariant = {
          id: existing?.id ?? makeId('preview'),
          baseModel,
          image: preview.previewImage,
          fit: preview.previewFit ?? 'crop',
          sourceImagePath: source?.imagePath,
          sourceImageUrl: source?.imageUrl,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
        }
        const previewVariants = existing
          ? (block.previewVariants ?? []).map((variant) => (variant.id === existing.id ? nextVariant : variant))
          : [nextVariant, ...(block.previewVariants ?? [])]
        return {
          ...block,
          ...(baseModel === 'none'
            ? {
                previewImage: preview.previewImage,
                previewFit: preview.previewFit === 'crop' ? undefined : preview.previewFit,
                previewSourceImagePath: source?.imagePath,
                previewSourceImageUrl: source?.imageUrl,
              }
            : {}),
          previewVariants,
          activePreviewVariantIds: {
            ...(block.activePreviewVariantIds ?? {}),
            [baseModel]: nextVariant.id,
          },
        }
    })
  }

  const setActiveBlockPreviewVariant = (blockId: string, baseModel: PreviewBaseModel, variantId: string) => {
    mutateBlock(blockId, (block) => ({
      ...block,
      activePreviewVariantIds: {
        ...(block.activePreviewVariantIds ?? {}),
        [baseModel]: variantId,
      },
    }))
  }

  const updateBlockPreviewSource = (
    blockId: string,
    baseModel: PreviewBaseModel,
    variantId: string | undefined,
    source: { imagePath?: string; imageUrl?: string },
  ) => {
    const imagePath = source.imagePath?.trim() || undefined
    const imageUrl = source.imageUrl?.trim() || undefined
    mutateBlock(blockId, (block) => {
        const targetVariant = variantId
          ? block.previewVariants?.find((variant) => variant.id === variantId)
          : block.previewVariants?.find((variant) => variant.baseModel === baseModel)
        const previewVariants = targetVariant
          ? block.previewVariants?.map((variant) =>
              variant.id === targetVariant.id
                ? {
                    ...variant,
                    sourceImagePath: imagePath,
                    sourceImageUrl: imageUrl,
                  }
                : variant,
            )
          : block.previewVariants
        const shouldUpdateLegacySource = !targetVariant || baseModel === 'none' || targetVariant.image === block.previewImage
        return {
          ...block,
          ...(shouldUpdateLegacySource
            ? {
                previewSourceImagePath: imagePath,
                previewSourceImageUrl: imageUrl,
              }
            : {}),
          ...(previewVariants ? { previewVariants } : {}),
        }
    })
  }

  const updateBlockPreviewImage = (blockId: string, baseModel: PreviewBaseModel, variantId: string | undefined, previewImage: string) => {
    mutateBlock(blockId, (block) => {
        const targetVariant = variantId
          ? block.previewVariants?.find((variant) => variant.id === variantId)
          : block.previewVariants?.find((variant) => variant.baseModel === baseModel)
        const previewVariants = targetVariant
          ? block.previewVariants?.map((variant) => (variant.id === targetVariant.id ? { ...variant, image: previewImage } : variant))
          : block.previewVariants
        const shouldUpdateLegacyImage = !targetVariant || baseModel === 'none' || targetVariant.image === block.previewImage
        return {
          ...block,
          ...(shouldUpdateLegacyImage ? { previewImage } : {}),
          ...(previewVariants ? { previewVariants } : {}),
        }
    })
  }

  const updateBlockPreviewFit = (blockId: string, baseModel: PreviewBaseModel, fit: PreviewImageMode, variantId?: string) => {
    mutateBlock(blockId, (block) => {
        const activeId = variantId || block.activePreviewVariantIds?.[baseModel]
        const firstBaseVariant = block.previewVariants?.find((variant) => variant.baseModel === baseModel)
        const targetId = activeId || firstBaseVariant?.id
        const previewVariants = block.previewVariants?.map((variant) => (variant.id === targetId ? { ...variant, fit } : variant))
        return {
          ...block,
          ...(baseModel === 'none' ? { previewFit: fit === 'crop' ? undefined : fit } : {}),
          ...(previewVariants ? { previewVariants } : {}),
        }
    })
  }

  const removeEditingPreview = async () => {
    if (!editingBlock || !editingPreview?.image) return
    const baseModel = editingPreview.baseModel
    const baseLabel = previewBaseModelLabel(baseModel)
    const position =
      editingPreview.baseVariantCount > 1 ? `第 ${editingPreview.variantIndex}/${editingPreview.baseVariantCount} 张` : ''
    const confirmed = await askConfirm({
      title: '删除预览图',
      message: `删除「${editingBlock.name}」当前显示的 ${baseLabel}${position ? ` ${position}` : ''}预览图？来源路径也会一并移除，保存预制块后生效。`,
      confirmLabel: '删除',
      tone: 'danger',
    })
    if (!confirmed) return

    mutateBlock(editingBlock.id, (block) => {
      const targetVariant = editingPreview.variantId
        ? block.previewVariants?.find((variant) => variant.id === editingPreview.variantId)
        : undefined
      if (!targetVariant) {
        return {
          ...block,
          previewImage: undefined,
          previewFit: undefined,
          previewSourceImagePath: undefined,
          previewSourceImageUrl: undefined,
        }
      }

      const previewVariants = (block.previewVariants ?? []).filter((variant) => variant.id !== targetVariant.id)
      const remainingForBase = previewVariants.filter((variant) => variant.baseModel === targetVariant.baseModel && variant.image)
      const activePreviewVariantIds = { ...(block.activePreviewVariantIds ?? {}) }
      if (remainingForBase.length > 0) activePreviewVariantIds[targetVariant.baseModel] = remainingForBase[0].id
      else delete activePreviewVariantIds[targetVariant.baseModel]

      const patch: Partial<PresetBlock> = {}
      if (targetVariant.baseModel === 'none' || targetVariant.image === block.previewImage) {
        const genericVariant = previewVariants.find(
          (variant) => variant.baseModel === 'none' && variant.id === activePreviewVariantIds.none,
        ) ?? previewVariants.find((variant) => variant.baseModel === 'none')
        patch.previewImage = genericVariant?.image
        patch.previewFit = genericVariant?.fit === 'crop' ? undefined : genericVariant?.fit
        patch.previewSourceImagePath = genericVariant?.sourceImagePath
        patch.previewSourceImageUrl = genericVariant?.sourceImageUrl
      }

      return {
        ...block,
        ...patch,
        previewVariants,
        activePreviewVariantIds,
      }
    })
    setStatus(`已从编辑草稿删除「${editingBlock.name}」的 ${baseLabel}预览图，保存预制块后生效`)
  }

  const handlePresetDrop = async (event: DragEvent, promptOnly = false) => {
    event.preventDefault()
    setPromptDropActive(false)
    setPresetDropActive(false)
    const debug: string[] = []
    try {
      // Capture files and start URL fallbacks while the drop data store is still readable.
      const transferred = dragImagePayloadFromDataTransfer(event.dataTransfer)
      const payload = transferred ?? draggedWorkbenchImage.current
      if (!transferred && payload) debug.push('使用本页起拖时的原图引用')
      const directFile = imageFileFromDataTransfer(event.dataTransfer)
      const reference = payload?.imagePath || payload?.imageUrl ? payload : undefined
      const fallback = reference || directFile ? undefined : imageFromDrop(event, debug)
      if (!fallback) debug.push(describeImageDrop(event.dataTransfer))
      const dropped: DroppedImage = fallback ? await fallback : { ...reference, file: directFile }
      reportDropDebug('preset', debug, dropped.file ? '识别到图片文件' : dropped.imagePath || dropped.imageUrl ? '识别到来源' : '未识别')
      setStatus(`拖入检测: ${debug.join(' · ')}`)
      let metadata: PngPresetMetadata | undefined
      if (dropped.imagePath || dropped.imageUrl) {
        try {
          metadata = await readPngPresetMetadataFromSource({ imagePath: dropped.imagePath, imageUrl: dropped.imageUrl })
        } catch (error) {
          debug.push(`来源预设读取失败：${error instanceof Error ? error.message : '未知原因'}`)
          // External images can lack a backend-owned path. Fall back to the dropped bytes below.
        }
      }
      if (!metadata && !dropped.file && payload?.source) dropped.file = await imageFileFromSource(payload.source)
      if (!metadata && !dropped.file) {
        setStatus(`没有识别到图片文件或可读取的工作台资源 · 调试: ${debug.join(' · ')}`)
        return
      }
      metadata ??= await readPresetMetadataFromPng(dropped.file!)
      if (!promptOnly) {
        await importPngPresetMetadata(metadata, '来源 PNG')
        return
      }
      const preset = metadata.generationPreset
      if (!Array.isArray(preset?.selectedBlockIds) || !preset.selectedBlockIds.every((id) => typeof id === 'string') ||
          (preset.customPositivePrompt != null && typeof preset.customPositivePrompt !== 'string')) {
        throw new Error('PNG 预设中的块或自定义提示词格式不正确')
      }
      const ids = [...new Set(preset.selectedBlockIds)]
      const available = new Set(state.blocks.map((block) => block.id))
      const selectedBlockIds = ids.filter((id) => available.has(id))
      const missing = ids.length - selectedBlockIds.length
      const customPositivePrompt = preset.customPositivePrompt ?? ''
      if (!await askConfirm({
        title: '读取块与自定义提示词',
        message: `将当前选择替换为图片中的 ${selectedBlockIds.length} 个块${missing ? `（跳过 ${missing} 个已不存在的块）` : ''}，并${customPositivePrompt ? '替换' : '清空'}自定义提示词。其他参数保持不变。`,
        confirmLabel: '读取',
      })) return
      updateState({ selectedBlockIds, customPositivePrompt })
      setStatus(`已读取 ${selectedBlockIds.length} 个块和自定义提示词${missing ? `，跳过 ${missing} 个缺失块` : ''}`)
    } catch (error) {
      reportDropDebug('preset', debug, `异常:${error instanceof Error ? error.message : '未知错误'}`)
      setStatus(`${error instanceof Error ? `读取拖入图片失败: ${error.message}` : '读取拖入图片失败'} · 调试: ${debug.join(' · ') || '无输入摘要'}`)
    }
  }

  const handleBlockPreviewDrop = async (event: DragEvent, blockId: string) => {
    event.preventDefault()
    event.stopPropagation()
    setBlockDropTargetId('')
    const debug: string[] = []
    try {
      const block = state.blocks.find((item) => item.id === blockId)
      if (!block) return
      const dropped = await imageFromDrop(event, debug)
      reportDropDebug('block-preview', debug, dropped.file ? '识别到图片文件' : dropped.imagePath || dropped.imageUrl ? '识别到来源' : '未识别')
      setStatus(`拖入检测: ${debug.join(' · ')}`)
      if (!dropped.file) {
        setStatus(`没有识别到图片文件 · 调试: ${debug.join(' · ')}`)
        return
      }
      const targetBase = previewBaseForBlock(block)
      const currentPreview = blockPreviewDisplay(block, targetBase === 'none' ? 'all' : targetBase)
      const hasTargetPreview = currentPreview.image && currentPreview.baseModel === targetBase
      const confirmed = await askConfirm({
        title: hasTargetPreview ? '添加预制块缩略图' : '设置预制块缩略图',
        message: hasTargetPreview
          ? `把拖入的图片添加为「${block.name}」的第 ${currentPreview.baseVariantCount + 1} 张 ${previewBaseModelLabel(targetBase)} 缩略图，并切换为当前显示？`
          : `把拖入的图片设置为「${block.name}」的 ${previewBaseModelLabel(targetBase)} 缩略图？`,
        confirmLabel: hasTargetPreview ? '添加' : '设置',
      })
      if (!confirmed) {
        setStatus('已取消设置预览图')
        return
      }
      const preview = await makeBlockPreviewFromFile(dropped.file)
      setBlockPreviewVariant(blockId, targetBase, preview, { imagePath: dropped.imagePath, imageUrl: dropped.imageUrl })
      const sourceStatus = dropped.imagePath || dropped.imageUrl ? '，并已绑定来源图' : '；外部文件无法自动保存原路径'
      setStatus(`${previewBaseModelLabel(targetBase)} ${hasTargetPreview ? '已添加缩略图' : '已设置缩略图'}${preview.previewFit === 'background' ? '，并自动使用背景模式' : '，并使用裁剪模式'}${sourceStatus}`)
    } catch (error) {
      reportDropDebug('block-preview', debug, `异常:${error instanceof Error ? error.message : '未知错误'}`)
      setStatus(`${error instanceof Error ? `设置预览图失败: ${error.message}` : '设置预览图失败'} · 调试: ${debug.join(' · ') || '无输入摘要'}`)
    }
  }

  const startImageDrag = (event: DragEvent, payload: DragImagePayload) => {
    const source = payload.source || browserImageSource(payload.imagePath, payload.imageUrl)
    if (!source) {
      event.preventDefault()
      return
    }
    const nextPayload = { ...payload, source }
    draggedWorkbenchImage.current = nextPayload
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(dragImageMime, JSON.stringify(nextPayload))
    event.dataTransfer.setData('text/plain', source)
    event.dataTransfer.setData('text/uri-list', source)
    if (payload.imagePath) event.dataTransfer.setData('DownloadURL', `image/png:${payload.imagePath.split(/[\\/]/).pop() || 'comfy-output.png'}:${source}`)
  }

  const cacheEditingPreviewUrl = async () => {
    const currentPreviewImage = editingPreview?.image || editingBlock?.previewImage || ''
    if (!editingBlock || !currentPreviewImage || !/^https?:\/\//i.test(currentPreviewImage)) return
    try {
      setStatus('预览图转本地缩略图中')
      const cachedPreviewImage = await cachePreviewImage(currentPreviewImage)
      updateBlockPreviewImage(editingBlock.id, previewBaseForBlock(editingBlock), editingPreview?.variantId, cachedPreviewImage)
      setStatus('预览图已转为本地缓存')
    } catch (error) {
      setStatus(error instanceof Error ? `预览图缓存失败: ${error.message}` : '预览图缓存失败')
    }
  }

  const useCurrentOutputAsPreview = async () => {
    if (!editingBlock || !resultImage) return
    try {
      setStatus('正在使用当前输出图生成预览缩略图')
      const thumbnail = await makePreviewThumbnailFromSource(resultImage)
      const cachedThumbnail = await cachePreviewDataUrl(thumbnail, resultImagePath?.split(/[\\/]/).pop() || 'current-output-preview.webp')
      const targetBase = previewBaseForBlock(editingBlock)
      setBlockPreviewVariant(
        editingBlock.id,
        targetBase,
        { previewImage: cachedThumbnail, previewFit: editingPreview?.fit ?? editingBlock.previewFit ?? 'crop' },
        {
          imagePath: resultImagePath || undefined,
          imageUrl: !resultImagePath && /^https?:\/\//i.test(resultImage) ? resultImage : undefined,
        },
      )
      setStatus(resultImagePath || /^https?:\/\//i.test(resultImage) ? `已使用当前输出图作为 ${previewBaseModelLabel(targetBase)} 预览，并绑定为来源图` : `已使用当前输出图作为 ${previewBaseModelLabel(targetBase)} 预览`)
    } catch (error) {
      setStatus(error instanceof Error ? `当前输出图缓存失败: ${error.message}` : '当前输出图缓存失败')
    }
  }

  const legacyPreviewCandidate = (block: PresetBlock) => {
    const genericVariant = block.previewVariants?.find((variant) => variant.baseModel === 'none' && variant.image && variant.sourceImagePath)
    if (genericVariant) {
      return {
        image: genericVariant.image,
        fit: genericVariant.fit ?? 'crop',
        sourceImagePath: genericVariant.sourceImagePath,
        sourceImageUrl: genericVariant.sourceImageUrl,
      }
    }
    if (block.previewImage && block.previewSourceImagePath) {
      return {
        image: block.previewImage,
        fit: block.previewFit ?? 'crop',
        sourceImagePath: block.previewSourceImagePath,
        sourceImageUrl: block.previewSourceImageUrl,
      }
    }
    return undefined
  }

  const readPngPresetMetadataFromSource = async (source: Pick<DragImagePayload, 'imagePath' | 'imageUrl'>) => {
    const response = await fetch('/png-preset/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ imagePath: source.imagePath, imageUrl: source.imageUrl }),
    })
    const data = await response.json()
    if (!response.ok || !data?.hasPreset || !data?.metadata) {
      throw new Error(data?.error || '这个来源 PNG 没有可读取的工作台预设')
    }
    return data.metadata as PngPresetMetadata
  }

  const readPngPresetMetadataByPath = async (imagePath: string) => readPngPresetMetadataFromSource({ imagePath })

  const markBlockPreviewFromSource = async (block: PresetBlock) => {
    const candidate = legacyPreviewCandidate(block)
    if (!candidate?.sourceImagePath) {
      setStatus('这个块没有可读取的本地来源 PNG')
      return false
    }
    const metadata = await readPngPresetMetadataByPath(candidate.sourceImagePath)
    const inferredBase = inferPreviewBaseFromMetadata(metadata)
    if (!inferredBase) {
      setStatus(`未能从「${block.name}」来源 PNG 判断 IL/A`)
      return false
    }
    setBlockPreviewVariant(
      block.id,
      inferredBase,
      { previewImage: candidate.image, previewFit: candidate.fit },
      { imagePath: candidate.sourceImagePath, imageUrl: candidate.sourceImageUrl },
    )
    setStatus(`已将「${block.name}」缩略图标记为 ${previewBaseModelLabel(inferredBase)}`)
    return true
  }

  const markAllLegacyPreviewsFromSources = async () => {
    const candidates = state.blocks.filter((block) => {
      const candidate = legacyPreviewCandidate(block)
      if (!candidate?.sourceImagePath) return false
      return !block.previewVariants?.some((variant) => variant.image && variant.sourceImagePath === candidate.sourceImagePath && variant.baseModel !== 'none')
    })
    if (candidates.length === 0) {
      setStatus('没有需要自动标记的旧缩略图')
      return
    }
    let marked = 0
    let skipped = 0
    for (const block of candidates) {
      const candidate = legacyPreviewCandidate(block)
      if (!candidate?.sourceImagePath) continue
      try {
        const metadata = await readPngPresetMetadataByPath(candidate.sourceImagePath)
        const inferredBase = inferPreviewBaseFromMetadata(metadata)
        if (!inferredBase) {
          skipped += 1
          continue
        }
        setBlockPreviewVariant(
          block.id,
          inferredBase,
          { previewImage: candidate.image, previewFit: candidate.fit },
          { imagePath: candidate.sourceImagePath, imageUrl: candidate.sourceImageUrl },
        )
        marked += 1
      } catch {
        skipped += 1
      }
    }
    setStatus(`旧缩略图自动标记完成: ${marked} 个成功，${skipped} 个跳过`)
  }

  const importBlockPreviewSourcePreset = async (block: PresetBlock) => {
    const preview = blockPreviewDisplay(block, previewFilterForBlock(block))
    const readableSource = blockPresetSources[block.id] || {
      imagePath: preview.sourceImagePath,
      imageUrl: preview.sourceImageUrl,
    }
    if (!readableSource.imagePath && !readableSource.imageUrl) {
      setStatus('这个预制块还没有绑定来源图')
      return
    }
    try {
      const metadata = await readPngPresetMetadataFromSource(readableSource)
      await importPngPresetMetadata(metadata, `「${block.name}」来源 PNG`)
    } catch (error) {
      setStatus(error instanceof Error ? `读取来源图配置失败: ${error.message}` : '读取来源图配置失败')
    }
  }

  const addUpscale = () => {
    setState((current) => {
      const option = modelOptions.find((model) => model.id === current.model) ?? { id: current.model, label: current.model, aliases: [] }
      const base = current.modelTrainingBases[current.model] ?? inferModelTrainingBase(option) ?? 'none'
      if (base === 'krea2') {
        if (current.upscaleSteps.length >= 2) return current
        const defaultStep = current.upscaleSteps.length === 0 ? defaultBaseModelProfiles.krea2.upscaleSteps?.[0] : krea2UsdUpscaleStep()
        return defaultStep
          ? { ...current, upscaleSteps: [...current.upscaleSteps, { ...defaultModelUpscale(current.model, defaultStep), id: makeId(current.upscaleSteps.length ? 'krea2_usd' : 'krea2_hires') }] }
          : current
      }
      return {
        ...current,
        upscaleSteps: [
          ...current.upscaleSteps,
          {
            id: makeId('upscale'),
            enabled: true,
            scale: 2,
            steps: 12,
            cfg: 4,
            denoise: 0.18,
            sampler: current.sampler,
            scheduler: current.scheduler,
          },
        ],
      }
    })
  }

  const updateUpscale = (stepId: string, patch: Partial<UpscaleStep>) => {
    setState((current) => ({
      ...current,
      upscaleSteps: current.upscaleSteps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    }))
  }

  const removeUpscale = (stepId: string) => {
    setState((current) => ({
      ...current,
      upscaleSteps: current.upscaleSteps.filter((step) => step.id !== stepId),
    }))
  }

  const makeGenerationPresetSnapshot = (name: string, id = makeId('generation_preset')): GenerationPreset => ({
    id,
    name,
    createdAt: new Date().toLocaleString(),
    selectedBlockIds: [...state.selectedBlockIds],
    selectedColorPrompts: [...state.selectedColorPrompts],
    customPositivePrompt: state.customPositivePrompt,
    gatewayUrl: state.gatewayUrl,
    positivePrefix: state.positivePrefix,
    negativePrefix: state.negativePrefix,
    model: state.model,
    preset: state.preset,
    filenamePrefix: state.filenamePrefix,
    width: state.width,
    height: state.height,
    steps: state.steps,
    cfg: state.cfg,
    seed: state.seed,
    sampler: state.sampler,
    scheduler: state.scheduler,
    upscaleSteps: state.upscaleSteps.map((step) => ({ ...step })),
    mossUpscale: state.mossUpscale,
    mossOptions: state.mossOptions,
    faceDetail: state.faceDetail,
    faceParameters: resolveFaceParameters(state.model, state.baseModelProfiles, state.faceParameters),
  })

  const makePngPresetMetadata = (name = defaultGenerationPresetName): PngPresetMetadata => ({
    app: 'comfy-preset-workflow-ui',
    version: 1,
    createdAt: new Date().toISOString(),
    generationPreset: makeGenerationPresetSnapshot(name, makeId('png_preset')),
    selectedBlocks: selectedBlocks.map((block) => ({
      id: block.id,
      categoryId: block.categoryId,
      name: block.name,
      positive: [...block.positive],
      negative: [...block.negative],
      loras: block.loras.map((lora) => ({ ...lora })),
    })),
    composed: {
      positive: composed.previewPrompt,
      negative: composed.negative,
      loras: composed.loras.map((lora) => ({ ...lora })),
    },
    requestBody,
  })

  const applyGenerationPreset = (preset: GenerationPreset, sourceName: string) => {
    preset = normalizeMossGeneration(preset)
    const availableBlockIds = new Set(state.blocks.map((block) => block.id))
    updateState({
      selectedBlockIds: preset.selectedBlockIds.filter((id) => availableBlockIds.has(id)),
      selectedColorPrompts: [...(preset.selectedColorPrompts ?? [])],
      customPositivePrompt: preset.customPositivePrompt ?? '',
      gatewayUrl: preset.gatewayUrl,
      positivePrefix: preset.positivePrefix,
      negativePrefix: preset.negativePrefix,
      model: preset.model,
      preset: preset.preset,
      filenamePrefix: preset.filenamePrefix,
      width: preset.width,
      height: preset.height,
      steps: preset.steps,
      cfg: preset.cfg,
      seed: preset.seed,
      sampler: preset.sampler,
      scheduler: preset.scheduler,
      upscaleSteps: preset.upscaleSteps.map((step) => ({ ...step })),
      mossUpscale: preset.mossUpscale,
      mossOptions: preset.mossOptions,
      faceDetail: preset.faceDetail,
      faceParameters: preset.faceParameters,
    })
    setStatus(`已读取生成预设: ${sourceName}`)
  }

  const saveGenerationPreset = () => {
    const name = window.prompt('预设名称', defaultGenerationPresetName)?.trim()
    if (!name) return
    const preset = makeGenerationPresetSnapshot(name)
    setState((current) => ({
      ...current,
      generationPresets: [preset, ...current.generationPresets].slice(0, 80),
    }))
    setStatus(`已保存生成预设: ${name}`)
  }

  const loadGenerationPreset = async (presetId: string) => {
    const preset = state.generationPresets.find((item) => item.id === presetId)
    if (!preset) return
    const confirmed = await askConfirm({
      title: '切换生成预设',
      message: `切换到「${preset.name}」？当前未保存的参数不会自动保存。`,
      confirmLabel: '切换',
    })
    if (!confirmed) return
    applyGenerationPreset(preset, preset.name)
  }

  const overwriteGenerationPreset = async (presetId: string) => {
    const preset = state.generationPresets.find((item) => item.id === presetId)
    if (!preset) return
    const confirmed = await askConfirm({
      title: '覆盖生成预设',
      message: `用当前参数覆盖「${preset.name}」？原来的参数会被替换。`,
      confirmLabel: '覆盖',
      tone: 'danger',
    })
    if (!confirmed) return
    const nextPreset = makeGenerationPresetSnapshot(preset.name, preset.id)
    setState((current) => ({
      ...current,
      generationPresets: current.generationPresets.map((item) => (item.id === presetId ? nextPreset : item)),
    }))
    setStatus(`已覆盖生成预设: ${preset.name}`)
  }

  const removeGenerationPreset = async (presetId: string) => {
    const preset = state.generationPresets.find((item) => item.id === presetId)
    if (!preset) return
    const confirmed = await askConfirm({
      title: '删除生成预设',
      message: `删除生成预设「${preset.name}」？保存的参数快照会被移除。`,
      confirmLabel: '删除',
      tone: 'danger',
    })
    if (!confirmed) return
    setState((current) => ({
      ...current,
      generationPresets: current.generationPresets.filter((preset) => preset.id !== presetId),
    }))
  }

  const refreshGateway = useCallback(async () => {
    try {
      setStatus('连接中')
      const [healthRes, modelsRes, lorasRes] = await Promise.all([
        fetch(`${resolvedGatewayUrl}/health`),
        fetch(`${resolvedGatewayUrl}/models`),
        fetch(`${resolvedGatewayUrl}/loras?limit=500`),
      ])
      if (!healthRes.ok) throw new Error('health failed')
      const modelsJson = await modelsRes.json()
      const lorasJson = await lorasRes.json()
      const loraSource = lorasJson?.loras ?? lorasJson?.items ?? lorasJson
      const nextModels = extractModelOptions(modelsJson)
      const defaultModel = typeof modelsJson?.default === 'string' ? modelsJson.default : nextModels[0]?.id
      setModels(nextModels)
      setLoras(uniqueStrings(collectStrings(loraSource)))
      setState((current) => {
        current = normalizeMossGeneration(current)
        const normalizedModel = normalizeGatewayModel(current.model, nextModels, defaultModel)
        return normalizedModel && normalizedModel !== current.model ? { ...current, model: normalizedModel } : current
      })
      setStatus('已连接')
    } catch (error) {
      setStatus(error instanceof Error ? `连接失败: ${error.message}` : '连接失败')
    }
  }, [resolvedGatewayUrl, setStatus])

  useEffect(() => {
    if (authStatus.authenticated) void refreshGateway()
  }, [authStatus.authenticated, refreshGateway])

  useEffect(() => {
    if (!authStatus.authenticated || !editorOpen) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const query = loraDraft.trim()
      const params = new URLSearchParams({ limit: query ? '80' : '500' })
      if (query) params.set('query', query)
      void fetch(`${resolvedGatewayUrl}/loras?${params.toString()}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`LoRA search failed: ${response.status}`)
          const payload = await response.json()
          const source = payload?.loras ?? payload?.items ?? payload
          setLoras(uniqueStrings(collectStrings(source)))
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setStatus(error instanceof Error ? `LoRA 搜索失败: ${error.message}` : 'LoRA 搜索失败')
        })
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [authStatus.authenticated, editorOpen, loraDraft, resolvedGatewayUrl, setStatus])

  const enqueueGeneration = (dryRun = false) => {
    if (krea2UpscaleValidation) {
      setStatus(krea2UpscaleValidation)
      return
    }
    const bodySnapshot = JSON.parse(JSON.stringify(requestBody))
    const timingKey = generationTimingKey(bodySnapshot)
    const job: GenerationJob = {
      id: makeId(dryRun ? 'dryrun' : 'job'),
      createdAt: new Date().toLocaleString(),
      dryRun,
      body: bodySnapshot,
      pngMetadata: makePngPresetMetadata(defaultGenerationPresetName),
      prompt: composed.previewPrompt,
      negative: composed.negative,
      width: state.width,
      height: state.height,
      outputWidth: outputResolution.finalWidth,
      outputHeight: outputResolution.finalHeight,
      model: state.model,
      timingKey,
      estimatedMs: estimateGenerationMs(state.history, timingKey),
    }
    if (dryRun && isGenerating) {
      setStatus('生成中，Dry Run 暂不可用')
      return
    }
    const nextQueue = [...generationQueueRef.current, job]
    generationQueueRef.current = nextQueue
    setGenerationQueue(nextQueue)
    if (isGenerating && currentJob) {
      void pushSharedGeneration({
        active: true,
        phase: currentJob.dryRun ? 'dry_run' : 'generating',
        owner: clientIdRef.current,
        createdAt: currentJob.createdAt,
        dryRun: currentJob.dryRun,
        prompt: currentJob.prompt,
        model: currentJob.model,
        width: currentJob.width,
        height: currentJob.height,
        queueLength: nextQueue.length,
      })
      setStatus(dryRun ? `Dry Run 已加入等待队列，当前 1，等待 ${nextQueue.length}` : `已加入等待队列，当前 1，等待 ${nextQueue.length}`)
    } else {
      void pushSharedGeneration({
        active: true,
        phase: 'queued',
        owner: clientIdRef.current,
        createdAt: job.createdAt,
        dryRun: job.dryRun,
        prompt: job.prompt,
        model: job.model,
        width: job.width,
        height: job.height,
        queueLength: nextQueue.length,
      })
      setStatus(dryRun ? 'Dry Run 已加入队列，即将开始' : `已加入队列，队列中 ${nextQueue.length} 个任务`)
    }
  }

  const runGenerationJob = useCallback(async (job: GenerationJob) => {
    try {
      const startedAt = Date.now()
      setIsGenerating(true)
      setCurrentJob(job)
      setCurrentJobStartedAt(startedAt)
      setNowMs(startedAt)
      setStatus(job.dryRun ? '预览请求中' : `生成中: ${job.createdAt}`)
      void pushSharedGeneration({
        active: true,
        phase: job.dryRun ? 'dry_run' : 'generating',
        owner: clientIdRef.current,
        createdAt: job.createdAt,
        dryRun: job.dryRun,
        prompt: job.prompt,
        model: job.model,
        width: job.width,
        height: job.height,
        queueLength: generationQueueRef.current.length,
      })
      const managedByWorkbench = resolvedGatewayUrl === '/gateway'
      const res = await fetch(managedByWorkbench ? '/workbench/generate' : `${resolvedGatewayUrl}/txt2img`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(
          managedByWorkbench
            ? { requestBody: { ...job.body, dry_run: job.dryRun }, pngMetadata: job.pngMetadata }
            : { ...job.body, dry_run: job.dryRun },
        ),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(`${data.error || '生成失败'}${data.details?.missing ? `；缺少依赖：${data.details.missing.join('、')}` : ''}`)
      setStatus(job.dryRun ? 'dry run 完成' : '生成完成')
      if (!job.dryRun) {
        const durationMs = Date.now() - startedAt
        const imagePath = data.image_path ?? data.images?.[0]?.path ?? data.images?.[0]?.image_path ?? ''
        const imageUrl = data.image_url ?? data.images?.[0]?.url ?? data.images?.[0]?.image_url ?? ''
        let pngPresetWriteError = ''
        if (imagePath && !managedByWorkbench) {
          try {
            const writeResponse = await fetch('/png-preset/write', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
              body: JSON.stringify({ imagePath, metadata: job.pngMetadata }),
            })
            const writeData = await writeResponse.json().catch(() => ({}))
            if (!writeResponse.ok) throw new Error(writeData?.error || 'PNG preset write failed')
          } catch (error) {
            pngPresetWriteError = error instanceof Error ? error.message : 'PNG preset write failed'
          }
        } else if (imagePath && data.png_preset_error) {
          pngPresetWriteError = String(data.png_preset_error)
        } else if (imagePath && managedByWorkbench && !data.png_preset_written) {
          pngPresetWriteError = '工作台后端未确认 PNG 预设写入'
        }
        setStatus(
          imagePath
            ? pngPresetWriteError
              ? `生成完成，但写入 PNG 预设失败: ${pngPresetWriteError}`
              : '生成完成，PNG 预设已写入'
            : '生成完成，但网关没有返回本地 PNG 路径，无法写入预设',
        )
        setResultImage(browserImageSource(imagePath, imageUrl))
        const faceMessage = mossResultMessage(data)
        if (faceMessage) setStatus(faceMessage)
        setResultImagePath(imagePath)
        const historyItem: HistoryItem = {
          faceDetail: job.pngMetadata.generationPreset.faceDetail,
          mossOptions: job.pngMetadata.generationPreset.mossOptions,
          faceDetailResult: data.face_detail_result,
          id: makeId('history'),
          createdAt: job.createdAt,
          prompt: job.prompt,
          negative: job.negative,
          width: job.width,
          height: job.height,
          outputWidth: job.outputWidth,
          outputHeight: job.outputHeight,
          model: job.model,
          imagePath,
          imageUrl: imageUrl || imagePath || '',
          durationMs,
          timingKey: job.timingKey,
        }
        setResultHistoryId(historyItem.id)
        void fetch('/workbench/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(historyItem),
        }).catch(() => {})
        setState((current) => ({
          ...current,
          history: [historyItem, ...current.history].slice(0, 30),
        }))
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '请求失败')
      void pushSharedGeneration({
        active: false,
        phase: 'error',
        owner: clientIdRef.current,
        queueLength: generationQueueRef.current.length,
      })
    } finally {
      setIsGenerating(false)
      setCurrentJob(null)
      setCurrentJobStartedAt(0)
      const waitingCount = generationQueueRef.current.length
      void pushSharedGeneration({
        active: waitingCount > 0,
        phase: waitingCount > 0 ? 'queued' : 'idle',
        owner: clientIdRef.current,
        queueLength: waitingCount,
      })
    }
  }, [pushSharedGeneration, resolvedGatewayUrl, setStatus])

  useEffect(() => {
    if (isGenerating || generationQueue.length === 0) return
    const [job, ...remainingQueue] = generationQueue
    generationQueueRef.current = remainingQueue
    setGenerationQueue(remainingQueue)
    void runGenerationJob(job)
  }, [generationQueue, isGenerating, runGenerationJob])

  const clearGenerationQueue = async () => {
    if (generationQueue.length === 0) return
    const confirmed = await askConfirm({
      title: '清空等待队列',
      message: `清空 ${generationQueue.length} 个等待中的生成任务？正在生成的任务不会被取消。`,
      confirmLabel: '清空',
      tone: 'danger',
    })
    if (!confirmed) return
    generationQueueRef.current = []
    setGenerationQueue([])
    if (!isGenerating) {
      void pushSharedGeneration({ active: false, phase: 'idle', owner: clientIdRef.current, queueLength: 0 })
    }
    setStatus('已清空等待队列')
  }

  const cancelCurrentGeneration = async () => {
    if (!isGenerating) return
    try {
      setStatus('取消当前生成中')
      await fetch(`${resolvedGatewayUrl}/interrupt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: '{}',
      })
      void pushSharedGeneration({ active: true, phase: 'canceling', owner: clientIdRef.current, queueLength: generationQueueRef.current.length })
      setStatus('已发送当前生成中断请求')
    } catch (error) {
      setStatus(error instanceof Error ? `取消失败: ${error.message}` : '取消失败')
    }
  }

  const exportState = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'comfy-preset-workflow-ui.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  const importState = async (file?: File) => {
    if (!file) return
    const text = await file.text()
    setState(withCurrentFilenameDefault({ ...initialState, ...JSON.parse(text) }))
  }

  const clearHistory = async () => {
    if (state.history.length === 0) return
    const confirmed = await askConfirm({
      title: '清空历史',
      message: `清空 ${state.history.length} 条历史记录？小相册里的历史预览也会一起清掉。`,
      confirmLabel: '清空',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      const response = await fetch('/workbench/history', { method: 'DELETE' })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error || '历史记录清空失败')
      updateState({ history: [] })
      setStatus(`已清空 ${Number(result?.count || 0)} 条历史记录`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '历史记录清空失败')
    }
  }

  const deleteAlbumImage = async (item: HistoryItem) => {
    const confirmed = await askConfirm({
      title: '删除图片和本地原图',
      message: `删除 ${item.createdAt} 的图片？相册记录和服务器上的原图文件都会删除，此操作不可撤销。`,
      confirmLabel: '删除原图',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      const response = await fetch(`/workbench/history?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '删除失败')
      const deleted = new Set<string>(data.deletedIds)
      setState((current) => ({ ...current, history: current.history.filter((entry) => !deleted.has(entry.id)) }))
      if (deleted.has(resultHistoryId)) {
        setResultImage('')
        setResultImagePath('')
        setResultHistoryId('')
      }
      if (imagePreviewTarget?.albumItemId && deleted.has(imagePreviewTarget.albumItemId)) closeImagePreview()
      setStatus('已删除相册图片和本地原图')
    } catch (error) {
      await askConfirm({ title: '无法删除图片', message: error instanceof Error ? error.message : '删除失败', confirmLabel: '知道了' })
    }
  }

  const openNativeImage = async (source: DragImagePayload, action: 'open' | 'folder') => {
    try {
      const response = await fetch('/workbench/image/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagePath: source.imagePath, imageUrl: source.imageUrl, action }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '打开失败')
      setStatus(action === 'open' ? '已在工作台主机打开图片' : '已在工作台主机打开所在目录')
    } catch (error) { setStatus(error instanceof Error ? error.message : '打开失败') }
  }

  const copyPreviewImage = async (source: DragImagePayload) => {
    const url = source.source || browserImageSource(source.imagePath, source.imageUrl)
    if (!url) { setStatus('没有可复制的图片'); return }
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer')
      setStatus('当前浏览器连接不支持直接复制图片，已打开原图；请右键选择“复制图片”')
      return
    }
    try {
      const png = (async () => {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`图片读取失败：${response.status}`)
        const blob = await response.blob()
        if (blob.type === 'image/png') return blob
        const bitmap = await createImageBitmap(blob)
        try {
          const canvas = document.createElement('canvas')
          canvas.width = bitmap.width
          canvas.height = bitmap.height
          canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
          return await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('图片转换失败')), 'image/png'))
        } finally { bitmap.close() }
      })()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      setStatus('已复制图片')
    } catch (error) { setStatus(`复制图片失败：${error instanceof Error ? error.message : '剪贴板不可用'}`) }
  }

  const importPngPresetMetadata = async (metadata: PngPresetMetadata, sourceLabel = 'PNG') => {
    const preset = metadata.generationPreset
    const confirmed = await askConfirm({
      title: '读取 PNG 预设',
      message: `从${sourceLabel}读取「${preset.name}」？当前未保存的参数不会自动保存。`,
      confirmLabel: '读取',
    })
    if (!confirmed) return
    applyGenerationPreset(preset, `PNG ${preset.name}`)
    const missingBlocks = preset.selectedBlockIds.filter((id) => !state.blocks.some((block) => block.id === id))
    if (missingBlocks.length > 0) {
      setStatus(`已读取 PNG 预设，但有 ${missingBlocks.length} 个块当前库中不存在`)
    }
  }

  const importPngPreset = async (file?: File) => {
    if (!file) return
    try {
      await importPngPresetMetadata(await readPresetMetadataFromPng(file))
    } catch (error) {
      setStatus(error instanceof Error ? `读取 PNG 预设失败: ${error.message}` : '读取 PNG 预设失败')
    }
  }

  const importAlbumPngPreset = async (item: HistoryItem, includeSeed = false) => {
    if (!item.imagePath && !item.imageUrl) {
      setStatus('这张相册图片没有可读取的来源')
      return
    }
    try {
      setStatus('正在读取小相册图片中的 PNG 预设')
      const metadata = await readPngPresetMetadataFromSource({ imagePath: item.imagePath, imageUrl: item.imageUrl })
      let seed = state.seed
      if (includeSeed) {
        seed = String(metadata.requestBody?.seed ?? metadata.generationPreset.seed ?? '')
        if (!seed.trim()) {
          const image = await imageFileFromSource(historyImageSource(item))
          const chunks = readPngTextChunks(await image.arrayBuffer())
          const graph = JSON.parse(chunks.prompt || '{}') as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>
          const node = [graph['3'], ...Object.values(graph)].find((entry) => entry && ['KSampler', 'KSamplerAdvanced', 'SamplerCustomAdvanced'].includes(entry.class_type || '') && (entry.inputs?.seed !== undefined || entry.inputs?.noise_seed !== undefined))
          seed = String(node?.inputs?.seed ?? node?.inputs?.noise_seed ?? '')
        }
        if (!seed.trim()) throw new Error('此图片未找到实际生成种子，可使用“使用此图片预设”')
      }
      metadata.generationPreset = { ...metadata.generationPreset, seed }
      await importPngPresetMetadata(metadata, `小相册图片 ${item.createdAt}`)
    } catch (error) {
      setStatus(error instanceof Error ? `读取小相册预设失败: ${error.message}` : '读取小相册预设失败')
    }
  }

  const cancelAlbumLongPress = useCallback(() => {
    if (albumLongPressTimerRef.current !== null) window.clearTimeout(albumLongPressTimerRef.current)
    albumLongPressTimerRef.current = null
    albumLongPressRef.current = null
    setAlbumLongPressItemId('')
  }, [])

  const startAlbumLongPress = (event: ReactPointerEvent<HTMLButtonElement>, item: HistoryItem) => {
    if (event.pointerType === 'mouse' || event.button !== 0) return
    cancelAlbumLongPress()
    albumLongPressRef.current = {
      itemId: item.id,
      clientX: event.clientX,
      clientY: event.clientY,
      triggered: false,
    }
    setAlbumLongPressItemId(item.id)
    albumLongPressTimerRef.current = window.setTimeout(() => {
      const pending = albumLongPressRef.current
      if (!pending || pending.itemId !== item.id) return
      pending.triggered = true
      albumLongPressTimerRef.current = null
      suppressAlbumClickRef.current = true
      setAlbumLongPressItemId('')
      window.navigator.vibrate?.(20)
      window.setTimeout(() => {
        suppressAlbumClickRef.current = false
      }, 1000)
      setAlbumMenu({ item, x: Math.max(8, Math.min(pending.clientX, window.innerWidth - 248)), y: Math.max(8, Math.min(pending.clientY, window.innerHeight - 240)) })
    }, 550)
  }

  const moveAlbumLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const pending = albumLongPressRef.current
    if (!pending || pending.triggered) return
    if (Math.hypot(event.clientX - pending.clientX, event.clientY - pending.clientY) > 12) cancelAlbumLongPress()
  }

  const endAlbumLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const triggered = albumLongPressRef.current?.triggered === true
    cancelAlbumLongPress()
    if (triggered) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  useEffect(() => cancelAlbumLongPress, [cancelAlbumLongPress])

  const renderPresetBlockCard = (block: PresetBlock) => {
    const selected = state.selectedBlockIds.includes(block.id)
    const loraBaseModels = blockLoraBaseModels(block)
    const blockDropActive = blockDropTargetId === block.id
    const hasReadablePreset = blockHasReadablePreset(block, blockPresetStatus)
    const preview = blockPreviewDisplay(block, previewFilterForBlock(block))
    const previewVariantBases = [...new Set((block.previewVariants ?? []).filter((variant) => variant.image).map((variant) => variant.baseModel))]
    const previewImageVariants = (block.previewVariants ?? []).filter((variant) => variant.image && variant.baseModel === preview.baseModel)
    const previewOriginalSource = browserImageSource(preview.sourceImagePath, preview.sourceImageUrl)
    const readablePresetSource = blockPresetSources[block.id] || {
      imagePath: preview.sourceImagePath,
      imageUrl: preview.sourceImageUrl,
    }
    return (
      <button
        type="button"
        key={block.id}
        className={`block-card ${preview.fit === 'background' ? 'preview-background' : preview.fit === 'fit' ? 'preview-fit' : 'preview-crop'} ${selected ? 'selected' : ''} ${blockDropActive ? 'drop-active' : ''}`}
        draggable={hasReadablePreset}
        onDragStart={(event) =>
          startImageDrag(event, {
            imagePath: readablePresetSource.imagePath,
            imageUrl: readablePresetSource.imageUrl,
          })
        }
        onClick={() => openBlock(block.id)}
        onDragEnter={(event) => {
          event.preventDefault()
          setBlockDropTargetId(block.id)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setBlockDropTargetId(block.id)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setBlockDropTargetId('')
        }}
        onDrop={(event) => {
          void handleBlockPreviewDrop(event, block.id)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          editBlock(block.id)
        }}
        title={hasReadablePreset ? '左键选择/取消，右键编辑；可拖到左侧读取来源 PNG 配置' : '左键选择/取消，右键编辑'}
      >
        {preview.image ? <img src={preview.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <ImagePlus size={22} />}
        {previewVariantBases.length > 0 && (
          <div className="preview-base-dots" aria-label="Preview base model variants">
            {previewVariantBases.map((baseModel) => (
              <span
                key={baseModel}
                className={`${preview.baseModel === baseModel ? 'active ' : ''}base-${baseModel}`}
                title={`${previewBaseModelLabel(baseModel)} 缩略图`}
              >
                {previewBaseModelLabel(baseModel)}
              </span>
            ))}
          </div>
        )}
        {previewImageVariants.length > 1 && (
          <div className="preview-image-dots" aria-label="Preview images">
            {previewImageVariants.map((variant, index) => (
              <span
                key={variant.id}
                className={preview.variantId === variant.id ? 'active' : ''}
                title={`${previewBaseModelLabel(variant.baseModel)} 缩略图 ${index + 1}/${previewImageVariants.length}`}
                onClick={(event) => {
                  event.stopPropagation()
                  setActiveBlockPreviewVariant(block.id, variant.baseModel, variant.id)
                }}
                onMouseEnter={() => setActiveBlockPreviewVariant(block.id, variant.baseModel, variant.id)}
              />
            ))}
          </div>
        )}
        {loraBaseModels.length > 0 && (
          <div className="lora-base-badges" aria-label="LoRA training base model">
            {loraBaseModels.map((baseModel) => {
              const option = loraBaseModelOptions.find((item) => item.id === baseModel)
              return option ? <span key={baseModel}>{option.label}</span> : null
            })}
          </div>
        )}
        {hasReadablePreset && (
          <div className="preset-source-badge" title="PNG contains a readable workbench preset">
            P
          </div>
        )}
        {previewOriginalSource && (
          <span
            className="block-preview-zoom"
            role="button"
            tabIndex={0}
            title="查看大图"
            onClick={(event) => {
              event.stopPropagation()
              openImagePreview({
                source: previewOriginalSource,
                imagePath: preview.sourceImagePath,
                imageUrl: preview.sourceImageUrl,
                title: block.name,
                detail: preview.sourceImagePath || preview.sourceImageUrl,
              })
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              event.stopPropagation()
              openImagePreview({
                source: previewOriginalSource,
                imagePath: preview.sourceImagePath,
                imageUrl: preview.sourceImageUrl,
                title: block.name,
                detail: preview.sourceImagePath || preview.sourceImageUrl,
              })
            }}
          >
            <Search size={14} />
          </span>
        )}
        {blockDropActive && (
          <div className="block-drop-overlay">
            <ImagePlus size={22} />
            <strong>松开以设置预览图</strong>
            <small>竖图自动作为背景</small>
          </div>
        )}
        <span>{block.name}</span>
        <small>{block.notes?.trim() || block.positive.slice(0, 4).join(', ')}</small>
      </button>
    )
  }

  if (!authChecked) {
    return (
      <main className="workspace auth-shell">
        <section className="auth-panel">
          <ShieldCheck size={34} />
          <h1>正在检查访问权限</h1>
        </section>
      </main>
    )
  }

  if (!authStatus.authenticated) {
    const minutes = Math.ceil(authStatus.lockSeconds / 60)
    return (
      <main className="workspace auth-shell">
        <form className="auth-panel" onSubmit={unlockShare}>
          <ShieldCheck size={38} />
          <h1>输入访问密匙</h1>
          <p>{authStatus.locked ? `错误尝试已锁定约 ${minutes} 分钟，仍可输入正确密匙登录。` : '粘贴分配给你的访问密匙来打开这个 Comfy 工作台。'}</p>
          <input
            type="password"
            autoComplete="current-password"
            spellCheck={false}
            placeholder="访问密匙"
            value={accessKeyInput}
            onChange={(event) => setAccessKeyInput(event.target.value.trim())}
          />
          {authError && <span className="auth-error">{authError}</span>}
          <button type="submit" className="primary" disabled={!accessKeyInput.trim()}>
            解锁
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="workspace">
      <datalist id="sampler-options">
        {samplerOptions.map((sampler) => (
          <option key={sampler} value={sampler} />
        ))}
      </datalist>
      <datalist id="scheduler-options">
        {schedulerOptions.map((scheduler) => (
          <option key={scheduler} value={scheduler} />
        ))}
      </datalist>

      <header className="topbar">
        <div>
          <h1>Comfy 预制工作流</h1>
          <p>选择人物、服装、姿势和背景块，组合成可提交给 ComfyUI Gateway 的生图请求。</p>
        </div>
        <div className="top-actions">
          <div className="message-center">
            <button
              type="button"
              className={`status status-button ${status === '已连接' ? 'ok' : ''}`}
              onClick={toggleMessageCenter}
              title="查看工作台消息"
              aria-expanded={messageCenterOpen}
            >
              <Bell size={14} />
              <span>{status}</span>
              {messageUnread > 0 && <strong className="message-unread">{messageUnread}</strong>}
            </button>
            {messageCenterOpen && (
              <div className="message-popover" role="status">
                <div className="message-popover-header">
                  <div>
                    <strong>工作台消息</strong>
                    <span>最近 {messages.length} 条</span>
                  </div>
                  <div className="message-popover-actions">
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => setMessages([])}
                      title="清空消息"
                      disabled={messages.length === 0}
                    >
                      <Trash2 size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => {
                        messageCenterOpenRef.current = false
                        setMessageCenterOpen(false)
                      }}
                      title="关闭消息"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
                <div className="message-list">
                  {messages.length === 0 ? (
                    <p className="message-empty">暂无消息</p>
                  ) : (
                    messages.map((message) => (
                      <div key={message.id} className={`message-item ${message.tone}`}>
                        <span className="message-tone-dot" />
                        <div>
                          <p>{message.text}</p>
                          <time>{new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}</time>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <button type="button" className="icon-button" onClick={refreshGateway} title="扫描基模和 LoRA">
            <RefreshCcw size={18} />
          </button>
        </div>
      </header>

      <section className="layout">
        <aside
          className={`sidebar ${pageImageDragActive || presetDropActive ? 'preset-drop-visible' : ''} ${presetDropActive ? 'preset-drop-active' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault()
            setPresetDropActive(true)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
            setPresetDropActive(true)
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPresetDropActive(false)
          }}
          onDrop={(event) => {
            void handlePresetDrop(event)
          }}
        >
          {(pageImageDragActive || presetDropActive) && (
            <div className={`preset-drop-overlay ${presetDropActive ? 'active' : ''}`}>
              <Upload size={28} />
              <strong>{presetDropActive ? '松开鼠标开始读取 PNG 预设' : '拖入图片读取 PNG 预设'}</strong>
              <span>{presetDropActive ? '正在读取目标区域' : '支持外部 PNG，或从右侧输出图拖入'}</span>
            </div>
          )}
          <div className="panel compact">
            <div className="panel-title">
              <h2>基础参数</h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => updateState({ width: state.height, height: state.width })}
                title="宽高切换"
              >
                <ArrowLeftRight size={18} />
              </button>
            </div>
            <div className="param-grid">
              <label>
                Gateway
                <input value={state.gatewayUrl} onChange={(event) => updateState({ gatewayUrl: event.target.value })} />
              </label>
              <label>
                基模
                <select value={state.model} onChange={(event) => selectModel(event.target.value)}>
                  {modelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                      {model.detail ? ` · ${model.id}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <div className="model-base-panel wide-field">
                <div className="field-title">
                  <span>基模训练族</span>
                  <small>
                    {state.modelTrainingBases[state.model] ? '手动标记' : selectedModelTrainingBase === 'none' ? '未识别' : '自动推断'}
                  </small>
                </div>
                <div className="model-base-options">
                  {modelTrainingBaseOptions.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className={selectedModelTrainingBase === option.id ? 'active' : ''}
                      onClick={() => setCurrentModelTrainingBase(option.id)}
                      title={option.name}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.name}</span>
                    </button>
                  ))}
                </div>
                {selectedBaseModelProfile && selectedModelTrainingBase !== 'none' && (
                  <details className="base-profile-editor">
                    <summary>
                      <span>{modelTrainingBaseLabel(selectedModelTrainingBase)} 基础配置</span>
                      <small>切换到同族基模时自动套用</small>
                    </summary>
                    <div className="base-profile-grid">
                      <label className="wide-field">
                        正面基础词
                        <textarea
                          value={selectedBaseModelProfile.positivePrefix}
                          onChange={(event) => updateBaseModelProfile(selectedModelTrainingBase, { positivePrefix: event.target.value })}
                        />
                      </label>
                      <label className="wide-field">
                        负面基础词
                        <textarea
                          value={selectedBaseModelProfile.negativePrefix}
                          onChange={(event) => updateBaseModelProfile(selectedModelTrainingBase, { negativePrefix: event.target.value })}
                        />
                      </label>
                      <label>
                        预设
                        <input
                          value={selectedBaseModelProfile.preset}
                          onChange={(event) => updateBaseModelProfile(selectedModelTrainingBase, { preset: event.target.value })}
                        />
                      </label>
                      <label>
                        Steps
                        <input
                          type="number"
                          value={selectedBaseModelProfile.steps}
                          onChange={(event) => updateBaseModelProfile(selectedModelTrainingBase, { steps: Number(event.target.value) })}
                        />
                      </label>
                      <label>
                        CFG
                        <input
                          type="number"
                          step="0.1"
                          value={selectedBaseModelProfile.cfg}
                          onChange={(event) => updateBaseModelProfile(selectedModelTrainingBase, { cfg: Number(event.target.value) })}
                        />
                      </label>
                      <label>
                        采样器
                        <input
                          list="sampler-options"
                          value={selectedBaseModelProfile.sampler}
                          onChange={(event) => updateBaseModelProfile(selectedModelTrainingBase, { sampler: event.target.value })}
                        />
                      </label>
                      <label>
                        调度器
                        <input
                          list="scheduler-options"
                          value={selectedBaseModelProfile.scheduler}
                          onChange={(event) => updateBaseModelProfile(selectedModelTrainingBase, { scheduler: event.target.value })}
                        />
                      </label>
                      {selectedBaseModelProfile.width !== undefined && (
                        <label>
                          默认宽度
                          <ResolutionInput
                            alignment={resolutionAlignment}
                            value={selectedBaseModelProfile.width}
                            onCommit={(width) => updateBaseModelProfile(selectedModelTrainingBase, { width })}
                          />
                        </label>
                      )}
                      {selectedBaseModelProfile.height !== undefined && (
                        <label>
                          默认高度
                          <ResolutionInput
                            alignment={resolutionAlignment}
                            value={selectedBaseModelProfile.height}
                            onCommit={(height) => updateBaseModelProfile(selectedModelTrainingBase, { height })}
                          />
                        </label>
                      )}
                    </div>
                  </details>
                )}
              </div>
              <label>
                预设
                <input value={state.preset} onChange={(event) => updateState({ preset: event.target.value })} />
              </label>
              <label className="wide-field">
                文件名前缀
                <input
                  placeholder={defaultFilenamePrefix}
                  value={state.filenamePrefix}
                  onChange={(event) => updateState({ filenamePrefix: event.target.value })}
                />
              </label>
              <label className="wide-field">
                尺寸预设
                <div className="size-row">
                  <select
                    value={sizePresetValue}
                    onChange={(event) => {
                      const preset = sizePresets.find((item) => `${item.width}x${item.height}` === event.target.value)
                      if (preset) updateState({ width: preset.width, height: preset.height })
                    }}
                  >
                    <option value="custom">自定义尺寸</option>
                    {sizePresets.map((preset) => (
                      <option key={`${preset.width}x${preset.height}`} value={`${preset.width}x${preset.height}`}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <span className="aspect-badge">{aspectRatio}</span>
                  <span className="aspect-preview" title={`${state.width} x ${state.height}`}>
                    <span style={aspectPreviewStyle} />
                  </span>
                </div>
              </label>
              <label>
                宽度
                <ResolutionInput alignment={resolutionAlignment} value={state.width} onCommit={(width) => updateState({ width })} />
              </label>
              <label>
                高度
                <ResolutionInput alignment={resolutionAlignment} value={state.height} onCommit={(height) => updateState({ height })} />
              </label>
              <div className="wide-field resolution-step-controls">
                <span>等比调节</span>
                <button type="button" className="icon-button" disabled={!smallerResolution} aria-label="降低一档分辨率"
                  title={smallerResolution ? `降低一档：${smallerResolution.width}×${smallerResolution.height}` : '已到当前比例的最小尺寸'}
                  onClick={() => smallerResolution && updateState(smallerResolution)}><ArrowDown size={17} /></button>
                <button type="button" className="icon-button" disabled={!largerResolution} aria-label="提高一档分辨率"
                  title={largerResolution ? `提高一档：${largerResolution.width}×${largerResolution.height}` : '已到当前模型的尺寸上限'}
                  onClick={() => largerResolution && updateState(largerResolution)}><ArrowUp size={17} /></button>
              </div>
              <label>
                Steps
                <input type="number" value={state.steps} onChange={(event) => updateState({ steps: Number(event.target.value) })} />
              </label>
              <label>
                CFG
                <input type="number" step="0.1" value={state.cfg} onChange={(event) => updateState({ cfg: Number(event.target.value) })} />
              </label>
              <label>
                采样器
                <input list="sampler-options" value={state.sampler} onChange={(event) => updateState({ sampler: event.target.value })} />
              </label>
              <label>
                调度器
                <input list="scheduler-options" value={state.scheduler} onChange={(event) => updateState({ scheduler: event.target.value })} />
              </label>
              <label>
                Seed
                <input placeholder="留空随机" value={state.seed} onChange={(event) => updateState({ seed: event.target.value })} />
              </label>
              <label className="wide-field">
                默认正面词
                <textarea value={state.positivePrefix} onChange={(event) => updateState({ positivePrefix: event.target.value })} />
              </label>
              <label className="wide-field">
                默认负面词
                <textarea value={state.negativePrefix} onChange={(event) => updateState({ negativePrefix: event.target.value })} />
              </label>
            </div>
          </div>

          {(isMossModel(state.model) || selectedModelOption.mossCapabilities?.face_detail || state.faceDetail) && <div className="panel compact">
            <div className="panel-title"><h2>模型选项</h2></div>
            {isMossModel(state.model) && <label><input type="checkbox" checked={Boolean(state.mossOptions?.dmd)} disabled={!state.mossOptions?.dmd && (!selectedModelOption.mossCapabilities?.moss_dmd || selectedModelOption.mossCapabilities.moss_dmd.available === false)}
              onChange={(event) => updateState({ mossOptions: { faceRedraw: false, ...state.mossOptions, dmd: event.target.checked }, steps: event.target.checked ? 8 : 30 })} /> DMD 加速</label>}
            <label><input type="checkbox" checked={Boolean(state.faceDetail)} disabled={!state.faceDetail && (!selectedModelOption.mossCapabilities?.face_detail || selectedModelOption.mossCapabilities.face_detail.available === false)}
              onChange={(event) => updateState({ faceDetail: event.target.checked, mossOptions: { dmd: false, ...state.mossOptions, faceRedraw: event.target.checked } })} /> 重绘面部</label>
            {state.faceDetail && <div className="upscale-fields">
              {([{ key: 'denoise', label: '降噪', step: 0.01, min: 0.0001, max: 1 }, { key: 'steps', label: '步数', step: 1, min: 1, max: 100 }, { key: 'cfg', label: 'CFG', step: 0.1, min: 0, max: 100 }] as const).map(({ key, label, step, min, max }) => {
                const capability = selectedModelOption.mossCapabilities?.[`face_${key}`]
                return <label key={key}>{label}<input type="number" step={step} min={capability?.min ?? min} max={capability?.max ?? max}
                  value={resolveFaceParameters(state.model, state.baseModelProfiles, state.faceParameters)[key] ?? capability?.default ?? ''}
                  onChange={(event) => {
                    const raw = event.target.value
                    const number = Math.min(capability?.max ?? max, Math.max(capability?.min ?? min, Number(raw)))
                    updateState({ faceParameters: { ...state.faceParameters, [key]: raw === '' ? undefined : key === 'steps' ? Math.round(number) : number } })
                  }} /></label>
              })}
              <button type="button" className="icon-button" title="恢复当前模型修脸默认参数" onClick={() => updateState({ faceParameters: undefined })}><RefreshCcw size={16} /></button>
              {(['sampler', 'scheduler'] as const).map((key) => <label key={key}>{key === 'sampler' ? '采样器' : '调度器'}
                <input list={key === 'sampler' ? 'sampler-options' : 'scheduler-options'} value={resolveFaceParameters(state.model, state.baseModelProfiles, state.faceParameters)[key] ?? ''}
                  onChange={(event) => updateState({ faceParameters: { ...state.faceParameters, [key]: event.target.value || undefined } })} />
              </label>)}
            </div>}
            {!selectedModelOption.mossCapabilities?.face_detail && <p className="muted">当前网关未提供面部重绘能力，请更新网关后刷新模型。</p>}
            {['moss_dmd', 'face_detail'].map((field) => selectedModelOption.mossCapabilities?.[field]?.missing?.length ? <p className="upscale-validation" key={field}>缺少依赖：{selectedModelOption.mossCapabilities[field].missing?.join('、')}</p> : null)}
          </div>}
          <div className="panel generation-presets">
            <div className="panel-title">
              <h2>生成预设</h2>
              <button type="button" className="icon-button" onClick={saveGenerationPreset} title="保存当前为生成预设">
                <Plus size={18} />
              </button>
            </div>
            {state.generationPresets.length === 0 && <p className="muted">点加号保存当前组合、参数和放大链。</p>}
            <div className="generation-preset-list">
              {state.generationPresets.map((preset) => (
                <article className="generation-preset-card" key={preset.id}>
                  <button type="button" className="generation-preset-main" onClick={() => void loadGenerationPreset(preset.id)}>
                    <strong>{preset.name}</strong>
                    <span>
                      {preset.width}x{preset.height} · {preset.model} · {preset.selectedBlockIds.length} 块
                    </span>
                    <small>{preset.createdAt}</small>
                  </button>
                  <div className="generation-preset-actions">
                    <button type="button" className="icon-button" onClick={() => void overwriteGenerationPreset(preset.id)} title="用当前参数覆盖这个预设">
                      <Save size={16} />
                    </button>
                    <button type="button" className="icon-button danger" onClick={() => void removeGenerationPreset(preset.id)} title="删除生成预设">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">
              <h2>放大链</h2>
              {!isMossModel(state.model) && <button
                type="button"
                className="icon-button"
                onClick={addUpscale}
                title={selectedUsesKrea2Hires ? '添加 K2 高清阶段' : '添加放大块'}
                disabled={selectedUsesKrea2Hires && state.upscaleSteps.length >= (selectedModelOption.upscaleContract?.maxStages ?? 2)}
              >
                <Plus size={18} />
              </button>}
            </div>
            <div className="resolution-summary">
              <span>最终输出</span>
              <strong>{outputResolution.final}</strong>
              <small>
                {outputResolution.enabledCount > 0 ? `${outputResolution.enabledCount} 段 · 总倍率 x${outputResolution.scale}` : '未启用放大'}
              </small>
            </div>
            {krea2UpscaleValidation && <p className="upscale-validation">{krea2UpscaleValidation}</p>}
            {isMossModel(state.model) ? (
              <div className="upscale-fields">
                <label>放大方式
                  <select value={state.mossUpscale?.method || 'none'} onChange={(event) => updateState({ mossUpscale: { scale: 2, resolution: 2560, maxResolution: 2560, ...state.mossUpscale, method: event.target.value as MossUpscale['method'] } })}>
                    <option value="none">不放大</option>
                    <option value="omnisr">OmniSR</option>
                    <option value="seedvr2">SeedVR2</option>
                  </select>
                </label>
                {state.mossUpscale?.method === 'omnisr' && <label>倍率
                  <select value={state.mossUpscale.scale} onChange={(event) => updateState({ mossUpscale: { ...state.mossUpscale!, scale: Number(event.target.value) } })}>
                    {[2, 3, 4].map((scale) => <option key={scale} value={scale}>{scale}×</option>)}
                  </select>
                </label>}
                {state.mossUpscale?.method === 'seedvr2' && <>
                  <label>短边目标<input type="number" min="16" step="2" value={state.mossUpscale.resolution} onChange={(event) => updateState({ mossUpscale: { ...state.mossUpscale!, resolution: Math.max(16, Math.round(Number(event.target.value) / 2) * 2) } })} /></label>
                  <label>长边上限（0 不限）<input type="number" min="0" step="2" value={state.mossUpscale.maxResolution} onChange={(event) => updateState({ mossUpscale: { ...state.mossUpscale!, maxResolution: Math.max(0, Math.round(Number(event.target.value) / 2) * 2) } })} /></label>
                </>}
              </div>
            ) : <div className="upscale-list">
              {state.upscaleSteps.length === 0 && <p className="muted">点加号添加一个放大块。</p>}
              {state.upscaleSteps.map((step, index) => (
                <div className="upscale-row" key={step.id}>
                  <label>
                    <input type="checkbox" checked={step.enabled} onChange={(event) => updateUpscale(step.id, { enabled: event.target.checked })} />
                    <span title={selectedUsesKrea2Hires ? (index === 0 ? '潜空间高清重绘' : 'Ultimate SD Upscale 分块重绘') : undefined}>
                      {selectedUsesKrea2Hires ? (index === 0 ? '#1 潜空间' : '#2 USD') : `#${index + 1}`}
                    </span>
                  </label>
                  <div className="upscale-fields">
                    <label>
                      倍率
                      <input type="number" step="0.01" value={step.scale} onChange={(event) => updateUpscale(step.id, { scale: Number(event.target.value) })} />
                    </label>
                    <label>
                      步数
                      <input type="number" value={step.steps} onChange={(event) => updateUpscale(step.id, { steps: Number(event.target.value) })} />
                    </label>
                    <label>
                      CFG
                      <input type="number" step="0.1" value={step.cfg} onChange={(event) => updateUpscale(step.id, { cfg: Number(event.target.value) })} />
                    </label>
                    <label>
                      降噪
                      <input type="number" step="0.01" value={step.denoise} onChange={(event) => updateUpscale(step.id, { denoise: Number(event.target.value) })} />
                    </label>
                    <label>
                      采样器
                      <input
                        list="sampler-options"
                        value={step.sampler ?? state.sampler}
                        placeholder={`跟随基础：${state.sampler}`}
                        onChange={(event) => updateUpscale(step.id, { sampler: event.target.value })}
                      />
                    </label>
                    <label>
                      调度器
                      <input
                        list="scheduler-options"
                        value={step.scheduler ?? state.scheduler}
                        placeholder={`跟随基础：${state.scheduler}`}
                        onChange={(event) => updateUpscale(step.id, { scheduler: event.target.value })}
                      />
                    </label>
                  </div>
                  <button type="button" className="icon-button danger" onClick={() => removeUpscale(step.id)} title="删除放大块">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>}
          </div>
        </aside>

        <section className="center-panel">
          <div className="panel category-browser">
            <div className="panel-title category-title">
              <h2>分类预制块</h2>
              <div className="category-title-search">
                <Search size={17} />
                <input placeholder="搜索预制块、prompt、标签" value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} />
              </div>
              <div className="panel-title-actions">
                <button type="button" className="toggle" onClick={() => setCategoryEditorOpen(true)}>
                  <Settings2 size={16} />
                  类目
                </button>
                <div className="card-size-toggle" aria-label="卡片尺寸">
                  {[
                    { id: 'small' as const, label: '小' },
                    { id: 'medium' as const, label: '中' },
                    { id: 'large' as const, label: '大' },
                    { id: 'xlarge' as const, label: '特大' },
                    { id: 'xxlarge' as const, label: '巨大' },
                  ].map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className={cardSize === option.id ? 'active' : ''}
                      onClick={() => setCardSize(option.id)}
                      title={`卡片尺寸: ${option.label}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="card-size-toggle card-aspect-toggle" aria-label="卡片比例">
                  {[
                    { id: 'default' as const, label: '默认' },
                    { id: 'portrait916' as const, label: '9:16' },
                    { id: 'portrait34' as const, label: '3:4' },
                    { id: 'masonry' as const, label: '瀑布' },
                  ].map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className={cardAspect === option.id ? 'active' : ''}
                      onClick={() => setCardAspect(option.id)}
                      title={`卡片比例: ${option.label}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button type="button" className={editMode ? 'toggle active' : 'toggle'} onClick={() => setEditMode((value) => !value)}>
                  <Pencil size={16} />
                  编辑
                </button>
              </div>
            </div>

            <div className="category-filter-row">
              <div className="category-filter-left">
                <div className="preset-source-filter" aria-label="PNG preset filter">
                  <span>{'\u9884\u8bbe'}</span>
                  {[
                    { id: 'all' as const, label: '\u5168\u90e8' },
                    { id: 'with' as const, label: '\u6709' },
                    { id: 'without' as const, label: '\u65e0' },
                  ].map((option) => (
                    <button type="button" key={option.id} className={presetSourceFilter === option.id ? 'active' : ''} onClick={() => setPresetSourceFilter(option.id)}>
                      {option.label}
                    </button>
                  ))}
                  <button type="button" onClick={() => void markAllLegacyPreviewsFromSources()} title="读取旧缩略图来源 PNG，自动标记 IL/A 缩略图槽">
                    标图
                  </button>
                </div>
              <div className="lora-display-filter" aria-label="LoRA 底模显示过滤">
                <span>LoRA 底模</span>
                {loraBaseModelOptions.map((option) => (
                  <label key={option.id} className={visibleLoraBaseModels[option.id] ? 'active' : ''}>
                    <input
                      type="checkbox"
                      checked={visibleLoraBaseModels[option.id]}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setVisibleLoraBaseModels((current) => ({ ...current, [option.id]: checked }))
                      }}
                    />
                    <strong>{option.label}</strong>
                    <small>{visibleLoraBaseModels[option.id] ? '显示' : '隐藏'}</small>
                  </label>
                ))}
              </div>
              </div>
              <div className={colorPromptCollapsed ? 'color-prompt-strip collapsed' : 'color-prompt-strip'} aria-label="颜色预制词">
                <button type="button" className="color-strip-toggle" onClick={() => setColorPromptCollapsed((value) => !value)}>
                  {colorPromptCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  颜色{state.selectedColorPrompts.length > 0 ? ` ${state.selectedColorPrompts.length}` : ''}
                </button>
                {!colorPromptCollapsed &&
                  colorPromptPresets.map((item) => {
                    const selected = state.selectedColorPrompts.includes(item.prompt)
                    return (
                      <button
                        type="button"
                        key={item.prompt}
                        className={selected ? 'color-swatch selected' : 'color-swatch'}
                        style={{ '--swatch-color': item.color } as CSSProperties}
                        onClick={() => toggleColorPrompt(item.prompt)}
                        title={`${selected ? '移除' : '添加'} ${item.prompt}`}
                      >
                        <span />
                        {item.label}
                      </button>
                    )
                  })}
              </div>
            </div>

            <div className="prompt-drop-region"
              onDragOver={(event) => {
                if (selectedBlockDragIdRef.current || event.dataTransfer.types.includes(selectedBlockDragMime)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
                setPromptDropActive(true)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPromptDropActive(false)
              }}
              onDrop={(event) => {
                if (!selectedBlockDragIdRef.current && !event.dataTransfer.types.includes(selectedBlockDragMime)) void handlePresetDrop(event, true)
              }}>
            <div className="quick-block-strips">
              <div className="selection-strip" title={selectedBlocks.map((block) => block.name).join(' / ')}>
                <strong>已选 {selectedBlocks.length}</strong>
                {selectedBlocks.length === 0 ? (
                  <span>暂无</span>
                ) : (
                  selectedBlocks.map((block) => (
                    <button
                      type="button"
                      className={`selection-chip ${selectedBlockDragId === block.id ? 'dragging' : ''} ${selectedBlockDropId === block.id && selectedBlockDragId && selectedBlockDragId !== block.id ? 'drop-target' : ''}`}
                      key={block.id}
                      data-selected-block-id={block.id}
                      draggable
                      onDragStart={(event) => startSelectedBlockDrag(event, block.id)}
                      onPointerDown={(event) => startSelectedBlockPointerDrag(event, block.id)}
                      onPointerMove={moveSelectedBlockPointerDrag}
                      onPointerUp={(event) => endSelectedBlockPointerDrag(event, true)}
                      onPointerCancel={(event) => endSelectedBlockPointerDrag(event, false)}
                      onDragEnter={(event) => {
                        event.preventDefault()
                        if (selectedBlockDragIdRef.current) setSelectedBlockDropId(block.id)
                      }}
                      onDragOver={(event) => {
                        if (!selectedBlockDragIdRef.current) return
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                        setSelectedBlockDropId(block.id)
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        moveSelectedBlock(
                          event.dataTransfer.getData(selectedBlockDragMime) || selectedBlockDragIdRef.current || event.dataTransfer.getData('text/plain'),
                          block.id,
                        )
                        finishSelectedBlockDrag()
                      }}
                      onDragEnd={finishSelectedBlockDrag}
                      onClick={() => removeSelectedBlock(block.id)}
                      title={`拖动排序，点击移除 ${block.name}`}
                    >
                      <GripVertical size={13} />
                      {block.name}
                    </button>
                  ))
                )}
                {(selectedBlocks.length > 0 || state.selectedColorPrompts.length > 0) && (
                  <button type="button" className="selection-clear" onClick={() => updateState({ selectedBlockIds: [], selectedColorPrompts: [] })} title="清空选择">
                    <Eraser size={15} />
                    清空
                  </button>
                )}
              </div>
              <div className="recent-strip" title={recentBlocks.map((block) => block.name).join(' / ')}>
                <strong>最近</strong>
                {recentBlocks.length === 0 ? (
                  <span>暂无</span>
                ) : (
                  recentBlocks.map((block) => (
                    <button type="button" className="recent-chip" key={block.id} onClick={() => toggleBlock(block.id)} title={`添加 ${block.name}`}>
                      {block.name}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="custom-prompt-row">
              <label htmlFor="custom-positive-prompt" title="生成时追加在颜色词和已选块之后">
                <WandSparkles size={16} />
                <strong>自定义提示词</strong>
              </label>
              <textarea
                id="custom-positive-prompt"
                value={state.customPositivePrompt}
                onChange={(event) => updateState({ customPositivePrompt: event.target.value })}
                aria-label="自定义提示词"
              />
              <button
                type="button"
                className="icon-button"
                onClick={() => updateState({ customPositivePrompt: '' })}
                title="清空自定义提示词"
                disabled={!state.customPositivePrompt}
              >
                <Eraser size={16} />
              </button>
            </div>

            {pageImageDragActive && <div className={`preset-drop-overlay prompt-drop-overlay ${promptDropActive ? 'active' : ''}`}>
              <Upload size={24} />
              <strong>{promptDropActive ? '松开读取块与自定义提示词' : '拖入图片：仅读取块与自定义提示词'}</strong>
            </div>}
            </div>
            <div className={`category-stack card-size-${cardSize} card-aspect-${cardAspect} ${focusedCategoryId ? 'category-focus-mode' : ''}`}>
              {displayedCategories.map((category) => {
                const collapsed = collapsedCategoryIds.includes(category.id)
                const focused = focusedCategoryId === category.id
                return (
                  <section className={`category-section ${focused ? 'focused' : ''}`} key={category.id}>
                    <div className="category-heading">
                      <button
                        type="button"
                        className="category-toggle"
                        onClick={() => {
                          setActiveCategoryId(category.id)
                          toggleCategory(category.id)
                        }}
                      >
                      {collapsed ? <ChevronRight size={17} /> : <ChevronDown size={17} />}
                      <span>{category.name}</span>
                      {category.description && <em>{category.description}</em>}
                      {category.selectedCount > 0 && <strong>已选 {category.selectedCount}</strong>}
                      <small>{category.blocks.length}</small>
                      </button>
                      <button
                        type="button"
                        className={`category-focus-button ${focused ? 'active' : ''}`}
                        onClick={() => toggleFocusedCategory(category.id)}
                        title={focused ? '退出分类聚焦' : '只看这个分类'}
                      >
                        {focused ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                      </button>
                    </div>
                    {!collapsed && (
                      <div className="category-block-scroll">
                        <div
                          className="block-grid"
                          ref={(element) => {
                            categoryGridRefs.current[category.id] = element
                          }}
                          style={cardAspect === 'masonry' ? ({ '--masonry-columns': masonryColumnCounts[category.id] ?? 1 } as CSSProperties) : undefined}
                        >
                          {cardAspect === 'masonry' ? (
                            (() => {
                              const columnCount = Math.max(1, masonryColumnCounts[category.id] ?? 1)
                              const columns = Array.from({ length: columnCount }, () => [] as PresetBlock[])
                              category.blocks.forEach((block, index) => columns[index % columnCount].push(block))
                              const addColumnIndex = category.blocks.length % columnCount
                              return columns.map((column, columnIndex) => (
                                <div className="masonry-column" key={`${category.id}-column-${columnIndex}`}>
                                  {column.map(renderPresetBlockCard)}
                                  {columnIndex === addColumnIndex && (
                                    <button type="button" className="block-card add-block-card" onClick={() => addBlock(category.id)} title={`添加到 ${category.name}`}>
                                      <Plus size={28} />
                                      <span>新增预制块</span>
                                      <small>{category.name}</small>
                                    </button>
                                  )}
                                </div>
                              ))
                            })()
                          ) : (
                            <>
                              {category.blocks.map(renderPresetBlockCard)}
                              <button type="button" className="block-card add-block-card" onClick={() => addBlock(category.id)} title={`添加到 ${category.name}`}>
                                <Plus size={28} />
                                <span>新增预制块</span>
                                <small>{category.name}</small>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </section>
                )
              })}
              {displayedCategories.length === 0 && <p className="muted">没有找到匹配的预制块。</p>}
            </div>
          </div>
        </section>
        <aside className="right-panel">
          <div className="panel actions">
            <div className="panel-title">
              <h2>输出</h2>
              <WandSparkles size={20} />
            </div>
            <div className="resolution-summary output-resolution" title={outputResolution.chain}>
              <span>实际分辨率</span>
              <strong>{outputResolution.final}</strong>
              <small>初始 {outputResolution.base}</small>
            </div>
            <button type="button" className="primary" onClick={() => enqueueGeneration(false)} disabled={Boolean(krea2UpscaleValidation)} title={krea2UpscaleValidation || '提交生图'}>
              <Send size={18} />
              提交生图
            </button>
            <button type="button" onClick={() => enqueueGeneration(true)} disabled={isGenerating || generationQueue.length > 0 || Boolean(krea2UpscaleValidation)} title={krea2UpscaleValidation || 'Dry Run'}>
              <Eye size={18} />
              Dry Run
            </button>
            {isGenerating && (
              <button type="button" className="danger" onClick={cancelCurrentGeneration}>
                <X size={18} />
                取消当前
              </button>
            )}
            {generationQueue.length > 0 && (
              <button type="button" onClick={() => void clearGenerationQueue()}>
                <Eraser size={18} />
                清空等待（{generationQueue.length}）
              </button>
            )}
            <div className="queue-summary" aria-label="本机生成队列">
              <span className={currentJob ? 'active' : ''}>当前 <strong>{currentJob ? 1 : 0}</strong></span>
              <span>等待 <strong>{generationQueue.length}</strong></span>
              <span>合计 <strong>{(currentJob ? 1 : 0) + generationQueue.length}</strong></span>
            </div>
            <p className="queue-status">
              {currentJob ? `当前: ${currentJob.dryRun ? 'Dry Run' : '生图'} ${currentJob.createdAt}` : '当前: 空闲'}
            </p>
            {generationProgress && (
              <div className="generation-progress" aria-label="生成进度">
                <div className="generation-progress-meta">
                  <span>预计 {formatRemainingTime(generationProgress.remaining)} 后完成</span>
                  <span>{generationProgress.labelPercent}%</span>
                </div>
                <div className="generation-progress-track">
                  <span style={{ width: `${generationProgress.percent}%` }} />
                </div>
              </div>
            )}
            <p className="queue-status shared-generation-status">{sharedGenerationLabel}</p>
            <button
              type="button"
              className="result-box"
              onContextMenu={(event) => { event.preventDefault(); if (resultImage) setAlbumMenu({ source: { imagePath: resultImagePath || undefined, imageUrl: resultImage }, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 248)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 240)) }) }}
              onClick={() =>
                openImagePreview({
                  source: resultImage,
                  imagePath: resultImagePath || undefined,
                  imageUrl: !resultImagePath && /^https?:\/\//i.test(resultImage) ? resultImage : undefined,
                  title: '输出预览',
                  detail: resultImagePath,
                  albumItemId: resultHistoryId || undefined,
                })
              }
              disabled={!resultImage}
              draggable={Boolean(resultImage)}
              onDragStart={(event) =>
                startImageDrag(event, {
                  source: resultImage,
                  imagePath: resultImagePath,
                  imageUrl: !resultImagePath && /^https?:\/\//i.test(resultImage) ? resultImage : undefined,
                })
              }
              title="网页全屏预览；也可以拖到左侧读取 PNG 预设，或拖到卡片设置预览图"
            >
              {resultImage ? <img src={resultImage} alt="ComfyUI result" /> : <ImagePlus size={40} />}
            </button>
          </div>

          <div className={`panel output-album ${albumCollapsed ? 'collapsed' : ''}`}>
            <div className="panel-title">
              <button type="button" className="album-collapse-button" onClick={() => setAlbumCollapsed((value) => !value)}>
                {albumCollapsed ? <ChevronRight size={17} /> : <ChevronDown size={17} />}
                <h2>小相册</h2>
              </button>
              <span>{albumItems.length}</span>
            </div>
            {!albumCollapsed && (
              <>
                {albumItems.length === 0 && <p className="muted">生成后会在这里保留预览图。</p>}
                <div className="album-grid">
                  {albumItems.map((item) => {
                    const source = historyImageSource(item)
                    const thumbnailSource = historyThumbnailSource(item)
                    const selected = source === resultImage
                    const displayWidth = item.outputWidth ?? item.width
                    const displayHeight = item.outputHeight ?? item.height
                    return (
                      <div className="album-entry" key={item.id}>
                      <button
                        type="button"
                        key={item.id}
                        className={`album-thumb ${selected ? 'selected' : ''} ${albumLongPressItemId === item.id ? 'long-pressing' : ''}`}
                        draggable
                        onPointerDown={(event) => startAlbumLongPress(event, item)}
                        onPointerMove={moveAlbumLongPress}
                        onPointerUp={endAlbumLongPress}
                        onPointerCancel={endAlbumLongPress}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          cancelAlbumLongPress()
                          setAlbumMenu({ item, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 248)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 240)) })
                        }}
                        onDragStart={(event) =>
                          startImageDrag(event, {
                            source,
                            imagePath: item.imagePath,
                            imageUrl: item.imageUrl,
                          })
                        }
                        onClick={(event) => {
                          if (suppressAlbumClickRef.current) {
                            suppressAlbumClickRef.current = false
                            event.preventDefault()
                            return
                          }
                          setResultImage(source)
                          setResultImagePath(item.imagePath || '')
                          setResultHistoryId(item.id)
                        }}
                        title={`${item.createdAt} · ${displayWidth}x${displayHeight}`}
                      >
                        <img src={thumbnailSource} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                        <span>{displayWidth}x{displayHeight}</span>
                      </button>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          <div className="panel">
            <div className="panel-title">
              <h2>组合预览</h2>
              <button type="button" className="icon-button" onClick={() => navigator.clipboard.writeText(composed.previewPrompt)} title="复制正向词">
                <Copy size={18} />
              </button>
            </div>
            <div className="prompt-box">
              <strong>Positive</strong>
              <p>{composed.previewPrompt || '还没有选择预制块'}</p>
            </div>
            <div className="prompt-box negative">
              <strong>Negative</strong>
              <p>{composed.negative || '暂无负面词'}</p>
            </div>
            <div className="lora-strip">
              {composed.loras.length ? composed.loras.map((lora, index) => <span key={`${lora.name}-${index}`}>{lora.name}</span>) : <span>暂无 LoRA</span>}
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">
              <h2>请求 JSON</h2>
              <Settings2 size={18} />
            </div>
            <pre>{JSON.stringify(requestBody, null, 2)}</pre>
          </div>

          <div className="panel storage-actions">
            <button type="button" onClick={exportState}>
              <Download size={18} />
              导出配置
            </button>
            <label className="file-button">
              <Upload size={18} />
              导入配置
              <input type="file" accept="application/json" onChange={(event) => importState(event.target.files?.[0])} />
            </label>
            <label className="file-button">
              <ImagePlus size={18} />
              导入 PNG 预设
              <input
                type="file"
                accept="image/png"
                onChange={(event) => {
                  void importPngPreset(event.target.files?.[0])
                  event.currentTarget.value = ''
                }}
              />
            </label>
            <button type="button" onClick={() => void clearHistory()}>
              <Save size={18} />
              清空历史
            </button>
          </div>

          <div className="panel history">
            <h2>历史</h2>
            {state.history.length === 0 && <p className="muted">生成后会记录参数快照。</p>}
            {state.history.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => updateState({ width: item.width, height: item.height, model: item.model })}
              >
                <strong>{item.createdAt}</strong>
                <span>
                  {item.width}x{item.height} · {item.model}
                </span>
              </button>
            ))}
          </div>
        </aside>
      </section>

      {confirmDialog && (
        <div className="modal-backdrop confirm-backdrop" role="presentation" onClick={() => closeConfirmDialog(false)}>
          <section
            className={confirmDialog.tone === 'danger' ? 'confirm-modal danger-tone' : 'confirm-modal'}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-message"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="confirm-header">
              <ShieldCheck size={22} />
              <div>
                <h2 id="confirm-dialog-title">{confirmDialog.title}</h2>
                <p id="confirm-dialog-message">{confirmDialog.message}</p>
              </div>
            </header>
            <div className="confirm-actions">
              <button type="button" onClick={() => closeConfirmDialog(false)}>
                {confirmDialog.cancelLabel ?? '取消'}
              </button>
              <button
                type="button"
                className={confirmDialog.tone === 'danger' ? 'confirm-primary danger-confirm' : 'confirm-primary primary'}
                onClick={() => closeConfirmDialog(true)}
                autoFocus
              >
                {confirmDialog.confirmLabel ?? '确认'}
              </button>
            </div>
          </section>
        </div>
      )}

      {albumMenu && <div className="album-menu-overlay" onPointerDown={() => setAlbumMenu(null)} onContextMenu={(event) => { event.preventDefault(); setAlbumMenu(null) }}>
        <div ref={albumMenuRef} className="album-context-menu" role="menu" aria-label="相册图片操作" style={{ left: albumMenu.x, top: albumMenu.y }} onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const buttons = Array.from(event.currentTarget.querySelectorAll('button'))
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
            buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
          }}>
          {albumMenu.item && <>
            <button role="menuitem" onClick={() => { const item = albumMenu.item!; setAlbumMenu(null); void importAlbumPngPreset(item) }}><Upload size={16} />使用此图片预设</button>
            <button role="menuitem" onClick={() => { const item = albumMenu.item!; setAlbumMenu(null); void importAlbumPngPreset(item, true) }}><RefreshCcw size={16} />使用此图片预设＋种子</button>
          </>}
          <button role="menuitem" onClick={() => { const source = albumMenu.source || albumMenu.item!; setAlbumMenu(null); void copyPreviewImage(source) }}><Copy size={16} />复制图片</button>
          <button role="menuitem" onClick={() => { const source = albumMenu.source || albumMenu.item!; setAlbumMenu(null); void openNativeImage(source, 'open') }}><Eye size={16} />用系统默认应用打开</button>
          <button role="menuitem" onClick={() => { const source = albumMenu.source || albumMenu.item!; setAlbumMenu(null); void openNativeImage(source, 'folder') }}><FolderOpen size={16} />打开所在目录</button>
          {albumMenu.item && <button role="menuitem" className="danger" onClick={() => { const item = albumMenu.item!; setAlbumMenu(null); void deleteAlbumImage(item) }}><Trash2 size={16} />删除图片和本地原图</button>}
        </div>
      </div>}
      {imagePreviewOpen && imagePreviewTarget?.source && (
        <div className="modal-backdrop image-preview-backdrop" role="presentation" onClick={closeImagePreview}>
          <section className="image-preview-modal" role="dialog" aria-modal="true" aria-label="图片预览" onClick={(event) => event.stopPropagation()}>
            <header className="image-preview-header">
              <div>
                <h2>{imagePreviewTarget.title}</h2>
                {imagePreviewTarget.detail && <p>{imagePreviewTarget.detail}</p>}
              </div>
              <div className="image-preview-header-actions">
                {imagePreviewAlbumIndex >= 0 && <span className="image-preview-counter">{imagePreviewAlbumIndex + 1} / {albumItems.length}</span>}
                <button type="button" className="icon-button" onClick={closeImagePreview} title="关闭预览">
                  <X size={18} />
                </button>
              </div>
            </header>
            <div className="image-preview-stage">
              {imagePreviewAlbumIndex >= 0 && (
                <button
                  type="button"
                  className="image-preview-nav previous"
                  onClick={() => showAlbumPreview(imagePreviewAlbumIndex - 1)}
                  disabled={imagePreviewAlbumIndex === 0}
                  title="上一张"
                  aria-label="上一张"
                >
                  <ChevronLeft size={26} />
                </button>
              )}
              <img
                src={imagePreviewTarget.source}
                alt="Full preview"
                onContextMenu={(event) => { event.preventDefault(); setAlbumMenu({ source: imagePreviewTarget, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 248)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 240)) }) }}
                draggable
                onDragStart={(event) =>
                  startImageDrag(event, {
                    source: imagePreviewTarget.source,
                    imagePath: imagePreviewTarget.imagePath,
                    imageUrl: imagePreviewTarget.imageUrl,
                  })
                }
                title="拖到左侧读取 PNG 预设，或拖到卡片设置预览图并绑定来源"
              />
              {imagePreviewAlbumIndex >= 0 && (
                <button
                  type="button"
                  className="image-preview-nav next"
                  onClick={() => showAlbumPreview(imagePreviewAlbumIndex + 1)}
                  disabled={imagePreviewAlbumIndex === albumItems.length - 1}
                  title="下一张"
                  aria-label="下一张"
                >
                  <ChevronRight size={26} />
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {categoryEditorOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="category-editor-modal" role="dialog" aria-modal="true" aria-label="管理类目">
            <header className="modal-header">
              <div>
                <h2>管理类目</h2>
                <p>用于预制块分类、排序和给 agent 扩展新类型。</p>
              </div>
              <div className="modal-actions">
                <button type="button" onClick={addCategory}>
                  <Plus size={16} />
                  新增
                </button>
                <button type="button" className="icon-button" onClick={closeCategoryEditor} title="关闭">
                  <X size={18} />
                </button>
              </div>
            </header>
            <div className="category-editor-list">
              {state.categories.map((category, index) => {
                const usedCount = state.blocks.filter((block) => block.categoryId === category.id).length
                const builtin = defaultCategoryIds.has(category.id)
                return (
                  <div className="category-editor-row" key={category.id}>
                    <div className="category-editor-order">
                      <button type="button" className="icon-button" onClick={() => moveCategory(category.id, -1)} disabled={index === 0} title="上移">
                        <ArrowUp size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => moveCategory(category.id, 1)}
                        disabled={index === state.categories.length - 1}
                        title="下移"
                      >
                        <ArrowDown size={16} />
                      </button>
                    </div>
                    <label>
                      名称
                      <input value={category.name} onChange={(event) => updateCategory(category.id, { name: event.target.value })} />
                    </label>
                    <label>
                      描述
                      <input value={category.description ?? ''} onChange={(event) => updateCategory(category.id, { description: event.target.value })} />
                    </label>
                    <label>
                      ID
                      <input
                        value={category.id}
                        disabled={builtin}
                        onChange={(event) => updateCategory(category.id, { id: event.target.value })}
                        title={builtin ? '内置类目 ID 固定，可改名称和排序' : '用于 MCP 和预制块引用'}
                      />
                    </label>
                    <div className="category-editor-meta">
                      <span>{usedCount} 块</span>
                      {builtin && <span>内置</span>}
                    </div>
                    <button
                      type="button"
                      className="icon-button danger"
                      onClick={() => void removeCategory(category.id)}
                      disabled={builtin || usedCount > 0}
                      title={builtin ? '内置类目不可删除' : usedCount > 0 ? '请先移动或删除此类目下的块' : '删除类目'}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      )}

      {editorOpen && editingBlock && (
        <div className="modal-backdrop" role="presentation">
          <section className="editor-modal" role="dialog" aria-modal="true" aria-label="编辑预制块">
            <header className="modal-header">
              <div>
                <h2>编辑预制块</h2>
                <p>{editingBlock.name}</p>
              </div>
              <div className="modal-actions">
                <button type="button" className="icon-button" onClick={duplicateEditingBlock} title="复制并编辑副本">
                  <Copy size={18} />
                </button>
                <button type="button" className="icon-button" onClick={() => void saveEditingBlock()} title="保存并关闭">
                  <Save size={18} />
                </button>
                <button type="button" className="icon-button" onClick={() => void closeBlockEditor()} title="关闭">
                  <X size={18} />
                </button>
              </div>
            </header>

            <div className="modal-body">
              <section className="editor-main">
                <div className="editor-grid">
                  <label>
                    名称
                    <input value={editingBlock.name} onChange={(event) => updateBlock(editingBlock.id, { name: event.target.value })} />
                  </label>
                  <label>
                    分类
                    <select value={editingBlock.categoryId} onChange={(event) => updateBlock(editingBlock.id, { categoryId: event.target.value })}>
                      {state.categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  备注
                  <textarea
                    className="notes-textarea"
                    placeholder="用途、来源、搭配建议或触发说明"
                    value={editingBlock.notes ?? ''}
                    onChange={(event) => updateBlock(editingBlock.id, { notes: event.target.value })}
                  />
                </label>
                <div className="prompt-editor-field">
                  <div className="field-title">
                    <span>正向词</span>
                    <button type="button" onClick={() => setTranslatedPromptField(translatedPromptField === 'positive' ? null : 'positive')}>
                      <Languages size={16} />
                      中文对照
                    </button>
                  </div>
                  <textarea value={editingBlock.positive.join(', ')} onChange={(event) => updateBlock(editingBlock.id, { positive: splitLines(event.target.value) })} />
                  {translatedPromptField === 'positive' && (
                    <div className="prompt-translation-panel inline-translation-panel">
                      <div className="field-title">
                        <span>正向词中文对照</span>
                        <button type="button" className="icon-button" onClick={() => setTranslatedPromptField(null)} title="关闭中文对照">
                          <X size={16} />
                        </button>
                      </div>
                      {translatedPromptItems.length === 0 && <p className="muted">当前没有可翻译的提示词。</p>}
                      {translatedPromptItems.length > 0 && (
                        <div className="translation-list">
                          {translatedPromptItems.map((item, index) => (
                            <div className="translation-row" key={`${item.source}-${index}`}>
                              <code>{item.source}</code>
                              <span>{item.target}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <details className="prompt-editor-field prompt-details">
                  <summary>
                    <span>负面词</span>
                    <small>{editingBlock.negative.length} 条</small>
                  </summary>
                  <textarea value={editingBlock.negative.join(', ')} onChange={(event) => updateBlock(editingBlock.id, { negative: splitLines(event.target.value) })} />
                </details>

                <div className="lora-editor">
                  <div className="panel-title">
                    <h3>LoRA</h3>
                    <button type="button" onClick={refreshGateway}>
                      <RefreshCcw size={16} />
                      扫描
                    </button>
                  </div>
                  <div className="lora-add-row">
                    <input placeholder="搜索或输入 LoRA，支持空格分词" value={loraDraft} onChange={(event) => setLoraDraft(event.target.value)} />
                    <button type="button" onClick={extractLoraPromptToEditingBlock} title="读取 LoRA 元数据里的触发词到正向词">
                      <WandSparkles size={16} />
                      触发词
                    </button>
                    <button type="button" onClick={importLoraPreviewToEditingBlock} title="读取 LoRA 的 Civitai 或本地预览图作为缩略图">
                      <ImagePlus size={16} />
                      缩略图
                    </button>
                    <button type="button" onClick={addLoraToEditingBlock}>
                      <Plus size={16} />
                      添加
                    </button>
                  </div>
                  <div className="lora-base-editor">
                    <span>训练底模</span>
                    {editingBlock.loras.length === 0 ? (
                      <small>绑定 LoRA 后显示标记</small>
                    ) : (
                      loraBaseModelOptions.map((option) => (
                        <label key={option.id} className="lora-base-toggle">
                          <input
                            type="checkbox"
                            checked={blockLoraBaseModels(editingBlock).includes(option.id)}
                            onChange={() => toggleEditingBlockLoraBaseModel(option.id)}
                          />
                          <strong>{option.label}</strong>
                          <small>{option.name}</small>
                        </label>
                      ))
                    )}
                  </div>
                  <div className="lora-filter-row" aria-label="LoRA base model filter">
                    {[
                      { id: 'all' as const, label: '全部' },
                      ...loraBaseModelOptions.map((option) => ({ id: option.id, label: option.label })),
                      { id: 'unknown' as const, label: '未识别' },
                    ].map((option) => (
                      <button
                        type="button"
                        key={option.id}
                        className={loraBaseFilter === option.id ? 'active' : ''}
                        onClick={() => setLoraBaseFilter(option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="lora-search-results">
                    {loras.length === 0 && <p className="muted">还没有扫描到 LoRA。</p>}
                    {loras.length > 0 && filteredLoras.length === 0 && <p className="muted">没有匹配的 LoRA。</p>}
                    {filteredLoras.map((lora) => (
                      <button type="button" key={lora} onClick={() => setLoraDraft(lora)} title={lora}>
                        {lora}
                      </button>
                    ))}
                  </div>
                  <div className="lora-table">
                    {editingBlock.loras.length === 0 && <p className="muted">还没有绑定 LoRA。</p>}
                    {editingBlock.loras.map((lora, index) => (
                      <div
                        className={`lora-row ${loraDragIndex === index ? 'dragging' : ''} ${loraDropIndex === index && loraDragIndex !== null && loraDragIndex !== index ? 'drop-target' : ''}`}
                        key={`${lora.name}-${index}`}
                        onDragEnter={(event) => {
                          event.preventDefault()
                          if (loraDragIndex !== null) setLoraDropIndex(index)
                        }}
                        onDragOver={(event) => {
                          if (loraDragIndex === null) return
                          event.preventDefault()
                          event.dataTransfer.dropEffect = 'move'
                          setLoraDropIndex(index)
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          const fromIndex = Number(event.dataTransfer.getData('text/plain'))
                          if (Number.isInteger(fromIndex)) moveEditingLora(fromIndex, index)
                          finishEditingLoraDrag()
                        }}
                      >
                        <button
                          type="button"
                          className="icon-button lora-drag-handle"
                          draggable
                          onDragStart={(event) => startEditingLoraDrag(event, index)}
                          onDragEnd={finishEditingLoraDrag}
                          title="拖动调整 LoRA 顺序"
                        >
                          <GripVertical size={16} />
                        </button>
                        <input value={lora.name} onChange={(event) => updateEditingLora(index, { name: event.target.value })} />
                        <label>
                          模型权重
                          <input
                            type="number"
                            step="0.05"
                            value={lora.strength_model}
                            onChange={(event) => updateEditingLora(index, { strength_model: Number(event.target.value) })}
                          />
                        </label>
                        <label>
                          CLIP 权重
                          <input
                            type="number"
                            step="0.05"
                            value={lora.strength_clip}
                            onChange={(event) => updateEditingLora(index, { strength_clip: Number(event.target.value) })}
                          />
                        </label>
                        <button type="button" className="icon-button danger" onClick={() => removeEditingLora(index)} title="删除 LoRA">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <aside className="editor-side">
                <div className="preview-uploader">
                  {editingPreview?.image ? <img src={editingPreview.image} alt="预制块预览" /> : <ImagePlus size={44} />}
                </div>
                <div className="preview-variant-status">
                  {previewBaseModelOptions.map((option) => {
                    const variants = editingBlock.previewVariants?.filter((item) => item.baseModel === option.id && item.image) ?? []
                    const isActive = editingPreview?.baseModel === option.id
                    const isLegacy = option.id === 'none' && variants.length === 0 && Boolean(editingBlock.previewImage)
                    return (
                      <span key={option.id} className={`${variants.length > 0 || isLegacy ? 'has-image' : ''} ${isActive ? 'active' : ''}`} title={option.name}>
                        {option.label}{variants.length > 1 ? ` ${variants.length}` : ''}
                      </span>
                    )
                  })}
                </div>
                <div className="preview-fit-editor">
                  <span>{previewBaseModelLabel(previewBaseForBlock(editingBlock))}显示{editingPreview?.baseVariantCount && editingPreview.baseVariantCount > 1 ? ` ${editingPreview.variantIndex}/${editingPreview.baseVariantCount}` : ''}</span>
                  {[
                    { id: 'crop' as const, label: '裁剪' },
                    { id: 'fit' as const, label: '完整' },
                    { id: 'background' as const, label: '背景' },
                  ].map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className={(editingPreview?.fit ?? 'crop') === option.id ? 'active' : ''}
                      onClick={() => updateBlockPreviewFit(editingBlock.id, previewBaseForBlock(editingBlock), option.id, editingPreview?.variantId)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <label>
                  预览图数据或地址
                  <input
                    placeholder="上传图片会缓存缩略图；手填地址只保存引用"
                    value={editingPreview?.image ?? editingBlock.previewImage ?? ''}
                    onChange={(event) => updateBlockPreviewImage(editingBlock.id, previewBaseForBlock(editingBlock), editingPreview?.variantId, event.target.value)}
                    onBlur={cacheEditingPreviewUrl}
                  />
                </label>
                <label>
                  来源图路径
                  <input
                    placeholder="ComfyUI 输出 PNG 原图路径；可用于读取配置"
                    value={editingPreview?.sourceImagePath ?? ''}
                    onChange={(event) =>
                      updateBlockPreviewSource(editingBlock.id, previewBaseForBlock(editingBlock), editingPreview?.variantId, {
                        imagePath: event.target.value,
                        imageUrl: editingPreview?.sourceImageUrl,
                      })
                    }
                  />
                </label>
                <label>
                  来源图 URL
                  <input
                    placeholder="可访问的 PNG 原图 URL；路径优先于 URL"
                    value={editingPreview?.sourceImageUrl ?? ''}
                    onChange={(event) =>
                      updateBlockPreviewSource(editingBlock.id, previewBaseForBlock(editingBlock), editingPreview?.variantId, {
                        imagePath: editingPreview?.sourceImagePath,
                        imageUrl: event.target.value,
                      })
                    }
                  />
                </label>
                <div className={`source-preset-status ${blockPresetStatus[editingBlock.id] === 'ready' ? 'ready' : ''}`}>
                  <strong>{'PNG\u9884\u8bbe'}</strong>
                  <span>{blockPresetStatus[editingBlock.id] === 'ready' ? '\u53ef\u8bfb\u53d6' : blockPresetStatus[editingBlock.id] === 'checking' ? '\u68c0\u6d4b\u4e2d' : '\u65e0'}</span>
                </div>
                <label className="file-button wide-file">
                  <Upload size={18} />
                  缓存缩略图
                  <input type="file" accept="image/*" onChange={(event) => importPreviewImage(event.target.files?.[0])} />
                </label>
                <button type="button" onClick={useCurrentOutputAsPreview} disabled={!resultImage} title={resultImage ? '把右侧当前输出图缓存为这个块的预览图' : '还没有当前输出图'}>
                  <ImagePlus size={18} />
                  使用当前输出图
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => void removeEditingPreview()}
                  disabled={!editingPreview?.image}
                  title={editingPreview?.image ? '删除当前显示的预览图及其来源信息' : '当前没有可删除的预览图'}
                >
                  <Trash2 size={18} />
                  删除当前预览图
                </button>
                <button
                  type="button"
                  onClick={() => importBlockPreviewSourcePreset(editingBlock)}
                  disabled={blockPresetStatus[editingBlock.id] !== 'ready'}
                  title={blockPresetStatus[editingBlock.id] === 'ready' ? '读取当前缩略图来源 PNG 中保存的工作台配置' : '当前缩略图没有可读取的工作台预设'}
                >
                  <Upload size={18} />
                  读取来源配置
                </button>
                <button type="button" onClick={() => void markBlockPreviewFromSource(editingBlock)} disabled={!legacyPreviewCandidate(editingBlock)?.sourceImagePath} title={legacyPreviewCandidate(editingBlock)?.sourceImagePath ? '读取来源 PNG 并自动标记缩略图底模' : '这个块没有可读取的本地来源 PNG'}>
                  <WandSparkles size={18} />
                  识别底模
                </button>
                <div className="editor-danger">
                  <button type="button" className="danger" onClick={() => void removeBlock(editingBlock.id)}>
                    <Trash2 size={18} />
                    删除预制块
                  </button>
                </div>
              </aside>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
