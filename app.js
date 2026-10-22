/* 入戏 · 职场情景对练 MVP */
"use strict";

const $ = (id) => document.getElementById(id);

window.addEventListener("error", (e) => { document.title = "ERR:" + e.message; });

const EXPR = ["smile", "calm", "thinking", "awkward", "displeased"];
const REACTION_KEY = {
  smile: "满意", calm: "平静", thinking: "思考", awkward: "尴尬", displeased: "不悦",
};

let scenes = [];
let cur = null;          // 当前场景对象
let curIdx = 0;
let timerId = null;
let left = 0;
let phase = "idle";      // idle | typing | answering | scoring | result
let recog = null, recogOn = false;

/* 追问状态 */
let followups = {};    // 追问语料：{ "S1": [{point,kw,ask}] }
let round = 1;         // 当前第几轮
let answers = [];      // 用户每轮回答
let peerLines = [];    // 对方每轮台词（trigger + 追问）
let askedPoints = [];  // 已追问过的 rubric 索引
let roundNotes = [];   // 每轮简评
let curExpr = "calm";  // 当前表情（表情实时化）
let lastType = 0;      // 最后一次输入时间
let idleId = null;     // 发呆监视器

/* ---------- 外观主题 ---------- */
function getTheme() { return localStorage.getItem("mvp_theme") || "light"; }
function applyTheme() {
  const t = getTheme();
  document.body.classList.toggle("light", t === "light");
  const b = $("me-theme");
  if (b) b.innerHTML = `外观：${t === "light" ? "浅色" : "深色"}<span>›</span>`;
}

/* ---------- 启动 ---------- */
init();
async function init() {
  applyTheme();
  let ok = true;
  try {
    scenes = await (await fetch("scenes.json?v=4")).json();
  } catch (e) {
    ok = false;
    $("scene-list").innerHTML =
      '<p style="color:#e07b6d;padding:20px">scenes.json 加载失败——请用本地服务器打开<br>python -X utf8 start.py</p>';
  }
  try { followups = await (await fetch("followups.json?v=1")).json(); } catch { followups = {}; }
  if (ok) renderHome();
  bindGlobal();
  loadCfg();
  if (getUser()) {
    $("tabbar").classList.remove("hidden");
    if (location.hash === "#mouthpiece") showTab("mouthpiece");
    const m = location.hash.match(/play=(\d+)/);
    if (m && ok) openScene(Math.min(scenes.length - 1, +m[1]));
  } else {
    $("login").classList.remove("hidden");
  }
}

/* ---------- 用户与登录 ---------- */
function getUser() {
  try { return JSON.parse(localStorage.getItem("mvp_user") || "null"); } catch { return null; }
}

function doLogin() {
  const name = $("login-name").value.trim() || "职场练习生";
  localStorage.setItem("mvp_user", JSON.stringify({ name, since: Date.now() }));
  $("login").classList.add("hidden");
  $("home").classList.remove("hidden");
  $("tabbar").classList.remove("hidden");
}

function renderHome() {
  $("home-sub").textContent = `职场情景对练 · ${scenes.length} 幕`;
  $("scene-list").innerHTML = scenes.map((s, i) => `
    <button class="scene-item" style="background-image:url('assets/${s.bg}')" data-i="${i}">
      <div class="veil"></div>
      <div class="txt"><b>${s.id} · ${s.title}</b><span>${s.tag}</span></div>
      <div class="diff">${"★".repeat(s.difficulty)}</div>
    </button>`).join("");
  document.querySelectorAll(".scene-item").forEach((el) =>
    el.addEventListener("click", () => openScene(+el.dataset.i)));
}

/* ---------- 底部导航 ---------- */
function showTab(name) {
  for (const t of ["home", "progress", "me", "mouthpiece"]) $(t).classList.toggle("hidden", t !== name);
  document.querySelectorAll("#tabbar button").forEach((b) =>
    b.classList.toggle("on", b.dataset.tab === name));
  if (name === "progress") renderProgress();
  if (name === "me") renderMe();
}

/* ---------- 练习记录 ---------- */
function getAttempts() {
  try { return JSON.parse(localStorage.getItem("mvp_attempts") || "[]"); } catch { return []; }
}

