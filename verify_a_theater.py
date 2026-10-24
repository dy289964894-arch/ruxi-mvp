# -*- coding: utf-8 -*-
"""入戏 A 剧场版 · 无头浏览器冒烟验证（v2：对齐设计稿 7.2/7.3/7.5 的结构断言）"""
import json, re, os, sys, time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8765/"
OUT = "verify_shots"
os.makedirs(OUT, exist_ok=True)

# 真链路：走 start.py 的本地 DeepSeek 代理（key 只在服务端 .env，不进浏览器）
REAL_CFG = {"base": "http://localhost:8765/api", "key": "proxy", "model": "deepseek-chat"}

console_errs, page_errs, net_log, llm_resps = [], [], [], []
fails = []

def check(name, cond, detail=""):
    tag = "OK " if cond else "FAIL"
    print(f"  [{tag}] {name}" + (f" | {detail}" if detail else ""))
    if not cond:
        fails.append(name)

def extract_json(txt):
    """括号配平提取首个完整 JSON 对象（与 app.js extractJson 同逻辑）"""
    start = txt.find("{")
    if start < 0:
        raise ValueError("no json")
    depth, in_str, esc = 0, False, False
    for i in range(start, len(txt)):
        ch = txt[i]
        if in_str:
            if esc: esc = False
            elif ch == "\\": esc = True
            elif ch == '"': in_str = False
            continue
        if ch == '"': in_str = True
        elif ch == "{": depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return txt[start:i + 1]
    raise ValueError("unbalanced json")

