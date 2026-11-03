# Unified MOSS options

POST `/txt2img`, `model: "moss_image_sft"`. This is the only advertised MOSS entry.
`moss_dmd` and `face_detail` are strict JSON booleans, both default false, and
can be combined independently. Explicit main steps/CFG/dimensions remain intact.
Main defaults: 1184x896, 30 steps (8 with DMD), CFG3, euler/simple.
DMD strength is fixed at 1.0. The acceleration LoRA weight file is preserved.

```json
{"model":"moss_image_sft","prompt":"Portrait of an adult in a blue shirt","moss_dmd":true,"face_detail":true,"upscale_method":"none"}
```

Face defaults/ranges are in `/models.models.moss_image_sft.options` and
`/help.help.moss_image.options`: `face_steps=30` (1..100), `face_cfg=3` (0..100),
`face_denoise=0.8` (0.0001..1), `face_sampler_name=euler`, `face_scheduler=normal`,
`face_seed` inherits seed, `face_guide_size=1024`, `face_max_size=2048` (64..4096).
Guide size must not exceed max size. Sampler/scheduler enums are advertised.
`face_noise_mask_feather=20` (integer 0..100) matches the original 1to4 workflow.
This is the sampling noise-mask feather, distinct from paste feather=5. Impact
Pack enables Differential Diffusion when it is positive and the model lacks a
denoise mask function. Set it explicitly to 0 to reproduce the former behavior.
Explicit face_denoise values remain unchanged; historical presets with .25/.4
must be updated by their caller if the new default is desired.
Detector is bbox/face_yolov8m.pt, threshold .5, dilation10, drop size10.
`face_crop_factor` defaults to 1.5 (range 1..10); explicit 3 preserves the former
crop. It changes context around the detected face, not guide1024/max2048.
Resolved crop_factor is recorded in moss_options.face_parameters.
All detected regions are processed once; there is no implicit four-face cap.

Main MODEL order is SFT -> DMD (when enabled) -> ordinary style/character LoRAs
in request order. Face MODEL is a separate SFT -> ordinary LoRA chain with no DMD.
Ordinary CLIP patches are applied once and shared by both conditioning branches.
Face detail uses independent sampling settings, sharing the user's
positive/negative conditioning. No author's example prompt is injected.
Execution order: main generation -> optional face detail -> optional upscale.
OmniSR and SeedVR2 keep their existing upscale_method fields.

No faces: DetailerForEach passes the original image through. A separate detection
count is recorded via PreviewAny node74 in ComfyUI history, not inferred from image
quality. Synchronous results include `moss_options` (resolved flags/main steps,
face parameters/upscale method) and `face_detail_result` with `status` and
`detected_faces`. Status: disabled, pending, no_face, completed, unknown.
Completed means workflow finished with detected regions, not a quality score.
For wait=false, query `/history/{prompt_id}`; count is outputs["74"].text[0].
Selected flags/parameters are also recoverable from the saved PNG workflow.
Missing selected nodes or DMD/detector files return 503 with `details.missing`;
invalid booleans/parameters return 400. Optional dependencies do not disable base SFT.
The two boolean entries under `/models.models.moss_image_sft.options` additionally
contain live `available: boolean` and `missing: string[]`. `/help` is static schema.

## Runtime face measurements

Set `face_diagnostic_export: true` with face_detail to export diagnostic PNGs.
Default is false. The local post_decode hook captures decoded pixels BEFORE
Impact Pack resizes them back to the crop. Per-face diagnostics list the stage,
absolute path and actual width/height for original_crop, upscaled_input,
decoded_before_resize and after_paste. Images go under the ComfyUI output directory
in gateway_face_diagnostics/<generated UUID>/; clients cannot choose that directory.
Final output stays in the normal images response and final_image_path.
The same intermediate path/size records persist in node72 history. Diagnostics
are opt-in and retained until the user removes them; they may consume disk space.

The Gateway-owned `GatewayMeasuredDetailer` adapter delegates each face to Impact
Pack DetailerForEach and uses post_upscale/post_encode hooks. It does not modify
Impact Pack or globally patch its functions. Registration shim:
`ComfyUI/custom_nodes/agent_gateway_measurements.py` (requires ComfyUI restart).
`face_detail_result.faces[]` contains per-face `original_size`, `bbox`, `bbox_size`,
`crop_region`, `crop_size`, actual tensor `vae_input_size` (width/height before VAE
internal padding/cropping), `latent_shape` actually returned by encode,
`scale_xy`, and `scaled_face_size` (bbox size multiplied by observed resize ratio).
Skipped regions have null execution sizes, never inferred from configuration.
The same JSON is persisted in ComfyUI history:
`outputs["72"].gateway_face_measurements[0]`.
An execution error is not replaced by lower-resolution output.

The bbox target is now 1024 but is not a hard lower bound. With guide_size_for=bbox
and the selected crop_factor, Impact scales toward the smaller bbox edge, then caps the entire
crop at max_size=2048. Crop clipping at image borders and VAE internal alignment
also affect the effective dimensions. Explicit guide/max sizes remain supported.
GPU validation completed on 2026-10-21 after the user restarted ComfyUI and the
Gateway was restarted. Adult portrait, DMD8 main generation, face30/CFG3/denoise.25,
guide1024/max2048: prompt bdd24f8e-73b2-4ceb-99e9-d6bba68937bf succeeded in 132s.
Original/crop 512x512, bbox 182.123x274.325, measured pre-VAE tensor 2048x2048,
latent shape [1,128,128,128], resize4x, scaled bbox728.494x1097.299.
RTX3090 sampled peak23462MiB/24576MiB (sampled, not a guaranteed absolute peak).
No execution error or resolution fallback. Synchronous API measurement forwarding
was separately verified with a cached repeat, prompt2c8d7d70-a517-4afe-bc39-22b1953014f5.

Migration: moss_image_sft_dmd8, moss_dmd8, moss_8step, moss_image_8step still
resolve to canonical moss_image_sft with moss_dmd=true unless explicitly overridden.
Old aliases retain 1024x1024 default dimensions; all explicit values win. Workbench
should migrate old model selections to canonical key + moss_dmd=true and preserve
their saved dimensions/steps. Never delete existing weights, presets or history.

## Acceptance 2026-10-21

All four combinations executed successfully with neutral prompts. Main steps were
2 for non-DMD and 8 for DMD; face steps 2, guide256/max512 for cheap smoke tests.
No-face geometry returned no_face/0; DMD + adult portrait returned completed/1.
Results are recorded in tests/moss_options_smoke_results.json. This validates
execution and branch isolation, not quality at production defaults. Multi-face,
30-step face quality, and face+SeedVR2 together were not runtime-tested here.
