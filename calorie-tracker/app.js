// Grace's Calorie Tracker
// Data lives in the artifact's shared database (synced across devices and people).
// Layout of the store:
//   accounts/{accountId}                 { name, goals, linkedUsers[], recents[], customFoods[], createdAt }
//   accounts/{accountId}/months/{YYYY-MM} { month, days: { "YYYY-MM-DD": { breakfast[], lunch[], dinner[], supper[] } } }
// One document per account per month keeps 10 years at ~120 documents per account.
(() => {
"use strict";

const MEALS = [
  { id: "breakfast", name: "Breakfast" },
  { id: "lunch", name: "Lunch" },
  { id: "dinner", name: "Dinner" },
  { id: "supper", name: "Supper" },
];
const BARS = [
  { id: "kcal", short: "Cal", unit: "" },
  { id: "protein", short: "P", unit: "g" },
  { id: "carbs", short: "C", unit: "g" },
  { id: "fat", short: "F", unit: "g" },
  { id: "sugar", short: "S", unit: "g" },
];
const NUTRI = ["kcal", "protein", "carbs", "fat", "sugar", "sodium"];
const goalsFor = (kcal) => ({
  kcal, protein: Math.round((kcal * 0.25) / 4), carbs: Math.round((kcal * 0.5) / 4),
  fat: Math.round((kcal * 0.25) / 9), sugar: 40, sodium: 2000,
});
const HISTORY_YEARS = 10;

// ---------- Helpers ----------
const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const r0 = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;
const fmt = (n) => (Math.abs(n) >= 100 ? r0(n) : r1(n)).toLocaleString("en-SG");
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseYmd = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const monthOf = (dateKey) => dateKey.slice(0, 7);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const todayKey = () => ymd(new Date());
const mealName = (id) => MEALS.find((m) => m.id === id)?.name || id;
const lsGet = (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch { return f; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* per-device convenience only */ } };

function mealForNow() {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return "breakfast";
  if (h >= 11 && h < 16) return "lunch";
  if (h >= 16 && h < 22) return "dinner";
  return "supper";
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

const ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
};

// ---------- Device-only fallback store ----------
// Used only when the page is opened outside Claude (or signed out), so the app still works.
function createLocalDb() {
  const KEY = "gct.localdb";
  const data = lsGet(KEY, {});
  const listeners = new Set();
  const persist = () => { lsSet(KEY, data); queueMicrotask(() => listeners.forEach((l) => l())); };
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const snap = (path) => ({ id: path.split("/").pop(), exists: path in data, data: () => clone(data[path]), metadata: { fromCache: false, hasPendingWrites: false } });
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const merge = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
    return out;
  };
  const docRef = (path) => ({
    id: path.split("/").pop(), path,
    get: async () => snap(path),
    set: async (v) => { data[path] = clone(v); persist(); },
    update: async (v) => { if (!(path in data)) throw { code: "invalid_argument", message: "missing" }; data[path] = merge(data[path], clone(v)); persist(); },
    delete: async () => { delete data[path]; persist(); },
    onSnapshot(next) { const l = () => next(snap(path)); listeners.add(l); queueMicrotask(l); return () => listeners.delete(l); },
    collection: (sub) => collRef(path + "/" + sub),
  });
  const collRef = (path, filters = []) => {
    const run = () => {
      const depth = path.split("/").length + 1;
      const docs = Object.keys(data).filter((p) => p.startsWith(path + "/") && p.split("/").length === depth).sort()
        .filter((p) => filters.every(([f, op, v]) => {
          const x = data[p][f];
          return op === "array-contains" ? Array.isArray(x) && x.includes(v) : op === "==" ? x === v : true;
        })).map(snap);
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
    };
    return {
      path,
      doc: (id) => docRef(path + "/" + (id || uid())),
      where: (f, op, v) => collRef(path, [...filters, [f, op, v]]),
      orderBy() { return this; }, limit() { return this; },
      get: async () => run(),
      onSnapshot(next) { const l = () => next(run()); listeners.add(l); queueMicrotask(l); return () => listeners.delete(l); },
    };
  };
  return { doc: docRef, collection: (p) => collRef(p), local: true };
}

// ---------- App state ----------
const state = {
  db: null,
  sample: null,
  sampleLimits: null,
  myId: null,
  mode: "loading",          // "cloud" | "local"
  accounts: [],             // [{id, ...data}]
  accountsLoaded: false,
  accountId: null,
  months: {},               // "accId|YYYY-MM" -> { exists, days }
  monthSubs: new Map(),     // key -> unsubscribe
  selectedDate: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })(),
  recPlan: null,
  recList: [],
};
const account = () => state.accounts.find((a) => a.id === state.accountId) || null;
const goals = () => Object.assign(goalsFor(1800), account()?.goals || {});

// ---------- Writes: one at a time per document ----------
const writeChains = new Map();
function queueWrite(path, fn) {
  const prev = writeChains.get(path) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  writeChains.set(path, next);
  return next.catch((e) => {
    const code = e?.code;
    if (code === "quota_exceeded") toast("The shared storage is full. Delete an unused account to free space.");
    else if (code === "invalid_argument") toast("You can view this tracker but not save to it. Ask the owner to make you an Editor.");
    else toast("Couldn't save. Check your connection and try again.");
    throw e;
  });
}

const monthPath = (accId, month) => `accounts/${accId}/months/${month}`;
const monthKey = (accId, month) => `${accId}|${month}`;

function dayData(dateKey, accId = state.accountId) {
  const m = state.months[monthKey(accId, monthOf(dateKey))];
  const d = m?.days?.[dateKey] || {};
  const out = {};
  for (const meal of MEALS) out[meal.id] = Array.isArray(d[meal.id]) ? d[meal.id] : [];
  return out;
}

function writeDay(dateKey, day) {
  const accId = state.accountId;
  const month = monthOf(dateKey);
  const key = monthKey(accId, month);
  const cached = state.months[key] || { exists: false, days: {} };
  state.months[key] = { ...cached, days: { ...cached.days, [dateKey]: day } };
  renderAll();
  const ref = state.db.doc(monthPath(accId, month));
  return queueWrite(ref.path, async () => {
    const now = new Date().toISOString();
    const snap = await ref.get();
    if (snap.exists) await ref.update({ days: { [dateKey]: day }, updatedAt: now });
    else await ref.set({ month, days: { [dateKey]: day }, updatedAt: now });
  });
}

function updateAccount(patch) {
  const a = account();
  if (!a) return Promise.resolve();
  Object.assign(a, patch);
  const ref = state.db.doc(`accounts/${a.id}`);
  return queueWrite(ref.path, () => ref.update(patch));
}

// ---------- Subscriptions ----------
let loadTimer = null;
function showBanner(text) {
  const b = $("#banner");
  b.hidden = !text;
  b.textContent = text || "";
}

function subscribeAccounts() {
  loadTimer = setTimeout(() => { if (!state.accountsLoaded) showBanner("Can't reach your saved data yet. It will appear when the connection comes back."); }, 10000);
  state.db.collection("accounts").onSnapshot((snap) => {
    if (!snap.metadata?.fromCache) { clearTimeout(loadTimer); if (state.mode === "cloud") showBanner(""); }
    state.accounts = snap.docs.filter((d) => d.exists).map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    const firstLoad = !state.accountsLoaded;
    state.accountsLoaded = true;
    if (!account()) {
      state.accountId = null;
      const linked = state.myId && state.accounts.find((a) => (a.linkedUsers || []).includes(state.myId));
      const last = state.accounts.find((a) => a.id === lsGet("gct.lastAccount", null));
      const pick = linked || last;
      if (pick) selectAccount(pick.id);
      else if (firstLoad || !sheetOpen()) openSheet(null, "accounts");
      else refreshAccountsView();
    } else refreshAccountsView();
    renderAll();
  }, (e) => {
    clearTimeout(loadTimer);
    showBanner(e?.code === "revoked" ? "Access to this tracker was removed." : "Couldn't load your data. Reload the page to try again.");
  });
}

