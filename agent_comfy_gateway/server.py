from __future__ import annotations

import argparse
import base64
import copy
import http.client
import json
import math
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
COMFY_ROOT = Path(os.environ.get("COMFY_ROOT", PROJECT_ROOT / "ComfyUI")).expanduser().resolve()
INPUT_DIR = COMFY_ROOT / "input"
OUTPUT_DIR = COMFY_ROOT / "output"
LORA_DIR = COMFY_ROOT / "models" / "loras"
LOG_DIR = PROJECT_ROOT / "logs"
CAPTION_WORKER = PROJECT_ROOT / "agent_comfy_gateway" / "caption_worker.py"
AI_UPSCALE_LAB = PROJECT_ROOT / "ai-upscale-lab"
VIDEO_WORK_DIR = AI_UPSCALE_LAB / "work" / "gateway"
VIDEO_OUTPUT_DIR = AI_UPSCALE_LAB / "output"
REALESRGAN_EXE = AI_UPSCALE_LAB / "tools" / "realesrgan-ncnn-vulkan.exe"
RIFE_EXE = AI_UPSCALE_LAB / "tools" / "rife-ncnn-vulkan-20221029-windows" / "rife-ncnn-vulkan.exe"
DASIWA_WORKFLOW = (
    COMFY_ROOT
    / "user"
    / "default"
    / "workflows"
    / "Wan22"
    / "▶Wan22-Dasiwa-视频流(整合) .json"
)

DEFAULT_COMFY_URL = os.environ.get("COMFY_URL", "http://127.0.0.1:8188").rstrip("/")
DEFAULT_HOST = os.environ.get("AGENT_COMFY_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.environ.get("AGENT_COMFY_PORT", "8765"))
DEFAULT_LMSTUDIO_BASE_URL = os.environ.get("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234").rstrip("/")
DEFAULT_LMSTUDIO_MODEL_KEY = os.environ.get("LMSTUDIO_MODEL_KEY", "qwen3-vl-4b-instruct-heretic")
DEFAULT_LMSTUDIO_IDENTIFIER = os.environ.get("LMSTUDIO_IDENTIFIER", "heretic4b-vl")
DEFAULT_LMSTUDIO_TTL = int(os.environ.get("LMSTUDIO_TTL", "10"))
LORA_LIST_DEFAULT_LIMIT = max(1, int(os.environ.get("AGENT_COMFY_LORA_DEFAULT_LIMIT", "1000")))
LORA_LIST_MAX_LIMIT = max(LORA_LIST_DEFAULT_LIMIT, int(os.environ.get("AGENT_COMFY_LORA_MAX_LIMIT", "5000")))
LORA_LIST_CACHE_TTL = max(0.0, float(os.environ.get("AGENT_COMFY_LORA_CACHE_TTL", "15")))
LORA_MODEL_EXTENSIONS = {".safetensors", ".ckpt", ".pt", ".bin"}
KREA2_SAMPLERS = {
    "euler", "euler_cfg_pp", "euler_ancestral", "euler_ancestral_cfg_pp", "heun", "heunpp2",
    "exp_heun_2_x0", "exp_heun_2_x0_sde", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast",
    "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_2s_ancestral_cfg_pp", "dpmpp_sde",
    "dpmpp_sde_gpu", "dpmpp_2m", "dpmpp_2m_cfg_pp", "dpmpp_2m_sde", "dpmpp_2m_sde_gpu",
    "dpmpp_2m_sde_heun", "dpmpp_2m_sde_heun_gpu", "dpmpp_3m_sde", "dpmpp_3m_sde_gpu",
    "ddpm", "lcm", "ipndm", "ipndm_v", "deis", "res_multistep", "res_multistep_cfg_pp",
    "res_multistep_ancestral", "res_multistep_ancestral_cfg_pp", "gradient_estimation",
    "gradient_estimation_cfg_pp", "er_sde", "seeds_2", "seeds_3", "sa_solver", "sa_solver_pece",
    "ddim", "uni_pc", "uni_pc_bh2",
}
KREA2_SCHEDULERS = {
    "simple", "sgm_uniform", "karras", "exponential", "ddim_uniform", "beta", "normal",
    "linear_quadratic", "kl_optimal",
}
KREA2_SECOND_FIELDS = {
    "second_steps", "second_cfg", "second_denoise", "second_seed", "second_sampler_name", "second_scheduler",
}
KREA2_THIRD_FIELDS = {
    "third_steps", "third_cfg", "third_denoise", "third_seed", "third_sampler_name", "third_scheduler",
}
KREA2_UPSCALE_FIELDS = {"upscale_scale", "upscale_multiplier", "upscale", "upscale_model"}
KREA2_HIRES_REQUIRED_NODES = [
    "KSamplerAdvanced",
    "LatentUpscaleBy",
    "VAEDecode",
    "ColorMatchV2",
    "UpscaleModelLoader",
    "GetImageSize+",
    "PrimitiveFloat",
    "SimpleMathDual+",
    "UltimateSDUpscale",
]
KREA2_HIRES_CONTRACT = {
    "type": "krea2_hires",
    "mode_field": "upscale_mode",
    "stage_count_field": "upscale_stages",
    "min_stages": 1,
    "max_stages": 2,
    "modes": {"one_stage": "krea2_hires", "two_stage": "two_stage"},
    "latent_hires": {
        "required": True,
        "scale_field": "upscale_scale",
        "scale_alias": "stage_upscale_scale",
        "default_scale": 1.5,
        "method": "bislerp",
        "fields": [
            "second_steps", "second_cfg", "second_denoise", "second_seed",
            "second_sampler_name", "second_scheduler",
        ],
        "defaults": {"steps": 10, "cfg": 1.0, "denoise": 0.4, "sampler_name": "euler", "scheduler": "simple"},
        "start_at_step_formula": "round(second_steps * (1 - second_denoise))",
    },
    "ultimate_sd_upscale": {
        "optional": True,
        "scale_field": "second_stage_upscale_scale",
        "model_field": "second_stage_upscale_model",
        "default_scale": 1.5,
        "default_model": "OmniSR_X4_DIV2K.safetensors",
        "fields": ["third_steps", "third_cfg", "third_denoise", "third_seed", "third_sampler_name", "third_scheduler"],
        "defaults": {"steps": 3, "cfg": 1.0, "denoise": 0.12, "sampler_name": "euler", "scheduler": "simple"},
        "tile_math": {"divisor": 2.0, "width": "int(input_width * scale / 2)", "height": "int(input_height * scale / 2)"},
        "mode_type": "Linear",
    },
    "output_alignment": {
        "multiple": 8,
        "method": "floor",
        "formula": "floor(previous_size * ultimate_scale / 8) * 8",
        "reference": {"base": [720, 1280], "latent_hires": [1080, 1920], "ultimate_sd_upscale": [1616, 2880]},
    },
}

DEFAULT_POSITIVE_PREFIX = (
    "masterpiece, best quality, ultra high res, hyper-detailed, "
    "anime realism, 8K, newest, "
)
DEFAULT_NEGATIVE = (
    "lowres, worst quality, bad quality, bad anatomy, simple background, blurry, "
    "cropped, extra limbs, deformed hands, bad face, sketch, jpeg artifacts, "
    "signature, watermark, old, oldest, text, logo"
)
UPSCALE_MODELS = {
    2: "OmniSR_X2_DIV2K.safetensors",
    3: "OmniSR_X3_DIV2K.safetensors",
    4: "OmniSR_X4_DIV2K.safetensors",
}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".avi"}
IMAGE_METADATA_PATHS = {"/image/metadata", "/image/info", "/image/comfy", "/image/comfy-info", "/image/comfyinfo"}
IMAGE_PROMPT_PATHS = {"/image/prompt", "/image/prompt-info", "/image/generation", "/image/generation-info"}

GENERATION_MODELS: dict[str, dict[str, Any]] = {
    "moss_image_sft": {
        "label": "MOSS Image SFT INT8",
        "kind": "modular",
        "pipeline": "moss_image_t2i",
        "unet": "moss_image_sft_int8_convrot.safetensors",
        "clip": "qwen3.5_9b_int8_convrot.safetensors",
        "clip_type": "moss_image",
        "vae": "flux2-vae.safetensors",
        "default_width": 1184, "default_height": 896,
        "steps": 30, "cfg": 3.0,
        "aliases": ["moss", "moss_image", "moss_t2i"],
        "required_nodes": ["EmptyFlux2LatentImage", "MOSSImageLayoutPrompt", "PixaromaLayoutBoxes"],
        "upscale_contract": {
            "method_field": "upscale_method",
            "methods": ["none", "omnisr", "seedvr2"], "default": "none",
            "omnisr": {"scale_field": "upscale_scale", "scales": [2, 3, 4], "default": 2},
            "seedvr2": {"resolution": 2560, "max_resolution": 2560,
                        "dit": "seedvr2_ema_7b_sharp_fp16.safetensors",
                        "vae": "ema_vae_fp16.safetensors"},
        },
    },
    "gembyte_emerald": {
        "label": "IL Gembyte 20 Emerald",
        "kind": "checkpoint",
        "checkpoint": "XL-漫画2.5D\\IL-Gembyte_20Emerald.safetensors",
        "aliases": ["gembyte", "emerald", "il-gembyte", "default"],
        "description": "Classic all-in-one checkpoint; model, CLIP, and VAE come from CheckpointLoaderSimple.",
    },
    "gembyte_amethyst": {
        "label": "Gembyte 10 Amethyst",
        "kind": "checkpoint",
        "checkpoint": "Gembyte_10Amethyst.safetensors",
        "aliases": ["amethyst", "gembyte10"],
        "description": "All-in-one checkpoint exposed through CheckpointLoaderSimple.",
    },
    "gembyte_ruby": {
        "label": "Gembyte 30 Ruby",
        "kind": "checkpoint",
        "checkpoint": "Gembyte_30Ruby.safetensors",
        "aliases": ["ruby", "gembyte30"],
        "description": "All-in-one checkpoint exposed through CheckpointLoaderSimple.",
    },
    "dasiwa_illustrious_epitaph": {
        "label": "Dasiwa Illustrious Anime Epitaph Ecstasy",
        "kind": "checkpoint",
        "checkpoint": "DasiwaIllustriousAnime_epitaphecstasy.safetensors",
        "aliases": ["dasiwa_illustrious", "dasiwa_epitaph", "epitaphecstasy"],
        "description": "Illustrious-style all-in-one checkpoint exposed through CheckpointLoaderSimple.",
    },
    "illustrious_semi_v30": {
        "label": "Illustrious Semi v30",
        "kind": "checkpoint",
        "checkpoint": "XL-漫画2.5D\\IL-illustriousSemi_v30.safetensors",
        "aliases": ["illustrious_semi", "il_semi", "semi_v30"],
        "description": "Illustrious semi-real anime checkpoint exposed through CheckpointLoaderSimple.",
    },
    "lunar_cherry_v20": {
        "label": "Lunar Cherry Mix v20",
        "kind": "checkpoint",
        "checkpoint": "XL-漫画2.5D\\IL-lunarcherrymix_v20.safetensors",
        "aliases": ["lunar_cherry", "lunarcherry", "cherry_v20"],
        "description": "Lunar Cherry Illustrious checkpoint exposed through CheckpointLoaderSimple.",
    },
    "nova_orange_v100": {
        "label": "Nova Orange XL v100",
        "kind": "checkpoint",
        "checkpoint": "XL-漫画2.5D\\IL-novaOrangeXL_v100.safetensors",
        "aliases": ["nova_orange", "novaorange", "orange_v100"],
        "description": "Nova Orange XL checkpoint exposed through CheckpointLoaderSimple.",
    },
    "animagine_xl_v31": {
        "label": "Animagine XL v3.1",
        "kind": "checkpoint",
        "checkpoint": "animagineXLV31_v31.safetensors",
        "aliases": ["animagine", "animagine_xl", "animagine_v31"],
        "description": "Animagine XL checkpoint exposed through CheckpointLoaderSimple.",
    },
    "anything_v5": {
        "label": "Anything v5 PrtRE",
        "kind": "checkpoint",
        "checkpoint": "anything-v5-PrtRE.safetensors",
        "aliases": ["anything", "anything_v5_prtre"],
        "description": "Anything v5 checkpoint exposed through CheckpointLoaderSimple.",
    },
    "wai_illustrious_v160": {
        "label": "WAI Illustrious SDXL v1.6",
        "kind": "checkpoint",
        "checkpoint": "waiIllustriousSDXL_v160.safetensors",
        "aliases": ["wai_v160", "wai_illustrious_160"],
        "description": "WAI Illustrious SDXL checkpoint exposed through CheckpointLoaderSimple.",
    },
    "wai_illustrious_v170": {
        "label": "WAI Illustrious SDXL v1.7",
        "kind": "checkpoint",
        "checkpoint": "waiIllustriousSDXL_v170.safetensors",
        "aliases": ["wai", "wai_v170", "wai_illustrious", "wai_illustrious_170"],
        "description": "WAI Illustrious SDXL checkpoint exposed through CheckpointLoaderSimple.",
    },
    "wai_anima_v10": {
        "label": "WAI ANIMA v10 Base 10",
        "kind": "modular",
        "unet": "waiANIMA_v10Base10.safetensors",
        "weight_dtype": "default",
        "clip": "waiANIMA_v10Base10_txt.safetensors",
        "clip_type": "qwen_image",
        "clip_device": "default",
        "vae": "qwen_image_vae_waianima.safetensors",
        "aliases": ["wai_anima", "wai_anima_base10", "waianima", "wai_anima_v10_base10"],
        "description": "Standalone WAI ANIMA diffusion model with its matching text encoder and WAI ANIMA Qwen image VAE.",
    },
    "krea2_turbo": {
        "label": "Krea 2 Turbo FP8",
        "kind": "modular",
        "pipeline": "krea2_hires",
        "training_family": "krea2",
        "unet": "krea2_turbo_fp8_scaled.safetensors",
        "weight_dtype": "default",
        "clip": "qwen3vl_4b_fp8_scaled.safetensors",
        "clip_type": "krea2",
        "clip_device": "default",
        "vae": "qwen_image_vae.safetensors",
        "default_width": 720,
        "default_height": 1280,
        "steps": 7,
        "cfg": 1.0,
        "sampler_name": "euler",
        "scheduler": "simple",
        "required_nodes": KREA2_HIRES_REQUIRED_NODES,
        "upscale_contract": KREA2_HIRES_CONTRACT,
        "aliases": ["krea2", "krea_2", "krea2_fp8", "krea2_turbo_fp8", "krea_turbo"],
        "description": "Krea 2 advanced latent-hires pipeline. At least one latent hires stage is required; an optional second stage uses UltimateSDUpscale.",
    },
    "dasiwa_krea2_turbo_raw": {
        "label": "Dasiwa Krea 2 Turbo Raw CuteDisaster v2",
        "kind": "modular",
        "pipeline": "krea2_hires",
        "training_family": "krea2",
        "unet": "Krea2\\DasiwaKrea2TurboRaw_cutedisasterV2Turbo.safetensors",
        "weight_dtype": "default",
        "clip": "qwen3VLInstruct4bHeretic_v10.safetensors",
        "clip_type": "krea2",
        "clip_device": "default",
        "vae": "qwen_image_vae.safetensors",
        "default_width": 720,
        "default_height": 1280,
        "steps": 7,
        "cfg": 1.0,
        "sampler_name": "euler",
        "scheduler": "simple",
        "required_nodes": KREA2_HIRES_REQUIRED_NODES,
        "upscale_contract": KREA2_HIRES_CONTRACT,
        "aliases": [
            "dasiwak2", "dasiwa_krea2", "dasiwa_k2", "dasiwa_krea2_raw",
            "cutedisaster", "cutedisaster_v2", "dasiwa_cutedisaster",
        ],
        "description": "Dasiwa Krea 2 advanced latent-hires pipeline with evidenced Heretic Krea2 CLIP and Qwen image VAE; optional stage two uses UltimateSDUpscale.",
    },
    "miaomiao_harem": {
        "label": "MiaoMiao Harem anima12",
        "kind": "modular",
        "unet": "miaomiaoHarem_anima12.safetensors",
        "weight_dtype": "default",
        "clip": "miaomiaoHarem_anima12_txt.safetensors",
        "clip_type": "qwen_image",
        "clip_device": "default",
        "vae": "qwen_image_vae.safetensors",
        "aliases": ["miaomiao", "miaomiao_harem", "harem", "miao_harem"],
        "description": "Standalone diffusion model; gateway assembles UNETLoader + CLIPLoader + VAELoader.",
    },
    "miaomiao_harem_anima13": {
        "label": "MiaoMiao Harem anima13",
        "kind": "modular",
        "unet": "miaomiaoHarem_anima13.safetensors",
        "weight_dtype": "default",
        "clip": "miaomiaoHarem_anima12_txt.safetensors",
        "clip_type": "qwen_image",
        "clip_device": "default",
        "vae": "qwen_image_vae.safetensors",
        "aliases": ["miaomiao13", "miaomiao_harem13", "harem_anima13", "miao_harem13"],
        "description": "Standalone MiaoMiao diffusion model using the installed MiaoMiao text encoder and Qwen image VAE.",
    },
    "miaomiao_harem_ani25d_v10": {
        "label": "MiaoMiao Harem Ani 2.5D v10",
        "kind": "modular",
        "unet": "MiaomiaoHaremAni25D_v10.safetensors",
        "weight_dtype": "default",
        "clip": "MiaomiaoHaremAni25D_v10_txt.safetensors",
        "clip_type": "qwen_image",
        "clip_device": "default",
        "vae": "qwen_image_vae.safetensors",
        "aliases": ["miaomiao_ani25d", "miaomiao25d", "harem_ani25d"],
        "description": "Standalone MiaoMiao Ani 2.5D diffusion model with its matching text encoder and Qwen image VAE.",
    },
    "miaomiao_realskin": {
        "label": "MiaoMiao Realskin anima10",
        "kind": "modular",
        "unet": "miaomiaoRealskin_anima10.safetensors",
        "weight_dtype": "default",
        "clip": "miaomiaoHarem_anima12_txt.safetensors",
        "clip_type": "qwen_image",
        "clip_device": "default",
        "vae": "qwen_image_vae.safetensors",
        "aliases": ["miaomiao_realskin", "realskin", "miao_realskin"],
        "description": "Standalone diffusion model using the installed MiaoMiao text encoder and Qwen image VAE.",
    },
    "tekito_mix_v21": {
        "label": "Tekito Mix v2.1",
        "kind": "modular",
        "unet": "tekitoMix_v21.safetensors",
        "weight_dtype": "default",
        "clip": "miaomiaoHarem_anima12_txt.safetensors",
        "clip_type": "qwen_image",
        "clip_device": "default",
        "vae": "qwen_image_vae.safetensors",
        "aliases": ["tekito", "tekitomix", "tekito_v21"],
        "description": "Standalone diffusion model using the installed MiaoMiao text encoder and Qwen image VAE.",
    },
}

