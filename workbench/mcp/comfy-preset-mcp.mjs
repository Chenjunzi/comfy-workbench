#!/usr/bin/env node

import crypto from 'node:crypto'
import { resolveFaceParameters, faceParametersBody, isMossModel, mossUpscaleBody, mossOptionsBody, normalizeMossGeneration } from '../shared/moss.mjs'
import { existsSync } from 'node:fs'
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat, utimes } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workbenchUrl = (process.env.COMFY_PRESET_WORKBENCH_URL || 'http://127.0.0.1:5173').replace(/\/$/, '')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const stateSource = `${workbenchUrl}/workbench`
const accessKeysFile = process.env.COMFY_PRESET_ACCESS_KEYS_FILE || path.join(repoRoot, 'data', 'access-keys.txt')
const defaultFilenamePrefix = 'Preset/%character%/%date:yyyyMMddhhmmss%'
const sourceDownloadCacheDir = path.resolve(
  process.env.COMFY_PRESET_SOURCE_CACHE_DIR || path.join(os.tmpdir(), 'comfy-preset-workflow-ui', 'source-images'),
)
const sourceDownloadMaxBytes = 64 * 1024 * 1024
const configuredSourceDownloadTtlMs = Number(process.env.COMFY_PRESET_SOURCE_CACHE_TTL_MS)
const configuredSourceDownloadMaxFiles = Number(process.env.COMFY_PRESET_SOURCE_CACHE_MAX_FILES)
const sourceDownloadTtlMs = Number.isFinite(configuredSourceDownloadTtlMs)
  ? Math.max(60_000, Math.floor(configuredSourceDownloadTtlMs))
  : 24 * 60 * 60 * 1000
const sourceDownloadMaxFiles = Number.isFinite(configuredSourceDownloadMaxFiles)
  ? Math.max(1, Math.floor(configuredSourceDownloadMaxFiles))
  : 128

