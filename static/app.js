/* Paper review workbench — front end. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const GLOBAL = "_global";
const STATUS = { open: "待处理", done: "已处理", wontfix: "不改" };
const QUICK = [
  ["找问题", "请审读本节（若有关注段落则聚焦该段），按严重程度列出写作、逻辑、论证、符号或与全文不一致的问题，每条给出修改建议。"],
  ["润色", "请润色关注段落的英文：保持含义、符号与引用不变，给出可直接替换的版本，并用一两句说明主要改动。"],
  ["精简", "在不丢失信息的前提下压缩关注的段落，给出可直接替换的英文版本，并说明删去了什么。"],
  ["审稿人视角", "以本领域审稿人的视角，指出本节最可能被质疑的地方，以及如何在文中预先回应（只基于稿件已有内容，不编造结果）。"],
  ["一致性", "检查本节的符号、术语、公式编号和表述与全文其他部分是否一致，列出不一致之处及统一方案。"],
  ["中英对照", "检查关注段落（或本节）的中文翻译与英文原文是否一致，指出漏译、误译或含义偏差。"],
];

const S = {
  paper: null, state: null, cur: null,
  lang: localStorage.getItem("lang") || "side",
  tab: localStorage.getItem("tab") || "notes",
  filter: "open",
  anchor: null,            // {id, quote}
  composerKind: "human",
  stream: null,            // AbortController while streaming
  meta: { paper: 0, state: 0 },
};

/* ------------------------------------------------------------------ utils */
async function api(path, body) {
  const opt = body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg, ms = 2200) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms);
}
function tex(t, display) {
  try { return katex.renderToString(t, { displayMode: display, throwOnError: false, output: "html" }); }
  catch { return esc(t); }
}
/* Markdown + KaTeX. Math is cut out before markdown so '_' and '\' survive. */
function md(src, untrusted = false) {
  if (!src) return "";

  const math = [];
  const hold = (t, d) => { math.push([t, d]); return d ? `\n\nMATHX${math.length - 1}X\n\n` : `MATHX${math.length - 1}X`; };
  let s = src;
  if (untrusted) s = s.replace(/</g, "&lt;");
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => hold(t, true));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => hold(t, true));
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => hold(t, false));
  s = s.replace(/\$([^$\n]+?)\$/g, (_, t) => hold(t, false));
  let html = marked.parse(s, { gfm: true, breaks: untrusted });
  html = html.replace(/MATHX(\d+)X/g, (_, i) => tex(math[+i][0], math[+i][1]));
  const root = document.createElement("div");
  root.innerHTML = DOMPurify.sanitize(html);
  root.querySelectorAll("img").forEach(img => {
    let path = img.getAttribute("src") || "";
    try { path = decodeURIComponent(path); } catch {}
    if (/^(https?:|data:|\/\/)/i.test(path)) {
      img.replaceWith(document.createTextNode("[请将原图保存到稿件目录：" + path + "]"));
      return;
    }
    if (/\.pdf$/i.test(path)) {
      const box = document.createElement("div"); box.innerHTML = originalFigure(path);
      img.replaceWith(box); return;
    }
    img.src = "/fig/" + encodeURIComponent(path);
    img.loading = "lazy";
    const link = document.createElement("a"); link.href = img.src; link.target = "_blank"; link.rel = "noopener";
    img.replaceWith(link); link.append(img);
  });
  return root.innerHTML;
}
const sec = key => S.paper.sections.find(s => s.key === key);
const notesOf = key => S.state.notes.filter(n => n.section === key);
const openCount = key => notesOf(key).filter(n => n.status === "open").length;
function secTitle(key) {
  if (key === GLOBAL) return "全局意见";
  const s = sec(key); return s ? s.title_en : `（已删除的小节 ${key}）`;
}
function navigable() { return S.paper.sections.filter(s => s.units.length); }

/* ------------------------------------------------------------------ load */
async function loadPaper() { S.paper = await api("/api/paper"); }
async function loadState() { S.state = await api("/api/state"); }

