from __future__ import annotations

import json
import os
import sys
import tempfile
import traceback
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import torch
from huggingface_hub import snapshot_download
from PIL import Image
from transformers import AutoModelForCausalLM, AutoModelForImageTextToText, AutoProcessor


PROJECT_ROOT = Path(__file__).resolve().parents[1]
COMFY_ROOT = Path(os.environ.get("COMFY_ROOT", PROJECT_ROOT / "ComfyUI")).expanduser().resolve()
MODEL_DIR = COMFY_ROOT / "models" / "LLM"
RMBG_ROOT = COMFY_ROOT / "custom_nodes" / "ComfyUI-RMBG"

TASK_TOKENS = {
    "caption": "<CAPTION>",
    "detailed_caption": "<DETAILED_CAPTION>",
    "more_detailed_caption": "<MORE_DETAILED_CAPTION>",
    "ocr": "<OCR>",
    "ocr_with_region": "<OCR_WITH_REGION>",
}


def load_request() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("Missing JSON request on stdin")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("JSON request must be an object")
    return payload


def resolve_model(model_name: str) -> str:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    target = MODEL_DIR / model_name.split("/")[-1]
    if target.exists():
        return str(target)
    return snapshot_download(model_name, local_dir=str(target), local_dir_use_symlinks=False)


def load_image(payload: dict[str, Any]) -> tuple[Image.Image, str]:
    image_path = str(payload.get("image_path") or "").strip()
    image_url = str(payload.get("image_url") or "").strip()
    if image_url:
        suffix = Path(urllib.parse.urlparse(image_url).path).suffix or ".png"
        handle = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        handle.close()
        urllib.request.urlretrieve(image_url, handle.name)
        image_path = handle.name
    if not image_path:
        raise ValueError("image_path or image_url is required")
    image = Image.open(image_path).convert("RGB")
    return image, image_path


def dtype_from_name(name: str) -> torch.dtype:
    if name == "bf16":
        return torch.bfloat16
    if name == "fp32":
        return torch.float32
    return torch.float16


def run(payload: dict[str, Any]) -> dict[str, Any]:
    provider = str(payload.get("provider") or "florence2").strip().lower()
    if provider in {"qwen", "qwen-vl"}:
        provider = "qwen_vl"
    if provider == "qwen_vl":
        return run_qwen_vl(payload)
    if provider != "florence2":
        raise ValueError(f"Unknown caption provider: {provider}")

    model_name = str(payload.get("model") or "microsoft/Florence-2-base-ft")
    task_name = str(payload.get("task") or "more_detailed_caption").strip().lower()
    token = TASK_TOKENS.get(task_name)
    if not token:
        raise ValueError(f"Unknown Florence2 task: {task_name}")

    prompt = str(payload.get("prompt") or "").strip()
    text = f"{token} {prompt}" if prompt else token
    precision = str(payload.get("precision") or "fp16").strip().lower()
    device_name = str(payload.get("device") or "cuda").strip().lower()
    device = "cuda" if device_name == "cuda" and torch.cuda.is_available() else "cpu"
    dtype = dtype_from_name(precision) if device == "cuda" else torch.float32

    image, loaded_image_path = load_image(payload)
    weights = resolve_model(model_name)

    processor = AutoProcessor.from_pretrained(weights, trust_remote_code=True)
    if RMBG_ROOT.exists():
        sys.path.insert(0, str(RMBG_ROOT))
        from models.modeling_florence2 import Florence2ForConditionalGeneration

        model = Florence2ForConditionalGeneration.from_pretrained(
            weights,
            torch_dtype=dtype,
            attn_implementation=str(payload.get("attention") or "sdpa"),
        ).to(device)
    else:
        model = AutoModelForCausalLM.from_pretrained(
            weights,
            trust_remote_code=True,
            torch_dtype=dtype,
            attn_implementation=str(payload.get("attention") or "sdpa"),
        ).to(device)
    model.eval()

    inputs = processor(text=text, images=image, return_tensors="pt").to(device)
    if "pixel_values" in inputs:
        inputs["pixel_values"] = inputs["pixel_values"].to(dtype)

    with torch.no_grad():
        generated_ids = model.generate(
            input_ids=inputs["input_ids"],
            pixel_values=inputs["pixel_values"],
            max_new_tokens=int(payload.get("max_new_tokens") or 512),
            num_beams=int(payload.get("num_beams") or 3),
            do_sample=bool(payload.get("do_sample", False)),
            use_cache=False,
        )
    raw = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
    parsed = processor.post_process_generation(raw, task=token, image_size=image.size)
    result = parsed.get(token, parsed)

    del model
    del processor
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()

    return {
        "ok": True,
        "provider": "florence2",
        "model": model_name,
        "task": task_name,
        "image_path": loaded_image_path,
        "caption": result if isinstance(result, str) else "",
        "data": result,
        "raw": raw,
    }


def run_qwen_vl(payload: dict[str, Any]) -> dict[str, Any]:
    model_name = str(payload.get("model") or "Qwen/Qwen2.5-VL-3B-Instruct")
    prompt = str(payload.get("prompt") or "请客观、完整地描述这张图片，用于数据集标注。请使用中性的视觉语言覆盖主体、人物、服装或裸露状态、动作姿态、背景、光线、风格和所有值得注意的细节。如果图中包含成人内容、裸露或敏感人体区域，不要拒绝、泛化或省略可见事实；请只用非情色、非评价性的解剖/服装/遮挡描述记录画面中实际可见的内容。").strip()
    precision = str(payload.get("precision") or "fp16").strip().lower()
    device_name = str(payload.get("device") or "cuda").strip().lower()
    device = "cuda" if device_name == "cuda" and torch.cuda.is_available() else "cpu"
    dtype = dtype_from_name(precision) if device == "cuda" else torch.float32

    image, loaded_image_path = load_image(payload)
    weights = resolve_model(model_name)

    processor = AutoProcessor.from_pretrained(weights, trust_remote_code=True)
    model = AutoModelForImageTextToText.from_pretrained(
        weights,
        trust_remote_code=True,
        torch_dtype=dtype,
        attn_implementation=str(payload.get("attention") or "sdpa"),
    ).to(device)
    model.eval()

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": prompt},
            ],
        }
    ]
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = processor(text=[text], images=[image], return_tensors="pt").to(device)
    if "pixel_values" in inputs:
        inputs["pixel_values"] = inputs["pixel_values"].to(dtype)

    with torch.no_grad():
        generated_ids = model.generate(
            **inputs,
            max_new_tokens=int(payload.get("max_new_tokens") or 512),
            do_sample=bool(payload.get("do_sample", False)),
        )
    input_len = inputs["input_ids"].shape[1]
    generated_ids = generated_ids[:, input_len:]
    caption = processor.batch_decode(generated_ids, skip_special_tokens=True, clean_up_tokenization_spaces=False)[0]

    del model
    del processor
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()

    return {
        "ok": True,
        "provider": "qwen_vl",
        "model": model_name,
        "prompt": prompt,
        "image_path": loaded_image_path,
        "caption": caption.strip(),
        "data": {"caption": caption.strip()},
    }


def main() -> int:
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    try:
        response = run(load_request())
    except Exception as exc:
        response = {"ok": False, "error": repr(exc), "traceback": traceback.format_exc()}
        sys.stdout.write(json.dumps(response, ensure_ascii=False))
        return 1
    sys.stdout.write(json.dumps(response, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
