"""Per-face runtime measurements using Impact Pack's supported hooks."""
import copy
import json
from pathlib import Path
import uuid


class GatewayMeasuredDetailer:
    @classmethod
    def INPUT_TYPES(cls):
        from impact.impact_pack import DetailerForEach
        schema = copy.deepcopy(DetailerForEach.INPUT_TYPES())
        schema.get('optional', {}).pop('detailer_hook', None)
        schema.setdefault('optional', {})['diagnostic_export'] = ('BOOLEAN', {'default': False})
        return schema

    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'run'
    CATEGORY = 'AgentGateway'
    OUTPUT_NODE = True

    def run(self, image, segs, diagnostic_export=False, **kwargs):
        from impact.impact_pack import DetailerForEach
        from impact.hooks import DetailerHook
        measurements = []
        original = [int(image.shape[2]), int(image.shape[1])]
        export_dir = None
        if diagnostic_export:
            import folder_paths
            export_dir = Path(folder_paths.get_output_directory()).resolve() / 'gateway_face_diagnostics' / uuid.uuid4().hex
            export_dir.mkdir(parents=True, exist_ok=False)

        def save_tensor(pixels, stage, index):
            from PIL import Image
            array = (pixels[0].detach().cpu().clamp(0, 1).numpy() * 255).round().astype('uint8')
            path = export_dir / f'face_{index:03d}_{stage}.png'
            Image.fromarray(array).save(path)
            return {'stage': stage, 'path': str(path), 'width': int(array.shape[1]), 'height': int(array.shape[0])}
        for index, seg in enumerate(segs[1]):
            bbox = [float(x) for x in seg.bbox]
            crop = [int(x) for x in seg.crop_region]
            bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
            cw, ch = crop[2] - crop[0], crop[3] - crop[1]
            record = dict(face_index=index, original_size=original, bbox=bbox,
                          bbox_size=[bw, bh], crop_region=crop, crop_size=[cw, ch],
                          status='skipped', vae_input_size=None, latent_shape=None,
                          scaled_face_size=None, scale_xy=None)
            if export_dir:
                record['diagnostics'] = [save_tensor(image[:, crop[1]:crop[3], crop[0]:crop[2], :], 'original_crop', index)]

            class MeasurementHook(DetailerHook):
                def post_upscale(self, pixels, mask=None):
                    width, height = int(pixels.shape[2]), int(pixels.shape[1])
                    record['vae_input_size'] = [width, height]
                    record['scale_xy'] = [width / cw, height / ch]
                    record['scaled_face_size'] = [bw * width / cw, bh * height / ch]
                    if export_dir:
                        record['diagnostics'].append(save_tensor(pixels, 'upscaled_input', index))
                    return pixels

                def post_decode(self, pixels):
                    record['decoded_size_before_resize'] = [int(pixels.shape[2]), int(pixels.shape[1])]
                    if export_dir:
                        record['diagnostics'].append(save_tensor(pixels, 'decoded_before_resize', index))
                    return pixels

                def post_encode(self, latent):
                    record['latent_shape'] = list(latent['samples'].shape)
                    record['status'] = 'encoded'
                    return latent

            params = dict(kwargs, seed=(kwargs['seed'] + index) % 2**64,
                          detailer_hook=MeasurementHook())
            image = DetailerForEach().doit(image=image, segs=(segs[0], [seg]), **params)[0]
            if export_dir:
                record['diagnostics'].append(save_tensor(image, 'after_paste', index))
            if record['status'] == 'encoded':
                record['status'] = 'completed'
            measurements.append(record)
        return {'ui': {'gateway_face_measurements': [json.dumps(measurements)]}, 'result': (image,)}


NODE_CLASS_MAPPINGS = {'GatewayMeasuredDetailer': GatewayMeasuredDetailer}
