/* 入戏 · 职场情景对练 MVP（A 剧场版） */
"use strict";

const $ = (id) => document.getElementById(id);

window.addEventListener("error", (e) => { document.title = "ERR:" + e.message; });

const EXPR = ["smile", "calm", "thinking", "awkward", "displeased"];
const REACTION_KEY = {
  smile: "满意", calm: "平静", thinking: "思考", awkward: "尴尬", displeased: "不悦",
};

let scenes = [];
let reveals = null;    // 隐藏数据：提交后才 fetch（硬规则1：作答前不下发）
let cur = null;        // 当前场景对象（公开字段 + 提交后合并隐藏字段）
let curIdx = 0;
let timerId = null;
let left = 0;
let phase = "idle";    // idle | typing | answering | scoring | result

/* 追问状态 */
let followups = {};
let round = 1;
let answers = [];
let peerLines = [];
let askedPoints = [];
let roundNotes = [];
let curExpr = "calm";
let lastType = 0;
let idleId = null;

/* ---------- 启动 ---------- */
init();
async function init() {
  let ok = true;
  try {
    scenes = await (await fetch("scenes.json?v=5")).json();
  } catch (e) {
    ok = false;
    $("scene-list").innerHTML =
      '<p style="color:#E8705F;padding:20px">scenes.json 加载失败——请用本地服务器打开<br>python -X utf8 start.py</p>';
  }
  try { followups = await (await fetch("followups.json?v=1")).json(); } catch { followups = {}; }
  if (ok) renderToday();
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

/* 隐藏字段：潜台词/雷区/评分要点/高分示范/反应——首次提交评分时才拉取 */
async function ensureReveals() {
  if (reveals) return;
  try { reveals = await (await fetch("reveals.json?v=1")).json(); } catch { reveals = {}; }
  if (cur && reveals[cur.id]) Object.assign(cur, reveals[cur.id]);
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
  renderToday();
}

/* ---------- 7.1 今日 ---------- */
function greetByHour() {
  const h = new Date().getHours();
  if (h < 6) return "夜深了";
  if (h < 12) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

function getMistakes() {
  try { return JSON.parse(localStorage.getItem("mvp_mistakes") || "[]"); } catch { return []; }
}
function saveMistakes(list) { localStorage.setItem("mvp_mistakes", JSON.stringify(list.slice(0, 60))); }
function dueMistakes() { const now = Date.now(); return getMistakes().filter((m) => m.next_review <= now); }

/* 嘴力值：total/5 四舍五入（TODO(待确认)：规则待 Jackson 拍板） */
function getProgress() {
  try { return JSON.parse(localStorage.getItem("mvp_progress") || "null") || { points: 0 }; }
  catch { return { points: 0 }; }
}
const LEVELS = [ // TODO(待确认)：等级阶梯占位
  { at: 0, name: "实习嘴替" },
  { at: 100, name: "客户经理" },
  { at: 300, name: "高级客户经理" },
  { at: 600, name: "金牌客户经理" },
  { at: 1000, name: "首席嘴替" },
];
function levelOf(points) {
  let cur = LEVELS[0], next = null;
  for (const l of LEVELS) { if (points >= l.at) cur = l; else { next = l; break; } }
  return { cur, next };
}
function addPoints(delta) {
  const p = getProgress();
  p.points = (p.points || 0) + delta;
  localStorage.setItem("mvp_progress", JSON.stringify(p));
  return p.points;
}

function renderToday() {
  const u = getUser();
  $("greeting").textContent = `${greetByHour()}，${(u && u.name) || "练习生"}`;
  const log = getAttempts();
  const streak = streakOf(log);
  $("streak-chip").classList.toggle("hidden", streak <= 0);
  $("streak-n").textContent = streak;

  // 今日任务卡
  const today = dayKey(Date.now());
  const todayLog = log.filter((a) => dayKey(a.ts) === today);
  const todayScenes = new Set(todayLog.map((a) => a.id));
  const newN = Math.min(5, todayScenes.size);
  $("today-new").textContent = `${newN}/5`; // TODO(待确认)：每日新题目标 5
  document.querySelectorAll("#new-segs i").forEach((el, i) => el.classList.toggle("on", i < newN));
  const due = dueMistakes();
  $("due-count").innerHTML = `${due.length} <small>题</small>`;

  // 今日题目横滑：到期复习 > 没练过的 > 最久没练的
  const lastTs = {};
  for (const a of log) if (!lastTs[a.id] || a.ts > lastTs[a.id]) lastTs[a.id] = a.ts;
  const dueIds = new Set(due.map((m) => m.scene_id));
  const ranked = scenes.map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const ad = dueIds.has(a.s.id) ? 0 : 1, bd = dueIds.has(b.s.id) ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return (lastTs[a.s.id] || 0) - (lastTs[b.s.id] || 0);
    });
  $("today-scenes").innerHTML = ranked.slice(0, 6).map(({ s, i }, k) => `
    <button class="tsc" data-i="${i}">
      <div class="tsc-head">
        <img src="assets/${s.char}_calm.png" alt="" onerror="this.style.display='none'">
        <span class="tsc-new">${dueIds.has(s.id) ? "复习" : lastTs[s.id] ? "练过" : `新题 · 第${k + 1}题`}</span>
      </div>
      <div class="tsc-body">
        <div class="tsc-who">${s.char_name} · ${s.char_title}</div>
        <div class="tsc-line">${s.trigger_line}</div>
        <div class="tsc-meta"><span class="stars">${"★".repeat(s.difficulty)}</span><span>${s.time_limit_s} 秒</span></div>
      </div>
    </button>`).join("");
  document.querySelectorAll(".tsc").forEach((el) =>
    el.addEventListener("click", () => openScene(+el.dataset.i)));

  // 继续实战：最近一次练过的幕
  if (log.length) {
    const last = log[0];
    const s = scenes.find((x) => x.id === last.id);
    if (s) {
      $("continue-card").classList.remove("hidden");
      $("continue-bg").src = `assets/${s.bg}`;
      $("continue-title").textContent = `${s.id} · ${s.title}`;
      $("continue-sub").textContent = `上次 ${last.total} 分 · ${last.verdict}`;
      $("continue-card").onclick = () => openScene(scenes.indexOf(s));
    }
  } else {
    $("continue-card").classList.add("hidden");
  }

  // 本周进步：语音指标前后对比
  const voice = log.filter((a) => a.voice);
  const wkAgo = Date.now() - 7 * 864e5;
  const recent = voice.filter((a) => a.ts >= wkAgo);
  const older = voice.filter((a) => a.ts < wkAgo);
  if (recent.length && older.length) {
    const avg = (arr, f) => arr.reduce((s, a) => s + a.voice[f], 0) / arr.length;
    const od0 = avg(older, "open_delay"), od1 = avg(recent, "open_delay");
    const fl0 = avg(older, "fillers"), fl1 = avg(recent, "fillers");
    const arrow = (a, b, unit) => {
      const better = b < a;
      return `<div class="wk">开口用时 <b>${a.toFixed(1)} → ${b.toFixed(1)}</b> <span class="${better ? "up" : "down"}">${unit}</span></div>`;
    };
    $("week-body").innerHTML =
      arrow(od0, od1, "秒") +
      `<div class="wk">口头禅 <b>${fl0.toFixed(0)} → ${fl1.toFixed(0)}</b> <span class="${fl1 <= fl0 ? "up" : "down"}">次</span></div>`;
  } else {
    $("week-body").innerHTML = '<p class="mini-dim">练几局语音后，这里有前后对比。</p>';
  }

  // 嘴力等级
  const p = getProgress();
  const lv = levelOf(p.points || 0);
  $("level-name").textContent = lv.cur.name;
  $("level-next").textContent = lv.next
    ? `再得 ${lv.next.at - (p.points || 0)} 嘴力值 升到${lv.next.name}`
    : "已是最高等级";

  // 全部场景
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
const TABS = ["home", "battle", "mouthpiece", "progress", "me"];
function showTab(name) {
  for (const t of TABS) $(t).classList.toggle("hidden", t !== name);
  document.querySelectorAll("#tabbar button").forEach((b) =>
    b.classList.toggle("on", b.dataset.tab === name));
  if (name === "home") renderToday();
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
    voice: r.voice || null, points_achieved: r.points_achieved || null,
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
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
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
  } else {
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
  // 错题本
  const mks = getMistakes();
  $("no-mistake").classList.toggle("hidden", mks.length > 0);
  $("mistake-list").innerHTML = mks.map((m) => {
    const s = scenes.find((x) => x.id === m.scene_id);
    if (!s) return "";
    const days = Math.ceil((m.next_review - Date.now()) / 864e5);
    const due = days <= 0;
    return `<div class="mk-item">
      <div class="t"><b>${s.id} · ${s.title}</b><span>${due ? "今天到期，该复习了" : `${days} 天后复习`}</span></div>
      <button class="go" data-id="${s.id}">${due ? "去复习" : "再练"}</button>
    </div>`;
  }).join("");
  document.querySelectorAll(".mk-item .go").forEach((el) =>
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
  cur = Object.assign({}, scenes[i]);      // 公开字段；隐藏字段提交后才合并
  phase = "typing";
  for (const t of TABS) $(t).classList.add("hidden");
  $("tabbar").classList.add("hidden");
  $("result").classList.add("hidden");
  $("play").classList.remove("hidden");

  $("bg").src = `assets/${cur.bg}`;
  $("play-title").textContent = `${cur.id} · ${cur.title}`;
  $("play-tag").textContent = cur.tag;
  $("char-name").textContent = cur.char_name;
  $("char-title").textContent = cur.char_title;
  $("situation").textContent = cur.setting;
  const chips = cur.tag.split(/[·,，]/).map((t) => t.trim()).filter(Boolean);
  $("chips").innerHTML = chips.map((c) => `<span class="chip">${c}</span>`).join("")
    + `<span class="chip gold">难度 ${"★".repeat(cur.difficulty)}</span>`
    + `<span class="chip gold">限时 ${cur.time_limit_s} 秒</span>`;
  $("brief-body").innerHTML = (cur.brief || [])
    .map((b) => `<p><b>${b.label}</b>${b.text}</p>`).join("");
  $("brief-card").open = false;
  $("goal-line").innerHTML = `<b>目标</b>　${cur.goal}`;
  $("answer").value = "";
  $("input-bar").classList.add("hidden");
  $("timer").classList.add("hidden");
  round = 1; answers = []; askedPoints = []; roundNotes = [];
  voiceTakes = [];
  peerLines = [cur.trigger_line];
  setChar(cur.start_expression || "calm", true);

  recSend({ type: "RESET" });
  typewrite(cur.trigger_line, () => {
    phase = "answering";
    recSend({ type: "LINE_SHOWN", at: Date.now() });
    showIdleArea();
    startTimer(cur.time_limit_s);
    watchIdle();
  });
}

function showIdleArea() {
  $("idle-area").classList.remove("hidden");
  $("input-bar").classList.add("hidden");
}

function typewrite(text, done) {
  const b = $("bubble");
  b.textContent = "";
  let i = 0;
  const t = setInterval(() => {
    b.textContent = text.slice(0, ++i);
    if (i >= text.length) { clearInterval(t); done && done(); }
  }, 40); // 设计建议 40ms/字
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
    if (left <= 0) {
      clearInterval(timerId);
      const st = recGet().state;
      if (st === "recording" || st === "last_10s" || st === "starting") {
        recSend({ type: "TIMEOUT", at: Date.now() }); // 录音中到时：自动结束并识别（走状态机）
      } else if (st !== "recognizing" && st !== "submitting" && st !== "confirming") {
        submit(true);
      }
    }
  }, 1000);
}

