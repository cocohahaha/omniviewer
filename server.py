#!/usr/bin/env python3
"""LocalLens 本地服务（纯标准库，无任何第三方依赖）。

职责：
1. 提供应用静态文件；
2. GET  /api/file?path=...  按绝对路径读取本机文件（配合「双击打开 / 拖到 Dock 图标」）；
3. POST /api/save           把编辑后的内容写回指定路径；
4. GET  /api/reveal?path=.. 在访达中显示文件。

安全：只绑定 127.0.0.1；所有 /api/ 请求校验 Origin/Referer 必须来自本服务，
拒绝任意网页跨站调用；不开目录列表之外的遍历接口。
"""
import json
import os
import posixpath
import subprocess
import sys
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("LOCALLENS_PORT", "8437"))
ROOT = os.path.dirname(os.path.abspath(__file__))

ALLOWED_ORIGINS = {
    f"http://127.0.0.1:{PORT}",
    f"http://localhost:{PORT}",
}


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        pass  # 静默

    # ---------- 工具 ----------
    def _origin_ok(self):
        origin = self.headers.get("Origin") or ""
        referer = self.headers.get("Referer") or ""
        if origin:
            return origin in ALLOWED_ORIGINS
        if referer:
            return any(referer.startswith(o + "/") for o in ALLOWED_ORIGINS)
        # 同源导航请求（地址栏直开）没有 Origin/Referer，放行
        return True

    def _deny(self, code=403, msg="forbidden"):
        body = json.dumps({"error": msg}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---------- 路由 ----------
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/file":
            return self._api_file(parsed)
        if parsed.path == "/api/reveal":
            return self._api_reveal(parsed)
        if parsed.path == "/api/ping":
            return self._json({"ok": True, "root": ROOT})
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/save":
            return self._api_save()
        return self._deny(404, "not found")

    # ---------- API ----------
    def _api_file(self, parsed):
        if not self._origin_ok():
            return self._deny()
        qs = urllib.parse.parse_qs(parsed.query)
        path = (qs.get("path") or [""])[0]
        path = os.path.abspath(os.path.expanduser(path))
        if not os.path.isfile(path):
            return self._deny(404, "file not found: " + path)
        try:
            size = os.path.getsize(path)
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(size))
            self.send_header("X-File-Name",
                             urllib.parse.quote(os.path.basename(path)))
            self.end_headers()
            with open(path, "rb") as f:
                while True:
                    chunk = f.read(1024 * 256)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except OSError as e:
            return self._deny(500, str(e))

    def _api_save(self):
        if not self._origin_ok():
            return self._deny()
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            path = os.path.abspath(os.path.expanduser(payload["path"]))
            content = payload["content"]
        except (ValueError, KeyError) as e:
            return self._deny(400, "bad request: " + str(e))
        # 只允许写回已存在的文件，避免被当成任意写盘接口
        if not os.path.isfile(path):
            return self._deny(403, "only existing files can be overwritten")
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return self._json({"ok": True, "bytes": len(content.encode("utf-8"))})
        except OSError as e:
            return self._deny(500, str(e))

    def _api_reveal(self, parsed):
        if not self._origin_ok():
            return self._deny()
        qs = urllib.parse.parse_qs(parsed.query)
        path = os.path.abspath(os.path.expanduser((qs.get("path") or [""])[0]))
        if sys.platform == "darwin" and os.path.exists(path):
            subprocess.Popen(["open", "-R", path])
            return self._json({"ok": True})
        return self._deny(404, "not found")


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"LocalLens 运行中: http://127.0.0.1:{PORT}/  (根目录 {ROOT})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
