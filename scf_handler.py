# -*- coding: utf-8 -*-
"""腾讯云函数 SCF 版大模型代理（粘贴即用）。
作用与 start.py / Vercel 函数相同：浏览器 → 本函数 → DeepSeek，key 存在函数环境变量里。
环境变量（在函数「配置 → 环境变量」里添加）：
  DEEPSEEK_KEY=你的key
  DEEPSEEK_BASE=https://api.deepseek.com
  DEEPSEEK_MODEL=deepseek-flash（可选，客户端会带 model）
触发方式：开启「函数 URL」（公网访问），请求路径任意。
"""
import json
import os
import urllib.error
import urllib.request

MAX_BODY = 8 * 1024 * 1024
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
}


def _reply(status, payload):
    return {
        "statusCode": status,
        "headers": {**CORS, "Content-Type": "application/json; charset=utf-8"},
        "body": payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False),
    }


def main_handler(event, context):
    method = event.get("httpMethod") or event.get("requestContext", {}).get("http", {}).get("method", "")
    if method == "OPTIONS":
        return _reply(200, "")

    key = os.environ.get("DEEPSEEK_KEY", "")
    if not key:
        return _reply(503, {"error": "server has no DEEPSEEK_KEY"})

    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        import base64
        body = base64.b64decode(body)
    if isinstance(body, str):
        body = body.encode("utf-8")
    if not body or len(body) > MAX_BODY:
        return _reply(413, {"error": "bad body"})

    base = os.environ.get("DEEPSEEK_BASE", "https://api.deepseek.com").rstrip("/")
    req = urllib.request.Request(base + "/chat/completions", data=body, method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key,
    })
    try:
        with urllib.request.urlopen(req, timeout=55) as resp:
            return _reply(resp.status, resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return _reply(e.code, e.read().decode("utf-8", "replace"))
    except Exception as e:
        return _reply(502, {"error": str(e)})