/* ---------- 录音状态机（移植自 reference/recorder-machine.js） ---------- */
const RS = {
  IDLE: "idle", PRE_PERMISSION: "pre_permission", REQUESTING: "requesting_permission",
  DENIED: "permission_denied", STARTING: "starting", RECORDING: "recording",
  LAST10: "last_10s", RECOGNIZING: "recognizing", CONFIRMING: "confirming",
  SUBMITTING: "submitting", NO_VOICE: "no_voice", ASR_ERROR: "asr_error",
  NETWORK_ERROR: "network_error", DONE: "done",
};
const REC_CFG = { warningAtRemainingSec: 10, timeoutIntent: "confirm", voiceThreshold: 0.04, waveformBars: 40 }; // TODO(待确认)：到时后先看文字

let recCtx = null;
let mediaStream = null, audioCtx = null, procNode = null, analyser = null, recChunks = [];
let waveRaf = null, recTicker = null;
let voiceTakes = [];   // 每次语音提交的 {timings, transcript}，结果页语音指标取第一次

function recInitial() {
  return {
    state: RS.IDLE, intent: null, elapsedMs: 0, remainingSec: 0, limitSec: 0,
    warned: false, levels: [], framesReceived: 0, heardVoice: false,
    file: null, transcript: "", originalTranscript: "", inputMode: "voice",
    failedStep: null, error: null,
    timings: { lineShownAt: null, recordStartAt: null, firstVoiceAt: null, recordEndAt: null, endReason: null },
  };
}
function recResetForNewTake(ctx) {
  const fresh = recInitial();
  fresh.timings.lineShownAt = ctx ? ctx.timings.lineShownAt : null;
  return fresh;
}

function recSend(event) {
  if (!recCtx) recCtx = recInitial();
  const out = recTransition(recCtx, event);
  recCtx = out[0];
  recRender();
  for (const ef of out[1]) recEffect(ef);
  return recCtx;
}
function recGet() { return recCtx || (recCtx = recInitial()); }

