import unittest

from agent_comfy_gateway import server


class KreaMergeTests(unittest.TestCase):
    def test_local_checkpoints_select_distinct_loaders_and_first_pass(self):
        for key, filename, encoder, sampler, scheduler in (
            ('classium_krea2_v10', 'classium_v10Krea2', 'qwen3VLInstruct4bHeretic_v10', 'euler_ancestral', 'simple'),
            ('sickanime_krea2_v10', 'krea2Sickanime_v10_fp8', 'qwen3vl_4b_fp8_scaled', 'er_sde', 'beta'),
        ):
            with self.subTest(key=key):
                w = server.build_anime_manga_workflow(dict(model=key, prompt='a red cube', upscale_mode='two_stage', lora='style.safetensors'))
                self.assertEqual(w['4']['inputs']['unet_name'], 'Krea2\\' + filename + '.safetensors')
                self.assertEqual(w['45']['inputs']['clip_name'], encoder + '.safetensors')
                self.assertEqual(w['46']['inputs']['vae_name'], 'qwen_image_vae.safetensors')
                self.assertEqual([w['3']['inputs'][f] for f in ('steps','cfg','sampler_name','scheduler')], [8,1,sampler,scheduler])
                self.assertEqual(w['100']['class_type'], 'LoraLoaderModelOnly')
                for node in ('3','15','65'):
                    self.assertEqual(w[node]['inputs']['model'], ['100',0])
