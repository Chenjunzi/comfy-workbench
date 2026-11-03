import unittest
from agent_comfy_gateway import server


class ModelFaceTests(unittest.TestCase):
    def test_model_refs_defaults_and_upscale_order(self):
        for model in ['krea2_turbo', 'dasiwa_krea2_turbo_raw', *sorted(server.FACE_ANIMA_MODELS)]:
            for two in (False, True):
                with self.subTest(model=model, two=two):
                    krea = server.GENERATION_MODELS[model].get('pipeline') == 'krea2_hires'
                    r = dict(model=model, prompt='Adult portrait', face_detail=True, lora='style.safetensors')
                    if krea:
                        r['upscale_mode'] = 'two_stage' if two else 'krea2_hires'
                    elif two:
                        r['upscale_mode'] = 'two_stage'
                    w = server.build_anime_manga_workflow(r)
                    f = w['72']['inputs']
                    self.assertEqual(f['denoise'], .2)
                    self.assertEqual(f['noise_mask_feather'], 20)
                    self.assertEqual(f['model'], w['3']['inputs']['model'])
                    self.assertEqual(f['vae'], w['8']['inputs']['vae'])
                    self.assertEqual(f['negative'], ['13', 0] if krea else ['7', 0])
                    self.assertEqual(f['image'], ['18', 0] if krea else ['44' if two else '16', 0])
                    if krea and two:
                        self.assertEqual(w['65']['inputs']['image'], ['72', 0])
                    else:
                        self.assertEqual(w['30']['inputs']['anything'], ['72', 0])
                    r['face_detail'] = False
                    self.assertNotIn('72', server.build_anime_manga_workflow(r))

    def test_overrides(self):
        w = server.build_anime_manga_workflow(dict(model='wai_anima_v10', prompt='portrait', face_detail=True, face_denoise=.4, face_cfg=5, face_steps=12))
        self.assertEqual(w['72']['inputs']['denoise'], .4)
        self.assertEqual(w['72']['inputs']['cfg'], 5)
        self.assertEqual(w['72']['inputs']['steps'], 12)
