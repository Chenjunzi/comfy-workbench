import unittest
from unittest import mock
from agent_comfy_gateway import server


class MossTests(unittest.TestCase):
    def test_missing_dependencies_and_legacy_override(self):
        g = server.AgentComfyGateway("http://test")
        with mock.patch.object(server, "json_request", return_value={}):
            with self.assertRaises(server.GatewayError) as caught:
                g.txt2img({"model": "moss_image_sft", "prompt": "cube", "face_detail": True, "dry_run": True})
            self.assertEqual(caught.exception.status, 503)
            self.assertIn("DetailerForEach", caught.exception.details["missing"])
        w = self.build(model="moss_image_sft_dmd8", moss_dmd=False, width=512, steps=17)
        self.assertNotIn("90", w)
        self.assertEqual(w["5"]["inputs"]["width"], 512)
        self.assertEqual(w["3"]["inputs"]["steps"], 17)

    def build(self, **kwargs):
        return server.build_anime_manga_workflow({
            "model": "moss_image_sft", "prompt": "A red cube", **kwargs})

    def test_base(self):
        w = self.build()
        self.assertEqual(w["5"]["class_type"], "EmptyFlux2LatentImage")
        self.assertEqual(w["45"]["inputs"]["type"], "moss_image")
        self.assertEqual(w["3"]["inputs"]["steps"], 30)
        self.assertEqual(w["17"]["inputs"]["images"], ["8", 0])

    def test_upscalers_and_lora(self):
        for scale in (2, 3, 4):
            w = self.build(upscale_method="omnisr", upscale_scale=scale)
            self.assertEqual(w["11"]["inputs"]["model_name"], server.UPSCALE_MODELS[scale])
        w = self.build(upscale_method="seedvr2", lora="example.safetensors")
        self.assertEqual(w["3"]["inputs"]["model"], ["100", 0])
        self.assertEqual(w["50"]["inputs"]["image"], ["49", 0])
        self.assertEqual(w["17"]["inputs"]["images"], ["50", 0])
        self.assertFalse(w["56"]["inputs"]["cache_model"])

    def test_invalid(self):
        for kw in ({"upscale_method": "bad"}, {"width": 100},
                   {"upscale_method": "omnisr", "upscale_scale": 2.5},
                   {"upscale_method": "seedvr2", "seedvr2_resolution": 513},
                   {"upscale_scale": 2}, {"second_steps": 3}):
            with self.subTest(kw=kw), self.assertRaises(server.GatewayError):
                self.build(**kw)

    def test_dmd8_both_upscalers_and_user_lora(self):
        for method, output in (("none", "8"), ("omnisr", "10"), ("seedvr2", "50")):
            w = self.build(model="moss_image_sft_dmd8", upscale_method=method)
            self.assertEqual(w["3"]["inputs"]["steps"], 8)
            self.assertEqual(w["5"]["inputs"]["width"], 1024)
            self.assertEqual(w["90"]["class_type"], "LoraLoaderModelOnly")
            self.assertEqual(w["90"]["inputs"]["strength_model"], 1.0)
            self.assertEqual(w["3"]["inputs"]["model"], ["90", 0])
            self.assertEqual(w["17"]["inputs"]["images"], [output, 0])
        w = self.build(model="moss_image_sft_dmd8", lora="style.safetensors")
        self.assertEqual(w["90"]["inputs"]["model"], ["4", 0])
        self.assertEqual(w["moss_main_lora_0"]["inputs"]["model"], ["90", 0])
        self.assertEqual(w["3"]["inputs"]["model"], ["moss_main_lora_0", 0])
        self.assertNotIn("90", self.build())
        with self.assertRaises(server.GatewayError):
            self.build(model="moss_image_sft_dmd8", lora=server.MOSS_LEGACY_DMD["acceleration_lora"])

    def test_four_combinations_and_isolation(self):
        self.assertNotIn("moss_image_sft_dmd8", server.GENERATION_MODELS)
        for dmd in (False, True):
            for face in (False, True):
                w = self.build(moss_dmd=dmd, face_detail=face, lora="style.safetensors", upscale_method="omnisr")
                self.assertEqual("90" in w, dmd)
                self.assertEqual("72" in w, face)
                self.assertEqual(w["3"]["inputs"]["steps"], 8 if dmd else 30)
                if dmd:
                    self.assertEqual(w["90"]["inputs"]["model"], ["4", 0])
                    self.assertEqual(w["moss_main_lora_0"]["inputs"]["model"], ["90", 0])
                if face:
                    self.assertEqual(w["72"]["inputs"]["model"], ["100", 0])
                    self.assertEqual(w["100"]["inputs"]["model"], ["4", 0])
                    self.assertEqual(w["72"]["inputs"]["steps"], 30)
                    self.assertEqual(w["72"]["inputs"]["scheduler"], "normal")
                    self.assertEqual(w["72"]["inputs"]["guide_size"], 1024)
                    self.assertEqual(w["72"]["inputs"]["max_size"], 2048)
                    self.assertEqual(w["10"]["inputs"]["image"], ["72", 0])
        for kw in ({"moss_dmd": "false"}, {"face_detail": 1}, {"face_detail": True, "face_denoise": 0}):
            with self.assertRaises(server.GatewayError):
                self.build(**kw)

    def test_explicit_face_sizes_preserved(self):
        w = self.build(face_detail=True, face_guide_size=256, face_max_size=512)
        self.assertEqual(w["72"]["class_type"], "GatewayMeasuredDetailer")
        self.assertEqual(w["72"]["inputs"]["guide_size"], 256)
        self.assertEqual(w["72"]["inputs"]["max_size"], 512)

    def test_face_crop_factor(self):
        self.assertEqual(self.build(face_detail=True)["71"]["inputs"]["crop_factor"], 1.5)
        self.assertEqual(self.build(face_detail=True, face_crop_factor=3)["71"]["inputs"]["crop_factor"], 3)
        for value in (0.5, 11, True, "nan"):
            with self.assertRaises(server.GatewayError):
                self.build(face_detail=True, face_crop_factor=value)

    def test_face_sampling_defaults_and_overrides(self):
        w = self.build(face_detail=True, moss_dmd=True)
        self.assertEqual(w["72"]["inputs"]["denoise"], 0.8)
        self.assertEqual(w["72"]["inputs"]["noise_mask_feather"], 20)
        self.assertEqual(w["72"]["inputs"]["feather"], 5)
        self.assertEqual(w["72"]["inputs"]["model"], ["4", 0])
        w = self.build(face_detail=True, face_denoise=0.4, face_noise_mask_feather=0)
        self.assertEqual(w["72"]["inputs"]["denoise"], 0.4)
        self.assertEqual(w["72"]["inputs"]["noise_mask_feather"], 0)
        for value in (-1, 101, 2.5, True):
            with self.assertRaises(server.GatewayError):
                self.build(face_detail=True, face_noise_mask_feather=value)