async function init() {
  initAppearance();
  marked.setOptions({ gfm: true });
  await Promise.all([loadPaper(), loadState()]);
  $("#paper-title").textContent = S.paper.title[0] || "论文审阅工作台";
  document.title = "审阅 · " + (S.paper.title[0] || "");
  $("#model-info").textContent = S.state.has_key ? `模型 ${S.state.model}` : "⚠ 未配置 API key";
  const meta = await api("/api/meta"); S.meta = meta;
  bindStatic();
  const key = decodeURIComponent(location.hash.slice(1));
  go(key && (key === GLOBAL || sec(key)) ? key : navigable()[0]?.key || GLOBAL, false);
  setInterval(poll, 4000);
  if (!localStorage.getItem("helped")) { $("#help").hidden = false; localStorage.setItem("helped", "1"); }
}

async function poll() {
  let m; try { m = await api("/api/meta"); } catch { return; }
  if (m.paper !== S.meta.paper) {
    S.meta.paper = m.paper; await loadPaper();
    const y = $("#content").scrollTop; renderSection(); $("#content").scrollTop = y; renderToc();
    toast("稿件已更新，已重新载入");
  }
  if (m.state !== S.meta.state) {
    S.meta.state = m.state;
    if (S.stream) return;               // do not disturb a running reply
    await loadState(); refreshNotes(); renderChat(); renderToc(); markUnits();
  }
}

/* ------------------------------------------------------------------ toc */
function renderToc() {
  const out = [];
  const gc = openCount(GLOBAL);
  out.push(`<div class="toc-item ${S.cur === GLOBAL ? "on" : ""}" data-key="${GLOBAL}">
    <span class="t">🌐 全局意见与总览</span>${gc ? `<span class="badge">${gc}</span>` : ""}</div>`);
  for (const s of S.paper.sections) {
    const cls = s.level === 1 ? "l1" : s.level === 3 ? "l3" : "l2";
    const nav = s.units.length > 0;
    const oc = openCount(s.key);
    const chat = (S.state.threads[s.key] || []).length;
    out.push(`<div class="toc-item ${cls} ${nav ? "" : "group"} ${S.cur === s.key ? "on" : ""}" ${nav ? `data-key="${esc(s.key)}"` : ""}
      title="${esc(s.title_en + (s.title_zh ? " / " + s.title_zh : ""))}">
      <span class="t">${esc(s.title_en)}</span>
      ${S.state.reviewed[s.key] ? '<span class="check">✓</span>' : ""}
      ${chat ? `<span class="badge chat" title="讨论消息数">${chat}</span>` : ""}
      ${oc ? `<span class="badge" title="待处理批注">${oc}</span>` : ""}</div>`);
  }
  $("#toc").innerHTML = out.join("");
  const nav = navigable();
  const done = nav.filter(s => S.state.reviewed[s.key]).length;
  const open = S.state.notes.filter(n => n.status === "open").length;
  $("#progress").textContent = `已审 ${done}/${nav.length} 节 · 待处理意见 ${open}`;
  $("#cnt-all").textContent = open || "";
  const on = $("#toc .on"); if (on) on.scrollIntoView({ block: "nearest" });
}

/* ------------------------------------------------------------------ section */
function go(key, scroll = true) {
  if (S.stream) { toast("AI 正在回复，请稍候或先停止"); return; }
  S.cur = key; S.anchor = null; $("#sel-pop").hidden = true;
  history.replaceState(null, "", "#" + encodeURIComponent(key));
  renderToc(); renderSection(); renderAnchor(); refreshNotes(); renderChat();
  if (scroll) $("#content").scrollTop = 0;
}

function unitHtml(u) {
  const side = (k) => u[k] ? `<div class="${k}">${md(u[k])}</div>` :
    `<div class="${k} missing">${k === "zh" ? "（无中文对照）" : "（仅中文）"}</div>`;
  let body;
  const figs = (u.figs || []).map(originalFigure).join("");
  if (u.shared) body = `<div class="shared">${figs ? `<div class="figs">${figs}</div>` : ""}${md(u.shared)}</div>`;
  else if (S.lang === "en") body = u.en ? side("en") : side("zh");
  else if (S.lang === "zh") body = u.zh ? side("zh") : side("en");
  else body = side("en") + side("zh");
  if (figs && !u.shared) body += `<div class="shared figs">${figs}</div>`;
  const n = S.state.notes.filter(x => x.section === S.cur && matchesAnchor(u, x.anchor) && x.status === "open").length;
  return `<div class="unit" data-id="${esc(u.id)}">
    <div class="gutter"><button data-act="note" title="批注此段">✎</button><button data-act="ask" title="就此段问 AI">💬</button></div>
    <div class="ulabel">${esc(u.label)}${n ? `<span class="badge" data-act="show">${n}</span>` : ""}</div>
    ${body}</div>`;
}