function saveAttempt(r) {
  const log = getAttempts();
  log.unshift({
    id: cur.id, title: cur.title, total: r.total, dims: r.dims,
    verdict: verdictOf(r.total, r.redline_hit, false), ts: Date.now(),
  });
  localStorage.setItem("mvp_attempts", JSON.stringify(log.slice(0, 200)));
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function streakOf(log) {
  const days = new Set(log.map((a) => dayKey(a.ts)));
  let n = 0;
  const d = new Date();
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1); // 今天没练从昨天算起
  while (days.has(dayKey(d.getTime()))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function renderProgress() {
  const log = getAttempts();
  $("st-count").textContent = log.length;
  if (!log.length) {
    $("st-avg").textContent = "–";
    $("st-streak").textContent = "0";
    $("dim-bars").innerHTML = "";
    $("history").innerHTML = "";
    $("no-history").classList.remove("hidden");
    return;
  }
  $("no-history").classList.add("hidden");
  const avg = Math.round(log.reduce((s, a) => s + a.total, 0) / log.length);
  $("st-avg").textContent = avg;
  $("st-streak").textContent = streakOf(log);
  $("dim-bars").innerHTML = ["看懂", "说对", "办成", "稳住"].map((d) => {
    const v = Math.round(log.reduce((s, a) => s + (a.dims?.[d] || 0), 0) / log.length);
    return `<div><span class="lbl">${d}</span><div class="bar"><i style="width:${v}%"></i></div><span class="val">${v}</span></div>`;
  }).join("");
  $("history").innerHTML = log.slice(0, 10).map((a) => {
    const d = new Date(a.ts);
    const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `<button class="hist-item" data-id="${a.id}">
      <span class="sc${a.total < 55 ? " bad" : ""}">${a.total}</span>
      <span class="t"><b>${a.id} · ${a.title}</b><span>${when} · ${a.verdict}</span></span>
    </button>`;
  }).join("");
  document.querySelectorAll(".hist-item").forEach((el) =>
    el.addEventListener("click", () => {
      const i = scenes.findIndex((s) => s.id === el.dataset.id);
      if (i >= 0) openScene(i);
    }));
}

/* ---------- 我的 ---------- */
function renderMe() {
  const u = getUser() || { name: "职场练习生", since: Date.now() };
  const log = getAttempts();
  $("me-avatar").textContent = (u.name || "练")[0];
  $("me-name").textContent = u.name;
  const days = Math.max(1, Math.ceil((Date.now() - (u.since || Date.now())) / 86400000));
  $("me-since").textContent = `加入第 ${days} 天`;
  const avg = log.length ? Math.round(log.reduce((s, a) => s + a.total, 0) / log.length) : 0;
  $("me-stats").textContent = log.length
    ? `共练 ${log.length} 次 · 平均 ${avg} 分 · 连续 ${streakOf(log)} 天`
    : "还没有练习记录";
}

/* ---------- 场景 ---------- */
function openScene(i) {
  curIdx = i;
  cur = scenes[i];
  phase = "typing";
  $("home").classList.add("hidden");
  $("progress").classList.add("hidden");
  $("me").classList.add("hidden");
  $("mouthpiece").classList.add("hidden");
  $("tabbar").classList.add("hidden");
  $("result").classList.add("hidden");
  $("play").classList.remove("hidden");

  $("bg").src = `assets/${cur.bg}`;
  $("play-title").textContent = `${cur.id} · ${cur.title}`;
  $("play-tag").textContent = cur.tag;
  $("char-name").textContent = cur.char_name;
  $("char-title").textContent = cur.char_title;
  $("setting-line").textContent = cur.setting;
  $("brief-body").innerHTML = (cur.brief || [])
    .map((b) => `<p><b>${b.label}</b>${b.text}</p>`).join("");
  $("brief-card").open = false;
  $("goal-bar").innerHTML = `<b>本幕目标</b>　${cur.goal}`;
  $("goal-bar").classList.remove("hidden");
  $("answer").value = "";
  $("input-bar").classList.add("hidden");
  $("timer").classList.add("hidden");
  round = 1; answers = []; askedPoints = []; roundNotes = [];
  peerLines = [cur.trigger_line];
  setChar(cur.start_expression || "calm", true);

  typewrite(cur.trigger_line, () => {
    phase = "answering";
    $("input-bar").classList.remove("hidden");
    $("answer").focus();
    startTimer(cur.time_limit_s);
    watchIdle();
  });
}

function typewrite(text, done) {
  const b = $("bubble");
  b.classList.remove("hidden");
  b.textContent = "";
  let i = 0;
  const t = setInterval(() => {
    b.textContent = text.slice(0, ++i);
    if (i >= text.length) { clearInterval(t); done && done(); }
  }, 55);
}

function setChar(expr, instant) {
  if (!EXPR.includes(expr)) expr = "calm";
  curExpr = expr;
  const img = $("char");
  const src = `assets/${cur.char}_${expr}.png`;
  if (instant) { img.src = src; return; }
  img.style.opacity = 0;
  setTimeout(() => { img.src = src; img.onload = () => (img.style.opacity = 1); }, 300);
}

/* ---------- 计时 ---------- */
function startTimer(sec) {
  clearInterval(timerId);
  left = sec;
  const el = $("timer");
  el.classList.remove("hidden", "urgent");
  el.textContent = left;
  timerId = setInterval(() => {
    if ($("brief-card").open) return;
    el.textContent = --left;
    if (left <= 10) el.classList.add("urgent");
    if (left <= 0) { clearInterval(timerId); submit(true); }
  }, 1000);
}

/* ---------- 交卷与追问 ---------- */
const ATTACK = ["你什么意思", "明明是你", "不关我事", "凭什么", "你行你上", "我不干了",
  "你爱怎", "随便你", "活该", "神经病", "有病"];

async function submit(timeout) {
  if (phase !== "answering") return;
  phase = "scoring";
  clearInterval(timerId);
  clearInterval(idleId);
  stopRecog();

  const ans = $("answer").value.trim();
  answers.push(ans);
  const btn = $("btn-send");
  btn.disabled = true; btn.textContent = "评…";

  // 空答超时或出口伤人：不追问，直接收卷
  if ((timeout && !ans) || ATTACK.some((k) => ans.includes(k))) return finish(timeout);

  const cfg = getCfg();
  let missed = demoMissed();
  let customAsk = "", note = "";
  if (cfg && cfg.key) {
    try {
      const ev = await llmEval(cfg);
      if (ev) { missed = ev.missed; customAsk = ev.followup; note = ev.round_note; }
    } catch (e) { console.warn("LLM 评估失败，降级演示判定：", e); }
  }
  roundNotes.push(note || demoNote(ans));

  // 专挑没做到的要点追问，最多 3 轮
  const fupList = followups[cur.id] || [];
  const cand = missed
    .map((pi) => fupList.find((f) => f.point === pi))
    .filter((f) => f && !askedPoints.includes(f.point))
    .sort((a, b) => (cur.rubric[b.point]?.weight || 0) - (cur.rubric[a.point]?.weight || 0));

  if (!timeout && round < 3 && (cand.length || customAsk)) {
    const f = cand[0];
    const ask = (customAsk || f.ask).trim();
    if (f) askedPoints.push(f.point);
    peerLines.push(ask);
    btn.disabled = false; btn.textContent = "完成并提交";
    askFollowup(ask, missed.length >= 2 ? "displeased" : "thinking");
    return;
  }
  finish(timeout);
}

/* 收卷：按整段对话评分 */
async function finish(timeout) {
  const btn = $("btn-send");
  const full = answers.map((a, i) => `第${i + 1}轮：${a || "（未作答）"}`).join("\n");
  const cfg = getCfg();
  let r = null;
  if (cfg && cfg.key) {
    try { r = await llmScore(cfg, cur, full, timeout); }
    catch (e) { console.warn("LLM 评分失败，降级演示评分：", e); }
  }
  if (!r) r = localScore(cur, answers.join("\n"), timeout);
  btn.disabled = false; btn.textContent = "完成并提交";
  showResult(r);
}

/* 演示判定：哪些可追问要点还没被覆盖 */
function demoMissed() {
  const full = answers.join("\n");
  return (followups[cur.id] || [])
    .filter((f) => !askedPoints.includes(f.point) && !f.kw.some((k) => full.includes(k)))
    .map((f) => f.point);
}

function demoNote(ans) {
  const fu = followups[cur.id] || [];
  const hit = fu.filter((f) => f.kw.some((k) => (ans || "").includes(k))).length;
  return `命中 ${hit}/${fu.length} 个要点（演示判定）`;
}

function askFollowup(ask, mood) {
  round++;
  phase = "typing";
  setChar(mood || "thinking");
  $("input-bar").classList.add("hidden");
  $("answer").value = "";
  typewrite(ask, () => {
    phase = "answering";
    $("input-bar").classList.remove("hidden");
    $("answer").focus();
    startTimer(45);
    watchIdle();
  });
}

/* 表情实时化：迟迟不开口，对方有脸色 */
function watchIdle() {
  clearInterval(idleId);
  lastType = Date.now();
  idleId = setInterval(() => {
    if (phase !== "answering") return;
    const base = cur.start_expression || "calm";
    if ($("answer").value.trim()) {          // 在写（或语音出了字）：恢复常态
      if (curExpr !== base) setChar(base);
      return;
    }
    const idleS = (Date.now() - lastType) / 1000;
    const want = idleS > 18 ? "displeased" : idleS > 8 ? "thinking" : base;
    if (want !== curExpr) setChar(want);
  }, 2000);
}

/* LLM：找遗漏要点 + 用角色口吻生成追问 */
async function llmEval(cfg) {
  const pts = cur.rubric.map((r, i) => `${i}.${r.dimension}:${r.text}`).join("；");
  const convo = peerLines.map((t, i) => `${cur.char_name}：${t}\n你：${answers[i] ?? ""}`).join("\n");
  const sys = `你是职场情景对练中的对方角色兼评委。
【场景】${cur.title}（${cur.setting}）
【背景资料（用户已知的内部信息）】${(cur.brief || []).map((b) => `${b.label}:${b.text}`).join("；")}
【你的角色】${cur.char_name}·${cur.char_title}
【评分要点】${pts}
【红线】${cur.red_lines.join("；")}
【对话至今】
${convo}
【已追问过的要点索引】${JSON.stringify(askedPoints)}
任务：判断哪些评分要点在现有回答中没做到（纯态度类不算）；从中挑最要害且没追问过的一个，以角色口吻追问一句。
只输出 JSON：{"missed":[索引整数],"followup":"≤40字的追问，没有可追问的给空字符串","round_note":"≤20字点评最新这一轮"}`;
  const res = await fetch(`${cfg.base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: "system", content: sys }],
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const m = (data.choices?.[0]?.message?.content || "").match(/\{[\s\S]*\}/);
  if (!m) throw new Error("返回非 JSON");
  const p = JSON.parse(m[0]);
  return {
    missed: (Array.isArray(p.missed) ? p.missed : []).map(Number).filter((i) => i >= 0 && i < cur.rubric.length),
    followup: String(p.followup || "").slice(0, 60),
    round_note: String(p.round_note || "").slice(0, 40),
  };
}

/* ---------- 本地演示评分 ---------- */
function localScore(s, ans, timeout) {
  const a = ans || "";
  const len = a.length;
  if (timeout && len === 0)
    return { total: 12, dims: { 看懂: 10, 说对: 10, 办成: 10, 稳住: 30 },
      feedback: "时间到了，你一句话都没说。沉默在这种场合就是认输。",
      redline_hit: true, demo: true };

  const has = (...kws) => kws.some((k) => a.includes(k));
  const dims = {
    看懂: 30 + (has("记录", "邮件", "纪要", "事实", "时间线", "数据", "具体") ? 40 : 0)
            + (has("方案", "建议", "选择", "要不", "这样") ? 25 : 0),
    说对: 30 + (has("您", "请", "理解", "明白", "感谢", "辛苦") ? 35 : 0)
            + Math.min(30, Math.floor(len / 6)),
    办成: 20 + (/\d/.test(a) ? 30 : 0)
            + (has("方案", "计划", "日期", "月底", "周", "天", "人天", "万") ? 35 : 0),
    稳住: 85,
  };
  const hitWords = ATTACK.filter((k) => a.includes(k));
  if (hitWords.length) dims.稳住 = 15;

  let redline_hit = hitWords.length > 0;
  if (!redline_hit && len > 0 && len < 8) redline_hit = true; // 敷衍

  // 按 rubric 权重合成
  let total = 0;
  for (const rb of s.rubric) total += (dims[rb.dimension] || 50) * rb.weight;
  total = Math.round(Math.min(97, Math.max(5, total)));
  if (redline_hit) total = Math.min(total, 38);

  return { total, dims,
    feedback: len < 8 && len > 0
      ? "一句话太短了——对方没法接，场面已经冷掉。（演示评分）"
      : `演示评分：命中 ${["记录","邮件","数据","方案","您"].filter((k)=>a.includes(k)).length} 个要点词。配置大模型后可获得逐条点评。（设置 ⚙）`,
    redline_hit, demo: true };
}

/* ---------- 大模型评分 ---------- */
function getCfg() {
  try {
    const c = JSON.parse(localStorage.getItem("mvp_cfg") || "null");
    if (c && c.key) return c;
  } catch {}
  return window.MVP_BUILTIN_CFG || null;
}

async function llmScore(cfg, s, ans, timeout) {
  const sys = `你是职场情景对练的资深教练。用户在模拟场景中对一位角色作答，请你严格评分。
【场景】${s.title}（${s.tag}）
【场合】${s.setting}
【背景资料（用户已知的内部信息，可引用其中事实）】${(s.brief || []).map((b) => `${b.label}:${b.text}`).join("；")}
【对方（${s.char_name}·${s.char_title}）说】${s.trigger_line}
【用户目标】${s.goal}
【弦外之音】${s.subtext}
【评分维度（按权重）】${s.rubric.map((r) => `${r.dimension}(${Math.round(r.weight * 100)}%):${r.text}`).join("；")}
【红线】${s.red_lines.join("；")}
【用户回答】${timeout && !ans ? "（超时未作答）" : ans}

只输出 JSON，不要任何多余文字：
{"total":0-100整数,"dims":{"看懂":0-100,"说对":0-100,"办成":0-100,"稳住":0-100},"feedback":"80字内犀利具体的点评，指出最关键的一处得失","redline_hit":true或false}`;

  const res = await fetch(`${cfg.base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: "system", content: sys }],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const txt = data.choices?.[0]?.message?.content || "";
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("返回非 JSON");
  const p = JSON.parse(m[0]);
  return {
    total: Math.round(Math.min(100, Math.max(0, +p.total || 0))),
    dims: { 看懂: +p.dims?.看懂 || 0, 说对: +p.dims?.说对 || 0, 办成: +p.dims?.办成 || 0, 稳住: +p.dims?.稳住 || 0 },
    feedback: String(p.feedback || ""),
    redline_hit: !!p.redline_hit,
    demo: false,
  };
}

/* ---------- 结果 ---------- */
function scoreToExpr(total, redline) {
  if (redline || total < 40) return "displeased";
  if (total >= 85) return "smile";
  if (total >= 70) return "calm";
  if (total >= 55) return "thinking";
  return "awkward";
}

function verdictOf(total, redline, timeout) {
  if (timeout) return "超时 · 场面已经失控";
  if (redline) return "踩线 · 犯了忌讳";
  if (total >= 85) return "漂亮 · 这局拿下";
  if (total >= 70) return "稳 · 合格的应对";
  if (total >= 55) return "有思路 · 还欠火候";
  if (total >= 40) return "险 · 差点翻车";
  return "失分 · 回去重练";
}

function showResult(r) {
  phase = "result";
  saveAttempt(r);
  const expr = scoreToExpr(r.total, r.redline_hit);
  setChar(expr);
  $("score").textContent = r.total;
  $("verdict").textContent = verdictOf(r.total, r.redline_hit, false);
  $("inner-voice").textContent = cur.reactions[REACTION_KEY[expr]] || "……";
  const fb = $("feedback");
  fb.textContent = r.feedback || "";
  fb.classList.toggle("demo", !!r.demo);
  $("dims").innerHTML = ["看懂", "说对", "办成", "稳住"]
    .map((d) => `<div><b>${Math.round(r.dims[d] ?? 0)}</b>${d}</div>`).join("");
  $("strategies").innerHTML = cur.strategies.map((st) => `
    <div class="stg"><b>${st.type}</b>${st.reply}
      <span class="risk">可能反应：${st.likely_reaction} ｜ 注意：${st.risk_note}</span>
    </div>`).join("");
  $("redline-note").innerHTML =
    `<b>红线勿踩：</b>${cur.red_lines.join("；")}` + (r.redline_hit ? "<br>⚠ 你这次踩线了。" : "");
  const rw = $("rounds");
  rw.innerHTML = answers.length > 1
    ? `<h3>对话回顾 · ${answers.length} 轮</h3>` + answers.map((a, i) => `
      <div class="rd">
        <div class="rd-peer">${cur.char_name}：${peerLines[i] || ""}</div>
        <div class="rd-me">你：${a || "（没开口）"}</div>
        ${roundNotes[i] ? `<div class="rd-note">${roundNotes[i]}</div>` : ""}
      </div>`).join("")
    : "";
  $("result").classList.remove("hidden");
}

/* ---------- 语音 ---------- */
let recStart = 0, recTick = null;
function uiRecStart() {
  $("rec-bar").classList.remove("hidden");
  $("btn-mic").classList.add("rec");
  $("answer").placeholder = "正在听你说…";
  recStart = Date.now();
  $("rec-time").textContent = "0:00";
  clearInterval(recTick);
  recTick = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    $("rec-time").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 500);
}
function uiRecStop() {
  $("rec-bar").classList.add("hidden");
  $("btn-mic").classList.remove("rec");
  $("answer").placeholder = "开口回答他…（也可打字）";
  clearInterval(recTick); recTick = null;
}
let recErrT = null;
function showRecErr(msg) {
  const el = $("rec-err");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(recErrT);
  recErrT = setTimeout(() => el.classList.add("hidden"), 5000);
}
function setupRecog() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;   // 不支持时保留按钮，点击会提示
  recog = new SR();
  recog.lang = "zh-CN";
  recog.interimResults = false;
  recog.onresult = (e) => {
    const t = e.results[0][0].transcript;
    $("answer").value = ($("answer").value + t).slice(0, 500);
  };
  recog.onend = () => { recogOn = false; uiRecStop(); };
  recog.onerror = (e) => {
    recogOn = false; uiRecStop();
    const map = {
      "not-allowed": "麦克风权限被拒：请允许麦克风后再点「说话」，或直接打字",
      "service-not-allowed": "当前浏览器禁用了语音识别服务，请直接打字",
      "network": "这个浏览器的语音识别依赖在线服务，连不上——请直接打字",
      "audio-capture": "没找到麦克风设备，请检查后再试",
      "no-speech": "没听到声音，请靠近话筒再说一次",
    };
    showRecErr(map[e.error] || ("语音识别失败（" + e.error + "），请直接打字"));
  };
}
function stopRecog() { if (recog && recogOn) recog.stop(); }

