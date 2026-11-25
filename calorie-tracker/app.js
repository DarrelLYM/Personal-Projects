// Food Log: a calorie tracker for food sold in Singapore.
// All data stays on this device (localStorage).

const MEALS = [
  { id: "breakfast", name: "Breakfast" },
  { id: "lunch", name: "Lunch" },
  { id: "dinner", name: "Dinner" },
  { id: "supper", name: "Supper" },
];
const NUTRIENTS = [
  { id: "kcal", short: "Cal", label: "Calories", unit: "kcal" },
  { id: "protein", short: "P", label: "Protein", unit: "g" },
  { id: "carbs", short: "C", label: "Carbs", unit: "g" },
  { id: "fat", short: "F", label: "Fat", unit: "g" },
  { id: "sugar", short: "S", label: "Sugar", unit: "g" },
];
const DEFAULT_GOALS = { kcal: 2000, protein: 100, carbs: 250, fat: 65, sugar: 40, sodium: 2000 };
const AI_MODEL = "claude-opus-5-5";
const SDK_URL = "./vendor/anthropic-sdk.js";
const ZXING_URL = "./vendor/zxing.js";

// ---------- Storage ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast("Couldn't save. Storage may be full or blocked."); }
  },
};

let settings = Object.assign({ goals: { ...DEFAULT_GOALS }, apiKey: "" }, store.get("fl.settings", {}));
settings.goals = Object.assign({ ...DEFAULT_GOALS }, settings.goals);
let logs = store.get("fl.logs", {});        // { "2026-11-25": { breakfast: [entry], ... } }
let recents = store.get("fl.recents", []);  // [food]
let customFoods = store.get("fl.custom", []);

const saveSettings = () => store.set("fl.settings", settings);
const saveLogs = () => store.set("fl.logs", logs);
const saveRecents = () => store.set("fl.recents", recents.slice(0, 30));
const saveCustom = () => store.set("fl.custom", customFoods);

// ---------- Helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const r0 = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;
const fmt = (n) => (n >= 100 ? r0(n) : r1(n)).toLocaleString();
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

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
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

const ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
};

// ---------- Date / week state ----------
let selectedDate = new Date();
selectedDate.setHours(0, 0, 0, 0);

function dayLog(dateKey = ymd(selectedDate)) {
  return logs[dateKey] || {};
}

function dayTotals(dateKey) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, sodium: 0 };
  const d = dayLog(dateKey);
  for (const m of MEALS) for (const e of d[m.id] || []) for (const k in t) t[k] += num(e[k]) * num(e.qty || 1);
  return t;
}

function mealTotals(entries) {
  return entries.reduce((a, e) => a + num(e.kcal) * num(e.qty || 1), 0);
}

// ---------- Rendering: header ----------
function renderWeek() {
  const start = new Date(selectedDate);
  start.setDate(start.getDate() - start.getDay()); // Sunday
  const todayKey = ymd(new Date());
  const selKey = ymd(selectedDate);
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let html = "";
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = ymd(d);
    const has = MEALS.some((m) => (logs[key]?.[m.id] || []).length);
    html += `<button class="day${key === selKey ? " sel" : ""}${key === todayKey ? " today" : ""}" data-date="${key}">
      <span class="dow">${dows[i]}</span><span class="dnum">${d.getDate()}</span>${has ? '<span class="dot"></span>' : ""}
    </button>`;
  }
  $("#days").innerHTML = html;
  const isToday = selKey === todayKey;
  $("#title").textContent = isToday ? "Food Log" : selectedDate.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
}

function renderBars() {
  const t = dayTotals(ymd(selectedDate));
  $("#bars").innerHTML = NUTRIENTS.map((n) => {
    const goal = num(settings.goals[n.id]) || 1;
    const pct = Math.min(100, (t[n.id] / goal) * 100);
    const over = t[n.id] > goal;
    return `<div class="bar ${n.id === "kcal" ? "cal" : ""}${over ? " over" : ""}" title="${n.label}">
      <div class="track"><div class="fill" style="width:${pct}%"></div></div>
      <div class="lbl"><b>${n.short}</b> ${r0(t[n.id]).toLocaleString()}${n.unit === "g" ? "g" : ""}</div><div class="lbl goal">of ${r0(goal).toLocaleString()}${n.unit === "g" ? "g" : ""}</div>
    </div>`;
  }).join("");
}

