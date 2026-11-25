// Grace's Calorie Tracker
// Free stack: GitHub Pages (hosting) + Firebase Authentication (login) + Cloud Firestore (data).
// Firestore layout (see firestore.rules):
//   users/{uid}                  { username, email, goals, recents[], customFoods[], createdAt }
//   users/{uid}/months/{YYYY-MM} { month, days: { "YYYY-MM-DD": { breakfast[], lunch[], dinner[], supper[] } } }
//   usernames/{lowercase name}   { uid, email }   lets people sign in with a username
// One document per user per month: 10 years is about 120 documents per person.
import { firebaseConfig } from "./firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
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
const HISTORY_YEARS = 10;
const goalsFor = (kcal) => ({
  kcal, protein: Math.round((kcal * 0.25) / 4), carbs: Math.round((kcal * 0.5) / 4),
  fat: Math.round((kcal * 0.25) / 9), sugar: 40, sodium: 2000,
});

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
const prettyDate = (key, opts = { weekday: "short", day: "numeric", month: "short" }) => parseYmd(key).toLocaleDateString("en-SG", opts);

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
  barcode: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 9v6M10 9v6M13 9v6M16 9v6"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
};

// ---------- State ----------
const fb = {};          // Firebase functions, loaded on boot
const state = {
  user: null,           // Firebase auth user
  profile: null,        // users/{uid} data
  profileUnsub: null,
  months: {},           // "YYYY-MM" -> { days }
  monthSubs: new Map(), // "YYYY-MM" -> unsubscribe
  selectedDate: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })(),
  signingUp: false,
  recPlan: null,
  recList: [],
};
const goals = () => Object.assign(goalsFor(1800), state.profile?.goals || {});
const userPath = () => `users/${state.user.uid}`;
const monthPath = (month) => `${userPath()}/months/${month}`;