/* 嘴替语音输入：与对练页同一套机制，写入 #mp-input */
let recogMp = null, recogMpOn = false;
function setupRecogMp() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $("btn-mp-mic").style.display = "none"; return; }
  recogMp = new SR();
  recogMp.lang = "zh-CN";
  recogMp.interimResults = false;
  recogMp.onresult = (e) => {
    const t = e.results[0][0].transcript;
    $("mp-input").value = ($("mp-input").value + t).slice(0, 500);
  };
  recogMp.onend = () => { recogMpOn = false; $("btn-mp-mic").classList.remove("rec"); };
  recogMp.onerror = () => { recogMpOn = false; $("btn-mp-mic").classList.remove("rec"); };
}

/* ---------- 事件 ---------- */
function bindGlobal() {
  $("btn-login").addEventListener("click", doLogin);
  $("login-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });
  document.querySelectorAll("#tabbar button").forEach((b) =>
    b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("me-settings").addEventListener("click", () => $("settings").classList.remove("hidden"));
  $("me-theme").addEventListener("click", () => {
    localStorage.setItem("mvp_theme", getTheme() === "light" ? "dark" : "light");
    applyTheme();
  });
  $("me-about").addEventListener("click", () =>
    alert("入戏 · 职场情景对练 v0.2\n本地演示版：场景教研 + 模拟对练 + 四维评分。\n正式版将支持微信登录、云端同步、彩排模式。"));
  $("me-clear").addEventListener("click", () => {
    if (confirm("确定清空全部练习记录？此操作不可恢复。")) {
      localStorage.removeItem("mvp_attempts");
      renderMe();
    }
  });
  $("me-logout").addEventListener("click", () => {
    if (confirm("退出登录？练习记录会保留在这台设备上。")) {
      localStorage.removeItem("mvp_user");
      location.reload();
    }
  });
  $("btn-back").addEventListener("click", () => {
    clearInterval(timerId); clearInterval(idleId); stopRecog();
    $("play").classList.add("hidden");
    $("tabbar").classList.remove("hidden");
    showTab("home");
    phase = "idle";
  });
  $("btn-home").addEventListener("click", () => {
    clearInterval(idleId);
    $("result").classList.add("hidden");
    $("play").classList.add("hidden");
    $("tabbar").classList.remove("hidden");
    showTab("home");
    phase = "idle";
  });
  $("btn-send").addEventListener("click", () => submit(false));
  $("answer").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(false); }
  });
  $("answer").addEventListener("input", () => { lastType = Date.now(); });
  $("btn-mic").addEventListener("click", () => {
    if (!recog) { showRecErr("此浏览器不支持语音输入，请直接打字（电脑端可用 Chrome/Edge）"); return; }
    if (recogOn) { stopRecog(); }
    else { try { recog.start(); recogOn = true; uiRecStart(); } catch { showRecErr("录音启动失败，请刷新页面后再试，或直接打字"); } }
  });
  $("btn-rec-done").addEventListener("click", () => stopRecog());
  $("btn-retry").addEventListener("click", () => {
    $("result").classList.add("hidden");
    $("answer").value = "";
    $("input-bar").classList.add("hidden");
    round = 1; answers = []; askedPoints = []; roundNotes = [];
    peerLines = [cur.trigger_line];
    phase = "typing";
    setChar(cur.start_expression || "calm");
    typewrite(cur.trigger_line, () => {
      phase = "answering";
      $("input-bar").classList.remove("hidden");
      startTimer(cur.time_limit_s);
      watchIdle();
    });
  });
  $("btn-next").addEventListener("click", () => openScene((curIdx + 1) % scenes.length));
  $("btn-settings").addEventListener("click", () => $("settings").classList.remove("hidden"));
  $("cfg-close").addEventListener("click", () => $("settings").classList.add("hidden"));
  $("cfg-save").addEventListener("click", saveCfg);
  setupRecog();
  setupRecogMp();
}