const defaultCategories = [
  { id: 'character', name: '人物', description: '角色身份、外貌特征与人物 LoRA' },
  { id: 'outfit', name: '服装', description: '服装、制服、配饰与穿着材质' },
  { id: 'pose', name: '姿势', description: '通用姿态、动作与身体朝向' },
  { id: 'background', name: '背景', description: '地点、环境、天气与场景布置' },
  { id: 'style', name: '画风', description: '画风、渲染质感与全局风格 LoRA' },
  { id: 'negative', name: '负面词', description: '排除缺陷、构图问题与不需要的内容' },
]
const defaultCategoryIds = new Set(defaultCategories.map((category) => category.id))
const baseModelIds = ['illustrious', 'anima', 'krea2']
const loraBaseModelIds = [...baseModelIds, 'moss']
const defaultBaseModelProfiles = {
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

const tools = [
  {
    name: 'comfy_gateway_health',
    description: 'Check the Windows workbench-managed ComfyUI Agent Gateway without connecting to port 8765 directly.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'comfy_list_models',
    description: 'List high-level generation model keys exposed by the gateway.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'comfy_list_loras',
    description: 'List installed LoRA names. Use query to filter a large LoRA library.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive substring filter.' },
        limit: { type: 'number', description: 'Maximum items to return. Default 80.' },
      },
    },
  },
  {
    name: 'comfy_get_base_model_profiles',
    description: 'Read the shared web UI base-model training profiles for Illustrious/IL and Anima.',
    inputSchema: {
      type: 'object',
      properties: {
        base: { type: 'string', enum: baseModelIds, description: 'Optional base profile to return. Omit to return all profiles.' },
      },
    },
  },
  {
    name: 'comfy_update_base_model_profile',
    description: 'Update one shared web UI base-model training profile used when switching Illustrious/IL or Anima models.',
    inputSchema: {
      type: 'object',
      required: ['base'],
      properties: {
        base: { type: 'string', enum: baseModelIds, description: 'Profile to update: illustrious for 光辉/IL, anima for Anima, or krea2 for Krea 2.' },
        positivePrefix: { type: 'string', description: 'Default positive prompt prefix for this training base.' },
        negativePrefix: { type: 'string', description: 'Default negative prompt prefix for this training base.' },
        preset: { type: 'string', description: 'Gateway preset name, for example anime_manga_fast.' },
        steps: { type: 'number', description: 'Base sampler steps.' },
        cfg: { type: 'number', description: 'Base CFG.' },
        sampler: { type: 'string', description: 'Base sampler name.' },
        scheduler: { type: 'string', description: 'Base scheduler name.' },
        width: { type: 'number', description: 'Default initial width for this training base.' },
        height: { type: 'number', description: 'Default initial height for this training base.' },
        upscaleSteps: {
          type: 'array',
          maxItems: 8,
          description: 'Default visible workbench upscale stages for this training base.',
          items: {
            type: 'object',
            required: ['scale', 'steps', 'cfg', 'denoise'],
            properties: {
              id: { type: 'string' },
              enabled: { type: 'boolean' },
              scale: { type: 'number' },
              steps: { type: 'number' },
              cfg: { type: 'number' },
              denoise: { type: 'number' },
              sampler: { type: 'string' },
              scheduler: { type: 'string' },
            },
          },
        },
        reset: { type: 'boolean', description: 'Reset the chosen profile to the built-in default before applying provided fields.' },
      },
    },
  },
  {
    name: 'comfy_generate_image',
    description: 'Generate an image through the gateway without building raw ComfyUI workflow JSON.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Main positive prompt.' },
        prefix: { type: 'string', description: 'Optional positive quality prefix.' },
        negative: { type: 'string', description: 'Negative prompt.' },
        model: { type: 'string', description: 'Gateway model key, for example gembyte_emerald.' },
        preset: { type: 'string', description: 'Gateway preset name. Default anime_manga_fast.' },
        width: { type: 'number', description: 'Image width, preferably a multiple of 8.' },
        height: { type: 'number', description: 'Image height, preferably a multiple of 8.' },
        steps: { type: 'number', description: 'Base sampler steps.' },
        cfg: { type: 'number', description: 'Base CFG.' },
        seed: { type: 'number', description: 'Optional seed.' },
        sampler_name: { type: 'string', description: 'Base sampler name.' },
        scheduler: { type: 'string', description: 'Base scheduler name.' },
        loras: {
          type: 'array',
          description: 'LoRAs as strings or objects with name, strength_model, and strength_clip.',
          items: {
            anyOf: [
              { type: 'string' },
              {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  strength_model: { type: 'number' },
                  strength_clip: { type: 'number' },
                },
              },
            ],
          },
        },
        filename_prefix: { type: 'string', description: 'Gateway filename prefix. Default MCP/%date:yyyyMMddhhmmss%.' },
        upscale_scale: { type: 'number', description: 'Optional one-stage upscale scale, such as 2, 3, or 4.' },
        moss_dmd: { type: 'boolean', description: 'MOSS main-image DMD acceleration. Default false.' },
        face_detail: { type: 'boolean', description: 'Face redraw for models advertising options.face_detail. Uses model-specific defaults.' },
        face_sampler_name: { type: 'string' },
        face_scheduler: { type: 'string' },
        face_steps: { type: 'number', minimum: 1, maximum: 100 },
        face_cfg: { type: 'number', minimum: 0, maximum: 100 },
        face_denoise: { type: 'number', minimum: 0.0001, maximum: 1 },
        dry_run: { type: 'boolean', description: 'Return assembled workflow preview instead of generating.' },
      },
    },
  },
  {
    name: 'comfy_read_image_prompt',
    description: 'Read a lightweight prompt/model summary from a ComfyUI PNG.',
    inputSchema: {
      type: 'object',
      required: ['image_path'],
      properties: {
        image_path: { type: 'string', description: 'PNG/JPEG/WebP path local to the MCP host. It is uploaded to the authenticated Windows workbench before inspection.' },
      },
    },
  },
  {
    name: 'comfy_read_block_source_preset',
    description: 'Read the workbench generation preset embedded in a preset block source PNG.',
    inputSchema: {
      type: 'object',
      properties: {
        blockId: { type: 'string', description: 'Preset block id whose backend-owned source PNG should be read.' },
        imagePath: { type: 'string', description: 'Optional PNG path local to the MCP host. It is uploaded before reading.' },
        imageUrl: { type: 'string', description: 'Optional workbench-owned /preview-cache PNG resource URL.' },
        sourcePreviewVariantId: { type: 'string', description: 'Optional exact preview variant id to read.' },
        sourcePreviewBaseModel: { type: 'string', enum: ['none', ...loraBaseModelIds], description: 'Optional preview base to prefer.' },
      },
    },
  },
  {
    name: 'comfy_download_block_source_image',
    description:
      'Download a preset block original source image from the authenticated Windows workbench into the MCP host controlled cache. Returns a local absolute path suitable for an image attachment.',
    inputSchema: {
      type: 'object',
      required: ['blockId'],
      properties: {
        blockId: { type: 'string', description: 'Preset block id whose original source image should be downloaded.' },
        variantId: { type: 'string', description: 'Optional exact preview variant id. It must belong to the requested block.' },
        baseModel: {
          type: 'string',
          enum: ['none', ...loraBaseModelIds],
          description: 'Optional preview base-model slot. Explicit selection does not fall back to another base model.',
        },
      },
    },
  },
  {
    name: 'comfy_generate_from_block_preset',
    description:
      'Read a block source PNG workbench preset, add/remove selected blocks, generate through the gateway, then optionally use the output as a block preview/source.',
    inputSchema: {
      type: 'object',
      required: ['sourceBlockId'],
      properties: {
        sourceBlockId: { type: 'string', description: 'Block id whose source PNG stores the base workbench generation preset.' },
        moss_dmd: { type: 'boolean', description: 'Optional MOSS DMD override; omission retains the PNG preset option.' },
        face_detail: { type: 'boolean', description: 'Optional face redraw override; omission retains the PNG preset option. Uses model-specific defaults.' },
        face_sampler_name: { type: 'string' },
        face_scheduler: { type: 'string' },
        face_steps: { type: 'number', minimum: 1, maximum: 100 },
        face_cfg: { type: 'number', minimum: 0, maximum: 100 },
        face_denoise: { type: 'number', minimum: 0.0001, maximum: 1 },
        imagePath: {
          type: 'string',
          description: 'Optional explicit PNG path local to the MCP host. It is uploaded and overrides the block preview variant source.',
        },
        imageUrl: {
          type: 'string',
          description: 'Optional explicit workbench-owned /preview-cache PNG resource URL. It overrides the block preview variant source.',
        },
        addBlockIds: { type: 'array', items: { type: 'string' }, description: 'Block ids to add to the preset selection.' },
        removeBlockIds: { type: 'array', items: { type: 'string' }, description: 'Block ids to remove from the preset selection.' },
        selectedBlockIds: { type: 'array', items: { type: 'string' }, description: 'Optional exact final selected block ids. Overrides add/remove.' },
        targetPreviewBlockId: {
          type: 'string',
          description: 'Block id to receive the generated image as preview/source. Defaults to sourceBlockId. Set savePreview false to skip.',
        },
        sourcePreviewVariantId: { type: 'string', description: 'Optional exact source preview variant id.' },
        sourcePreviewBaseModel: { type: 'string', enum: ['none', ...loraBaseModelIds], description: 'Optional source preview base to prefer.' },
        targetPreviewBaseModel: { type: 'string', enum: ['none', ...loraBaseModelIds], description: 'Base-model slot for the generated target preview.' },
        savePreview: { type: 'boolean', description: 'Whether to write the generated output as target block thumbnail and source. Default true.' },
        dry_run: { type: 'boolean', description: 'Return assembled request without generating.' },
        name: { type: 'string', description: 'Name stored in the output PNG workbench preset metadata.' },
        extraPositive: { type: 'array', items: { type: 'string' }, description: 'Extra positive prompt fragments appended after selected blocks.' },
        extraNegative: { type: 'array', items: { type: 'string' }, description: 'Extra negative prompt fragments appended after selected blocks.' },
        selectedColorPrompts: { type: 'array', items: { type: 'string' }, description: 'Optional color prompt fragments to replace the source preset colors.' },
        model: { type: 'string' },
        preset: { type: 'string' },
        filenamePrefix: { type: 'string' },
        positivePrefix: { type: 'string' },
        negativePrefix: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        steps: { type: 'number' },
        cfg: { type: 'number' },
        seed: { type: 'number' },
        sampler: { type: 'string' },
        scheduler: { type: 'string' },
      },
    },
  },
  {
    name: 'comfy_list_categories',
    description: 'List preset block categories from the shared web UI library.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'comfy_create_category',
    description: 'Create a category in the shared web UI library, for example a new prompt type discovered while importing images.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        id: { type: 'string', description: 'Optional stable category id. Generated from name when omitted.' },
        name: { type: 'string', description: 'Display name.' },
        description: { type: 'string', description: 'Optional short description shown below the category name.' },
        index: { type: 'number', description: 'Optional insertion index.' },
      },
    },
  },
  {
    name: 'comfy_update_category',
    description: 'Update a category name or description, or change a custom category id while migrating existing blocks.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Current category id.' },
        newId: { type: 'string', description: 'Optional new id. Built-in category ids cannot be changed.' },
        name: { type: 'string', description: 'Optional new display name.' },
        description: { type: 'string', description: 'Optional short description shown below the category name. Pass an empty string to clear it.' },
      },
    },
  },
  {
    name: 'comfy_move_category',
    description: 'Move a category to a specific order index.',
    inputSchema: {
      type: 'object',
      required: ['id', 'index'],
      properties: {
        id: { type: 'string', description: 'Category id.' },
        index: { type: 'number', description: 'Zero-based target index.' },
      },
    },
  },
  {
    name: 'comfy_delete_category',
    description: 'Delete a custom category. By default this only deletes empty custom categories.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Category id.' },
        moveBlocksTo: { type: 'string', description: 'Optional category id to receive blocks before deletion.' },
      },
    },
  },
  {
    name: 'comfy_list_preset_blocks',
    description: 'List preset blocks from the shared web UI block library.',
    inputSchema: {
      type: 'object',
      properties: {
        categoryId: { type: 'string', description: 'Optional category id, such as character, outfit, pose, background, style, or negative.' },
        query: { type: 'string', description: 'Case-insensitive filter for block name, tags, notes, prompts, and LoRA names.' },
        limit: { type: 'number', description: 'Maximum blocks to return. Default 80.' },
        includeDisabled: { type: 'boolean', description: 'Include disabled blocks. Default true.' },
      },
    },
  },
  {
    name: 'comfy_create_preset_block',
    description: 'Create a preset block in the shared web UI block library.',
    inputSchema: {
      type: 'object',
      required: ['categoryId', 'name'],
      properties: {
        id: { type: 'string', description: 'Optional stable id. A unique id is generated when omitted.' },
        categoryId: { type: 'string', description: 'Category id, such as character, outfit, pose, background, style, or negative.' },
        name: { type: 'string', description: 'Display name.' },
        enabled: { type: 'boolean', description: 'Whether this block is selectable. Default true.' },
        positive: { type: 'array', items: { type: 'string' }, description: 'Positive prompt fragments.' },
        negative: { type: 'array', items: { type: 'string' }, description: 'Negative prompt fragments.' },
        loras: {
          type: 'array',
          description: 'LoRAs used by this block.',
          items: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              strength_model: { type: 'number' },
              strength_clip: { type: 'number' },
            },
          },
        },
        loraBaseModels: {
          type: 'array',
          items: { type: 'string', enum: loraBaseModelIds },
          description: 'Optional LoRA training base tags. Use illustrious for 光辉/IL, anima for Anima, or krea2 for Krea 2.',
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Search tags.' },
        notes: { type: 'string', description: 'Free-form notes, such as source image path or model.' },
        previewFit: {
          type: 'string',
          enum: ['crop', 'fit', 'background'],
          description: 'How the web card should show the preview image. crop is default, fit shows the full image, background uses the preview as the whole card background.',
        },
        previewImage: { type: 'string', description: 'Optional thumbnail data URL or image URL.' },
        previewImagePath: { type: 'string', description: 'Optional image path local to the MCP host. MCP uploads it; Windows creates and owns the thumbnail.' },
        previewSourceImagePath: { type: 'string', description: 'Optional original image path local to the MCP host. MCP uploads it and never stores this absolute path.' },
        previewSourceImageUrl: { type: 'string', description: 'Optional existing workbench-owned source image resource URL.' },
      },
    },
  },
  {
    name: 'comfy_update_preset_block',
    description: 'Update an existing preset block in the shared web UI block library.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Preset block id to update.' },
        categoryId: { type: 'string' },
        name: { type: 'string' },
        enabled: { type: 'boolean' },
        positive: { type: 'array', items: { type: 'string' } },
        negative: { type: 'array', items: { type: 'string' } },
        loras: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              strength_model: { type: 'number' },
              strength_clip: { type: 'number' },
            },
          },
        },
        loraBaseModels: {
          type: 'array',
          items: { type: 'string', enum: loraBaseModelIds },
          description: 'Optional LoRA training base tags. Use illustrious for 光辉/IL, anima for Anima, or krea2 for Krea 2.',
        },
        tags: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
        previewFit: {
          type: 'string',
          enum: ['crop', 'fit', 'background'],
          description: 'How the web card should show the preview image. crop is default, fit shows the full image, background uses the preview as the whole card background.',
        },
        previewImage: { type: 'string' },
        previewImagePath: { type: 'string', description: 'Optional image path local to the MCP host. MCP uploads it; Windows creates and owns the thumbnail.' },
        previewSourceImagePath: { type: 'string', description: 'Optional original image path local to the MCP host. MCP uploads it and never stores this absolute path.' },
        previewSourceImageUrl: { type: 'string', description: 'Optional existing workbench-owned source image resource URL.' },
      },
    },
  },
  {
    name: 'comfy_delete_preset_block',
    description: 'Delete a preset block from the shared web UI block library.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Preset block id to delete.' },
      },
    },
  },
  {
    name: 'comfy_get_current_selection',
    description: 'Read the current workbench selected blocks and selected color prompts for the authenticated user/key.',
    inputSchema: {
      type: 'object',
      properties: {
        includeBlocks: { type: 'boolean', description: 'Include full selected block objects. Default true.' },
      },
    },
  },
  {
    name: 'comfy_get_current_workbench',
    description: 'Read the complete current web workbench snapshot: selected blocks/colors, base prompt fields, model, size, sampling, seed, filename, upscale chain, and the exact composed request. Use this before acting on a user request.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'comfy_generate_current_workbench',
    description: 'Press the authenticated user workbench Generate button semantically. Accepts no generation parameters: the Windows backend atomically snapshots the current web UI state, queues it, generates, embeds preset metadata, and records history.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'comfy_update_current_selection',
    description: 'Set, add, remove, clear, or reorder currently selected workbench blocks through the same operation path as the web UI.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['set', 'add', 'remove', 'clear', 'move'] },
        selectedBlockIds: { type: 'array', items: { type: 'string' }, description: 'Used by action=set.' },
        blockIds: { type: 'array', items: { type: 'string' }, description: 'Used by action=add/remove.' },
        blockId: { type: 'string', description: 'Single block id for action=add/remove.' },
        fromBlockId: { type: 'string', description: 'Dragged block id for action=move.' },
        toBlockId: { type: 'string', description: 'Target selected block id for action=move.' },
        selectedColorPrompts: { type: 'array', items: { type: 'string' }, description: 'Optional exact color prompts when action=set.' },
      },
    },
  },
  {
    name: 'comfy_update_custom_prompt',
    description: 'Replace the visible workbench custom positive prompt. The backend appends it after selected color prompts and preset blocks. Pass an empty string to clear it.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', maxLength: 32768, description: 'Exact custom positive prompt text. Empty clears the field.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'comfy_get_generation_status',
    description: 'Read shared workbench generation status, including whether another user is generating and queued count.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'comfy_list_recent_generations',
    description: 'List recent generated outputs recorded by the workbench backend.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum items to return. Default 30.' },
      },
    },
  },
  {
    name: 'comfy_list_operation_log',
    description: 'List recent backend operation log entries with actor names for auditing.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum operations to return. Default 100.' },
        since: { type: 'string', description: 'Optional ISO timestamp lower bound.' },
      },
    },
  },
  {
    name: 'comfy_create_access_key',
    description: 'Owner-only: create a new local workbench access key. Returns the key once.',
    inputSchema: {
      type: 'object',
      required: ['userName'],
      properties: {
        userName: { type: 'string' },
        keyName: { type: 'string' },
        bindToOwnerWorkspace: { type: 'boolean', description: 'Owner only. Bind this key to the owner web UI state while retaining the new user identity for audit logs.' },
      },
    },
  },
  {
    name: 'comfy_list_access_keys',
    description: 'Owner-only: list workbench users and access-key metadata without secrets.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'comfy_revoke_access_key',
    description: 'Owner-only: revoke a workbench access key by id.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', description: 'Access key id returned by comfy_list_access_keys.' } },
    },
  },
  {
    name: 'comfy_bind_access_key_to_my_workbench',
    description: 'Owner-only: bind an existing access key to the owner current web UI state. The key keeps its own actor identity and role.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', description: 'Access key id returned by comfy_list_access_keys.' } },
      additionalProperties: false,
    },
  },
]