// ---------- Rendering: meals ----------
function renderMeals() {
  const d = dayLog();
  const now = ymd(selectedDate) === ymd(new Date()) ? mealForNow() : null;
  $("#meals").innerHTML = MEALS.map((m) => {
    const entries = d[m.id] || [];
    const kcal = mealTotals(entries);
    const sub = entries.length ? `${fmt(kcal)} kcal · ${entries.length} item${entries.length > 1 ? "s" : ""}` : "Optional · tap + to log";
    return `<div class="meal${m.id === now ? " suggest" : ""}">
      <div class="meal-head">
        <div class="meal-title"><h2>${m.name}</h2><div class="sub">${sub}</div></div>
        <button class="add-btn" data-add="${m.id}" aria-label="Add to ${m.name}">${ICON.plus}</button>
      </div>
      ${entries.length ? `<ul class="entries">${entries.map((e) => `
        <li class="entry">
          <div class="e-main">
            <div class="e-name">${esc(e.name)}</div>
            <div class="e-meta">${e.qty !== 1 ? `${r1(e.qty)} × ` : ""}${esc(e.serving)} · P ${fmt(e.protein * e.qty)}g · C ${fmt(e.carbs * e.qty)}g · F ${fmt(e.fat * e.qty)}g · S ${fmt(e.sugar * e.qty)}g</div>
          </div>
          <div class="e-kcal">${fmt(e.kcal * e.qty)}</div>
          <button class="e-del" data-del="${m.id}:${e.id}" aria-label="Remove ${esc(e.name)}">${ICON.trash}</button>
        </li>`).join("")}</ul>` : ""}
    </div>`;
  }).join("");
}

function renderSummary() {
  const t = dayTotals(ymd(selectedDate));
  const g = settings.goals;
  const remaining = g.kcal - t.kcal;
  const cells = [
    ["Calories", `${fmt(t.kcal)}`, `/ ${fmt(g.kcal)}`],
    [remaining >= 0 ? "Remaining" : "Over by", `${fmt(Math.abs(remaining))}`, "kcal"],
    ["Protein", `${fmt(t.protein)}`, `/ ${fmt(g.protein)}g`],
    ["Carbs", `${fmt(t.carbs)}`, `/ ${fmt(g.carbs)}g`],
    ["Fat", `${fmt(t.fat)}`, `/ ${fmt(g.fat)}g`],
    ["Sugar", `${fmt(t.sugar)}`, `/ ${fmt(g.sugar)}g`],
    ["Sodium", `${fmt(t.sodium)}`, `/ ${fmt(g.sodium)}mg`],
  ];
  $("#summary").innerHTML = `<h3>Day summary</h3><div class="grid">${cells.map(([k, v, s]) =>
    `<div class="cell"><div class="k">${k}</div><div class="v">${v} <small>${s}</small></div></div>`).join("")}</div>`;
}

function renderAll() {
  renderWeek();
  renderBars();
  renderMeals();
  renderSummary();
  $("#fabScanLabel").textContent = "Scan";
}

// ---------- Logging ----------
function addEntry(mealId, food, qty) {
  const key = ymd(selectedDate);
  logs[key] = logs[key] || {};
  logs[key][mealId] = logs[key][mealId] || [];
  const entry = {
    id: uid(),
    name: food.name,
    serving: food.serving || "1 serving",
    qty: num(qty) || 1,
    kcal: num(food.kcal), protein: num(food.protein), carbs: num(food.carbs),
    fat: num(food.fat), sugar: num(food.sugar), sodium: num(food.sodium),
    source: food.source || "",
  };
  logs[key][mealId].push(entry);
  saveLogs();
  // recents: dedupe by name+serving
  const rFood = { ...food, id: food.id || "r" + uid() };
  recents = [rFood, ...recents.filter((r) => !(r.name === food.name && r.serving === food.serving))].slice(0, 30);
  saveRecents();
  renderAll();
}

