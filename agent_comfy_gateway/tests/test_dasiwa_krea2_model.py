from __future__ import annotations

import unittest
from unittest import mock

from agent_comfy_gateway import server


MODEL_KEY = "dasiwa_krea2_turbo_raw"
UNET = r"Krea2\DasiwaKrea2TurboRaw_cutedisasterV2Turbo.safetensors"
CLIP = "qwen3VLInstruct4bHeretic_v10.safetensors"
VAE = "qwen_image_vae.safetensors"


class DasiwaKrea2ModelTests(unittest.TestCase):
    def request(self, **overrides):
        return {
            "prompt": "a small red cube on a white table",
            "model": MODEL_KEY,
            "width": 64,
            "height": 64,
            "seed": 17,
            **overrides,
        }

    def test_model_enum_has_evidenced_components_and_defaults(self) -> None:
        spec = server.GENERATION_MODELS[MODEL_KEY]
        self.assertEqual(spec["label"], "Dasiwa Krea 2 Turbo Raw CuteDisaster v2")
        self.assertEqual(spec["pipeline"], "krea2_hires")
        self.assertEqual(spec["unet"], UNET)
        self.assertEqual(spec["clip"], CLIP)
        self.assertEqual(spec["clip_type"], "krea2")
        self.assertEqual(spec["vae"], VAE)
        self.assertEqual((spec["default_width"], spec["default_height"]), (720, 1280))
        self.assertEqual((spec["steps"], spec["cfg"], spec["sampler_name"], spec["scheduler"]), (7, 1.0, "euler", "simple"))
        for alias in ("dasiwak2", "dasiwa_krea2", "cutedisaster"):
            self.assertEqual(server.generation_model_key(alias), MODEL_KEY)

    def test_models_payload_marks_model_installed(self) -> None:
        object_info = {
            "CheckpointLoaderSimple": {"input": {"required": {"ckpt_name": [[]]}}},
            "UNETLoader": {"input": {"required": {"unet_name": [[UNET]]}}},
            "CLIPLoader": {"input": {"required": {"clip_name": [[CLIP]], "type": [["krea2"]]}}},
            "VAELoader": {"input": {"required": {"vae_name": [[VAE]]}}},
            **{node: {} for node in server.KREA2_HIRES_REQUIRED_NODES},
        }
        with mock.patch.object(server, "json_request", return_value=object_info):
            payload = server.generation_models_payload("http://127.0.0.1:8188")
        self.assertTrue(payload["models"][MODEL_KEY]["installed"])

    def test_base_dry_run_requires_hires_and_uses_dasiwa_loader_chain(self) -> None:
        with self.assertRaises(server.GatewayError):
            server.build_anime_manga_workflow(self.request())
        workflow = server.build_anime_manga_workflow(self.request(upscale_mode="krea2_hires"))
        self.assertEqual(workflow["4"]["inputs"]["unet_name"], UNET)
        self.assertEqual(workflow["45"]["inputs"], {"clip_name": CLIP, "type": "krea2", "device": "default"})
        self.assertEqual(workflow["46"]["inputs"]["vae_name"], VAE)
        self.assertEqual(workflow["3"]["inputs"]["steps"], 7)
        self.assertEqual(workflow["15"]["class_type"], "KSamplerAdvanced")

    def test_second_fields_and_lora_inherit_krea2_denoise_pipeline(self) -> None:
        workflow = server.build_anime_manga_workflow(
            self.request(
                upscale_mode="krea2_hires",
                upscale_scale=1.5,
                second_steps=2,
                second_cfg=1,
                second_denoise=0.15,
                lora=r"Mingyun\Krea2\example.safetensors",
                lora_strength=0.6,
            )
        )
        self.assertEqual(workflow["14"]["class_type"], "LatentUpscaleBy")
        self.assertEqual(workflow["15"]["class_type"], "KSamplerAdvanced")
        self.assertEqual(workflow["15"]["inputs"]["start_at_step"], 2)
        self.assertEqual(workflow["100"]["class_type"], "LoraLoaderModelOnly")
        self.assertEqual(workflow["3"]["inputs"]["model"], ["100", 0])
        self.assertEqual(workflow["15"]["inputs"]["model"], ["100", 0])


if __name__ == "__main__":
    unittest.main()