function renderSection() {
  const c = $("#content");
  c.className = "content-" + S.lang;
  if (S.cur === GLOBAL) return renderOverview();
  const s = sec(S.cur);
  if (!s) { c.innerHTML = `<div class="empty">该小节已不存在（稿件可能已改名）。</div>`; return; }
  const nav = navigable(); const i = nav.findIndex(x => x.key === s.key);
  const prev = nav[i - 1], next = nav[i + 1];
  const rv = S.state.reviewed[s.key];
  c.innerHTML = `
    <div class="sec-head"><h1>${esc(s.title_en)}<span class="zh">${esc(s.title_zh)}</span></h1>
      <div class="sec-tools">
        <button class="btn" id="sec-note" title="写一条针对整节的意见">✎ 整节批注</button>
        <button class="btn ${rv ? "reviewed" : ""}" id="sec-reviewed">${rv ? "✓ 本节已审" : "标记本节已审"}</button>
      </div></div>
    ${(S.paper.warnings || []).filter(w => s.units.some(u => w.startsWith(u.id + ":"))).length ? '<p class="pair-warning">部分段落缺少对照，请检查原稿编号；旧编号可在配置 paragraph_aliases 中映射。</p>' : ''}
    <div class="units">${s.units.map(unitHtml).join("")}</div>
    <div class="sec-nav">
      ${prev ? `<button class="btn" data-go="${esc(prev.key)}">← ${esc(prev.title_en)}</button>` : "<span></span>"}
      ${next ? `<button class="btn" data-go="${esc(next.key)}">${esc(next.title_en)} →</button>` : "<span></span>"}
    </div>`;
  markUnits();
}