const send = (payload) => {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

const jsonText = (value) => ({
  content: [
    {
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ],
})

const requestJson = async (path, options = {}) => {
  return requestWorkbenchJson(`/gateway${path}`, options)
}

let workbenchCookie = ''

const readWorkbenchAccessKey = async () => {
  const envKey = String(process.env.COMFY_PRESET_ACCESS_KEY || '').trim()
  if (envKey) return envKey
  if (!existsSync(accessKeysFile)) return ''
  const text = await readFile(accessKeysFile, 'utf8')
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith('#'))
  return line?.split(/\s+/).at(-1) || ''
}

const workbenchFetchJson = async (pathName, options = {}) => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ...(workbenchCookie ? { Cookie: workbenchCookie } : {}),
    ...(options.headers || {}),
  }
  const response = await fetch(`${workbenchUrl}${pathName}`, { ...options, headers })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie) workbenchCookie = setCookie.split(',').map((item) => item.split(';')[0]).join('; ')
  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  if (!response.ok) {
    const message = data?.error || data?.detail || text || `${response.status} ${response.statusText}`
    throw new Error(message)
  }
  return data
}

const ensureWorkbenchAuth = async () => {
  try {
    const status = await workbenchFetchJson('/share-auth/status')
    if (status.authenticated) return status
  } catch {
    // Try unlock below so callers get the actionable error from the login path.
  }
  const key = await readWorkbenchAccessKey()
  if (!key) throw new Error(`Workbench access key not found. Set COMFY_PRESET_ACCESS_KEY or create ${accessKeysFile}.`)
  await workbenchFetchJson('/share-auth/unlock', { method: 'POST', body: JSON.stringify({ key }) })
  return workbenchFetchJson('/share-auth/status')
}

const requestWorkbenchJson = async (pathName, options = {}) => {
  await ensureWorkbenchAuth()
  return workbenchFetchJson(pathName, options)
}

const decodeResponseHeader = (response, name) => {
  const value = response.headers.get(name) || ''
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error(`Workbench returned an invalid ${name} header`)
  }
}

const requestWorkbenchSourceImage = async ({ blockId, variantId = '', baseModel = '' }) => {
  await ensureWorkbenchAuth()
  const query = new URLSearchParams({ blockId })
  if (variantId) query.set('variantId', variantId)
  if (baseModel) query.set('baseModel', baseModel)
  const response = await fetch(`${workbenchUrl}/workbench/blocks/source-image?${query}`, {
    headers: { ...(workbenchCookie ? { Cookie: workbenchCookie } : {}), Accept: 'image/png,image/jpeg,image/webp' },
  })
  if (!response.ok) {
    const text = await response.text()
    let message = text || `${response.status} ${response.statusText}`
    try {
      message = JSON.parse(text)?.error || message
    } catch {}
    throw new Error(message)
  }

  const contentType = String(response.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) throw new Error('Workbench returned an unsupported image Content-Type')
  const contentLength = Number(response.headers.get('content-length'))
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) throw new Error('Workbench did not return a valid image Content-Length')
  if (contentLength > sourceDownloadMaxBytes) throw new Error('Source image exceeds the 64 MiB download limit')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length !== contentLength) throw new Error('Downloaded image length does not match Content-Length')
  const detectedMimeType = imageMimeFromBuffer(buffer)
  if (detectedMimeType !== contentType) throw new Error('Downloaded image magic bytes do not match Content-Type')
  return {
    buffer,
    mimeType: detectedMimeType,
    blockId: decodeResponseHeader(response, 'x-comfy-block-id'),
    blockName: decodeResponseHeader(response, 'x-comfy-block-name'),
    variantId: decodeResponseHeader(response, 'x-comfy-preview-variant-id'),
    baseModel: decodeResponseHeader(response, 'x-comfy-preview-base-model') || 'none',
    sourceResourceUrl: decodeResponseHeader(response, 'x-comfy-source-resource-url'),
  }
}

const collectStrings = (value) => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectStrings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings)
  return []
}

const asStringArray = (value) => {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item || '').trim()).filter(Boolean)
}

const makeCategoryId = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)

const imageMimeFromBuffer = (buffer) => {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  throw new Error('Only PNG, JPEG, and WebP images are supported')
}

const sourceExtensionForMime = (mimeType) => {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  throw new Error('Unsupported source image type')
}

const ensureSourceDownloadCache = async () => {
  await mkdir(sourceDownloadCacheDir, { recursive: true, mode: 0o700 })
  await chmod(sourceDownloadCacheDir, 0o700).catch(() => {})
}

const cleanupSourceDownloadCache = async () => {
  await ensureSourceDownloadCache()
  const now = Date.now()
  const entries = []
  for (const entry of await readdir(sourceDownloadCacheDir, { withFileTypes: true })) {
    const filePath = path.join(sourceDownloadCacheDir, entry.name)
    if (!entry.isFile()) continue
    let fileStat
    try {
      fileStat = await stat(filePath)
    } catch {
      continue
    }
    if (entry.name.startsWith('.download-')) {
      if (now - fileStat.mtimeMs > 10 * 60 * 1000) await rm(filePath, { force: true }).catch(() => {})
      continue
    }
    if (now - fileStat.mtimeMs > sourceDownloadTtlMs) {
      await rm(filePath, { force: true }).catch(() => {})
      continue
    }
    entries.push({ filePath, mtimeMs: fileStat.mtimeMs })
  }
  entries.sort((left, right) => right.mtimeMs - left.mtimeMs)
  await Promise.all(entries.slice(sourceDownloadMaxFiles).map((entry) => rm(entry.filePath, { force: true }).catch(() => {})))
}

const writeSourceImageToCache = async (buffer, mimeType) => {
  await cleanupSourceDownloadCache()
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
  const extension = sourceExtensionForMime(mimeType)
  let destination = path.join(sourceDownloadCacheDir, `source-${sha256}.${extension}`)
  if (existsSync(destination)) {
    const existing = await readFile(destination)
    if (crypto.createHash('sha256').update(existing).digest('hex') === sha256) {
      const now = new Date()
      await utimes(destination, now, now).catch(() => {})
      await chmod(destination, 0o600).catch(() => {})
      return { absolutePath: destination, sha256 }
    }
    destination = path.join(sourceDownloadCacheDir, `source-${sha256}-${crypto.randomUUID()}.${extension}`)
  }

  const temporaryPath = path.join(sourceDownloadCacheDir, `.download-${crypto.randomUUID()}.tmp`)
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(buffer)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporaryPath, destination)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
  await chmod(destination, 0o600).catch(() => {})
  await cleanupSourceDownloadCache()
  return { absolutePath: destination, sha256 }
}