function removeEntry(mealId, id) {
  const key = ymd(selectedDate);
  const list = logs[key]?.[mealId];
  if (!list) return;
  logs[key][mealId] = list.filter((e) => e.id !== id);
  saveLogs();
  renderAll();
  toast("Removed");
}

// ---------- Sheet ----------
const sheet = { meal: mealForNow(), stack: [] };

function openSheet(mealId, view = "add") {
  sheet.meal = mealId || (ymd(selectedDate) === ymd(new Date()) ? mealForNow() : "lunch");
  sheet.stack = [];
  $("#scrim").classList.add("open");
  $("#sheet").classList.add("open");
  show(view);
}

function closeSheet() {
  $("#scrim").classList.remove("open");
  $("#sheet").classList.remove("open");
}

function renderMealTabs(visible) {
  const el = $("#mealTabs");
  el.classList.toggle("hidden", !visible);
  el.innerHTML = MEALS.map((m) => `<button data-meal="${m.id}" class="${m.id === sheet.meal ? "on" : ""}">${m.name}</button>`).join("");
}

function show(view, arg, push = true) {
  if (push) sheet.stack.push([view, arg]);
  $("#sheetBack").classList.toggle("hidden", sheet.stack.length < 2);
  const body = $("#sheetBody");
  body.scrollTop = 0;
  VIEWS[view](body, arg);
}

function back() {
  sheet.stack.pop();
  const [view, arg] = sheet.stack[sheet.stack.length - 1] || ["add"];
  show(view, arg, false);
}

// ---------- Search ----------
let activeCategory = "All";

function allFoods() {
  return [...customFoods, ...window.SG_FOODS];
}