MOSS_LEGACY_DMD = {
    **copy.deepcopy(GENERATION_MODELS["moss_image_sft"]),
    "label": "MOSS Image SFT DMD 8-step INT8",
    "default_width": 1024, "default_height": 1024, "steps": 8,
    "aliases": ["moss_dmd8", "moss_8step", "moss_image_8step"],
    "acceleration_lora": "MOSS-Image\\moss_sft_8step_dmd_latest.safetensors",
    "acceleration_strength": 1.0,
    "required_nodes": [*GENERATION_MODELS["moss_image_sft"]["required_nodes"], "LoraLoaderModelOnly"],
}
MOSS_DMD_ALIASES = {"moss_image_sft_dmd8", "moss_dmd8", "moss_8step", "moss_image_8step"}
MOSS_FACE_NODES = ["UltralyticsDetectorProvider", "BboxDetectorSEGS", "DetailerForEach", "GatewayMeasuredDetailer", "ImpactCount_Elts_in_SEGS", "PreviewAny"]
GENERATION_MODELS["moss_image_sft"]["options"] = {
    "moss_dmd": {"default": False, "type": "boolean", "strength": 1.0, "steps_when_enabled": 8},
    "face_diagnostic_export": {"default": False, "type": "boolean", "requires": "face_detail", "stages": ["original_crop", "upscaled_input", "decoded_before_resize", "after_paste", "final_image"]},
    "face_detail": {"default": False, "type": "boolean", "required_nodes": MOSS_FACE_NODES,
                    "detector": "bbox/face_yolov8m.pt", "no_face": "passthrough"},
    "face_steps": {"default": 30, "min": 1, "max": 100},
    "face_cfg": {"default": 3.0, "min": 0, "max": 100},
    "face_denoise": {"default": 0.8, "min": 0.0001, "max": 1},
    "face_noise_mask_feather": {"default": 20, "min": 0, "max": 100},
    "face_guide_size": {"default": 1024, "min": 64, "max": 4096},
    "face_max_size": {"default": 2048, "min": 64, "max": 4096},
    "face_crop_factor": {"default": 1.5, "min": 1.0, "max": 10.0},
    "face_sampler_name": {"default": "euler", "values": sorted(KREA2_SAMPLERS)},
    "face_scheduler": {"default": "normal", "values": sorted(KREA2_SCHEDULERS)},
    "face_seed": {"default": "seed", "min": 0, "max": 2**64-1},
}

for _key, _parent, _label, _unet, _sampler, _scheduler, _aliases in (
    ("classium_krea2_v10", "dasiwa_krea2_turbo_raw", "Classium v1.0 Krea2", "classium_v10Krea2.safetensors", "euler_ancestral", "simple", ["classium", "classium_krea2"]),
    ("sickanime_krea2_v10", "krea2_turbo", "Krea2 SickAnime v1.0 FP8", "krea2Sickanime_v10_fp8.safetensors", "er_sde", "beta", ["sickanime", "krea2_sickanime"]),
):
    GENERATION_MODELS[_key] = {
        **copy.deepcopy(GENERATION_MODELS[_parent]), "label": _label, "unet": "Krea2\\" + _unet,
        "steps": 8, "cfg": 1.0, "sampler_name": _sampler, "scheduler": _scheduler,
        "aliases": _aliases, "description": f"{_label}: standalone diffusion weights; 8-step first pass, Krea2 hires stages, no automatic acceleration LoRA.",
    }

FACE_ANIMA_MODELS = {"wai_anima_v10", "miaomiao_harem", "miaomiao_harem_anima13", "miaomiao_harem_ani25d_v10", "miaomiao_realskin", "tekito_mix_v21"}
for _key, _spec in GENERATION_MODELS.items():
    if _spec.get("pipeline") == "krea2_hires" or _key in FACE_ANIMA_MODELS:
        _spec["options"] = {k: copy.deepcopy(v) for k, v in GENERATION_MODELS["moss_image_sft"]["options"].items() if k.startswith("face_")}
        _spec["options"]["face_denoise"]["default"] = 0.2
        _spec["options"]["face_cfg"]["default"] = 1.0 if _spec.get("pipeline") == "krea2_hires" else 3.0
        _spec["face_detail_stage"] = "after_latent_hires_before_usd" if _spec.get("pipeline") == "krea2_hires" else "after_final_decode_before_save"

PRESETS: dict[str, dict[str, Any]] = {
    "anime_manga": {
        "description": "Two-pass anime manga workflow from the installed 二次元漫画模型工作流 pack.",
        "checkpoint": "XL-漫画2.5D\\IL-Gembyte_20Emerald.safetensors",
        "width": 832,
        "height": 1216,
        "steps": 30,
        "cfg": 6.0,
        "sampler_name": "euler_ancestral",
        "scheduler": "normal",
        "upscale_scale": 2,
        "upscale_model": "OmniSR_X2_DIV2K.safetensors",
        "second_steps": 10,
        "second_denoise": 0.25,
        "filename_prefix": "agent_comfy_anime",
    },
    "anime_manga_fast": {
        "description": "Lower-cost variant of the same workflow for quick agent tests.",
        "checkpoint": "XL-漫画2.5D\\IL-Gembyte_20Emerald.safetensors",
        "width": 512,
        "height": 768,
        "steps": 18,
        "cfg": 6.0,
        "sampler_name": "euler_ancestral",
        "scheduler": "normal",
        "upscale_scale": 2,
        "upscale_model": "OmniSR_X2_DIV2K.safetensors",
        "second_steps": 6,
        "second_denoise": 0.22,
        "filename_prefix": "agent_comfy_fast",
    },
}


class GatewayError(Exception):
    def __init__(self, message: str, status: int = 500, details: Any | None = None):
        super().__init__(message)
        self.status = status
        self.details = details


def json_request(method: str, url: str, payload: Any | None = None, timeout: float = 30) -> Any:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise GatewayError(f"ComfyUI HTTP {exc.code}", 502, body) from exc
    except (OSError, http.client.HTTPException) as exc:
        raise GatewayError(f"Cannot reach ComfyUI: {exc}", 502) from exc
    return json.loads(raw) if raw else None


def local_json_request(method: str, url: str, payload: Any | None = None, timeout: float = 30, label: str = "HTTP") -> Any:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise GatewayError(f"{label} HTTP {exc.code}", 502, body) from exc
    except OSError as exc:
        raise GatewayError(f"Cannot reach {label}: {exc}", 502) from exc
    return json.loads(raw) if raw else None


def clamp_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed))


def align8(value: int) -> int:
    return max(64, int(round(value / 8)) * 8)


def parse_upscale_scale(value: Any) -> int:
    if isinstance(value, str):
        value = value.lower().strip().removeprefix("x").removesuffix("x")
    try:
        scale = int(value)
    except (TypeError, ValueError):
        raise GatewayError("upscale_scale must be one of 2, 3, or 4", 400) from None
    if scale not in UPSCALE_MODELS:
        raise GatewayError("upscale_scale must be one of 2, 3, or 4", 400)
    return scale


def resolve_upscale_model(request: dict[str, Any], preset: dict[str, Any]) -> str:
    if request.get("upscale_model"):
        return str(request["upscale_model"])
    scale = request.get("upscale_scale", request.get("upscale_multiplier", request.get("upscale")))
    if scale is None:
        scale = preset.get("upscale_scale", 2)
    return UPSCALE_MODELS[parse_upscale_scale(scale)]


def use_two_stage_upscale(request: dict[str, Any]) -> bool:
    mode = str(request.get("upscale_mode") or request.get("upscale_strategy") or "single").strip().lower()
    return mode in {"two_stage", "two-step", "two_step", "double", "staged"}


def resolve_stage_upscale_model(request: dict[str, Any]) -> str:
    if request.get("stage_upscale_model"):
        return str(request["stage_upscale_model"])
    scale = request.get("stage_upscale_scale", request.get("first_upscale_scale", 2))
    return UPSCALE_MODELS[parse_upscale_scale(scale)]


def resolve_second_stage_upscale_model(request: dict[str, Any]) -> str:
    if request.get("second_stage_upscale_model"):
        return str(request["second_stage_upscale_model"])
    scale = request.get(
        "second_stage_upscale_scale",
        request.get("second_upscale_scale", request.get("stage_upscale_scale", 2)),
    )
    return UPSCALE_MODELS[parse_upscale_scale(scale)]


def strict_int_field(
    request: dict[str, Any],
    field: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    value = request.get(field)
    if value is None:
        return default
    if isinstance(value, bool):
        raise GatewayError(f"{field} must be an integer", 400, {"field": field, "value": value})
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str) and re.fullmatch(r"[+-]?\d+", value.strip()):
        parsed = int(value.strip())
    else:
        raise GatewayError(f"{field} must be an integer", 400, {"field": field, "value": value})
    if parsed < minimum or parsed > maximum:
        raise GatewayError(
            f"{field} must be between {minimum} and {maximum}",
            400,
            {"field": field, "value": parsed, "minimum": minimum, "maximum": maximum},
        )
    return parsed