function recTransition(ctx, event) {
  const st = ctx.state, t = event.type;
  const same = [ctx, []];
  const up = (patch) => [Object.assign({}, ctx, patch), []];
  const stopTo = (intent, endReason, at) => {
    const next = Object.assign({}, ctx, { state: RS.RECOGNIZING, intent });
    next.timings = Object.assign({}, ctx.timings, { endReason, recordEndAt: at || Date.now() });
    return [next, [{ type: "STOP_TICKER" }, { type: "STOP_RECORD", discard: false }]];
  };
  const tryStart = () => {
    if (phase !== "answering") return same;
    return [{ ...recResetForNewTake(ctx), state: RS.STARTING, limitSec: Math.max(5, left || cur.time_limit_s), timings: { ...recResetForNewTake(ctx).timings, lineShownAt: ctx.timings.lineShownAt } },
      [{ type: "START_RECORD" }]];
  };

  if (t === "LINE_SHOWN") return up({ timings: Object.assign({}, ctx.timings, { lineShownAt: event.at }) });
  if (t === "RESET") {
    const fresh = recResetForNewTake(ctx);
    const rec_states = [RS.STARTING, RS.RECORDING, RS.LAST10];
    return [fresh, rec_states.includes(st) ? [{ type: "STOP_TICKER" }, { type: "STOP_RECORD", discard: true }] : []];
  }

  switch (st) {
    case RS.IDLE:
      if (t === "TAP_START") {
        if (event.permission === "granted") return tryStart();
        if (event.permission === "denied") return up({ state: RS.DENIED });
        return up({ state: RS.PRE_PERMISSION });
      }
      if (t === "TAP_TYPE_INSTEAD") return up({ inputMode: "text" });
      return same;

    case RS.PRE_PERMISSION:
      if (t === "PRE_PERMISSION_CONFIRM") return up({ state: RS.REQUESTING });
      if (t === "PRE_PERMISSION_CANCEL") return [{ ...ctx, state: RS.IDLE, inputMode: "text" }, []];
      if (t === "PERMISSION_RESULT") {
        if (event.granted) return tryStart();
        return up({ state: RS.DENIED });
      }
      return same;

    case RS.REQUESTING:
      if (t === "PERMISSION_RESULT") {
        if (event.granted) return tryStart();
        return up({ state: RS.DENIED });
      }
      return same;

    case RS.DENIED:
      if (t === "TAP_START") return tryStart();
      if (t === "TAP_TYPE_INSTEAD") return up({ state: RS.IDLE, inputMode: "text" });
      return same;

    case RS.STARTING:
    case RS.RECORDING:
    case RS.LAST10: {
      if (t === "RECORD_STARTED" && st === RS.STARTING) {
        const r = Object.assign({}, ctx, { state: RS.RECORDING });
        r.timings = Object.assign({}, ctx.timings, { recordStartAt: event.at });
        return [r, [{ type: "START_TICKER" }]];
      }
      if (t === "RECORD_START_FAILED") {
        if (event.code === "MIC_PERMISSION_DENIED") return up({ state: RS.DENIED });
        return [up({ state: RS.IDLE })[0], [{ type: "TOAST", code: "RECORD_START_FAILED" }]];
      }
      if (t === "TICK" && st !== RS.STARTING) {
        const elapsed = Math.max(0, event.now - ctx.timings.recordStartAt);
        const limitMs = ctx.limitSec * 1000;
        if (elapsed >= limitMs) return stopTo(REC_CFG.timeoutIntent, "timeout", event.now);
        const remaining = Math.ceil((limitMs - elapsed) / 1000);
        const n = Object.assign({}, ctx, { elapsedMs: elapsed, remainingSec: remaining });
        if (remaining <= REC_CFG.warningAtRemainingSec && st === RS.RECORDING) {
          n.state = RS.LAST10;
          if (!ctx.warned) { n.warned = true; return [n, [{ type: "VIBRATE" }]]; }
        }
        return [n, []];
      }
      if (t === "FRAME") {
        const levels = ctx.levels.concat([event.level]).slice(-REC_CFG.waveformBars);
        const f = Object.assign({}, ctx, { levels, framesReceived: ctx.framesReceived + 1 });
        if (!ctx.heardVoice && event.level >= REC_CFG.voiceThreshold) {
          f.heardVoice = true;
          f.timings = Object.assign({}, ctx.timings, { firstVoiceAt: event.at });
        }
        return [f, []];
      }
      if (t === "TAP_CANCEL") {
        return [recResetForNewTake(ctx), [{ type: "STOP_TICKER" }, { type: "STOP_RECORD", discard: true }]];
      }
      if (st === RS.STARTING) return same;
      if (t === "TAP_DONE") return stopTo("confirm", "user_done", event.at);
      if (t === "TAP_DONE_SUBMIT") return stopTo("submit", "user_done_submit", event.at);
      if (t === "TIMEOUT") return stopTo(REC_CFG.timeoutIntent, "timeout", event.at);
      return same;
    }

    case RS.RECOGNIZING:
      if (t === "RECORD_STOPPED") {
        const s2 = Object.assign({}, ctx, { file: { path: event.path, durationMs: event.durationMs } });
        if (REC_CFG && ctx.framesReceived > 0 && !ctx.heardVoice)
          return up({ state: RS.NO_VOICE, error: { code: "NO_VOICE" } });
        return [s2, [{ type: "UPLOAD_AUDIO", path: s2.file.path, durationMs: s2.file.durationMs }]];
      }
      if (t === "RECOGNIZED") {
        if (!event.transcript || !String(event.transcript).trim())
          return up({ state: RS.NO_VOICE, error: { code: "NO_VOICE" } });
        const rec = Object.assign({}, ctx, {
          transcript: event.transcript, originalTranscript: event.transcript, error: null,
        });
        if (ctx.intent === "submit") {
          rec.state = RS.SUBMITTING;
          return [rec, [{ type: "SUBMIT", transcript: rec.transcript }]];
        }
        rec.state = RS.CONFIRMING;
        return [rec, []];
      }
      if (t === "RECOGNIZE_FAILED") {
        if (event.code === "NO_VOICE") return up({ state: RS.NO_VOICE, error: { code: "NO_VOICE" } });
        if (event.code === "NETWORK")
          return up({ state: RS.NETWORK_ERROR, failedStep: "recognize", error: { code: "NETWORK" } });
        return up({ state: RS.ASR_ERROR, error: { code: event.code || "ASR_FAILED" } });
      }
      return same;

    case RS.CONFIRMING:
      if (t === "EDIT_TRANSCRIPT") return up({ transcript: event.text });
      if (t === "TAP_SUBMIT") {
        if (!ctx.transcript || !ctx.transcript.trim()) return same;
        const sub = Object.assign({}, ctx, { state: RS.SUBMITTING });
        return [sub, [{ type: "SUBMIT", transcript: sub.transcript }]];
      }
      if (t === "TAP_RERECORD") {
        const fresh = recResetForNewTake(ctx);
        fresh.state = RS.IDLE;
        return [fresh, []];
      }
      return same;

    case RS.SUBMITTING:
      if (t === "SUBMITTED") return up({ state: RS.DONE });
      return same;

    case RS.NO_VOICE:
      if (t === "TAP_START" || t === "TAP_RERECORD") return tryStart();
      if (t === "TAP_TYPE_INSTEAD") return up({ state: RS.IDLE, inputMode: "text" });
      return same;

    case RS.ASR_ERROR:
      if (t === "TAP_RETRY" && ctx.file)
        return [up({ state: RS.RECOGNIZING, error: null })[0],
          [{ type: "UPLOAD_AUDIO", path: ctx.file.path, durationMs: ctx.file.durationMs }]];
      if (t === "TAP_RERECORD" || t === "TAP_START") return tryStart();
      if (t === "TAP_TYPE_INSTEAD") return up({ state: RS.IDLE, inputMode: "text" });
      return same;

    case RS.NETWORK_ERROR:
      if (t === "TAP_RETRY" && ctx.failedStep === "recognize" && ctx.file)
        return [up({ state: RS.RECOGNIZING, error: null })[0],
          [{ type: "UPLOAD_AUDIO", path: ctx.file.path, durationMs: ctx.file.durationMs }]];
      if (t === "TAP_RERECORD") return tryStart();
      if (t === "TAP_TYPE_INSTEAD") return up({ state: RS.IDLE, inputMode: "text" });
      return same;

    case RS.DONE:
      return same;
  }
  return same;
}