const downloadBlockSourceImage = async (args = {}) => {
  const blockId = String(args.blockId || '').trim()
  if (!blockId) throw new Error('blockId is required')
  const variantId = String(args.variantId || '').trim()
  const baseModel = String(args.baseModel || '').trim()
  if (baseModel && !['none', ...loraBaseModelIds].includes(baseModel)) throw new Error(`Unsupported preview base model: ${baseModel}`)
  const source = await requestWorkbenchSourceImage({ blockId, variantId, baseModel })
  if (source.blockId !== blockId) throw new Error('Workbench returned a source image for a different block')
  const cached = await writeSourceImageToCache(source.buffer, source.mimeType)
  return {
    ok: true,
    blockId: source.blockId,
    blockName: source.blockName,
    variantId: source.variantId || undefined,
    baseModel: source.baseModel,
    absolutePath: cached.absolutePath,
    mimeType: source.mimeType,
    filename: path.basename(cached.absolutePath),
    bytes: source.buffer.length,
    sha256: cached.sha256,
    sourceResourceUrl: source.sourceResourceUrl,
    cache: {
      ttlMs: sourceDownloadTtlMs,
      maxFiles: sourceDownloadMaxFiles,
    },
  }
}

const uploadImageDataUrl = async (dataUrl, fileName = 'uploaded-image') => {
  const response = await requestWorkbenchJson('/workbench/resources/upload', {
    method: 'POST',
    body: JSON.stringify({ dataUrl, fileName }),
  })
  if (!response?.resource?.sourceImageUrl || !response?.resource?.previewImage) throw new Error('Workbench did not return an image resource')
  return response.resource
}

const uploadLocalImage = async (imagePath) => {
  const resolvedPath = path.resolve(String(imagePath || '').trim())
  if (!resolvedPath || !existsSync(resolvedPath)) throw new Error(`Preview image not found: ${imagePath}`)
  const fileStat = await stat(resolvedPath)
  if (!fileStat.isFile()) throw new Error(`Preview image is not a file: ${imagePath}`)
  if (fileStat.size > 32 * 1024 * 1024) throw new Error('Image is too large (maximum 32 MiB)')
  const buffer = await readFile(resolvedPath)
  const mimeType = imageMimeFromBuffer(buffer)
  return uploadImageDataUrl(`data:${mimeType};base64,${buffer.toString('base64')}`, path.basename(resolvedPath))
}

const normalizePreviewFields = async (args, existing = {}) => {
  const previewImagePath = String(args.previewImagePath || '').trim()
  const previewSourceImagePath = String(args.previewSourceImagePath || '').trim()
  let previewResource
  let sourceResource
  if (previewImagePath) previewResource = await uploadLocalImage(previewImagePath)
  if (previewSourceImagePath) {
    if (!existsSync(path.resolve(previewSourceImagePath))) {
      throw new Error('previewSourceImagePath must exist on the MCP host so it can be uploaded to the workbench')
    }
    sourceResource = previewImagePath && path.resolve(previewImagePath) === path.resolve(previewSourceImagePath) ? previewResource : await uploadLocalImage(previewSourceImagePath)
  }

  let previewImage = previewResource?.previewImage
  if (!previewImage && args.previewImage === undefined) previewImage = existing.previewImage
  if (!previewImage && args.previewImage !== undefined) {
    const value = String(args.previewImage || '').trim()
    if (!value) previewImage = ''
    else if (existsSync(value)) {
      previewResource = await uploadLocalImage(value)
      previewImage = previewResource.previewImage
    } else if (value.startsWith('data:')) {
      previewResource = await uploadImageDataUrl(value, 'preview-image')
      previewImage = previewResource.previewImage
    } else {
      previewImage = value
    }
  }

  const resource = sourceResource || previewResource
  return {
    previewImage,
    previewSourceImagePath: resource ? '' : args.previewSourceImagePath === undefined ? existing.previewSourceImagePath : '',
    previewSourceImageUrl:
      sourceResource?.sourceImageUrl ||
      previewResource?.sourceImageUrl ||
      (args.previewSourceImageUrl === undefined ? existing.previewSourceImageUrl : String(args.previewSourceImageUrl || '').trim()),
    inferredPreviewFit: previewResource?.previewFit === 'background' ? 'background' : undefined,
    resource,
  }
}

const uploadToolImage = async (imagePath) => {
  if (!String(imagePath || '').trim()) throw new Error('image_path is required')
  return uploadLocalImage(imagePath)
}

const readWorkbenchPresetFromReference = async ({ imagePath, imageUrl }) => {
  const payload = imageUrl ? { imageUrl } : { imagePath }
  const result = await requestWorkbenchJson('/png-preset/read', { method: 'POST', body: JSON.stringify(payload) })
  if (!result.hasPreset || !result.metadata) throw new Error('PNG does not contain a workbench preset')
  return result
}

const normalizeLoras = (value) => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const name = String(item.name || '').trim()
      if (!name) return null
      return {
        name,
        strength_model: Number.isFinite(Number(item.strength_model)) ? Number(item.strength_model) : 1,
        strength_clip: Number.isFinite(Number(item.strength_clip)) ? Number(item.strength_clip) : 1,
      }
    })
    .filter(Boolean)
}

const normalizeLoraBaseModels = (value, existing) => {
  if (value === undefined) return Array.isArray(existing) ? existing.filter((item) => loraBaseModelIds.includes(item)) : undefined
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter((item) => loraBaseModelIds.includes(item)))]
}

const normalizeBaseModelProfile = (value = {}, fallback = {}) => {
  const source = value && typeof value === 'object' ? value : {}
  const base = { ...fallback }
  for (const key of ['positivePrefix', 'negativePrefix', 'preset', 'sampler', 'scheduler']) {
    if (source[key] !== undefined) base[key] = String(source[key] || '').trim()
  }
  if (source.steps !== undefined) {
    const steps = Number(source.steps)
    if (!Number.isFinite(steps) || steps <= 0) throw new Error('steps must be a positive number')
    base.steps = steps
  }
  if (source.cfg !== undefined) {
    const cfg = Number(source.cfg)
    if (!Number.isFinite(cfg) || cfg < 0) throw new Error('cfg must be a non-negative number')
    base.cfg = cfg
  }
  for (const key of ['width', 'height']) {
    if (source[key] === undefined) continue
    const dimension = Number(source[key])
    if (!Number.isFinite(dimension) || dimension < 64 || dimension > 16384) throw new Error(`${key} must be between 64 and 16384`)
    base[key] = Math.round(dimension / 8) * 8
  }
  if (source.upscaleSteps !== undefined) {
    if (!Array.isArray(source.upscaleSteps)) throw new Error('upscaleSteps must be an array')
    base.upscaleSteps = source.upscaleSteps.slice(0, 8).map((step, index) => {
      const item = step && typeof step === 'object' ? step : {}
      const scale = Number(item.scale)
      const steps = Number(item.steps)
      const cfg = Number(item.cfg)
      const denoise = Number(item.denoise)
      if (!Number.isFinite(scale) || scale <= 0) throw new Error(`upscaleSteps[${index}].scale must be positive`)
      if (!Number.isFinite(steps) || steps <= 0) throw new Error(`upscaleSteps[${index}].steps must be positive`)
      if (!Number.isFinite(cfg) || cfg < 0) throw new Error(`upscaleSteps[${index}].cfg must be non-negative`)
      if (!Number.isFinite(denoise) || denoise < 0 || denoise > 1) throw new Error(`upscaleSteps[${index}].denoise must be between 0 and 1`)
      return {
        id: String(item.id || `upscale_${index + 1}`).slice(0, 80),
        enabled: item.enabled !== false,
        scale,
        steps,
        cfg,
        denoise,
        sampler: String(item.sampler || base.sampler || 'euler').slice(0, 80),
        scheduler: String(item.scheduler || base.scheduler || 'simple').slice(0, 80),
      }
    })
  }
  return base
}

const normalizeBaseModelProfiles = (profiles = {}) => {
  const source = profiles && typeof profiles === 'object' ? profiles : {}
  return Object.fromEntries(
    baseModelIds.map((base) => [base, normalizeBaseModelProfile(source[base], defaultBaseModelProfiles[base])]),
  )
}

const validateBaseModelId = (base) => {
  const id = String(base || '').trim()
  if (!baseModelIds.includes(id)) throw new Error(`Unknown base model profile: ${id || '(empty)'}`)
  return id
}

const normalizeCategories = (categories) => {
  const source = Array.isArray(categories) ? categories : []
  const byId = new Map(defaultCategories.map((category) => [category.id, category]))
  for (const category of source) {
    if (category?.id && category?.name) byId.set(String(category.id), { ...category, id: String(category.id), name: String(category.name) })
  }
  return [...byId.values()]
}