// ---------- Firebase boot ----------
async function loadFirebase() {
  const [app, auth, fs] = await Promise.all([
    import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js"),
  ]);
  const fbApp = app.initializeApp(firebaseConfig);
  fb.auth = auth.getAuth(fbApp);
  let db;
  try {
    db = fs.initializeFirestore(fbApp, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch {
    db = fs.getFirestore(fbApp);
  }
  Object.assign(fb, {
    db,
    onAuthStateChanged: auth.onAuthStateChanged,
    signIn: auth.signInWithEmailAndPassword,
    signUp: auth.createUserWithEmailAndPassword,
    sendReset: auth.sendPasswordResetEmail,
    signOut: auth.signOut,
    doc: (path) => fs.doc(db, path),
    getDoc: fs.getDoc, setDoc: fs.setDoc, deleteDoc: fs.deleteDoc, onSnapshot: fs.onSnapshot,
    monthsBetween: (from, to) => fs.getDocs(fs.query(fs.collection(db, `${userPath()}/months`), fs.where("month", ">=", from), fs.where("month", "<=", to))),
  });
}

// ---------- Writes: one at a time per document ----------
const writeChains = new Map();
function queueWrite(path, fn) {
  const prev = writeChains.get(path) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  writeChains.set(path, next);
  return next.catch((e) => {
    console.error(e);
    if (e?.code === "permission-denied") toast("You're not allowed to save this. Try signing out and in again.");
    else if (e?.code === "resource-exhausted") toast("The free database limit for today was reached. Try again tomorrow.");
    else toast("Couldn't save. Check your connection and try again.");
    throw e;
  });
}

function dayData(dateKey) {
  const d = state.months[monthOf(dateKey)]?.days?.[dateKey] || {};
  const out = {};
  for (const meal of MEALS) out[meal.id] = Array.isArray(d[meal.id]) ? d[meal.id] : [];
  return out;
}

function writeDay(dateKey, day) {
  const month = monthOf(dateKey);
  const cached = state.months[month] || { days: {} };
  state.months[month] = { ...cached, days: { ...cached.days, [dateKey]: day } };
  renderAll();
  const path = monthPath(month);
  // merge: true deep-merges maps, so only this day is replaced inside the month document.
  return queueWrite(path, () => fb.setDoc(fb.doc(path), { month, days: { [dateKey]: day }, updatedAt: new Date().toISOString() }, { merge: true }));
}

function updateProfile(patch) {
  if (!state.profile) return Promise.resolve();
  state.profile = { ...state.profile, ...patch };
  const path = userPath();
  return queueWrite(path, () => fb.setDoc(fb.doc(path), patch, { merge: true }));
}

// ---------- Subscriptions ----------
function showBanner(text) {
  const b = $("#banner");
  b.hidden = !text;
  b.textContent = text || "";
}

function subscribeProfile() {
  state.profileUnsub?.();
  const ref = fb.doc(userPath());
  state.profileUnsub = fb.onSnapshot(ref, async (snap) => {
    if (snap.exists()) {
      state.profile = snap.data();
      renderAll();
      return;
    }
    if (state.signingUp || snap.metadata.fromCache) return;
    // Signed in but no profile yet (e.g. created in the Firebase console): make a default one.
    const email = state.user.email || "";
    const profile = { username: email.split("@")[0] || "Me", email, goals: goalsFor(1800), recents: [], customFoods: [], createdAt: new Date().toISOString() };
    try { await fb.setDoc(ref, profile); } catch (e) { console.error(e); }
  }, (e) => {
    console.error(e);
    showBanner("Couldn't load your profile. Check your connection, then reload the page.");
  });
}

function ensureMonthSubs() {
  if (!state.user) return;
  const start = weekStart(state.selectedDate);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const needed = new Set([monthOf(ymd(start)), monthOf(ymd(end)), monthOf(todayKey())]);
  for (const [m, unsub] of state.monthSubs) if (!needed.has(m)) { unsub(); state.monthSubs.delete(m); }
  for (const m of needed) {
    if (state.monthSubs.has(m)) continue;
    const unsub = fb.onSnapshot(fb.doc(monthPath(m)), (snap) => {
      state.months[m] = { days: snap.exists() ? snap.data().days || {} : {}, fetchedAt: Date.now() };
      renderAll(false);
    }, (e) => console.error(e));
    state.monthSubs.set(m, unsub);
  }
}

function stopSubscriptions() {
  state.profileUnsub?.(); state.profileUnsub = null;
  for (const unsub of state.monthSubs.values()) unsub();
  state.monthSubs.clear();
  state.months = {};
  state.profile = null;
}

// History: read every month document in a range with one query.
async function loadRange(startKey, endKey) {
  const snap = await fb.monthsBetween(monthOf(startKey), monthOf(endKey));
  const out = [];
  snap.docs.forEach((d) => {
    const days = d.data().days || {};
    for (const [date, day] of Object.entries(days)) if (date >= startKey && date <= endKey) out.push([date, day]);
  });
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

// ---------- Totals ----------
function totalsOf(entries) {
  const t = Object.fromEntries(NUTRI.map((k) => [k, 0]));
  for (const e of entries) for (const k of NUTRI) t[k] += num(e[k]) * (num(e.qty) || 1);
  return t;
}
const dayTotals = (dateKey) => totalsOf(MEALS.flatMap((m) => dayData(dateKey)[m.id]));

// ---------- Rendering ----------
function weekStart(d) { const s = new Date(d); s.setDate(s.getDate() - s.getDay()); s.setHours(0, 0, 0, 0); return s; }

function renderHeader() {
  const name = state.profile?.username || "";
  $("#profileInitial").textContent = name ? name.charAt(0).toUpperCase() : "·";
  const sel = ymd(state.selectedDate);
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

function entryMeta(e) {
  const q = num(e.qty) || 1;
  return `${q !== 1 ? `${r1(q)} × ` : ""}${esc(e.serving)} · P ${fmt(e.protein * q)}g · C ${fmt(e.carbs * q)}g · F ${fmt(e.fat * q)}g · S ${fmt(e.sugar * q)}g`;
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
          <div class="e-main"><div class="e-name">${esc(e.name)}</div><div class="e-meta">${entryMeta(e)}</div></div>
          <div class="e-kcal">${fmt(e.kcal * (num(e.qty) || 1))}</div>
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
  const rest = order.slice(sel === todayKey() ? order.indexOf(mealForNow()) : 0);
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
    ${drinks.length ? `<div class="sub-head">Low-sugar drinks</div><div class="rec-row" aria-label="Drink picks">${drinks.map((f, i) => recCard(f, meals.length + i, 0, plan.next)).join("")}</div>` : ""}`;
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
  if (!state.user) return;
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
  const out = { id: f.id || "f" + uid(), name: String(f.name), serving: String(f.serving || "1 serving"), category: String(f.category || ""), source: String(f.source || ""),
    kcal: r0(num(f.kcal)), protein: r1(num(f.protein)), carbs: r1(num(f.carbs)), fat: r1(num(f.fat)), sugar: r1(num(f.sugar)), sodium: r0(num(f.sodium)) };
  if (f.barcode) out.barcode = String(f.barcode);
  return out;
}

function addEntry(mealId, food, qty) {
  const dateKey = ymd(state.selectedDate);
  const day = dayData(dateKey);
  const f = compactFood(food);
  const entry = { ...f, id: uid(), qty: num(qty) || 1, at: new Date().toISOString() };
  writeDay(dateKey, { ...day, [mealId]: [...day[mealId], entry] }).catch(() => {});
  const recents = [f, ...(state.profile?.recents || []).filter((r) => !(r.name === f.name && r.serving === f.serving))].slice(0, 25);
  updateProfile({ recents }).catch(() => {});
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
  sheet.meal = mealId || (ymd(state.selectedDate) === todayKey() ? mealForNow() : sheet.meal);
  sheet.stack = [];
  $("#scrim").classList.add("open");
  $("#sheet").classList.add("open");
  show(view, arg);
}

function closeSheet() {
  stopCamera();
  $("#scrim").classList.remove("open");
  $("#sheet").classList.remove("open");
}

function renderMealTabs(visible) {
  const el = $("#mealTabs");
  el.hidden = !visible;
  el.innerHTML = MEALS.map((m) => `<button data-meal="${m.id}" class="${m.id === sheet.meal ? "on" : ""}">${m.name}</button>`).join("");
}

function show(view, arg, push = true) {
  stopCamera();
  if (push) sheet.stack.push([view, arg]);
  $("#sheetBack").hidden = sheet.stack.length < 2;
  const body = $("#sheetBody");
  body.scrollTop = 0;
  VIEWS[view](body, arg);
}

function back() {
  sheet.stack.pop();
  const [view, arg] = sheet.stack[sheet.stack.length - 1] || ["add"];
  show(view, arg, false);
}

// ---------- Food search ----------
let activeCategory = "All";
const allFoods = () => [...(state.profile?.customFoods || []), ...window.SG_FOODS];

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
    pickList = (state.profile?.recents || []).slice(0, 12);
    html = pickList.length
      ? `<div class="section-label">Recent</div><ul class="results">${pickList.map(resultItem).join("")}</ul>`
      : `<p class="muted">Search ${window.SG_FOODS.length} Singapore foods: hawker dishes, kopitiam drinks, fast food, bubble tea and supermarket brands.</p>`;
  } else {
    pickList = searchFoods(query);
    html = pickList.length ? `<ul class="results">${pickList.map(resultItem).join("")}</ul>` : `<p class="muted">No match in the food list.</p>`;
    if (query.length >= 2) html += `<button class="link-btn" id="onlineBtn">Search packaged products online for “${esc(query)}”</button><div id="online"></div>`;
    html += `<button class="link-btn" data-act="custom-q">Can't find it? Enter it manually</button>`;
  }
  wrap.innerHTML = html;
  $("#onlineBtn")?.addEventListener("click", () => searchOnline(query));
}

// ---------- Open Food Facts (free packaged-product database) ----------
function offToFood(p, code) {
  const n = p.nutriments || {};
  const hasServing = n["energy-kcal_serving"] != null && p.serving_size;
  const pick = (k) => num(hasServing ? n[k + "_serving"] : n[k + "_100g"]);
  let kcal = pick("energy-kcal");
  if (!kcal) { const kj = pick("energy"); if (kj) kcal = kj / 4.184; }
  const brand = p.brands ? ` (${p.brands.split(",")[0].trim()})` : "";
  return compactFood({
    id: "off" + (p.code || code || uid()), name: (p.product_name || p.product_name_en || "Unnamed product") + brand,
    serving: hasServing ? p.serving_size : "100g / 100ml", kcal, protein: pick("proteins"), carbs: pick("carbohydrates"),
    fat: pick("fat"), sugar: pick("sugars"), sodium: pick("sodium") * 1000, category: "Packaged", source: "Open Food Facts",
    barcode: p.code || code,
  });
}

const OFF_FIELDS = "code,product_name,product_name_en,brands,serving_size,nutriments";
async function lookupBarcode(code) {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if (!res.ok && res.status !== 404) throw new Error("lookup failed");
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  const f = offToFood(data.product, code);
  return f.kcal > 0 ? f : null;
}

async function searchOnline(query) {
  const box = $("#online");
  if (!box) return;
  box.innerHTML = '<div class="spinner"></div>';
  const base = `https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=25&fields=${OFF_FIELDS}&search_terms=${encodeURIComponent(query)}`;
  try {
    let products = (await (await fetch(base + "&tagtype_0=countries&tag_contains_0=contains&tag_0=singapore")).json()).products || [];
    if (products.length < 5) products = products.concat((await (await fetch(base)).json()).products || []);
    const seen = new Set();
    const foods = products.map((p) => offToFood(p)).filter((f) => f.kcal > 0 && !seen.has(f.id) && seen.add(f.id));
    if (!$("#online")) return;
    if (!foods.length) { box.innerHTML = '<p class="muted">No online matches.</p>'; return; }
    const offset = pickList.length;
    pickList = pickList.concat(foods);
    box.innerHTML = `<div class="section-label">Online · Open Food Facts</div><ul class="results">${foods.map((f, i) => resultItem(f, offset + i)).join("")}</ul>`;
  } catch {
    if ($("#online")) box.innerHTML = '<p class="muted">Couldn\'t reach the online database. Check your connection.</p>';
  }
}

// ---------- Barcode scanner (runs on the phone; images are never stored or uploaded) ----------
const cam = { stream: null, controls: null, raf: 0, done: false };
let zxingReader = null;

async function getZxing() {
  if (!zxingReader) {
    const { BrowserMultiFormatReader } = await import("./vendor/zxing-browser.js");
    zxingReader = new BrowserMultiFormatReader();
  }
  return zxingReader;
}

function stopCamera() {
  cancelAnimationFrame(cam.raf);
  cam.raf = 0;
  try { cam.controls?.stop(); } catch { /* already stopped */ }
  cam.controls = null;
  cam.stream?.getTracks().forEach((t) => t.stop());
  cam.stream = null;
  const v = $("#scanVideo");
  if (v) v.srcObject = null;
}

async function startCamera(video, onCode) {
  cam.done = false;
  const found = (code) => { if (cam.done || !code) return; cam.done = true; stopCamera(); onCode(code); };
  const native = "BarcodeDetector" in window && (await window.BarcodeDetector.getSupportedFormats?.().catch(() => []) || []).includes("ean_13");
  if (native) {
    cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    video.srcObject = cam.stream;
    await video.play();
    const det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
    const loop = async () => {
      if (cam.done || !cam.stream) return;
      try { const codes = await det.detect(video); if (codes.length) return found(codes[0].rawValue); } catch { /* keep trying */ }
      cam.raf = requestAnimationFrame(loop);
    };
    cam.raf = requestAnimationFrame(loop);
  } else {
    const reader = await getZxing();
    cam.controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, video, (result) => {
      if (result) found(result.getText());
    });
  }
}

async function decodePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    if ("BarcodeDetector" in window) {
      try {
        const bmp = await createImageBitmap(file);
        const codes = await new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] }).detect(bmp);
        bmp.close?.();
        if (codes.length) return codes[0].rawValue;
      } catch { /* fall back to ZXing */ }
    }
    const reader = await getZxing();
    const result = await reader.decodeFromImageUrl(url);
    return result?.getText() || null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url); // the photo is discarded straight away
  }
}

