// 就活アプリの追加機能: ES・会社ごとの記録・これからの予定
// index.html の本体スクリプトのあとに読み込む(entries / sb / escapeHtml / openModal などを使う)。
// データは Supabase の shukatsu_es_answers / shukatsu_log / shukatsu_queue / shukatsu_episodes。
// どれも anon からは閉じていて、合言葉つきの関数 shukatsu_api だけが入口(合言葉は じぶんノート と共通)。

const PLUS_KEY_STORE = "shukatsu:key";
const PLUS_CACHE = "shukatsu:plusCache";
const PLUS_ES_STATUSES = ["下書き", "書いてもらい中", "入力済み(未提出)", "提出済", "素材(設問ごと未分割)"];
const PLUS_LOG_KINDS = ["締切", "予定", "連絡", "提出控え", "メモ"];
const PLUS_LOG_ICON = { "締切": "⏰", "予定": "📅", "連絡": "✉️", "提出控え": "📨", "メモ": "🗒" };

let plus = { es: [], log: [], queue: [], episodes: [], notes: [] };
let plusReady = false, plusLoading = false, plusError = "";
let plusEsFilter = "", plusEsSearch = "", plusEsView = "es";   // es | material
let plusEditingEs = null;

const plusStore = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
(function plusTakeKeyFromHash() {
  const m = location.hash.match(/k=([^&]+)/);
  if (m) {
    plusStore.set(PLUS_KEY_STORE, decodeURIComponent(m[1]));
    history.replaceState(null, "", location.pathname + location.search);
  }
})();
// 同じ github.io のじぶんノートで合言葉を入れていれば、それも使う
function plusKey() { return plusStore.get(PLUS_KEY_STORE) || plusStore.get("jibun-note:key") || ""; }

async function plusApi(action, args) {
  const key = plusKey();
  if (!key) throw new Error("no key");
  const { data, error } = await sb.rpc("shukatsu_api", { p_key: key, p_action: action, p_args: args || {} });
  if (error) throw new Error(/bad key/.test(error.message || "") ? "bad key" : (error.message || "error"));
  return data;
}

(function plusLoadCache() {
  try {
    const c = JSON.parse(plusStore.get(PLUS_CACHE) || "null");
    if (c && Array.isArray(c.es)) { plus = c; plusReady = true; }
  } catch {}
})();

async function plusLoad(quiet) {
  if (!sb || plusLoading) return;
  if (!plusKey()) { plusError = "nokey"; plusRerender(); return; }
  plusLoading = true;
  try {
    const d = await plusApi("load");
    plus = { es: d.es || [], log: d.log || [], queue: d.queue || [], episodes: d.episodes || [], notes: d.notes || [] };
    plusReady = true; plusError = "";
    // 0件のときは控えを上書きしない
    if (plus.es.length || plus.log.length) plusStore.set(PLUS_CACHE, JSON.stringify(plus));
  } catch (e) {
    plusError = e.message === "bad key" || e.message === "no key" ? "nokey" : "offline";
    if (!quiet) console.warn("plus load", e);
  } finally {
    plusLoading = false;
    plusRerender();
  }
}

function plusRerender() {
  try { renderAll(); } catch {}
  if (document.getElementById("modal").classList.contains("open") && editingId) plusRenderModalSection(editingId);
}

// ---------- 会社との対応 ----------
function plusNorm(name) { return normalizeCompanyName(name || "").replace(/\s/g, ""); }
function plusMatch(item, e) {
  if (item.entry_id) return item.entry_id === e.id;
  const a = plusNorm(item.company), b = plusNorm(e.company);
  return !!a && !!b && (a === b || (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))));
}
function plusFor(e) {
  return {
    es: plus.es.filter(x => plusMatch(x, e)),
    log: plus.log.filter(x => plusMatch(x, e)),
    queue: plus.queue.filter(x => plusMatch(x, e) && !["完了", "取り消し"].includes(x.status)),
  };
}
function plusEntryForCompany(company) {
  const n = plusNorm(company);
  if (!n) return null;
  return entries.find(e => plusNorm(e.company) === n) || entries.find(e => plusMatch({ company }, e)) || null;
}