const normalizeState = (state = {}) => ({
  categories: normalizeCategories(state.categories),
  blocks: Array.isArray(state.blocks) ? state.blocks : [],
  baseModelProfiles: normalizeBaseModelProfiles(state.baseModelProfiles),
  generationPresets: Array.isArray(state.generationPresets) ? state.generationPresets : [],
  updatedAt: state.updatedAt || new Date().toISOString(),
  revision: Number(state.revision || 0),
  baseModelProfilesRevision: Number(state.baseModelProfilesRevision || 0),
})

const readSharedState = async () => {
  return normalizeState(await requestWorkbenchJson('/share-state/content'))
}

const runWorkbenchOperation = async (type, payload = {}) =>
  requestWorkbenchJson('/workbench/operation', { method: 'POST', body: JSON.stringify({ type, payload }) })

const createBlockId = (state, categoryId, name) => {
  const slug = `${categoryId}_${name}`
    .toLowerCase()
    .replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || `${categoryId}_block`
  const used = new Set(state.blocks.map((block) => block.id))
  let id = slug
  let index = 2
  while (used.has(id)) {
    id = `${slug}_${index}`
    index += 1
  }
  return id
}

const validateCategory = (state, categoryId) => {
  const id = String(categoryId || '').trim()
  if (!id) throw new Error('categoryId is required')
  if (!state.categories.some((category) => category.id === id)) {
    throw new Error(`Unknown categoryId: ${id}`)
  }
  return id
}

const createCategoryId = (state, value) => {
  const base = makeCategoryId(value) || 'category'
  const used = new Set(state.categories.map((category) => category.id))
  let id = base
  let index = 2
  while (used.has(id)) {
    id = `${base}_${index}`
    index += 1
  }
  return id
}

const normalizeBlockPayload = async (state, args, existing = {}) => {
  const categoryId = args.categoryId === undefined ? existing.categoryId : validateCategory(state, args.categoryId)
  const name = args.name === undefined ? existing.name : String(args.name || '').trim()
  if (!name) throw new Error('name is required')
  const previewFields = await normalizePreviewFields(args, existing)
  const previewFit =
    args.previewFit === undefined
      ? previewFields.inferredPreviewFit || existing.previewFit
      : ['fit', 'background'].includes(args.previewFit)
        ? args.previewFit
        : undefined
  return {
    id: existing.id || String(args.id || '').trim() || createBlockId(state, categoryId, name),
    categoryId,
    name,
    enabled: args.enabled === undefined ? (existing.enabled ?? true) : Boolean(args.enabled),
    positive: args.positive === undefined ? (Array.isArray(existing.positive) ? existing.positive : []) : asStringArray(args.positive),
    negative: args.negative === undefined ? (Array.isArray(existing.negative) ? existing.negative : []) : asStringArray(args.negative),
    loras: args.loras === undefined ? (Array.isArray(existing.loras) ? existing.loras : []) : normalizeLoras(args.loras),
    loraBaseModels: normalizeLoraBaseModels(args.loraBaseModels, existing.loraBaseModels),
    tags: args.tags === undefined ? (Array.isArray(existing.tags) ? existing.tags : []) : asStringArray(args.tags),
    notes: args.notes === undefined ? existing.notes : String(args.notes || '').trim(),
    previewFit,
    previewImage: previewFields.previewImage,
    previewSourceImagePath: previewFields.previewSourceImagePath,
    previewSourceImageUrl: previewFields.previewSourceImageUrl,
    previewVariants: Array.isArray(existing.previewVariants) ? existing.previewVariants : undefined,
    activePreviewVariantIds: existing.activePreviewVariantIds && typeof existing.activePreviewVariantIds === 'object' ? existing.activePreviewVariantIds : undefined,
    revision: existing.revision,
  }
}

const compactBlock = (block) => {
  const result = { ...block }
  if (!result.notes) delete result.notes
  if (!result.previewFit || result.previewFit === 'crop') delete result.previewFit
  if (!result.previewImage) delete result.previewImage
  if (!result.previewSourceImagePath) delete result.previewSourceImagePath
  if (!result.previewSourceImageUrl) delete result.previewSourceImageUrl
  return result
}

const joinPrompt = (parts) => parts.filter(Boolean).join(', ')
const isKrea2Model = (value) => /krea[ _-]?2|dasiwa_k2/i.test(String(value || ''))

const promptPrefixForGateway = (value, hasPrompt) => {
  const prefix = String(value || '').trim()
  if (!prefix || !hasPrompt) return prefix
  return /[,，]\s*$/.test(prefix) ? `${prefix} ` : `${prefix}, `
}

const formatDatePart = (date, format) =>
  format
    .replaceAll('yyyy', String(date.getFullYear()))
    .replaceAll('MM', String(date.getMonth() + 1).padStart(2, '0'))
    .replaceAll('dd', String(date.getDate()).padStart(2, '0'))
    .replaceAll('hh', String(date.getHours()).padStart(2, '0'))
    .replaceAll('mm', String(date.getMinutes()).padStart(2, '0'))
    .replaceAll('ss', String(date.getSeconds()).padStart(2, '0'))

const applyFilenameTemplate = (template, characterName) => {
  const now = new Date()
  const safeCharacter = String(characterName || '未指定角色')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\p{Cc}/gu, '_')
    .slice(0, 80)
  return String(template || defaultFilenamePrefix)
    .replaceAll('%character%', safeCharacter)
    .replace(/%date:([^%]+)%/g, (_, format) => formatDatePart(now, format))
}