/* ---------- 状态机副作用适配层（浏览器） ---------- */
async function micPermissionState() {
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const r = await navigator.permissions.query({ name: "microphone" });
      return r.state === "granted" ? "granted" : r.state === "denied" ? "denied" : "prompt";
    }
  } catch {}
  return "prompt";
}

async function tapStart() {
  const p = await micPermissionState();
  recSend({ type: "TAP_START", permission: p });
}

function recEffect(ef) {
  switch (ef.type) {
    case "START_RECORD": startRecordHW(); break;
    case "STOP_RECORD": stopRecordHW(ef.discard); break;
    case "START_TICKER":
      clearInterval(recTicker);
      recTicker = setInterval(() => recSend({ type: "TICK", now: Date.now() }), 100);
      break;
    case "STOP_TICKER": clearInterval(recTicker); recTicker = null; break;
    case "VIBRATE": try { navigator.vibrate && navigator.vibrate(60); } catch {} break;
    case "TOAST": showRecErr("录音启动失败，请刷新页面再试，或直接打字", []); break;
    case "UPLOAD_AUDIO": uploadAudio(ef); break;
    case "SUBMIT": doVoiceSubmit(ef.transcript); break;
  }
}

async function startRecordHW() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    recSend({ type: "RECORD_START_FAILED", code: "RECORD_START_FAILED" });
    showRecErr("此环境不支持录音（需在 https 页面或微信新版中打开），请直接打字", []);
    return;
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError" || e.name === "NotFoundError");
    recSend({ type: "RECORD_START_FAILED", code: denied ? "MIC_PERMISSION_DENIED" : "RECORD_START_FAILED" });
    return;
  }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(mediaStream);
    procNode = audioCtx.createScriptProcessor(4096, 1, 1);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    recChunks = [];
    procNode.onaudioprocess = (e) => recChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(analyser);
    src.connect(procNode);
    procNode.connect(audioCtx.destination);
  } catch (e) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
    recSend({ type: "RECORD_START_FAILED", code: "RECORD_START_FAILED" });
    return;
  }
  recSend({ type: "RECORD_STARTED", at: Date.now() });
  startWaveLoop();
}

function stopRecordHW(discard) {
  cancelAnimationFrame(waveRaf); waveRaf = null;
  const chunks = recChunks; recChunks = [];
  const rate = audioCtx ? audioCtx.sampleRate : 48000;
  try { procNode && procNode.disconnect(); } catch {}
  try { mediaStream && mediaStream.getTracks().forEach((t) => t.stop()); } catch {}
  try { audioCtx && audioCtx.close(); } catch {}
  audioCtx = null; procNode = null; mediaStream = null; analyser = null;
  if (discard) return;
  const samples = chunks.reduce((s, c) => s + c.length, 0);
  if (!chunks.length || !samples) {
    recSend({ type: "RECORD_STOPPED", path: "", durationMs: 0, at: Date.now() });
    return;
  }
  const wav = encodeWav16k(chunks, rate);
  recSend({ type: "RECORD_STOPPED", path: b64encode(wav), durationMs: Math.round(samples / rate * 1000), at: Date.now() });
}

/* 真实音量波形：AnalyserNode 时域数据 → RMS → 对数压缩（硬规则5） */
function startWaveLoop() {
  const data = new Uint8Array(analyser.fftSize);
  const loop = () => {
    if (!analyser) return;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / data.length);
    const level = rms <= 0 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60));
    recSend({ type: "FRAME", level, at: Date.now() });
    waveRaf = requestAnimationFrame(loop);
  };
  waveRaf = requestAnimationFrame(loop);
}

async function uploadAudio(ef) {
  if (!ef.path) { recSend({ type: "RECOGNIZE_FAILED", code: "NO_VOICE" }); return; }
  const asr = (getCfg() || {}).asr ||
    ((location.hostname === "localhost" || location.hostname === "127.0.0.1") ? "/api/asr" : "");
  if (!asr) { recSend({ type: "RECOGNIZE_FAILED", code: "ASR_NOT_CONFIGURED" }); return; }
  try {
    const res = await fetch(asr, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: ef.path, format: "wav" }),
    });
    if (!res.ok) { recSend({ type: "RECOGNIZE_FAILED", code: "ASR_HTTP_" + res.status }); return; }
    const data = await res.json();
    if (data.text) recSend({ type: "RECOGNIZED", transcript: data.text });
    else recSend({ type: "RECOGNIZE_FAILED", code: "NO_VOICE" });
  } catch (e) {
    recSend({ type: "RECOGNIZE_FAILED", code: "NETWORK" });
  }
}

function doVoiceSubmit(transcript) {
  $("answer").value = transcript;
  if (round === 1) {
    voiceTakes.push({ timings: Object.assign({}, recGet().timings), transcript });
  }
  submit(false);
}

/* ---------- 录音 UI 渲染（状态零歧义，硬规则4） ---------- */
const REC_AREAS = ["idle-area", "rec-area", "recog-area", "confirm-area", "input-bar", "pre-perm"];
function showOnly(id) {
  for (const a of REC_AREAS) $(a).classList.toggle("hidden", a !== id);
  if (!id) for (const a of REC_AREAS) $(a).classList.add("hidden");
}

let recErrState = null;
function showRecErr(msg, btns) {
  const el = $("rec-err");
  if (!msg) { el.classList.add("hidden"); recErrState = null; return; }
  $("rec-err-msg").textContent = msg;
  $("rec-err-btns").innerHTML = "";
  for (const b of btns) {
    const btn = document.createElement("button");
    btn.textContent = b.label;
    if (b.primary) btn.classList.add("primary");
    btn.addEventListener("click", b.fn);
    $("rec-err-btns").appendChild(btn);
  }
  el.classList.remove("hidden");
}

