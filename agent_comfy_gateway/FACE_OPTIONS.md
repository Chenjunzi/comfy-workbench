# Krea2 and Anima face detail

POST /txt2img with `face_detail: true`. Off by default.
Read `models[model].options` from GET /models for per-model defaults, ranges and
face_detail.available/missing. Krea2 and Anima default face_denoise=.2; MOSS stays .8.
Supported Anima keys: wai_anima_v10, miaomiao_harem, miaomiao_harem_anima13,
miaomiao_harem_ani25d_v10, miaomiao_realskin, tekito_mix_v21.
K2: krea2_turbo and dasiwa_krea2_turbo_raw.

Fields: face_steps=30, face_cfg=1 for K2 / 3 for Anima, face_denoise=.2,
face_sampler_name=euler, face_scheduler=normal, face_seed inherits generation seed,
face_guide_size=1024, face_max_size=2048, face_crop_factor=1.5,
face_noise_mask_feather=20, face_diagnostic_export=false. Explicit values win.
Ranges and choices are in each model's options. Missing dependencies return
503/details.missing. Diagnostics/measurements use the same adapter as MOSS.

K2 requires its existing upscale_mode=krea2_hires or two_stage. Face input is the
latent-hires color-match output; optional USD takes the repaired image. Anima
repairs the final decoded image after its existing upscale chain. Both use the
selected model's final ordinary-LoRA MODEL, matching CLIP and VAE. K2 retains
ConditioningZeroOut negative. No separate face model is selected or substituted.

`face_options` returns resolved parameters. `face_detail_result` reports
disabled/pending/no_face/completed/unknown, detected_faces and measured faces.
For wait=false, GET /history/{prompt_id}: node74 count, node72 measurements.
No face passes through unchanged. face_diagnostic_export captures intermediate PNGs.

Workbench: expose the option whenever model.options.face_detail exists, disable
with missing-dependency explanation when available=false. Apply the selected
model's face_denoise default (0.2 for K2/Anima) only when no explicit user value
exists. Do not reuse MOSS's 0.8 as a global default. Persist settings per preset.

Validation: automated graph checks across both K2 models and six Anima enums,
single/two-stage paths, LoRA refs and overrides. No new image quality test was run;
the user will tune model-specific sampling parameters.