const composeWorkbenchRequest = (state, sourcePreset, args = {}) => {
  const blockById = new Map(state.blocks.map((block) => [block.id, block]))
  const addIds = asStringArray(args.addBlockIds)
  const removeIds = new Set(asStringArray(args.removeBlockIds))
  const baseIds = Array.isArray(args.selectedBlockIds) ? asStringArray(args.selectedBlockIds) : asStringArray(sourcePreset.selectedBlockIds)
  const selectedBlockIds = Array.isArray(args.selectedBlockIds) ? baseIds : [...new Set([...baseIds.filter((id) => !removeIds.has(id)), ...addIds])]
  const selectedBlocks = selectedBlockIds.map((id) => blockById.get(id)).filter(Boolean)
  const selectedColorPrompts = args.selectedColorPrompts === undefined ? asStringArray(sourcePreset.selectedColorPrompts) : asStringArray(args.selectedColorPrompts)
  const positivePrefix = args.positivePrefix === undefined ? sourcePreset.positivePrefix : String(args.positivePrefix || '')
  const negativePrefix = args.negativePrefix === undefined ? sourcePreset.negativePrefix : String(args.negativePrefix || '')
  const customPositivePrompt = String(sourcePreset.customPositivePrompt || '')
  const promptParts = [
    ...selectedColorPrompts,
    ...selectedBlocks.flatMap((block) => asStringArray(block.positive)),
    customPositivePrompt.trim(),
    ...asStringArray(args.extraPositive),
  ]
  const negativeParts = [negativePrefix, ...selectedBlocks.flatMap((block) => asStringArray(block.negative)), ...asStringArray(args.extraNegative)]
  const prompt = joinPrompt(promptParts)
  const characterName = selectedBlocks.filter((block) => block.categoryId === 'character').map((block) => block.name).join('+') || '未指定角色'
  const generationPreset = normalizeMossGeneration({
    ...sourcePreset,
    id: `mcp_png_${Date.now().toString(36)}`,
    name: String(args.name || sourcePreset.name || `${characterName} ${sourcePreset.width}x${sourcePreset.height}`),
    createdAt: new Date().toISOString(),
    selectedBlockIds,
    selectedColorPrompts,
    customPositivePrompt,
    gatewayUrl: sourcePreset.gatewayUrl || '/gateway',
    positivePrefix,
    negativePrefix,
    model: args.model === undefined ? sourcePreset.model : String(args.model || ''),
    preset: args.preset === undefined ? sourcePreset.preset : String(args.preset || ''),
    filenamePrefix: args.filenamePrefix === undefined ? sourcePreset.filenamePrefix || defaultFilenamePrefix : String(args.filenamePrefix || ''),
    width: args.width === undefined ? sourcePreset.width : Number(args.width),
    height: args.height === undefined ? sourcePreset.height : Number(args.height),
    steps: args.steps === undefined ? sourcePreset.steps : Number(args.steps),
    cfg: args.cfg === undefined ? sourcePreset.cfg : Number(args.cfg),
    seed: args.seed === undefined ? sourcePreset.seed || '' : String(args.seed),
    sampler: args.sampler === undefined ? sourcePreset.sampler : String(args.sampler || ''),
    scheduler: args.scheduler === undefined ? sourcePreset.scheduler : String(args.scheduler || ''),
    upscaleSteps: Array.isArray(sourcePreset.upscaleSteps) ? sourcePreset.upscaleSteps.map((step) => ({ ...step })) : [],
  })
  if (args.moss_dmd !== undefined) generationPreset.mossOptions.dmd = args.moss_dmd
  if (args.face_detail !== undefined) {
    generationPreset.faceDetail = args.face_detail
    generationPreset.mossOptions.faceRedraw = args.face_detail
  }
  const body = {
    prompt,
    prefix: promptPrefixForGateway(positivePrefix, Boolean(prompt)),
    negative: joinPrompt(negativeParts),
    preset: generationPreset.preset || 'anime_manga_fast',
    model: generationPreset.model || 'gembyte_emerald',
    filename_prefix: applyFilenameTemplate(generationPreset.filenamePrefix || defaultFilenamePrefix, characterName),
    width: generationPreset.width || 768,
    height: generationPreset.height || 1024,
    steps: generationPreset.steps,
    cfg: generationPreset.cfg,
    sampler_name: generationPreset.sampler,
    scheduler: generationPreset.scheduler,
    loras: selectedBlocks.flatMap((block) => (Array.isArray(block.loras) ? block.loras : [])),
  }
  if (String(generationPreset.seed || '').trim()) {
    body.seed = Number(generationPreset.seed)
    if (isKrea2Model(generationPreset.model)) body.second_seed = body.seed
  }
  const enabledUpscales = isMossModel(generationPreset.model) ? [] : generationPreset.upscaleSteps.filter((step) => step?.enabled)
  body.face_detail = generationPreset.faceDetail === true
  generationPreset.faceParameters = { ...generationPreset.faceParameters }
  for (const key of ['steps', 'cfg', 'denoise', 'scheduler']) if (args[`face_${key}`] !== undefined) generationPreset.faceParameters[key] = args[`face_${key}`]
  if (args.face_sampler_name !== undefined) generationPreset.faceParameters.sampler = args.face_sampler_name
  generationPreset.faceParameters = resolveFaceParameters(generationPreset.model, state.baseModelProfiles, generationPreset.faceParameters)
  Object.assign(body, faceParametersBody(generationPreset.faceDetail, generationPreset.faceParameters))
  if (isMossModel(generationPreset.model)) Object.assign(body, mossUpscaleBody(generationPreset.mossUpscale), mossOptionsBody(generationPreset))
  if (isKrea2Model(generationPreset.model) && enabledUpscales.length === 0) throw new Error('K2 requires one latent hires upscale stage')
  if (isKrea2Model(generationPreset.model) && enabledUpscales.length > 2) throw new Error('K2 supports at most latent hires and USD upscale stages')
  if (enabledUpscales.length >= 1) {
    body.second_steps = enabledUpscales[0].steps
    body.second_cfg = enabledUpscales[0].cfg
    body.second_denoise = enabledUpscales[0].denoise
    body.second_sampler_name = enabledUpscales[0].sampler || generationPreset.sampler
    body.second_scheduler = enabledUpscales[0].scheduler || generationPreset.scheduler
  }
  if (enabledUpscales.length === 1) {
    body.upscale_scale = enabledUpscales[0].scale
    if (isKrea2Model(generationPreset.model)) {
      body.upscale_mode = 'krea2_hires'
      body.upscale_stages = 1
    }
  }
  if (enabledUpscales.length > 1) {
    body.upscale_mode = 'two_stage'
    if (isKrea2Model(generationPreset.model)) {
      body.upscale_stages = 2
      body.upscale_scale = enabledUpscales[0].scale
      body.second_stage_upscale_model = 'OmniSR_X4_DIV2K.safetensors'
      if (body.seed !== undefined) body.third_seed = Number(body.seed) + 1
    } else {
      body.stage_upscale_scale = enabledUpscales[0].scale
    }
    body.second_stage_upscale_scale = enabledUpscales[1].scale
    body.third_steps = enabledUpscales[1].steps
    body.third_cfg = enabledUpscales[1].cfg
    body.third_denoise = enabledUpscales[1].denoise
    body.third_sampler_name = enabledUpscales[1].sampler || generationPreset.sampler
    body.third_scheduler = enabledUpscales[1].scheduler || generationPreset.scheduler
  }
  Object.keys(body).forEach((key) => body[key] === undefined || body[key] === '' ? delete body[key] : undefined)
  const composed = {
    positive: joinPrompt([positivePrefix, prompt]),
    negative: body.negative,
    loras: body.loras,
  }
  const metadata = {
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
    requestBody: body,
  }
  return { selectedBlockIds, selectedBlocks, generationPreset, body, composed, metadata }
}

const findBlockSourcePreset = async (state, args = {}) => {
  const blockId = String(args.blockId || args.sourceBlockId || '').trim()
  const block = blockId ? state.blocks.find((item) => item.id === blockId) : undefined
  if (blockId && !block) throw new Error(`Preset block not found: ${blockId}`)
  const variants = Array.isArray(block?.previewVariants) ? block.previewVariants.filter((item) => item?.sourceImageUrl || item?.sourceImagePath) : []
  const requestedVariantId = String(args.sourcePreviewVariantId || '').trim()
  const requestedBase = String(args.sourcePreviewBaseModel || '').trim()
  const candidates = requestedBase ? variants.filter((item) => item.baseModel === requestedBase) : variants
  const activeId = requestedBase ? block?.activePreviewVariantIds?.[requestedBase] : ''
  const sourceVariant =
    variants.find((item) => item.id === requestedVariantId) ||
    candidates.find((item) => item.id === activeId) ||
    candidates[0] ||
    variants.find((item) => item.baseModel === 'none') ||
    variants[0]
  let imagePath = String(args.imagePath || '').trim()
  let imageUrl = String(args.imageUrl || sourceVariant?.sourceImageUrl || block?.previewSourceImageUrl || '').trim()
  if (imagePath && existsSync(path.resolve(imagePath))) {
    const resource = await uploadToolImage(imagePath)
    imagePath = ''
    imageUrl = resource.sourceImageUrl
  } else if (!imagePath) {
    imagePath = String(sourceVariant?.sourceImagePath || block?.previewSourceImagePath || '').trim()
  }
  if (!imagePath && !imageUrl) throw new Error('No source PNG resource is stored on the block')
  const result = await readWorkbenchPresetFromReference({ imagePath, imageUrl })
  return { block, sourceVariant, imagePath: result.imagePath || imagePath, imageUrl, metadata: result.metadata }
}

