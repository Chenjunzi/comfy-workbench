from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import shutil
import uuid
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOG_DIR = PROJECT_ROOT / "logs" / "llm_input_proxy"
DEFAULT_HOST = os.environ.get("LLM_PROXY_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.environ.get("LLM_PROXY_PORT", "8787"))
DEFAULT_UPSTREAM = os.environ.get("LLM_PROXY_UPSTREAM", "http://127.0.0.1:1234").rstrip("/")
TOKEN_CHAR_RATIO = float(os.environ.get("LLM_PROXY_TOKEN_CHAR_RATIO", "3.5"))

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}

SECRET_HEADER_NAMES = {"authorization", "x-api-key", "api-key", "cookie", "set-cookie"}
LARGE_TEXT_RE = re.compile(r"^[A-Za-z0-9+/=\s_-]{2000,}$")


def now_utc() -> str:
    return dt.datetime.now(dt.UTC).isoformat(timespec="seconds")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def redact_headers(headers: dict[str, str]) -> dict[str, str]:
    redacted: dict[str, str] = {}
    for key, value in headers.items():
        if key.lower() in SECRET_HEADER_NAMES:
            redacted[key] = "<redacted>"
        else:
            redacted[key] = value
    return redacted


def approximate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, round(len(text) / TOKEN_CHAR_RATIO))


def is_probable_blob(value: str) -> bool:
    if value.startswith("data:image/") or value.startswith("data:application/"):
        return True
    if len(value) < 2000:
        return False
    compact = value.strip()
    return bool(LARGE_TEXT_RE.match(compact)) and len(compact) > 4000


def preview(value: str, limit: int = 180) -> str:
    value = value.replace("\r", "\\r").replace("\n", "\\n")
    if len(value) <= limit:
        return value
    return value[:limit] + "..."