function refreshAccountsView() {
  const top = sheet.stack[sheet.stack.length - 1];
  if (sheetOpen() && top && top[0] === "accounts") show("accounts", null, false);
}

function selectAccount(id) {
  if (state.accountId === id) return;
  state.accountId = id;
  lsSet("gct.lastAccount", id);
  for (const unsub of state.monthSubs.values()) unsub();
  state.monthSubs.clear();
  chat.turns = [];
  renderAll();
}

function ensureMonthSubs() {
  if (!state.accountId || !state.db) return;
  const start = weekStart(state.selectedDate);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const needed = new Set([monthOf(ymd(start)), monthOf(ymd(end)), monthOf(todayKey())].map((m) => monthKey(state.accountId, m)));
  for (const [key, unsub] of state.monthSubs) if (!needed.has(key)) { unsub(); state.monthSubs.delete(key); }
  for (const key of needed) {
    if (state.monthSubs.has(key)) continue;
    const [accId, month] = key.split("|");
    const unsub = state.db.doc(monthPath(accId, month)).onSnapshot((snap) => {
      const d = snap.exists ? snap.data() : null;
      state.months[key] = { exists: snap.exists, days: d?.days || {}, fetchedAt: Date.now() };
      renderAll(false);
    }, () => {});
    state.monthSubs.set(key, unsub);
  }
}

// Read a month that isn't subscribed (history for the assistant).
async function getMonth(accId, month) {
  const key = monthKey(accId, month);
  const c = state.months[key];
  if (c && (state.monthSubs.has(key) || Date.now() - (c.fetchedAt || 0) < 60000)) return c.days || {};
  const snap = await state.db.doc(monthPath(accId, month)).get();
  const days = snap.exists ? snap.data().days || {} : {};
  state.months[key] = { exists: snap.exists, days, fetchedAt: Date.now() };
  return days;
}

function monthsBetween(start, end) {
  const out = [];
  const d = new Date(start.getFullYear(), start.getMonth(), 1);
  while (d <= end && out.length < HISTORY_YEARS * 12 + 1) { out.push(ymd(d).slice(0, 7)); d.setMonth(d.getMonth() + 1); }
  return out;
}

async function loadRange(startKey, endKey) {
  const months = monthsBetween(parseYmd(startKey), parseYmd(endKey));
  const result = [];
  for (let i = 0; i < months.length; i += 6) {
    const chunk = await Promise.all(months.slice(i, i + 6).map((m) => getMonth(state.accountId, m)));
    for (const days of chunk) for (const [date, day] of Object.entries(days)) if (date >= startKey && date <= endKey) result.push([date, day]);
  }
  return result.sort((a, b) => a[0].localeCompare(b[0]));
}

// ---------- Totals ----------
function totalsOf(entries) {
  const t = Object.fromEntries(NUTRI.map((k) => [k, 0]));
  for (const e of entries) for (const k of NUTRI) t[k] += num(e[k]) * num(e.qty || 1);
  return t;
}
const dayTotals = (dateKey) => totalsOf(MEALS.flatMap((m) => dayData(dateKey)[m.id]));

// ---------- Rendering ----------
function weekStart(d) { const s = new Date(d); s.setDate(s.getDate() - s.getDay()); s.setHours(0, 0, 0, 0); return s; }

function renderHeader() {
  const a = account();
  $("#accountInitial").textContent = a ? (a.name || "?").trim().charAt(0).toUpperCase() : "·";
  const sel = ymd(state.selectedDate);
  const name = a?.name ? a.name.trim().split(/\s+/)[0] : "";
  $("#title").textContent = sel === todayKey()
    ? (name ? `Hi, ${name}` : "Food Log")
    : state.selectedDate.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  $("#dateJump").value = sel;
  const min = new Date(); min.setFullYear(min.getFullYear() - HISTORY_YEARS);
  $("#dateJump").min = ymd(min);
}

function renderWeek() {
  const start = weekStart(state.selectedDate);
  const sel = ymd(state.selectedDate), today = todayKey();
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let html = "";
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = ymd(d);
    const day = dayData(key);
    const has = MEALS.some((m) => day[m.id].length);
    html += `<button class="day${key === sel ? " sel" : ""}${key === today ? " today" : ""}" data-date="${key}" aria-label="${d.toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "long" })}"${key === sel ? ' aria-current="date"' : ""}>
      <span class="dow">${dows[i]}</span><span class="dnum">${d.getDate()}</span>${has ? '<span class="dot"></span>' : ""}</button>`;
  }
  $("#days").innerHTML = html;
}

function renderBars() {
  const t = dayTotals(ymd(state.selectedDate));
  const g = goals();
  $("#bars").innerHTML = BARS.map((n) => {
    const goal = num(g[n.id]) || 1;
    const pct = Math.min(100, (t[n.id] / goal) * 100);
    return `<div class="bar${n.id === "kcal" ? " cal" : ""}${t[n.id] > goal ? " over" : ""}">
      <div class="track"><div class="fill" style="width:${pct}%"></div></div>
      <div class="lbl"><b>${n.short}</b> ${r0(t[n.id]).toLocaleString("en-SG")}${n.unit}</div>
      <div class="lbl goal">of ${r0(goal).toLocaleString("en-SG")}${n.unit}</div></div>`;
  }).join("");
}

function renderMeals() {
  const sel = ymd(state.selectedDate);
  const day = dayData(sel);
  const now = sel === todayKey() ? mealForNow() : null;
  $("#meals").innerHTML = MEALS.map((m) => {
    const entries = day[m.id];
    const kcal = totalsOf(entries).kcal;
    const sub = entries.length ? `${fmt(kcal)} kcal · ${entries.length} item${entries.length > 1 ? "s" : ""}` : "Optional · tap + to log";
    return `<div class="meal">
      <div class="meal-head">
        <div class="meal-title"><h2>${m.name}${m.id === now ? '<span class="tag-now">now</span>' : ""}</h2><div class="sub">${sub}</div></div>
        <button class="add-btn" data-add="${m.id}" aria-label="Add to ${m.name}">${ICON.plus}</button>
      </div>
      ${entries.length ? `<ul class="entries">${entries.map((e) => `
        <li class="entry">
          <div class="e-main"><div class="e-name">${esc(e.name)}</div>
            <div class="e-meta">${num(e.qty) !== 1 ? `${r1(num(e.qty))} × ` : ""}${esc(e.serving)} · P ${fmt(e.protein * e.qty)}g · C ${fmt(e.carbs * e.qty)}g · F ${fmt(e.fat * e.qty)}g · S ${fmt(e.sugar * e.qty)}g</div></div>
          <div class="e-kcal">${fmt(e.kcal * e.qty)}</div>
          <button class="e-del" data-del="${m.id}:${esc(e.id)}" aria-label="Remove ${esc(e.name)}">${ICON.trash}</button>
        </li>`).join("")}</ul>` : ""}
    </div>`;
  }).join("");
}

// ---------- Recommendations ----------
const MAIN_CATS = {
  breakfast: ["Breakfast", "Bakery", "Dim Sum", "Dairy", "Fast Food", "Hawker"],
  lunch: ["Hawker", "Zi Char", "Western", "Japanese", "Korean", "Restaurant", "Fast Food", "Dim Sum", "Convenience"],
  dinner: ["Hawker", "Zi Char", "Western", "Japanese", "Korean", "Restaurant", "Fast Food", "Protein"],
  supper: ["Hawker", "Dim Sum", "Fast Food", "Snacks", "Dessert", "Kueh", "Convenience", "Fruit", "Dairy"],
};
const BREAKFAST_HAWKER = /prata|thosai|porridge|chee cheong|chwee|kaya|you tiao|carrot cake|lor mee|fishball|bee hoon|nasi lemak|mee siam|mee rebus|popiah|soon kueh|png kueh/i;
const BREAKFAST_FASTFOOD = /muffin|hashbrown|hotcake|egg/i;