const callTool = async (name, args = {}) => {
  if (name === 'comfy_gateway_health') {
    return jsonText(await requestJson('/health'))
  }
  if (name === 'comfy_list_models') {
    return jsonText(await requestJson('/models'))
  }
  if (name === 'comfy_list_loras') {
    const query = String(args.query || '').trim().toLowerCase()
    const limit = Number.isFinite(Number(args.limit)) ? Math.max(1, Math.min(500, Number(args.limit))) : 80
    const params = new URLSearchParams({ limit: String(limit) })
    if (query) params.set('query', query)
    const payload = await requestJson(`/loras?${params.toString()}`)
    const source = payload?.loras ?? payload?.items ?? payload
    const loras = [...new Set(collectStrings(source))]
      .filter((item) => !query || item.toLowerCase().includes(query))
      .sort((left, right) => left.localeCompare(right))
      .slice(0, limit)
    return jsonText({
      ok: payload?.ok !== false,
      query,
      total: Number.isFinite(Number(payload?.total)) ? Number(payload.total) : undefined,
      filtered: Number.isFinite(Number(payload?.filtered)) ? Number(payload.filtered) : undefined,
      total_returned: loras.length,
      loras,
    })
  }
  if (name === 'comfy_get_current_selection') {
    const [state, uiState] = await Promise.all([readSharedState(), requestWorkbenchJson('/workbench/ui-state')])
    const selectedBlockIds = asStringArray(uiState.selectedBlockIds)
    const selectedBlocks = selectedBlockIds.map((id) => state.blocks.find((block) => block.id === id)).filter(Boolean)
    return jsonText({
      ok: true,
      selectedBlockIds,
      selectedColorPrompts: asStringArray(uiState.selectedColorPrompts),
      count: selectedBlockIds.length,
      blocks: args.includeBlocks === false ? undefined : selectedBlocks,
    })
  }
  if (name === 'comfy_get_current_workbench') {
    return jsonText(await requestWorkbenchJson('/workbench/current'))
  }
  if (name === 'comfy_generate_current_workbench') {
    if (Object.keys(args || {}).length > 0) throw new Error('comfy_generate_current_workbench does not accept generation parameters')
    return jsonText(
      await requestWorkbenchJson('/workbench/generate-current', {
        method: 'POST',
        body: '{}',
      }),
    )
  }
  if (name === 'comfy_update_current_selection') {
    const action = String(args.action || '').trim()
    const operationByAction = {
      set: 'selection.set',
      add: 'selection.add',
      remove: 'selection.remove',
      clear: 'selection.clear',
      move: 'selection.move',
    }
    const type = operationByAction[action]
    if (!type) throw new Error(`Unknown selection action: ${action}`)
    const payload = {
      selectedBlockIds: asStringArray(args.selectedBlockIds),
      selectedColorPrompts: asStringArray(args.selectedColorPrompts),
      blockIds: asStringArray(args.blockIds),
      blockId: args.blockId,
      fromBlockId: args.fromBlockId,
      toBlockId: args.toBlockId,
    }
    const result = await requestWorkbenchJson('/workbench/operation', { method: 'POST', body: JSON.stringify({ type, payload }) })
    return jsonText(result)
  }
  if (name === 'comfy_update_custom_prompt') {
    const prompt = String(args.prompt ?? '').slice(0, 32768)
    return jsonText(
      await requestWorkbenchJson('/workbench/operation', {
        method: 'POST',
        body: JSON.stringify({ type: 'ui.custom_prompt.set', payload: { prompt } }),
      }),
    )
  }
  if (name === 'comfy_get_generation_status') {
    return jsonText(await requestWorkbenchJson('/share-state/generation'))
  }
  if (name === 'comfy_list_recent_generations') {
    const limit = Number.isFinite(Number(args.limit)) ? Math.max(1, Math.min(200, Number(args.limit))) : 30
    return jsonText(await requestWorkbenchJson(`/workbench/history?limit=${encodeURIComponent(String(limit))}`))
  }
  if (name === 'comfy_list_operation_log') {
    const limit = Number.isFinite(Number(args.limit)) ? Math.max(1, Math.min(500, Number(args.limit))) : 100
    const since = String(args.since || '').trim()
    const suffix = since ? `&since=${encodeURIComponent(since)}` : ''
    return jsonText(await requestWorkbenchJson(`/workbench/operations?limit=${encodeURIComponent(String(limit))}${suffix}`))
  }
  if (name === 'comfy_create_access_key') {
    return jsonText(
      await requestWorkbenchJson('/workbench/access-keys', {
        method: 'POST',
        body: JSON.stringify({
          userName: args.userName,
          keyName: args.keyName || 'agent',
          bindToOwnerWorkspace: Boolean(args.bindToOwnerWorkspace),
        }),
      }),
    )
  }
  if (name === 'comfy_list_access_keys') {
    return jsonText(await requestWorkbenchJson('/workbench/access-keys'))
  }
  if (name === 'comfy_revoke_access_key') {
    return jsonText(
      await requestWorkbenchJson('/workbench/access-keys/revoke', {
        method: 'POST',
        body: JSON.stringify({ id: args.id }),
      }),
    )
  }
  if (name === 'comfy_bind_access_key_to_my_workbench') {
    return jsonText(
      await requestWorkbenchJson('/workbench/access-keys/workspace', {
        method: 'POST',
        body: JSON.stringify({ id: args.id }),
      }),
    )
  }
  if (name === 'comfy_get_base_model_profiles') {
    const state = await readSharedState()
    const profiles = normalizeBaseModelProfiles(state.baseModelProfiles)
    if (args.base !== undefined) {
      const base = validateBaseModelId(args.base)
      return jsonText({ stateSource, base, profile: profiles[base] })
    }
    return jsonText({ stateSource, profiles })
  }
  if (name === 'comfy_update_base_model_profile') {
    const state = await readSharedState()
    const base = validateBaseModelId(args.base)
    const profiles = normalizeBaseModelProfiles(state.baseModelProfiles)
    const patch = {}
    for (const key of ['positivePrefix', 'negativePrefix', 'preset', 'steps', 'cfg', 'sampler', 'scheduler', 'width', 'height', 'upscaleSteps']) {
      if (args[key] !== undefined) patch[key] = args[key]
    }
    const source = args.reset ? defaultBaseModelProfiles[base] : profiles[base]
    profiles[base] = normalizeBaseModelProfile(patch, source)
    await runWorkbenchOperation('base_model_profiles.update', {
      baseModelProfiles: { [base]: profiles[base] },
      baseRevision: state.baseModelProfilesRevision,
    })
    return jsonText({ ok: true, stateSource, base, profile: profiles[base] })
  }
  if (name === 'comfy_generate_image') {
    const moss = normalizeMossGeneration({ model: args.model, width: args.width, height: args.height, steps: args.steps,
      mossOptions: { dmd: args.moss_dmd, faceRedraw: args.face_detail } })
    const body = {
      prompt: args.prompt,
      prefix: args.prefix,
      negative: args.negative,
      model: args.model || 'gembyte_emerald',
      preset: args.preset || 'anime_manga_fast',
      width: args.width || 768,
      height: args.height || 1024,
      steps: args.steps,
      cfg: args.cfg,
      seed: args.seed,
      sampler_name: args.sampler_name,
      scheduler: args.scheduler,
      loras: args.loras,
      filename_prefix: args.filename_prefix || 'MCP/%date:yyyyMMddhhmmss%',
      upscale_scale: args.upscale_scale,
      dry_run: Boolean(args.dry_run),
      face_detail: args.face_detail,
      ...faceParametersBody(args.face_detail === true, { steps: args.face_steps, cfg: args.face_cfg, denoise: args.face_denoise, sampler: args.face_sampler_name, scheduler: args.face_scheduler }),
    }
    Object.keys(body).forEach((key) => body[key] === undefined && delete body[key])
    if (isMossModel(args.model)) {
      Object.assign(body, mossOptionsBody(moss), {
        width: moss.width ?? 1184, height: moss.height ?? 896,
        steps: moss.steps ?? (moss.mossOptions.dmd ? 8 : 30),
        upscale_method: args.upscale_scale ? 'omnisr' : 'none',
      })
    }
    const pngMetadata = {
      app: 'comfy-preset-workflow-ui',
      version: 1,
      createdAt: new Date().toISOString(),
      generationPreset: {
        id: `mcp_${Date.now()}`,
        name: 'MCP generation',
        faceDetail: args.face_detail === true,
        faceParameters: { steps: args.face_steps, cfg: args.face_cfg, denoise: args.face_denoise, sampler: args.face_sampler_name, scheduler: args.face_scheduler },
        mossOptions: isMossModel(args.model) ? moss.mossOptions : undefined,
        selectedBlockIds: [],
        selectedColorPrompts: [],
        positivePrefix: args.prefix || '',
        negativePrefix: args.negative || '',
        width: body.width,
        height: body.height,
        steps: body.steps,
        cfg: body.cfg,
        sampler: body.sampler_name,
        scheduler: body.scheduler,
        model: body.model,
        preset: body.preset,
        filenamePrefix: body.filename_prefix,
        upscales: body.upscale_scale ? [{ enabled: true, scale: body.upscale_scale }] : [],
      },
      selectedBlocks: [],
      composed: { positive: joinPrompt([args.prefix, args.prompt]), negative: args.negative || '', loras: body.loras || [] },
      requestBody: body,
    }
    return jsonText(
      await requestWorkbenchJson('/workbench/generate', {
        method: 'POST',
        body: JSON.stringify({ requestBody: body, pngMetadata, includeResource: true, recordHistory: true, manageGenerationState: true }),
      }),
    )
  }
  if (name === 'comfy_read_image_prompt') {
    const resource = await uploadToolImage(args.image_path)
    return jsonText(
      await requestWorkbenchJson('/workbench/image-prompt', {
        method: 'POST',
        body: JSON.stringify({ imageUrl: resource.sourceImageUrl }),
      }),
    )
  }
  if (name === 'comfy_read_block_source_preset') {
    const state = await readSharedState()
    const { block, imagePath, imageUrl, metadata } = await findBlockSourcePreset(state, args)
    return jsonText({
      ok: true,
      stateSource,
      block: block
        ? {
            id: block.id,
            categoryId: block.categoryId,
            name: block.name,
            previewSourceImagePath: block.previewSourceImagePath,
            previewSourceImageUrl: block.previewSourceImageUrl,
          }
        : undefined,
      imagePath,
      imageUrl,
      generationPreset: metadata.generationPreset,
      selectedBlocks: metadata.selectedBlocks,
      composed: metadata.composed,
      requestBody: metadata.requestBody,
    })
  }
  if (name === 'comfy_download_block_source_image') {
    return jsonText(await downloadBlockSourceImage(args))
  }
  if (name === 'comfy_generate_from_block_preset') {
    const state = await readSharedState()
    const { block: sourceBlock, imagePath: sourceImagePath, imageUrl: sourceImageUrl, metadata: sourceMetadata } = await findBlockSourcePreset(state, args)
    const generated = composeWorkbenchRequest(state, sourceMetadata.generationPreset, args)
    if (args.dry_run) {
      return jsonText({
        ok: true,
        dry_run: true,
        sourceBlockId: sourceBlock?.id,
        sourceImagePath,
        sourceImageUrl,
        selectedBlockIds: generated.selectedBlockIds,
        generationPreset: generated.generationPreset,
        composed: generated.composed,
        requestBody: generated.body,
      })
    }
    const data = await requestWorkbenchJson('/workbench/generate', {
      method: 'POST',
      body: JSON.stringify({
        requestBody: generated.body,
        pngMetadata: generated.metadata,
        includeResource: true,
        recordHistory: true,
        manageGenerationState: true,
      }),
    })
    const imagePath = data.image_path ?? data.images?.[0]?.path ?? data.images?.[0]?.image_path ?? ''
    const imageUrl = data.image_url ?? data.images?.[0]?.url ?? data.images?.[0]?.image_url ?? ''
    const resource = data.resource

    const savePreview = args.savePreview === undefined ? true : Boolean(args.savePreview)
    const targetPreviewBlockId = String(args.targetPreviewBlockId || sourceBlock?.id || '').trim()
    let targetBlock
    if (savePreview && targetPreviewBlockId && resource?.previewImage && resource?.sourceImageUrl) {
      const index = state.blocks.findIndex((item) => item.id === targetPreviewBlockId)
      if (index < 0) throw new Error(`Target preview block not found: ${targetPreviewBlockId}`)
      const current = state.blocks[index]
      const inferredBases = Array.isArray(current.loraBaseModels)
        ? current.loraBaseModels.filter((item) => loraBaseModelIds.includes(item))
        : []
      const requestedTargetBase = String(args.targetPreviewBaseModel || '').trim()
      const targetBase = ['none', ...loraBaseModelIds].includes(requestedTargetBase)
        ? requestedTargetBase
        : inferredBases.length === 1
          ? inferredBases[0]
          : 'none'
      const previewVariant = {
        id: `preview_${crypto.randomUUID()}`,
        baseModel: targetBase,
        image: resource.previewImage,
        sourceImageUrl: resource.sourceImageUrl,
        fit: resource.previewFit === 'background' ? 'background' : 'crop',
        createdAt: new Date().toISOString(),
      }
      targetBlock = compactBlock({
        ...current,
        previewImage: resource.previewImage,
        previewSourceImagePath: '',
        previewSourceImageUrl: resource.sourceImageUrl,
        previewFit: resource.previewFit === 'background' ? 'background' : undefined,
        previewVariants: [previewVariant, ...(Array.isArray(current.previewVariants) ? current.previewVariants : [])],
        activePreviewVariantIds: { ...(current.activePreviewVariantIds || {}), [targetBase]: previewVariant.id },
      })
      await runWorkbenchOperation('block.update', {
        id: targetBlock.id,
        block: targetBlock,
        baseRevision: state.blocks[index].revision,
      })
    }

    return jsonText({
      ok: true,
      sourceBlockId: sourceBlock?.id,
      sourceImagePath,
      sourceImageUrl,
      selectedBlockIds: generated.selectedBlockIds,
      generationPreset: generated.generationPreset,
      composed: generated.composed,
      requestBody: generated.body,
      result: data,
      imagePath,
      imageUrl,
      resource,
      previewUpdatedBlock: targetBlock
        ? {
            id: targetBlock.id,
            name: targetBlock.name,
            previewSourceImagePath: targetBlock.previewSourceImagePath,
            previewSourceImageUrl: targetBlock.previewSourceImageUrl,
            previewFit: targetBlock.previewFit || 'crop',
          }
        : undefined,
    })
  }
  if (name === 'comfy_list_categories') {
    const state = await readSharedState()
    return jsonText({
      stateSource,
      categories: state.categories.map((category, index) => ({
        ...category,
        index,
        builtin: defaultCategoryIds.has(category.id),
        blockCount: state.blocks.filter((block) => block.categoryId === category.id).length,
      })),
    })
  }
  if (name === 'comfy_create_category') {
    const state = await readSharedState()
    const categoryName = String(args.name || '').trim()
    if (!categoryName) throw new Error('name is required')
    const requestedId = makeCategoryId(args.id || categoryName)
    const id = requestedId && !state.categories.some((category) => category.id === requestedId) ? requestedId : createCategoryId(state, requestedId || categoryName)
    const category = {
      id,
      name: categoryName,
      ...(args.description === undefined ? {} : { description: String(args.description || '').trim() || undefined }),
    }
    const index = Number.isFinite(Number(args.index)) ? Math.max(0, Math.min(state.categories.length, Number(args.index))) : state.categories.length
    await runWorkbenchOperation('category.create', { category, index })
    return jsonText({ ok: true, stateSource, category, index })
  }
  if (name === 'comfy_update_category') {
    const state = await readSharedState()
    const id = String(args.id || '').trim()
    const index = state.categories.findIndex((category) => category.id === id)
    if (index < 0) throw new Error(`Category not found: ${id}`)
    const category = state.categories[index]
    const nextName = args.name === undefined ? category.name : String(args.name || '').trim()
    if (!nextName) throw new Error('name cannot be empty')
    const nextDescription = args.description === undefined ? category.description : String(args.description || '').trim() || undefined
    const nextId = args.newId === undefined ? id : makeCategoryId(args.newId)
    if (!nextId) throw new Error('newId cannot be empty')
    if (nextId !== id && defaultCategoryIds.has(id)) throw new Error(`Built-in category id cannot be changed: ${id}`)
    if (nextId !== id && state.categories.some((item) => item.id === nextId)) throw new Error(`Category already exists: ${nextId}`)
    await runWorkbenchOperation('category.update', {
      id,
      category: { ...category, id: nextId, name: nextName, description: nextDescription },
      baseRevision: category.revision,
    })
    return jsonText({ ok: true, stateSource, category: { id: nextId, name: nextName, description: nextDescription } })
  }
  if (name === 'comfy_move_category') {
    const state = await readSharedState()
    const id = String(args.id || '').trim()
    const index = state.categories.findIndex((category) => category.id === id)
    if (index < 0) throw new Error(`Category not found: ${id}`)
    const targetIndex = Number(args.index)
    if (!Number.isFinite(targetIndex)) throw new Error('index must be a number')
    const categories = [...state.categories]
    const [category] = categories.splice(index, 1)
    const boundedIndex = Math.max(0, Math.min(categories.length, Math.round(targetIndex)))
    categories.splice(boundedIndex, 0, category)
    await runWorkbenchOperation('category.move', { id, index: boundedIndex, baseRevision: category.revision })
    return jsonText({ ok: true, stateSource, category, index: boundedIndex })
  }
  if (name === 'comfy_delete_category') {
    const state = await readSharedState()
    const id = String(args.id || '').trim()
    const index = state.categories.findIndex((category) => category.id === id)
    if (index < 0) throw new Error(`Category not found: ${id}`)
    if (defaultCategoryIds.has(id)) throw new Error(`Built-in category cannot be deleted: ${id}`)
    const affectedBlocks = state.blocks.filter((block) => block.categoryId === id)
    const moveBlocksTo = String(args.moveBlocksTo || '').trim()
    if (affectedBlocks.length > 0 && !moveBlocksTo) {
      throw new Error(`Category is not empty: ${id}. Pass moveBlocksTo to migrate ${affectedBlocks.length} blocks.`)
    }
    if (moveBlocksTo) validateCategory(state, moveBlocksTo)
    const [deleted] = state.categories.splice(index, 1)
    await runWorkbenchOperation('category.delete', { id, moveBlocksTo: moveBlocksTo || undefined, baseRevision: deleted.revision })
    return jsonText({ ok: true, stateSource, deleted, movedBlocks: affectedBlocks.length, moveBlocksTo: moveBlocksTo || undefined })
  }
  if (name === 'comfy_list_preset_blocks') {
    const state = await readSharedState()
    const query = String(args.query || '').trim().toLowerCase()
    const limit = Number.isFinite(Number(args.limit)) ? Math.max(1, Number(args.limit)) : 80
    const includeDisabled = args.includeDisabled === undefined ? true : Boolean(args.includeDisabled)
    const blocks = state.blocks
      .filter((block) => includeDisabled || block.enabled !== false)
      .filter((block) => !args.categoryId || block.categoryId === args.categoryId)
      .filter((block) => {
        if (!query) return true
        const haystack = collectStrings(block).join('\n').toLowerCase()
        return haystack.includes(query)
      })
      .slice(0, limit)
    return jsonText({
      stateSource,
      categories: state.categories,
      total_returned: blocks.length,
      blocks,
    })
  }
  if (name === 'comfy_create_preset_block') {
    const state = await readSharedState()
    const block = compactBlock(await normalizeBlockPayload(state, args))
    if (state.blocks.some((item) => item.id === block.id)) throw new Error(`Preset block already exists: ${block.id}`)
    await runWorkbenchOperation('block.create', { block, index: state.blocks.length })
    return jsonText({ ok: true, stateSource, block })
  }
  if (name === 'comfy_update_preset_block') {
    const state = await readSharedState()
    const id = String(args.id || '').trim()
    const index = state.blocks.findIndex((block) => block.id === id)
    if (index < 0) throw new Error(`Preset block not found: ${id}`)
    const block = compactBlock(await normalizeBlockPayload(state, args, state.blocks[index]))
    await runWorkbenchOperation('block.update', { id, block, baseRevision: state.blocks[index].revision })
    return jsonText({ ok: true, stateSource, block })
  }
  if (name === 'comfy_delete_preset_block') {
    const state = await readSharedState()
    const id = String(args.id || '').trim()
    const block = state.blocks.find((item) => item.id === id)
    if (!block) throw new Error(`Preset block not found: ${id}`)
    await runWorkbenchOperation('block.delete', { id, baseRevision: block.revision })
    return jsonText({ ok: true, stateSource, deleted: id })
  }
  throw new Error(`Unknown tool: ${name}`)
}

const handle = async (message) => {
  if (message.method === 'notifications/initialized') return
  try {
    if (message.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'comfy-preset-workflow-ui', version: '0.2.0' },
        },
      })
      return
    }
    if (message.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: message.id, result: { tools } })
      return
    }
    if (message.method === 'tools/call') {
      const result = await callTool(message.params?.name, message.params?.arguments || {})
      send({ jsonrpc: '2.0', id: message.id, result })
      return
    }
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Method not found: ${message.method}` },
    })
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
    })
  }
}

let buffer = ''
let handling = Promise.resolve()
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let newline = buffer.indexOf('\n')
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line) {
      try {
        const message = JSON.parse(line)
        handling = handling.then(() => handle(message))
      } catch (error) {
        send({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: error instanceof Error ? error.message : String(error) },
        })
      }
    }
    newline = buffer.indexOf('\n')
  }
})
