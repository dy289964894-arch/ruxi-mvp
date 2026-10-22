# -*- coding: utf-8 -*-
"""启动练习版 MVP：静态服务 + 大模型代理。
key 只存在于本进程的 .env 里，浏览器永远拿不到——页面请求 /api/chat/completions，
由本进程带上真实 key 转发到 DeepSeek，再把响应原样返回。
用法：python -X utf8 start.py [端口，默认 8765]
"""
import http.server
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
MAX_BODY = 8 * 1024 * 1024
ENV = {}


def load_env():
    cfg = {}
    path = os.path.join(BASE, ".env")
    if not os.path.exists(path):
        return cfg
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip().strip('"').strip("'")
    return cfg


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/api/chat/completions":
            self.send_error(404)
            return
        key = ENV.get("DEEPSEEK_KEY", "")
        if not key:
            self.send_error(503, "server has no DEEPSEEK_KEY")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self.send_error(413)
            return
        body = self.rfile.read(length)
        upstream = ENV.get("DEEPSEEK_BASE", "https://api.deepseek.com/v1").rstrip("/") + "/chat/completions"
        req = urllib.request.Request(upstream, data=body, method="POST", headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,
        })
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
                self._relay(resp.status, data)
        except urllib.error.HTTPError as e:
            self._relay(e.code, e.read())
        except Exception as e:
            self.send_error(502, str(e))

    def _relay(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    global ENV
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ENV = load_env()
    os.chdir(BASE)
    if ENV.get("DEEPSEEK_KEY"):
        print(f"[start] 大模型代理已启用：{ENV.get('DEEPSEEK_BASE')} model={ENV.get('DEEPSEEK_MODEL', '')}（key 不进入浏览器）")
    else:
        print("[start] .env 未填 DEEPSEEK_KEY，按演示模式启动")
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("", port), Handler) as httpd:
        print(f"[start] 打开 http://localhost:{port}/index.html")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