function drawWave(levels, warn) {
  const cv = $("wave");
  const ctx2 = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  ctx2.clearRect(0, 0, W, H);
  const bw = 3, gap = 4, maxH = 36;
  const n = Math.min(levels.length, Math.floor(W / (bw + gap)));
  const start = levels.length - n;
  for (let i = 0; i < n; i++) {
    const lv = levels[start + i];
    const h = Math.max(2, lv * maxH);
    const age = i / Math.max(1, n - 1); // 越新越亮
    ctx2.fillStyle = warn ? "#E8705F" : "#C9A45C";
    ctx2.globalAlpha = 0.4 + 0.6 * age;
    ctx2.fillRect(W - (n - i) * (bw + gap), (H - h) / 2, bw, h);
  }
  ctx2.globalAlpha = 1;
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function recRender() {
  const ctx = recGet();
  const st = ctx.state;
  if (phase !== "answering" && st !== RS.SUBMITTING && st !== RS.DONE) { /* 页外不渲染 */ }
  $("btn-mic").classList.toggle("rec", st === RS.RECORDING || st === RS.LAST10);

  switch (st) {
    case RS.IDLE:
      showRecErr(null);
      if (phase === "answering") {
        if (ctx.inputMode === "text") {
          showOnly("input-bar");
          $("answer").focus();
        } else {
          showOnly("idle-area");
        }
      }
      break;

    case RS.PRE_PERMISSION:
      showOnly("pre-perm");
      $("pre-perm-ok").disabled = false;
      $("pre-perm-ok").textContent = "好，去授权";
      break;

    case RS.REQUESTING:
      showOnly("pre-perm");
      $("pre-perm-ok").disabled = true;
      $("pre-perm-ok").textContent = "等系统授权…";
      break;

    case RS.DENIED:
      showOnly("idle-area");
      showRecErr("麦克风没授权。在浏览器地址栏左侧的锁形图标里允许麦克风，然后回来再点一次。", [
        { label: "再试一次", primary: true, fn: () => { showRecErr(null); tapStart(); } },
        { label: "打字代替", fn: () => recSend({ type: "TAP_TYPE_INSTEAD" }) },
      ]);
      break;

    case RS.STARTING:
    case RS.RECORDING:
    case RS.LAST10: {
      showRecErr(null);
      showOnly("rec-area");
      const warn = st === RS.LAST10;
      $("rec-area").classList.toggle("warn", warn);
      $("rec-status-text").textContent = warn
        ? "最后 10 秒，收个尾"
        : st === RS.STARTING ? "正在启动麦克风…" : "正在录音，说完点“完成并提交”";
      $("rec-time").textContent = fmtElapsed(ctx.elapsedMs);
      $("rec-left").textContent = ctx.remainingSec > 0 ? `剩 ${ctx.remainingSec} 秒` : "";
      const prog = ctx.limitSec ? Math.min(1, ctx.elapsedMs / (ctx.limitSec * 1000)) : 0;
      $("ring-prog").style.strokeDashoffset = String(251.3 * (1 - prog));
      drawWave(ctx.levels, warn);
      $("btn-done").disabled = st === RS.STARTING;
      $("btn-done-submit").disabled = st === RS.STARTING;
      break;
    }

    case RS.RECOGNIZING:
      showRecErr(null);
      showOnly("recog-area");
      $("recog-area").querySelector("p").textContent = "识别中…";
      break;

    case RS.CONFIRMING:
      showOnly("confirm-area");
      if ($("transcript").value !== ctx.transcript) $("transcript").value = ctx.transcript;
      $("btn-submit-text").disabled = !ctx.transcript.trim();
      break;

    case RS.SUBMITTING:
      showOnly("recog-area");
      $("recog-area").querySelector("p").textContent = "提交中…";
      break;

    case RS.NO_VOICE:
      showOnly("idle-area");
      showRecErr("没录到声音——靠近麦克风，声音大一点再说一次。", [
        { label: "重新录音", primary: true, fn: () => { showRecErr(null); tapStart(); } },
        { label: "打字代替", fn: () => recSend({ type: "TAP_TYPE_INSTEAD" }) },
      ]);
      break;

    case RS.ASR_ERROR: {
      showOnly("idle-area");
      const notCfg = ctx.error && ctx.error.code === "ASR_NOT_CONFIGURED";
      const btns = [
        { label: "重新录音", fn: () => { showRecErr(null); tapStart(); } },
        { label: "打字代替", primary: notCfg, fn: () => recSend({ type: "TAP_TYPE_INSTEAD" }) },
      ];
      if (!notCfg && ctx.file)
        btns.unshift({ label: "重试识别", primary: true, fn: () => { showRecErr(null); recSend({ type: "TAP_RETRY" }); } });
      showRecErr(notCfg
        ? "语音转文字服务还没配置（设置里填 ASR 地址）。这次先打字，录好的声音已丢弃。"
        : "识别服务出了问题。录音还在，可以重试识别，或重新录一遍。", btns);
      break;
    }

    case RS.NETWORK_ERROR:
      showOnly("idle-area");
      showRecErr("网络断了，识别请求没发出去。录音还在，连上网络后重试。", [
        { label: "重试识别", primary: true, fn: () => { showRecErr(null); recSend({ type: "TAP_RETRY" }); } },
        { label: "重新录音", fn: () => { showRecErr(null); tapStart(); } },
        { label: "打字代替", fn: () => recSend({ type: "TAP_TYPE_INSTEAD" }) },
      ]);
      break;

    case RS.DONE:
      showOnly(null);
      showRecErr(null);
      break;
  }
}

/* ---------- 交卷与追问 ---------- */
const ATTACK = ["你什么意思", "明明是你", "不关我事", "凭什么", "你行你上", "我不干了",
  "你爱怎", "随便你", "活该", "神经病", "有病"];

async function submit(timeout) {
  if (phase !== "answering") return;
  phase = "scoring";
  clearInterval(timerId);
  clearInterval(idleId);
  await ensureReveals();

  const ans = $("answer").value.trim();
  answers.push(ans);
  const btn = $("btn-send");
  btn.disabled = true; btn.textContent = "评…";

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
    btn.disabled = false; btn.textContent = "提交";
    recSend({ type: "SUBMITTED" });
    askFollowup(ask, missed.length >= 2 ? "displeased" : "thinking");
    return;
  }
  finish(timeout);
}

/* 收卷：按整段对话评分 */
async function finish(timeout) {
  const btn = $("btn-send");
  await ensureReveals();
  const full = answers.map((a, i) => `第${i + 1}轮：${a || "（未作答）"}`).join("\n");
  const cfg = getCfg();
  let r = null;
  if (cfg && cfg.key) {
    try { r = await llmScore(cfg, cur, full, timeout); }
    catch (e) { console.warn("LLM 评分失败，降级演示评分：", e); }
  }
  if (!r) r = localScore(cur, answers.join("\n"), timeout);
  r.voice = voiceMetrics();
  r.points_achieved = pointsAchieved(r);
  btn.disabled = false; btn.textContent = "提交";
  recSend({ type: "SUBMITTED" });
  showResult(r);
}

/* 语音指标：开口用时 / 时长 / 语速 / 口头禅（全部本地算） */
const FILLERS = ["那个", "然后", "就是", "嗯", "呃", "这个", "其实", "反正"];
function voiceMetrics() {
  const take = voiceTakes[0];
  if (!take || !take.timings.recordStartAt) return null;
  const t = take.timings;
  const dur = t.recordEndAt && t.recordStartAt ? (t.recordEndAt - t.recordStartAt) / 1000 : 0;
  const han = (take.transcript.match(/[一-鿿]/g) || []).length;
  let fillers = 0;
  for (const f of FILLERS) fillers += (take.transcript.split(f).length - 1);
  return {
    open_delay: t.firstVoiceAt && t.lineShownAt
      ? Math.max(0, Math.round((t.firstVoiceAt - t.lineShownAt) / 100) / 10) : null, // TODO(待确认)：从台词完整出现起算
    duration: Math.round(dur),
    rate: dur > 1 ? Math.round(han / (dur / 60)) : null,
    fillers,
  };
}

