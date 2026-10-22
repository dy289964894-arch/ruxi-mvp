# -*- coding: utf-8 -*-
"""Vercel Serverless Function：大模型代理，与本地 start.py 的 /api/chat/completions 等价。
key 只存在于 Vercel 环境变量（DEEPSEEK_KEY），浏览器永远拿不到。"""
import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

MAX_BODY = 8 * 1024 * 1024


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        key = os.environ.get("DEEPSEEK_KEY", "")
        if not key:
            self.send_error(503, "server has no DEEPSEEK_KEY")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self.send_error(413)
            return
        body = self.rfile.read(length)
        base = os.environ.get("DEEPSEEK_BASE", "https://api.deepseek.com").rstrip("/")
        req = urllib.request.Request(base + "/chat/completions", data=body, method="POST", headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,
        })
        try:
            with urllib.request.urlopen(req, timeout=55) as resp:
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