// ---------- 日付 ----------
function plusJst(iso) {
  // timestamptz -> { date: "YYYY-MM-DD", time: "HH:MM" | "" } (日本時間)。00:00 は日付のみ扱い
  if (!iso) return null;
  const d = new Date(new Date(iso).getTime() + 9 * 3600000);
  const date = d.toISOString().slice(0, 10), time = d.toISOString().slice(11, 16);
  return { date, time: time === "00:00" ? "" : time };
}
function plusToIso(date, time) {
  if (!date) return "";
  return `${date}T${time || "00:00"}:00+09:00`;
}
function plusDueText(iso) {
  const j = plusJst(iso);
  if (!j) return "";
  const [y, m, d] = j.date.split("-").map(Number);
  const wd = "日月火水木金土"[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${wd})${j.time ? " " + j.time : ""}`;
}
function plusChip(iso) {
  const j = plusJst(iso);
  return j ? deadlineChip(j.date, j.time) : null;
}
function plusOpenLogs(list) {
  return list.filter(l => !l.done && l.due_at && (l.kind === "締切" || l.kind === "予定"))
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
}
// 締切が近い順の並べ替えで使う(index.html の effectiveDeadline から呼ぶ)
function plusNextDueMs(e) {
  if (!plusReady) return null;
  const now = Date.now() - 86400000;
  const l = plusOpenLogs(plus.log.filter(x => plusMatch(x, e))).find(x => new Date(x.due_at).getTime() >= now);
  return l ? new Date(plusJst(l.due_at).date).getTime() : null;
}

function plusCount(text) { return Array.from(String(text || "").replace(/\r\n/g, "\n")).length; }
function plusCountHtml(text, limit) {
  const n = plusCount(text);
  if (!limit) return `<span class="plus-count">${n}字</span>`;
  const cls = n > limit ? "over" : (n >= limit * 0.9 ? "ok" : "short");
  return `<span class="plus-count ${cls}">${n}/${limit}字</span>`;
}

// ---------- カードに出す1行 ----------
function plusCardHtml(e) {
  if (!plusReady) return "";
  const f = plusFor(e);
  const next = plusOpenLogs(f.log)[0];
  const parts = [];
  if (next) {
    const chip = plusChip(next.due_at);
    parts.push(`<span class="plus-next">${PLUS_LOG_ICON[next.kind]} ${escapeHtml(plusDueText(next.due_at))} ${escapeHtml(next.title)}${chip ? ` <span class="days-left ${chip.cls}">${escapeHtml(chip.text)}</span>` : ""}</span>`);
  }
  const badges = [];
  if (f.es.length) {
    const sent = f.es.filter(x => x.status === "提出済").length;
    badges.push(`<span class="plus-badge">✍️ ES ${f.es.length}${sent ? `(提出${sent})` : ""}</span>`);
  }
  if (f.log.length) badges.push(`<span class="plus-badge">🗒 記録 ${f.log.length}</span>`);
  if (f.queue.length) badges.push(`<span class="plus-badge wait">⏳ Claude待ち</span>`);
  if (!parts.length && !badges.length) return "";
  return `<div class="plus-card-row" data-plus-open="${e.id}">${parts.join("")}${badges.join("")}</div>`;
}

// ---------- これから(選考管理タブの上) ----------
function plusRenderUpcoming() {
  const el = document.getElementById("plusUpcoming");
  if (!el) return;
  if (currentTab !== "main") { el.innerHTML = ""; return; }
  if (!plusReady) { el.innerHTML = plusError === "nokey" ? plusKeyBannerHtml() : ""; return; }
  const limit = Date.now() + 14 * 86400000;
  const items = plusOpenLogs(plus.log).filter(l => new Date(l.due_at).getTime() <= limit);
  const waiting = plus.queue.filter(q => q.status === "待ち").length;
  if (!items.length && !waiting) { el.innerHTML = ""; return; }
  const expanded = el.dataset.expanded === "1";
  const shown = expanded ? items : items.slice(0, 5);
  el.innerHTML = `
    <div class="plus-panel">
      <div class="plus-panel-head">これから2週間<span>${items.length}件</span></div>
      ${shown.map(l => {
        const chip = plusChip(l.due_at);
        const e = entries.find(x => plusMatch(l, x));
        return `<div class="plus-up-row">
          <button class="plus-check" data-plus-done="${l.id}" title="済みにする">✓</button>
          <div class="plus-up-main" ${e ? `data-plus-open="${e.id}"` : ""}>
            <div><b>${escapeHtml(plusDueText(l.due_at))}</b> ${chip ? `<span class="days-left ${chip.cls}">${escapeHtml(chip.text)}</span>` : ""}</div>
            <div class="plus-up-title">${PLUS_LOG_ICON[l.kind]} ${escapeHtml(l.company)}　${escapeHtml(l.title)}</div>
          </div>
        </div>`;
      }).join("")}
      ${items.length > 5 ? `<button class="plus-more" data-plus-more>${expanded ? "たたむ" : `ほか${items.length - 5}件を見る`}</button>` : ""}
      ${waiting ? `<div class="plus-wait-line">⏳ Claudeの待ち ${waiting}件(ESの下書き・登録)</div>` : ""}
    </div>`;
}

function plusKeyBannerHtml() {
  return `<div class="plus-panel plus-keybox">
    <div class="plus-panel-head">ES・記録を見るには合言葉が必要です</div>
    <div class="plus-muted">じぶんノートと同じ合言葉です。</div>
    <div style="display:flex;gap:6px;margin-top:8px;">
      <input type="password" id="plusKeyInput" placeholder="合言葉" style="flex:1;" autocomplete="off">
      <button id="plusKeySave">開く</button>
    </div>
  </div>`;
}

// ---------- 編集画面の「記録とES」 ----------
function plusRenderModalSection(entryId) {
  const box = document.getElementById("plusSection");
  if (!box) return;
  const e = entries.find(x => x.id === entryId);
  if (!e) { box.innerHTML = ""; box.style.display = "none"; return; }
  box.style.display = "";
  if (!plusReady) {
    box.innerHTML = plusError === "nokey" ? plusKeyBannerHtml() : `<div class="plus-muted">読み込み中…</div>`;
    return;
  }
  const f = plusFor(e);
  const logs = f.log.slice().sort((a, b) => new Date(b.due_at || b.created_at) - new Date(a.due_at || a.created_at));
  box.innerHTML = `
    <div class="plus-sec-head">記録<span class="plus-muted">Claudeに貼ったメール・提出した内容など</span></div>
    ${logs.length ? logs.map(plusLogItemHtml).join("") : `<div class="plus-muted">まだありません。メールのスクショをClaudeに貼ると、ここに締切や内容が残ります。</div>`}
    <details class="plus-add-log">
      <summary>＋ 記録を追加</summary>
      <div class="plus-log-form">
        <div style="display:flex;gap:6px;">
          <select id="plusLogKind">${PLUS_LOG_KINDS.map(k => `<option>${k}</option>`).join("")}</select>
          <input type="text" id="plusLogTitle" placeholder="例: ES締切、一次面接、Webテスト受験" style="flex:1;">
        </div>
        <div style="display:flex;gap:6px;margin-top:6px;">
          <input type="date" id="plusLogDate" style="flex:1.4;">
          <input type="time" id="plusLogTime" style="flex:1;">
        </div>
        <textarea id="plusLogBody" placeholder="内容(任意)" style="margin-top:6px;min-height:54px;"></textarea>
        <button type="button" id="plusLogAdd" style="margin-top:6px;">記録する</button>
      </div>
    </details>
    <div class="plus-sec-head" style="margin-top:14px;">ES<span class="plus-muted">${f.es.length}件</span></div>
    ${f.es.map(plusEsMiniHtml).join("") || `<div class="plus-muted">まだありません。</div>`}
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
      <button type="button" class="secondary icon" data-plus-es-new="${e.id}">＋ ESの設問を追加</button>
      ${f.es.some(x => !x.answer) ? `<button type="button" class="secondary icon" data-plus-ask="${e.id}">🤖 空の設問をClaudeに書いてもらう</button>` : ""}
    </div>
    ${f.queue.length ? `<div class="plus-wait-line">⏳ ${f.queue.map(q => `${escapeHtml(q.kind)}:${escapeHtml(q.status)}${q.note ? `(${escapeHtml(q.note)})` : ""}`).join(" / ")}</div>` : ""}
  `;
}
function plusLogItemHtml(l) {
  const chip = !l.done && l.due_at && (l.kind === "締切" || l.kind === "予定") ? plusChip(l.due_at) : null;
  const created = plusJst(l.created_at);
  return `<div class="plus-log ${l.done ? "done" : ""}">
    <div class="plus-log-top">
      <span class="plus-kind k-${escapeHtml(l.kind)}">${PLUS_LOG_ICON[l.kind] || ""} ${escapeHtml(l.kind)}</span>
      ${l.due_at ? `<b>${escapeHtml(plusDueText(l.due_at))}</b>` : ""}
      ${chip ? `<span class="days-left ${chip.cls}">${escapeHtml(chip.text)}</span>` : ""}
      <span class="plus-log-acts">
        ${l.kind === "締切" || l.kind === "予定" ? `<label class="plus-done"><input type="checkbox" data-plus-toggle="${l.id}" ${l.done ? "checked" : ""}>済み</label>` : ""}
        <button type="button" class="plus-x" data-plus-dellog="${l.id}" title="消す">×</button>
      </span>
    </div>
    <div class="plus-log-title">${escapeHtml(l.title)}</div>
    ${l.body ? `<div class="plus-log-body">${escapeHtml(l.body)}</div>` : ""}
    <div class="plus-log-meta">${created ? created.date.slice(5).replace("-", "/") : ""} ${l.source ? "・" + escapeHtml(l.source) : ""}</div>
  </div>`;
}
function plusEsMiniHtml(a) {
  return `<div class="plus-es-mini" data-plus-es="${a.id}">
    <div class="plus-es-q">${escapeHtml(a.question || "(設問なし)")}</div>
    <div class="plus-es-meta"><span class="plus-st st-${escapeHtml(a.status || "")}">${escapeHtml(a.status || "")}</span> ${a.answer ? plusCountHtml(a.answer, a.char_limit) : ""}
      ${a.deadline ? `締切 ${escapeHtml(plusDueText(a.deadline))}` : ""}</div>
  </div>`;
}

// ---------- ESタブ ----------
function plusRenderEsTab() {
  const v = document.getElementById("esView");
  if (!v) return;
  if (!plusReady) {
    v.innerHTML = plusError === "nokey" ? plusKeyBannerHtml() : `<div class="plus-muted" style="padding:20px;text-align:center;">読み込み中…</div>`;
    return;
  }
  const head = `
    <div class="plus-seg">
      <button class="${plusEsView === "es" ? "on" : ""}" data-plus-view="es">ES ${plus.es.length}</button>
      <button class="${plusEsView === "material" ? "on" : ""}" data-plus-view="material">材料(エピソード) ${plus.episodes.length}</button>
    </div>`;
  if (plusEsView === "material") { v.innerHTML = head + plusMaterialHtml(); return; }
  const q = plusEsSearch.trim();
  let items = plus.es.slice();
  if (plusEsFilter) items = items.filter(a => a.status === plusEsFilter);
  if (q) items = items.filter(a => companyMatches(a.company, q) || (a.question || "").includes(q) || (a.answer || "").includes(q));
  const counts = Object.fromEntries(PLUS_ES_STATUSES.map(s => [s, plus.es.filter(a => a.status === s).length]));
  const waiting = plus.queue.filter(x => x.kind === "ES" && x.status === "待ち");
  v.innerHTML = head + `
    <div class="filters" style="margin-top:8px;">
      <input type="text" id="plusEsSearch" class="search" placeholder="会社名・設問・本文で探す" value="${escapeHtml(plusEsSearch)}">
    </div>
    <div class="plus-chips">
      <button class="${plusEsFilter ? "" : "on"}" data-plus-filter="">すべて</button>
      ${PLUS_ES_STATUSES.filter(s => counts[s]).map(s => `<button class="${plusEsFilter === s ? "on" : ""}" data-plus-filter="${s}">${s.replace("(設問ごと未分割)", "")} ${counts[s]}</button>`).join("")}
    </div>
    ${waiting.length ? `<div class="plus-wait-line">⏳ Claudeが書く待ち: ${waiting.map(x => escapeHtml(x.company)).join("、")}<br><span class="plus-muted">スマホのClaudeに「就活アプリのES書いて」と送るか、パソコンで「就活の待ち処理して」</span></div>` : ""}
    <div class="card-list">${items.map(plusEsCardHtml).join("") || `<div class="plus-muted" style="padding:20px;text-align:center;">ありません</div>`}</div>`;
}
function plusEsCardHtml(a) {
  const chip = a.deadline && a.status !== "提出済" ? plusChip(a.deadline) : null;
  return `<div class="card plus-es-card">
    <div class="card-body">
      <div class="card-top">
        <div style="min-width:0;flex:1">
          <div class="card-company">${escapeHtml(a.company)}${a.program ? `<span class="program-badge">${escapeHtml(a.program)}</span>` : ""}</div>
        </div>
        <div class="card-actions">
          ${a.answer ? `<button class="secondary icon" data-plus-copy="${a.id}">コピー</button>` : ""}
          <button class="secondary icon" data-plus-es="${a.id}">編集</button>
        </div>
      </div>
      <div class="plus-es-meta">
        <span class="plus-st st-${escapeHtml(a.status || "")}">${escapeHtml(a.status || "")}</span>
        ${a.result && a.result !== "不明" ? `<span class="plus-st">${escapeHtml(a.result)}</span>` : ""}
        ${a.answer ? plusCountHtml(a.answer, a.char_limit) : ""}
        ${a.deadline ? `<span>締切 ${escapeHtml(plusDueText(a.deadline))}</span>` : ""}
        ${chip ? `<span class="days-left ${chip.cls}">${escapeHtml(chip.text)}</span>` : ""}
      </div>
      ${a.question ? `<div class="plus-es-q">${escapeHtml(a.question)}</div>` : ""}
      ${a.answer ? `<div class="card-memo collapsed plus-es-answer" data-plus-expand>${escapeHtml(a.answer)}</div>` : ""}
    </div>
  </div>`;
}
function plusMaterialHtml() {
  const rows = [["状況", "situation"], ["課題", "challenge"], ["行動", "actions"], ["結果", "result"], ["数字", "numbers"], ["学び", "learning"]];
  return `<div class="plus-muted" style="margin:8px 0;">ESを書くときにClaudeが使う材料です。直したいところはClaudeに「〇〇のエピソード、ここ違う」と言えば直ります。</div>
    <div class="card-list">${plus.episodes.map(ep => `
      <details class="card plus-ep">
        <summary class="card-body">
          <div class="card-company">${escapeHtml(ep.title)}</div>
          <div class="plus-es-meta"><span class="plus-st">${escapeHtml(ep.category || "")}</span><span class="plus-st ${ep.status === "確定" ? "st-提出済" : ""}">${escapeHtml(ep.status || "")}</span></div>
          <div class="plus-tags">${(ep.strengths || []).map(s => `<span>${escapeHtml(s)}</span>`).join("")}</div>
        </summary>
        <div class="plus-ep-body">
          ${rows.filter(([, k]) => ep[k]).map(([l, k]) => `<div><b>${l}</b>${escapeHtml(ep[k])}</div>`).join("")}
          ${ep.open_questions ? `<div class="plus-wait-line">まだ聞けていないこと: ${escapeHtml(ep.open_questions)}</div>` : ""}
        </div>
      </details>`).join("")}</div>`;
}

// ---------- ESの編集画面 ----------
function plusEnsureEsModal() {
  if (document.getElementById("plusEsModal")) return;
  const div = document.createElement("div");
  div.className = "modal-backdrop";
  div.id = "plusEsModal";
  div.innerHTML = `
    <div class="modal">
      <h2 id="plusEsTitle">ES</h2>
      <div class="field">
        <label>企業名 *</label>
        <input type="text" id="pe_company" list="plusCompanyList" placeholder="選考管理の会社名">
        <datalist id="plusCompanyList"></datalist>
      </div>
      <div class="field-row">
        <div class="field"><label>コース / インターン名</label><input type="text" id="pe_program"></div>
        <div class="field"><label>字数制限</label><input type="number" id="pe_limit" inputmode="numeric" placeholder="例: 400"></div>
      </div>
      <div class="field"><label>設問</label><textarea id="pe_question" style="min-height:60px;" placeholder="設問文をそのまま"></textarea></div>
      <div class="field-row">
        <div class="field"><label>締切</label>
          <div style="display:flex;gap:6px;"><input type="date" id="pe_date" style="flex:1.4;"><input type="time" id="pe_time" style="flex:1;"></div>
        </div>
        <div class="field"><label>状態</label>
          <select id="pe_status">${PLUS_ES_STATUSES.map(s => `<option>${s}</option>`).join("")}</select>
        </div>
      </div>
      <div class="field"><label>結果</label>
        <select id="pe_result"><option>不明</option><option>通過</option><option>不通過</option></select>
      </div>
      <div class="field">
        <label style="display:flex;justify-content:space-between;">回答 <span id="pe_count"></span></label>
        <textarea id="pe_answer" style="min-height:220px;" placeholder="空のまま「Claudeに書いてもらう」も押せます"></textarea>
      </div>
      <div class="modal-actions">
        <button class="secondary danger" id="pe_delete">削除</button>
        <div class="right">
          <button class="secondary" id="pe_cancel">閉じる</button>
          <button class="secondary" id="pe_ask">🤖 Claudeに書いてもらう</button>
          <button id="pe_save">保存</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(div);
  const upd = () => {
    const lim = parseInt(document.getElementById("pe_limit").value, 10) || null;
    document.getElementById("pe_count").innerHTML = plusCountHtml(document.getElementById("pe_answer").value, lim);
  };
  document.getElementById("pe_answer").addEventListener("input", upd);
  document.getElementById("pe_limit").addEventListener("input", upd);
  document.getElementById("pe_cancel").addEventListener("click", plusCloseEsModal);
  div.addEventListener("click", ev => { if (ev.target === div) plusCloseEsModal(); });
  document.getElementById("pe_save").addEventListener("click", () => plusSaveEs(false));
  document.getElementById("pe_ask").addEventListener("click", () => plusSaveEs(true));
  document.getElementById("pe_delete").addEventListener("click", plusDeleteEs);
}
function plusOpenEsModal(es, prefill) {
  plusEnsureEsModal();
  plusEditingEs = es || null;
  const d = es || prefill || {};
  document.getElementById("plusEsTitle").textContent = es ? "ESを編集" : "ESの設問を追加";
  document.getElementById("plusCompanyList").innerHTML = [...new Set(entries.map(e => e.company).filter(Boolean))].map(c => `<option value="${escapeHtml(c)}">`).join("");
  document.getElementById("pe_company").value = d.company || "";
  document.getElementById("pe_program").value = d.program || "";
  document.getElementById("pe_limit").value = d.char_limit || "";
  document.getElementById("pe_question").value = d.question || "";
  const j = plusJst(d.deadline);
  document.getElementById("pe_date").value = j ? j.date : "";
  document.getElementById("pe_time").value = j ? j.time : "";
  document.getElementById("pe_status").value = d.status || "下書き";
  document.getElementById("pe_result").value = d.result || "不明";
  document.getElementById("pe_answer").value = d.answer || "";
  document.getElementById("pe_delete").style.display = es ? "" : "none";
  document.getElementById("pe_answer").dispatchEvent(new Event("input"));
  document.getElementById("plusEsModal").classList.add("open");
}
function plusCloseEsModal() {
  document.getElementById("plusEsModal").classList.remove("open");
  plusEditingEs = null;
}
async function plusSaveEs(ask) {
  const company = document.getElementById("pe_company").value.trim();
  if (!company) { showToast("企業名を入れてください"); return; }
  const ent = plusEntryForCompany(company);
  const args = {
    company,
    entry_id: (plusEditingEs && plusEditingEs.entry_id) || (ent ? ent.id : ""),
    program: document.getElementById("pe_program").value.trim(),
    char_limit: document.getElementById("pe_limit").value.trim(),
    question: document.getElementById("pe_question").value.trim(),
    deadline: plusToIso(document.getElementById("pe_date").value, document.getElementById("pe_time").value),
    status: document.getElementById("pe_status").value,
    result: document.getElementById("pe_result").value,
    answer: document.getElementById("pe_answer").value,
  };
  if (plusEditingEs) args.id = plusEditingEs.id;
  if (ask && !args.question) { showToast("設問を入れてください"); return; }
  try {
    const saved = await plusApi("save_es", args);
    plusCloseEsModal();
    if (ask) await plusAskClaude(company, args.entry_id, args.program, [saved.id]);
    else showToast("保存しました");
    plusLoad(true);
  } catch (e) { showToast("保存できませんでした: " + e.message); }
}
async function plusDeleteEs() {
  if (!plusEditingEs || !confirm("このESを削除しますか?")) return;
  try { await plusApi("delete_es", { id: plusEditingEs.id }); plusCloseEsModal(); plusLoad(true); }
  catch (e) { showToast("削除できませんでした: " + e.message); }
}