/* 评分要点达成：LLM 给了用 LLM 的；否则按维度分 ≥60 推定 */
function pointsAchieved(r) {
  if (!cur.rubric) return null;
  if (Array.isArray(r.points_achieved_llm) && r.points_achieved_llm.length === cur.rubric.length)
    return r.points_achieved_llm.map(Boolean);
  return cur.rubric.map((rb) => (r.dims[rb.dimension] || 0) >= 60);
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
  showOnly(null);
  $("answer").value = "";
  typewrite(ask, () => {
    phase = "answering";
    recSend({ type: "RESET" });
    recSend({ type: "LINE_SHOWN", at: Date.now() });
    showIdleArea();
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
    const st = recGet().state;
    if (st === RS.RECORDING || st === RS.LAST10 || st === RS.STARTING) return; // 录音中不变脸
    const base = cur.start_expression || "calm";
    if ($("answer").value.trim()) {
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
  if (!redline_hit && len > 0 && len < 8) redline_hit = true;

  let total = 0;
  for (const rb of s.rubric) total += (dims[rb.dimension] || 50) * rb.weight;
  total = Math.round(Math.min(97, Math.max(5, total)));
  if (redline_hit) total = Math.min(total, 38);

  return { total, dims,
    feedback: len < 8 && len > 0
      ? "一句话太短了——对方没法接，场面已经冷掉。（演示评分）"
      : `演示评分：命中 ${["记录","邮件","数据","方案","您"].filter((k)=>a.includes(k)).length} 个要点词。配置大模型后可获得逐条点评。（我的 → 大模型设置）`,
    redline_hit, demo: true };
}

/* ---------- 大模型评分 ---------- */
function getCfg() {
  try {
    const c = JSON.parse(localStorage.getItem("mvp_cfg") || "null");
    if (c && c.key) return { asr: (window.MVP_BUILTIN_CFG || {}).asr || "", ...c };
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
{"total":0-100整数,"dims":{"看懂":0-100,"说对":0-100,"办成":0-100,"稳住":0-100},"feedback":"80字内犀利具体的点评，指出最关键的一处得失","redline_hit":true或false,"points_achieved":[按评分要点顺序逐条true或false],"rewritten_text":"把用户第1轮回答改写成≤60字的高分版本，口语、可直接照说"}`;

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
    points_achieved_llm: Array.isArray(p.points_achieved) ? p.points_achieved.map((x) => !!x) : null,
    rewritten_text: String(p.rewritten_text || "").slice(0, 120),
    demo: false,
  };
}

/* ---------- 7.3 结果 ---------- */
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

function sealLabel(total, redline) {
  if (redline) return "踩线了";
  if (total >= 85) return "漂亮";
  if (total >= 70) return "稳";
  if (total >= 55) return "有思路";
  if (total >= 40) return "差一点";
  return "翻车";
}

/* 字级 LCS diff：原话删除划线 / 改写新增高亮 */
function diffSegs(orig, rew) {
  const a = [...orig], b = [...rew];
  if (a.length > 300 || b.length > 300 || !a.length || !b.length)
    return { o: escapeHtml(orig), r: escapeHtml(rew) };
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let o = "", r = "", i = 0, j = 0;
  const esc = (s) => escapeHtml(s);
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { o += esc(a[i]); r += esc(b[j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { o += `<span class="del">${esc(a[i])}</span>`; i++; }
    else { r += `<span class="add">${esc(b[j])}</span>`; j++; }
  }
  while (i < a.length) { o += `<span class="del">${esc(a[i])}</span>`; i++; }
  while (j < b.length) { r += `<span class="add">${esc(b[j])}</span>`; j++; }
  return { o, r };
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function showResult(r) {
  phase = "result";
  showOnly(null);
  saveAttempt(r);
  const delta = Math.round(r.total / 5); // TODO(待确认)：嘴力值规则
  const points = addPoints(delta);

  // 错题本：踩线或 <60 进本，3 天后复习（TODO(待确认)：间隔 3 天 vs 1/3/7/14）
  let mks = getMistakes();
  const mi = mks.findIndex((m) => m.scene_id === cur.id);
  if (r.redline_hit || r.total < 60) {
    const entry = { scene_id: cur.id, next_review: Date.now() + 3 * 864e5 };
    if (mi >= 0) mks[mi] = entry; else mks.push(entry);
    saveMistakes(mks);
  } else if (mi >= 0) {
    mks.splice(mi, 1);
    saveMistakes(mks);
  }

  const expr = scoreToExpr(r.total, r.redline_hit);
  setChar(expr);

  $("result-scene").textContent = `${cur.id} · ${cur.title}`;
  $("score").textContent = r.total;
  const seal = $("seal-tag");
  seal.textContent = sealLabel(r.total, r.redline_hit);
  seal.classList.toggle("good", !r.redline_hit && r.total >= 70);
  $("points-delta").textContent = `嘴力值 +${delta}`;
  $("one-comment").textContent = r.feedback || "";
  $("comment-ai").classList.toggle("hidden", !!r.demo);
  document.querySelector("#result .ai-note").classList.toggle("hidden", !!r.demo);
  $("inner-voice").textContent = (cur.reactions && cur.reactions[REACTION_KEY[expr]]) || "……";
  $("dims").innerHTML = ["看懂", "说对", "办成", "稳住"]
    .map((d) => `<div><b>${Math.round(r.dims[d] ?? 0)}</b>${d}</div>`).join("");

  // 评分要点 ✓/×（图标+文字，不只红绿——硬规则6）
  if (cur.rubric && r.points_achieved) {
    const ach = r.points_achieved.filter(Boolean).length;
    $("rubric-ach").textContent = `达成 ${ach}/${cur.rubric.length}`;
    $("rubric-list").innerHTML = cur.rubric.map((rb, i) => {
      const ok = !!r.points_achieved[i];
      return `<li class="${ok ? "ok" : "no"}">
        <span class="ico">${ok ? "✓" : "✕"}</span>
        <span class="txt">${rb.text}</span>
        <span class="dim">${rb.dimension}</span>
      </li>`;
    }).join("");
  } else {
    $("rubric-ach").textContent = "";
    $("rubric-list").innerHTML = "";
  }

  // 雷区
  const hitRl = r.redline_hit;
  $("redline-card").classList.toggle("hidden", !hitRl && !(cur.red_lines || []).length);
  $("redline-card").querySelector("h3").textContent = hitRl ? "⚠ 雷区命中" : "雷区（这次没踩）";
  $("redline-list").classList.toggle("safe", !hitRl);
  $("redline-list").innerHTML = (cur.red_lines || []).map((l) => `<li>${l}</li>`).join("");

  // 语音指标（打字局为 null）
  const v = r.voice;
  if (v) {
    $("voice-card").classList.remove("hidden");
    $("v-open").innerHTML = v.open_delay != null ? `${v.open_delay}<small> 秒</small>` : "–";
    const openBad = v.open_delay != null && v.open_delay > 2; // TODO(待确认)：开口目标 ≤2 秒
    $("v-open-tag").textContent = v.open_delay == null ? "没等到开口" : openBad ? "偏慢 · 目标 ≤2 秒" : "反应够快";
    $("v-open-tag").className = openBad ? "bad" : "good";
    $("v-dur").innerHTML = `${v.duration}<small> 秒</small>`;
    $("v-dur-tag").textContent = `限时 ${cur.time_limit_s} 秒内`;
    $("v-dur-tag").className = "good";
    $("v-rate").innerHTML = v.rate != null ? `${v.rate}<small> 字/分</small>` : "–";
    const rateBad = v.rate != null && (v.rate < 120 || v.rate > 300);
    $("v-rate-tag").textContent = v.rate == null ? "" : v.rate < 120 ? "偏慢" : v.rate > 300 ? "偏快" : "正常区间";
    $("v-rate-tag").className = rateBad ? "bad" : "";
    $("v-filler").innerHTML = `${v.fillers}<small> 次</small>`;
    $("v-filler-tag").textContent = v.fillers >= 5 ? "偏多 · 留意“就是/那个”" : v.fillers > 0 ? "有，但不多" : "干净";
    $("v-filler-tag").className = v.fillers >= 5 ? "bad" : v.fillers ? "" : "good";
  } else {
    $("voice-card").classList.add("hidden");
  }

  // 原话 → 改写版
  const firstAns = answers[0] || "";
  if (r.rewritten_text && firstAns.trim()) {
    const segs = diffSegs(firstAns, r.rewritten_text);
    $("orig-seg").innerHTML = segs.o;
    $("rew-seg").innerHTML = segs.r;
    $("rewrite-card").classList.remove("hidden");
  } else {
    $("rewrite-card").classList.add("hidden");
  }

  // 对话回顾
  $("rounds").innerHTML = answers.length > 1
    ? `<h3>对话回顾 · ${answers.length} 轮</h3>` + answers.map((a, i) => `
      <div class="rd">
        <div class="rd-peer">${cur.char_name}：${peerLines[i] || ""}</div>
        <div class="rd-me">你：${a || "（没开口）"}</div>
        ${roundNotes[i] ? `<div class="rd-note">${roundNotes[i]}</div>` : ""}
      </div>`).join("")
    : "";

  // 潜台词揭晓
  $("subtext-body").textContent = cur.subtext || "";
  $("subtext-body").classList.add("hidden");
  $("btn-reveal").classList.remove("hidden");

  // 高分示范（提交后才拿到的 reveals）
  $("strategies").innerHTML = (cur.strategies || []).map((st, i) => `
    <div class="stg">
      <span class="stg-type">${st.type}</span>
      <div class="stg-reply">${st.reply}</div>
      <div class="stg-react">可能反应：${st.likely_reaction}</div>
      <div class="stg-risk">注意：${st.risk_note}</div>
      <button class="stg-copy" data-i="${i}">复制</button>
    </div>`).join("");
  document.querySelectorAll(".stg-copy").forEach((b) =>
    b.addEventListener("click", () => copyText(cur.strategies[+b.dataset.i].reply, b)));

  $("mistake-note").classList.toggle("hidden", !(r.redline_hit || r.total < 60));
  $("result").classList.remove("hidden");
  $("result-scroll").scrollTop = 0;
}

/* ---------- 事件 ---------- */
function bindGlobal() {
  $("btn-login").addEventListener("click", doLogin);
  $("login-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });
  document.querySelectorAll("#tabbar button").forEach((b) =>
    b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("mp-entry").addEventListener("click", () => showTab("mouthpiece"));
  $("battle-go").addEventListener("click", () => showTab("home"));
  $("btn-today-go").addEventListener("click", () => {
    const due = dueMistakes();
    if (due.length) {
      const i = scenes.findIndex((s) => s.id === due[0].scene_id);
      if (i >= 0) return openScene(i);
    }
    const played = new Set(getAttempts().map((a) => a.id));
    const fresh = scenes.findIndex((s) => !played.has(s.id));
    openScene(fresh >= 0 ? fresh : getAttempts().length % scenes.length);
  });
  $("me-settings").addEventListener("click", () => $("settings").classList.remove("hidden"));
  $("me-about").addEventListener("click", () =>
    alert("入戏 · 职场情景对练 v0.3（A 剧场版）\n模型：DeepSeek（自配或内置代理）\n备案号：占位（待补充）\n本地演示版：练习数据只存在这台设备上。"));
  $("me-clear").addEventListener("click", () => {
    if (confirm("确定清空全部练习记录？此操作不可恢复。")) {
      for (const k of ["mvp_attempts", "mvp_mistakes", "mvp_progress"]) localStorage.removeItem(k);
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
    clearInterval(timerId); clearInterval(idleId);
    recSend({ type: "RESET" });
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

  /* 录音控件 */
  $("btn-big-mic").addEventListener("click", tapStart);
  $("btn-mic").addEventListener("click", () => { showOnly(null); showIdleArea(); tapStart(); });
  $("btn-type-instead").addEventListener("click", () => recSend({ type: "TAP_TYPE_INSTEAD" }));
  $("btn-cancel").addEventListener("click", () => recSend({ type: "TAP_CANCEL" }));
  $("btn-done").addEventListener("click", () => recSend({ type: "TAP_DONE", at: Date.now() }));
  $("btn-done-submit").addEventListener("click", () => recSend({ type: "TAP_DONE_SUBMIT", at: Date.now() }));
  $("btn-rerecord").addEventListener("click", () => { recSend({ type: "TAP_RERECORD" }); });
  $("btn-submit-text").addEventListener("click", () => recSend({ type: "TAP_SUBMIT" }));
  $("transcript").addEventListener("input", () => recSend({ type: "EDIT_TRANSCRIPT", text: $("transcript").value }));
  $("pre-perm-ok").addEventListener("click", async () => {
    recSend({ type: "PRE_PERMISSION_CONFIRM" });
    // 真正发起系统授权
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      recSend({ type: "PERMISSION_RESULT", granted: true });
    } catch (e) {
      recSend({ type: "PERMISSION_RESULT", granted: false });
    }
  });
  $("pre-perm-cancel").addEventListener("click", () => recSend({ type: "PRE_PERMISSION_CANCEL" }));

  $("btn-reveal").addEventListener("click", () => {
    $("subtext-body").classList.remove("hidden");
    $("btn-reveal").classList.add("hidden");
  });
  $("btn-retry").addEventListener("click", () => {
    $("result").classList.add("hidden");
    $("answer").value = "";
    showOnly(null);
    round = 1; answers = []; askedPoints = []; roundNotes = [];
    voiceTakes = [];
    peerLines = [cur.trigger_line];
    phase = "typing";
    setChar(cur.start_expression || "calm");
    recSend({ type: "RESET" });
    typewrite(cur.trigger_line, () => {
      phase = "answering";
      recSend({ type: "LINE_SHOWN", at: Date.now() });
      showIdleArea();
      startTimer(cur.time_limit_s);
      watchIdle();
    });
  });
  $("btn-next").addEventListener("click", () => openScene((curIdx + 1) % scenes.length));
  $("cfg-close").addEventListener("click", () => $("settings").classList.add("hidden"));
  $("cfg-save").addEventListener("click", saveCfg);
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

/* ---------- 语音文件工具 ---------- */
/* Float32 采样 → 16kHz 16bit 单声道 WAV */
function encodeWav16k(chunks, srcRate) {
  let len = 0; chunks.forEach((c) => (len += c.length));
  const all = new Float32Array(len);
  let off = 0; chunks.forEach((c) => { all.set(c, off); off += c.length; });
  const ratio = srcRate / 16000;
  const outLen = Math.max(1, Math.floor(len / ratio));
  const buf = new ArrayBuffer(44 + outLen * 2);
  const v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + outLen * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, "data"); v.setUint32(40, outLen * 2, true);
  const pcm = new Int16Array(buf, 44);
  for (let i = 0; i < outLen; i++) {
    const s = all[Math.floor(i * ratio)];
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
  }
  return new Uint8Array(buf);
}

function b64encode(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/* 嘴替语音输入（系统语音识别，与对练录音分开） */
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

/* ---------- 嘴替 / 一键三方案 ---------- */
async function mpGo() {
  const text = $("mp-input").value.trim();
  const extra = $("mp-extra").value.trim();
  const out = $("mp-out");
  const cfg = getCfg();
  const hasLlm = cfg && cfg.key;
  if (!text && !mpImg) { out.innerHTML = '<p class="empty-note">先把对方的原话粘进来，或上传聊天截图。</p>'; return; }
  if (!text && mpImg && !hasLlm) { out.innerHTML = '<p class="empty-note">演示模式读不了图——把图里对方那句话打在上面，或去「我的 → 大模型设置」配个能看图的模型。</p>'; return; }
  const btn = $("mp-go");
  btn.disabled = true; btn.textContent = "想…";
  if (hasLlm) {
    try {
      const r = await llmMouth(cfg, text, extra, mpImg);
      btn.disabled = false; btn.textContent = "给我三种回法";
      renderMp(r.scene, r.replies, false, r.imgFallback, r.tip, text);
      return;
    } catch (e) { console.warn("LLM 嘴替失败，降级场景匹配：", e); }
  }
  btn.disabled = false; btn.textContent = "给我三种回法";
  if (!text) { out.innerHTML = '<p class="empty-note">模型没能读懂这张图——把对方那句话打在上面再试。</p>'; return; }
  await ensureReveals();
  const s = demoMouth(text);
  if (s) {
    const full = Object.assign({}, s, reveals[s.id] || {});
    renderMp(full, full.strategies, true, false, `本幕目标：${full.goal}`, text);
  }
  else out.innerHTML = '<p class="empty-note">场景库里还没有这一类——配个大模型（我的 → 大模型设置）就能照你的原话定制三种回法；或者去今日页挑一幕相近的练。</p>';
}

/* 演示模式：用追问关键词 + 台词二字片段，把原话匹配到最像的一幕 */
const MP_STOP = new Set(["今天","明天","昨天","我们","你们","他们","这个","那个","什么","怎么","现在","已经","就是","还是","一下","没有","可以","因为","所以","但是","如果","哈哈","呵呵","天气","不错","好的","知道","觉得","应该","时候","东西","事情","这样","那样","一个","自己","大家","真的","中午","晚上","早上","吃饭","朋友","你好","谢谢","请问","干嘛","为啥","有点","非常","特别","可能","大概","怎么办"]);
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
${extra ? `【用户补充背景】${extra}\n` : ""}要求：三种策略依次为稳妥、推进、守边界；reply ≤80字、口语、能直接照发；risk ≤20字写清代价；tip 是给用户的一句关键提醒 ≤40字。
再从场景库里挑最像的一幕（都不像就空字符串）：${lib}
只输出 JSON：{"replies":[{"type":"稳妥","reply":"...","risk":"..."},{"type":"推进","reply":"...","risk":"..."},{"type":"守边界","reply":"...","risk":"..."}],"scene":"S14","tip":"..."}`;
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
    return { scene: scenes.find((x) => x.id === String(p.scene || "")) || null, replies, tip: String(p.tip || "") };
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

/* 7.5 嘴替结果 */
function renderMp(scene, replies, demo, imgFallback, tip, origText) {
  const out = $("mp-out");
  const who = $("mp-who").value, goal = $("mp-goal").value;
  const cards = replies.map((r, i) => `
    <div class="mp-reply">
      <div class="rp-head">
        <span class="rp-type">${r.type}</span>
        <button class="rp-copy" data-i="${i}">复制</button>
      </div>
      <div class="rp-text">${r.reply}</div>
      <div class="rp-fit"><b>适合</b>${r.risk || r.risk_note || "大多数情况"}</div>
    </div>`).join("");
  out.innerHTML =
    (origText ? `<div class="mp-orig"><span class="cap">你遇到的</span><div class="txt">${escapeHtml(origText)}</div></div>` : "")
    + `<div class="mp-chips">
        <button class="mp-chip" data-f="mp-who"><b>对方</b>${who} ✎</button>
        <button class="mp-chip" data-f="mp-goal"><b>目标</b>${goal} ✎</button>
      </div>`
    + `<div class="mp-sec">三版回复${demo ? "" : '<span class="ai-tag">AI 生成</span>'}</div>`
    + (scene ? `<p class="mp-match">这场面像「${scene.id} · ${scene.title}」${demo ? "（场景库匹配）" : ""}</p>` : "")
    + cards
    + (tip ? `<div class="mp-tip"><span class="cap">💡 关键提示</span><p>${escapeHtml(tip)}</p></div>` : "")
    + (imgFallback ? `<p class="empty-note">模型读不了截图，已只按文字信息定制。</p>` : "")
    + (demo ? `<p class="empty-note">演示匹配基于场景库关键词；配大模型可按原话定制。</p>` : `<p class="ai-note">以上内容由 AI 生成</p>`)
    + (scene ? `<button id="mp-practice">用你的嘴练一遍（${scene.time_limit_s} 秒）›</button>` : "");
  out.querySelectorAll(".rp-copy").forEach((b) =>
    b.addEventListener("click", () => copyText(replies[+b.dataset.i].reply, b)));
  out.querySelectorAll(".mp-chip").forEach((b) =>
    b.addEventListener("click", () => {
      $(b.dataset.f).focus();
      $("mouthpiece").scrollTo({ top: 0, behavior: "smooth" });
    }));
  if (scene) {
    const pb = $("mp-practice");
    if (pb) pb.addEventListener("click", () => {
      const i = scenes.findIndex((x) => x.id === scene.id);
      if (i >= 0) openScene(i);
    });
  }
}

/* 截图上传：压缩到最长边 1024 的 JPEG，供多模态模型读图 */
let mpImg = null;

/* ---------- 嘴替事件绑定（独立于 bindGlobal，元素始终在） ---------- */
$("mp-go").addEventListener("click", mpGo);
$("btn-mp-mic").addEventListener("click", () => {
  if (!recogMp) return;
  if (recogMpOn) { recogMp.stop(); recogMpOn = false; }
  else { try { recogMp.start(); recogMpOn = true; $("btn-mp-mic").classList.add("rec"); } catch {} }
});
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