function planNextMeal() {
  const sel = ymd(state.selectedDate);
  const day = dayData(sel);
  const order = MEALS.map((m) => m.id);
  const fromIdx = sel === todayKey() ? order.indexOf(mealForNow()) : 0;
  const rest = order.slice(fromIdx);
  const next = rest.find((id) => !day[id].length) || rest[rest.length - 1];
  const t = dayTotals(sel);
  const g = goals();
  const remaining = g.kcal - t.kcal;
  const share = { breakfast: 0.3, lunch: 0.5, dinner: 0.85, supper: 1 }[next];
  return { next, remaining, budget: Math.max(0, Math.round(remaining * share)), totals: t, goals: g };
}

function recommend(plan) {
  const { next, budget, totals, goals: g } = plan;
  const sugarLeft = g.sugar - totals.sugar;
  const proteinLeft = g.protein - totals.protein;
  const cats = new Set(MAIN_CATS[next]);
  const min = Math.max(150, Math.min(250, budget * 0.45));
  const scored = [];
  for (const f of allFoods()) {
    if (!cats.has(f.category)) continue;
    if (/gravy|sauce|plain white rice|ketupat/i.test(f.name)) continue;
    if (next === "breakfast" && f.category === "Hawker" && !BREAKFAST_HAWKER.test(f.name)) continue;
    if (next === "breakfast" && f.category === "Fast Food" && !BREAKFAST_FASTFOOD.test(f.name)) continue;
    if (f.kcal > budget || f.kcal < min) continue;
    let score = (f.protein * 4 / Math.max(f.kcal, 1)) * (proteinLeft > 0 ? 10 : 4);
    score += 1 - Math.abs(0.8 - f.kcal / Math.max(budget, 1));
    if (sugarLeft < 15) score -= f.sugar / 10;
    score -= f.sodium / 3000;
    scored.push([score, f]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const perCat = {};
  const meals = [];
  for (const [, f] of scored) {
    perCat[f.category] = (perCat[f.category] || 0) + 1;
    if (perCat[f.category] > 3) continue;
    meals.push(f);
    if (meals.length >= 8) break;
  }
  const seen = new Set();
  const drinks = allFoods()
    .filter((f) => ["Drinks", "Packaged Drinks", "Cafe"].includes(f.category) && f.kcal <= Math.max(20, Math.min(130, plan.remaining)))
    .sort((a, b) => (a.sugar - b.sugar) || (a.kcal - b.kcal))
    .filter((f) => { const k = f.name.split(" (")[0]; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 6);
  return { meals, drinks };
}

function recCard(f, idx, budget, next) {
  const pct = budget > 0 ? Math.round((f.kcal / budget) * 100) : 0;
  return `<button class="rec" data-rec="${idx}">
    <span class="r-cat">${esc(f.category)}</span>
    <span class="r-name">${esc(f.name)}</span>
    <span class="r-kcal">${fmt(f.kcal)} <small>kcal · ${esc(f.serving)}</small></span>
    <span class="r-macros">P ${fmt(f.protein)}g · C ${fmt(f.carbs)}g · F ${fmt(f.fat)}g · S ${fmt(f.sugar)}g</span>
    ${budget > 0 ? `<span class="r-fit">${pct}% of your ${mealName(next).toLowerCase()} budget</span>` : ""}
  </button>`;
}

function renderRecs() {
  const el = $("#recs");
  if (!account()) { el.innerHTML = ""; return; }
  const plan = planNextMeal();
  state.recPlan = plan;
  const { meals, drinks } = recommend(plan);
  state.recList = [...meals, ...drinks];
  const meal = mealName(plan.next).toLowerCase();
  let why;
  if (plan.remaining <= 0) {
    why = `You've reached your <b>${fmt(plan.goals.kcal)} kcal</b> goal for the day. If you're still hungry, stick to zero-sugar drinks or fruit.`;
  } else if (plan.budget < 150) {
    why = `You have <b>${fmt(plan.remaining)} kcal</b> left today, which is less than a meal. A low-sugar drink or a piece of fruit fits.`;
  } else {
    const proteinLeft = Math.max(0, plan.goals.protein - plan.totals.protein);
    why = `You have <b>${fmt(plan.remaining)} kcal</b> left. For ${meal}, aim for about <b>${fmt(plan.budget)} kcal</b>${proteinLeft > 10 ? ` and some of the <b>${fmt(proteinLeft)}g protein</b> you still need` : ""}. These Singapore picks fit:`;
  }
  el.innerHTML = `
    <h3>Picks for ${meal}</h3>
    <p class="why">${why}</p>
    ${meals.length ? `<div class="rec-row" aria-label="Meal picks">${meals.map((f, i) => recCard(f, i, plan.budget, plan.next)).join("")}</div>` : (plan.budget >= 150 ? '<p class="muted">Nothing in the food list fits that budget. Try fruit or a light snack.</p>' : "")}
    ${drinks.length ? `<div class="sub-head">Low-sugar drinks</div><div class="rec-row" aria-label="Drink picks">${drinks.map((f, i) => recCard(f, meals.length + i, 0, plan.next)).join("")}</div>` : ""}
    <button class="ask-pick" id="askPick">${ICON.chat}Ask the assistant for a pick</button>`;
}

function renderSummary() {
  const t = dayTotals(ymd(state.selectedDate));
  const g = goals();
  const remaining = g.kcal - t.kcal;
  const cells = [
    ["Calories", fmt(t.kcal), `/ ${fmt(g.kcal)}`],
    [remaining >= 0 ? "Remaining" : "Over by", fmt(Math.abs(remaining)), "kcal"],
    ["Protein", fmt(t.protein), `/ ${fmt(g.protein)}g`],
    ["Carbs", fmt(t.carbs), `/ ${fmt(g.carbs)}g`],
    ["Fat", fmt(t.fat), `/ ${fmt(g.fat)}g`],
    ["Sugar", fmt(t.sugar), `/ ${fmt(g.sugar)}g`],
    ["Sodium", fmt(t.sodium), `/ ${fmt(g.sodium)}mg`],
  ];
  $("#summary").innerHTML = `<h3>Day summary</h3><div class="grid">${cells.map(([k, v, s]) => `<div class="cell"><div class="k">${k}</div><div class="v">${v} <small>${s}</small></div></div>`).join("")}</div>`;
}

function renderAll(subs = true) {
  if (subs) ensureMonthSubs();
  renderHeader();
  renderWeek();
  renderBars();
  renderMeals();
  renderRecs();
  renderSummary();
}

// ---------- Logging ----------
function compactFood(f) {
  return { id: f.id || "f" + uid(), name: String(f.name), serving: String(f.serving || "1 serving"), category: String(f.category || ""), source: String(f.source || ""),
    kcal: r0(num(f.kcal)), protein: r1(num(f.protein)), carbs: r1(num(f.carbs)), fat: r1(num(f.fat)), sugar: r1(num(f.sugar)), sodium: r0(num(f.sodium)) };
}

function addEntry(mealId, food, qty) {
  const dateKey = ymd(state.selectedDate);
  const day = dayData(dateKey);
  const f = compactFood(food);
  const entry = { ...f, id: uid(), qty: num(qty) || 1, at: new Date().toISOString() };
  writeDay(dateKey, { ...day, [mealId]: [...day[mealId], entry] }).catch(() => {});
  const a = account();
  if (a) {
    const recents = [f, ...(a.recents || []).filter((r) => !(r.name === f.name && r.serving === f.serving))].slice(0, 25);
    updateAccount({ recents }).catch(() => {});
  }
}

function removeEntry(mealId, id) {
  const dateKey = ymd(state.selectedDate);
  const day = dayData(dateKey);
  writeDay(dateKey, { ...day, [mealId]: day[mealId].filter((e) => e.id !== id) }).then(() => toast("Removed")).catch(() => {});
}

// ---------- Sheet ----------
const sheet = { meal: mealForNow(), stack: [] };
const sheetOpen = () => $("#sheet").classList.contains("open");

function openSheet(mealId, view = "add", arg) {
  if (view !== "accounts" && view !== "newAccount" && !account()) view = "accounts";
  sheet.meal = mealId || (ymd(state.selectedDate) === todayKey() ? mealForNow() : sheet.meal);
  sheet.stack = [];
  $("#scrim").classList.add("open");
  $("#sheet").classList.add("open");
  show(view, arg);
}

function closeSheet() {
  if (!account()) return; // an account must be chosen first
  chat.ctl?.abort();
  $("#scrim").classList.remove("open");
  $("#sheet").classList.remove("open");
  $("#sheetFoot").hidden = true;
}

function renderMealTabs(visible) {
  const el = $("#mealTabs");
  el.hidden = !visible;
  el.innerHTML = MEALS.map((m) => `<button data-meal="${m.id}" class="${m.id === sheet.meal ? "on" : ""}">${m.name}</button>`).join("");
}

function show(view, arg, push = true) {
  if (push) sheet.stack.push([view, arg]);
  $("#sheetBack").hidden = sheet.stack.length < 2;
  $("#sheetClose").hidden = !account();
  $("#sheetFoot").hidden = true;
  const body = $("#sheetBody");
  body.scrollTop = 0;
  VIEWS[view](body, arg);
}

function back() {
  sheet.stack.pop();
  const [view, arg] = sheet.stack[sheet.stack.length - 1] || ["add"];
  show(view, view === "scan" ? scanState : arg, false);
}

// ---------- Food search ----------
let activeCategory = "All";
const allFoods = () => [...(account()?.customFoods || []), ...window.SG_FOODS];

function searchFoods(q, cat = activeCategory, limit = 60) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  let list = allFoods();
  if (cat !== "All") list = list.filter((f) => f.category === cat);
  if (!tokens.length) return cat === "All" ? [] : list.slice(0, limit);
  const phrase = tokens.join(" ");
  const scored = [];
  for (const f of list) {
    const name = f.name.toLowerCase();
    const hay = name + " " + String(f.category).toLowerCase();
    if (!tokens.every((t) => hay.includes(t))) continue;
    const base = name.replace(/\s*\(.*?\)\s*/g, " ").trim();
    let score = 0;
    if (base === phrase) score += 10;
    if (name.includes(phrase)) score += 4;
    if (name.startsWith(tokens[0])) score += 3;
    score -= base.length / 15;
    scored.push([score, f]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map((x) => x[1]).slice(0, limit);
}

function resultItem(f, idx) {
  return `<li><button class="result" data-pick="${idx}">
    <div class="r-main"><div class="r-name">${esc(f.name)}</div>
    <div class="r-meta">${esc(f.serving)} · P ${fmt(f.protein)}g · C ${fmt(f.carbs)}g · F ${fmt(f.fat)}g · S ${fmt(f.sugar)}g</div></div>
    <div class="r-kcal">${fmt(f.kcal)} kcal</div></button></li>`;
}

let pickList = [];
function renderResults(q) {
  const wrap = $("#resultsWrap");
  if (!wrap) return;
  const query = q.trim();
  let html;
  if (!query && activeCategory === "All") {
    pickList = (account()?.recents || []).slice(0, 12);
    html = pickList.length
      ? `<div class="section-label">Recent</div><ul class="results">${pickList.map(resultItem).join("")}</ul>`
      : `<p class="muted">Search ${window.SG_FOODS.length} Singapore foods: hawker dishes, kopitiam drinks, fast food, bubble tea and supermarket brands.</p>`;
  } else {
    pickList = searchFoods(query);
    html = pickList.length ? `<ul class="results">${pickList.map(resultItem).join("")}</ul>` : `<p class="muted">No match in the food list.</p>`;
    html += `<button class="link-btn" data-act="custom-q">Can't find it? Enter it manually</button>`;
  }
  wrap.innerHTML = html;
}

// ---------- Views ----------
const VIEWS = {
  accounts(body) {
    $("#sheetTitle").textContent = account() ? "Accounts" : "Who's tracking?";
    renderMealTabs(false);
    const list = state.accounts;
    body.innerHTML = `
      ${!account() ? `<p class="note" style="margin-top:0">Pick your account, or create one. Everyone this tracker is shared with can have their own account.</p>` : ""}
      <div class="acct-list">${list.map((a) => `
        <button class="acct${a.id === state.accountId ? " cur" : ""}" data-account="${esc(a.id)}">
          <span class="av">${esc((a.name || "?").charAt(0).toUpperCase())}</span>
          <span class="r-main"><span class="a-name">${esc(a.name || "Unnamed")}</span>
          <span class="a-meta" style="display:block">${fmt(num(a.goals?.kcal) || 1800)} kcal a day${state.myId && (a.linkedUsers || []).includes(state.myId) ? " · yours" : ""}</span></span>
        </button>`).join("")}</div>
      ${!list.length && state.accountsLoaded ? '<p class="muted">No accounts yet. Create the first one.</p>' : ""}
      ${!state.accountsLoaded ? '<div class="spinner"></div>' : ""}
      <button class="primary" data-act="new-account">Create an account</button>
      ${account() ? `<button class="secondary" data-act="settings">Settings for ${esc(account().name)}</button>` : ""}`;
  },

  newAccount(body) {
    $("#sheetTitle").textContent = "New account";
    renderMealTabs(false);
    body.innerHTML = `
      <div class="form">
        <div class="field full"><label for="naName">Name</label><input id="naName" type="text" autocomplete="off" placeholder="e.g. Grace"></div>
        <div class="field full"><label for="naKcal">Daily calorie goal (kcal)</label><input id="naKcal" type="number" inputmode="numeric" min="800" max="6000" value="1800"></div>
      </div>
      <p class="note">Protein, carbs and fat goals are set from the calorie goal (25%, 50% and 25% of calories). Sugar starts at 40g and sodium at 2,000mg. You can change all of them in Settings.</p>
      ${state.myId ? `<label class="check"><input type="checkbox" id="naLink" checked> This is me. Open this account automatically when I use the tracker on any phone or computer.</label>` : ""}
      <button class="primary" id="naCreate">Create account</button>`;
    $("#naCreate", body).addEventListener("click", async () => {
      const name = $("#naName", body).value.trim();
      if (!name) return toast("Enter a name");
      const kcal = Math.min(6000, Math.max(800, num($("#naKcal", body).value) || 1800));
      const link = $("#naLink", body)?.checked;
      const id = "a" + uid();
      const data = { name, goals: goalsFor(kcal), linkedUsers: link && state.myId ? [state.myId] : [], recents: [], customFoods: [], createdAt: new Date().toISOString() };
      $("#naCreate", body).disabled = true;
      try {
        await queueWrite(`accounts/${id}`, () => state.db.doc(`accounts/${id}`).set(data));
        if (!state.accounts.find((a) => a.id === id)) state.accounts.push({ id, ...data });
        selectAccount(id);
        closeSheet();
        toast(`Welcome, ${name}`);
      } catch { $("#naCreate", body).disabled = false; }
    });
  },

  add(body) {
    $("#sheetTitle").textContent = "Log a meal";
    renderMealTabs(true);
    const cats = ["All", ...new Set(window.SG_FOODS.map((f) => f.category))];
    if ((account()?.customFoods || []).length) cats.splice(1, 0, "My foods");
    if (!cats.includes(activeCategory)) activeCategory = "All";
    body.innerHTML = `
      <div class="modes">
        <button class="mode" data-act="scan">${ICON.camera}<b>Photo scan</b><span>Snap your food or its nutrition label</span></button>
        <button class="mode" data-act="custom">${ICON.pen}<b>Manual entry</b><span>Type in calories and macros</span></button>
      </div>
      <div class="search">${ICON.search}<input id="q" type="search" placeholder="Search SG food, drinks, brands" autocomplete="off" enterkeyhint="search" aria-label="Search foods"></div>
      <div class="chips" id="chips">${cats.map((c) => `<button data-cat="${esc(c)}" class="${c === activeCategory ? "on" : ""}">${esc(c)}</button>`).join("")}</div>
      <div id="resultsWrap"></div>`;
    const input = $("#q", body);
    const update = () => renderResults(input.value);
    input.addEventListener("input", update);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    $("#chips", body).addEventListener("click", (e) => {
      const b = e.target.closest("[data-cat]");
      if (!b) return;
      activeCategory = b.dataset.cat;
      body.querySelectorAll("#chips button").forEach((x) => x.classList.toggle("on", x === b));
      update();
    });
    update();
  },

  detail(body, food) {
    $("#sheetTitle").textContent = "Add to " + mealName(sheet.meal);
    renderMealTabs(true);
    body.innerHTML = `
      <div class="detail-card">
        <h4>${esc(food.name)}</h4>
        <div class="src">${esc(food.serving)} · ${esc(food.source || food.category || "")}</div>
        <div class="big-kcal"><span id="dk">${fmt(food.kcal)}</span> <small>kcal</small></div>
        <div class="macro-row" id="dm"></div>
        <div class="qty">
          <span class="q-label">Servings</span>
          <div class="stepper">
            <button data-step="-0.5" aria-label="Fewer servings">−</button>
            <input id="qty" type="number" inputmode="decimal" min="0.1" step="0.5" value="1" aria-label="Servings">
            <button data-step="0.5" aria-label="More servings">+</button>
          </div>
        </div>
        <button class="primary" id="addBtn">Add to ${mealName(sheet.meal)}</button>
      </div>
      ${food.estimate ? '<p class="note">These numbers are an AI estimate from your photo. Change the servings if your portion was bigger or smaller.</p>' : ""}`;
    const qty = $("#qty", body);
    const paint = () => {
      const q = num(qty.value);
      $("#dk", body).textContent = fmt(food.kcal * q);
      $("#dm", body).innerHTML = [["Protein", food.protein, "g"], ["Carbs", food.carbs, "g"], ["Fat", food.fat, "g"], ["Sugar", food.sugar, "g"], ["Sodium", food.sodium, "mg"]]
        .map(([k, v, u]) => `<div><div class="k">${k}</div><div class="v">${fmt(num(v) * q)}${u === "g" ? "g" : ""}</div></div>`).join("");
    };
    body.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => { qty.value = Math.max(0.5, r1(num(qty.value) + num(b.dataset.step))); paint(); }));
    qty.addEventListener("input", paint);
    $("#addBtn", body).addEventListener("click", () => {
      const q = num(qty.value);
      if (q <= 0) return toast("Enter how many servings");
      addEntry(sheet.meal, food, q);
      closeSheet();
      toast(`Added to ${mealName(sheet.meal)}`);
    });
    paint();
  },

  custom(body, prefill = {}) {
    $("#sheetTitle").textContent = "Manual entry";
    renderMealTabs(true);
    const f = (id, label, val, cls = "", text = false) => `<div class="field ${cls}"><label for="${id}">${label}</label><input id="${id}" ${text ? 'type="text"' : 'type="number" inputmode="decimal" min="0" step="any"'} value="${esc(val ?? "")}"></div>`;
    body.innerHTML = `
      <div class="form">
        ${f("cName", "Food name", prefill.name, "full", true)}
        ${f("cServing", "Serving (e.g. 1 plate)", prefill.serving || "1 serving", "full", true)}
        ${f("cKcal", "Calories (kcal)", prefill.kcal)}
        ${f("cProtein", "Protein (g)", prefill.protein)}
        ${f("cCarbs", "Carbs (g)", prefill.carbs)}
        ${f("cFat", "Fat (g)", prefill.fat)}
        ${f("cSugar", "Sugar (g)", prefill.sugar)}
        ${f("cSodium", "Sodium (mg)", prefill.sodium)}
      </div>
      <label class="check"><input type="checkbox" id="cSave" checked> Save to My foods for next time</label>
      <button class="primary" id="cAdd">Add to ${mealName(sheet.meal)}</button>`;
    $("#cAdd", body).addEventListener("click", () => {
      const v = (id) => $("#" + id, body).value.trim();
      const name = v("cName");
      if (!name) return toast("Give the food a name");
      if (v("cKcal") === "") return toast("Enter the calories");
      const food = compactFood({ name, serving: v("cServing") || "1 serving", category: "My foods", source: "My foods",
        kcal: v("cKcal"), protein: v("cProtein"), carbs: v("cCarbs"), fat: v("cFat"), sugar: v("cSugar"), sodium: v("cSodium") });
      if ($("#cSave", body).checked && account()) {
        const customFoods = [food, ...(account().customFoods || []).filter((c) => c.name.toLowerCase() !== name.toLowerCase())].slice(0, 300);
        updateAccount({ customFoods }).catch(() => {});
      }
      addEntry(sheet.meal, food, 1);
      closeSheet();
      toast(`Added to ${mealName(sheet.meal)}`);
    });
  },

  scan(body, st) {
    $("#sheetTitle").textContent = "Photo scan";
    renderMealTabs(true);
    let html = st.img ? `<img class="scan-preview" src="${st.img}" alt="Your photo">` : "";
    if (st.status === "working") {
      html += `<div class="spinner"></div><p class="muted">${esc(st.msg || "Looking at your photo…")}</p>`;
    } else if (st.status === "error") {
      html += `<p class="muted">${esc(st.error)}</p>${state.sampleLimits?.images ? '<button class="primary" data-act="scan">Try another photo</button>' : ""}<button class="secondary" data-act="back-search">Search instead</button>`;
    } else if (st.status === "done") {
      pickList = st.items;
      html += `<div class="section-label">${st.items.length ? "Found in your photo" : "Nothing recognised"}</div>`;
      html += st.items.map((f, i) => `
        <label class="ai-item"><input type="checkbox" data-ai="${i}" checked>
          <div class="r-main"><div class="r-name">${esc(f.name)}</div>
          <div class="r-meta">${esc(f.serving)} · P ${fmt(f.protein)}g · C ${fmt(f.carbs)}g · F ${fmt(f.fat)}g · S ${fmt(f.sugar)}g${f.confidence ? ` · ${esc(f.confidence)} confidence` : ""}</div></div>
          <div class="r-kcal">${fmt(f.kcal)} kcal</div></label>`).join("");
      if (st.note) html += `<p class="note">${esc(st.note)}</p>`;
      if (st.items.length) html += `<button class="primary" id="aiAdd">Add selected to ${mealName(sheet.meal)}</button><button class="secondary" data-act="ai-edit">Edit the first item</button>`;
      html += `<button class="secondary" data-act="scan">Retake photo</button>`;
    }
    body.innerHTML = html;
    $("#aiAdd", body)?.addEventListener("click", () => {
      const chosen = [...body.querySelectorAll("[data-ai]")].filter((c) => c.checked).map((c) => st.items[+c.dataset.ai]);
      if (!chosen.length) return toast("Pick at least one item");
      chosen.forEach((f) => addEntry(sheet.meal, f, 1));
      closeSheet();
      toast(`Added ${chosen.length} item${chosen.length > 1 ? "s" : ""} to ${mealName(sheet.meal)}`);
    });
  },

  settings(body) {
    const a = account();
    $("#sheetTitle").textContent = `Settings for ${a.name}`;
    renderMealTabs(false);
    const g = goals();
    const f = (id, label, val, cls = "", text = false) => `<div class="field ${cls}"><label for="${id}">${label}</label><input id="${id}" ${text ? 'type="text"' : 'type="number" inputmode="decimal" min="0"'} value="${esc(val)}"></div>`;
    const linked = state.myId && (a.linkedUsers || []).includes(state.myId);
    body.innerHTML = `
      <button class="secondary" style="margin-top:0" data-act="accounts">Switch or add account</button>
      <div class="section-label">Account</div>
      <div class="form">${f("sName", "Name", a.name, "full", true)}</div>
      ${state.myId ? `<label class="check"><input type="checkbox" id="sLink"${linked ? " checked" : ""}> Open this account automatically when I use the tracker on any phone or computer</label>` : ""}
      <div class="section-label">Daily goals</div>
      <div class="form">
        ${f("gKcal", "Calories (kcal)", g.kcal)}
        ${f("gProtein", "Protein (g)", g.protein)}
        ${f("gCarbs", "Carbs (g)", g.carbs)}
        ${f("gFat", "Fat (g)", g.fat)}
        ${f("gSugar", "Sugar (g)", g.sugar)}
        ${f("gSodium", "Sodium (mg)", g.sodium)}
      </div>
      <p class="note">HPB's guide for adults is under about 40–50g of added sugar and under 2,000mg of sodium a day.</p>
      <button class="primary" id="saveSettings">Save</button>
      <div class="section-label">This day</div>
      <button class="secondary danger" id="clearDay">Clear everything logged on ${state.selectedDate.toLocaleDateString("en-SG", { day: "numeric", month: "short" })}</button>
      <div class="section-label">Delete account</div>
      <button class="secondary danger" id="delAcct">Delete ${esc(a.name)}'s account and history</button>
      <p class="note">${window.SG_FOODS.length} Singapore foods built in. Values are typical portions from HPB and brand data; hawker portions vary by stall. ${state.mode === "local" ? "<b>This copy is saved on this device only.</b> Open the tracker inside Claude to sync between devices." : "Your log is saved online and syncs to every device you open the tracker on."}</p>`;
    $("#saveSettings", body).addEventListener("click", async () => {
      const v = (id) => num($("#" + id, body).value);
      const name = $("#sName", body).value.trim() || a.name;
      const patch = { name, goals: { kcal: v("gKcal") || 1800, protein: v("gProtein"), carbs: v("gCarbs"), fat: v("gFat"), sugar: v("gSugar"), sodium: v("gSodium") } };
      const link = $("#sLink", body);
      if (link) {
        const others = (a.linkedUsers || []).filter((x) => x !== state.myId);
        patch.linkedUsers = link.checked ? [...others, state.myId] : others;
      }
      try { await updateAccount(patch); renderAll(); closeSheet(); toast("Saved"); } catch { /* toast already shown */ }
    });
    armButton($("#clearDay", body), "Tap again to clear this day", async () => {
      const empty = Object.fromEntries(MEALS.map((m) => [m.id, []]));
      await writeDay(ymd(state.selectedDate), empty).catch(() => {});
      closeSheet(); toast("Day cleared");
    });
    armButton($("#delAcct", body), `Tap again to delete ${a.name} for good`, async () => {
      try {
        for (const unsub of state.monthSubs.values()) unsub();
        state.monthSubs.clear();
        const months = await state.db.collection(`accounts/${a.id}/months`).get();
        for (const d of months.docs) await state.db.doc(`accounts/${a.id}/months/${d.id}`).delete();
        await state.db.doc(`accounts/${a.id}`).delete();
        state.accounts = state.accounts.filter((x) => x.id !== a.id);
        state.accountId = null;
        lsSet("gct.lastAccount", null);
        renderAll();
        openSheet(null, "accounts");
        toast("Account deleted");
      } catch { toast("Couldn't delete the account. Try again."); }
    });
  },

  chat(body, prefill) { renderChat(body, prefill); },
};

// Two-step confirm (the viewer can't show confirm() dialogs).
function armButton(btn, armedText, action) {
  const label = btn.textContent;
  let timer;
  btn.addEventListener("click", () => {
    if (!btn.classList.contains("armed")) {
      btn.classList.add("armed"); btn.textContent = armedText;
      timer = setTimeout(() => { btn.classList.remove("armed"); btn.textContent = label; }, 4000);
      return;
    }
    clearTimeout(timer);
    btn.disabled = true;
    action();
  });
}

// ---------- Photo scan (Claude reads the photo) ----------
let scanState = {};
function setScan(patch) {
  scanState = { ...scanState, ...patch };
  const top = sheet.stack[sheet.stack.length - 1];
  if (top && top[0] === "scan") show("scan", scanState, false);
}

function startScan() {
  if (!state.sample || !state.sampleLimits?.images) {
    if (!sheetOpen()) openSheet(sheet.meal, "add");
    scanState = { status: "error", error: state.sample
      ? "Photo recognition isn't available on this device. Search for the food or enter it manually."
      : "Photo recognition works when the tracker is opened inside Claude. Search for the food or enter it manually." };
    show("scan", scanState);
    return;
  }
  const input = $("#cameraInput");
  input.value = "";
  input.click();
}

const SCAN_PROMPT = `You are a nutrition assistant for someone living in Singapore.
Identify each distinct food or drink in this photo and estimate the nutrition for the portion actually shown.
Use Singapore names where they apply (e.g. "Chicken Rice (roasted)", "Kopi C", "Char Kway Teow") and typical Singapore hawker or retail portions, consistent with Health Promotion Board food composition data.
If the photo shows a packaged product or a nutrition label, read the label values for one serving.
Reply with only a JSON object in this shape:
{"items":[{"name":"Chicken Rice (roasted)","serving":"1 plate (380g)","kcal":680,"protein":30,"carbs":75,"fat":28,"sugar":2,"sodium":1300,"confidence":"high"}],"note":"one short sentence on anything to double-check, or an empty string"}
kcal in kcal, sodium in mg, everything else in grams; confidence is high, medium or low.
If there is no food or drink in the photo, return an empty items array and say so in note.`;

async function handlePhoto(file) {
  if (!file) return;
  if (!sheetOpen()) openSheet(sheet.meal, "add");
  scanState = { status: "working", img: URL.createObjectURL(file), msg: "Recognising your food…" };
  show("scan", scanState);
  try {
    const res = await state.sample.json(SCAN_PROMPT, { images: [file], cache: false });
    const items = (Array.isArray(res?.items) ? res.items : []).filter((it) => it && it.name).map((it) => ({
      ...compactFood({ ...it, category: "Photo scan", source: "AI estimate" }), confidence: String(it.confidence || ""), estimate: true,
    }));
    setScan({ status: "done", items, note: typeof res?.note === "string" ? res.note : "" });
  } catch (e) {
    const msg = {
      not_granted: "Photo recognition needs your permission to use Claude. Search for the food or enter it manually.",
      rate_limited: "Too many requests right now. Try again in a minute.",
      image_rejected: "That photo couldn't be read. Try a clearer JPEG or PNG photo.",
      refused: "Claude couldn't analyse this photo. Try another one.",
      invalid_json: "The result came back in the wrong format. Try again.",
    }[e?.code] || "Something went wrong. Try again, or search for the food instead.";
    setScan({ status: "error", error: msg });
  }
}

// ---------- Assistant (chat) ----------
const chat = { turns: [], ctl: null, busy: false, status: "" };

function md(text) {
  const lines = esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split("\n");
  let html = "", list = false;
  for (const raw of lines) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)/);
    if (bullet) { if (!list) { html += "<ul>"; list = true; } html += `<li>${bullet[1]}</li>`; continue; }
    if (list) { html += "</ul>"; list = false; }
    if (line) html += `<p>${line.replace(/^#+\s*/, "")}</p>`;
  }
  return html + (list ? "</ul>" : "");
}