with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
    pg = br.new_page(viewport={"width": 414, "height": 860}, permissions=["microphone"])
    pg.on("console", lambda m: console_errs.append(m.text) if m.type in ("error",) else None)
    pg.on("pageerror", lambda e: page_errs.append(str(e)))
    pg.on("request", lambda r: net_log.append(r.url))
    pg.on("response", lambda r: llm_resps.append(r) if "/chat/completions" in r.url else None)

    # 1. 登录
    pg.goto(BASE, wait_until="networkidle")
    pg.evaluate("localStorage.clear()")
    pg.reload(wait_until="networkidle")
    pg.fill("#login-name", "小林")
    pg.click("#btn-login")
    pg.wait_for_selector("#today-scenes .tsc", timeout=8000)
    time.sleep(0.6)
    pg.screenshot(path=f"{OUT}/01-today.png", full_page=False)
    print("[1] 今日页 OK, 题目卡:", pg.locator("#today-scenes .tsc").count())

    # 1b. 7.1 结构断言
    check("今日题目卡恰好 4 张", pg.locator("#today-scenes .tsc").count() == 4)
    check("DOM 无「全部场景」块", pg.locator("#scene-list").count() == 0
          and pg.locator(".scene-item").count() == 0)
    check("任务卡 kicker「今日练习」", pg.locator("#task-kicker").inner_text() == "今日练习")
    check("任务卡背景图+遮罩", pg.locator("#task-bg").count() == 1
          and pg.locator("#task-veil").count() == 1)
    check("嘴力等级有进度条", pg.locator("#level-bar").count() == 1
          and pg.locator("#level-bar-i").count() == 1)
    tsc_labels = pg.locator(".tsc-new").all_inner_texts()
    check("角标无「练过」状态", all("练过" not in t for t in tsc_labels), " | ".join(tsc_labels))
    check("连续天数 chip 常显（streak=0 也显示）", pg.locator("#streak-chip").is_visible())
    tb_html = pg.locator("#tabbar").inner_html()
    check("TabBar 用 SVG 无 emoji", tb_html.count("<svg") >= 5
          and not any(e in tb_html for e in ["☀", "🎭", "💬", "📈", "👤"]))
    check("嘴替圆钮 52px 上凸", pg.locator("#tab-mp .mp-bubble").count() == 1)
    check("快捷输入胶囊（input+语音+截图）", pg.locator("#mp-quick").count() == 1
          and pg.locator("#mp-quick-mic").count() == 1 and pg.locator("#mp-quick-shot").count() == 1)

    # 1c. 快捷输入行为：回车 → 嘴替 tab 预填
    pg.fill("#mp-quick", "测试预填一句话")
    pg.press("#mp-quick", "Enter")
    time.sleep(0.4)
    check("回车切嘴替并预填", pg.locator("#mp-input").input_value() == "测试预填一句话")
    pg.click("#tabbar button[data-tab=home]")
    time.sleep(0.3)

    # 1d. 已删除块在 DOM 中不存在
    for sel in ["#brief-card", "#dims", "#rounds", "#inner-voice"]:
        check(f"DOM 无 {sel}", pg.locator(sel).count() == 0)

    # 真链路配置：本地代理
    pg.evaluate("localStorage.setItem('mvp_cfg', %s)" % json.dumps(json.dumps(REAL_CFG)))

    # 2. reveals.json 在作答前不得请求（硬规则1）
    reveals_before = [u for u in net_log if "reveals.json" in u]
    check("[2] 作答前 reveals.json 未请求", len(reveals_before) == 0, f"请求数={len(reveals_before)}")

    # 3. 进入第一幕
    pg.click("#today-scenes .tsc >> nth=0")
    pg.wait_for_selector("#idle-area:not(.hidden)", timeout=10000)
    time.sleep(0.5)
    pg.screenshot(path=f"{OUT}/02-play-idle.png")
    check("[3] 作答页 idle", pg.locator("#btn-big-mic").is_visible(),
          "字幕: " + pg.locator("#bubble").inner_text()[:20])

    # 4. 点大麦克风 → 录音（假麦）；ASR 未配置 → 失败态 → 打字代替
    pg.click("#btn-big-mic")
    try:
        pg.wait_for_selector("#rec-area:not(.hidden)", timeout=6000)
        print("[4] 录音区出现 OK")
        time.sleep(2.2)
        pg.screenshot(path=f"{OUT}/03-recording.png")
        pg.click("#btn-done")
        pg.wait_for_selector("#rec-err:not(.hidden)", timeout=8000)
        print("[5] ASR 失败态 OK:", pg.locator("#rec-err-msg").inner_text()[:30])
        pg.screenshot(path=f"{OUT}/04-asr-error.png")
        pg.click("#rec-err-btns button:has-text('打字代替')")
        pg.wait_for_selector("#input-bar:not(.hidden)", timeout=4000)
        print("[6] 打字代替 OK")
    except Exception as e:
        print("[4-6] 录音链路异常:", e)
        pg.screenshot(path=f"{OUT}/04-fail.png")
        pg.click("#btn-type-instead")

    # 7. 打字提交 → 真链路评分（llmScore）；追问则再答，最多 3 轮
    pg.fill("#answer", "赵宇，我周三就把资料发你邮箱了，我这有邮件记录，咱们会后对一下时间线。")
    pg.click("#btn-send")
    for rnd in range(3):
        try:
            pg.wait_for_selector("#result:not(.hidden)", timeout=60000)
            break
        except Exception:
            pg.wait_for_selector("#idle-area:not(.hidden)", timeout=15000)
            pg.click("#btn-type-instead")
            pg.wait_for_selector("#input-bar:not(.hidden)", timeout=5000)
            pg.fill("#answer", "邮件标题是需求确认，周三下午四点发的，我可以现在投屏。")
            pg.click("#btn-send")
    time.sleep(0.8)
    pg.screenshot(path=f"{OUT}/05-result-top.png")
    reveals_after = [u for u in net_log if "reveals.json" in u]
    check("[7] 提交后 reveals.json 已请求", len(reveals_after) >= 1, f"请求数={len(reveals_after)}")
    print("    总分:", pg.locator("#score").inner_text(),
          "| 印章:", pg.locator("#seal-tag").inner_text(),
          "| 嘴力值:", pg.locator("#points-delta").inner_text())
    scene_line = pg.locator("#result-scene").inner_text()
    check("结果页头部带「今日 n/5」", bool(re.search(r"今日 \d/5", scene_line)), scene_line)
    check("结果页导航居中标题「单轮结果」+ 返回箭头",
          pg.locator("#result-nav b").inner_text() == "单轮结果" and pg.locator("#result-nav #btn-home").count() == 1)
    n_rubric = pg.locator("#rubric-list li").count()
    n_note = pg.locator("#rubric-list .pt-note").count()
    check("评分要点渲染（带 ok/note 小字）", n_rubric >= 3, f"要点 {n_rubric} 条, 原因小字 {n_note} 条")
    print("    语音指标可见:", pg.locator("#voice-card").is_visible(), "(打字局应隐藏)")

    # 7b. 雷区卡：显示状态与命中数必须一致（未命中=display:none）
    rl_display = pg.evaluate("getComputedStyle(document.getElementById('redline-card')).display")
    rl_n = pg.locator("#redline-n").inner_text()
    check("雷区卡状态自洽（无命中则隐藏）", (rl_display == "none") == (rl_n == ""),
          f"display={rl_display}, 命中文案={rl_n!r}")
    if rl_display != "none":
        print("    雷区 chips:", pg.locator(".rl-chip").count())

    # 7c. 高分示范横滑卡：3 个「听一遍」，无复制/反应/风险旧元素
    check("高分示范 3 个「听一遍」", pg.locator(".stg-listen").count() == 3)
    check("示范卡无旧字段", pg.locator(".stg-copy").count() == 0
          and pg.locator(".stg-react").count() == 0 and pg.locator(".stg-risk").count() == 0)
    b0 = pg.locator(".stg-listen >> nth=0")
    b0.click()
    time.sleep(0.4)
    txt_on = b0.inner_text()
    b0.click()
    time.sleep(0.3)
    print("    听一遍切换:", repr(txt_on), "→", repr(b0.inner_text()))

    # 潜台词揭晓
    pg.click("#btn-reveal")
    time.sleep(0.3)
    print("    潜台词揭晓:", pg.locator("#subtext-body").inner_text()[:24])
    pg.locator("#demo-sec").scroll_into_view_if_needed()
    time.sleep(0.4)
    pg.screenshot(path=f"{OUT}/06-result-bottom.png")

    # 7d. 真链路 llmScore 返回结构：redline_hits[] + points_achieved[].ok/note
    score_json = None
    for r in llm_resps:
        try:
            c = r.json()["choices"][0]["message"]["content"]
            if "points_achieved" in c:
                score_json = c
        except Exception:
            pass
    if score_json:
        print("    [LLM] 原始返回长度:", len(score_json), "| 尾部:", repr(score_json[-80:]))
        try:
            pj = json.loads(extract_json(score_json))
            pa = pj.get("points_achieved")
            struct_ok = isinstance(pj.get("redline_hits"), list) and isinstance(pa, list) \
                and all(isinstance(x, dict) and "ok" in x and "note" in x for x in pa)
            check("[LLM] llmScore 新字段结构", struct_ok,
                  f"redline_hits={pj.get('redline_hits')}")
            print("    [LLM] points_achieved:",
                  json.dumps(pa, ensure_ascii=False)[:400])
            print("    [LLM] rewritten_text:", str(pj.get("rewritten_text"))[:60])
        except Exception as e:
            check("[LLM] llmScore 返回可解析", False, str(e))
    else:
        check("[LLM] 捕获到 llmScore 响应", False, "未捕获含 points_achieved 的响应（可能降级演示）")

    # 8. 再练一遍 → 清 LLM 配置走演示降级：未命中雷区时红卡必须隐藏
    pg.click("#btn-retry")
    pg.wait_for_selector("#idle-area:not(.hidden)", timeout=10000)
    print("[8] 再练一遍 OK")
    pg.evaluate("localStorage.setItem('mvp_cfg', JSON.stringify({base:'',key:'',model:''})); window.MVP_BUILTIN_CFG=null;")
    pg.click("#btn-type-instead")
    pg.wait_for_selector("#input-bar:not(.hidden)", timeout=5000)
    pg.fill("#answer", "赵宇，我周三就把资料发你邮箱了，有邮件记录，咱们会后对一下时间线。")
    pg.click("#btn-send")
    for rnd in range(3):
        try:
            pg.wait_for_selector("#result:not(.hidden)", timeout=20000)
            break
        except Exception:
            pg.wait_for_selector("#idle-area:not(.hidden)", timeout=8000)
            pg.click("#btn-type-instead")
            pg.fill("#answer", "周三下午四点发的，标题是需求确认，我可以现在投屏对记录。")
            pg.click("#btn-send")
    time.sleep(0.6)
    demo_rl = pg.evaluate("getComputedStyle(document.getElementById('redline-card')).display")
    check("[8b] 演示局未踩线 → 雷区卡隐藏", demo_rl == "none", f"display={demo_rl}")
    demo_notes = pg.locator("#rubric-list .pt-note").all_inner_texts()
    check("[8b] 演示局要点带「演示判定」", any("演示判定" in t for t in demo_notes),
          " | ".join(demo_notes[:2]))
    check("[8b] 演示局 AI 标识自动隐藏", not pg.locator("#comment-ai").is_visible())
    pg.screenshot(path=f"{OUT}/06b-result-demo.png")

    # 9. 回今日页 → 数据刷新
    pg.click("#btn-home")
    pg.wait_for_selector("#home:not(.hidden)", timeout=5000)
    time.sleep(0.5)
    print("[9] 今日页刷新: 新题", pg.locator("#today-new").inner_text() + "/5",
          "| 等级:", pg.locator("#level-name").inner_text(),
          "| 嘴力next:", pg.locator("#level-next").inner_text().replace("\n", " ")[:24],
          "| 继续实战进度:", pg.locator("#continue-sub").inner_text()
          if pg.locator("#continue-card").is_visible() else "无")
    pg.screenshot(path=f"{OUT}/07-today-after.png")

    # 10. 嘴替 demo（场景匹配路径）：3 chips + 重新输入行
    pg.click("#tabbar button[data-tab=mouthpiece]")
    pg.fill("#mp-input", "这个方案今晚必须给我，做不完你自己看着办")
    pg.click("#mp-go")
    time.sleep(1.0)
    pg.screenshot(path=f"{OUT}/08-mouthpiece.png")
    check("[10] 嘴替 demo 回复卡 3 张", pg.locator(".mp-reply").count() == 3)
    check("[10] 嘴替识别 chips 3 个（对方/场合/你的目标）", pg.locator(".mp-chip").count() == 3,
          " | ".join(pg.locator(".mp-chip").all_inner_texts()))
    check("[10] 「你遇到的」卡含重新输入 3 入口 + 遮挡提示",
          pg.locator(".mp-reinput button").count() == 3 and pg.locator(".mp-shot-hint").count() == 1)
    check("[10] 识别 chips 题注", "识别出的情况" in (pg.locator(".mp-chips-cap").inner_text()
          if pg.locator(".mp-chips-cap").count() else ""))
    fit_demo = pg.locator(".rp-fit").all_inner_texts()
    print("    demo 适合行:", fit_demo[:2])

    # 11. 嘴替真链路（llmMouth：稳妥/得体/硬气 + fit）
    pg.evaluate("localStorage.setItem('mvp_cfg', %s)" % json.dumps(json.dumps(REAL_CFG)))
    pg.evaluate("window.scrollTo(0,0)")
    pg.fill("#mp-input", "行长在工作群里@我：“代发方案怎么还没发出来？”其实我昨天下午就发到他邮箱了。")
    mp_ok = False
    for attempt in range(3):
        try:
            with pg.expect_response(lambda r: "/chat/completions" in r.url, timeout=90000) as ri:
                pg.click("#mp-go")
            resp = ri.value
            if resp.status != 200:
                print(f"[11] 第{attempt + 1}次代理 HTTP {resp.status}，重试")
                time.sleep(1.5)
                continue
            body = resp.json()["choices"][0]["message"]["content"]
            mj = json.loads(extract_json(body))
            print("    [LLM] 嘴替返回:", json.dumps(
                [{"type": x.get("type"), "fit": x.get("fit")} for x in mj.get("replies", [])],
                ensure_ascii=False)[:300])
            mp_ok = True
            break
        except Exception as e:
            print(f"[11] 第{attempt + 1}次异常: {str(e)[:100]}")
            time.sleep(1.5)
    try:
        pg.wait_for_function(
            "() => document.querySelectorAll('#mp-out .mp-reply').length >= 3", timeout=30000)
        time.sleep(0.8)  # 等 renderMp 重绘
        types = pg.locator(".rp-type").all_inner_texts()
        fits = pg.locator(".rp-fit").all_inner_texts()
        check("[11] 嘴替真链路 3 卡", len(types) == 3, f"策略: {types}")
        check("[11] 策略名为 稳妥/得体/硬气", types == ["稳妥", "得体", "硬气"], f"实际: {types}")
        check("[11] 每卡带「适合」行", all(t.startswith("适合") for t in fits), " | ".join(fits)[:120])
        pg.screenshot(path=f"{OUT}/09-mouthpiece-real.png")
    except Exception as e:
        check("[11] 嘴替真链路", False, str(e)[:120])
        pg.screenshot(path=f"{OUT}/09-mouthpiece-fail.png")

    br.close()

print("\n--- console errors:", len(console_errs))
for e in console_errs[:8]: print("  CE:", e[:160])
print("--- page errors:", len(page_errs))
for e in page_errs[:8]: print("  PE:", e[:160])
print("\n=== 断言失败:", len(fails))
for f in fails: print("  ✗", f)
sys.exit(1 if fails else 0)