async function handleCode(code) {
  code = String(code).replace(/\D/g, "");
  if (code.length < 6) { toast("That doesn't look like a barcode number"); return; }
  const mine = (state.profile?.customFoods || []).find((f) => f.barcode === code);
  if (mine) { show("detail", mine); return; }
  const body = $("#sheetBody");
  body.innerHTML = `<div class="spinner"></div><p class="scan-status">Barcode ${esc(code)} found. Looking it up…</p>`;
  try {
    const food = await lookupBarcode(code);
    if (food) show("detail", food);
    else show("notFound", code);
  } catch {
    show("notFound", { code, offline: true });
  }
}

// ---------- History ----------
const hist = { range: "30", query: "" };
const RANGES = [["7", "7 days"], ["30", "30 days"], ["month", "This month"], ["year", "This year"], ["all", "All time"]];

function rangeDates(r) {
  const end = new Date(); const start = new Date();
  if (r === "month") start.setDate(1);
  else if (r === "year") { start.setMonth(0); start.setDate(1); }
  else if (r === "all") start.setFullYear(start.getFullYear() - HISTORY_YEARS);
  else start.setDate(start.getDate() - (Number(r) - 1));
  return [ymd(start), ymd(end)];
}

async function runHistory() {
  const out = $("#histOut");
  if (!out) return;
  out.innerHTML = '<div class="spinner"></div>';
  const [start, end] = rangeDates(hist.range);
  let days;
  try { days = await loadRange(start, end); } catch (e) { console.error(e); out.innerHTML = '<p class="muted">Couldn\'t load your history. Check your connection.</p>'; return; }
  if (!$("#histOut")) return;
  const logged = days.filter(([, d]) => MEALS.some((m) => (d[m.id] || []).length));
  const q = hist.query.trim().toLowerCase();
  if (q) {
    const words = q.split(/\s+/);
    const hits = [];
    for (const [date, d] of logged) for (const m of MEALS) for (const e of d[m.id] || []) {
      const name = String(e.name).toLowerCase();
      if (words.every((w) => name.includes(w))) hits.push({ date, meal: m.id, e });
    }
    const t = totalsOf(hits.map((h) => h.e));
    const byDay = new Map();
    for (const h of hits) { if (!byDay.has(h.date)) byDay.set(h.date, []); byDay.get(h.date).push(h); }
    out.innerHTML = `
      <div class="stat-row">
        <div class="stat"><div class="k">Times</div><div class="v">${hits.length}</div></div>
        <div class="stat"><div class="k">Calories</div><div class="v">${fmt(t.kcal)} <small>kcal</small></div></div>
        <div class="stat"><div class="k">Sugar</div><div class="v">${fmt(t.sugar)} <small>g</small></div></div>
      </div>
      ${hits.length ? [...byDay.entries()].reverse().map(([date, list]) => `
        <div class="hist-day"><div class="hd">${esc(prettyDate(date, { weekday: "short", day: "numeric", month: "short", year: "numeric" }))}<span>${fmt(totalsOf(list.map((h) => h.e)).kcal)} kcal</span></div>
          <ul>${list.map((h) => `<li><span>${esc(mealName(h.meal))}: ${esc(h.e.name)}${num(h.e.qty) !== 1 ? ` × ${r1(num(h.e.qty))}` : ""}</span><span>${fmt(h.e.kcal * (num(h.e.qty) || 1))}</span></li>`).join("")}</ul></div>`).join("")
        : `<p class="muted">No foods matching “${esc(hist.query)}” in this period.</p>`}`;
    return;
  }
  if (!logged.length) { out.innerHTML = '<p class="muted">Nothing logged in this period yet.</p>'; return; }
  const totals = logged.map(([date, d]) => [date, totalsOf(MEALS.flatMap((m) => d[m.id] || []))]);
  const avg = (k) => totals.reduce((s, [, t]) => s + t[k], 0) / totals.length;
  const g = goals();
  const counts = new Map();
  for (const [, d] of logged) for (const m of MEALS) for (const e of d[m.id] || []) counts.set(e.name, (counts.get(e.name) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const showBars = totals.length > 1 && totals.length <= 92;
  const maxK = Math.max(g.kcal, ...totals.map(([, t]) => t.kcal));
  out.innerHTML = `
    <div class="stat-row">
      <div class="stat"><div class="k">Days logged</div><div class="v">${totals.length}</div></div>
      <div class="stat"><div class="k">Avg calories</div><div class="v">${fmt(avg("kcal"))}</div></div>
      <div class="stat"><div class="k">Avg sugar</div><div class="v">${fmt(avg("sugar"))}<small>g</small></div></div>
    </div>
    ${showBars ? `<div class="daybars" aria-label="Calories per logged day">${totals.map(([date, t]) => `<i class="${t.kcal > g.kcal ? "over" : ""}" style="height:${Math.max(3, (t.kcal / maxK) * 100)}%" title="${esc(prettyDate(date))}: ${fmt(t.kcal)} kcal"></i>`).join("")}</div>
      <p class="note">Each bar is a logged day. Red bars went over your ${fmt(g.kcal)} kcal goal.</p>` : ""}
    <div class="section-label">Most eaten</div>
    <ul class="top-foods">${top.map(([name, n]) => `<li><span>${esc(name)}</span><span>${n}×</span></li>`).join("")}</ul>
    <div class="section-label">Day by day</div>
    ${totals.slice().reverse().slice(0, 60).map(([date, t]) => {
      const d = logged.find(([k]) => k === date)[1];
      return `<div class="hist-day"><div class="hd">${esc(prettyDate(date, { weekday: "short", day: "numeric", month: "short", year: "numeric" }))}<span>${fmt(t.kcal)} kcal · S ${fmt(t.sugar)}g</span></div>
        <ul>${MEALS.filter((m) => (d[m.id] || []).length).map((m) => `<li><span>${esc(m.name)}: ${esc(d[m.id].map((e) => e.name).join(", "))}</span><span>${fmt(totalsOf(d[m.id]).kcal)}</span></li>`).join("")}</ul></div>`;
    }).join("")}`;
}

// ---------- Views (bottom sheet) ----------
const VIEWS = {
  add(body) {
    $("#sheetTitle").textContent = "Log a meal";
    renderMealTabs(true);
    const cats = ["All", ...new Set(window.SG_FOODS.map((f) => f.category))];
    if ((state.profile?.customFoods || []).length) cats.splice(1, 0, "My foods");
    if (!cats.includes(activeCategory)) activeCategory = "All";
    body.innerHTML = `
      <div class="modes">
        <button class="mode" data-act="scan">${ICON.barcode}<b>Scan barcode</b><span>Packaged food and drinks</span></button>
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

  scan(body) {
    $("#sheetTitle").textContent = "Scan a barcode";
    renderMealTabs(true);
    body.innerHTML = `
      <div class="scanner"><video id="scanVideo" playsinline muted></video><div class="frame"></div></div>
      <p class="scan-status" id="scanStatus">Starting the camera…</p>
      <div class="row2">
        <button class="secondary" data-act="photo">Take a photo instead</button>
        <button class="secondary" data-act="custom">Enter manually</button>
      </div>
      <form class="barcode-form" id="codeForm"><input id="codeInput" inputmode="numeric" autocomplete="off" placeholder="Or type the barcode number" aria-label="Barcode number"><button type="submit">Look up</button></form>
      <p class="note">The camera picture stays on your phone and is never saved. Only the barcode number is sent to Open Food Facts to look up the product.</p>`;
    $("#codeForm", body).addEventListener("submit", (e) => { e.preventDefault(); stopCamera(); handleCode($("#codeInput", body).value); });
    if (!navigator.mediaDevices?.getUserMedia) {
      $("#scanStatus", body).textContent = "This browser can't open the camera here. Take a photo of the barcode or type its number.";
      return;
    }
    startCamera($("#scanVideo", body), handleCode).then(() => {
      if ($("#scanStatus")) $("#scanStatus").textContent = "Point the camera at the barcode.";
    }).catch((e) => {
      console.error(e);
      if ($("#scanStatus")) $("#scanStatus").textContent = e?.name === "NotAllowedError"
        ? "Camera access is blocked. Allow camera access for this site in your browser settings, or take a photo instead."
        : "Couldn't start the camera. Take a photo of the barcode or type its number.";
    });
  },

  notFound(body, arg) {
    const code = typeof arg === "string" ? arg : arg.code;
    $("#sheetTitle").textContent = "Product not found";
    renderMealTabs(true);
    body.innerHTML = `
      <p class="scan-status">${arg.offline ? "Couldn't reach the product database. Check your connection." : `Barcode <b>${esc(code)}</b> isn't in the free product database yet.`}</p>
      <p class="note" style="text-align:center">Enter it once from the nutrition label and it's saved to My foods. Next time you scan this barcode it fills in by itself.</p>
      <button class="primary" data-act="custom-barcode" data-code="${esc(code)}">Enter it from the label</button>
      <button class="secondary" data-act="scan">Scan again</button>`;
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
      ${food.source === "Open Food Facts" ? '<p class="note">From Open Food Facts, a free database run by volunteers. If the numbers look wrong, check the label and enter it manually instead.</p>' : ""}`;
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
      ${prefill.barcode ? `<p class="note">Barcode ${esc(prefill.barcode)} will be linked to this food.</p>` : ""}
      <label class="check"><input type="checkbox" id="cSave" checked${prefill.barcode ? " disabled" : ""}> Save to My foods for next time</label>
      <button class="primary" id="cAdd">Add to ${mealName(sheet.meal)}</button>`;
    $("#cAdd", body).addEventListener("click", () => {
      const v = (id) => $("#" + id, body).value.trim();
      const name = v("cName");
      if (!name) return toast("Give the food a name");
      if (v("cKcal") === "") return toast("Enter the calories");
      const food = compactFood({ name, serving: v("cServing") || "1 serving", category: "My foods", source: "My foods", barcode: prefill.barcode,
        kcal: v("cKcal"), protein: v("cProtein"), carbs: v("cCarbs"), fat: v("cFat"), sugar: v("cSugar"), sodium: v("cSodium") });
      if ($("#cSave", body).checked) {
        const customFoods = [food, ...(state.profile?.customFoods || []).filter((c) => c.name.toLowerCase() !== name.toLowerCase() && (!food.barcode || c.barcode !== food.barcode))].slice(0, 300);
        updateProfile({ customFoods }).catch(() => {});
      }
      addEntry(sheet.meal, food, 1);
      closeSheet();
      toast(`Added to ${mealName(sheet.meal)}`);
    });
  },

  history(body) {
    $("#sheetTitle").textContent = "History";
    renderMealTabs(false);
    body.innerHTML = `
      <form class="search" id="histForm">${ICON.search}<input id="histQ" type="search" placeholder="Search a food, e.g. bubble tea" autocomplete="off" enterkeyhint="search" value="${esc(hist.query)}" aria-label="Search your history"></form>
      <div class="chips" id="histRange">${RANGES.map(([k, label]) => `<button data-range="${k}" class="${k === hist.range ? "on" : ""}">${label}</button>`).join("")}</div>
      <div id="histOut"></div>`;
    const input = $("#histQ", body);
    let t;
    input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { hist.query = input.value; runHistory(); }, 300); });
    $("#histForm", body).addEventListener("submit", (e) => { e.preventDefault(); input.blur(); hist.query = input.value; runHistory(); });
    $("#histRange", body).addEventListener("click", (e) => {
      const b = e.target.closest("[data-range]");
      if (!b) return;
      hist.range = b.dataset.range;
      body.querySelectorAll("#histRange button").forEach((x) => x.classList.toggle("on", x === b));
      runHistory();
    });
    runHistory();
  },

  profile(body) {
    const p = state.profile || {};
    $("#sheetTitle").textContent = "Profile";
    renderMealTabs(false);
    const g = goals();
    const f = (id, label, val) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" inputmode="decimal" min="0" value="${esc(val)}"></div>`;
    body.innerHTML = `
      <div class="kv">
        <div><span>Username</span><b>${esc(p.username || "")}</b></div>
        <div><span>Email</span><b>${esc(state.user?.email || p.email || "")}</b></div>
      </div>
      <div class="section-label">Daily goals</div>
      <div class="form">
        ${f("gKcal", "Calories (kcal)", g.kcal)}
        ${f("gProtein", "Protein (g)", g.protein)}
        ${f("gCarbs", "Carbs (g)", g.carbs)}
        ${f("gFat", "Fat (g)", g.fat)}
        ${f("gSugar", "Sugar (g)", g.sugar)}
        ${f("gSodium", "Sodium (mg)", g.sodium)}
      </div>
      <button class="secondary" id="autoGoals">Set protein, carbs and fat from my calorie goal</button>
      <p class="note">HPB's guide for adults is under about 40–50g of added sugar and under 2,000mg of sodium a day.</p>
      <button class="primary" id="saveGoals">Save goals</button>
      <div class="section-label">Password</div>
      <button class="secondary" id="resetPw">Email me a link to change my password</button>
      <div class="section-label">This day</div>
      <button class="secondary danger" id="clearDay">Clear everything logged on ${state.selectedDate.toLocaleDateString("en-SG", { day: "numeric", month: "short" })}</button>
      <button class="secondary" id="signOutBtn" style="margin-top:22px">Sign out</button>
      <p class="note">${window.SG_FOODS.length} Singapore foods built in. Values are typical portions from HPB and brand data; hawker portions vary by stall.</p>`;
    $("#autoGoals", body).addEventListener("click", () => {
      const a = goalsFor(num($("#gKcal", body).value) || 1800);
      $("#gProtein", body).value = a.protein; $("#gCarbs", body).value = a.carbs; $("#gFat", body).value = a.fat;
    });
    $("#saveGoals", body).addEventListener("click", async () => {
      const v = (id) => num($("#" + id, body).value);
      const goalsNew = { kcal: v("gKcal") || 1800, protein: v("gProtein"), carbs: v("gCarbs"), fat: v("gFat"), sugar: v("gSugar"), sodium: v("gSodium") };
      try { await updateProfile({ goals: goalsNew }); renderAll(); closeSheet(); toast("Goals saved"); } catch { /* toast shown */ }
    });
    $("#resetPw", body).addEventListener("click", async (e) => {
      e.target.disabled = true;
      try { await sendReset(state.user.email); toast(`Link sent to ${state.user.email}`); } catch { toast("Couldn't send the email. Try again later."); e.target.disabled = false; }
    });
    armButton($("#clearDay", body), "Tap again to clear this day", async () => {
      await writeDay(ymd(state.selectedDate), Object.fromEntries(MEALS.map((m) => [m.id, []]))).catch(() => {});
      closeSheet(); toast("Day cleared");
    });
    $("#signOutBtn", body).addEventListener("click", async () => { closeSheet(); await fb.signOut(fb.auth); });
  },
};

// Two-step confirm for destructive buttons.
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

// ---------- Sign in / sign up / forgot password ----------
const AUTH_ERRORS = {
  "auth/invalid-credential": "That username or password is wrong.",
  "auth/wrong-password": "That username or password is wrong.",
  "auth/user-not-found": "That username or password is wrong.",
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/email-already-in-use": "An account already uses that email. Sign in instead, or reset the password.",
  "auth/weak-password": "Use a password of at least 6 characters.",
  "auth/too-many-requests": "Too many tries. Wait a few minutes, or reset your password.",
  "auth/network-request-failed": "No internet connection. Check your connection and try again.",
  "auth/operation-not-allowed": "Email sign-in isn't turned on yet in Firebase. See the setup steps in the README.",
};
const authError = (e) => AUTH_ERRORS[e?.code] || e?.message || "Something went wrong. Try again.";

async function resolveEmail(login) {
  const v = login.trim();
  if (v.includes("@")) return v;
  const snap = await fb.getDoc(fb.doc(`usernames/${v.toLowerCase()}`));
  return snap.exists() ? snap.data().email : null;
}

async function sendReset(email) {
  const url = location.href.split("#")[0].split("?")[0];
  try { await fb.sendReset(fb.auth, email, { url }); }
  catch (e) { if (String(e?.code).includes("continue-uri") || e?.code === "auth/unauthorized-domain") await fb.sendReset(fb.auth, email); else throw e; }
}

function authView(view, msg) {
  const card = $("#authCard");
  const message = msg ? `<p class="form-msg ${msg.ok ? "ok" : "err"}">${esc(msg.text)}</p>` : "";
  if (view === "signin") {
    card.innerHTML = `
      <h2>Sign in</h2>
      <p class="lead">Use your username or email.</p>
      <form id="authForm" class="stack" novalidate>
        <div class="field"><label for="aLogin">Username or email</label><input id="aLogin" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
        <div class="field"><label for="aPw">Password</label><input id="aPw" type="password" autocomplete="current-password" required></div>
        <button class="primary" type="submit" id="aSubmit" style="margin-top:4px">Sign in</button>
      </form>
      ${message}
      <div class="auth-links"><button data-auth="forgot">Forgot password?</button><button data-auth="signup">Create an account</button></div>`;
    $("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const login = $("#aLogin").value, pw = $("#aPw").value;
      if (!login.trim() || !pw) return authView("signin", { text: "Enter your username or email and your password." });
      $("#aSubmit").disabled = true;
      try {
        const email = await resolveEmail(login);
        if (!email) return authView("signin", { text: "That username or password is wrong." });
        await fb.signIn(fb.auth, email, pw);
      } catch (err) { authView("signin", { text: authError(err) }); }
    });
  } else if (view === "signup") {
    card.innerHTML = `
      <h2>Create an account</h2>
      <p class="lead">Your log syncs to any phone you sign in on.</p>
      <form id="authForm" class="stack" novalidate>
        <div class="field"><label for="sUser">Username</label><input id="sUser" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="e.g. Grace"><div class="hint">3–20 letters, numbers, dots, dashes or underscores.</div></div>
        <div class="field"><label for="sEmail">Email</label><input id="sEmail" type="email" autocomplete="email" autocapitalize="none" spellcheck="false"><div class="hint">Used to reset your password if you forget it.</div></div>
        <div class="field"><label for="sPw">Password</label><input id="sPw" type="password" autocomplete="new-password"><div class="hint">At least 6 characters.</div></div>
        <div class="field"><label for="sKcal">Daily calorie goal (kcal)</label><input id="sKcal" type="number" inputmode="numeric" value="1800" min="800" max="6000"></div>
        <button class="primary" type="submit" id="aSubmit" style="margin-top:4px">Create account</button>
      </form>
      ${message}
      <div class="auth-links"><button data-auth="signin">I already have an account</button></div>`;
    $("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = $("#sUser").value.trim(), email = $("#sEmail").value.trim(), pw = $("#sPw").value;
      const kcal = Math.min(6000, Math.max(800, num($("#sKcal").value) || 1800));
      if (!/^[A-Za-z0-9_.-]{3,20}$/.test(username)) return authView("signup", { text: "Usernames are 3–20 letters, numbers, dots, dashes or underscores." });
      if (!email.includes("@")) return authView("signup", { text: "Enter your email address." });
      if (pw.length < 6) return authView("signup", { text: "Use a password of at least 6 characters." });
      $("#aSubmit").disabled = true;
      state.signingUp = true;
      try {
        const taken = await fb.getDoc(fb.doc(`usernames/${username.toLowerCase()}`));
        if (taken.exists()) { state.signingUp = false; return authView("signup", { text: "That username is taken. Pick another one." }); }
        const cred = await fb.signUp(fb.auth, email, pw);
        const u = cred.user.uid;
        await fb.setDoc(fb.doc(`usernames/${username.toLowerCase()}`), { uid: u, email });
        await fb.setDoc(fb.doc(`users/${u}`), { username, email, goals: goalsFor(kcal), recents: [], customFoods: [], createdAt: new Date().toISOString() });
      } catch (err) {
        authView("signup", { text: authError(err) });
      } finally {
        state.signingUp = false;
      }
    });
  } else if (view === "forgot") {
    card.innerHTML = `
      <h2>Reset your password</h2>
      <p class="lead">Enter your username or email. We'll email you a link to choose a new password.</p>
      <form id="authForm" class="stack" novalidate>
        <div class="field"><label for="fLogin">Username or email</label><input id="fLogin" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
        <button class="primary" type="submit" id="aSubmit" style="margin-top:4px">Send reset link</button>
      </form>
      ${message}
      <div class="auth-links"><button data-auth="signin">Back to sign in</button></div>`;
    $("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const login = $("#fLogin").value;
      if (!login.trim()) return authView("forgot", { text: "Enter your username or email." });
      $("#aSubmit").disabled = true;
      try {
        const email = await resolveEmail(login);
        if (email) await sendReset(email);
        authView("signin", { ok: true, text: "If that account exists, a reset link is on its way to its email. Check your spam folder too." });
      } catch (err) { authView("forgot", { text: authError(err) }); }
    });
  }
}