function renderChat(body, prefill) {
  $("#sheetTitle").textContent = "Ask about your food";
  renderMealTabs(false);
  const a = account();
  const msgs = chat.turns.map((t) => `<div class="msg ${t.role === "user" ? "user" : "bot"}">${t.role === "user" ? esc(t.content) : md(t.content)}</div>`).join("");
  const suggestions = ["What did I eat this past week?", "How many bubble teas have I had this month?", "What should I eat for dinner?", "Which day this month had the most sugar?"];
  body.innerHTML = `<div class="chat" id="chatLog">
    ${!chat.turns.length ? `<div class="msg bot"><p>Hi ${esc(a?.name || "")}! I can look through your food log, from today back to 10 years ago, and suggest what to eat next. Try one of these:</p></div>
      <div class="suggest">${suggestions.map((s) => `<button data-suggest="${esc(s)}">${esc(s)}</button>`).join("")}</div>` : msgs}
    ${chat.busy ? `<div class="msg bot" id="liveMsg"><p>${esc(chat.status || "Thinking…")}</p></div>` : ""}
  </div>
  ${!state.sample ? '<p class="note">The assistant works when the tracker is opened inside Claude.</p>' : ""}`;
  const foot = $("#sheetFoot");
  foot.hidden = false;
  foot.innerHTML = `<form class="chat-input" id="chatForm">
    <textarea id="chatText" rows="1" placeholder="Ask about what you've eaten" aria-label="Message">${esc(prefill || "")}</textarea>
    <button class="send${chat.busy ? " stop" : ""}" id="chatSend" type="${chat.busy ? "button" : "submit"}" aria-label="${chat.busy ? "Stop" : "Send"}">${chat.busy ? ICON.stop : ICON.send}</button>
  </form>`;
  const ta = $("#chatText");
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#chatForm").requestSubmit(); } });
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(120, ta.scrollHeight) + "px"; });
  $("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); sendChat(ta.value); });
  $("#chatSend").addEventListener("click", () => { if (chat.busy) chat.ctl?.abort(); });
  body.scrollTop = body.scrollHeight;
}