// Claudeに書いてもらう: 待ち行列に入れて、claude.ai を開く(文はコピーもしておく)
async function plusAskClaude(company, entryId, program, esIds) {
  const r = await plusApi("request_es", { company, entry_id: entryId || "", program: program || "", es_ids: esIds });
  const msg = `就活アプリのES書いて(待ち#${r.queue_id} ${company} ${esIds.length}問)`;
  await copyToClipboard(msg);
  showToast("Claudeの待ちに入れました。開いたClaudeでそのまま送信してください");
  window.open("https://claude.ai/new?q=" + encodeURIComponent(msg), "_blank");
}

// ---------- 画面への組み込み ----------
(function plusInstall() {
  const style = document.createElement("style");
  style.textContent = `
    .plus-panel { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; margin-bottom: 12px; box-shadow: var(--shadow); }
    .plus-panel-head { font-weight: 700; font-size: 13px; display: flex; justify-content: space-between; margin-bottom: 4px; }
    .plus-panel-head span { color: var(--muted); font-weight: 600; }
    .plus-up-row { display: flex; gap: 10px; align-items: center; padding: 7px 0; border-top: 1px solid var(--border); }
    .plus-up-row:first-of-type { border-top: none; }
    .plus-up-main { flex: 1; min-width: 0; cursor: pointer; font-size: 13px; }
    .plus-up-title { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .plus-check { width: 30px; height: 30px; border-radius: 50%; border: 1.5px solid var(--border); background: #fff; color: var(--muted); padding: 0; flex: none; font-size: 14px; }
    .plus-check:hover { border-color: var(--success); color: var(--success); background: #ecfdf5; }
    .plus-more { background: none; color: var(--primary); padding: 4px 0; font-size: 12px; }
    .plus-wait-line { margin-top: 6px; font-size: 12px; color: #92400e; background: #fffbeb; border-radius: 8px; padding: 6px 8px; line-height: 1.6; }
    .plus-muted { color: var(--muted); font-size: 12px; font-weight: 400; }
    .plus-card-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; font-size: 12px; cursor: pointer; }
    .plus-next { background: #eef2ff; color: #3730a3; border-radius: 8px; padding: 3px 8px; font-weight: 600; }
    .plus-badge { background: #f3f4f6; color: var(--muted); border-radius: 999px; padding: 2px 8px; font-weight: 600; }
    .plus-badge.wait { background: #fffbeb; color: #92400e; }
    #plusSection { border-top: 1px dashed var(--border); margin-top: 12px; padding-top: 10px; }
    .plus-sec-head { font-weight: 700; font-size: 13px; margin-bottom: 6px; display: flex; gap: 8px; align-items: baseline; }
    .plus-log { border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; margin-bottom: 6px; background: #fff; }
    .plus-log.done { opacity: .55; }
    .plus-log-top { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 12px; }
    .plus-log-acts { margin-left: auto; display: flex; gap: 6px; align-items: center; }
    .plus-done { display: flex; gap: 3px; align-items: center; font-size: 12px; color: var(--muted); margin: 0; }
    .plus-done input { width: auto; margin: 0; }
    .plus-x { background: none; color: var(--muted); padding: 0 4px; font-size: 16px; }
    .plus-kind { border-radius: 6px; padding: 1px 6px; background: #f3f4f6; font-weight: 700; }
    .plus-kind.k-締切 { background: #fee2e2; color: #b91c1c; }
    .plus-kind.k-予定 { background: #e0f2fe; color: #0369a1; }
    .plus-kind.k-提出控え { background: #ecfdf5; color: #047857; }
    .plus-log-title { font-weight: 600; font-size: 13px; margin-top: 3px; }
    .plus-log-body { font-size: 12px; color: #374151; white-space: pre-wrap; margin-top: 3px; max-height: 160px; overflow: auto; }
    .plus-log-meta { font-size: 11px; color: var(--muted); margin-top: 3px; }
    .plus-add-log summary { cursor: pointer; color: var(--primary); font-size: 13px; font-weight: 600; padding: 4px 0; }
    .plus-log-form { padding: 6px 0; }
    .plus-es-mini { border: 1px solid var(--border); border-radius: 10px; padding: 7px 10px; margin-bottom: 6px; cursor: pointer; background: #fff; }
    .plus-es-q { font-size: 13px; font-weight: 600; margin-top: 4px; white-space: pre-wrap; }
    .plus-es-meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 12px; color: var(--muted); margin-top: 4px; }
    .plus-st { border-radius: 999px; padding: 1px 8px; background: #f3f4f6; color: #374151; font-weight: 600; }
    .plus-st.st-下書き { background: #eef2ff; color: #3730a3; }
    .plus-st.st-書いてもらい中 { background: #fffbeb; color: #92400e; }
    .plus-st.st-提出済 { background: #ecfdf5; color: #047857; }
    .plus-count { font-weight: 700; }
    .plus-count.over { color: var(--danger); }
    .plus-count.ok { color: var(--success); }
    .plus-count.short { color: var(--warning); }
    .plus-es-answer { cursor: pointer; margin-top: 6px; }
    .plus-seg { display: flex; gap: 4px; background: #eef0f5; border-radius: 10px; padding: 3px; }
    .plus-seg button { flex: 1; background: transparent; color: var(--muted); font-size: 13px; font-weight: 600; padding: 7px; border-radius: 8px; }
    .plus-seg button.on { background: #fff; color: var(--text); box-shadow: var(--shadow); }
    .plus-chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
    .plus-chips button { background: #fff; border: 1px solid var(--border); color: var(--muted); font-size: 12px; padding: 4px 10px; border-radius: 999px; }
    .plus-chips button.on { background: var(--primary); border-color: var(--primary); color: #fff; }
    .plus-ep summary { list-style: none; cursor: pointer; }
    .plus-ep summary::-webkit-details-marker { display: none; }
    .plus-ep-body { padding: 0 14px 12px; font-size: 13px; line-height: 1.7; }
    .plus-ep-body b { display: inline-block; min-width: 3em; color: var(--muted); font-size: 12px; margin-right: 6px; }
    .plus-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .plus-tags span { font-size: 11px; background: #f3f4f6; border-radius: 6px; padding: 1px 6px; color: #374151; }
    .plus-keybox input { font-size: 15px; }
  `;
  document.head.appendChild(style);

  document.addEventListener("click", async ev => {
    const t = ev.target.closest("[data-plus-open],[data-plus-done],[data-plus-more],[data-plus-es],[data-plus-es-new],[data-plus-ask],[data-plus-copy],[data-plus-filter],[data-plus-view],[data-plus-dellog],[data-plus-expand],#plusKeySave,#plusLogAdd");
    if (!t) return;
    const ds = t.dataset;
    if (ds.plusOpen) { ev.stopPropagation(); openModal(ds.plusOpen); return; }
    if (ds.plusDone) {
      t.disabled = true;
      try { await plusApi("update_log", { id: ds.plusDone, done: true }); const l = plus.log.find(x => x.id === ds.plusDone); if (l) l.done = true; plusRerender(); showToast("済みにしました"); }
      catch (e) { t.disabled = false; showToast("できませんでした: " + e.message); }
      return;
    }
    if (ds.plusMore !== undefined) { const el = document.getElementById("plusUpcoming"); el.dataset.expanded = el.dataset.expanded === "1" ? "" : "1"; plusRenderUpcoming(); return; }
    if (ds.plusEs) { const a = plus.es.find(x => x.id === ds.plusEs); if (a) plusOpenEsModal(a); return; }
    if (ds.plusEsNew) {
      const e = entries.find(x => x.id === ds.plusEsNew);
      plusOpenEsModal(null, { company: e.company, program: e.program, entry_id: e.id });
      return;
    }
    if (ds.plusAsk) {
      const e = entries.find(x => x.id === ds.plusAsk);
      const ids = plusFor(e).es.filter(x => !x.answer).map(x => x.id);
      try { await plusAskClaude(e.company, e.id, e.program, ids); plusLoad(true); } catch (err) { showToast("できませんでした: " + err.message); }
      return;
    }
    if (ds.plusCopy) {
      const a = plus.es.find(x => x.id === ds.plusCopy);
      if (a && await copyToClipboard(a.answer)) showToast(`コピーしました(${plusCount(a.answer)}字)`);
      return;
    }
    if (ds.plusFilter !== undefined) { plusEsFilter = ds.plusFilter; plusRenderEsTab(); return; }
    if (ds.plusView) { plusEsView = ds.plusView; plusRenderEsTab(); return; }
    if (ds.plusExpand !== undefined) { t.classList.toggle("collapsed"); return; }
    if (ds.plusDellog) {
      if (!confirm("この記録を消しますか?")) return;
      try { await plusApi("delete_log", { id: ds.plusDellog }); plus.log = plus.log.filter(x => x.id !== ds.plusDellog); plusRerender(); }
      catch (e) { showToast("消せませんでした: " + e.message); }
      return;
    }
    if (t.id === "plusKeySave") {
      const v = document.getElementById("plusKeyInput").value.trim();
      if (!v) return;
      plusStore.set(PLUS_KEY_STORE, v); plusError = ""; plusLoad();
      return;
    }
    if (t.id === "plusLogAdd") {
      const e = entries.find(x => x.id === editingId);
      if (!e) return;
      const title = document.getElementById("plusLogTitle").value.trim();
      if (!title) { showToast("タイトルを入れてください"); return; }
      try {
        const r = await plusApi("add_log", {
          entry_id: e.id, company: e.company, kind: document.getElementById("plusLogKind").value, title,
          due_at: plusToIso(document.getElementById("plusLogDate").value, document.getElementById("plusLogTime").value),
          body: document.getElementById("plusLogBody").value.trim(),
        });
        plus.log.unshift(r); plusRerender(); showToast("記録しました");
      } catch (err) { showToast("記録できませんでした: " + err.message); }
    }
  }, true);

  document.addEventListener("change", async ev => {
    const t = ev.target;
    if (!t.dataset || !t.dataset.plusToggle) return;
    try { await plusApi("update_log", { id: t.dataset.plusToggle, done: t.checked }); const l = plus.log.find(x => x.id === t.dataset.plusToggle); if (l) l.done = t.checked; plusRerender(); }
    catch (e) { t.checked = !t.checked; showToast("できませんでした: " + e.message); }
  });
  document.addEventListener("input", ev => {
    if (ev.target.id === "plusEsSearch") {
      plusEsSearch = ev.target.value;
      clearTimeout(plusInstall.t);
      plusInstall.t = setTimeout(() => { plusRenderEsTab(); const s = document.getElementById("plusEsSearch"); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 250);
    }
  });

  document.addEventListener("visibilitychange", () => { if (!document.hidden) plusLoad(true); });
  window.addEventListener("hashchange", () => { if (/k=/.test(location.hash)) { const m = location.hash.match(/k=([^&]+)/); plusStore.set(PLUS_KEY_STORE, decodeURIComponent(m[1])); history.replaceState(null, "", location.pathname); plusLoad(); } });
  setInterval(() => { if (!document.hidden) plusLoad(true); }, 60000);
  plusRerender();
  plusLoad();
})();