// ---------- Events ----------
function bindEvents() {
  $("#authCard").addEventListener("click", (e) => { const b = e.target.closest("[data-auth]"); if (b) authView(b.dataset.auth); });
  $("#days").addEventListener("click", (e) => {
    const b = e.target.closest("[data-date]");
    if (!b) return;
    state.selectedDate = parseYmd(b.dataset.date);
    renderAll();
  });
  $("#prevWeek").addEventListener("click", () => { state.selectedDate.setDate(state.selectedDate.getDate() - 7); renderAll(); });
  $("#nextWeek").addEventListener("click", () => { state.selectedDate.setDate(state.selectedDate.getDate() + 7); renderAll(); });
  $("#dateJump").addEventListener("change", (e) => { if (e.target.value) { state.selectedDate = parseYmd(e.target.value); renderAll(); } });
  $("#profileBtn").addEventListener("click", () => openSheet(null, "profile"));

  $("#meals").addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) return openSheet(add.dataset.add, "add");
    const del = e.target.closest("[data-del]");
    if (del) { const [m, id] = del.dataset.del.split(":"); removeEntry(m, id); }
  });
  $("#recs").addEventListener("click", (e) => {
    const r = e.target.closest("[data-rec]");
    if (r) openSheet(state.recPlan?.next, "detail", state.recList[+r.dataset.rec]);
  });

  $("#fabScan").addEventListener("click", () => openSheet(null, "scan"));
  $("#fabManual").addEventListener("click", () => openSheet(null, "add"));
  $("#fabHistory").addEventListener("click", () => openSheet(null, "history"));
  $("#photoInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // drop the reference to the photo
    if (!file) return;
    if (!sheetOpen()) openSheet(null, "scan");
    $("#sheetBody").innerHTML = '<div class="spinner"></div><p class="scan-status">Reading the barcode…</p>';
    const code = await decodePhoto(file);
    if (code) handleCode(code);
    else { show("scan", null, false); toast("No barcode found in that photo. Try again closer up."); }
  });

  $("#scrim").addEventListener("click", closeSheet);
  $("#sheetClose").addEventListener("click", closeSheet);
  $("#sheetBack").addEventListener("click", back);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopCamera(); });

  $("#mealTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-meal]");
    if (!b) return;
    sheet.meal = b.dataset.meal;
    $("#mealTabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    const top = sheet.stack[sheet.stack.length - 1];
    if (top && top[0] !== "scan") show(top[0], top[1], false);
  });

  $("#sheetBody").addEventListener("click", (e) => {
    const pick = e.target.closest("[data-pick]");
    if (pick) return show("detail", pickList[+pick.dataset.pick]);
    const actEl = e.target.closest("[data-act]");
    if (!actEl) return;
    const act = actEl.dataset.act;
    if (act === "scan") show("scan");
    else if (act === "photo") { stopCamera(); $("#photoInput").click(); }
    else if (act === "custom") show("custom", {});
    else if (act === "custom-q") show("custom", { name: $("#q")?.value || "" });
    else if (act === "custom-barcode") show("custom", { barcode: actEl.dataset.code });
  });
}