function refreshChat() {
  const top = sheet.stack[sheet.stack.length - 1];
  if (sheetOpen() && top && top[0] === "chat") renderChat($("#sheetBody"), $("#chatText")?.value || "");
}

function setLive(text) {
  const live = $("#liveMsg");
  if (live) { live.innerHTML = md(text); $("#sheetBody").scrollTop = $("#sheetBody").scrollHeight; }
}

function entryRow(date, meal, e) {
  const q = num(e.qty) || 1;
  return { date, meal, food: e.name, servings: r1(q), kcal: r0(num(e.kcal) * q), protein: r1(num(e.protein) * q), carbs: r1(num(e.carbs) * q),
    fat: r1(num(e.fat) * q), sugar: r1(num(e.sugar) * q), sodium: r0(num(e.sodium) * q) };
}

function clampRange(input) {
  const today = todayKey();
  const min = new Date(); min.setFullYear(min.getFullYear() - HISTORY_YEARS);
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
  let start = ok(input.start_date) ? String(input.start_date) : today;
  let end = ok(input.end_date) ? String(input.end_date) : today;
  if (start > end) [start, end] = [end, start];
  if (start < ymd(min)) start = ymd(min);
  if (end > today) end = today;
  return [start, end];
}

const CHAT_TOOLS = [
  {
    name: "get_food_log",
    description: "Returns what this person logged between two dates (inclusive, YYYY-MM-DD). Up to 45 days returns every food with its meal and nutrition; longer ranges return daily totals and the foods eaten each day. Days with nothing logged are left out.",
    inputSchema: { type: "object", properties: { start_date: { type: "string" }, end_date: { type: "string" } }, required: ["start_date", "end_date"] },
    async execute(input) {
      const [start, end] = clampRange(input);
      setLive(`Reading your log from ${start} to ${end}…`);
      const days = await loadRange(start, end);
      const span = (parseYmd(end) - parseYmd(start)) / 86400000 + 1;
      const logged = days.filter(([, d]) => MEALS.some((m) => (d[m.id] || []).length));
      if (span <= 45) {
        const rows = logged.flatMap(([date, d]) => MEALS.flatMap((m) => (d[m.id] || []).map((e) => entryRow(date, m.id, e))));
        return JSON.stringify({ start, end, days_logged: logged.length, entries: rows }).slice(0, 30000);
      }
      const out = logged.map(([date, d]) => {
        const all = MEALS.flatMap((m) => d[m.id] || []);
        const t = totalsOf(all);
        return { date, kcal: r0(t.kcal), protein: r0(t.protein), carbs: r0(t.carbs), fat: r0(t.fat), sugar: r0(t.sugar), foods: all.map((e) => e.name).join("; ") };
      });
      let json = JSON.stringify({ start, end, days_logged: out.length, days: out });
      if (json.length > 30000) json = JSON.stringify({ start, end, days_logged: out.length, note: "Too long to list foods; showing totals only. Use count_food for specific foods.", days: out.map(({ foods, ...rest }) => rest) }).slice(0, 30000);
      return json;
    },
  },
  {
    name: "count_food",
    description: "Counts how many times foods matching any of the keywords were logged between two dates, and returns the occurrences (date, meal, food, kcal, sugar). Matching is case-insensitive on the food name, so pass several variants, e.g. for bubble tea: [\"bubble tea\",\"milk tea\",\"boba\",\"brown sugar\",\"pearl\"].",
    inputSchema: { type: "object", properties: { keywords: { type: "array", items: { type: "string" } }, start_date: { type: "string" }, end_date: { type: "string" } }, required: ["keywords", "start_date", "end_date"] },
    async execute(input) {
      const [start, end] = clampRange(input);
      const kws = (Array.isArray(input.keywords) ? input.keywords : [input.keywords]).map((k) => String(k).toLowerCase().trim()).filter(Boolean);
      if (!kws.length) throw new Error("Give at least one keyword");
      setLive(`Searching your log for ${kws[0]}…`);
      const days = await loadRange(start, end);
      const hits = [];
      for (const [date, d] of days) for (const m of MEALS) for (const e of d[m.id] || []) {
        if (kws.some((k) => String(e.name).toLowerCase().includes(k))) hits.push(entryRow(date, m.id, e));
      }
      return JSON.stringify({ start, end, times: hits.length, total_servings: r1(hits.reduce((s, h) => s + h.servings, 0)),
        total_kcal: r0(hits.reduce((s, h) => s + h.kcal, 0)), total_sugar_g: r0(hits.reduce((s, h) => s + h.sugar, 0)), occurrences: hits.slice(-80) });
    },
  },
  {
    name: "search_sg_foods",
    description: "Searches the tracker's Singapore food list (hawker dishes, kopitiam drinks, fast food, bubble tea, supermarket brands) and returns foods with nutrition per serving. Use it to recommend foods; filter with max_kcal and min_protein.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Words in the food name, or empty for any" }, max_kcal: { type: "number" }, min_protein: { type: "number" }, category: { type: "string", description: "Optional, e.g. Hawker, Fast Food, Drinks, Bubble Tea, Japanese" } } },
    async execute(input) {
      const q = String(input.query || "");
      let list = q ? searchFoods(q, "All", 400) : allFoods();
      if (input.category) list = list.filter((f) => f.category.toLowerCase() === String(input.category).toLowerCase());
      if (input.max_kcal != null) list = list.filter((f) => f.kcal <= num(input.max_kcal));
      if (input.min_protein != null) list = list.filter((f) => f.protein >= num(input.min_protein));
      if (!q) list = [...list].sort((a, b) => b.protein / Math.max(b.kcal, 1) - a.protein / Math.max(a.kcal, 1));
      return JSON.stringify(list.slice(0, 30).map((f) => ({ name: f.name, category: f.category, serving: f.serving, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, sugar: f.sugar, sodium: f.sodium })));
    },
  },
];