def strict_float_field(
    request: dict[str, Any],
    field: str,
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    value = request.get(field)
    if value is None:
        return default
    if isinstance(value, bool):
        raise GatewayError(f"{field} must be a number", 400, {"field": field, "value": value})
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        raise GatewayError(f"{field} must be a number", 400, {"field": field, "value": value}) from None
    if not math.isfinite(parsed) or parsed < minimum or parsed > maximum:
        raise GatewayError(
            f"{field} must be between {minimum} and {maximum}",
            400,
            {"field": field, "value": value, "minimum": minimum, "maximum": maximum},
        )
    return parsed


def strict_choice_field(
    request: dict[str, Any],
    field: str,
    default: str,
    choices: set[str],
) -> str:
    value = str(request.get(field) or default).strip()
    if value not in choices:
        raise GatewayError(
            f"Unsupported {field}",
            400,
            {"field": field, "value": value, "available": sorted(choices)},
        )
    return value


def request_has_any(request: dict[str, Any], fields: set[str]) -> bool:
    return any(field in request and request.get(field) is not None for field in fields)


def krea2_scale_model(
    request: dict[str, Any],
    model_field: str,
    scale_fields: tuple[str, ...],
    *,
    default_scale: int | None = None,
    required: bool = False,
) -> str:
    model_name = str(request.get(model_field) or "").strip()
    if model_name:
        return model_name
    scale: Any | None = None
    for field in scale_fields:
        if field in request and request.get(field) is not None:
            scale = request[field]
            break
    if scale is None:
        scale = default_scale
    if scale is None:
        if required:
            raise GatewayError(
                "Krea2 denoise upscale requires an upscale model or scale",
                400,
                {"model_field": model_field, "scale_fields": list(scale_fields), "allowed_scales": sorted(UPSCALE_MODELS)},
            )
        return ""
    normalized = str(scale).strip().lower()
    if normalized in {"", "0", "1", "1.0", "x1", "1x", "none", "off", "false", "disabled"}:
        if required:
            raise GatewayError(
                "Krea2 denoise upscale scale must be 2, 3, or 4",
                400,
                {"value": scale, "allowed_scales": sorted(UPSCALE_MODELS)},
            )
        return ""
    return UPSCALE_MODELS[parse_upscale_scale(scale)]


def resolve_krea2_upscale_plan(request: dict[str, Any]) -> dict[str, Any]:
    raw_mode = str(request.get("upscale_mode") or request.get("upscale_strategy") or "single").strip().lower()
    has_second = request_has_any(request, KREA2_SECOND_FIELDS)
    has_third = request_has_any(request, KREA2_THIRD_FIELDS)
    has_upscale = request_has_any(request, KREA2_UPSCALE_FIELDS)

    if raw_mode in {"two_stage", "two-step", "two_step", "double", "staged"}:
        mode = "two_stage"
    elif raw_mode in {"denoise", "krea2_denoise", "single_denoise", "hires_fix", "hires"}:
        mode = "denoise"
    elif raw_mode in {"pixel", "pixel_only", "pixel-only", "pixel_space", "pixel-space"}:
        mode = "pixel"
    elif raw_mode in {"", "single"}:
        if has_third:
            raise GatewayError("Krea2 third_* fields require upscale_mode=two_stage", 400)
        mode = "denoise" if has_second else "pixel"
    elif raw_mode in {"none", "off", "disable", "disabled", "false"}:
        if has_upscale or has_second or has_third:
            raise GatewayError("Krea2 disabled upscale mode cannot include upscale or sampler fields", 400)
        return {"mode": "none", "models": []}
    else:
        raise GatewayError(
            "Unsupported Krea2 upscale_mode",
            400,
            {"upscale_mode": raw_mode, "supported": ["pixel", "single", "denoise", "krea2_denoise", "two_stage", "none"]},
        )

    if mode == "pixel":
        conflicting = sorted(
            field for field in KREA2_SECOND_FIELDS | KREA2_THIRD_FIELDS if field in request and request.get(field) is not None
        )
        if conflicting:
            raise GatewayError("Krea2 pixel upscale does not accept second_* or third_* fields", 400, {"fields": conflicting})
        model = krea2_scale_model(
            request,
            "upscale_model",
            ("upscale_scale", "upscale_multiplier", "upscale"),
        )
        return {"mode": "pixel" if model else "none", "models": [model] if model else []}

    if mode == "denoise":
        if has_third:
            raise GatewayError("Krea2 third_* fields require upscale_mode=two_stage", 400)
        model = krea2_scale_model(
            request,
            "upscale_model",
            ("upscale_scale", "upscale_multiplier", "upscale"),
            required=True,
        )
        return {"mode": "denoise", "models": [model]}

    first_model = krea2_scale_model(
        request,
        "stage_upscale_model",
        ("stage_upscale_scale", "first_upscale_scale", "upscale_scale"),
        default_scale=2,
        required=True,
    )
    second_model = krea2_scale_model(
        request,
        "second_stage_upscale_model",
        ("second_stage_upscale_scale", "second_upscale_scale", "stage_upscale_scale"),
        default_scale=2,
        required=True,
    )
    return {"mode": "two_stage", "models": [first_model, second_model]}


def normalize_loras(request: dict[str, Any]) -> list[dict[str, Any]]:
    raw_loras = request.get("loras")
    if raw_loras is None and request.get("lora"):
        raw_loras = [
            {
                "name": request.get("lora"),
                "strength_model": request.get("lora_strength", request.get("strength_model", 0.7)),
                "strength_clip": request.get("lora_strength", request.get("strength_clip", 0.7)),
            }
        ]
    if raw_loras is None:
        return []
    if not isinstance(raw_loras, list):
        raise GatewayError("loras must be a list", 400)

    normalized: list[dict[str, Any]] = []
    for item in raw_loras:
        if isinstance(item, str):
            item = {"name": item}
        if not isinstance(item, dict):
            raise GatewayError("each lora must be a string or object", 400)
        name = str(item.get("name") or "").strip()
        if not name:
            raise GatewayError("lora name is required", 400)
        strength_model = float(item.get("strength_model", item.get("strength", 0.7)))
        strength_clip = float(item.get("strength_clip", item.get("strength", strength_model)))
        trigger_word = str(item.get("trigger_word", item.get("trigger", "")) or "").strip()
        normalized.append(
            {
                "name": name,
                "strength_model": strength_model,
                "strength_clip": strength_clip,
                "trigger_word": trigger_word,
            }
        )
    return normalized


def unique_texts(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        text = re.sub(r"\s+", " ", str(item).strip())
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


def resolve_lora_file(name: str) -> Path:
    normalized = urllib.parse.unquote(name).replace("\\", "/").strip("/")
    if not normalized:
        raise GatewayError("Missing LoRA name", 400)
    candidate = (LORA_DIR / normalized).resolve()
    root = LORA_DIR.resolve()
    if root != candidate and root not in candidate.parents:
        raise GatewayError("LoRA path escapes models/loras", 400)
    if candidate.is_file():
        return candidate
    raise GatewayError("LoRA not found", 404, {"name": name})


def load_lora_sidecar_metadata(lora_path: Path) -> dict[str, Any]:
    candidates = [
        lora_path.with_suffix(".metadata.json"),
        lora_path.with_name(f"{lora_path.stem}.metadata.json"),
    ]
    for path in candidates:
        if path.is_file():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise GatewayError("Cannot read LoRA metadata sidecar", 500, {"path": str(path), "error": str(exc)}) from exc
    return {}


def load_safetensors_metadata(lora_path: Path) -> dict[str, Any]:
    if lora_path.suffix.lower() != ".safetensors":
        return {}
    try:
        with lora_path.open("rb") as handle:
            header_len = int.from_bytes(handle.read(8), "little")
            if header_len <= 0 or header_len > 64 * 1024 * 1024:
                return {}
            header = json.loads(handle.read(header_len).decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    metadata = header.get("__metadata__") if isinstance(header, dict) else None
    return metadata if isinstance(metadata, dict) else {}


def collect_lora_trigger_values(value: Any, key: str = "") -> list[str]:
    key_lower = key.lower()
    trigger_keys = {
        "trainedwords",
        "trained_words",
        "trigger_words",
        "triggerwords",
        "activation_text",
        "activation text",
        "activation_tags",
        "activation tags",
    }
    is_trigger_key = key_lower in trigger_keys or "trigger" in key_lower or "trainedword" in key_lower
    if isinstance(value, str):
        if is_trigger_key:
            return [value]
        parsed = maybe_json(value)
        return collect_lora_trigger_values(parsed, key) if parsed is not None else []
    if isinstance(value, list):
        if is_trigger_key:
            return [str(item) for item in value if isinstance(item, (str, int, float))]
        return [text for item in value for text in collect_lora_trigger_values(item, key)]
    if isinstance(value, dict):
        result: list[str] = []
        for child_key, child in value.items():
            result.extend(collect_lora_trigger_values(child, str(child_key)))
        return result
    return []


def values_as_texts(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [str(item) for item in value if isinstance(item, (str, int, float))]
    return []


def sidecar_lora_triggers(metadata: dict[str, Any]) -> list[str]:
    triggers: list[str] = []
    for key in ("trainedWords", "trained_words", "trigger_words", "triggerWords", "activation_text", "activation_tags"):
        triggers.extend(values_as_texts(metadata.get(key)))
    civitai = metadata.get("civitai")
    if isinstance(civitai, dict):
        for key in ("trainedWords", "trained_words", "trigger_words", "triggerWords"):
            triggers.extend(values_as_texts(civitai.get(key)))
    usage_tips = metadata.get("usage_tips")
    if isinstance(usage_tips, str):
        parsed = maybe_json(usage_tips)
        if isinstance(parsed, dict):
            for key in ("trigger_words", "triggerWords", "activation_text", "prompt"):
                triggers.extend(values_as_texts(parsed.get(key)))
    elif isinstance(usage_tips, dict):
        for key in ("trigger_words", "triggerWords", "activation_text", "prompt"):
            triggers.extend(values_as_texts(usage_tips.get(key)))
    return triggers


def is_image_reference(value: str) -> bool:
    path = urllib.parse.urlparse(value).path if value.startswith(("http://", "https://")) else value
    return Path(path).suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}


def is_remote_image_url(value: str, image_type: str = "") -> bool:
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return False
    return image_type.lower() == "image" or is_image_reference(value)


def lora_local_preview_path(lora_path: Path, metadata: dict[str, Any]) -> Path | None:
    preview = str(metadata.get("preview_url") or "").strip()
    candidates: list[Path] = []
    if preview and not preview.startswith(("http://", "https://")):
        preview_path = Path(preview)
        if preview_path.is_absolute():
            candidates.append(preview_path)
        else:
            candidates.extend((lora_path.parent / preview_path, LORA_DIR / preview_path))
    for suffix in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        candidates.append(lora_path.with_suffix(suffix))

    root = LORA_DIR.resolve()
    for candidate in candidates:
        path = candidate if candidate.is_absolute() else LORA_DIR / candidate
        resolved = path.resolve()
        if root != resolved and root not in resolved.parents:
            continue
        if resolved.is_file() and is_image_reference(str(resolved)):
            return resolved
    return None


def lora_preview_image_url(name: str, lora_path: Path, metadata: dict[str, Any]) -> str:
    local_preview = lora_local_preview_path(lora_path, metadata)
    if local_preview:
        return f"/lora-preview?name={urllib.parse.quote(name)}"

    civitai = metadata.get("civitai")
    if isinstance(civitai, dict):
        images = civitai.get("images")
        if isinstance(images, list):
            for image in images:
                if not isinstance(image, dict):
                    continue
                url = str(image.get("url") or "").strip()
                image_type = str(image.get("type") or "").lower()
                if is_remote_image_url(url, image_type):
                    return url
    return ""


def lora_info_payload(name: str) -> dict[str, Any]:
    lora_path = resolve_lora_file(name)
    sidecar = load_lora_sidecar_metadata(lora_path)
    safetensors_metadata = load_safetensors_metadata(lora_path)
    sidecar_triggers = sidecar_lora_triggers(sidecar)
    safetensors_triggers = collect_lora_trigger_values(safetensors_metadata)
    triggers = unique_texts(sidecar_triggers + safetensors_triggers)
    source = "sidecar" if sidecar_triggers else "safetensors" if safetensors_triggers else "none"
    return {
        "ok": True,
        "name": name,
        "path": str(lora_path),
        "source": source,
        "triggers": triggers,
        "prompt": triggers[0] if triggers else "",
        "preview_image_url": lora_preview_image_url(name, lora_path, sidecar),
        "metadata_keys": sorted(set(sidecar.keys()) | set(safetensors_metadata.keys())),
    }


def lora_preview_path(name: str) -> Path:
    lora_path = resolve_lora_file(name)
    sidecar = load_lora_sidecar_metadata(lora_path)
    preview_path = lora_local_preview_path(lora_path, sidecar)
    if not preview_path:
        raise GatewayError("LoRA image preview not found", 404, {"name": name})
    return preview_path


def generation_model_key(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return "gembyte_emerald"
    normalized = raw.replace("-", "_").replace(" ", "_")
    if normalized in MOSS_DMD_ALIASES:
        return "moss_image_sft"
    for key, spec in GENERATION_MODELS.items():
        names = {key.lower(), *(str(alias).lower().replace("-", "_").replace(" ", "_") for alias in spec.get("aliases", []))}
        if normalized in names:
            return key
    raise GatewayError("Unknown generation model", 400, {"model": raw, "available": list(GENERATION_MODELS.keys())})


def resolve_generation_model(request: dict[str, Any], preset: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    if request.get("checkpoint"):
        checkpoint = str(request["checkpoint"])
        return (
            "custom_checkpoint",
            {
                "label": checkpoint,
                "kind": "checkpoint",
                "checkpoint": checkpoint,
                "description": "Custom checkpoint override supplied in the request.",
            },
        )
    if request.get("unet") or request.get("diffusion_model"):
        unet = str(request.get("unet") or request.get("diffusion_model"))
        clip = str(request.get("clip") or request.get("text_encoder") or "miaomiaoHarem_anima12_txt.safetensors")
        vae = str(request.get("vae") or "qwen_image_vae.safetensors")
        return (
            "custom_modular",
            {
                "label": unet,
                "kind": "modular",
                "unet": unet,
                "weight_dtype": str(request.get("weight_dtype") or "default"),
                "clip": clip,
                "clip_type": str(request.get("clip_type") or "qwen_image"),
                "clip_device": str(request.get("clip_device") or "default"),
                "vae": vae,
                "description": "Custom modular loader override supplied in the request.",
            },
        )
    key = generation_model_key(request.get("model", request.get("base_model", preset.get("model", "gembyte_emerald"))))
    spec = copy.deepcopy(GENERATION_MODELS[key])
    requested = str(request.get("model", request.get("base_model", ""))).lower().replace("-", "_").replace(" ", "_")
    if requested in MOSS_DMD_ALIASES:
        spec.update(default_width=1024, default_height=1024, legacy_dmd=True)
    return key, spec


def model_loader_workflow(spec: dict[str, Any]) -> tuple[dict[str, Any], list[Any], list[Any], list[Any]]:
    kind = str(spec.get("kind") or "checkpoint")
    if kind == "checkpoint":
        workflow = {
            "4": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": str(spec["checkpoint"])},
            }
        }
        return workflow, ["4", 0], ["4", 1], ["4", 2]
    if kind == "modular":
        workflow = {
            "4": {
                "class_type": "UNETLoader",
                "inputs": {
                    "unet_name": str(spec["unet"]),
                    "weight_dtype": str(spec.get("weight_dtype") or "default"),
                },
            },
            "45": {
                "class_type": "CLIPLoader",
                "inputs": {
                    "clip_name": str(spec["clip"]),
                    "type": str(spec.get("clip_type") or "qwen_image"),
                    "device": str(spec.get("clip_device") or "default"),
                },
            },
            "46": {
                "class_type": "VAELoader",
                "inputs": {"vae_name": str(spec["vae"])},
            },
        }
        return workflow, ["4", 0], ["45", 0], ["46", 0]
    raise GatewayError("Unsupported generation model kind", 400, spec)


def resolve_krea2_hires_stage_count(request: dict[str, Any]) -> int:
    raw_mode = str(request.get("upscale_mode") or "").strip().lower()
    if raw_mode in {"krea2_hires", "latent_hires", "hires"}:
        stages = 1
    elif raw_mode in {"two_stage", "two-step", "two_step", "double", "staged"}:
        stages = 2
    else:
        raise GatewayError(
            "Krea2 hires models require at least one explicit upscale stage",
            400,
            {
                "upscale_mode": raw_mode,
                "supported": ["krea2_hires", "two_stage"],
                "min_stages": 1,
                "max_stages": 2,
            },
        )

    stage_field = "upscale_stages" if "upscale_stages" in request else "upscale_stage_count" if "upscale_stage_count" in request else ""
    if stage_field:
        explicit_stages = strict_int_field(request, stage_field, stages, 1, 2)
        if explicit_stages != stages:
            raise GatewayError(
                "Krea2 upscale stage count conflicts with upscale_mode",
                400,
                {"upscale_mode": raw_mode, stage_field: explicit_stages, "expected_stages": stages},
            )

    usd_fields = KREA2_THIRD_FIELDS | {"second_stage_upscale_scale", "second_stage_upscale_model"}
    if stages == 1 and request_has_any(request, usd_fields):
        fields = sorted(field for field in usd_fields if field in request and request.get(field) is not None)
        raise GatewayError("Krea2 one-stage mode cannot include UltimateSDUpscale fields", 400, {"fields": fields})
    if request.get("upscale_model") or request.get("stage_upscale_model"):
        raise GatewayError(
            "Krea2 latent hires stage does not accept a pixel upscale model",
            400,
            {"fields": [field for field in ("upscale_model", "stage_upscale_model") if request.get(field)]},
        )
    return stages


def krea2_hires_scale(request: dict[str, Any], primary: str, alias: str, default: float) -> float:
    has_primary = primary in request and request.get(primary) is not None
    has_alias = alias in request and request.get(alias) is not None
    if has_primary and has_alias:
        primary_value = strict_float_field(request, primary, default, 1.0, 4.0)
        alias_value = strict_float_field(request, alias, default, 1.0, 4.0)
        if primary_value != alias_value:
            raise GatewayError("Conflicting Krea2 hires scale fields", 400, {primary: primary_value, alias: alias_value})
        return primary_value
    field = primary if has_primary else alias if has_alias else primary
    return strict_float_field(request, field, default, 1.0, 4.0)


def build_krea2_hires_workflow(
    request: dict[str, Any],
    model_spec: dict[str, Any],
    positive: str,
    loras: list[dict[str, Any]],
) -> dict[str, Any]:
    stages = resolve_krea2_hires_stage_count(request)
    width = align8(strict_int_field(request, "width", int(model_spec.get("default_width", 720)), 64, 2048))
    height = align8(strict_int_field(request, "height", int(model_spec.get("default_height", 1280)), 64, 2048))
    seed_default = int(time.time() * 1000) % (2**32)
    seed = strict_int_field(request, "seed", seed_default, 0, 2**64 - 1)
    steps = strict_int_field(request, "steps", int(model_spec.get("steps", 7)), 1, 999)
    cfg = strict_float_field(request, "cfg", float(model_spec.get("cfg", 1.0)), 0.0, 100.0)
    sampler_name = strict_choice_field(request, "sampler_name", str(model_spec.get("sampler_name") or "euler"), KREA2_SAMPLERS)
    scheduler = strict_choice_field(request, "scheduler", str(model_spec.get("scheduler") or "simple"), KREA2_SCHEDULERS)

    latent_scale = krea2_hires_scale(request, "upscale_scale", "stage_upscale_scale", 1.5)
    second_seed = strict_int_field(request, "second_seed", seed, 0, 2**64 - 1)
    second_steps = strict_int_field(request, "second_steps", 10, 1, 999)
    second_cfg = strict_float_field(request, "second_cfg", 1.0, 0.0, 100.0)
    second_denoise = strict_float_field(request, "second_denoise", 0.4, 0.0, 1.0)
    second_sampler_name = strict_choice_field(request, "second_sampler_name", "euler", KREA2_SAMPLERS)
    second_scheduler = strict_choice_field(request, "second_scheduler", "simple", KREA2_SCHEDULERS)
    second_start_at_step = round(second_steps * (1.0 - second_denoise))

    third_scale = 1.5
    third_seed = second_seed
    third_steps = 3
    third_cfg = 1.0
    third_denoise = 0.12
    third_sampler_name = "euler"
    third_scheduler = "simple"
    usd_model = "OmniSR_X4_DIV2K.safetensors"
    if stages == 2:
        third_scale = strict_float_field(request, "second_stage_upscale_scale", 1.5, 1.0, 4.0)
        third_seed = strict_int_field(request, "third_seed", second_seed, 0, 2**64 - 1)
        third_steps = strict_int_field(request, "third_steps", 3, 1, 10000)
        third_cfg = strict_float_field(request, "third_cfg", 1.0, 0.0, 100.0)
        third_denoise = strict_float_field(request, "third_denoise", 0.12, 0.0, 1.0)
        third_sampler_name = strict_choice_field(request, "third_sampler_name", "euler", KREA2_SAMPLERS)
        third_scheduler = strict_choice_field(request, "third_scheduler", "simple", KREA2_SCHEDULERS)
        usd_model = str(request.get("second_stage_upscale_model") or "OmniSR_X4_DIV2K.safetensors").strip()
        if not usd_model:
            raise GatewayError("second_stage_upscale_model cannot be empty", 400)

    prompt_parts: list[str] = []
    if request.get("prefix") is not None:
        prefix = str(request.get("prefix") or "").strip()
        if prefix:
            prompt_parts.append(prefix)
    prompt_parts.append(positive)
    trigger_words = unique_texts(
        [str(request.get("lora_trigger_word") or request.get("trigger_word") or "").strip()]
        + [str(lora.get("trigger_word") or "").strip() for lora in loras]
    )
    if trigger_words:
        prompt_parts.append(", ".join(trigger_words))
    prompt_text = ", ".join(unique_texts(prompt_parts))
    filename_prefix = safe_filename_prefix(request.get("filename_prefix") or "Krea2_hires")

    loader_workflow, model_ref, clip_ref, vae_ref = model_loader_workflow(model_spec)
    workflow: dict[str, Any] = {
        **loader_workflow,
        "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": clip_ref, "text": prompt_text}},
        "13": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["6", 0]}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "3": {
            "class_type": "KSamplerAdvanced",
            "inputs": {
                "model": model_ref, "add_noise": "enable", "noise_seed": seed, "steps": steps, "cfg": cfg,
                "sampler_name": sampler_name, "scheduler": scheduler, "positive": ["6", 0], "negative": ["13", 0],
                "latent_image": ["5", 0], "start_at_step": 0, "end_at_step": steps,
                "return_with_leftover_noise": "enable",
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": vae_ref}},
        "14": {"class_type": "LatentUpscaleBy", "inputs": {"samples": ["3", 0], "upscale_method": "bislerp", "scale_by": latent_scale}},
        "15": {
            "class_type": "KSamplerAdvanced",
            "inputs": {
                "model": model_ref, "add_noise": "enable", "noise_seed": second_seed, "steps": second_steps,
                "cfg": second_cfg, "sampler_name": second_sampler_name, "scheduler": second_scheduler,
                "positive": ["6", 0], "negative": ["13", 0], "latent_image": ["14", 0],
                "start_at_step": second_start_at_step, "end_at_step": 999,
                "return_with_leftover_noise": "disable",
            },
        },
        "16": {"class_type": "VAEDecode", "inputs": {"samples": ["15", 0], "vae": vae_ref}},
        "18": {
            "class_type": "ColorMatchV2",
            "inputs": {"image_target": ["16", 0], "image_ref": ["8", 0], "method": "mkl", "strength": 0.5, "multithread": True},
        },
        "30": {"class_type": "LayerUtility: PurgeVRAM V2", "inputs": {"anything": ["18", 0], "purge_cache": True, "purge_models": True}},
        "17": {"class_type": "SaveImage", "inputs": {"images": ["30", 0], "filename_prefix": filename_prefix}},
    }

    if stages == 2:
        workflow.update(
            {
                "60": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": usd_model}},
                "61": {"class_type": "GetImageSize+", "inputs": {"image": ["18", 0]}},
                "62": {"class_type": "PrimitiveFloat", "inputs": {"value": 2.0}},
                "63": {"class_type": "PrimitiveFloat", "inputs": {"value": third_scale}},
                "64": {
                    "class_type": "SimpleMathDual+",
                    "inputs": {"value_1": "a*c/d", "value_2": "b*c/d", "a": ["61", 0], "b": ["61", 1], "c": ["63", 0], "d": ["62", 0]},
                },
                "65": {
                    "class_type": "UltimateSDUpscale",
                    "inputs": {
                        "image": ["18", 0], "model": model_ref, "positive": ["6", 0], "negative": ["13", 0], "vae": vae_ref,
                        "upscale_by": ["63", 0], "seed": third_seed, "steps": third_steps, "cfg": third_cfg,
                        "sampler_name": third_sampler_name, "scheduler": third_scheduler, "denoise": third_denoise,
                        "upscale_model": ["60", 0], "mode_type": "Linear", "tile_width": ["64", 0], "tile_height": ["64", 2],
                        "mask_blur": 16, "tile_padding": 64, "seam_fix_mode": "None", "seam_fix_denoise": 1.0,
                        "seam_fix_width": 64, "seam_fix_mask_blur": 8, "seam_fix_padding": 16,
                        "force_uniform_tiles": True, "tiled_decode": False,
                    },
                },
                "66": {
                    "class_type": "ColorMatchV2",
                    "inputs": {"image_target": ["65", 0], "image_ref": ["8", 0], "method": "mkl", "strength": 0.7, "multithread": True},
                },
            }
        )
        workflow["30"]["inputs"]["anything"] = ["66", 0]

    for index, lora in enumerate(loras):
        node_id = str(100 + index)
        workflow[node_id] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {"model": model_ref, "lora_name": lora["name"], "strength_model": lora["strength_model"]},
        }
        model_ref = [node_id, 0]
    workflow["3"]["inputs"]["model"] = model_ref
    workflow["15"]["inputs"]["model"] = model_ref
    if "65" in workflow:
        workflow["65"]["inputs"]["model"] = model_ref
    return workflow

def build_krea2_turbo_workflow(
    request: dict[str, Any],
    model_spec: dict[str, Any],
    positive: str,
    loras: list[dict[str, Any]],
) -> dict[str, Any]:
    width = align8(clamp_int(request.get("width"), int(model_spec.get("default_width", 1024)), 64, 2048))
    height = align8(clamp_int(request.get("height"), int(model_spec.get("default_height", 1024)), 64, 2048))
    seed_default = int(time.time() * 1000) % (2**32)
    seed = strict_int_field(request, "seed", seed_default, 0, 2**64 - 1)
    steps = strict_int_field(request, "steps", int(model_spec.get("steps", 8)), 1, 10000)
    cfg = strict_float_field(request, "cfg", float(model_spec.get("cfg", 1.0)), 0.0, 100.0)
    denoise = strict_float_field(request, "denoise", 1.0, 0.0, 1.0)
    sampler_name = strict_choice_field(
        request, "sampler_name", str(model_spec.get("sampler_name") or "euler"), KREA2_SAMPLERS
    )
    scheduler = strict_choice_field(
        request, "scheduler", str(model_spec.get("scheduler") or "simple"), KREA2_SCHEDULERS
    )
    upscale_plan = resolve_krea2_upscale_plan(request)
    filename_prefix = safe_filename_prefix(request.get("filename_prefix") or "Krea2_turbo")

    second_seed = seed
    second_steps = 4
    second_cfg = cfg
    second_denoise = 0.2
    second_sampler_name = sampler_name
    second_scheduler = scheduler
    if upscale_plan["mode"] in {"denoise", "two_stage"}:
        second_seed = strict_int_field(request, "second_seed", seed, 0, 2**64 - 1)
        second_steps = strict_int_field(request, "second_steps", 4, 1, 10000)
        second_cfg = strict_float_field(request, "second_cfg", cfg, 0.0, 100.0)
        second_denoise = strict_float_field(request, "second_denoise", 0.2, 0.0, 1.0)
        second_sampler_name = strict_choice_field(request, "second_sampler_name", sampler_name, KREA2_SAMPLERS)
        second_scheduler = strict_choice_field(request, "second_scheduler", scheduler, KREA2_SCHEDULERS)

    third_seed = second_seed
    third_steps = second_steps
    third_cfg = second_cfg
    third_denoise = 0.12
    third_sampler_name = second_sampler_name
    third_scheduler = second_scheduler
    if upscale_plan["mode"] == "two_stage":
        third_seed = strict_int_field(request, "third_seed", second_seed, 0, 2**64 - 1)
        third_steps = strict_int_field(request, "third_steps", second_steps, 1, 10000)
        third_cfg = strict_float_field(request, "third_cfg", second_cfg, 0.0, 100.0)
        third_denoise = strict_float_field(request, "third_denoise", 0.12, 0.0, 1.0)
        third_sampler_name = strict_choice_field(request, "third_sampler_name", second_sampler_name, KREA2_SAMPLERS)
        third_scheduler = strict_choice_field(request, "third_scheduler", second_scheduler, KREA2_SCHEDULERS)

    prompt_parts: list[str] = []
    if request.get("prefix") is not None:
        prefix = str(request.get("prefix") or "").strip()
        if prefix:
            prompt_parts.append(prefix)
    prompt_parts.append(positive)

    trigger_words: list[str] = []
    explicit_trigger = str(request.get("lora_trigger_word") or request.get("trigger_word") or "").strip()
    if explicit_trigger:
        trigger_words.append(explicit_trigger)
    for lora in loras:
        trigger_word = str(lora.get("trigger_word") or "").strip()
        if trigger_word:
            trigger_words.append(trigger_word)
    trigger_words = unique_texts(trigger_words)
    if trigger_words:
        prompt_parts.append(", ".join(trigger_words))
    prompt_text = ", ".join(unique_texts(prompt_parts))

    loader_workflow, model_ref, clip_ref, vae_ref = model_loader_workflow(model_spec)
    workflow: dict[str, Any] = {
        **loader_workflow,
        "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": clip_ref, "text": prompt_text}},
        "13": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["6", 0]}},
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        },
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "model": model_ref,
                "positive": ["6", 0],
                "negative": ["13", 0],
                "latent_image": ["5", 0],
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler_name,
                "scheduler": scheduler,
                "denoise": denoise,
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": vae_ref}},
        "30": {
            "class_type": "LayerUtility: PurgeVRAM V2",
            "inputs": {"anything": ["8", 0], "purge_cache": True, "purge_models": True},
        },
        "17": {"class_type": "SaveImage", "inputs": {"images": ["30", 0], "filename_prefix": filename_prefix}},
    }

    if upscale_plan["models"]:
        workflow.update(
            {
                "11": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": upscale_plan["models"][0]}},
                "10": {
                    "class_type": "ImageUpscaleWithModel",
                    "inputs": {"upscale_model": ["11", 0], "image": ["8", 0]},
                },
            }
        )
        workflow["30"]["inputs"]["anything"] = ["10", 0]

    if upscale_plan["mode"] in {"denoise", "two_stage"}:
        workflow.update(
            {
                "14": {"class_type": "VAEEncode", "inputs": {"pixels": ["10", 0], "vae": vae_ref}},
                "15": {
                    "class_type": "KSampler",
                    "inputs": {
                        "model": model_ref,
                        "positive": ["6", 0],
                        "negative": ["13", 0],
                        "latent_image": ["14", 0],
                        "seed": second_seed,
                        "steps": second_steps,
                        "cfg": second_cfg,
                        "sampler_name": second_sampler_name,
                        "scheduler": second_scheduler,
                        "denoise": second_denoise,
                    },
                },
                "16": {"class_type": "VAEDecode", "inputs": {"samples": ["15", 0], "vae": vae_ref}},
            }
        )
        workflow["30"]["inputs"]["anything"] = ["16", 0]

    if upscale_plan["mode"] == "two_stage":
        workflow.update(
            {
                "40": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": upscale_plan["models"][1]}},
                "41": {
                    "class_type": "ImageUpscaleWithModel",
                    "inputs": {"upscale_model": ["40", 0], "image": ["16", 0]},
                },
                "42": {"class_type": "VAEEncode", "inputs": {"pixels": ["41", 0], "vae": vae_ref}},
                "43": {
                    "class_type": "KSampler",
                    "inputs": {
                        "model": model_ref,
                        "positive": ["6", 0],
                        "negative": ["13", 0],
                        "latent_image": ["42", 0],
                        "seed": third_seed,
                        "steps": third_steps,
                        "cfg": third_cfg,
                        "sampler_name": third_sampler_name,
                        "scheduler": third_scheduler,
                        "denoise": third_denoise,
                    },
                },
                "44": {"class_type": "VAEDecode", "inputs": {"samples": ["43", 0], "vae": vae_ref}},
            }
        )
        workflow["30"]["inputs"]["anything"] = ["44", 0]

    for index, lora in enumerate(loras):
        node_id = str(100 + index)
        workflow[node_id] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": model_ref,
                "lora_name": lora["name"],
                "strength_model": lora["strength_model"],
            },
        }
        model_ref = [node_id, 0]

    for sampler_id in ("3", "15", "43"):
        if sampler_id in workflow:
            workflow[sampler_id]["inputs"]["model"] = model_ref
    return workflow


