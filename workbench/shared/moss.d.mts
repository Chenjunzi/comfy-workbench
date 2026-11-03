export type MossUpscale = { method: 'none' | 'omnisr' | 'seedvr2'; scale: number; resolution: number; maxResolution: number }
export function isMossModel(model: string): boolean
export type MossOptions = { dmd: boolean; faceRedraw: boolean }
export type FaceParameters = { steps?: number; cfg?: number; denoise?: number; sampler?: string; scheduler?: string }
export function resolveFaceParameters(model: string, profiles?: Partial<Record<string, { steps?: number; cfg?: number; sampler?: string; scheduler?: string }>>, overrides?: FaceParameters): FaceParameters
export function faceParametersBody(enabled?: boolean, parameters?: FaceParameters): Record<string, number | string>
export function mossOptionsBody(value: { model?: string; mossOptions?: Partial<MossOptions> }): { model?: string; moss_dmd: boolean; face_detail: boolean }
export function mossResultMessage(value: unknown): string
export function normalizeMossGeneration<T extends { model?: string; mossOptions?: Partial<MossOptions>; faceDetail?: boolean }>(value: T): T & { mossOptions: MossOptions; faceDetail: boolean }
export function normalizeMossUpscale(value?: Partial<MossUpscale>): MossUpscale
export function mossUpscaleBody(value?: Partial<MossUpscale>): Record<string, string | number>