function chatRules() {
  const a = account();
  const g = goals();
  const today = todayKey();
  const t = dayTotals(today);
  const day = dayData(today);
  const todayFoods = MEALS.map((m) => `${m.name}: ${day[m.id].map((e) => `${e.name}${num(e.qty) !== 1 ? ` x${r1(num(e.qty))}` : ""} (${r0(e.kcal * e.qty)} kcal)`).join(", ") || "nothing yet"}`).join("\n");
  const plan = planNextMeal();
  return `You are the assistant inside "Grace's Calorie Tracker", a food diary app for people living in Singapore. You are talking with ${a?.name || "the user"}.
Today is ${new Date().toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} (${today}). Weeks start on Sunday.
Daily goals: ${g.kcal} kcal, protein ${g.protein}g, carbs ${g.carbs}g, fat ${g.fat}g, sugar ${g.sugar}g, sodium ${g.sodium}mg.
Today so far: ${r0(t.kcal)} kcal, protein ${r0(t.protein)}g, carbs ${r0(t.carbs)}g, fat ${r0(t.fat)}g, sugar ${r0(t.sugar)}g, sodium ${r0(t.sodium)}mg.
${todayFoods}
Next meal: ${mealName(plan.next)}, with about ${Math.max(0, plan.remaining)} kcal left today.

How to answer:
- For any question about past eating, call get_food_log or count_food with the right date range. Never guess what was eaten. History goes back up to 10 years.
- For "how many times" questions, use count_food with several name variants.
- To recommend food, call search_sg_foods and pick local options that fit the calories left and the protein still needed. Give kcal for each pick.
- Keep answers short and friendly: the direct answer first, then a few bullet points if useful. Use **bold** for key numbers. No tables or headings.
- If nothing was logged in a period, say so plainly.
- You can't add or change log entries. If asked, tell the person to use the Scan or Manual buttons.`;
}