def build_moss_workflow(request, model_spec, positive, loras):
    dmd = request.get("moss_dmd", model_spec.get("legacy_dmd", False))
    face = request.get("face_detail", False)
    diagnostic = request.get("face_diagnostic_export", False)
    if type(diagnostic) is not bool or (diagnostic and not face):
        raise GatewayError("face_diagnostic_export requires face_detail=true and a boolean value", 400)
    if type(dmd) is not bool or type(face) is not bool:
        raise GatewayError("moss_dmd and face_detail must be booleans", 400)
    method = str(request.get("upscale_method", "none")).strip().lower()
    if method not in {"none", "omnisr", "seedvr2"}:
        raise GatewayError("MOSS upscale_method must be none, omnisr or seedvr2", 400)
    if any(k.startswith(("second_", "third_")) for k in request) or "upscale_mode" in request:
        raise GatewayError("MOSS uses upscale_method, not multi-stage sampler fields", 400)
    if "upscale_scale" in request and method != "omnisr":
        raise GatewayError("upscale_scale is only supported with MOSS omnisr", 400)
    width = strict_int_field(request, "width", model_spec["default_width"], 64, 4096)
    height = strict_int_field(request, "height", model_spec["default_height"], 64, 4096)
    if width % 16 or height % 16:
        raise GatewayError("MOSS width/height must be multiples of 16", 400)
    seed = strict_int_field(request, "seed", int(time.time() * 1000) % 2**32, 0, 2**64-1)
    workflow, model, clip, vae = model_loader_workflow(model_spec)
    base_model = model
    acceleration = MOSS_LEGACY_DMD["acceleration_lora"]
    if any(lora["name"].replace("/", "\\").casefold() == acceleration.casefold() for lora in loras):
        raise GatewayError("Use moss_dmd for acceleration, not an explicit DMD LoRA", 400)
    for index, lora in enumerate(loras):
        nid = str(100 + index)
        workflow[nid] = {"class_type": "LoraLoader", "inputs": {
            "model": model, "clip": clip, "lora_name": lora["name"],
            "strength_model": lora["strength_model"], "strength_clip": lora["strength_clip"]}}
        model, clip = [nid, 0], [nid, 1]
    face_model = model
    if dmd:
        workflow["90"] = {"class_type": "LoraLoaderModelOnly", "inputs": {
            "model": base_model, "lora_name": acceleration, "strength_model": 1.0}}
        model = ["90", 0]
        # DMD must precede ordinary patches on the main MODEL; face_model stays independent.
        for index, lora in enumerate(loras):
            nid = f"moss_main_lora_{index}"
            workflow[nid] = {"class_type": "LoraLoaderModelOnly", "inputs": {
                "model": model, "lora_name": lora["name"], "strength_model": lora["strength_model"]}}
            model = [nid, 0]
    workflow.update({
        "21": {"class_type": "PixaromaLayoutBoxes", "inputs": {"width": width, "height": height}},
        "20": {"class_type": "MOSSImageLayoutPrompt", "inputs": {
            "prompt": positive, "element": ["21", 0], "width": width, "height": height, "character_boxes": ""}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": clip, "text": ["20", 0]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"clip": clip, "text": str(request.get(
            "negative", "pale tones, blurry, flat colors, poor anatomy, dull lighting, text, watermark, messy composition, low contrast, pixelated, score_3, score_2, score_1,"))}},
        "5": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "3": {"class_type": "KSampler", "inputs": {
            "model": model, "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0],
            "seed": seed, "steps": strict_int_field(request, "steps", 8 if dmd else 30, 1, 100),
            "cfg": strict_float_field(request, "cfg", 3.0, 0, 100),
            "sampler_name": strict_choice_field(request, "sampler_name", "euler", KREA2_SAMPLERS),
            "scheduler": strict_choice_field(request, "scheduler", "simple", KREA2_SCHEDULERS), "denoise": 1.0}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": vae}},
    })
    output = ["8", 0]
    if face:
        workflow["70"] = {"class_type": "UltralyticsDetectorProvider", "inputs": {"model_name": "bbox/face_yolov8m.pt"}}
        workflow["71"] = {"class_type": "BboxDetectorSEGS", "inputs": {
            "bbox_detector": ["70", 0], "image": output, "threshold": 0.5,
            "dilation": 10, "crop_factor": strict_float_field(request, "face_crop_factor", 1.5, 1.0, 10.0), "drop_size": 10, "labels": "all"}}
        workflow["72"] = {"class_type": "GatewayMeasuredDetailer", "inputs": {
            "diagnostic_export": diagnostic,
            "image": output, "segs": ["71", 0], "model": face_model, "clip": clip, "vae": vae,
            "positive": ["6", 0], "negative": ["7", 0],
            "guide_size": strict_int_field(request, "face_guide_size", 1024, 64, 4096),
            "guide_size_for": True, "max_size": strict_int_field(request, "face_max_size", 2048, 64, 4096),
            "seed": strict_int_field(request, "face_seed", seed, 0, 2**64-1),
            "steps": strict_int_field(request, "face_steps", 30, 1, 100),
            "cfg": strict_float_field(request, "face_cfg", 3.0, 0, 100),
            "denoise": strict_float_field(request, "face_denoise", 0.8, 0.0001, 1),
            "noise_mask_feather": strict_int_field(request, "face_noise_mask_feather", 20, 0, 100),
            "sampler_name": strict_choice_field(request, "face_sampler_name", "euler", KREA2_SAMPLERS),
            "scheduler": strict_choice_field(request, "face_scheduler", "normal", KREA2_SCHEDULERS),
            "feather": 5, "noise_mask": True, "force_inpaint": True, "wildcard": "", "cycle": 1}}
        if workflow["72"]["inputs"]["guide_size"] > workflow["72"]["inputs"]["max_size"]:
            raise GatewayError("face_guide_size must not exceed face_max_size", 400)
        workflow["73"] = {"class_type": "ImpactCount_Elts_in_SEGS", "inputs": {"segs": ["71", 0]}}
        workflow["74"] = {"class_type": "PreviewAny", "inputs": {"source": ["73", 0]}}
        output = ["72", 0]
    if method == "omnisr":
        scale = strict_int_field(request, "upscale_scale", 2, 2, 4)
        workflow["11"] = {"class_type": "UpscaleModelLoader", "inputs": {"model_name": UPSCALE_MODELS[scale]}}
        workflow["10"] = {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["11", 0], "image": output}}
        output = ["10", 0]
    elif method == "seedvr2":
        resolution = strict_int_field(request, "seedvr2_resolution", 2560, 16, 16384)
        max_resolution = strict_int_field(request, "seedvr2_max_resolution", 2560, 0, 16384)
        if resolution % 2 or max_resolution % 2:
            raise GatewayError("SeedVR2 resolutions must be even", 400)
        workflow["49"] = {"class_type": "LayerUtility: PurgeVRAM V2", "inputs": {
            "anything": output, "purge_cache": True, "purge_models": True}}
        workflow["51"] = {"class_type": "SeedVR2LoadVAEModel", "inputs": {
            "model": "ema_vae_fp16.safetensors", "device": "cuda:0",
            "encode_tiled": True, "encode_tile_size": 1024, "encode_tile_overlap": 128,
            "decode_tiled": True, "decode_tile_size": 1024, "decode_tile_overlap": 128,
            "tile_debug": "false", "offload_device": "cpu", "cache_model": False}}
        workflow["56"] = {"class_type": "SeedVR2LoadDiTModel", "inputs": {
            "model": "seedvr2_ema_7b_sharp_fp16.safetensors", "device": "cuda:0",
            "blocks_to_swap": 36, "swap_io_components": False,
            "offload_device": "cpu", "cache_model": False, "attention_mode": "sdpa"}}
        workflow["50"] = {"class_type": "SeedVR2VideoUpscaler", "inputs": {
            "image": ["49", 0], "dit": ["56", 0], "vae": ["51", 0],
            "seed": strict_int_field(request, "upscale_seed", seed % 2**32, 0, 2**32-1),
            "resolution": resolution, "max_resolution": max_resolution,
            "batch_size": 1, "uniform_batch_size": False, "color_correction": "lab",
            "temporal_overlap": 0, "prepend_frames": 0, "input_noise_scale": 0.0,
            "latent_noise_scale": 0.0, "offload_device": "cpu", "enable_debug": False}}
        output = ["50", 0]
    workflow["17"] = {"class_type": "SaveImage", "inputs": {
        "images": output, "filename_prefix": safe_filename_prefix(request.get("filename_prefix") or "agent_moss")}}
    return workflow


def attach_model_face_detail(workflow, request, spec):
    enabled = request.get("face_detail", False)
    diagnostic = request.get("face_diagnostic_export", False)
    if type(enabled) is not bool or type(diagnostic) is not bool or (diagnostic and not enabled):
        raise GatewayError("face_detail/face_diagnostic_export must be booleans; diagnostics require face_detail", 400)
    if not enabled:
        return workflow
    if "face_detail" not in spec.get("options", {}):
        raise GatewayError("This model does not support face_detail", 400)
    krea = spec.get("pipeline") == "krea2_hires"
    image = ["18", 0] if krea else workflow["30"]["inputs"]["anything"]
    primary = workflow["3"]["inputs"]
    # Reuse the existing validated face graph builder, then bind the actual model's refs.
    face_request = {k: v for k, v in request.items() if k.startswith("face_")}
    face_request.update(seed=primary.get("seed", primary.get("noise_seed")),
                        face_denoise=request.get("face_denoise", 0.2),
                        face_cfg=request.get("face_cfg", 1.0 if krea else 3.0))
    face_graph = build_moss_workflow(face_request, GENERATION_MODELS["moss_image_sft"], "unused", [])
    for nid in ("70", "71", "72", "73", "74"):
        workflow[nid] = face_graph[nid]
    workflow["71"]["inputs"]["image"] = image
    workflow["72"]["inputs"].update(image=image, model=primary["model"],
        clip=workflow["6"]["inputs"]["clip"], vae=workflow["8"]["inputs"]["vae"],
        positive=primary["positive"], negative=primary["negative"])
    if krea and "65" in workflow:
        workflow["65"]["inputs"]["image"] = ["72", 0]
        workflow["61"]["inputs"]["image"] = ["72", 0]
    else:
        workflow["30"]["inputs"]["anything"] = ["72", 0]
    return workflow


def build_anime_manga_workflow(request: dict[str, Any]) -> dict[str, Any]:
    preset_name = str(request.get("preset") or "anime_manga")
    preset = PRESETS.get(preset_name)
    if preset is None:
        raise GatewayError(f"Unknown preset: {preset_name}", 400)

    positive = str(request.get("prompt") or "").strip()
    if not positive:
        raise GatewayError("Missing prompt", 400)

    prefix = str(request.get("prefix") or DEFAULT_POSITIVE_PREFIX)
    negative = str(request.get("negative") or DEFAULT_NEGATIVE)
    model_key, model_spec = resolve_generation_model(request, preset)
    loras = normalize_loras(request)
    if model_spec.get("pipeline") == "moss_image_t2i":
        return build_moss_workflow(request, model_spec, positive, loras)
    if str(model_spec.get("pipeline") or "") == "krea2_hires":
        return attach_model_face_detail(build_krea2_hires_workflow(request, model_spec, positive, loras), request, model_spec)
    if str(model_spec.get("pipeline") or "") == "krea2_turbo":
        return build_krea2_turbo_workflow(request, model_spec, positive, loras)

    two_stage_upscale = use_two_stage_upscale(request)
    upscale_model = resolve_stage_upscale_model(request) if two_stage_upscale else resolve_upscale_model(request, preset)
    second_stage_upscale_model = resolve_second_stage_upscale_model(request) if two_stage_upscale else ""
    width = align8(clamp_int(request.get("width"), preset["width"], 64, 2048))
    height = align8(clamp_int(request.get("height"), preset["height"], 64, 2048))
    seed = clamp_int(request.get("seed"), int(time.time() * 1000) % (2**32), 0, 2**63 - 1)
    second_seed = clamp_int(request.get("second_seed"), seed, 0, 2**63 - 1)
    third_seed = clamp_int(request.get("third_seed"), second_seed, 0, 2**63 - 1)
    steps = clamp_int(request.get("steps"), preset["steps"], 1, 100)
    second_steps = clamp_int(request.get("second_steps"), preset["second_steps"], 1, 100)
    third_steps = clamp_int(request.get("third_steps"), second_steps, 1, 100)
    cfg = float(request.get("cfg", preset["cfg"]))
    second_cfg = float(request.get("second_cfg", cfg))
    third_cfg = float(request.get("third_cfg", second_cfg))
    denoise = float(request.get("denoise", 1.0))
    second_denoise = float(request.get("second_denoise", preset["second_denoise"]))
    third_denoise = float(request.get("third_denoise", request.get("final_denoise", 0.12)))
    sampler_name = str(request.get("sampler_name") or preset["sampler_name"])
    scheduler = str(request.get("scheduler") or preset["scheduler"])
    second_sampler_name = str(request.get("second_sampler_name") or sampler_name)
    second_scheduler = str(request.get("second_scheduler") or scheduler)
    third_sampler_name = str(request.get("third_sampler_name") or second_sampler_name)
    third_scheduler = str(request.get("third_scheduler") or second_scheduler)
    filename_prefix = safe_filename_prefix(request.get("filename_prefix") or preset["filename_prefix"])

    loader_workflow, model_ref, clip_ref, vae_ref = model_loader_workflow(model_spec)
    workflow: dict[str, Any] = {
        **loader_workflow,
        "38": {
            "class_type": "CR Prompt Text",
            "inputs": {"prompt": prefix},
        },
        "39": {
            "class_type": "CR Prompt Text",
            "inputs": {"prompt": positive},
        },
        "37": {
            "class_type": "CR Text Concatenate",
            "inputs": {
                "text1": ["38", 0],
                "text2": ["39", 0],
                "separator": "",
            },
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": clip_ref, "text": ["37", 0]},
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": clip_ref, "text": negative},
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        },
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "model": model_ref,
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler_name,
                "scheduler": scheduler,
                "denoise": denoise,
            },
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["3", 0], "vae": vae_ref},
        },
        "11": {
            "class_type": "UpscaleModelLoader",
            "inputs": {"model_name": upscale_model},
        },
        "10": {
            "class_type": "ImageUpscaleWithModel",
            "inputs": {"upscale_model": ["11", 0], "image": ["8", 0]},
        },
        "14": {
            "class_type": "VAEEncode",
            "inputs": {"pixels": ["10", 0], "vae": vae_ref},
        },
        "15": {
            "class_type": "KSampler",
            "inputs": {
                "model": model_ref,
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["14", 0],
                "seed": second_seed,
                "steps": second_steps,
                "cfg": second_cfg,
                "sampler_name": second_sampler_name,
                "scheduler": second_scheduler,
                "denoise": second_denoise,
            },
        },
        "16": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["15", 0], "vae": vae_ref},
        },
        "30": {
            "class_type": "LayerUtility: PurgeVRAM V2",
            "inputs": {"anything": ["16", 0], "purge_cache": True, "purge_models": True},
        },
        "17": {
            "class_type": "SaveImage",
            "inputs": {"images": ["30", 0], "filename_prefix": filename_prefix},
        },
    }

    if two_stage_upscale:
        workflow.update(
            {
                "40": {
                    "class_type": "UpscaleModelLoader",
                    "inputs": {"model_name": second_stage_upscale_model},
                },
                "41": {
                    "class_type": "ImageUpscaleWithModel",
                    "inputs": {"upscale_model": ["40", 0], "image": ["16", 0]},
                },
                "42": {
                    "class_type": "VAEEncode",
                    "inputs": {"pixels": ["41", 0], "vae": vae_ref},
                },
                "43": {
                    "class_type": "KSampler",
                    "inputs": {
                        "model": model_ref,
                        "positive": ["6", 0],
                        "negative": ["7", 0],
                        "latent_image": ["42", 0],
                        "seed": third_seed,
                        "steps": third_steps,
                        "cfg": third_cfg,
                        "sampler_name": third_sampler_name,
                        "scheduler": third_scheduler,
                        "denoise": third_denoise,
                    },
                },
                "44": {
                    "class_type": "VAEDecode",
                    "inputs": {"samples": ["43", 0], "vae": vae_ref},
                },
            }
        )
        workflow["30"]["inputs"]["anything"] = ["44", 0]

    for index, lora in enumerate(loras):
        node_id = str(100 + index)
        workflow[node_id] = {
            "class_type": "LoraLoader",
            "inputs": {
                "model": model_ref,
                "clip": clip_ref,
                "lora_name": lora["name"],
                "strength_model": lora["strength_model"],
                "strength_clip": lora["strength_clip"],
            },
        }
        model_ref = [node_id, 0]
        clip_ref = [node_id, 1]

    workflow["6"]["inputs"]["clip"] = clip_ref
    workflow["7"]["inputs"]["clip"] = clip_ref
    workflow["3"]["inputs"]["model"] = model_ref
    workflow["15"]["inputs"]["model"] = model_ref
    if "43" in workflow:
        workflow["43"]["inputs"]["model"] = model_ref
    return attach_model_face_detail(workflow, request, model_spec)


def image_path_from_output(image: dict[str, Any]) -> str:
    subfolder = str(image.get("subfolder") or "")
    filename = str(image["filename"])
    return str((OUTPUT_DIR / subfolder / filename).resolve())


