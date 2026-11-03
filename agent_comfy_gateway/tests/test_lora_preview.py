from __future__ import annotations

import json
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from agent_comfy_gateway import server


REMOTE_PREVIEW = "https://image.civitai.com/example/preview.jpeg"


class LoraPreviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name) / "loras"
        self.root.mkdir()
        self.original_lora_dir = server.LORA_DIR
        server.LORA_DIR = self.root

    def tearDown(self) -> None:
        server.LORA_DIR = self.original_lora_dir
        self.temp_dir.cleanup()

    def make_lora(self, relative_name: str = "nested/sample.safetensors") -> Path:
        path = self.root / relative_name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"")
        return path

    @staticmethod
    def metadata(preview_url: str = "", images: list[dict[str, str]] | None = None) -> dict:
        return {
            "preview_url": preview_url,
            "civitai": {"images": images if images is not None else [{"type": "image", "url": REMOTE_PREVIEW}]},
        }

    def test_metadata_local_preview_wins_over_civitai(self) -> None:
        lora_path = self.make_lora()
        preview_path = lora_path.parent / "custom-preview.png"
        preview_path.write_bytes(b"local-png")
        metadata = self.metadata(str(preview_path))

        self.assertEqual(server.lora_local_preview_path(lora_path, metadata), preview_path.resolve())
        self.assertEqual(
            server.lora_preview_image_url("nested/sample.safetensors", lora_path, metadata),
            "/lora-preview?name=nested/sample.safetensors",
        )

    def test_same_name_local_extensions_win_over_civitai(self) -> None:
        for suffix in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            with self.subTest(suffix=suffix):
                lora_path = self.make_lora(f"{suffix[1:]}/sample.safetensors")
                preview_path = lora_path.with_suffix(suffix)
                preview_path.write_bytes(suffix.encode("ascii"))
                metadata = self.metadata()

                self.assertEqual(server.lora_local_preview_path(lora_path, metadata), preview_path.resolve())
                self.assertEqual(
                    server.lora_preview_image_url(f"{suffix[1:]}/sample.safetensors", lora_path, metadata),
                    f"/lora-preview?name={suffix[1:]}/sample.safetensors",
                )

    def test_civitai_is_used_only_without_local_and_requires_http_url(self) -> None:
        lora_path = self.make_lora()
        metadata = self.metadata(
            images=[
                {"type": "image", "url": "javascript:alert(1)"},
                {"type": "image", "url": "C:/outside/preview.png"},
                {"type": "image", "url": REMOTE_PREVIEW},
            ]
        )

        self.assertIsNone(server.lora_local_preview_path(lora_path, metadata))
        self.assertEqual(server.lora_preview_image_url("nested/sample.safetensors", lora_path, metadata), REMOTE_PREVIEW)

    def test_missing_or_out_of_bounds_preview_url_cannot_escape_lora_dir(self) -> None:
        lora_path = self.make_lora()
        outside_path = Path(self.temp_dir.name) / "outside.png"
        outside_path.write_bytes(b"outside")

        for preview_url in (str(outside_path), "nested/missing.png"):
            with self.subTest(preview_url=preview_url):
                metadata = self.metadata(preview_url=preview_url, images=[])
                self.assertIsNone(server.lora_local_preview_path(lora_path, metadata))
                self.assertEqual(server.lora_preview_image_url("nested/sample.safetensors", lora_path, metadata), "")

        sidecar = lora_path.with_suffix(".metadata.json")
        sidecar.write_text(json.dumps(self.metadata(preview_url=str(outside_path), images=[])), encoding="utf-8")
        with self.assertRaises(server.GatewayError) as raised:
            server.lora_preview_path("nested/sample.safetensors")
        self.assertEqual(raised.exception.status, 404)

    def test_http_preview_serves_expected_content_type_and_bytes(self) -> None:
        lora_path = self.make_lora()
        preview_bytes = b"\xff\xd8local-preview\xff\xd9"
        lora_path.with_suffix(".jpeg").write_bytes(preview_bytes)
        sidecar = lora_path.with_suffix(".metadata.json")
        sidecar.write_text(json.dumps(self.metadata()), encoding="utf-8")

        gateway = server.AgentComfyGateway("http://127.0.0.1:8188")
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(gateway))
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            base_url = f"http://127.0.0.1:{httpd.server_port}"
            info_url = f"{base_url}/lora-info?name=nested/sample.safetensors"
            with urllib.request.urlopen(info_url) as response:
                info = json.loads(response.read().decode("utf-8"))
            self.assertEqual(info["preview_image_url"], "/lora-preview?name=nested/sample.safetensors")

            preview_url = f"{base_url}{info['preview_image_url']}"
            with urllib.request.urlopen(preview_url) as response:
                self.assertEqual(response.headers.get_content_type(), "image/jpeg")
                self.assertEqual(response.read(), preview_bytes)
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()