function searchFoods(q) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  let list = allFoods();
  if (activeCategory !== "All") list = list.filter((f) => f.category === activeCategory);
  if (!tokens.length) return activeCategory === "All" ? [] : list;
  const scored = [];
  for (const f of list) {
    const hay = (f.name + " " + f.category).toLowerCase();
    if (!tokens.every((t) => hay.includes(t))) continue;
    const name = f.name.toLowerCase();
    const phrase = tokens.join(" ");
    const base = name.replace(/\s*\(.*?\)\s*/g, " ").trim();
    let score = 0;
    if (base === phrase) score += 10;
    if (name.includes(phrase)) score += 4;
    if (name.startsWith(tokens[0])) score += 3;
    if (new RegExp("\\b" + tokens[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(name)) score += 2;
    score -= base.length / 15;
    scored.push([score, f]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map((x) => x[1]).slice(0, 60);
}

function resultItem(f, idx) {
  return `<li><button class="result" data-pick="${idx}">
    <div class="r-main"><div class="r-name">${esc(f.name)}</div>
    <div class="r-meta">${esc(f.serving)} · P ${fmt(f.protein)}g · C ${fmt(f.carbs)}g · F ${fmt(f.fat)}g · S ${fmt(f.sugar)}g</div></div>
    <div class="r-kcal">${fmt(f.kcal)} kcal</div>
  </button></li>`;
}

let pickList = [];

const VIEWS = {
  add(body) {
    $("#sheetTitle").textContent = "Log a meal";
    renderMealTabs(true);
    const cats = ["All", ...new Set(window.SG_FOODS.map((f) => f.category))];
    body.innerHTML = `
      <div class="modes">
        <button class="mode" data-act="scan">${ICON.camera}<b>Photo scan</b><span>Snap your food or a barcode</span></button>
        <button class="mode" data-act="custom">${ICON.pen}<b>Manual entry</b><span>Type in calories &amp; macros</span></button>
      </div>
      <div class="search">${ICON.search}<input id="q" type="search" placeholder="Search SG food, drinks, brands…" autocomplete="off" enterkeyhint="search"></div>
      <div class="chips" id="chips">${cats.map((c) => `<button data-cat="${esc(c)}" class="${c === activeCategory ? "on" : ""}">${esc(c)}</button>`).join("")}</div>
      <div id="resultsWrap"></div>`;
    const input = body.querySelector("#q");
    const update = () => renderResults(input.value);
    input.addEventListener("input", update);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    body.querySelector("#chips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-cat]");
      if (!b) return;
      activeCategory = b.dataset.cat;
      body.querySelectorAll("#chips button").forEach((x) => x.classList.toggle("on", x === b));
      update();
    });
    update();
  },

  detail(body, food) {
    $("#sheetTitle").textContent = "Add to " + MEALS.find((m) => m.id === sheet.meal).name;
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
            <button data-step="-0.5" aria-label="Less">−</button>
            <input id="qty" type="number" inputmode="decimal" min="0.1" step="0.5" value="1">
            <button data-step="0.5" aria-label="More">+</button>
          </div>
        </div>
        <button class="primary" id="addBtn">Add to ${MEALS.find((m) => m.id === sheet.meal).name}</button>
      </div>
      ${food.estimate ? '<p class="note">These numbers are an AI estimate from your photo. Adjust the servings if your portion was bigger or smaller.</p>' : ""}`;
    const qty = body.querySelector("#qty");
    const paint = () => {
      const q = num(qty.value) || 0;
      body.querySelector("#dk").textContent = fmt(food.kcal * q);
      body.querySelector("#dm").innerHTML = [["Protein", food.protein, "g"], ["Carbs", food.carbs, "g"], ["Fat", food.fat, "g"], ["Sugar", food.sugar, "g"], ["Sodium", food.sodium, "mg"]]
        .map(([k, v, u]) => `<div><div class="k">${k}</div><div class="v">${fmt(num(v) * q)}${u === "g" ? "g" : ""}</div></div>`).join("");
    };
    body.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
      qty.value = Math.max(0.5, r1((num(qty.value) || 0) + num(b.dataset.step)));
      paint();
    }));
    qty.addEventListener("input", paint);
    body.querySelector("#addBtn").addEventListener("click", () => {
      const q = num(qty.value);
      if (q <= 0) return toast("Enter how many servings");
      addEntry(sheet.meal, food, q);
      closeSheet();
      toast(`Added to ${MEALS.find((m) => m.id === sheet.meal).name}`);
    });
    paint();
  },

  custom(body, prefill = {}) {
    $("#sheetTitle").textContent = "Manual entry";
    renderMealTabs(true);
    const f = (id, label, val, extra = "") => `<div class="field ${extra}"><label for="${id}">${label}</label><input id="${id}" ${id === "cName" || id === "cServing" ? 'type="text"' : 'type="number" inputmode="decimal" min="0" step="any"'} value="${esc(val ?? "")}"></div>`;
    body.innerHTML = `
      <div class="form">
        ${f("cName", "Food name", prefill.name, "full")}
        ${f("cServing", "Serving (e.g. 1 plate)", prefill.serving || "1 serving", "full")}
        ${f("cKcal", "Calories (kcal)", prefill.kcal)}
        ${f("cProtein", "Protein (g)", prefill.protein)}
        ${f("cCarbs", "Carbs (g)", prefill.carbs)}
        ${f("cFat", "Fat (g)", prefill.fat)}
        ${f("cSugar", "Sugar (g)", prefill.sugar)}
        ${f("cSodium", "Sodium (mg)", prefill.sodium)}
      </div>
      <label class="note" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="cSave" checked style="accent-color:var(--purple)"> Save to my foods for next time</label>
      <button class="primary" id="cAdd">Add to ${MEALS.find((m) => m.id === sheet.meal).name}</button>`;
    body.querySelector("#cAdd").addEventListener("click", () => {
      const v = (id) => body.querySelector("#" + id).value.trim();
      const name = v("cName");
      if (!name) return toast("Give the food a name");
      if (v("cKcal") === "") return toast("Enter the calories");
      const food = {
        id: "c" + uid(), name, serving: v("cServing") || "1 serving", category: "My foods", source: "My foods",
        kcal: num(v("cKcal")), protein: num(v("cProtein")), carbs: num(v("cCarbs")),
        fat: num(v("cFat")), sugar: num(v("cSugar")), sodium: num(v("cSodium")),
      };
      if (body.querySelector("#cSave").checked) {
        customFoods = [food, ...customFoods.filter((c) => c.name.toLowerCase() !== name.toLowerCase())];
        saveCustom();
      }
      addEntry(sheet.meal, food, 1);
      closeSheet();
      toast(`Added to ${MEALS.find((m) => m.id === sheet.meal).name}`);
    });
  },

  scan(body, state) {
    $("#sheetTitle").textContent = "Photo scan";
    renderMealTabs(true);
    const { img, status, items, error, note } = state;
    let html = img ? `<img class="scan-preview" src="${img}" alt="Your photo">` : "";
    if (status === "working") {
      html += `<div class="spinner"></div><p class="muted">${esc(state.msg || "Looking at your photo…")}</p>`;
    } else if (status === "error") {
      html += `<p class="muted">${esc(error)}</p>
        <button class="primary" data-act="scan">Try another photo</button>
        <button class="secondary" data-act="back-search">Search instead</button>`;
    } else if (status === "nokey") {
      html += `<p class="note">No barcode found in this photo. To recognise cooked food from a photo, the app uses Claude AI, which needs your own Anthropic API key. Add one in Settings.</p>
        <button class="primary" data-act="settings">Open Settings</button>
        <button class="secondary" data-act="scan">Try a barcode photo</button>
        <button class="secondary" data-act="back-search">Search instead</button>`;
    } else if (status === "done") {
      pickList = items;
      html += `<div class="section-label">${items.length ? "Found in your photo" : "Nothing recognised"}</div>`;
      html += items.map((f, i) => `
        <label class="ai-item">
          <input type="checkbox" data-ai="${i}" checked>
          <div class="r-main"><div class="r-name">${esc(f.name)}</div>
          <div class="r-meta">${esc(f.serving)} · P ${fmt(f.protein)}g · C ${fmt(f.carbs)}g · F ${fmt(f.fat)}g · S ${fmt(f.sugar)}g${f.confidence ? ` · ${esc(f.confidence)} confidence` : ""}</div></div>
          <div class="r-kcal">${fmt(f.kcal)} kcal</div>
        </label>`).join("");
      if (note) html += `<p class="note">${esc(note)}</p>`;
      if (items.length) {
        html += `<button class="primary" id="aiAdd">Add selected to ${MEALS.find((m) => m.id === sheet.meal).name}</button>
          <button class="secondary" data-act="ai-edit">Edit first item</button>`;
      }
      html += `<button class="secondary" data-act="scan">Retake photo</button>`;
    }
    body.innerHTML = html;
    const addBtn = body.querySelector("#aiAdd");
    if (addBtn) addBtn.addEventListener("click", () => {
      const chosen = [...body.querySelectorAll("[data-ai]")].filter((c) => c.checked).map((c) => items[+c.dataset.ai]);
      if (!chosen.length) return toast("Pick at least one item");
      chosen.forEach((f) => addEntry(sheet.meal, f, 1));
      closeSheet();
      toast(`Added ${chosen.length} item${chosen.length > 1 ? "s" : ""}`);
    });
  },

  settings(body) {
    $("#sheetTitle").textContent = "Settings";
    renderMealTabs(false);
    const g = settings.goals;
    const f = (id, label, val) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" inputmode="decimal" min="0" value="${esc(val)}"></div>`;
    body.innerHTML = `
      <div class="section-label">Daily goals</div>
      <div class="form">
        ${f("gKcal", "Calories (kcal)", g.kcal)}
        ${f("gProtein", "Protein (g)", g.protein)}
        ${f("gCarbs", "Carbs (g)", g.carbs)}
        ${f("gFat", "Fat (g)", g.fat)}
        ${f("gSugar", "Sugar (g)", g.sugar)}
        ${f("gSodium", "Sodium (mg)", g.sodium)}
      </div>
      <p class="note">Singapore HPB guide: adults should keep added sugar under about 40–50g and sodium under 2,000mg a day.</p>

      <div class="section-label">AI photo recognition</div>
      <div class="field"><label for="apiKey">Anthropic API key (optional)</label><input id="apiKey" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(settings.apiKey)}"></div>
      <p class="note">Barcode scanning works without a key. To recognise plated food (like chicken rice) from a photo, add an API key from <a href="https://platform.claude.com/" target="_blank" rel="noopener">platform.claude.com</a>. The key is stored only on this device and photos are sent only to Anthropic. Each scan costs a few cents of API usage.</p>

      <button class="primary" id="saveSettings">Save</button>

      <div class="section-label">Your data</div>
      <button class="secondary" id="exportData">Export backup (JSON)</button>
      <button class="secondary" id="importData">Import backup</button>
      <input type="file" id="importFile" accept="application/json" class="hidden">
      <button class="secondary" id="clearDay" style="color:var(--over)">Clear this day's log</button>
      <p class="note">${window.SG_FOODS.length} Singapore foods built in, plus live packaged-product lookup from Open Food Facts. Nutrition values are approximate; hawker portions vary by stall.</p>`;
    body.querySelector("#saveSettings").addEventListener("click", () => {
      const v = (id) => num(body.querySelector("#" + id).value);
      settings.goals = { kcal: v("gKcal") || 2000, protein: v("gProtein"), carbs: v("gCarbs"), fat: v("gFat"), sugar: v("gSugar"), sodium: v("gSodium") };
      settings.apiKey = body.querySelector("#apiKey").value.trim();
      saveSettings();
      renderAll();
      closeSheet();
      toast("Settings saved");
    });
    body.querySelector("#exportData").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify({ settings: { goals: settings.goals }, logs, customFoods }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `food-log-${ymd(new Date())}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    body.querySelector("#importData").addEventListener("click", () => body.querySelector("#importFile").click());
    body.querySelector("#importFile").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (data.logs) { logs = data.logs; saveLogs(); }
        if (data.customFoods) { customFoods = data.customFoods; saveCustom(); }
        if (data.settings?.goals) { settings.goals = Object.assign({ ...DEFAULT_GOALS }, data.settings.goals); saveSettings(); }
        renderAll();
        closeSheet();
        toast("Backup imported");
      } catch { toast("That file isn't a valid backup"); }
    });
    body.querySelector("#clearDay").addEventListener("click", () => {
      if (!confirm("Clear everything logged on this day?")) return;
      delete logs[ymd(selectedDate)];
      saveLogs();
      renderAll();
      closeSheet();
      toast("Day cleared");
    });
  },
};

function renderResults(q) {
  const wrap = $("#resultsWrap");
  if (!wrap) return;
  const query = q.trim();
  let html = "";
  if (!query && activeCategory === "All") {
    pickList = recents.slice(0, 12);
    html += pickList.length
      ? `<div class="section-label">Recent</div><ul class="results">${pickList.map(resultItem).join("")}</ul>`
      : `<p class="muted">Search ${window.SG_FOODS.length} Singapore foods: hawker dishes, kopitiam drinks, fast food, supermarket brands…</p>`;
  } else {
    pickList = searchFoods(query);
    html += pickList.length
      ? `<ul class="results">${pickList.map(resultItem).join("")}</ul>`
      : `<p class="muted">No match in the built-in list.</p>`;
    if (query.length >= 2) html += `<button class="link-btn" id="onlineBtn">Search packaged products online for “${esc(query)}”</button><div id="online"></div>`;
    html += `<button class="link-btn" data-act="custom-q">Can't find it? Enter it manually</button>`;
  }
  wrap.innerHTML = html;
  const ob = wrap.querySelector("#onlineBtn");
  if (ob) ob.addEventListener("click", () => searchOnline(query));
}

// ---------- Open Food Facts (packaged products) ----------
function offToFood(p) {
  const n = p.nutriments || {};
  const hasServing = n["energy-kcal_serving"] != null && p.serving_size;
  const pick = (k) => num(hasServing ? n[k + "_serving"] : n[k + "_100g"]);
  let kcal = pick("energy-kcal");
  if (!kcal) {
    const kj = pick("energy");
    if (kj) kcal = kj / 4.184;
  }
  const name = [p.product_name || p.product_name_en || "Unknown product", p.brands ? `(${p.brands.split(",")[0].trim()})` : ""].join(" ").trim();
  return {
    id: "off" + (p.code || uid()),
    name,
    serving: hasServing ? p.serving_size : "100g / 100ml",
    kcal: r0(kcal), protein: r1(pick("proteins")), carbs: r1(pick("carbohydrates")),
    fat: r1(pick("fat")), sugar: r1(pick("sugars")), sodium: r0(pick("sodium") * 1000),
    category: "Packaged", source: "Open Food Facts",
  };
}

async function searchOnline(query) {
  const box = $("#online");
  if (!box) return;
  box.innerHTML = '<div class="spinner"></div>';
  const fields = "code,product_name,product_name_en,brands,serving_size,nutriments";
  const base = "https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=25&fields=" + fields + "&search_terms=" + encodeURIComponent(query);
  try {
    let res = await fetch(base + "&tagtype_0=countries&tag_contains_0=contains&tag_0=singapore");
    let data = await res.json();
    let products = (data.products || []);
    if (products.length < 5) {
      res = await fetch(base);
      data = await res.json();
      products = products.concat(data.products || []);
    }
    const seen = new Set();
    const foods = products.map(offToFood).filter((f) => f.kcal > 0 && !seen.has(f.id) && seen.add(f.id));
    if (!$("#online")) return;
    if (!foods.length) { box.innerHTML = '<p class="muted">No online matches.</p>'; return; }
    const offset = pickList.length;
    pickList = pickList.concat(foods);
    box.innerHTML = `<div class="section-label">Online · Open Food Facts</div><ul class="results">${foods.map((f, i) => resultItem(f, offset + i)).join("")}</ul>`;
  } catch {
    if ($("#online")) box.innerHTML = '<p class="muted">Couldn\'t reach the online database. Check your connection.</p>';
  }
}

async function lookupBarcode(code) {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=code,product_name,product_name_en,brands,serving_size,nutriments`);
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  const f = offToFood(data.product);
  return f.kcal > 0 ? f : null;
}

// ---------- Photo scan ----------
let scanState = {};

function setScan(patch) {
  scanState = { ...scanState, ...patch };
  const top = sheet.stack[sheet.stack.length - 1];
  if (top && top[0] === "scan") show("scan", scanState, false);
}

function startScan() {
  const input = $("#cameraInput");
  input.value = "";
  input.click();
}

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  const max = 1280;
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  return { canvas, dataUrl: canvas.toDataURL("image/jpeg", 0.85) };
}

async function detectBarcode(canvas, dataUrl) {
  try {
    if ("BarcodeDetector" in window) {
      const det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
      const codes = await det.detect(canvas);
      if (codes.length) return codes[0].rawValue;
      return null;
    }
  } catch { /* fall through to ZXing */ }
  try {
    const ZX = await import(ZXING_URL);
    const reader = new ZX.BrowserMultiFormatReader();
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const result = await reader.decodeFromImageElement(img);
    return result?.getText?.() || null;
  } catch { return null; }
}

const AI_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          serving: { type: "string" },
          kcal: { type: "number" },
          protein: { type: "number" },
          carbs: { type: "number" },
          fat: { type: "number" },
          sugar: { type: "number" },
          sodium: { type: "number" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["name", "serving", "kcal", "protein", "carbs", "fat", "sugar", "sodium", "confidence"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["items", "note"],
  additionalProperties: false,
};

const AI_PROMPT = `You are a nutrition assistant for someone living in Singapore.
Identify each distinct food or drink in this photo and estimate the nutrition for the portion actually shown.
Use Singapore names where they apply (e.g. "Chicken Rice (roasted)", "Kopi C", "Char Kway Teow") and typical Singapore hawker or retail portion sizes, consistent with Health Promotion Board food composition data.
If the photo shows a packaged product or nutrition label, read the label values per serving.
For each item give: name, serving (a short portion description like "1 plate (380g)"), kcal, protein g, carbs g, fat g, sugar g, sodium mg, and your confidence.
Use "note" for one short sentence on anything the user should check (e.g. hidden oil, sauce, or portion uncertainty), or an empty string.
If there is no food or drink in the photo, return an empty items array and say so in note.`;

async function analyseWithAI(dataUrl) {
  const { default: Anthropic } = await import(SDK_URL);
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
  const response = await client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: AI_SCHEMA } },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: dataUrl.split(",")[1] } },
        { type: "text", text: AI_PROMPT },
      ],
    }],
  });
  if (response.stop_reason === "refusal") throw new Error("The AI declined to analyse this photo. Try another photo or search manually.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = JSON.parse(text);
  return {
    note: parsed.note,
    items: parsed.items.map((it) => ({
      ...it, id: "ai" + uid(), category: "Photo scan", source: "AI estimate", estimate: true,
      kcal: r0(it.kcal), protein: r1(it.protein), carbs: r1(it.carbs), fat: r1(it.fat), sugar: r1(it.sugar), sodium: r0(it.sodium),
    })),
  };
}

async function handlePhoto(file) {
  if (!file) return;
  if (!$("#sheet").classList.contains("open")) openSheet(sheet.meal, "add");
  scanState = { status: "working", msg: "Checking for a barcode…" };
  show("scan", scanState);
  let canvas, dataUrl;
  try {
    ({ canvas, dataUrl } = await loadImage(file));
  } catch {
    return setScan({ status: "error", error: "Couldn't read that photo." });
  }
  setScan({ img: dataUrl });

  const code = await detectBarcode(canvas, dataUrl);
  if (code) {
    setScan({ msg: `Barcode ${code} found. Looking it up…` });
    try {
      const food = await lookupBarcode(code);
      if (food) {
        sheet.stack.pop();
        show("detail", food);
        return;
      }
      setScan({ status: "error", error: `Barcode ${code} isn't in the product database yet. Search by name or enter it manually.` });
    } catch {
      setScan({ status: "error", error: "Couldn't reach the product database. Check your connection." });
    }
    return;
  }

  if (!settings.apiKey) return setScan({ status: "nokey" });
  setScan({ msg: "Recognising your food…" });
  try {
    const result = await analyseWithAI(dataUrl);
    setScan({ status: "done", items: result.items, note: result.note });
  } catch (err) {
    let msg = err?.message || "Something went wrong.";
    if (err?.status === 401) msg = "Your API key was rejected. Check it in Settings.";
    else if (err?.status === 429) msg = "Too many requests right now. Try again in a minute.";
    else if (err?.status >= 500) msg = "The AI service is busy. Try again shortly.";
    else if (err instanceof TypeError) msg = "Couldn't connect. Check your internet connection.";
    setScan({ status: "error", error: msg });
  }
}