/* ---------- 设置 ---------- */
function loadCfg() {
  const c = getCfg();
  if (!c) return;
  $("cfg-base").value = c.base || "";
  $("cfg-key").value = c.key === "builtin" ? "" : c.key || "";
  $("cfg-key").placeholder = c.key === "builtin" ? "已内置 API，无需填写" : "API Key";
  $("cfg-model").value = c.model || "";
}
function saveCfg() {
  const c = {
    base: $("cfg-base").value.trim(),
    key: $("cfg-key").value.trim(),
    model: $("cfg-model").value.trim(),
  };
  localStorage.setItem("mvp_cfg", JSON.stringify(c));
  $("settings").classList.add("hidden");
}

/* ---------- 嘴替 / 一键三方案 ---------- */
$("mp-go").addEventListener("click", mpGo);
$("btn-mp-mic").addEventListener("click", () => {
  if (!recogMp) return;
  if (recogMpOn) { recogMp.stop(); recogMpOn = false; }
  else { try { recogMp.start(); recogMpOn = true; $("btn-mp-mic").classList.add("rec"); } catch {} }
});

/* 截图上传：压缩到最长边 1024 的 JPEG，供多模态模型读图 */
let mpImg = null;
$("mp-shot").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1024 / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      mpImg = cv.toDataURL("image/jpeg", 0.8);
      $("mp-shot-img").src = mpImg;
      $("mp-shot-view").classList.remove("hidden");
      $("mp-shot-label").classList.add("hidden");
    };
    img.src = rd.result;
  };
  rd.readAsDataURL(f);
  e.target.value = "";
});
$("mp-shot-x").addEventListener("click", () => {
  mpImg = null;
  $("mp-shot-view").classList.add("hidden");
  $("mp-shot-label").classList.remove("hidden");
});