// ---------- Boot ----------
function showSetupNeeded() {
  $("#authScreen").hidden = false;
  $("#authCard").innerHTML = `<div class="setup"><h2>Almost ready</h2>
    <p>This copy of the app isn't connected to its database yet. Paste your Firebase settings into <b>firebase-config.js</b>, following the setup steps in the README, then reload.</p></div>`;
}

async function boot() {
  bindEvents();
  if (!firebaseConfig?.apiKey || /PASTE/i.test(firebaseConfig.apiKey)) { showSetupNeeded(); return; }
  try { await loadFirebase(); }
  catch (e) {
    console.error(e);
    $("#authScreen").hidden = false;
    $("#authCard").innerHTML = '<div class="setup"><h2>Can\'t connect</h2><p>The app couldn\'t load. Check your internet connection and reload.</p></div>';
    return;
  }
  fb.onAuthStateChanged(fb.auth, (user) => {
    stopSubscriptions();
    state.user = user;
    if (!user) {
      closeSheet();
      $("#appScreen").hidden = true;
      $("#authScreen").hidden = false;
      authView("signin");
      return;
    }
    $("#authScreen").hidden = true;
    $("#appScreen").hidden = false;
    state.selectedDate = parseYmd(todayKey());
    subscribeProfile();
    renderAll();
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