def resolve_openable_path(value: Any) -> Path:
    raw = str(value or "").strip()
    if not raw:
        raise GatewayError("Missing path", 400)
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = OUTPUT_DIR / raw
    resolved = candidate.resolve()
    roots = [OUTPUT_DIR.resolve(), COMFY_ROOT.resolve(), PROJECT_ROOT.resolve()]
    if not any(root == resolved or root in resolved.parents for root in roots):
        raise GatewayError("Path is outside the ComfyUI workspace", 400, {"path": raw})
    if not resolved.is_file():
        raise GatewayError("File not found", 404, {"path": str(resolved)})
    return resolved


def open_path_with_system_app(request: dict[str, Any]) -> dict[str, Any]:
    path = resolve_openable_path(request.get("path") or request.get("image_path"))
    if sys.platform.startswith("win"):
        os.startfile(str(path))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])
    return {"ok": True, "path": str(path)}


def image_url(comfy_url: str, image: dict[str, Any]) -> str:
    params = urllib.parse.urlencode(
        {
            "filename": image.get("filename", ""),
            "subfolder": image.get("subfolder", ""),
            "type": image.get("type", "output"),
        }
    )
    return f"{comfy_url}/view?{params}"


def media_path_from_output(item: dict[str, Any]) -> str:
    subfolder = str(item.get("subfolder") or "")
    filename = str(item["filename"])
    return str((OUTPUT_DIR / subfolder / filename).resolve())


def media_url(comfy_url: str, item: dict[str, Any]) -> str:
    params = urllib.parse.urlencode(
        {
            "filename": item.get("filename", ""),
            "subfolder": item.get("subfolder", ""),
            "type": item.get("type", "output"),
        }
    )
    return f"{comfy_url}/view?{params}"


def resolve_image_path(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        raise GatewayError("image_path is required", 400)
    path = Path(raw)
    candidates = [path] if path.is_absolute() else [PROJECT_ROOT / path, INPUT_DIR / path, OUTPUT_DIR / path]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate.resolve())
    raise GatewayError("image_path does not exist", 400, {"image_path": raw})


def decode_bytes(data: bytes, *encodings: str) -> str:
    for encoding in encodings:
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode(encodings[0] if encodings else "utf-8", errors="replace")


def maybe_json(value: str) -> Any:
    text = value.strip()
    if not text or text[0] not in "[{":
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def read_png_text_chunks(path: Path) -> tuple[dict[str, str], dict[str, Any]]:
    metadata: dict[str, str] = {}
    info: dict[str, Any] = {"format": "png"}
    with path.open("rb") as handle:
        if handle.read(8) != b"\x89PNG\r\n\x1a\n":
            raise GatewayError("Only PNG ComfyUI metadata extraction is currently supported", 400)
        while True:
            length_raw = handle.read(4)
            if len(length_raw) < 4:
                break
            length = int.from_bytes(length_raw, "big")
            chunk_type = handle.read(4)
            data = handle.read(length)
            handle.read(4)  # crc
            if chunk_type == b"IHDR" and len(data) >= 8:
                info["width"] = int.from_bytes(data[:4], "big")
                info["height"] = int.from_bytes(data[4:8], "big")
            elif chunk_type == b"tEXt":
                keyword, _, text = data.partition(b"\x00")
                if keyword:
                    metadata[decode_bytes(keyword, "latin-1", "utf-8")] = decode_bytes(text, "utf-8", "latin-1")
            elif chunk_type == b"zTXt":
                keyword, _, rest = data.partition(b"\x00")
                if keyword and rest:
                    compression_method = rest[0]
                    compressed = rest[1:]
                    if compression_method == 0:
                        metadata[decode_bytes(keyword, "latin-1", "utf-8")] = decode_bytes(
                            zlib.decompress(compressed),
                            "utf-8",
                            "latin-1",
                        )
            elif chunk_type == b"iTXt":
                parts = data.split(b"\x00", 5)
                if len(parts) == 6 and parts[0]:
                    keyword, compression_flag, compression_method, _language, _translated, text = parts
                    if compression_flag == b"\x01" and compression_method == b"\x00":
                        text = zlib.decompress(text)
                    metadata[decode_bytes(keyword, "latin-1", "utf-8")] = decode_bytes(text, "utf-8", "latin-1")
            if chunk_type == b"IEND":
                break
    return metadata, info


def extract_image_metadata(request: dict[str, Any]) -> dict[str, Any]:
    image_path = Path(resolve_image_path(request.get("image_path")))
    metadata, image_info = read_png_text_chunks(image_path)
    parsed = {key: parsed_value for key, value in metadata.items() if (parsed_value := maybe_json(value)) is not None}
    prompt_raw = metadata.get("prompt")
    workflow_raw = metadata.get("workflow")
    comfy = {
        "has_prompt": prompt_raw is not None,
        "has_workflow": workflow_raw is not None,
        "prompt": maybe_json(prompt_raw or "") if prompt_raw is not None else None,
        "workflow": maybe_json(workflow_raw or "") if workflow_raw is not None else None,
    }
    return {
        "ok": True,
        "image_path": str(image_path.resolve()),
        **image_info,
        "metadata_keys": list(metadata.keys()),
        "metadata": metadata,
        "parsed": parsed,
        "comfy": comfy,
    }


def api_node_inputs(node: Any) -> dict[str, Any]:
    return node.get("inputs", {}) if isinstance(node, dict) and isinstance(node.get("inputs"), dict) else {}


def resolve_prompt_text(value: Any, prompt: dict[str, Any], seen: set[str] | None = None) -> str:
    if isinstance(value, str):
        return value
    if not (isinstance(value, list) and value):
        return ""
    node_id = str(value[0])
    if seen is None:
        seen = set()
    if node_id in seen:
        return ""
    seen.add(node_id)
    node = prompt.get(node_id)
    if not isinstance(node, dict):
        return ""
    class_type = str(node.get("class_type") or "")
    inputs = api_node_inputs(node)
    if class_type == "CR Prompt Text":
        return str(inputs.get("prompt") or "")
    if class_type == "CR Text Concatenate":
        left = resolve_prompt_text(inputs.get("text1"), prompt, seen)
        right = resolve_prompt_text(inputs.get("text2"), prompt, seen)
        return f"{left}{str(inputs.get('separator') or '')}{right}"
    if class_type == "CLIPTextEncode":
        return resolve_prompt_text(inputs.get("text"), prompt, seen)
    for key in ("text", "prompt", "value"):
        if key in inputs:
            return resolve_prompt_text(inputs[key], prompt, seen)
    return ""


def summarize_api_prompt(prompt: Any) -> dict[str, Any]:
    if not isinstance(prompt, dict):
        return {}
    summary: dict[str, Any] = {
        "node_count": len(prompt),
        "positive": None,
        "negative": None,
        "clip_texts": [],
        "models": {},
        "loras": [],
        "samplers": [],
        "latent_size": None,
    }
    for node_id, node in prompt.items():
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type") or "")
        inputs = api_node_inputs(node)
        if class_type == "CheckpointLoaderSimple":
            summary["models"]["checkpoint"] = inputs.get("ckpt_name")
        elif class_type in {"UNETLoader", "UnetLoaderGGUF"}:
            summary["models"]["unet"] = inputs.get("unet_name")
            if inputs.get("weight_dtype") is not None:
                summary["models"]["weight_dtype"] = inputs.get("weight_dtype")
        elif class_type == "CLIPLoader":
            summary["models"]["clip"] = inputs.get("clip_name")
            summary["models"]["clip_type"] = inputs.get("type")
        elif class_type == "VAELoader":
            summary["models"]["vae"] = inputs.get("vae_name")
        elif class_type == "LoraLoader":
            summary["loras"].append(
                {
                    "name": inputs.get("lora_name"),
                    "strength_model": inputs.get("strength_model"),
                    "strength_clip": inputs.get("strength_clip"),
                }
            )
        elif class_type == "CLIPTextEncode":
            text = resolve_prompt_text(inputs.get("text"), prompt)
            role = "negative" if str(node_id) == "7" else "positive" if str(node_id) == "6" else "unknown"
            if role == "positive" and summary["positive"] is None:
                summary["positive"] = text
            elif role == "negative" and summary["negative"] is None:
                summary["negative"] = text
            summary["clip_texts"].append({"node_id": str(node_id), "role": role, "text": text})
        elif class_type == "EmptyLatentImage":
            summary["latent_size"] = {
                "width": inputs.get("width"),
                "height": inputs.get("height"),
                "batch_size": inputs.get("batch_size"),
            }
        elif class_type in {"KSampler", "KSamplerAdvanced"}:
            summary["samplers"].append(
                {
                    "node_id": str(node_id),
                    "class_type": class_type,
                    "seed": inputs.get("seed", inputs.get("noise_seed")),
                    "steps": inputs.get("steps"),
                    "cfg": inputs.get("cfg"),
                    "sampler_name": inputs.get("sampler_name"),
                    "scheduler": inputs.get("scheduler"),
                    "denoise": inputs.get("denoise"),
                }
            )
    return summary


def summarize_ui_workflow(workflow: Any) -> dict[str, Any]:
    nodes = workflow.get("nodes", []) if isinstance(workflow, dict) else []
    if not isinstance(nodes, list):
        nodes = []
    return {
        "node_count": len(nodes),
        "title": workflow.get("id") if isinstance(workflow, dict) else None,
    }


def extract_image_prompt_info(request: dict[str, Any]) -> dict[str, Any]:
    image_path = Path(resolve_image_path(request.get("image_path")))
    metadata, image_info = read_png_text_chunks(image_path)
    prompt = maybe_json(metadata.get("prompt") or "")
    workflow = maybe_json(metadata.get("workflow") or "")
    return {
        "ok": True,
        "image_path": str(image_path.resolve()),
        **image_info,
        "metadata_keys": list(metadata.keys()),
        "has_prompt": prompt is not None,
        "has_workflow": workflow is not None,
        "prompt": summarize_api_prompt(prompt),
        "workflow": summarize_ui_workflow(workflow),
        "note": "Lightweight summary only; use /image/metadata for full raw PNG metadata and full workflows.",
    }