async function mpGo() {
  const text = $("mp-input").value.trim();
  const extra = $("mp-extra").value.trim();
  const out = $("mp-out");
  const cfg = getCfg();
  const hasLlm = cfg && cfg.key;
  if (!text && !mpImg) { out.innerHTML = '<p class="empty-note">先把对方的原话粘进来，或上传聊天截图。</p>'; return; }
  if (!text && mpImg && !hasLlm) { out.innerHTML = '<p class="empty-note">演示模式读不了图——把图里对方那句话打在上面，或去设置 ⚙ 配个能看图的大模型。</p>'; return; }
  const btn = $("mp-go");
  btn.disabled = true; btn.textContent = "想…";
  if (hasLlm) {
    try {
      const r = await llmMouth(cfg, text, extra, mpImg);
      btn.disabled = false; btn.textContent = "给我三种回法";
      renderMp(r.scene, r.replies, false, r.imgFallback);
      return;
    } catch (e) { console.warn("LLM 嘴替失败，降级场景匹配：", e); }
  }
  btn.disabled = false; btn.textContent = "给我三种回法";
  if (!text) { out.innerHTML = '<p class="empty-note">模型没能读懂这张图——把对方那句话打在上面再试。</p>'; return; }
  const s = demoMouth(text);
  if (s) renderMp(s, s.strategies, true);
  else out.innerHTML = '<p class="empty-note">场景库里还没有这一类——配个大模型（设置 ⚙）就能照你的原话定制三种回法；或者去对练页挑一幕相近的练。</p>';
}

