import json
import sys
import types
import unittest
from unittest.mock import patch
from agent_comfy_gateway.measured_detailer import GatewayMeasuredDetailer


class MeasurementTests(unittest.TestCase):
    def run_adapter(self, regions):
        image = types.SimpleNamespace(shape=(1, 768, 1024, 3))
        calls = []

        class FakeDetailer:
            def doit(self, **kw):
                calls.append(kw)
                hook = kw['detailer_hook']
                hook.post_upscale(types.SimpleNamespace(shape=(1, 1536, 2048, 3)))
                hook.post_encode({'samples': types.SimpleNamespace(shape=(1, 128, 96, 128))})
                pixels = types.SimpleNamespace(shape=(1, 1520, 2048, 3))
                assert hook.post_decode(pixels) is pixels
                return (kw['image'],)

        modules = {
            'impact': types.ModuleType('impact'),
            'impact.impact_pack': types.SimpleNamespace(DetailerForEach=FakeDetailer),
            'impact.hooks': types.SimpleNamespace(DetailerHook=object),
        }
        with patch.dict(sys.modules, modules):
            result = GatewayMeasuredDetailer().run(image, ((768, 1024), regions), seed=42)
        return result, calls

    def test_actual_tensors_not_config_and_history_json(self):
        seg = types.SimpleNamespace(bbox=(10, 20, 110, 170), crop_region=(0, 0, 400, 300))
        result, calls = self.run_adapter([seg, seg])
        records = json.loads(result['ui']['gateway_face_measurements'][0])
        self.assertEqual(records[0]['vae_input_size'], [2048, 1536])
        self.assertEqual(records[0]['bbox_size'], [100, 150])
        self.assertEqual(records[0]['crop_size'], [400, 300])
        self.assertEqual(records[0]['scaled_face_size'], [512, 768])
        self.assertEqual(records[0]['latent_shape'], [1, 128, 96, 128])
        self.assertEqual(records[0]['decoded_size_before_resize'], [2048, 1520])
        self.assertEqual([c['seed'] for c in calls], [42, 43])

    def test_no_faces_has_no_fake_measurements(self):
        result, calls = self.run_adapter([])
        self.assertEqual(calls, [])
        self.assertEqual(json.loads(result['ui']['gateway_face_measurements'][0]), [])