def scan_large_fields(value: Any, path: str = "$", results: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    if results is None:
        results = []
    if isinstance(value, dict):
        for key, child in value.items():
            scan_large_fields(child, f"{path}.{key}", results)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            scan_large_fields(child, f"{path}[{index}]", results)
    elif isinstance(value, str):
        char_count = len(value)
        if char_count >= 2000 or is_probable_blob(value):
            results.append(
                {
                    "path": path,
                    "chars": char_count,
                    "approx_tokens": approximate_tokens(value),
                    "probable_blob": is_probable_blob(value),
                    "preview": preview(value),
                }
            )
    return results


def summarize_messages(body: Any) -> list[dict[str, Any]]:
    messages = body.get("messages") if isinstance(body, dict) else None
    if not isinstance(messages, list):
        return []
    summary: list[dict[str, Any]] = []
    for index, message in enumerate(messages):
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        tool_calls = message.get("tool_calls")
        entry = {
            "index": index,
            "role": message.get("role"),
            "name": message.get("name"),
            "content_type": type(content).__name__,
            "content_chars": len(json.dumps(content, ensure_ascii=False)) if content is not None else 0,
            "approx_tokens": approximate_tokens(json.dumps(content, ensure_ascii=False)) if content is not None else 0,
            "tool_call_count": len(tool_calls) if isinstance(tool_calls, list) else 0,
        }
        if isinstance(content, str):
            entry["preview"] = preview(content)
        summary.append(entry)
    return summary


def summarize_request(method: str, path: str, headers: dict[str, str], raw: bytes, parsed_body: Any) -> dict[str, Any]:
    raw_text = raw.decode("utf-8", errors="replace")
    body_for_scan = parsed_body if parsed_body is not None else raw_text
    large_fields = sorted(scan_large_fields(body_for_scan), key=lambda item: item["chars"], reverse=True)
    return {
        "captured_at": now_utc(),
        "method": method,
        "path": path,
        "content_type": headers.get("Content-Type") or headers.get("content-type"),
        "body_bytes": len(raw),
        "body_chars": len(raw_text),
        "approx_tokens": approximate_tokens(raw_text),
        "model": parsed_body.get("model") if isinstance(parsed_body, dict) else None,
        "stream": parsed_body.get("stream") if isinstance(parsed_body, dict) else None,
        "message_count": len(parsed_body.get("messages", [])) if isinstance(parsed_body, dict) and isinstance(parsed_body.get("messages"), list) else None,
        "messages": summarize_messages(parsed_body) if isinstance(parsed_body, dict) else [],
        "large_fields": large_fields[:50],
        "headers": redact_headers(headers),
    }


def parse_body(raw: bytes, content_type: str | None) -> Any | None:
    if not raw:
        return None
    if content_type and "json" not in content_type.lower():
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def capture_request(log_dir: Path, method: str, path: str, headers: dict[str, str], raw: bytes) -> tuple[str, Path, dict[str, Any]]:
    capture_id = dt.datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
    capture_dir = log_dir / capture_id
    capture_dir.mkdir(parents=True, exist_ok=True)
    content_type = headers.get("Content-Type") or headers.get("content-type")
    parsed_body = parse_body(raw, content_type)
    summary = summarize_request(method, path, headers, raw, parsed_body)
    summary["id"] = capture_id
    (capture_dir / "raw_request.bin").write_bytes(raw)
    if parsed_body is not None:
        write_json(capture_dir / "raw_request.json", parsed_body)
    write_json(capture_dir / "summary.json", summary)
    return capture_id, capture_dir, summary


def load_capture_summaries(log_dir: Path) -> list[dict[str, Any]]:
    if not log_dir.exists():
        return []
    summaries: list[dict[str, Any]] = []
    for path in sorted(log_dir.glob("*/summary.json"), reverse=True):
        try:
            summaries.append(read_json(path))
        except Exception:
            continue
    return summaries


class LLMInputProxy(BaseHTTPRequestHandler):
    server_version = "LLMInputProxy/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[{dt.datetime.now().strftime('%H:%M:%S')}] {self.address_string()} {fmt % args}")

    @property
    def log_dir(self) -> Path:
        return self.server.log_dir  # type: ignore[attr-defined]

    @property
    def upstream(self) -> str:
        return self.server.upstream  # type: ignore[attr-defined]

    def send_json(self, value: Any, status: int = 200) -> None:
        body = json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, body: str, status: int = 200) -> None:
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            self.send_json({"ok": True, "upstream": self.upstream, "log_dir": str(self.log_dir)})
            return
        if parsed.path in {"/", "/captures"}:
            self.send_capture_index()
            return
        if parsed.path.startswith("/captures/"):
            self.send_capture_detail(parsed.path)
            return
        self.forward_request(b"")

    def do_POST(self) -> None:
        raw = self.read_body()
        capture_id, _capture_dir, summary = capture_request(self.log_dir, self.command, self.path, dict(self.headers.items()), raw)
        print(
            f"[capture] {capture_id} {self.path} "
            f"{summary['body_bytes']} bytes ~{summary['approx_tokens']} tokens "
            f"large_fields={len(summary['large_fields'])}"
        )
        self.forward_request(raw, capture_id=capture_id)

    def do_PUT(self) -> None:
        self.forward_mutating_request()

    def do_PATCH(self) -> None:
        self.forward_mutating_request()

    def do_DELETE(self) -> None:
        self.forward_mutating_request()

    def forward_mutating_request(self) -> None:
        raw = self.read_body()
        capture_id, _capture_dir, _summary = capture_request(self.log_dir, self.command, self.path, dict(self.headers.items()), raw)
        self.forward_request(raw, capture_id=capture_id)

    def read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return b""
        return self.rfile.read(length)

    def upstream_url(self) -> str:
        parsed_path = urllib.parse.urlsplit(self.path)
        upstream = urllib.parse.urlsplit(self.upstream)
        upstream_path = upstream.path.rstrip("/")
        path = parsed_path.path
        if upstream_path and path.startswith(upstream_path + "/"):
            path = path[len(upstream_path) :]
        return urllib.parse.urlunsplit(
            (
                upstream.scheme,
                upstream.netloc,
                upstream_path + path,
                parsed_path.query,
                "",
            )
        )

    def forward_request(self, raw: bytes, capture_id: str | None = None) -> None:
        url = self.upstream_url()
        headers = {key: value for key, value in self.headers.items() if key.lower() not in HOP_BY_HOP_HEADERS}
        headers.pop("Host", None)
        upstream_key = os.environ.get("LLM_PROXY_UPSTREAM_API_KEY")
        if upstream_key:
            headers["Authorization"] = f"Bearer {upstream_key}"
        request = urllib.request.Request(url, data=raw if self.command not in {"GET", "HEAD"} else None, headers=headers, method=self.command)
        try:
            with urllib.request.urlopen(request, timeout=self.server.upstream_timeout) as response:  # type: ignore[attr-defined]
                self.send_response(response.status)
                if capture_id:
                    self.send_header("X-LLM-Proxy-Capture-Id", capture_id)
                for key, value in response.headers.items():
                    if key.lower() not in HOP_BY_HOP_HEADERS:
                        self.send_header(key, value)
                self.end_headers()
                shutil.copyfileobj(response, self.wfile)
        except urllib.error.HTTPError as error:
            body = error.read()
            self.send_response(error.code)
            if capture_id:
                self.send_header("X-LLM-Proxy-Capture-Id", capture_id)
            for key, value in error.headers.items():
                if key.lower() not in HOP_BY_HOP_HEADERS:
                    self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)
        except Exception as error:
            self.send_json(
                {
                    "error": "proxy_forward_failed",
                    "message": str(error),
                    "upstream": url,
                    "capture_id": capture_id,
                },
                status=502,
            )

    def send_capture_index(self) -> None:
        summaries = load_capture_summaries(self.log_dir)
        rows = []
        for item in summaries[:200]:
            cid = html.escape(str(item.get("id", "")))
            rows.append(
                "<tr>"
                f"<td><a href='/captures/{cid}'>{cid}</a></td>"
                f"<td>{html.escape(str(item.get('captured_at', '')))}</td>"
                f"<td>{html.escape(str(item.get('model', '')))}</td>"
                f"<td>{item.get('body_bytes', 0)}</td>"
                f"<td>{item.get('approx_tokens', 0)}</td>"
                f"<td>{len(item.get('large_fields') or [])}</td>"
                f"<td>{html.escape(str(item.get('path', '')))}</td>"
                "</tr>"
            )
        self.send_html(
            "<!doctype html><meta charset='utf-8'><title>LLM Input Captures</title>"
            "<style>body{font-family:Segoe UI,Arial,sans-serif;margin:24px;line-height:1.4}"
            "table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left}"
            "code,pre{background:#f6f8fa;padding:2px 4px;border-radius:4px}th{background:#f6f8fa}</style>"
            "<h1>LLM Input Captures</h1>"
            f"<p>Upstream: <code>{html.escape(self.upstream)}</code></p>"
            "<table><tr><th>ID</th><th>Time</th><th>Model</th><th>Bytes</th><th>Approx tokens</th><th>Large fields</th><th>Path</th></tr>"
            + "".join(rows)
            + "</table>"
        )

    def send_capture_detail(self, path: str) -> None:
        parts = path.strip("/").split("/")
        if len(parts) < 2:
            self.send_json({"error": "missing_capture_id"}, 404)
            return
        capture_id = parts[1]
        capture_dir = self.log_dir / capture_id
        if len(parts) >= 3 and parts[2] == "raw":
            raw_json = capture_dir / "raw_request.json"
            raw_bin = capture_dir / "raw_request.bin"
            if raw_json.exists():
                self.send_json(read_json(raw_json))
                return
            if raw_bin.exists():
                body = raw_bin.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
        summary_path = capture_dir / "summary.json"
        if not summary_path.exists():
            self.send_json({"error": "capture_not_found", "id": capture_id}, 404)
            return
        summary = read_json(summary_path)
        body = html.escape(json.dumps(summary, ensure_ascii=False, indent=2))
        raw_link = html.escape(f"/captures/{capture_id}/raw")
        self.send_html(
            "<!doctype html><meta charset='utf-8'><title>Capture Detail</title>"
            "<style>body{font-family:Segoe UI,Arial,sans-serif;margin:24px;line-height:1.4}"
            "pre{white-space:pre-wrap;background:#f6f8fa;padding:12px;border-radius:6px}</style>"
            f"<p><a href='/captures'>Back</a> | <a href='{raw_link}'>Raw request JSON</a></p>"
            f"<h1>{html.escape(capture_id)}</h1><pre>{body}</pre>"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="OpenAI-compatible LLM input logging proxy.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--upstream", default=DEFAULT_UPSTREAM, help="Real OpenAI-compatible upstream origin, for example http://127.0.0.1:1234")
    parser.add_argument("--log-dir", default=str(DEFAULT_LOG_DIR))
    parser.add_argument("--timeout", type=float, default=float(os.environ.get("LLM_PROXY_TIMEOUT", "600")))
    args = parser.parse_args()

    log_dir = Path(args.log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)

    server = ThreadingHTTPServer((args.host, args.port), LLMInputProxy)
    server.upstream = args.upstream.rstrip("/")  # type: ignore[attr-defined]
    server.log_dir = log_dir  # type: ignore[attr-defined]
    server.upstream_timeout = args.timeout  # type: ignore[attr-defined]
    print(f"LLM input proxy listening on http://{args.host}:{args.port}")
    print(f"Forwarding to {server.upstream}")
    print(f"Captures: {log_dir}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopping LLM input proxy")


if __name__ == "__main__":
    main()