function renderOverview() {
  const rows = navigable().map(s => {
    const all = notesOf(s.key), open = all.filter(n => n.status === "open").length;
    return `<tr data-go="${esc(s.key)}"><td>${esc(s.title_en)}</td><td>${esc(s.title_zh)}</td>
      <td>${S.state.reviewed[s.key] ? "✓" : ""}</td><td>${open || ""}</td><td>${all.length - open || ""}</td>
      <td>${(S.state.threads[s.key] || []).length || ""}</td></tr>`;
  }).join("");
  $("#content").innerHTML = `
    <div class="sec-head"><h1>全局意见与总览<span class="zh">对全文层面的意见（结构、故事线、术语统一等）写在右侧；这里的 AI 讨论总是附带全文。</span></h1></div>
    <div class="units"><div class="unit" style="display:block">
      <table class="overview"><thead><tr><th>小节</th><th></th><th>已审</th><th>待处理</th><th>已处理/不改</th><th>讨论</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
}

function markUnits() {
  $$(".unit[data-id]").forEach(el => {
    const id = el.dataset.id;
    el.classList.toggle("has-notes", S.state.notes.some(n => n.section === S.cur && n.anchor === id && n.status === "open"));
    el.classList.toggle("anchored", !!S.anchor && S.anchor.id === id);
  });
}

function flashUnit(id) {
  id = sec(S.cur)?.units.find(u => matchesAnchor(u, id))?.id || id;
  const el = $(`.unit[data-id="${CSS.escape(id)}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  return true;
}

/* ------------------------------------------------------------------ anchor */
function setAnchor(id, quote = "") {
  S.anchor = id ? { id, quote: quote.trim().slice(0, 800) } : null;
  renderAnchor(); markUnits();
}
function renderAnchor() {
  const a = S.anchor;
  $("#anchor-bar").innerHTML = a
    ? `关注：<span class="chip link" data-act="jump">${esc(a.id)}<button data-act="clear" title="取消">×</button></span>
       ${a.quote ? `<span class="chip q" title="${esc(a.quote)}">“${esc(a.quote)}”</span>` : ""}`
    : `<span>关注：整节（${esc(secTitle(S.cur))}）</span>`;
}

/* ------------------------------------------------------------------ notes */
function noteCard(n, withSection = false) {
  const s = n.section === GLOBAL ? null : sec(n.section);
  const stale = n.anchor && s && !s.units.some(u => matchesAnchor(u, n.anchor));
  return `<div class="note ${n.status}" data-id="${n.id}">
    <div class="note-head">
      <span class="id">${n.id}</span>
      ${withSection ? `<span class="chip link" data-act="goto">${esc(secTitle(n.section))}</span>` : ""}
      ${n.anchor ? `<span class="chip link ${stale ? "stale" : ""}" data-act="goto" title="${stale ? "该段落编号在当前稿件中已不存在" : "定位"}">${esc(n.anchor)}${stale ? " ⚠" : ""}</span>` : ""}
      ${n.kind === "ai" ? '<span class="tag-ai">AI</span>' : ""}
      <select data-act="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === n.status ? "selected" : ""}>${v}</option>`).join("")}</select>
      <span class="acts"><button class="btn small" data-act="edit">编辑</button><button class="btn small danger" data-act="del">删除</button></span>
    </div>
    ${n.quote ? `<div class="note-quote">“${esc(n.quote)}”</div>` : ""}
    <div class="note-body">${md(n.text, true)}</div>
    ${n.resolution ? `<div class="note-res">处理说明：${esc(n.resolution)}</div>` : ""}
    <div class="note-time hint">${esc(n.created)}${n.updated !== n.created ? " · 更新 " + esc(n.updated) : ""}</div>
  </div>`;
}

function refreshNotes() {
  const list = notesOf(S.cur).sort((a, b) => (a.status !== "open") - (b.status !== "open") || +a.id.slice(1) - +b.id.slice(1));
  $("#notes-list").innerHTML = list.length ? list.map(n => noteCard(n)).join("")
    : `<div class="empty">本节还没有批注</div>`;
  const oc = openCount(S.cur);
  $("#cnt-notes").textContent = list.length ? `${oc}/${list.length}` : "";
  renderAll();
}

function renderAll() {
  const order = [GLOBAL, ...S.paper.sections.map(s => s.key)];
  const pick = S.state.notes.filter(n => S.filter === "all" || n.status === S.filter);
  const groups = {};
  pick.forEach(n => (groups[n.section] = groups[n.section] || []).push(n));
  const keys = Object.keys(groups).sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
  });
  $$("#filter-seg button").forEach(b => b.classList.toggle("on", b.dataset.f === S.filter));
  $("#all-list").innerHTML = keys.length ? keys.map(k =>
    `<div class="group-title" data-go="${esc(k)}">${esc(secTitle(k))} (${groups[k].length})</div>` +
    groups[k].sort((a, b) => +a.id.slice(1) - +b.id.slice(1)).map(n => noteCard(n)).join("")).join("")
    : `<div class="empty">没有${S.filter === "all" ? "" : STATUS[S.filter]}的意见</div>`;
}

function setComposer(text, kind = "human") {
  S.composerKind = kind;
  $("#note-input").value = text;
  $("#composer-kind").innerHTML = kind === "ai"
    ? `<span>AI 生成的草稿：请确认或修改后保存</span><a href="#" data-act="reset-kind">改为人工批注</a>` : "";
}

async function saveNote() {
  const text = $("#note-input").value.trim();
  if (!text) return toast("意见不能为空");
  await api("/api/notes", { section: S.cur, anchor: S.anchor?.id || "", quote: S.anchor?.quote || "", text, kind: S.composerKind });
  setComposer("");
  await refreshAfterWrite(); toast("已保存");
}

async function refreshAfterWrite() {
  await loadState(); S.meta.state = (await api("/api/meta")).state;
  refreshNotes(); renderToc(); markUnits();
  $$(".unit[data-id]").forEach(el => {          // update badges without re-rendering math
    const id = el.dataset.id, lab = $(".ulabel", el);
    const n = S.state.notes.filter(x => x.section === S.cur && matchesAnchor(sec(S.cur)?.units.find(u => u.id === id), x.anchor) && x.status === "open").length;
    const u = sec(S.cur)?.units.find(x => x.id === id);
    if (lab && u) lab.innerHTML = esc(u.label) + (n ? `<span class="badge" data-act="show">${n}</span>` : "");
  });
}

async function noteAction(e) {
  const card = e.target.closest(".note"); if (!card) return;
  const id = card.dataset.id, n = S.state.notes.find(x => x.id === id);
  const act = e.target.dataset.act;
  if (act === "goto") {
    if (n.section !== S.cur) go(n.section);
    if (n.anchor) setTimeout(() => { flashUnit(n.anchor); setAnchor(n.anchor, n.quote); }, 60);
  } else if (act === "del") {
    if (!confirm(`删除 ${id}？`)) return;
    await api(`/api/notes/${id}`, { delete: true }); await refreshAfterWrite();
  } else if (act === "edit") {
    const body = $(".note-body", card);
    body.innerHTML = `<textarea rows="5">${esc(n.text)}</textarea>
      <div class="row"><span class="hint">Ctrl+Enter 保存</span><button class="btn small" data-act="cancel">取消</button><button class="btn small primary" data-act="save-edit">保存</button></div>`;
    const ta = $("textarea", body); ta.focus();
    ta.addEventListener("keydown", ev => { if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) $('[data-act="save-edit"]', card).click(); });
  } else if (act === "cancel") {
    refreshNotes();
  } else if (act === "save-edit") {
    await api(`/api/notes/${id}`, { text: $("textarea", card).value.trim() }); await refreshAfterWrite();
  }
}

/* ------------------------------------------------------------------ chat */
function splitThink(text) {
  const m = text.match(/^\s*<think>([\s\S]*?)(<\/think>|$)/);
  return m ? { think: m[1], body: text.slice(m[0].length) } : { think: "", body: text };
}

function msgHtml(m, i) {
  if (m.role === "user") {
    return `<div class="msg user"><div class="who">你 · ${esc(m.ts || "")}${m.focus ? ` <span class="chip">${esc(m.focus)}</span>` : ""}</div>
      <div class="bubble">${md(m.content, true)}</div></div>`;
  }
  const { think, body } = splitThink(m.content);
  const reasoning = (m.reasoning || "") + think;
  const status = m.live && !body.trim()
    ? `<div class="hint">${reasoning ? `思考中… 已 ${reasoning.length} 字（可展开上方「思考过程」查看）` : "等待模型响应…"}</div>` : "";
  return `<div class="msg assistant" data-i="${i}"><div class="who">AI · ${esc(m.ts || "")}</div>
    ${reasoning ? `<details ${m.live && S.thinkOpen ? "open" : ""}><summary>思考过程</summary><pre>${esc(reasoning)}</pre></details>` : ""}
    <div class="bubble ${m.live ? "typing" : ""}">${status}${md(body, true)}${m.error ? `<div class="err">${esc(m.error)}</div>` : ""}</div>
    ${m.live ? "" : `<div class="msg-acts"><button class="btn small" data-act="to-note">存为批注</button><button class="btn small" data-act="copy">复制</button></div>`}
  </div>`;
}

function chatThread() { return S.state.threads[S.cur] || []; }

function renderChat(live) {
  const msgs = chatThread().concat(live || []);
  $("#cnt-chat").textContent = chatThread().length || "";
  const box = $("#chat-msgs");
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML = msgs.length ? msgs.map(msgHtml).join("") :
    `<div class="empty">在这里和 AI 讨论「${esc(secTitle(S.cur))}」怎么改。<br>可先点段落旁的 💬 选定关注段落，或用下方快捷提问。</div>`;
  if (atBottom || live) box.scrollTop = box.scrollHeight;
  $("#chat-send").textContent = S.stream ? "停止" : "发送";
  $("#opt-full").disabled = S.cur === GLOBAL;
}

async function sendChat(text) {
  if (S.stream) { S.stream.abort(); return; }
  text = (text ?? $("#chat-input").value).trim();
  if (!text) return;
  if (!S.state.has_key) return toast("未配置 API key，无法对话");
  $("#chat-input").value = "";
  const focus = S.anchor ? S.anchor.id + (S.anchor.quote ? `：“${S.anchor.quote}”` : "") : "";
  const user = { role: "user", content: text, focus, ts: "刚刚" };
  const bot = { role: "assistant", content: "", reasoning: "", live: true, ts: "生成中" };
  S.stream = new AbortController();
  const extra = $$("#extra-opts input:checked").map(x => x.value);
  renderChat([user, bot]);
  let pending = false;
  const repaint = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; renderChat([user, bot]); }); } };
  try {
    const r = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: S.stream.signal,
      body: JSON.stringify({ section: S.cur, message: text, focus, full: $("#opt-full").checked || S.cur === GLOBAL, extra }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let k;
      while ((k = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, k); buf = buf.slice(k + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.t === "d") bot.content += ev.c;
        else if (ev.t === "r") bot.reasoning += ev.c;
        else if (ev.t === "e") bot.error = "出错：" + ev.c;
        repaint();
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") bot.error = "出错：" + err.message;
  }
  S.stream = null;
  await loadState(); S.meta.state = (await api("/api/meta")).state;
  if (bot.error) { bot.live = false; renderChat([bot]); } else renderChat();
  renderToc();
}

async function chatAction(e) {
  const act = e.target.dataset.act; if (!act) return;
  const el = e.target.closest(".msg"); const m = chatThread()[+el.dataset.i]; if (!m) return;
  const body = splitThink(m.content).body.trim();
  if (act === "copy") { await navigator.clipboard.writeText(body); toast("已复制"); }
  if (act === "to-note") {
    const sel = String(getSelection()).trim();
    const text = sel && el.contains(getSelection().anchorNode) ? sel : body;
    setComposer(text, "ai"); switchTab("notes"); $("#note-input").focus();
    toast(sel ? "已把选中的部分放入批注草稿" : "已放入批注草稿，确认后保存");
  }
}

async function summarize() {
  if (!chatThread().length) return toast("本节还没有讨论");
  const b = $("#chat-summarize"); b.disabled = true; b.textContent = "总结中…";
  try {
    const r = await api("/api/summarize", { section: S.cur });
    setAnchor(null); setComposer(r.text, "ai"); switchTab("notes"); $("#note-input").focus();
    toast("已生成批注草稿，请确认后保存", 3000);
  } catch (err) { toast("总结失败：" + err.message, 4000); }
  b.disabled = false; b.textContent = "总结为批注";
}

/* ------------------------------------------------------------------ static bindings */
function switchTab(t) {
  S.tab = t; localStorage.setItem("tab", t);
  $$(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  $$(".tab").forEach(x => x.classList.toggle("on", x.id === "tab-" + t));
  if (t === "chat") { const box = $("#chat-msgs"); box.scrollTop = box.scrollHeight; }
}
function setLang(l) {
  S.lang = l; localStorage.setItem("lang", l);
  $$("#lang-seg button").forEach(b => b.classList.toggle("on", b.dataset.lang === l));
  const y = $("#content").scrollTop; renderSection(); $("#content").scrollTop = y;
}

function bindStatic() {
  $$("#lang-seg button").forEach(b => b.onclick = () => setLang(b.dataset.lang));
  setLang(S.lang);
  $$(".tabs button").forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  switchTab(S.tab);
  $$("#filter-seg button").forEach(b => b.onclick = () => { S.filter = b.dataset.f; renderAll(); });
  $("#help-btn").onclick = () => { $("#help").hidden = false; };

  $("#toc").onclick = e => { const it = e.target.closest("[data-key]"); if (it) go(it.dataset.key); };
  addEventListener("hashchange", () => {
    const k = decodeURIComponent(location.hash.slice(1));
    if (k !== S.cur && (k === GLOBAL || sec(k))) go(k);
  });

  $("#content").addEventListener("click", async e => {
    const g = e.target.closest("[data-go]"); if (g) return go(g.dataset.go);
    if (e.target.id === "sec-reviewed") {
      await api("/api/reviewed", { section: S.cur, value: !S.state.reviewed[S.cur] });
      await refreshAfterWrite(); renderSection(); return;
    }
    if (e.target.id === "sec-note") { setAnchor(null); switchTab("notes"); $("#note-input").focus(); return; }
    const unit = e.target.closest(".unit[data-id]"); const act = e.target.dataset.act;
    if (!unit || !act) return;
    setAnchor(unit.dataset.id);
    if (act === "note") { switchTab("notes"); $("#note-input").focus(); }
    if (act === "ask") { switchTab("chat"); $("#chat-input").focus(); }
    if (act === "show") switchTab("notes");
  });

  $("#anchor-bar").onclick = e => {
    if (e.target.dataset.act === "clear") setAnchor(null);
    else if (e.target.closest('[data-act="jump"]') && S.anchor) flashUnit(S.anchor.id);
  };

  // selection popup
  const pop = $("#sel-pop");
  document.addEventListener("mouseup", e => {
    if (pop.contains(e.target)) return;
    setTimeout(() => {
      const sel = getSelection(), text = String(sel).trim();
      const unit = sel.rangeCount && sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement).closest?.("#content .unit[data-id]");
      if (!text || !unit) { pop.hidden = true; return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(innerWidth - 200, rect.left + rect.width / 2 - 80)) + "px";
      pop.style.top = (rect.bottom + 8 > innerHeight - 50 ? rect.top - 40 : rect.bottom + 8) + "px";
      pop.hidden = false; pop._unit = unit.dataset.id; pop._text = text;
    }, 10);
  });
  pop.onclick = e => {
    const act = e.target.dataset.act; if (!act) return;
    setAnchor(pop._unit, pop._text); pop.hidden = true; getSelection().removeAllRanges();
    if (act === "note") { switchTab("notes"); $("#note-input").focus(); }
    else { switchTab("chat"); $("#chat-input").focus(); }
  };
  $("#content").addEventListener("scroll", () => { pop.hidden = true; });

  // notes
  $("#note-save").onclick = saveNote;
  $("#note-input").addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNote(); } });
  $("#composer-kind").onclick = e => { if (e.target.dataset.act === "reset-kind") { e.preventDefault(); setComposer($("#note-input").value, "human"); } };
  for (const id of ["#notes-list", "#all-list"]) {
    $(id).addEventListener("click", e => {
      const g = e.target.closest(".group-title[data-go]"); if (g) return go(g.dataset.go);
      if (e.target.tagName !== "SELECT") noteAction(e);
    });
    $(id).addEventListener("change", async e => {
      if (e.target.dataset.act !== "status") return;
      const id2 = e.target.closest(".note").dataset.id;
      await api(`/api/notes/${id2}`, { status: e.target.value }); await refreshAfterWrite();
    });
  }

  // chat
  $("#quick").innerHTML = QUICK.map(([k, v]) => `<button title="${esc(v)}">${k}</button>`).join("");
  $("#quick").onclick = e => { const i = [...$("#quick").children].indexOf(e.target); if (i >= 0) sendChat(QUICK[i][1]); };
  $("#chat-send").onclick = () => sendChat();
  $("#chat-input").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
  });
  $("#chat-msgs").addEventListener("click", chatAction);
  $("#chat-summarize").onclick = summarize;
  $("#chat-clear").onclick = async () => {
    if (!chatThread().length) return;
    if (!confirm("归档本节当前对话并开始新对话？（记录仍保存在 data/review.json）")) return;
    await api("/api/thread/clear", { section: S.cur }); await refreshAfterWrite(); renderChat();
  };
  const full = $("#opt-full");
  $("#chat-msgs").addEventListener("toggle", e => {
    if (e.target.closest(".msg.assistant:last-child")) S.thinkOpen = e.target.open;
  }, true);
  full.checked = localStorage.getItem("full") !== "0";
  full.onchange = () => localStorage.setItem("full", full.checked ? "1" : "0");
  const saved = JSON.parse(localStorage.getItem("extra") || "[]");
  $("#extra-opts").innerHTML = (S.state.context_files || []).map(n =>
    `<label title="把「${esc(n)}」作为参考材料发给模型"><input type="checkbox" value="${esc(n)}" ${saved.includes(n) ? "checked" : ""}> 附带${esc(n)}</label>`).join(" ");
  $("#extra-opts").onchange = () => localStorage.setItem("extra", JSON.stringify($$("#extra-opts input:checked").map(x => x.value)));

  // keyboard
  document.addEventListener("keydown", e => {
    if (e.target.closest("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") { $("#help").hidden = true; setAnchor(null); return; }
    const nav = navigable(); const i = nav.findIndex(s => s.key === S.cur);
    if (e.key === "ArrowRight" && i < nav.length - 1) go(nav[i + 1].key);
    if (e.key === "ArrowLeft") { if (i > 0) go(nav[i - 1].key); else if (i === 0) go(GLOBAL); }
    if (e.key === "l" || e.key === "L") { const L = ["side", "stack", "en", "zh"]; setLang(L[(L.indexOf(S.lang) + 1) % L.length]); }
  });

  // splitter
  const sp = $("#splitter");
  const w = localStorage.getItem("panelW"); if (w) document.documentElement.style.setProperty("--panel-w", w);
  sp.onmousedown = e => {
    e.preventDefault(); sp.classList.add("drag");
    const move = ev => {
      const px = Math.min(Math.max(innerWidth - ev.clientX, 300), innerWidth * 0.6) + "px";
      document.documentElement.style.setProperty("--panel-w", px); localStorage.setItem("panelW", px);
    };
    const up = () => { sp.classList.remove("drag"); removeEventListener("mousemove", move); removeEventListener("mouseup", up); };
    addEventListener("mousemove", move); addEventListener("mouseup", up);
  };
}

init().catch(err => { document.body.innerHTML = `<pre style="padding:20px;color:#c0392b">载入失败：${esc(err.message)}</pre>`; });

function matchesAnchor(unit, anchor) {
  return !!unit && (unit.id === anchor || (unit.aliases || []).includes(anchor));
}
function originalFigure(path) {
  const url = "/fig/" + encodeURIComponent(path) + "?v=" + S.meta.paper;
  const link = `<a href="${url}" target="_blank" rel="noopener">打开原图 / Original · ${esc(path)}</a>`;
  return /\.pdf$/i.test(path)
    ? `<div class="original-figure"><object data="${url}" type="application/pdf" aria-label="${esc(path)}">${link}</object>${link}</div>`
    : `<a href="${url}" target="_blank" rel="noopener"><img loading="lazy" src="${url}" alt="${esc(path)}"></a>`;
}
function initAppearance() {
  const defaults = {size: 17, font: "serif", theme: "paper", background: ""};
  let prefs;
  try { prefs = {...defaults, ...JSON.parse(localStorage.getItem("paperbridge.appearance") || "{}")}; }
  catch { prefs = {...defaults}; }
  const fonts = {
    serif: 'Georgia, "Noto Serif CJK SC", "Songti SC", SimSun, serif',
    sans: 'system-ui, "Microsoft YaHei", sans-serif',
    mono: 'ui-monospace, "Noto Sans Mono CJK SC", monospace'
  };
  function apply() {
    prefs.size = Math.max(12, Math.min(30, Number(prefs.size) || 17));
    if (!fonts[prefs.font]) prefs.font = "serif";
    if (!["paper", "light", "sepia", "forest", "dark"].includes(prefs.theme)) prefs.theme = "paper";
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.style.setProperty("--reading-size", prefs.size + "px");
    document.documentElement.style.setProperty("--reading-font", fonts[prefs.font]);
    document.documentElement.style.removeProperty("--bg");
    if (/^#[0-9a-f]{6}$/i.test(prefs.background)) document.documentElement.style.setProperty("--bg", prefs.background);
    $("#reading-size").value = prefs.size; $("#size-value").textContent = prefs.size + "px";
    $("#reading-font").value = prefs.font; $("#reading-theme").value = prefs.theme;
    $("#reading-background").value = prefs.background || ({paper:'#f5f4ef',light:'#eef1f5',sepia:'#eee2cb',forest:'#e6eee7',dark:'#151a21'}[prefs.theme]);
    localStorage.setItem("paperbridge.appearance", JSON.stringify(prefs));
  }
  for (const [id, key] of [["reading-size", "size"], ["reading-font", "font"], ["reading-theme", "theme"], ["reading-background", "background"]]) {
    $("#" + id).addEventListener("input", e => { prefs[key] = e.target.value; if (key === "theme") prefs.background = ""; apply(); });
  }
  $("#appearance-reset").onclick = () => { prefs = {...defaults}; apply(); };
  apply();
}