/* 演示模式：用追问关键词 + 台词二字片段，把原话匹配到最像的一幕 */
const MP_STOP = new Set(["今天","明天","昨天","我们","你们","他们","这个","那个","什么","怎么","现在","已经","就是","还是","一下","没有","可以","因为","所以","但是","如果","哈哈","呵呵","天气","不错","好的","知道","觉得","应该","时候","东西","事情","这样","那样","一个","自己","大家","真的","中午","晚上","早上","吃饭","朋友","你好","谢谢","请问","干嘛","为啥","就是","有点","非常","特别","可能","大概","应该","怎么办"]);
function demoMouth(text) {
  let best = null, bestScore = 0;
  for (const s of scenes) {
    let score = 0;
    for (const f of followups[s.id] || [])
      for (const k of f.kw) if (text.includes(k)) score += 2;
    const flat = (s.trigger_line + s.setting).replace(/[，。！？…""''——、：；（）()\s]/g, "");
    for (let i = 0; i + 2 <= flat.length; i += 2) {
      const frag = flat.slice(i, i + 2);
      if (!MP_STOP.has(frag) && text.includes(frag)) score += 1;
    }
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore >= 3 ? best : null;
}

/* LLM：按原话（可选截图+背景）定制三种回法，并挑最像的一幕 */
async function llmMouth(cfg, text, extra, img) {
  const lib = scenes.map((s) => `${s.id} ${s.title}`).join("；");
  const sys = `你是资深职场话术教练。用户收到一段话，要三种可直接照发的回复策略。
【对方身份】${$("mp-who").value} 【用户目的】${$("mp-goal").value}
【对方原话】${text || "（见聊天截图，先读出图里对方最后说的那段话作为原话）"}
${extra ? `【用户补充背景】${extra}\n` : ""}要求：三种策略依次为稳妥、推进、守边界；reply ≤80字、口语、能直接照发；risk ≤20字写清代价。
再从场景库里挑最像的一幕（都不像就空字符串）：${lib}
只输出 JSON：{"replies":[{"type":"稳妥","reply":"...","risk":"..."},{"type":"推进","reply":"...","risk":"..."},{"type":"守边界","reply":"...","risk":"..."}],"scene":"S14"}`;
  const call = async (content) => {
    const res = await fetch(`${cfg.base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "user", content }],
        temperature: 0.5,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const m = (data.choices?.[0]?.message?.content || "").match(/\{[\s\S]*\}/);
    if (!m) throw new Error("返回非 JSON");
    const p = JSON.parse(m[0]);
    const replies = (Array.isArray(p.replies) ? p.replies : []).slice(0, 3)
      .map((r) => ({ type: String(r.type || "策略"), reply: String(r.reply || ""), risk: String(r.risk || "") }));
    if (replies.length !== 3 || replies.some((r) => !r.reply)) throw new Error("回复不足三条");
    return { scene: scenes.find((x) => x.id === String(p.scene || "")) || null, replies };
  };
  if (img) {
    try {
      return await call([{ type: "text", text: sys }, { type: "image_url", image_url: { url: img } }]);
    } catch (e) {
      if (!text) throw e;
      console.warn("带图请求失败，改走纯文字：", e);
      const r = await call(sys);
      r.imgFallback = true;
      return r;
    }
  }
  return call(sys);
}

function copyText(t, btn) {
  const done = () => {
    btn.textContent = "已复制 ✓"; btn.classList.add("ok");
    setTimeout(() => { btn.textContent = "复制"; btn.classList.remove("ok"); }, 1500);
  };
  let ok = false;
  try {
    const ta = document.createElement("textarea");
    ta.value = t; ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta); ta.select();
    ok = document.execCommand("copy");
    document.body.removeChild(ta);
  } catch (e) {}
  if (ok) { done(); return; }
  if (navigator.clipboard && navigator.clipboard.writeText)
    navigator.clipboard.writeText(t).then(done).catch(() => {});
}

function renderMp(scene, replies, demo, imgFallback) {
  const out = $("mp-out");
  const cards = replies.map((r, i) => `
    <div class="stg"><b>${r.type}</b><button class="mp-copy" data-i="${i}">复制</button>${r.reply}
      <span class="risk">${r.likely_reaction ? "可能反应：" + r.likely_reaction + " ｜ " : ""}注意：${r.risk || r.risk_note || ""}</span>
    </div>`).join("");
  out.innerHTML =
    (scene ? `<p class="mp-match">这场面像「${scene.id} · ${scene.title}」${demo ? "（场景库匹配）" : ""}</p>` : "")
    + cards
    + (imgFallback ? `<p class="empty-note">模型读不了截图，已只按文字信息定制。</p>` : "")
    + (scene ? `<button id="mp-practice">去练这一幕 ›</button>` : "")
    + (demo ? `<p class="empty-note">演示匹配基于场景库关键词；配大模型可按原话定制。（设置 ⚙）</p>` : "");
  out.querySelectorAll(".mp-copy").forEach((b) =>
    b.addEventListener("click", () => copyText(replies[+b.dataset.i].reply, b)));
  if (scene) $("mp-practice").addEventListener("click", () => {
    const i = scenes.findIndex((x) => x.id === scene.id);
    if (i >= 0) openScene(i);
  });
}