async function sendChat(text) {
  const msg = String(text || "").trim();
  if (!msg || chat.busy) return;
  if (!state.sample) { toast("The assistant works when the tracker is opened inside Claude."); return; }
  chat.turns.push({ role: "user", content: msg });
  chat.busy = true; chat.status = "Thinking…";
  chat.ctl = new AbortController();
  refreshChat();
  if ($("#chatText")) $("#chatText").value = "";
  const history = chat.turns.slice(-12);
  const useTools = !!state.sampleLimits?.tools;
  try {
    const { text: answer } = await state.sample([{ role: "user", content: chatRules() }, ...history], {
      cache: false, signal: chat.ctl.signal,
      ...(useTools ? { tools: CHAT_TOOLS } : {}),
      onText: ({ text: t }) => setLive(t),
    });
    chat.turns.push({ role: "assistant", content: answer });
  } catch (e) {
    const msgFor = {
      cancelled: e?.text || "Stopped.",
      not_granted: "The assistant needs your permission to use Claude. Allow it when asked, then try again.",
      rate_limited: "I've hit a usage limit for now. Try again in a little while.",
      refused: "I can't help with that one. Try asking another way.",
      prompt_too_large: "That was too much to read at once. Ask about a shorter period.",
    };
    chat.turns.push({ role: "assistant", content: msgFor[e?.code] || (e?.text ? e.text + "\n\n(The answer was cut off. Try again.)" : "Something went wrong. Try again.") });
  } finally {
    chat.busy = false; chat.status = ""; chat.ctl = null;
    refreshChat();
  }
}

