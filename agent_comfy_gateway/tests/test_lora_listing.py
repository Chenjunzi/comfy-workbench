from __future__ import annotations

import json
import socket
import struct
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

from agent_comfy_gateway import server


class StubGateway:
    def __init__(self, names: list[str]):
        self.comfy_url = "http://127.0.0.1:8188"
        self.names = names

    def loras_with_status(self, force_refresh: bool = False):
        return list(self.names), {
            "hit": False,
            "stale": False,
            "age_seconds": 0.0,
            "ttl_seconds": server.LORA_LIST_CACHE_TTL,
            "source": "test",
        }


class FailingGateway(StubGateway):
    def loras_with_status(self, force_refresh: bool = False):
        raise server.GatewayError("upstream unavailable", 502, {"source": "test"})


class LoraListingTests(unittest.TestCase):
    @staticmethod
    def large_names(count: int = 4000) -> list[str]:
        padding = "segment_" + ("x" * 240)
        return [f"folder_{index:04d}\\{padding}\\model_{index:04d}.safetensors" for index in range(count)]

    def start_server(self, gateway):
        httpd = server.AgentThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(gateway))
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 5)
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        return httpd

    def request_json(self, httpd, path: str):
        with urllib.request.urlopen(f"http://127.0.0.1:{httpd.server_port}{path}", timeout=10) as response:
            raw = response.read()
            self.assertEqual(int(response.headers["Content-Length"]), len(raw))
            self.assertEqual(response.headers["Connection"], "close")
            return json.loads(raw.decode("utf-8"))

    def test_large_library_without_query_keeps_compatible_shape_and_default_limit(self) -> None:
        payload = server.lora_list_payload(StubGateway(self.large_names()), "")
        self.assertTrue(payload["ok"])
        self.assertIsInstance(payload["loras"], list)
        self.assertEqual(payload["total"], 4000)
        self.assertEqual(payload["filtered"], 4000)
        self.assertEqual(payload["returned"], server.LORA_LIST_DEFAULT_LIMIT)
        self.assertTrue(payload["truncated"])

    def test_query_is_case_insensitive_multi_term_and_runs_before_limit(self) -> None:
        names = self.large_names() + [
            "Mingyun\\Krea2\\mingyun_oc_krea2_quick_v1-total00600.safetensors",
            "Mingyun\\Other\\mingyun_oc_other.safetensors",
        ]
        payload = server.lora_list_payload(StubGateway(names), "query=MINGYUN%20krea2&limit=1")
        self.assertEqual(payload["filtered"], 1)
        self.assertEqual(payload["returned"], 1)
        self.assertIn("total00600", payload["loras"][0])

    def test_limit_is_clamped_and_invalid_limit_is_structured_400(self) -> None:
        names = self.large_names(server.LORA_LIST_MAX_LIMIT + 10)
        payload = server.lora_list_payload(StubGateway(names), f"limit={server.LORA_LIST_MAX_LIMIT + 100}")
        self.assertEqual(payload["limit"], server.LORA_LIST_MAX_LIMIT)
        self.assertEqual(payload["returned"], server.LORA_LIST_MAX_LIMIT)
        self.assertEqual(payload["requested_limit"], server.LORA_LIST_MAX_LIMIT + 100)

        httpd = self.start_server(StubGateway(names))
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(f"http://127.0.0.1:{httpd.server_port}/loras?limit=bad", timeout=10)
        self.assertEqual(raised.exception.code, 400)
        error = json.loads(raised.exception.read().decode("utf-8"))
        self.assertFalse(error["ok"])

    def test_cache_avoids_repeated_comfyui_requests_and_serves_stale_on_refresh_error(self) -> None:
        gateway = server.AgentComfyGateway("http://127.0.0.1:8188")
        with mock.patch.object(server, "json_request", return_value=["one.safetensors"]) as request:
            first, first_status = gateway.loras_with_status()
            second, second_status = gateway.loras_with_status()
        self.assertEqual(first, second)
        self.assertEqual(request.call_count, 1)
        self.assertFalse(first_status["hit"])
        self.assertTrue(second_status["hit"])

        with mock.patch.object(server, "json_request", side_effect=server.GatewayError("offline", 502)):
            stale, stale_status = gateway.loras_with_status(force_refresh=True)
        self.assertEqual(stale, ["one.safetensors"])
        self.assertTrue(stale_status["stale"])
        self.assertIn("offline", stale_status["refresh_error"])

    def test_get_error_returns_complete_json_instead_of_ending_response(self) -> None:
        httpd = self.start_server(FailingGateway([]))
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(f"http://127.0.0.1:{httpd.server_port}/loras", timeout=10)
        self.assertEqual(raised.exception.code, 502)
        raw = raised.exception.read()
        self.assertEqual(int(raised.exception.headers["Content-Length"]), len(raw))
        self.assertIn("upstream unavailable", raw.decode("utf-8"))

    def test_client_disconnect_during_large_response_does_not_stop_server(self) -> None:
        httpd = self.start_server(StubGateway(self.large_names(server.LORA_LIST_MAX_LIMIT)))
        client = socket.create_connection(("127.0.0.1", httpd.server_port), timeout=5)
        client.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("hh", 1, 0))
        client.sendall(
            f"GET /loras?limit={server.LORA_LIST_MAX_LIMIT} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n".encode("ascii")
        )
        client.close()

        health = self.request_json(httpd, "/health")
        self.assertTrue(health["ok"])


if __name__ == "__main__":
    unittest.main()