def resolve_video_path(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        raise GatewayError("video_path is required", 400)
    path = Path(raw)
    candidates = (
        [path]
        if path.is_absolute()
        else [
            PROJECT_ROOT / path,
            INPUT_DIR / path,
            OUTPUT_DIR / path,
            AI_UPSCALE_LAB / path,
            VIDEO_OUTPUT_DIR / path,
        ]
    )
    for candidate in candidates:
        if candidate.is_file() and candidate.suffix.lower() in VIDEO_EXTENSIONS:
            return str(candidate.resolve())
    raise GatewayError("video_path does not exist or is not a supported video", 400, {"video_path": raw})


def safe_stem(path: str) -> str:
    stem = Path(path).stem
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", stem).strip("._")
    return cleaned or f"video_{int(time.time())}"


def expand_date_tokens(value: str) -> str:
    def replace_date(match: re.Match[str]) -> str:
        fmt = match.group(1)
        for token, strftime_token in (
            ("yyyy", "%Y"),
            ("YYYY", "%Y"),
            ("yy", "%y"),
            ("YY", "%y"),
            ("MM", "%m"),
            ("dd", "%d"),
            ("DD", "%d"),
            ("HH", "%H"),
            ("hh", "%H"),
            ("mm", "%M"),
            ("ss", "%S"),
        ):
            fmt = fmt.replace(token, strftime_token)
        return time.strftime(fmt)

    return re.sub(r"%date:([^%]+)%", replace_date, value)


def safe_filename_prefix(value: Any) -> str:
    raw = str(value or "").strip() or f"Video/Dasiwa-gateway-{time.strftime('%Y%m%d%H%M%S')}"
    expanded = expand_date_tokens(raw).replace("\\", "/")
    parts: list[str] = []
    for segment in expanded.split("/"):
        cleaned = re.sub(r'[<>:"|?*\x00-\x1f]+', "_", segment).strip(" ._")
        if cleaned in {"", ".", ".."}:
            cleaned = "_"
        parts.append(cleaned)
    return "/".join(parts)


def fraction_to_float(value: str, default: float = 0.0) -> float:
    try:
        if "/" in value:
            left, right = value.split("/", 1)
            denom = float(right)
            return float(left) / denom if denom else default
        return float(value)
    except (TypeError, ValueError):
        return default


def run_process(args: list[str], timeout: float, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    try:
        completed = subprocess.run(
            args,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=timeout,
            cwd=str(cwd or PROJECT_ROOT),
        )
    except FileNotFoundError as exc:
        raise GatewayError("Required executable was not found", 502, args[0]) from exc
    except subprocess.TimeoutExpired as exc:
        raise GatewayError(
            "Video tool command timed out",
            504,
            {"args": args, "stdout": exc.stdout, "stderr": exc.stderr},
        ) from exc
    if completed.returncode != 0:
        raise GatewayError(
            "Video tool command failed",
            502,
            {"args": args, "stdout": completed.stdout[-4000:], "stderr": completed.stderr[-4000:]},
        )
    return completed


def probe_video(path: str) -> dict[str, Any]:
    completed = run_process(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,pix_fmt,color_range,color_space,color_transfer,color_primaries,avg_frame_rate,nb_frames,duration",
            "-of",
            "json",
            path,
        ],
        timeout=30,
    )
    data = json.loads(completed.stdout or "{}")
    stream = (data.get("streams") or [{}])[0]
    stream["fps"] = fraction_to_float(str(stream.get("avg_frame_rate") or "0/1"))
    return stream


def make_video_job_dir(kind: str, source: str) -> Path:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    root = VIDEO_WORK_DIR / f"{stamp}_{kind}_{safe_stem(source)}"
    root.mkdir(parents=True, exist_ok=False)
    VIDEO_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return root


def ffmpeg_extract_frames(video_path: str, frames_dir: Path, frame_load_cap: int, timeout: float) -> None:
    frames_dir.mkdir(parents=True, exist_ok=True)
    args = ["ffmpeg", "-y", "-i", video_path, "-fps_mode", "passthrough"]
    if frame_load_cap > 0:
        args.extend(["-vframes", str(frame_load_cap)])
    args.append(str(frames_dir / "frame_%08d.png"))
    run_process(args, timeout=timeout)


def ffmpeg_combine_frames(frames_dir: Path, fps: float, output_path: Path, crf: int, preset: str, timeout: float) -> None:
    run_process(
        [
            "ffmpeg",
            "-y",
            "-framerate",
            f"{fps:g}",
            "-i",
            str(frames_dir / "frame_%08d.png"),
            "-vf",
            "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
            "-c:v",
            "libx264",
            "-crf",
            str(crf),
            "-preset",
            preset,
            "-color_range",
            "tv",
            "-colorspace",
            "bt709",
            "-color_trc",
            "bt709",
            "-color_primaries",
            "bt709",
            "-an",
            str(output_path),
        ],
        timeout=timeout,
    )


def upscale_video(request: dict[str, Any]) -> dict[str, Any]:
    video_path = resolve_video_path(request.get("video_path"))
    source_info = probe_video(video_path)
    scale = parse_upscale_scale(request.get("scale", request.get("upscale_scale", 3)))
    frame_load_cap = clamp_int(request.get("frame_load_cap"), 0, 0, 1_000_000)
    crf = clamp_int(request.get("crf"), 16, 0, 51)
    preset = str(request.get("preset") or "slow")
    timeout = float(request.get("timeout", 3600))
    model_name = str(request.get("model") or "realesr-animevideov3")

    if not REALESRGAN_EXE.is_file():
        raise GatewayError("Real-ESRGAN executable is missing", 502, str(REALESRGAN_EXE))

    job_dir = make_video_job_dir("upscale", video_path)
    frames_dir = job_dir / "frames_src"
    upscaled_dir = job_dir / f"frames_x{scale}"
    output_path = VIDEO_OUTPUT_DIR / f"{safe_stem(video_path)}_gateway_realesrgan_x{scale}_{int(time.time())}.mp4"

    ffmpeg_extract_frames(video_path, frames_dir, frame_load_cap, timeout)
    upscaled_dir.mkdir(parents=True, exist_ok=True)
    run_process(
        [
            str(REALESRGAN_EXE),
            "-i",
            str(frames_dir),
            "-o",
            str(upscaled_dir),
            "-n",
            model_name,
            "-s",
            str(scale),
            "-m",
            str(AI_UPSCALE_LAB / "tools" / "models"),
            "-f",
            "png",
        ],
        timeout=timeout,
        cwd=AI_UPSCALE_LAB,
    )
    fps = float(request.get("fps") or source_info.get("fps") or 30)
    ffmpeg_combine_frames(upscaled_dir, fps, output_path, crf, preset, timeout)
    output_info = probe_video(str(output_path))
    return {
        "ok": True,
        "tool": "realesrgan-ncnn-vulkan",
        "video_path": str(output_path.resolve()),
        "source_path": video_path,
        "work_dir": str(job_dir.resolve()),
        "scale": scale,
        "model": model_name,
        "frame_load_cap": frame_load_cap,
        "source": source_info,
        "output": output_info,
    }


def interpolate_video(request: dict[str, Any]) -> dict[str, Any]:
    video_path = resolve_video_path(request.get("video_path"))
    source_info = probe_video(video_path)
    source_fps = float(request.get("source_fps") or source_info.get("fps") or 30)
    target_fps = float(request.get("target_fps") or (source_fps * 2))
    if abs(target_fps - source_fps * 2) > 0.01:
        raise GatewayError("This gateway interpolation endpoint currently supports one RIFE x2 pass", 400)
    frame_load_cap = clamp_int(request.get("frame_load_cap"), 0, 0, 1_000_000)
    crf = clamp_int(request.get("crf"), 18, 0, 51)
    preset = str(request.get("preset") or "slow")
    timeout = float(request.get("timeout", 3600))
    model_dir = str(request.get("model_dir") or "")

    if not RIFE_EXE.is_file():
        raise GatewayError("RIFE executable is missing", 502, str(RIFE_EXE))

    job_dir = make_video_job_dir("rife", video_path)
    frames_dir = job_dir / "frames_src"
    rife_dir = job_dir / "frames_rife_x2"
    output_path = VIDEO_OUTPUT_DIR / f"{safe_stem(video_path)}_gateway_rife_{target_fps:g}fps_{int(time.time())}.mp4"

    ffmpeg_extract_frames(video_path, frames_dir, frame_load_cap, timeout)
    rife_dir.mkdir(parents=True, exist_ok=True)
    args = [str(RIFE_EXE), "-i", str(frames_dir), "-o", str(rife_dir), "-f", "frame_%08d.png"]
    if model_dir:
        args.extend(["-m", model_dir])
    run_process(args, timeout=timeout, cwd=RIFE_EXE.parent)
    ffmpeg_combine_frames(rife_dir, target_fps, output_path, crf, preset, timeout)
    output_info = probe_video(str(output_path))
    return {
        "ok": True,
        "tool": "rife-ncnn-vulkan",
        "video_path": str(output_path.resolve()),
        "source_path": video_path,
        "work_dir": str(job_dir.resolve()),
        "source_fps": source_fps,
        "target_fps": target_fps,
        "frame_load_cap": frame_load_cap,
        "source": source_info,
        "output": output_info,
    }


def ensure_comfy_input_file(path: str) -> str:
    source = Path(path).resolve()
    try:
        relative = source.relative_to(INPUT_DIR.resolve())
        return relative.as_posix()
    except ValueError:
        pass
    INPUT_DIR.mkdir(parents=True, exist_ok=True)
    target = INPUT_DIR / f"gateway_{int(time.time())}_{safe_stem(str(source))}{source.suffix.lower()}"
    shutil.copy2(source, target)
    return target.name


def widget_inputs(node: dict[str, Any]) -> list[str]:
    return [
        str(item["widget"]["name"])
        for item in node.get("inputs", []) or []
        if isinstance(item, dict)
        and isinstance(item.get("widget"), dict)
        and item.get("link") is None
        and item.get("type") != "IMAGEUPLOAD"
    ]


def node_widget_values(node: dict[str, Any]) -> dict[str, Any]:
    values = node.get("widgets_values")
    if isinstance(values, dict):
        return {name: values[name] for name in widget_inputs(node) if name in values}
    names = widget_inputs(node)
    if not isinstance(values, list):
        return {}
    if node.get("type") == "KSamplerAdvanced" and len(values) == 10:
        names = [
            "add_noise",
            "noise_seed",
            "control_after_generate",
            "steps",
            "cfg",
            "sampler_name",
            "scheduler",
            "start_at_step",
            "end_at_step",
            "return_with_leftover_noise",
        ]
    return {name: values[index] for index, name in enumerate(names) if index < len(values) and name != "control_after_generate"}


def ui_workflow_to_api(data: dict[str, Any], output_node_ids: set[int]) -> dict[str, Any]:
    all_nodes = {int(node["id"]): node for node in data.get("nodes", [])}
    nodes = {node_id: node for node_id, node in all_nodes.items() if int(node.get("mode", 0)) == 0}
    link_map: dict[int, tuple[int, int]] = {}
    incoming: dict[int, list[int]] = {}
    for link in data.get("links", []) or []:
        link_id, src_id, src_slot, dst_id = int(link[0]), int(link[1]), int(link[2]), int(link[3])
        link_map[link_id] = (src_id, src_slot)
        incoming.setdefault(dst_id, []).append(src_id)

    def resolve_bypassed_source(src_id: int, src_slot: int) -> tuple[int, int] | None:
        if src_id in nodes:
            return src_id, src_slot
        node = all_nodes.get(src_id)
        if not node:
            return None
        if str(node.get("type")) not in {"PathchSageAttentionKJ", "Fast Groups Bypasser (rgthree)"}:
            return None
        for item in node.get("inputs", []) or []:
            if isinstance(item, dict) and item.get("link") is not None:
                upstream = link_map.get(int(item["link"]))
                if upstream:
                    return resolve_bypassed_source(upstream[0], upstream[1])
        return None

    def resolve_link(link_id: int) -> tuple[int, int] | None:
        src = link_map.get(link_id)
        if not src:
            return None
        return resolve_bypassed_source(src[0], src[1])

    reachable: set[int] = set()
    stack = list(output_node_ids)
    while stack:
        node_id = stack.pop()
        if node_id in reachable or node_id not in nodes:
            continue
        reachable.add(node_id)
        node = nodes[node_id]
        for item in node.get("inputs", []) or []:
            if not isinstance(item, dict) or item.get("link") is None:
                continue
            src = resolve_link(int(item["link"]))
            if src and src[0] in nodes:
                stack.append(src[0])

    workflow: dict[str, Any] = {}
    for node_id in sorted(reachable):
        node = nodes[node_id]
        inputs: dict[str, Any] = {}
        inputs.update(node_widget_values(node))
        for item in node.get("inputs", []) or []:
            if not isinstance(item, dict) or item.get("link") is None:
                continue
            src = resolve_link(int(item["link"]))
            if src and src[0] in reachable:
                inputs[str(item["name"])] = [str(src[0]), src[1]]
        workflow[str(node_id)] = {"class_type": str(node["type"]), "inputs": inputs}
    return workflow


def patch_dasiwa_workflow(workflow: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
    image_path = resolve_image_path(request.get("image_path"))
    input_name = ensure_comfy_input_file(image_path)
    width = align8(clamp_int(request.get("width"), 832, 128, 2048))
    height = align8(clamp_int(request.get("height"), 480, 128, 2048))
    fps = float(request.get("fps", 16))
    seconds = clamp_int(request.get("seconds"), 3, 1, 30)
    default_length = max(1, int(round(seconds * fps)) + 1)
    length = clamp_int(request.get("length", request.get("frames")), default_length, 1, 257)
    seed = clamp_int(request.get("seed"), int(time.time() * 1000) % (2**32), 0, 2**63 - 1)
    steps = clamp_int(request.get("steps"), 6, 1, 100)
    cfg = float(request.get("cfg", 1))
    positive = str(request.get("prompt") or "镜头缓慢移动，主体产生自然动作，画面保持稳定连贯")
    negative = str(
        request.get("negative")
        or "过曝，静态，细节模糊，字幕，水印，低质量，JPEG压缩残留，畸形肢体，多余手指，杂乱背景，倒着走"
    )
    filename_prefix = safe_filename_prefix(
        request.get("filename_prefix") or "Video/Dasiwa-gateway-%date:yyyyMMddhhmmss%"
    )
    crf = clamp_int(request.get("crf"), 19, 0, 51)

    workflow["141"]["inputs"]["image"] = input_name
    workflow["230"]["inputs"].update({"width": width, "height": height})
    workflow["249"]["inputs"].update({"width": width, "height": height, "length": length, "batch_size": 1})
    workflow["258"]["inputs"]["value"] = seconds
    workflow["413"]["inputs"]["value"] = fps
    workflow["240"]["inputs"]["text"] = positive
    workflow["239"]["inputs"]["text"] = negative
    for node_id, add_noise, start, end, leftover in (
        ("203", "enable", 0, max(1, steps // 2), "enable"),
        ("204", "disable", max(1, steps // 2), 10000, "disable"),
    ):
        workflow[node_id]["inputs"].update(
            {
                "add_noise": add_noise,
                "noise_seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": str(request.get("sampler_name") or "euler"),
                "scheduler": str(request.get("scheduler") or "simple"),
                "start_at_step": start,
                "end_at_step": end,
                "return_with_leftover_noise": leftover,
            }
        )
    workflow["245"]["inputs"].update(
        {
            "frame_rate": fps,
            "filename_prefix": filename_prefix,
            "format": str(request.get("format") or "video/h264-mp4"),
            "pix_fmt": str(request.get("pix_fmt") or "yuv420p"),
            "crf": crf,
            "save_metadata": bool(request.get("save_metadata", True)),
            "trim_to_audio": False,
            "pingpong": bool(request.get("pingpong", False)),
            "save_output": True,
        }
    )
    return workflow


def build_dasiwa_workflow(request: dict[str, Any]) -> dict[str, Any]:
    if not DASIWA_WORKFLOW.is_file():
        raise GatewayError("Dasiwa workflow file is missing", 502, str(DASIWA_WORKFLOW))
    data = json.loads(DASIWA_WORKFLOW.read_text(encoding="utf-8"))
    workflow = ui_workflow_to_api(data, {245})
    return patch_dasiwa_workflow(workflow, request)


def caption_image(request: dict[str, Any]) -> dict[str, Any]:
    provider = str(request.get("provider") or "florence2").strip().lower()
    if provider in {"qwen", "qwen-vl"}:
        provider = "qwen_vl"
    if provider in {"lmstudio", "lm-studio", "lm_studio"}:
        return caption_image_lmstudio(request)
    if provider not in {"florence2", "qwen_vl"}:
        raise GatewayError("Unknown caption provider", 400, {"provider": provider})
    default_model = "Qwen/Qwen2.5-VL-3B-Instruct" if provider == "qwen_vl" else "microsoft/Florence-2-base-ft"

    payload = {
        "provider": provider,
        "image_path": resolve_image_path(request.get("image_path")) if request.get("image_path") else "",
        "image_url": str(request.get("image_url") or "").strip(),
        "model": str(request.get("model") or default_model),
        "task": str(request.get("task") or "more_detailed_caption"),
        "prompt": str(request.get("prompt") or ""),
        "precision": str(request.get("precision") or "fp16"),
        "device": str(request.get("device") or "cuda"),
        "max_new_tokens": clamp_int(request.get("max_new_tokens"), 512, 16, 2048),
        "num_beams": clamp_int(request.get("num_beams"), 3, 1, 16),
        "do_sample": bool(request.get("do_sample", False)),
    }
    if not payload["image_path"] and not payload["image_url"]:
        raise GatewayError("image_path or image_url is required", 400)

    timeout = float(request.get("timeout", 600))
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    completed = subprocess.run(
        [sys.executable, str(CAPTION_WORKER)],
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        timeout=timeout,
        cwd=str(PROJECT_ROOT),
        env=env,
    )
    if completed.returncode != 0:
        raise GatewayError(
            "Caption worker failed",
            502,
            {
                "returncode": completed.returncode,
                "stdout": completed.stdout[-4000:],
                "stderr": completed.stderr[-4000:],
            },
        )
    try:
        response = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise GatewayError(
            "Caption worker returned invalid JSON",
            502,
            {"stdout": completed.stdout[-4000:], "stderr": completed.stderr[-4000:]},
        ) from exc
    if not response.get("ok"):
        raise GatewayError("Caption worker failed", 502, response)
    return response


def run_lms_command(args: list[str], timeout: float = 60) -> subprocess.CompletedProcess[str]:
    exe = os.environ.get("LMS_EXE", "lms")
    try:
        return subprocess.run(
            [exe, *args],
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=timeout,
            cwd=str(PROJECT_ROOT),
        )
    except FileNotFoundError as exc:
        raise GatewayError(
            "LM Studio lms CLI was not found",
            502,
            "Install/enable LM Studio CLI or set LMS_EXE to lms.exe.",
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise GatewayError(
            "LM Studio lms command timed out",
            502,
            {"args": args, "stdout": exc.stdout, "stderr": exc.stderr},
        ) from exc


def lmstudio_list_models(base_url: str, timeout: float = 2) -> list[str]:
    response = local_json_request("GET", f"{base_url}/v1/models", timeout=timeout, label="LM Studio")
    data = response.get("data", []) if isinstance(response, dict) else []
    return [str(item.get("id")) for item in data if isinstance(item, dict) and item.get("id")]


def wait_for_lmstudio_server(base_url: str, timeout: float = 10) -> None:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            lmstudio_list_models(base_url, timeout=1)
            return
        except GatewayError as exc:
            last_error = exc
            time.sleep(0.5)
    raise GatewayError("LM Studio server did not become ready", 502, str(last_error) if last_error else None)


def ensure_lmstudio_server(base_url: str) -> None:
    try:
        lmstudio_list_models(base_url, timeout=1.5)
        return
    except GatewayError:
        pass

    parsed = urllib.parse.urlparse(base_url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise GatewayError("LM Studio auto-start only supports local base_url", 502, base_url)

    completed = run_lms_command(["server", "start", "--port", str(port), "--bind", host], timeout=30)
    if completed.returncode != 0:
        raise GatewayError(
            "Failed to start LM Studio server",
            502,
            {"stdout": completed.stdout[-4000:], "stderr": completed.stderr[-4000:]},
        )
    wait_for_lmstudio_server(base_url, timeout=10)


def ensure_lmstudio_model_loaded(request: dict[str, Any], base_url: str, model: str) -> dict[str, Any]:
    auto_load = bool(request.get("auto_load", True))
    if not auto_load:
        return {"auto_load": False, "loaded": None}

    try:
        loaded = lmstudio_list_models(base_url, timeout=2)
    except GatewayError:
        ensure_lmstudio_server(base_url)
        loaded = lmstudio_list_models(base_url, timeout=2)

    if model in loaded:
        return {"auto_load": True, "loaded": True, "already_loaded": True}

    model_key = str(request.get("lmstudio_model_key") or DEFAULT_LMSTUDIO_MODEL_KEY)
    ttl = clamp_int(request.get("ttl"), DEFAULT_LMSTUDIO_TTL, 1, 86400)
    context_length = clamp_int(request.get("context_length"), 4096, 512, 131072)
    gpu = str(request.get("gpu") or "max")
    load_timeout = float(request.get("load_timeout", 300))

    args = [
        "load",
        model_key,
        "--gpu",
        gpu,
        "--context-length",
        str(context_length),
        "--ttl",
        str(ttl),
        "--identifier",
        model,
        "-y",
    ]
    completed = run_lms_command(args, timeout=load_timeout)
    if completed.returncode != 0:
        raise GatewayError(
            "Failed to load LM Studio model",
            502,
            {"args": args, "stdout": completed.stdout[-4000:], "stderr": completed.stderr[-4000:]},
        )

    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        loaded = lmstudio_list_models(base_url, timeout=2)
        if model in loaded:
            return {
                "auto_load": True,
                "loaded": True,
                "already_loaded": False,
                "model_key": model_key,
                "ttl": ttl,
                "stdout": completed.stdout[-2000:],
            }
        time.sleep(0.5)
    raise GatewayError("LM Studio model did not appear after load", 502, {"model": model, "loaded": loaded})


def caption_image_lmstudio(request: dict[str, Any]) -> dict[str, Any]:
    image_url = str(request.get("image_url") or "").strip()
    image_path = ""
    if not image_url:
        image_path = resolve_image_path(request.get("image_path"))
        suffix = Path(image_path).suffix.lower().lstrip(".") or "png"
        mime = "image/jpeg" if suffix in {"jpg", "jpeg"} else "image/png"
        encoded = base64.b64encode(Path(image_path).read_bytes()).decode("ascii")
        image_url = f"data:{mime};base64,{encoded}"

    base_url = str(request.get("base_url") or DEFAULT_LMSTUDIO_BASE_URL).rstrip("/")
    model = str(request.get("model") or DEFAULT_LMSTUDIO_IDENTIFIER)
    ensure_lmstudio_server(base_url)
    lmstudio_load = ensure_lmstudio_model_loaded(request, base_url, model)
    prompt = str(
        request.get("prompt")
        or "请客观、完整地描述这张图片，用于数据集标注。请使用中性的视觉语言覆盖主体、人物、服装或裸露状态、动作姿态、背景、光线、风格和所有值得注意的细节。如果图中包含成人内容、裸露或敏感人体区域，不要拒绝、泛化或省略可见事实；请只用非情色、非评价性的解剖/服装/遮挡描述记录画面中实际可见的内容。"
    )
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }
        ],
        "temperature": float(request.get("temperature", 0.1)),
        "max_tokens": clamp_int(request.get("max_tokens"), 512, 16, 4096),
    }
    response = local_json_request(
        "POST",
        f"{base_url}/v1/chat/completions",
        payload,
        timeout=float(request.get("timeout", 600)),
        label="LM Studio",
    )
    choice = response.get("choices", [{}])[0] if isinstance(response, dict) else {}
    message = choice.get("message", {}) if isinstance(choice, dict) else {}
    content = str(message.get("content") or "")
    reasoning = str(message.get("reasoning_content") or "")
    caption = content or (reasoning if bool(request.get("use_reasoning_fallback", True)) else "")
    return {
        "ok": True,
        "provider": "lmstudio",
        "model": model,
        "lmstudio": lmstudio_load,
        "image_path": image_path,
        "caption": caption,
        "content": content,
        "reasoning_content": reasoning,
        "finish_reason": choice.get("finish_reason"),
        "raw": response,
    }


def gateway_help(comfy_url: str) -> dict[str, Any]:
    payload = {
        "name": "Agent Comfy Gateway",
        "version": "0.1",
        "comfy_url": comfy_url,
        "endpoints": {
            "GET /health": "Check gateway reachability and configured ComfyUI backend.",
            "GET /help": "Return this machine-readable help payload.",
            "GET /models": "List gateway generation model choices and live ComfyUI model enums.",
            "GET /presets": "List built-in txt2img presets and defaults.",
            "GET /loras": "List LoRA files with optional case-insensitive query, bounded limit, and short-lived caching.",
            "GET /lora-info?name=...": "Read LoRA trigger words from sidecar metadata or safetensors metadata.",
            "GET /lora-preview?name=...": "Serve a local LoRA preview image when one exists.",
            "GET /history/{prompt_id}": "Proxy ComfyUI history for a submitted prompt.",
            "POST /txt2img": "Generate an image from a prompt.",
            "POST /txt2img/mingyun": "Generate with the Mingyun character prompt defaults.",
            "POST /open-path": "Open an output file with the system default application.",
            "POST /interrupt": "Interrupt the current ComfyUI generation.",
            "POST /img2caption": "Describe an image with a short-lived vision model worker.",
            "POST /image/prompt": "Extract a lightweight prompt/model summary from PNG metadata without returning full workflows.",
            "POST /image/metadata": "Extract embedded PNG metadata, including ComfyUI prompt/workflow information.",
            "POST /video/upscale": "Upscale a video with ai-upscale-lab Real-ESRGAN.",
            "POST /video/interpolate": "Interpolate a video with ai-upscale-lab RIFE x2.",
            "POST /img2video/dasiwa": "Generate a video from an image through the saved Wan22 Dasiwa ComfyUI workflow.",
        },
        "txt2img": {
            "required": ["prompt"],
            "defaults": {
                "preset": "anime_manga",
                "wait": True,
                "timeout": 600,
                "upscale_mode": "single",
                "upscale_scale": 2,
                "third_denoise": 0.12,
            },
            "fields": {
                "prompt": "Positive prompt text.",
                "model": "Gateway generation model key from GET /models; aliases are accepted.",
                "base_model": "Alias for model.",
                "preset": "Preset name from GET /presets.",
                "width": "Initial latent width, aligned to multiples of 8.",
                "height": "Initial latent height, aligned to multiples of 8.",
                "upscale_mode": "For pipeline=krea2_hires, this is required: krea2_hires means one latent-hires stage; two_stage adds UltimateSDUpscale. Omitted/single/pixel/denoise are rejected for enumerated Krea2 hires models.",
                "seed": "First sampler seed.",
                "second_seed": "Second sampler seed, defaults to seed.",
                "third_seed": "Final two-stage sampler seed, defaults to second_seed.",
                "steps": "First sampler steps.",
                "second_steps": "Second sampler steps.",
                "third_steps": "Final two-stage sampler steps, defaults to second_steps.",
                "cfg": "First sampler CFG.",
                "second_cfg": "Second sampler CFG, defaults to cfg.",
                "third_cfg": "Final two-stage sampler CFG, defaults to second_cfg.",
                "denoise": "First sampler denoise.",
                "second_denoise": "Second sampler denoise.",
                "third_denoise": "Final two-stage sampler denoise.",
                "sampler_name": "ComfyUI sampler name.",
                "scheduler": "ComfyUI scheduler name.",
                "second_sampler_name": "Second sampler name, defaults to sampler_name.",
                "second_scheduler": "Second sampler scheduler, defaults to scheduler.",
                "third_sampler_name": "Final two-stage sampler name, defaults to second_sampler_name.",
                "third_scheduler": "Final two-stage sampler scheduler, defaults to second_scheduler.",
                "checkpoint": "Checkpoint name under ComfyUI models/checkpoints.",
                "unet": "Custom standalone diffusion model override; gateway will use UNETLoader.",
                "diffusion_model": "Alias for unet; custom standalone diffusion model under ComfyUI models/diffusion_models.",
                "clip": "Custom standalone text encoder override; defaults to the installed MiaoMiao text encoder.",
                "clip_type": "CLIPLoader type for custom modular models; defaults to qwen_image.",
                "vae": "Custom VAE override for modular models; defaults to qwen_image_vae.safetensors.",
                "filename_prefix": "SaveImage filename prefix.",
                "negative": "Negative prompt override. Krea2 Turbo follows the official workflow and uses ConditioningZeroOut by default instead of a text negative prompt.",
                "prefix": "Positive quality prefix override. Krea2 Turbo does not use the default anime quality prefix unless prefix is explicitly supplied.",
                "lora_trigger_word": "Optional trigger text appended to the prompt, mainly useful for Krea2 style LoRAs loaded through LoraLoaderModelOnly.",
                "dry_run": "When true, return the assembled ComfyUI API workflow without submitting it.",
                "wait": "When false, submit and return prompt_id without polling.",
                "timeout": "Polling timeout in seconds when wait is true.",
            },
            "examples": {
                "model_enum": {
                    "prompt": "1girl, solo",
                    "model": "miaomiao_harem",
                },
                "krea2_hires_one_stage": {
                    "prompt": "A cinematic portrait photo with soft studio light",
                    "model": "krea2_turbo",
                    "upscale_mode": "krea2_hires",
                    "upscale_stages": 1,
                    "width": 720,
                    "height": 1280,
                    "steps": 7,
                    "cfg": 1,
                    "sampler_name": "euler",
                    "scheduler": "simple",
                    "upscale_scale": 1.5,
                    "second_steps": 10,
                    "second_cfg": 1,
                    "second_denoise": 0.4,
                    "second_sampler_name": "euler",
                    "second_scheduler": "simple",
                },
                "dasiwa_krea2_hires_one_stage": {
                    "prompt": "A warm cinematic portrait with delicate detail",
                    "model": "dasiwa_krea2_turbo_raw",
                    "upscale_mode": "krea2_hires",
                    "upscale_stages": 1,
                    "upscale_scale": 1.5,
                },
                "krea2_hires_two_stage": {
                    "prompt": "A cinematic portrait photo with soft studio light",
                    "model": "krea2_turbo",
                    "upscale_mode": "two_stage",
                    "upscale_stages": 2,
                    "upscale_scale": 1.5,
                    "second_steps": 10,
                    "second_cfg": 1,
                    "second_denoise": 0.4,
                    "second_stage_upscale_scale": 1.5,
                    "third_steps": 3,
                    "third_cfg": 1,
                    "third_denoise": 0.12,
                    "third_sampler_name": "euler",
                    "third_scheduler": "simple",
                },
                "single_upscale": {
                    "prompt": "1girl, solo",
                    "upscale_scale": 4,
                },
                "two_stage_upscale": {
                    "prompt": "1girl, solo",
                    "upscale_mode": "two_stage",
                    "stage_upscale_scale": 2,
                    "second_stage_upscale_scale": 2,
                    "third_denoise": 0.12,
                },
                "lora": {
                    "prompt": "1girl, solo",
                    "lora": "example.safetensors",
                    "lora_strength": 0.7,
                },
            },
        },
        "upscale": {
            "modes": {
                "single": "Classic non-Krea pipelines use one image upscale and low-denoise sampler.",
                "two_stage": "Classic pipelines use two stages; pipeline=krea2_hires uses required latent hires plus optional UltimateSDUpscale.",
                "krea2_hires": "Required one-stage mode for enumerated Krea2 hires models: KSamplerAdvanced -> LatentUpscaleBy -> KSamplerAdvanced -> VAEDecode -> ColorMatchV2.",
            },
            "krea2_hires": KREA2_HIRES_CONTRACT,
            "mode_aliases": ["two_step", "two-step", "double", "staged"],
            "scales": UPSCALE_MODELS,
            "single_fields": ["upscale_scale", "upscale_multiplier", "upscale", "upscale_model"],
            "two_stage_fields": [
                "upscale_mode",
                "stage_upscale_scale",
                "stage_upscale_model",
                "second_stage_upscale_scale",
                "second_stage_upscale_model",
                "third_steps",
                "third_cfg",
                "third_denoise",
                "third_seed",
                "second_sampler_name",
                "second_scheduler",
                "third_sampler_name",
                "third_scheduler",
            ],
        },
        "models": {
            "endpoint": "GET /models",
            "selection_fields": ["model", "base_model"],
            "known_models": GENERATION_MODELS,
            "notes": "The gateway chooses loader topology and model-specific pipeline from this enum. krea2_turbo and dasiwa_krea2_turbo_raw advertise pipeline=krea2_hires and upscale_contract. They require one explicit latent-hires stage (upscale_mode=krea2_hires) and allow one optional UltimateSDUpscale stage (upscale_mode=two_stage). The reference positive path bypasses the unconsumed ConditioningKrea2Rebalance node; both KSamplerAdvanced nodes and UltimateSDUpscale use CLIPTextEncode directly, ConditioningZeroOut negative, and the final LoraLoaderModelOnly model ref. Dasiwa uses its evidenced Heretic Krea2 CLIP and qwen_image_vae. Agents should read upscale_contract instead of guessing.",
        },
        "lora": {
            "list_endpoint": "GET /loras?query=term1%20term2&limit=20",
            "list_defaults": {"limit": LORA_LIST_DEFAULT_LIMIT, "max_limit": LORA_LIST_MAX_LIMIT, "cache_ttl_seconds": LORA_LIST_CACHE_TTL},
            "list_fields": {
                "query": "Optional case-insensitive whitespace-separated terms; every term must appear in the LoRA path.",
                "limit": "Optional positive result limit; values above max_limit are clamped.",
                "refresh": "Set to 1/true/yes/on to bypass the short TTL cache.",
            },
            "list_response": ["ok", "loras", "total", "filtered", "returned", "query", "limit", "max_limit", "truncated", "source", "cache"],
            "info_endpoint": "GET /lora-info?name=...",
            "preview_endpoint": "GET /lora-preview?name=...",
            "single": ["lora", "lora_strength"],
            "multiple": {
                "loras": [
                    {
                        "name": "example.safetensors",
                        "strength_model": 0.7,
                        "strength_clip": 0.7,
                    }
                ]
            },
            "preview_priority": [
                "metadata.preview_url local image inside models/loras",
                "same-name jpg/jpeg/png/webp/gif beside the LoRA",
                "valid HTTP(S) image URL from metadata.civitai.images",
            ],
            "notes": "Use GET /loras?query=...&limit=... for large libraries. The Gateway caches the ComfyUI list briefly; refresh=1 bypasses the cache. If ComfyUI is temporarily unavailable before a cache exists, the Gateway falls back to scanning its configured models/loras directory and reports source=filesystem. GET /lora-info returns a gateway-relative /lora-preview URL whenever a local image exists; local paths are resolved inside models/loras and cannot escape that directory. Civitai is only a fallback when no local preview exists.",
        },
        "img2caption": {
            "required": ["image_path or image_url"],
            "defaults": {
                "provider": "florence2",
                "model": "microsoft/Florence-2-base-ft",
                "task": "more_detailed_caption",
                "precision": "fp16",
                "device": "cuda",
                "timeout": 600,
            },
            "providers": {
                "florence2": "Runs in a one-shot subprocess and releases VRAM when the worker exits.",
                "qwen_vl": "Runs Qwen-VL in a one-shot subprocess; set model to control what is downloaded/loaded.",
                "lmstudio": "Starts the local LM Studio server if needed, auto-loads the configured vision model, then lets LM Studio unload it after ttl seconds of idleness.",
            },
            "qwen_default_model": "Qwen/Qwen2.5-VL-3B-Instruct",
            "lmstudio_default_model": DEFAULT_LMSTUDIO_IDENTIFIER,
            "lmstudio_default_model_key": DEFAULT_LMSTUDIO_MODEL_KEY,
            "lmstudio_default_base_url": DEFAULT_LMSTUDIO_BASE_URL,
            "lmstudio_default_ttl": DEFAULT_LMSTUDIO_TTL,
            "lmstudio_fields": {
                "base_url": "OpenAI-compatible LM Studio server URL.",
                "model": "Identifier sent to /v1/chat/completions; default is heretic4b-vl.",
                "lmstudio_model_key": "Model key passed to `lms load`; default is qwen3-vl-4b-instruct-heretic.",
                "ttl": "Idle unload TTL passed to `lms load --ttl`; default is 10 seconds.",
                "auto_load": "Set false to require the model to already be loaded.",
                "gpu": "Value passed to `lms load --gpu`; default is max.",
                "context_length": "Value passed to `lms load --context-length`; default is 4096.",
                "prompt": "Caption instruction sent to the vision model. If omitted, a neutral Chinese dataset-captioning prompt is used.",
            },
            "tasks": {
                "caption": "<CAPTION>",
                "detailed_caption": "<DETAILED_CAPTION>",
                "more_detailed_caption": "<MORE_DETAILED_CAPTION>",
                "ocr": "<OCR>",
                "ocr_with_region": "<OCR_WITH_REGION>",
            },
            "example": {
                "image_path": str(OUTPUT_DIR / "example.png"),
                "task": "more_detailed_caption",
            },
        },
        "image_metadata": {
            "required": ["image_path"],
            "aliases": ["/image/info", "/image/comfy", "/image/comfy-info", "/image/comfyinfo"],
            "returns": {
                "metadata": "All PNG text chunks as strings.",
                "parsed": "JSON-parsed metadata entries when they are valid JSON.",
                "comfy.prompt": "Parsed ComfyUI API prompt when a prompt text chunk exists.",
                "comfy.workflow": "Parsed ComfyUI UI workflow when a workflow text chunk exists.",
            },
            "example": {
                "image_path": str(OUTPUT_DIR / "example.png"),
            },
        },
        "image_prompt": {
            "required": ["image_path"],
            "aliases": ["/image/prompt-info", "/image/generation", "/image/generation-info"],
            "returns": {
                "prompt.positive": "Resolved positive prompt text when detectable.",
                "prompt.negative": "Resolved negative prompt text when detectable.",
                "prompt.models": "Checkpoint or modular UNET/CLIP/VAE model names.",
                "prompt.loras": "LoRA names and strengths.",
                "prompt.samplers": "Sampler seeds, steps, cfg, sampler, scheduler, and denoise.",
                "prompt.latent_size": "Initial latent size when present.",
            },
            "notes": "This endpoint intentionally omits full raw metadata and full workflow objects to keep agent responses small.",
            "example": {
                "image_path": str(OUTPUT_DIR / "example.png"),
            },
        },
        "video_upscale": {
            "required": ["video_path"],
            "defaults": {
                "scale": 3,
                "model": "realesr-animevideov3",
                "fps": "source video fps",
                "crf": 16,
                "preset": "slow",
                "frame_load_cap": 0,
                "timeout": 3600,
            },
            "fields": {
                "video_path": "Input video path. Absolute paths and paths relative to the ComfyUI project, input, output, ai-upscale-lab, or ai-upscale-lab/output are accepted.",
                "scale": "Upscale multiplier. Accepts 2, 3, or 4; aliases upscale_scale.",
                "upscale_scale": "Alias for scale.",
                "model": "Real-ESRGAN model name passed to realesrgan-ncnn-vulkan -n.",
                "fps": "Output fps override. Defaults to source video fps.",
                "crf": "x264 CRF for final mp4, 0-51.",
                "preset": "x264 preset for final mp4, for example slow or medium.",
                "frame_load_cap": "Maximum source frames to process. Use a small number for quick tests; 0 means all frames.",
                "timeout": "Total command timeout in seconds.",
            },
            "example": {
                "video_path": str(OUTPUT_DIR / "Video/example.mp4"),
                "scale": 3,
            },
            "returns": ["video_path", "source_path", "work_dir", "scale", "model", "frame_load_cap", "source", "output"],
        },
        "video_interpolate": {
            "required": ["video_path"],
            "defaults": {
                "target_fps": "source_fps * 2",
                "crf": 18,
                "preset": "slow",
                "frame_load_cap": 0,
                "timeout": 3600,
            },
            "fields": {
                "video_path": "Input video path. Absolute paths and paths relative to the ComfyUI project, input, output, ai-upscale-lab, or ai-upscale-lab/output are accepted.",
                "source_fps": "Source fps override. Defaults to probed source fps.",
                "target_fps": "Target fps. Must currently equal source_fps * 2 because this wraps one RIFE x2 pass.",
                "crf": "x264 CRF for final mp4, 0-51.",
                "preset": "x264 preset for final mp4, for example slow or medium.",
                "frame_load_cap": "Maximum source frames to process. Use a small number for quick tests; 0 means all frames.",
                "model_dir": "Optional RIFE model directory passed to rife-ncnn-vulkan -m.",
                "timeout": "Total command timeout in seconds.",
            },
            "notes": "Currently wraps one RIFE x2 pass. Set frame_load_cap for quick tests.",
            "example": {
                "video_path": str(OUTPUT_DIR / "Video/example.mp4"),
                "target_fps": 30,
            },
            "returns": ["video_path", "source_path", "work_dir", "source_fps", "target_fps", "frame_load_cap", "source", "output"],
        },
        "img2video_dasiwa": {
            "required": ["image_path"],
            "defaults": {
                "width": 832,
                "height": 480,
                "fps": 16,
                "seconds": 3,
                "length": "seconds * fps + 1, clamped to 1-257",
                "frames": "Alias for length",
                "seed": "current time in milliseconds modulo 2^32",
                "steps": 6,
                "cfg": 1,
                "sampler_name": "euler",
                "scheduler": "simple",
                "crf": 19,
                "format": "video/h264-mp4",
                "pix_fmt": "yuv420p",
                "save_metadata": True,
                "pingpong": False,
                "wait": True,
                "timeout": 1800,
                "dry_run": False,
            },
            "fields": {
                "image_path": "Input image path. Absolute paths and paths relative to the ComfyUI project, input, or output are accepted. Non-input files are copied into ComfyUI/input.",
                "prompt": "Positive motion/content prompt for Wan22 Dasiwa.",
                "negative": "Negative prompt override.",
                "width": "Video latent width, aligned to multiples of 8. Default 832 is landscape.",
                "height": "Video latent height, aligned to multiples of 8. Default 480 is landscape.",
                "fps": "Video frame rate and VHS_VideoCombine frame_rate.",
                "seconds": "Duration helper used to compute default length. Default 3 seconds.",
                "length": "Frame count override; default is seconds * fps + 1.",
                "frames": "Alias for length.",
                "seed": "Noise seed used by both KSamplerAdvanced nodes.",
                "steps": "Sampler steps. The gateway splits the two Dasiwa samplers at steps // 2.",
                "cfg": "Sampler CFG.",
                "sampler_name": "ComfyUI sampler name for both Dasiwa sampler nodes.",
                "scheduler": "ComfyUI scheduler for both Dasiwa sampler nodes.",
                "crf": "VideoCombine CRF, 0-51.",
                "format": "VHS_VideoCombine format, default video/h264-mp4.",
                "pix_fmt": "VHS_VideoCombine pixel format, default yuv420p.",
                "save_metadata": "Whether VHS_VideoCombine stores metadata.",
                "pingpong": "Whether VHS_VideoCombine writes ping-pong playback.",
                "filename_prefix": "Video filename prefix. %date:...% templates are expanded by the gateway and Windows-invalid characters are sanitized.",
                "wait": "When false, submit and return prompt_id without polling.",
                "timeout": "Polling timeout in seconds when wait is true.",
                "dry_run": "When true, return the generated ComfyUI API workflow without submitting it.",
            },
            "notes": [
                "Agents should pass width, height, seconds, and fps explicitly. Omitting them uses the default 832x480 landscape, 3-second, 16-fps video.",
                "Use width smaller than height for portrait, for example width=480 and height=832.",
                "Use dry_run=true to inspect the generated ComfyUI API workflow before running the heavy Wan22 model.",
            ],
            "example": {
                "image_path": str(INPUT_DIR / "example.png"),
                "prompt": "镜头缓慢推进，主体自然移动，画面稳定",
                "width": 480,
                "height": 832,
                "seconds": 5,
                "fps": 16,
            },
        },
        "response": {
            "submitted": ["ok", "prompt_id", "status", "selected_loras"],
            "completed": ["ok", "prompt_id", "status", "completed", "images", "videos", "image_path", "video_path", "image_url", "video_url"],
            "error": ["ok", "error", "details"],
        },
    }
    payload["moss_image"] = {
        "endpoint": "POST /txt2img",
        "model": "moss_image_sft",
        "deprecated_accelerated_model": {
            "model": "moss_image_sft_dmd8", "steps": 8, "width": 1024, "height": 1024,
            "cfg": 3, "acceleration_lora": "MOSS-Image\\moss_sft_8step_dmd_latest.safetensors",
            "strength": 1.0, "upscale_methods": ["none", "omnisr", "seedvr2"],
            "notes": "Acceleration is built in; do not pass the DMD LoRA again. Ordinary SFT with steps=8 is not equivalent.",
        },
        "options": GENERATION_MODELS["moss_image_sft"]["options"],
        "migration": "Use model=moss_image_sft with moss_dmd=true instead of the old DMD model key. Legacy keys are accepted but no longer enumerated; explicit dimensions/steps are preserved. face_detail is independent, runs before upscale, inherits ordinary LoRAs but never DMD.",
        "defaults": {"width": 1184, "height": 896, "steps": 30, "cfg": 3, "upscale_method": "none"},
        "fields": {
            "upscale_method": "none, omnisr or seedvr2; no additional denoise sampler.",
            "upscale_scale": "OmniSR only: integer 2, 3 or 4, default 2.",
            "seedvr2_resolution": "SeedVR2 shortest edge, even integer 16-16384; default 2560.",
            "seedvr2_max_resolution": "SeedVR2 longest-edge cap, even 0-16384; default 2560; 0 disables cap.",
            "upscale_seed": "SeedVR2 seed 0..2^32-1; defaults to generation seed modulo 2^32.",
        },
        "notes": "MOSS Image T2I saved workflow, SFT INT8 + Qwen3.5 INT8/moss_image + Flux2 VAE. Width/height multiples of 16. SeedVR2 uses installed 7b sharp FP16, 36 swapped blocks, CPU offload, no model cache. Plain layout prompt with no bounding boxes. LoRAs supported; UI-only logo and preview nodes omitted.",
        "examples": [
            {"model": "moss_image_sft", "prompt": "A red cube on a white table", "upscale_method": "omnisr", "upscale_scale": 2},
            {"model": "moss_image_sft", "prompt": "A red cube on a white table", "upscale_method": "seedvr2", "seedvr2_resolution": 1536, "seedvr2_max_resolution": 2048},
        ],
    }
    payload["txt2img"]["moss_image"] = payload["moss_image"]
    payload["txt2img"]["face_detail"] = {
        "enabled_field": "face_detail", "default": False,
        "supported_models": [k for k, s in GENERATION_MODELS.items() if "face_detail" in s.get("options", {})],
        "parameters_source": "GET /models models[model].options (defaults, ranges, available/missing)",
        "defaults_krea2_anima": {"face_denoise": 0.2, "face_steps": 30, "face_cfg_krea2": 1, "face_cfg_anima": 3,
                                "face_sampler_name": "euler", "face_scheduler": "normal", "face_guide_size": 1024,
                                "face_max_size": 2048, "face_crop_factor": 1.5, "face_noise_mask_feather": 20},
        "order": "Krea2: after latent hires/color match, before optional USD; Anima: after final decode, before save.",
        "response": "face_options contains resolved parameters; face_detail_result contains status/detected_faces/faces. node72 history contains measurements. No face passes through.",
        "notes": "Same selected model/CLIP/VAE and ordinary LoRAs. Krea2 retains ConditioningZeroOut negative. Explicit face_* parameters override defaults. Optional dependency failures return 503/details.missing. MOSS denoise stays 0.8.",
    }
    payload["endpoint_schemas"] = {
        "POST /txt2img": payload["txt2img"],
        "POST /txt2img/mingyun": payload["txt2img"],
        "POST /img2caption": payload["img2caption"],
        "POST /image/prompt": payload["image_prompt"],
        "POST /image/metadata": payload["image_metadata"],
        "POST /video/upscale": payload["video_upscale"],
        "POST /video/interpolate": payload["video_interpolate"],
        "POST /img2video/dasiwa": payload["img2video_dasiwa"],
        "GET /models": payload["models"],
        "GET /loras": payload["lora"],
    }
    return payload


def parse_lora_list_options(query_string: str) -> dict[str, Any]:
    params = urllib.parse.parse_qs(query_string, keep_blank_values=True)
    query = str(params.get("query", [""])[0]).strip()
    raw_limit = str(params.get("limit", [LORA_LIST_DEFAULT_LIMIT])[0]).strip()
    try:
        requested_limit = int(raw_limit or LORA_LIST_DEFAULT_LIMIT)
    except ValueError as exc:
        raise GatewayError("LoRA limit must be an integer", 400, {"limit": raw_limit}) from exc
    if requested_limit <= 0:
        raise GatewayError("LoRA limit must be greater than zero", 400, {"limit": requested_limit})
    refresh = str(params.get("refresh", [""])[0]).strip().lower() in {"1", "true", "yes", "on"}
    return {
        "query": query,
        "terms": [term.casefold() for term in query.split() if term],
        "requested_limit": requested_limit,
        "limit": min(requested_limit, LORA_LIST_MAX_LIMIT),
        "refresh": refresh,
    }


def filter_lora_names(names: list[str], terms: list[str], limit: int) -> tuple[list[str], int]:
    filtered = names if not terms else [name for name in names if all(term in name.casefold() for term in terms)]
    return filtered[:limit], len(filtered)


def local_lora_names() -> list[str]:
    root = LORA_DIR.resolve()
    if not root.is_dir():
        return []
    names: list[str] = []
    for path in LORA_DIR.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in LORA_MODEL_EXTENSIONS:
            continue
        resolved = path.resolve()
        if root != resolved and root not in resolved.parents:
            continue
        names.append(str(resolved.relative_to(root)).replace("/", "\\"))
    return sorted(names, key=str.casefold)


def lora_list_payload(gateway: "AgentComfyGateway", query_string: str) -> dict[str, Any]:
    options = parse_lora_list_options(query_string)
    names, cache = gateway.loras_with_status(force_refresh=options["refresh"])
    returned_names, filtered_count = filter_lora_names(names, options["terms"], options["limit"])
    return {
        "ok": True,
        "loras": returned_names,
        "total": len(names),
        "filtered": filtered_count,
        "returned": len(returned_names),
        "query": options["query"],
        "limit": options["limit"],
        "requested_limit": options["requested_limit"],
        "max_limit": LORA_LIST_MAX_LIMIT,
        "truncated": len(returned_names) < filtered_count,
        "source": cache["source"],
        "cache": cache,
    }


class AgentThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request: Any, client_address: Any) -> None:
        error = sys.exc_info()[1]
        if isinstance(error, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


class AgentComfyGateway:

    def __init__(self, comfy_url: str):
        self.comfy_url = comfy_url.rstrip("/")
        self._lora_cache: list[str] | None = None
        self._lora_cache_at = 0.0
        self._lora_cache_source = ""
        self._lora_cache_lock = threading.Lock()

    def submit(self, workflow: dict[str, Any]) -> str:
        response = json_request(
            "POST",
            f"{self.comfy_url}/prompt",
            {"prompt": workflow, "client_id": "agent-comfy-gateway"},
            timeout=30,
        )
        errors = response.get("node_errors") if isinstance(response, dict) else None
        if errors:
            raise GatewayError("ComfyUI rejected workflow", 400, errors)
        prompt_id = response.get("prompt_id") if isinstance(response, dict) else None
        if not prompt_id:
            raise GatewayError("ComfyUI did not return prompt_id", 502, response)
        return str(prompt_id)

    def history(self, prompt_id: str) -> dict[str, Any]:
        return json_request("GET", f"{self.comfy_url}/history/{prompt_id}", timeout=30)

    def interrupt(self) -> dict[str, Any]:
        response = json_request("POST", f"{self.comfy_url}/interrupt", {}, timeout=30)
        return {"ok": True, "comfy": response}

    def loras_with_status(self, force_refresh: bool = False) -> tuple[list[str], dict[str, Any]]:
        now = time.monotonic()
        with self._lora_cache_lock:
            cache_age = max(0.0, now - self._lora_cache_at)
            if not force_refresh and self._lora_cache is not None and cache_age < LORA_LIST_CACHE_TTL:
                return list(self._lora_cache), {
                    "hit": True,
                    "stale": False,
                    "age_seconds": round(cache_age, 3),
                    "ttl_seconds": LORA_LIST_CACHE_TTL,
                    "source": self._lora_cache_source,
                }

            refresh_error = ""
            try:
                response = json_request("GET", f"{self.comfy_url}/models/loras", timeout=30)
                if not isinstance(response, list):
                    raise GatewayError("ComfyUI returned an unexpected LoRA list", 502, response)
                names = [str(item) for item in response]
                source = "comfyui"
            except (GatewayError, json.JSONDecodeError, UnicodeDecodeError) as exc:
                refresh_error = str(exc)
                if self._lora_cache is not None:
                    return list(self._lora_cache), {
                        "hit": True,
                        "stale": True,
                        "age_seconds": round(cache_age, 3),
                        "ttl_seconds": LORA_LIST_CACHE_TTL,
                        "source": self._lora_cache_source,
                        "refresh_error": refresh_error,
                    }
                names = local_lora_names()
                if not names:
                    raise GatewayError("Cannot load LoRA list", 502, {"error": refresh_error}) from exc
                source = "filesystem"

            self._lora_cache = names
            self._lora_cache_at = time.monotonic()
            self._lora_cache_source = source
            status: dict[str, Any] = {
                "hit": False,
                "stale": False,
                "age_seconds": 0.0,
                "ttl_seconds": LORA_LIST_CACHE_TTL,
                "source": source,
            }
            if refresh_error:
                status["refresh_error"] = refresh_error
            return list(names), status

    def loras(self, force_refresh: bool = False) -> list[str]:
        names, _ = self.loras_with_status(force_refresh=force_refresh)
        return names

    def wait(self, prompt_id: str, timeout: float) -> dict[str, Any]:
        deadline = time.time() + timeout
        while time.time() < deadline:
            history = self.history(prompt_id)
            entry = history.get(prompt_id) if isinstance(history, dict) else None
            if entry:
                return entry
            time.sleep(1.0)
        raise GatewayError("Timed out waiting for image", 504, {"prompt_id": prompt_id})

    def collect_outputs(self, entry: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
        images: list[dict[str, Any]] = []
        videos: list[dict[str, Any]] = []
        for output in entry.get("outputs", {}).values():
            for image in output.get("images", []) or []:
                images.append(
                    {
                        **image,
                        "path": media_path_from_output(image),
                        "url": media_url(self.comfy_url, image),
                    }
                )
            for key in ("videos", "gifs"):
                for video in output.get(key, []) or []:
                    videos.append(
                        {
                            **video,
                            "path": media_path_from_output(video),
                            "url": media_url(self.comfy_url, video),
                        }
                    )
        return {"images": images, "videos": videos}

    def run_workflow(self, workflow: dict[str, Any], request: dict[str, Any], timeout_default: float) -> dict[str, Any]:
        wait = bool(request.get("wait", True))
        timeout = float(request.get("timeout", timeout_default))
        prompt_id = self.submit(workflow)
        result: dict[str, Any] = {"ok": True, "prompt_id": prompt_id, "status": "submitted"}
        if not wait:
            return result

        entry = self.wait(prompt_id, timeout)
        outputs = self.collect_outputs(entry)
        result.update(
            {
                "status": entry.get("status", {}).get("status_str", "done"),
                "completed": entry.get("status", {}).get("completed", False),
                **outputs,
            }
        )
        if outputs["images"]:
            result["image_path"] = outputs["images"][0]["path"]
            result["image_url"] = outputs["images"][0]["url"]
        if outputs["videos"]:
            result["video_path"] = outputs["videos"][0]["path"]
            result["video_url"] = outputs["videos"][0]["url"]
        return result

    def txt2img(self, request: dict[str, Any]) -> dict[str, Any]:
        selected_loras = normalize_loras(request)
        selected_model_key, selected_model = resolve_generation_model(request, PRESETS.get(str(request.get("preset") or "anime_manga"), PRESETS["anime_manga"]))
        workflow = build_anime_manga_workflow(request)
        moss_options = None
        if "face_detail" in selected_model.get("options", {}):
            moss_options = {"moss_dmd": "90" in workflow, "face_detail": "72" in workflow,
                            "face_diagnostic_export": request.get("face_diagnostic_export", False),
                            "steps": workflow["3"]["inputs"]["steps"],
                            "upscale_method": request.get("upscale_method", "none"),
                            "face_parameters": {k: v for k, v in workflow.get("72", {}).get("inputs", {}).items()
                                                if k in {"steps", "cfg", "denoise", "seed", "sampler_name", "scheduler", "guide_size", "max_size", "noise_mask_feather"}}}
            missing = []
            if moss_options["face_detail"]:
                moss_options["face_parameters"]["crop_factor"] = workflow["71"]["inputs"]["crop_factor"]
            files = []
            if moss_options["moss_dmd"]:
                files.append(LORA_DIR / MOSS_LEGACY_DMD["acceleration_lora"])
            if moss_options["face_detail"]:
                files.append(COMFY_ROOT / "models/ultralytics/bbox/face_yolov8m.pt")
            missing.extend(str(p) for p in files if not p.is_file())
            required = {node["class_type"] for node in workflow.values()}
            if moss_options["face_detail"]:
                required.update(MOSS_FACE_NODES)
            for name in required:
                node_info = json_request("GET", f"{self.comfy_url}/object_info/{urllib.parse.quote(name, safe='')}")
                if not node_info:
                    missing.append(name)
                elif name == "GatewayMeasuredDetailer" and moss_options["face_diagnostic_export"]:
                    if "diagnostic_export" not in node_info.get(name, {}).get("input", {}).get("optional", {}):
                        missing.append("GatewayMeasuredDetailer.diagnostic_export (restart ComfyUI)")
            if missing:
                raise GatewayError("Missing MOSS dependencies", 503, {"missing": missing})
        if bool(request.get("dry_run", False)):
            return {
                "ok": True,
                "dry_run": True,
                "selected_loras": selected_loras,
                "selected_model_key": selected_model_key,
                "selected_model": selected_model,
                "workflow": workflow,
                **({"face_options": moss_options["face_parameters"]} if moss_options else {}),
                **({"moss_options": moss_options} if moss_options else {}),
            }
        result = self.run_workflow(workflow, request, 600)
        result["selected_loras"] = selected_loras
        result["selected_model_key"] = selected_model_key
        result["selected_model"] = selected_model
        if moss_options:
            result["moss_options"] = moss_options
            result["face_options"] = moss_options["face_parameters"]
            face_result = {"status": "disabled", "detected_faces": None, "faces": []}
            if moss_options["face_detail"]:
                face_result["status"] = "pending" if not result.get("completed") else "unknown"
                if result.get("completed"):
                    entry = self.history(result["prompt_id"]).get(result["prompt_id"], {})
                    texts = entry.get("outputs", {}).get("74", {}).get("text", [])
                    if texts and str(texts[0]).isdigit():
                        count = int(texts[0])
                        face_result.update(status="no_face" if count == 0 else "completed", detected_faces=count)
                    measurements = entry.get("outputs", {}).get("72", {}).get("gateway_face_measurements", [])
                    if measurements:
                        face_result["faces"] = json.loads(measurements[0])
                    if moss_options["face_diagnostic_export"] and result.get("image_path"):
                        face_result["final_image_path"] = result["image_path"]
            result["face_detail_result"] = face_result
        return result

    def img2video_dasiwa(self, request: dict[str, Any]) -> dict[str, Any]:
        workflow = build_dasiwa_workflow(request)
        if bool(request.get("dry_run", False)):
            return {"ok": True, "dry_run": True, "workflow": workflow}
        return self.run_workflow(workflow, request, 1800)


def read_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    raw = handler.rfile.read(length) if length else b"{}"
    try:
        payload = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise GatewayError(f"Invalid JSON: {exc}", 400) from exc
    if not isinstance(payload, dict):
        raise GatewayError("JSON body must be an object", 400)
    return payload


def configure_standard_streams() -> None:
    if os.environ.get("AGENT_COMFY_LOG_TO_FILES", "").strip().lower() not in {"1", "true", "yes"}:
        return
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    sys.stdout = open(LOG_DIR / "agent_gateway_stdout.log", "a", encoding="utf-8", buffering=1)
    sys.stderr = open(LOG_DIR / "agent_gateway_stderr.log", "a", encoding="utf-8", buffering=1)


def not_found_payload(method: str, path: str, comfy_url: str) -> dict[str, Any]:
    help_payload = gateway_help(comfy_url)
    return {
        "ok": False,
        "error": "Not found",
        "path": path,
        "hint": "Unknown gateway route. Use GET /help to get the machine-readable endpoint schema.",
        "help_url": "http://127.0.0.1:8765/help",
        "method": method,
        "available_endpoints": list(help_payload["endpoints"].keys()),
    }


def enum_from_object_info(info: dict[str, Any], class_type: str, input_name: str) -> list[str]:
    node_info = info.get(class_type, {}) if isinstance(info, dict) else {}
    field = node_info.get("input", {}).get("required", {}).get(input_name)
    if isinstance(field, list) and field and isinstance(field[0], list):
        return [str(item) for item in field[0]]
    return []


def generation_models_payload(comfy_url: str) -> dict[str, Any]:
    installed: dict[str, list[str]] = {}
    available_nodes: set[str] = set()
    try:
        info = json_request("GET", f"{comfy_url}/object_info", timeout=30)
        available_nodes = set(info.keys()) if isinstance(info, dict) else set()
        installed = {
            "checkpoints": enum_from_object_info(info, "CheckpointLoaderSimple", "ckpt_name"),
            "diffusion_models": enum_from_object_info(info, "UNETLoader", "unet_name"),
            "clip": enum_from_object_info(info, "CLIPLoader", "clip_name"),
            "clip_types": enum_from_object_info(info, "CLIPLoader", "type"),
            "vae": enum_from_object_info(info, "VAELoader", "vae_name"),
        }
    except GatewayError as exc:
        installed = {"error": [str(exc)]}

    def installed_for(spec: dict[str, Any]) -> bool:
        kind = str(spec.get("kind") or "")
        if kind == "checkpoint":
            return str(spec.get("checkpoint")) in installed.get("checkpoints", [])
        if kind == "modular":
            return (
                str(spec.get("unet")) in installed.get("diffusion_models", [])
                and str(spec.get("clip")) in installed.get("clip", [])
                and (not spec.get("clip_type") or str(spec.get("clip_type")) in installed.get("clip_types", []))
                and str(spec.get("vae")) in installed.get("vae", [])
                and all(str(node) in available_nodes for node in spec.get("required_nodes", []))
                and (not spec.get("acceleration_lora") or (LORA_DIR / spec["acceleration_lora"]).is_file())
            )
        return False

    models = {
        key: {
            **copy.deepcopy(spec),
            "installed": installed_for(spec),
        }
        for key, spec in GENERATION_MODELS.items()
    }
    for model in models.values():
        if "face_detail" not in model.get("options", {}):
            continue
        option_dependencies = {
            "moss_dmd": (["LoraLoaderModelOnly"], [LORA_DIR / MOSS_LEGACY_DMD["acceleration_lora"]]),
            "face_detail": (MOSS_FACE_NODES, [COMFY_ROOT / "models/ultralytics/bbox/face_yolov8m.pt"]),
        }
        for name, (nodes, files) in option_dependencies.items():
            if name not in model["options"]:
                continue
            missing = [node for node in nodes if node not in available_nodes]
            missing += [str(path) for path in files if not path.is_file()]
            model["options"][name].update(available=not missing, missing=missing)
    return {
        "ok": True,
        "default": "gembyte_emerald",
        "selection_fields": ["model", "base_model"],
        "models": models,
        "installed": installed,
    }


def make_handler(gateway: AgentComfyGateway):
    class Handler(BaseHTTPRequestHandler):
        server_version = "AgentComfyGateway/0.1"

        def do_GET(self) -> None:
            try:
                parsed_url = urllib.parse.urlparse(self.path)
                path = parsed_url.path
                if path == "/health":
                    self.send_json({"ok": True, "comfy_url": gateway.comfy_url})
                elif path == "/help":
                    self.send_json({"ok": True, "help": gateway_help(gateway.comfy_url)})
                elif path == "/models":
                    self.send_json(generation_models_payload(gateway.comfy_url))
                elif path == "/presets":
                    self.send_json({"ok": True, "presets": PRESETS})
                elif path == "/loras":
                    self.send_json(lora_list_payload(gateway, parsed_url.query))
                elif path == "/lora-info":
                    query = urllib.parse.parse_qs(parsed_url.query)
                    self.send_json(lora_info_payload(query.get("name", [""])[0]))
                elif path == "/lora-preview":
                    query = urllib.parse.parse_qs(parsed_url.query)
                    self.send_file(lora_preview_path(query.get("name", [""])[0]))
                elif path.startswith("/history/"):
                    prompt_id = urllib.parse.unquote(path.split("/history/", 1)[1])
                    self.send_json({"ok": True, "history": gateway.history(prompt_id)})
                else:
                    self.send_json(not_found_payload("GET", path, gateway.comfy_url), 404)
            except GatewayError as exc:
                self.send_json({"ok": False, "error": str(exc), "details": exc.details}, exc.status)
            except Exception as exc:
                self.send_json({"ok": False, "error": repr(exc)}, 500)

        def do_POST(self) -> None:
            try:
                path = urllib.parse.urlparse(self.path).path
                payload = read_body(self)
                if path == "/txt2img":
                    self.send_json(gateway.txt2img(payload))
                elif path == "/txt2img/mingyun":
                    payload.setdefault(
                        "prompt",
                        "1 adult woman, solo, Mingyun, very long silver-white hair, "
                        "side braids, lavender-purple eyes, round thin-rim glasses, "
                        "glasses chain, gentle sleepy smile, white high-neck qipao dress",
                    )
                    payload.setdefault("filename_prefix", "agent_comfy_mingyun")
                    self.send_json(gateway.txt2img(payload))
                elif path == "/open-path":
                    self.send_json(open_path_with_system_app(payload))
                elif path == "/interrupt":
                    self.send_json(gateway.interrupt())
                elif path == "/img2caption":
                    self.send_json(caption_image(payload))
                elif path in IMAGE_PROMPT_PATHS:
                    self.send_json(extract_image_prompt_info(payload))
                elif path in IMAGE_METADATA_PATHS:
                    self.send_json(extract_image_metadata(payload))
                elif path == "/video/upscale":
                    self.send_json(upscale_video(payload))
                elif path == "/video/interpolate":
                    self.send_json(interpolate_video(payload))
                elif path == "/img2video/dasiwa":
                    self.send_json(gateway.img2video_dasiwa(payload))
                else:
                    self.send_json(not_found_payload("POST", path, gateway.comfy_url), 404)
            except GatewayError as exc:
                self.send_json({"ok": False, "error": str(exc), "details": exc.details}, exc.status)
            except Exception as exc:  # Keep local agent service from dropping the socket silently.
                self.send_json({"ok": False, "error": repr(exc)}, 500)

        def log_message(self, fmt: str, *args: Any) -> None:
            if os.environ.get("AGENT_COMFY_QUIET", "").strip().lower() in {"1", "true", "yes"}:
                return
            sys.stderr.write(
                "%s - - [%s] %s\n"
                % (self.address_string(), self.log_date_time_string(), fmt % args)
            )
            sys.stderr.flush()

        def send_json(self, payload: dict[str, Any], status: int = 200) -> None:
            raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            try:
                self.close_connection = True
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(raw)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(raw)
                self.wfile.flush()
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, OSError):
                return

        def send_file(self, path: Path) -> None:
            try:
                raw = path.read_bytes()
                content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, OSError):
                return

    return Handler


def main() -> None:
    configure_standard_streams()
    parser = argparse.ArgumentParser(description="Local agent gateway for ComfyUI.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--comfy-url", default=DEFAULT_COMFY_URL)
    args = parser.parse_args()

    gateway = AgentComfyGateway(args.comfy_url)
    server = AgentThreadingHTTPServer((args.host, args.port), make_handler(gateway))
    print(f"Agent Comfy Gateway listening on http://{args.host}:{args.port}")
    print(f"Forwarding to ComfyUI at {args.comfy_url}")
    server.serve_forever()


if __name__ == "__main__":
    main()