// ---------- Events ----------
$("#days").addEventListener("click", (e) => {
  const b = e.target.closest("[data-date]");
  if (!b) return;
  state.selectedDate = parseYmd(b.dataset.date);
  renderAll();
});
$("#prevWeek").addEventListener("click", () => { state.selectedDate.setDate(state.selectedDate.getDate() - 7); renderAll(); });
$("#nextWeek").addEventListener("click", () => { state.selectedDate.setDate(state.selectedDate.getDate() + 7); renderAll(); });
$("#dateJump").addEventListener("change", (e) => { if (e.target.value) { state.selectedDate = parseYmd(e.target.value); renderAll(); } });
$("#accountBtn").addEventListener("click", () => openSheet(null, account() ? "settings" : "accounts"));

$("#meals").addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  if (add) return openSheet(add.dataset.add, "add");
  const del = e.target.closest("[data-del]");
  if (del) { const [m, id] = del.dataset.del.split(":"); removeEntry(m, id); }
});
$("#recs").addEventListener("click", (e) => {
  const r = e.target.closest("[data-rec]");
  if (r) { openSheet(state.recPlan?.next, "detail", state.recList[+r.dataset.rec]); return; }
  if (e.target.closest("#askPick")) openSheet(null, "chat", `What should I eat for ${mealName(state.recPlan?.next || "dinner").toLowerCase()}?`);
});

$("#fabScan").addEventListener("click", () => {
  if (!account()) return openSheet(null, "accounts");
  sheet.meal = ymd(state.selectedDate) === todayKey() ? mealForNow() : sheet.meal;
  startScan();
});
$("#fabManual").addEventListener("click", () => openSheet(null, "add"));
$("#fabAsk").addEventListener("click", () => openSheet(null, "chat", ""));
$("#cameraInput").addEventListener("change", (e) => handlePhoto(e.target.files[0]));

$("#scrim").addEventListener("click", closeSheet);
$("#sheetClose").addEventListener("click", closeSheet);
$("#sheetBack").addEventListener("click", back);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

$("#mealTabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-meal]");
  if (!b) return;
  sheet.meal = b.dataset.meal;
  const top = sheet.stack[sheet.stack.length - 1];
  show(top[0], top[0] === "scan" ? scanState : top[1], false);
});

$("#sheetBody").addEventListener("click", (e) => {
  const pick = e.target.closest("[data-pick]");
  if (pick) return show("detail", pickList[+pick.dataset.pick]);
  const acct = e.target.closest("[data-account]");
  if (acct) { selectAccount(acct.dataset.account); closeSheet(); toast(`Switched to ${account()?.name || "account"}`); return; }
  const sug = e.target.closest("[data-suggest]");
  if (sug) return sendChat(sug.dataset.suggest);
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  if (act === "scan") startScan();
  else if (act === "custom") show("custom", {});
  else if (act === "custom-q") show("custom", { name: $("#q")?.value || "" });
  else if (act === "settings") show("settings");
  else if (act === "accounts") show("accounts");
  else if (act === "new-account") show("newAccount");
  else if (act === "back-search") { sheet.stack = []; show("add"); }
  else if (act === "ai-edit") show("custom", pickList[0]);
});

// ---------- Boot ----------
async function boot() {
  renderAll(false);
  const claude = window.claude;
  let db = null, user = null, sample = null;
  if (claude?.use) [db, user, sample] = await Promise.all([claude.use("db"), claude.use("user"), claude.use("sample")]);
  if (db) {
    state.db = db; state.mode = "cloud";
    try { state.myId = (await user?.id()) || null; } catch { state.myId = null; }
  } else {
    state.db = createLocalDb(); state.mode = "local";
    showBanner(claude?.use
      ? "You're signed out of Claude, so this is saved on this device only. Sign in to sync between devices."
      : "Saved on this device only. Open the tracker inside Claude to sync between devices.");
  }
  state.sample = sample;
  if (sample) { try { state.sampleLimits = await sample.limits(); } catch { state.sampleLimits = null; } }
  subscribeAccounts();
}
boot();
})();