// ---------- Events ----------
$("#days").addEventListener("click", (e) => {
  const b = e.target.closest("[data-date]");
  if (!b) return;
  const [y, m, d] = b.dataset.date.split("-").map(Number);
  selectedDate = new Date(y, m - 1, d);
  renderAll();
});
$("#prevWeek").addEventListener("click", () => { selectedDate.setDate(selectedDate.getDate() - 7); renderAll(); });
$("#nextWeek").addEventListener("click", () => { selectedDate.setDate(selectedDate.getDate() + 7); renderAll(); });
$("#todayBtn").addEventListener("click", () => { selectedDate = new Date(); selectedDate.setHours(0, 0, 0, 0); renderAll(); });
$("#settingsBtn").addEventListener("click", () => openSheet(null, "settings"));

$("#meals").addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  if (add) return openSheet(add.dataset.add, "add");
  const del = e.target.closest("[data-del]");
  if (del) { const [m, id] = del.dataset.del.split(":"); removeEntry(m, id); }
});

$("#fabScan").addEventListener("click", () => { sheet.meal = ymd(selectedDate) === ymd(new Date()) ? mealForNow() : sheet.meal; startScan(); });
$("#fabManual").addEventListener("click", () => openSheet(null, "add"));
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
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  if (act === "scan") startScan();
  else if (act === "custom") show("custom", {});
  else if (act === "custom-q") show("custom", { name: $("#q")?.value || "" });
  else if (act === "settings") show("settings");
  else if (act === "back-search") { sheet.stack = []; show("add"); }
  else if (act === "ai-edit") show("custom", pickList[0]);
});

// ---------- Boot ----------
renderAll();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
