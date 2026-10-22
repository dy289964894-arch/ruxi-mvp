# -*- coding: utf-8 -*-
"""腾讯云函数 SCF 版语音转文字代理（粘贴即用）。
浏览器真录音(wav, base64) → 本函数 → 腾讯云语音识别「一句话识别」→ 返回 {"text": "..."}

部署步骤：
1. 腾讯云控制台开通「语音识别 ASR」服务（新用户有免费额度）。
2. 访问管理 CAM → API密钥管理，新建 SecretId / SecretKey。
3. 新建 SCF 函数（Python 3.10，空白模板），把本文件全部内容粘进 index.py。
4. 函数配置 → 环境变量添加：
     TENCENT_SECRET_ID=你的SecretId
     TENCENT_SECRET_KEY=你的SecretKey
5. 函数 URL → 新建，公网访问启用，授权类型「开放」，CORS 启用。
6. 把生成的函数 URL 写进前端 config.js 的 asr 字段。

前端请求体：{"audio": "<base64 wav>", "format": "wav"}（16kHz 16bit 单声道）
"""
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request

MAX_AUDIO = 3 * 1024 * 1024  # base64 后约 4MB，覆盖 60 秒 16k wav
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def _reply(status, payload):
    return {
        "statusCode": status,
        "headers": {**CORS, "Content-Type": "application/json; charset=utf-8"},
        "body": json.dumps(payload, ensure_ascii=False),
    }


def _sign(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _call_asr(audio_b64, data_len, fmt):
    secret_id = os.environ.get("TENCENT_SECRET_ID", "")
    secret_key = os.environ.get("TENCENT_SECRET_KEY", "")
    if not secret_id or not secret_key:
        return None, "server has no TENCENT_SECRET_ID/KEY"

    host = "asr.tencentcloudapi.com"
    action = "SentenceRecognition"
    version = "2019-06-14"
    payload = json.dumps({
        "ProjectId": 0,
        "SubServiceType": 2,          # 一句话识别
        "EngSerViceType": "16k_zh",   # 中文普通话通用
        "SourceType": 1,              # 语音数据直接放在 Data 里
        "VoiceFormat": fmt,
        "Data": audio_b64,
        "DataLen": data_len,
    }, separators=(",", ":"))

    ts = int(time.time())
    date = time.strftime("%Y-%m-%d", time.gmtime(ts))
    canonical = (
        "POST\n/\n\n"
        "content-type:application/json; charset=utf-8\n"
        f"host:{host}\n"
        f"x-tc-action:{action.lower()}\n\n"
        "content-type;host;x-tc-action\n"
        + hashlib.sha256(payload.encode("utf-8")).hexdigest()
    )
    string_to_sign = (
        "TC3-HMAC-SHA256\n" + str(ts) + "\n" + date + "/asr/tc3_request\n"
        + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    )
    secret_date = _sign(("TC3" + secret_key).encode("utf-8"), date)
    secret_service = _sign(secret_date, "asr")
    secret_signing = _sign(secret_service, "tc3_request")
    signature = hmac.new(secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    auth = (
        "TC3-HMAC-SHA256 "
        f"Credential={secret_id}/{date}/asr/tc3_request, "
        "SignedHeaders=content-type;host;x-tc-action, "
        f"Signature={signature}"
    )
    req = urllib.request.Request("https://" + host + "/", data=payload.encode("utf-8"), method="POST", headers={
        "Authorization": auth,
        "Content-Type": "application/json; charset=utf-8",
        "Host": host,
        "X-TC-Action": action,
        "X-TC-Timestamp": str(ts),
        "X-TC-Version": version,
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return None, "asr http %d: %s" % (e.code, e.read().decode("utf-8", "replace")[:300])
    except Exception as e:
        return None, "asr request failed: %s" % e

    resp = data.get("Response", {})
    if "Error" in resp:
        return None, "%s: %s" % (resp["Error"].get("Code"), resp["Error"].get("Message"))
    return resp.get("Result", ""), None


def main_handler(event, context):
    method = event.get("httpMethod") or event.get("requestContext", {}).get("http", {}).get("method", "")
    if method == "OPTIONS":
        return _reply(200, {})

    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8", "replace")
    try:
        req = json.loads(body)
    except Exception:
        return _reply(400, {"error": "bad json"})

    audio_b64 = req.get("audio") or ""
    fmt = req.get("format") or "wav"
    if not audio_b64 or len(audio_b64) > MAX_AUDIO * 4 // 3:
        return _reply(413, {"error": "audio too large or empty"})
    try:
        raw = base64.b64decode(audio_b64)
    except Exception:
        return _reply(400, {"error": "bad base64"})

    text, err = _call_asr(audio_b64, len(raw), fmt)
    if err:
        return _reply(502, {"error": err})
    return _reply(200, {"text": text})
