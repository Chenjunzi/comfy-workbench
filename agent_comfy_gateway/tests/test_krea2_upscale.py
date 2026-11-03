from __future__ import annotations

import unittest

from agent_comfy_gateway import server


class Krea2HiresTests(unittest.TestCase):
    def build(self, **overrides):
        request = {
            "prompt": "a red cube on a white table",
            "model": "krea2_turbo",
            "width": 64,
            "height": 96,
            "seed": 11,
            **overrides,
        }
        return server.build_anime_manga_workflow(request)

    def assert_bad(self, **request):
        with self.assertRaises(server.GatewayError) as raised:
            self.build(**request)
        self.assertEqual(raised.exception.status, 400)

    def test_zero_stage_is_rejected(self) -> None:
        self.assert_bad()
        self.assert_bad(upscale_mode="single", upscale_scale=1.5)
        self.assert_bad(upscale_mode="pixel", upscale_scale=1.5)

    def test_one_stage_defaults_match_reference(self) -> None:
        workflow = self.build(upscale_mode="krea2_hires")
        first = workflow["3"]["inputs"]
        second = workflow["15"]["inputs"]
        self.assertEqual(workflow["5"]["inputs"], {"width": 64, "height": 96, "batch_size": 1})
        self.assertEqual(workflow["3"]["class_type"], "KSamplerAdvanced")
        self.assertEqual((first["steps"], first["cfg"], first["sampler_name"], first["scheduler"]), (7, 1.0, "euler", "simple"))
        self.assertEqual((first["start_at_step"], first["end_at_step"], first["return_with_leftover_noise"]), (0, 7, "enable"))
        self.assertEqual(workflow["14"]["inputs"], {"samples": ["3", 0], "upscale_method": "bislerp", "scale_by": 1.5})
        self.assertEqual(workflow["15"]["class_type"], "KSamplerAdvanced")
        self.assertEqual((second["steps"], second["cfg"], second["start_at_step"], second["end_at_step"]), (10, 1.0, 6, 999))
        self.assertEqual((second["sampler_name"], second["scheduler"], second["return_with_leftover_noise"]), ("euler", "simple", "disable"))
        self.assertEqual(workflow["18"]["inputs"], {"image_target": ["16", 0], "image_ref": ["8", 0], "method": "mkl", "strength": 0.5, "multithread": True})
        self.assertEqual(workflow["30"]["inputs"]["anything"], ["18", 0])
        self.assertNotIn("65", workflow)
        self.assertNotIn("ConditioningKrea2Rebalance", [node["class_type"] for node in workflow.values()])
        self.assertEqual(first["positive"], ["6", 0])
        self.assertEqual(second["negative"], ["13", 0])

    def test_denoise_converts_to_start_at_step(self) -> None:
        workflow = self.build(upscale_mode="krea2_hires", second_steps=20, second_denoise=0.25)
        self.assertEqual(workflow["15"]["inputs"]["start_at_step"], 15)

    def test_two_stage_builds_reference_usd_nodes(self) -> None:
        workflow = self.build(
            upscale_mode="two_stage", upscale_stages=2, upscale_scale=1.5,
            second_stage_upscale_scale=1.5, third_seed=33, third_steps=3,
            third_cfg=1, third_denoise=0.12, third_sampler_name="euler", third_scheduler="simple",
        )
        self.assertEqual(workflow["60"]["inputs"]["model_name"], "OmniSR_X4_DIV2K.safetensors")
        self.assertEqual(workflow["61"]["inputs"]["image"], ["18", 0])
        self.assertEqual(workflow["62"]["inputs"]["value"], 2.0)
        self.assertEqual(workflow["63"]["inputs"]["value"], 1.5)
        self.assertEqual(workflow["64"]["inputs"], {"value_1": "a*c/d", "value_2": "b*c/d", "a": ["61", 0], "b": ["61", 1], "c": ["63", 0], "d": ["62", 0]})
        usd = workflow["65"]["inputs"]
        self.assertEqual((usd["steps"], usd["cfg"], usd["denoise"], usd["mode_type"]), (3, 1.0, 0.12, "Linear"))
        self.assertEqual((usd["tile_width"], usd["tile_height"]), (["64", 0], ["64", 2]))
        self.assertEqual((usd["mask_blur"], usd["tile_padding"], usd["seam_fix_mode"]), (16, 64, "None"))
        self.assertEqual(workflow["66"]["inputs"], {"image_target": ["65", 0], "image_ref": ["8", 0], "method": "mkl", "strength": 0.7, "multithread": True})
        self.assertEqual(workflow["30"]["inputs"]["anything"], ["66", 0])

    def test_lora_ref_reaches_advanced_samplers_and_usd(self) -> None:
        workflow = self.build(
            upscale_mode="two_stage", upscale_scale=1.5, second_stage_upscale_scale=1.5,
            lora=r"Mingyun\Krea2\example.safetensors", lora_strength=0.7,
        )
        for node_id in ("3", "15", "65"):
            self.assertEqual(workflow[node_id]["inputs"]["model"], ["100", 0])

    def test_stage_count_scale_and_fields_are_strict(self) -> None:
        self.assert_bad(upscale_mode="two_stage", upscale_stages=3)
        self.assert_bad(upscale_mode="two_stage", upscale_stages=1)
        self.assert_bad(upscale_mode="krea2_hires", third_steps=3)
        self.assert_bad(upscale_mode="krea2_hires", upscale_scale=0.5)
        self.assert_bad(upscale_mode="krea2_hires", upscale_scale=1.5, stage_upscale_scale=2.0)
        self.assert_bad(upscale_mode="krea2_hires", second_steps=0)
        self.assert_bad(upscale_mode="krea2_hires", second_cfg=101)
        self.assert_bad(upscale_mode="krea2_hires", second_denoise=1.1)
        self.assert_bad(upscale_mode="krea2_hires", second_sampler_name="bad")
        self.assert_bad(upscale_mode="krea2_hires", second_scheduler="bad")
        self.assert_bad(upscale_mode="krea2_hires", upscale_model="OmniSR_X2_DIV2K.safetensors")

    def test_contract_describes_reference_alignment(self) -> None:
        contract = server.GENERATION_MODELS["krea2_turbo"]["upscale_contract"]
        self.assertEqual((contract["min_stages"], contract["max_stages"]), (1, 2))
        self.assertEqual(contract["latent_hires"]["default_scale"], 1.5)
        self.assertEqual(contract["latent_hires"]["defaults"]["denoise"], 0.4)
        self.assertEqual(contract["ultimate_sd_upscale"]["defaults"]["denoise"], 0.12)
        self.assertEqual(contract["ultimate_sd_upscale"]["default_scale"], 1.5)
        self.assertEqual(contract["output_alignment"]["reference"]["ultimate_sd_upscale"], [1616, 2880])


if __name__ == "__main__":
    unittest.main()