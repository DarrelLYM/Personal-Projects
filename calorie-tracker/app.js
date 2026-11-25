// Grace's Calorie Tracker
// Free stack: GitHub Pages (hosting) + Firebase Authentication (login) + Cloud Firestore (data).
// Firestore layout (see firestore.rules):
//   users/{uid}                  { username, email, goals, recents[], customFoods[], createdAt }
//   users/{uid}/months/{YYYY-MM} { month, days: { "YYYY-MM-DD": { breakfast[], lunch[], dinner[], supper[] } } }
//   usernames/{lowercase name}   { uid, email }   lets people sign in with a username
// One document per user per month: 10 years is about 120 documents per person.
const firebaseConfig = self.FIREBASE_CONFIG;      // set in firebase-config.js
const VAPID_KEY = self.FIREBASE_VAPID_KEY || ""; // Web Push public key, also in firebase-config.js

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
// A short message at the bottom. With an action (e.g. Undo) it shows a button and stays a little longer.
function toast(msg, action) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("has-action", !!action);
  if (action) {
    const b = document.createElement("button");
    b.textContent = action.label;
    b.addEventListener("click", () => { t.classList.remove("show"); action.run(); }, { once: true });
    t.append(b);
  }
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), action ? 5000 : 2600);
}

const ICON = {
  scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 9.5a5 5 0 0 1 8 0"/><path d="M12 9.5l1.5-2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  barcode: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 9v6M10 9v6M13 9v6M16 9v6"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
  star: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg>',
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
    app: fbApp, db,
    onAuthStateChanged: auth.onAuthStateChanged,
    reauth: (user, email, pw) => auth.reauthenticateWithCredential(user, auth.EmailAuthProvider.credential(email, pw)),
    verifyBeforeUpdateEmail: auth.verifyBeforeUpdateEmail,
    sendSignInLink: auth.sendSignInLinkToEmail,
    isSignInLink: auth.isSignInWithEmailLink,
    signInWithLink: auth.signInWithEmailLink,
    deleteUser: auth.deleteUser,
    listMonths: () => fs.getDocs(fs.collection(db, `${userPath()}/months`)),
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
  if (d.weight !== undefined) out.weight = d.weight;
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
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = isObj(v) && isObj(o[k]) ? merge(o[k], v) : v; return o; };
  state.profile = merge(state.profile, patch); // same deep merge Firestore applies
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
      if ((state.profile.scheme || "purple") !== currentScheme()) applyScheme(state.profile.scheme || "purple");
      renderAll();
      if (!state.draftChecked) { state.draftChecked = true; setTimeout(restoreDraftAtStart, 0); }
      if (!snap.metadata.fromCache && !state.profileChecked) { state.profileChecked = true; afterProfileLoad(); }
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
  const needed = new Set([monthOf(ymd(start)), monthOf(ymd(end)), monthOf(todayKey()), monthOf(shiftDay(ymd(state.selectedDate), -1))]);
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
  state.profileChecked = false;
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

// ---------- Colour schemes ----------
const SCHEMES = [
  { id: "purple", name: "Purple", swatch: ["#4c1fd6", "#8b5cf6"], bar: "#4c1fd6" },
  { id: "pink", name: "Baby pink", swatch: ["#e0629a", "#f8b4cf"], bar: "#e0629a" },
  { id: "blue", name: "Baby blue", swatch: ["#3f8fdb", "#a5d3f6"], bar: "#3f8fdb" },
];
const currentScheme = () => document.documentElement.dataset.scheme || "purple";
// Applies a scheme to the page. Kept on this device too, so the app opens in the right colours before the profile loads.
function applyScheme(id) {
  const c = SCHEMES.find((x) => x.id === id) || SCHEMES[0];
  document.documentElement.dataset.scheme = c.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", c.bar);
  try { localStorage.setItem("gct-scheme", c.id); } catch {}
}

// ---------- Prices (typed in by the user; never filled in automatically) ----------
const SPEND_TYPES = [
  { id: "fast", name: "Fast food", color: "#d6457f" },
  { id: "hawker", name: "Hawker & kopitiam", color: "#12a150" },
  { id: "drinks", name: "Bubble tea & drinks", color: "#f59e0b" },
  { id: "cafe", name: "Café", color: "#9a5b34" },
  { id: "conv", name: "Convenience store", color: "#2563eb" },
  { id: "groc", name: "Groceries & packaged", color: "#7c3aed" },
  { id: "other", name: "Other", color: "#9a7586" },
];
const spendTypeName = (id) => (SPEND_TYPES.find((t) => t.id === id) || SPEND_TYPES[6]).name;
const FAST_RE = /mcdonald|kfc|subway|burger king|jollibee|texas chicken|mos burger|4fingers|pizza hut|domino|stuff'?d|potato corner|old chang kee|guzman|saladstop|popeyes|long john/i;
const DRINK_RE = /liho|koi|gong cha|chicha|mixue|bubble tea|tiger sugar|playmade|each a cup|r&b|heytea|chagee/i;
const CAFE_RE = /ya kun|toast box|starbucks|coffee bean|mr bean|kopitiam coffee/i;
const GROCERY_CATS = /fruit|vegetable|dairy|nuts|sauces|sweets|snacks/i;
// Best guess at the type of food for the spending breakdown; the user can change it per entry.
function spendType(e) {
  if (e.ptype && SPEND_TYPES.some((t) => t.id === e.ptype)) return e.ptype;
  const who = `${e.brand || ""} ${e.source || ""} ${e.name || ""}`;
  if (/7-eleven/i.test(who)) return "conv";
  if (DRINK_RE.test(who)) return "drinks";
  if (CAFE_RE.test(who)) return "cafe";
  if (FAST_RE.test(who)) return "fast";
  if (e.tier === "t" || e.barcode) return "groc";
  if (/SG FoodID|HPB/i.test(e.source || "")) return GROCERY_CATS.test(e.category || "") ? "groc" : "hawker";
  return "other";
}
const hasPrice = (e) => e.price !== null && e.price !== undefined && e.price !== "" && Number.isFinite(Number(e.price));
const money = (v) => "$" + (Math.abs(v) >= 10000 ? Math.round(v).toLocaleString("en-SG") : num(v).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const spentOf = (entries) => entries.reduce((s, e) => s + (hasPrice(e) ? num(e.price) : 0), 0);
// Parses the price box: blank means "no price"; otherwise dollars rounded to cents.
function readPrice(v) {
  const t = String(v ?? "").replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = parseFloat(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}
const priceField = (id, val = "") => `<div class="field price-field"><label for="${id}">Price paid (optional)</label><div class="money-in"><span>$</span><input id="${id}" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" value="${esc(val ?? "")}"></div></div>`;

// ---------- Rendering ----------
// Weeks run Monday to Sunday.
function weekStart(d) { const s = new Date(d); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); s.setHours(0, 0, 0, 0); return s; }

function renderHeader() {
  const name = state.profile?.username || "";
  $("#profileInitial").textContent = name ? name.charAt(0).toUpperCase() : "·";
  const photo = state.profile?.photo;
  const btn = $("#profileBtn");
  btn.style.backgroundImage = photo && /^data:image\/(jpeg|png|webp);base64,/.test(photo) ? `url("${photo}")` : "";
  btn.classList.toggle("has-photo", !!btn.style.backgroundImage);
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
      <span class="dow">${dows[d.getDay()]}</span><span class="dnum">${d.getDate()}</span>${has ? '<span class="dot"></span>' : ""}</button>`;
  }
  $("#days").innerHTML = html;
}

function renderSpentLine() {
  const entries = MEALS.flatMap((m) => dayData(ymd(state.selectedDate))[m.id]);
  const el = $("#spentLine");
  el.hidden = !entries.some(hasPrice);
  el.innerHTML = el.hidden ? "" : `<b>${money(spentOf(entries))}</b> spent ${ymd(state.selectedDate) === todayKey() ? "today" : "this day"}`;
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
  const sugar = e.sugar == null ? "" : ` · S ${fmt(num(e.sugar) * q)}g`;
  const macros = num(e.protein) || num(e.carbs) || num(e.fat) ? ` · P ${fmt(num(e.protein) * q)}g · C ${fmt(num(e.carbs) * q)}g · F ${fmt(num(e.fat) * q)}g` : "";
  return `${q !== 1 ? `${r1(q)} × ` : ""}${esc(e.serving)}${macros}${macros ? sugar : ""}`;
}

const shiftDay = (key, n) => { const d = parseYmd(key); d.setDate(d.getDate() + n); return ymd(d); };
const relDay = (key) => (key === todayKey() ? "today" : key === shiftDay(todayKey(), -1) ? "yesterday" : prettyDate(key));

function renderMeals() {
  const sel = ymd(state.selectedDate);
  const day = dayData(sel);
  const now = sel === todayKey() ? mealForNow() : null;
  let html = MEALS.map((m) => {
    const entries = day[m.id];
    const kcal = totalsOf(entries).kcal;
    const spent = entries.some(hasPrice) ? ` · ${money(spentOf(entries))}` : "";
    const sub = entries.length ? `${fmt(kcal)} kcal · ${entries.length} item${entries.length > 1 ? "s" : ""}${spent}` : "Optional · tap + to log";
    return `<div class="meal">
      <div class="meal-head">
        <div class="meal-title"><h2>${m.name}${m.id === now ? '<span class="tag-now">now</span>' : ""}</h2><div class="sub">${sub}</div></div>
        <button class="add-btn" data-add="${m.id}" aria-label="Add to ${m.name}">${ICON.plus}</button>
      </div>
      ${entries.length ? `<ul class="entries">${entries.map((e) => `
        <li class="swipe-row" data-row="${m.id}:${esc(e.id)}">
          <div class="swipe-bg" aria-hidden="true"><span class="sb-label">${ICON.trash}<b class="sb-hint">Delete</b><b class="sb-go">Release to delete</b></span></div>
          <div class="entry">
            <button class="e-main e-edit" data-edit="${m.id}:${esc(e.id)}" aria-label="Edit ${esc(e.name)} (swipe left to delete)"><div class="e-name">${esc(e.name)}</div><div class="e-meta">${entryMeta(e)}</div></button>
            <div class="e-right"><div class="e-kcal">${fmt(num(e.kcal) * (num(e.qty) || 1))}</div>${hasPrice(e) ? `<div class="e-price">${money(num(e.price))}</div>` : ""}</div>
          </div>
        </li>`).join("")}</ul>` : ""}
    </div>`;
  }).join("");
  const empty = MEALS.every((m) => !day[m.id].length);
  const prevKey = shiftDay(sel, -1);
  const prev = dayData(prevKey);
  const prevCount = MEALS.reduce((n, m) => n + prev[m.id].length, 0);
  if (empty && prevCount) {
    html += `<button class="secondary copy-day" data-copyday="${prevKey}">Copy all ${prevCount} item${prevCount > 1 ? "s" : ""} from ${esc(relDay(prevKey))}</button>`;
  }
  $("#meals").innerHTML = html;
}

// ---------- Weight (optional, one reading per day, in kg) ----------
const hasWeight = (d) => d && typeof d.weight === "number" && d.weight > 0;
function setWeight(dateKey, kg) {
  const day = dayData(dateKey);
  return writeDay(dateKey, { ...day, weight: kg === null ? null : Math.round(kg * 10) / 10 });
}
// Latest reading before a date, from the months already loaded on this device.
function previousWeight(dateKey) {
  let best = null;
  for (const m of Object.values(state.months)) for (const [k, d] of Object.entries(m?.days || {})) {
    if (k < dateKey && hasWeight(d) && (!best || k > best[0])) best = [k, d.weight];
  }
  return best;
}
const kg = (v) => `${(Math.round(v * 10) / 10).toFixed(1)} kg`;

function renderWeight() {
  const sel = ymd(state.selectedDate);
  const d = dayData(sel);
  const prev = previousWeight(sel);
  let main, sub;
  if (hasWeight(d)) {
    main = kg(d.weight);
    if (prev) {
      const diff = Math.round((d.weight - prev[1]) * 10) / 10;
      sub = diff === 0 ? `Same as ${relDay(prev[0])}` : `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)} kg since ${relDay(prev[0])}`;
    } else sub = "Tap to change";
  } else {
    main = sel === todayKey() ? "Log today's weight" : "Log weight for this day";
    sub = prev ? `Last: ${kg(prev[1])} (${relDay(prev[0])})` : "Optional";
  }
  $("#weight").innerHTML = `<button class="weight-card" data-act-main="weight">
    <span class="w-ico">${ICON.scale}</span>
    <span class="w-txt"><b>${esc(main)}</b><small>${esc(sub)}</small></span>
    <span class="w-go">${hasWeight(d) ? "Edit" : "Add"}</span></button>`;
}

// ---------- Recommendations ----------
// Only foods with official nutrition data are recommended.
const BREAKFAST_RE = /prata|thosai|dosa|porridge|congee|chee cheong|chwee|kaya|toast|you tiao|carrot cake|lor mee|fishball|bee hoon|nasi lemak|mee siam|mee rebus|popiah|soon kueh|png kueh|bread|bun|muffin|hotcake|pancake|egg|oat|cereal|idli|appam|putu|kueh|sandwich|breakfast|wrap|bagel|croissant/i;

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
  const min = Math.max(150, Math.min(250, budget * 0.45));
  const scored = [];
  for (const f of foodDb.items) {
    if (f.tier !== "o") continue;
    const ok = f.kind === "meal" || (next === "supper" && f.kind === "snack");
    if (!ok) continue;
    if (next === "breakfast" && !f.bf) continue;
    if (f.kcal > budget || f.kcal < min) continue;
    let score = (num(f.protein) * 4 / Math.max(f.kcal, 1)) * (proteinLeft > 0 ? 10 : 4);
    score += 1 - Math.abs(0.8 - f.kcal / Math.max(budget, 1));
    if (sugarLeft < 15 && f.sugar != null) score -= f.sugar / 10;
    if (f.sodium != null) score -= f.sodium / 3000;
    scored.push([score, f]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const perGroup = {};
  const meals = [];
  for (const [, f] of scored) {
    const k = f.brand || f.sub || f.category;
    perGroup[k] = (perGroup[k] || 0) + 1;
    if (perGroup[k] > 2) continue;
    meals.push(f);
    if (meals.length >= 8) break;
  }
  const seen = new Set();
  const drinks = foodDb.items
    .filter((f) => f.tier === "o" && f.kind === "drink" && f.sugar != null && f.kcal <= Math.max(20, Math.min(130, plan.remaining)))
    .sort((a, b) => (a.sugar - b.sugar) || (a.kcal - b.kcal))
    .filter((f) => { const k = (f.brand + " " + f.name.split(/[(,]/)[0]).trim(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 6);
  return { meals, drinks };
}

function recCard(f, idx, budget, next) {
  const pct = budget > 0 ? Math.round((f.kcal / budget) * 100) : 0;
  return `<button class="rec" data-rec="${idx}">
    <span class="r-cat">${esc(f.brand || f.sub || f.category)}</span>
    <span class="r-name">${esc(f.name)}</span>
    <span class="r-kcal">${fmt(f.kcal)} <small>kcal · ${esc(f.serving)}</small></span>
    <span class="r-macros">P ${fmt(num(f.protein))}g · C ${fmt(num(f.carbs))}g · F ${fmt(num(f.fat))}g${f.sugar == null ? "" : ` · S ${fmt(f.sugar)}g`}</span>
    ${budget > 0 ? `<span class="r-fit">${pct}% of your ${mealName(next).toLowerCase()} budget</span>` : ""}
  </button>`;
}

function renderRecs() {
  const el = $("#recs");
  if (!foodDb.items.length) { el.innerHTML = ""; return; }
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
    why = `You have <b>${fmt(plan.remaining)} kcal</b> left. For ${meal}, aim for about <b>${fmt(plan.budget)} kcal</b>${proteinLeft > 10 ? ` and some of the <b>${fmt(proteinLeft)}g protein</b> you still need` : ""}. These picks fit, all with official nutrition data:`;
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
  const dayEntries = MEALS.flatMap((m) => dayData(ymd(state.selectedDate))[m.id]);
  if (dayEntries.some(hasPrice)) cells.push(["Spent", money(spentOf(dayEntries)), ""]);
  $("#summary").innerHTML = `<h3>Day summary</h3><div class="grid">${cells.map(([k, v, s]) => `<div class="cell"><div class="k">${k}</div><div class="v">${v} <small>${s}</small></div></div>`).join("")}</div>`;
}

function renderAll(subs = true) {
  if (!state.user) return;
  if (subs) ensureMonthSubs();
  renderHeader();
  renderWeek();
  renderBars();
  renderSpentLine();
  renderMeals();
  renderWeight();
  renderRecs();
  renderSummary();
}

// ---------- Logging ----------
const orNull = (v, round) => (v === null || v === undefined || v === "" ? null : round(num(v)));

function compactFood(f) {
  const out = { id: f.id || "f" + uid(), name: String(f.name), serving: String(f.serving || "1 serving"), category: String(f.category || ""),
    source: String(f.source || ""), tier: String(f.tier || "u"),
    kcal: r0(num(f.kcal)), protein: r1(num(f.protein)), carbs: r1(num(f.carbs)), fat: r1(num(f.fat)),
    sugar: orNull(f.sugar, r1), sodium: orNull(f.sodium, r0) };
  if (f.brand) out.brand = String(f.brand);
  if (f.barcode) out.barcode = String(f.barcode);
  if (f.grams) out.grams = r1(num(f.grams));
  return out;
}

function addEntry(mealId, food, qty, price = null, dateKey = ymd(state.selectedDate)) {
  const day = dayData(dateKey);
  const f = compactFood(food);
  const entry = { ...f, id: uid(), qty: r1(num(qty) * 100) / 100 || 1, at: new Date().toISOString() };
  if (price !== null && price !== undefined) entry.price = price;
  writeDay(dateKey, { ...day, [mealId]: [...day[mealId], entry] }).catch(() => {});
  const recents = [f, ...(state.profile?.recents || []).filter((r) => !(r.name === f.name && r.serving === f.serving))].slice(0, 25);
  updateProfile({ recents }).catch(() => {});
}

function addEntries(mealId, entries, dateKey = ymd(state.selectedDate)) {
  const day = dayData(dateKey);
  const fresh = entries.map((e) => ({ ...e, id: uid(), at: new Date().toISOString() }));
  return writeDay(dateKey, { ...day, [mealId]: [...day[mealId], ...fresh] });
}

function removeEntry(mealId, id) {
  const dateKey = ymd(state.selectedDate);
  const day = dayData(dateKey);
  const idx = day[mealId].findIndex((e) => e.id === id);
  if (idx < 0) return;
  const removed = day[mealId][idx];
  writeDay(dateKey, { ...day, [mealId]: day[mealId].filter((e) => e.id !== id) }).catch(() => {});
  toast(`Removed ${removed.name}`, { label: "Undo", run: () => {
    const now = dayData(dateKey);
    if (now[mealId].some((e) => e.id === id)) return;
    const list = [...now[mealId]];
    list.splice(Math.min(idx, list.length), 0, removed);
    writeDay(dateKey, { ...now, [mealId]: list }).catch(() => {});
  } });
}

// Swipe a logged food to the left to delete it. A red "Delete" strip shows underneath while dragging;
// letting go past the threshold deletes (with Undo), otherwise it springs back.
function enableSwipeDelete(root) {
  let st = null;
  const THRESH = 0.38;
  const reset = (row, animate = true) => {
    const card = row.querySelector(".entry");
    card.style.transition = animate ? "" : "none";
    card.style.transform = "";
    row.classList.remove("swiping", "armed");
  };
  root.addEventListener("pointerdown", (e) => {
    const row = e.target.closest(".swipe-row");
    if (!row || (e.pointerType === "mouse" && e.button !== 0)) return;
    st = { row, card: row.querySelector(".entry"), x0: e.clientX, y0: e.clientY, dx: 0, on: false, id: e.pointerId, w: row.offsetWidth };
  });
  root.addEventListener("pointermove", (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x0, dy = e.clientY - st.y0;
    if (!st.on) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dy) > Math.abs(dx) || dx > 0) { st = null; return; } // a scroll or a right swipe
      st.on = true;
      st.card.style.transition = "none";
      st.row.classList.add("swiping");
      try { st.row.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    st.dx = Math.min(0, dx);
    st.card.style.transform = `translateX(${st.dx}px)`;
    st.row.classList.toggle("armed", -st.dx > st.w * THRESH);
  });
  const finish = (e) => {
    if (!st || (e && e.pointerId !== st.id)) return;
    const { row, card, dx, on, w } = st;
    st = null;
    if (!on) return;
    row.dataset.swiped = "1"; // swallow the click that follows the drag
    setTimeout(() => delete row.dataset.swiped, 350);
    if (-dx > w * THRESH) {
      card.style.transition = "transform .18s ease-in";
      card.style.transform = `translateX(${-w - 20}px)`;
      const [m, id] = row.dataset.row.split(":");
      setTimeout(() => removeEntry(m, id), 170);
    } else reset(row);
  };
  root.addEventListener("pointerup", finish);
  root.addEventListener("pointercancel", (e) => { if (st && e.pointerId === st.id) { const r = st.row; st = null; reset(r); } });
  root.addEventListener("click", (e) => {
    const row = e.target.closest(".swipe-row");
    if (row?.dataset.swiped) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}

function findEntry(mealId, id) {
  return dayData(ymd(state.selectedDate))[mealId].find((e) => e.id === id) || null;
}

function saveEditedEntry(fromMeal, toMeal, id, patch) {
  const dateKey = ymd(state.selectedDate);
  const day = dayData(dateKey);
  const old = day[fromMeal].find((e) => e.id === id);
  if (!old) return Promise.resolve();
  const updated = { ...old, ...patch, edited: new Date().toISOString() };
  const next = { ...day };
  if (fromMeal === toMeal) next[fromMeal] = day[fromMeal].map((e) => (e.id === id ? updated : e));
  else { next[fromMeal] = day[fromMeal].filter((e) => e.id !== id); next[toMeal] = [...day[toMeal], updated]; }
  return writeDay(dateKey, next);
}

function copyDay(fromKey) {
  const src = dayData(fromKey);
  const toKey = ymd(state.selectedDate);
  const day = dayData(toKey);
  const next = { ...day };
  for (const m of MEALS) next[m.id] = [...day[m.id], ...src[m.id].map((e) => ({ ...e, id: uid(), at: new Date().toISOString() }))];
  // (weight belongs to its own day and isn't copied)
  return writeDay(toKey, next);
}

function isFavourite(f) {
  return (state.profile?.favorites || []).some((x) => x.name === f.name && x.serving === f.serving);
}

function toggleFavourite(f) {
  const favs = state.profile?.favorites || [];
  const on = isFavourite(f);
  const next = on ? favs.filter((x) => !(x.name === f.name && x.serving === f.serving)) : [compactFood(f), ...favs].slice(0, 100);
  updateProfile({ favorites: next }).catch(() => {});
  return !on;
}

// ---------- Sheet ----------
const sheet = { meal: mealForNow(), stack: [] };
const sheetOpen = () => $("#sheet").classList.contains("open");

// ---------- Back button ----------
// Each screen opened in the sheet adds a browser history entry, so the phone's back button
// steps back through them (and finally closes the sheet) instead of leaving the app.
let navDepth = 0;
function navPush() {
  navDepth++;
  try { history.pushState({ gctDepth: navDepth }, ""); } catch { /* ignore */ }
}
window.addEventListener("popstate", (e) => {
  const d = e.state?.gctDepth || 0;
  if (d >= navDepth) { navDepth = d; return; }
  navDepth = d;
  if (!sheetOpen()) return;
  const len = d - sheet.base;
  if (len <= 0) { hideSheet(); return; }
  while (sheet.stack.length > len) sheet.stack.pop();
  const [view, arg] = sheet.stack[sheet.stack.length - 1];
  show(view, arg, false);
});

// ---------- Unsaved typing (kept for 2 minutes) ----------
const DRAFT_KEY = "gct-draft", DRAFT_MS = 2 * 60 * 1000;
const DRAFT_VIEWS = new Set(["add", "quick", "custom", "detail", "editEntry", "weight", "editUsername", "editEmail", "profile"]);
const slimArg = (arg) => (arg && typeof arg === "object" ? Object.fromEntries(Object.entries(arg).filter(([k]) => k !== "hay" && k !== "words")) : arg ?? null);
// Drafts are kept per screen (view + what it's showing), so going back to an earlier screen restores it too.
const draftKey = (view, arg) => view + ":" + JSON.stringify(slimArg(arg));
function readDrafts() {
  try {
    const all = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}");
    const out = {};
    for (const [k, d] of Object.entries(all && typeof all === "object" && !all.view ? all : {})) {
      if (d && Date.now() - d.at <= DRAFT_MS && d.uid === state.user?.uid) out[k] = d;
    }
    return out;
  } catch { return {}; }
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }
function saveDraft(view, arg) {
  if (!DRAFT_VIEWS.has(view) || !state.user) return;
  const vals = {};
  $("#sheetBody").querySelectorAll("input[id], select[id], textarea[id]").forEach((el) => {
    if (el.type === "password" || el.type === "file") return;
    vals[el.id] = el.type === "checkbox" ? el.checked : el.value;
  });
  const all = readDrafts();
  all[draftKey(view, arg)] = { uid: state.user.uid, view, arg: slimArg(arg), meal: sheet.meal, date: ymd(state.selectedDate), vals, at: Date.now() };
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}
// Refills the screen if what was being typed on it was left less than 2 minutes ago.
function fillDraft(view, arg) {
  const d = readDrafts()[draftKey(view, arg)];
  if (!d || d.date !== ymd(state.selectedDate)) return false;
  const body = $("#sheetBody");
  let n = 0;
  for (const [id, v] of Object.entries(d.vals)) {
    const el = body.querySelector("#" + CSS.escape(id));
    if (!el) continue;
    let changed = false;
    if (el.type === "checkbox") { if (el.checked !== v && !el.disabled) { el.checked = v; changed = true; } }
    else if (el.value !== v) { el.value = v; changed = true; }
    if (changed) { n++; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
  }
  return n > 0;
}
// On opening the app: go back to the most recent unfinished screen, if any.
function restoreDraftAtStart() {
  const d = Object.values(readDrafts()).sort((a, b) => b.at - a.at)[0];
  if (!d || sheetOpen() || !VIEWS[d.view]) return;
  state.selectedDate = parseYmd(d.date);
  renderAll();
  openSheet(d.meal, d.view, d.arg ?? undefined);
}

function openSheet(mealId, view = "add", arg) {
  sheet.meal = mealId || (ymd(state.selectedDate) === todayKey() ? mealForNow() : sheet.meal);
  sheet.stack = [];
  sheet.base = navDepth;
  $("#scrim").classList.add("open");
  $("#sheet").classList.add("open");
  show(view, arg);
}

// Drag the sheet down to close it: from the grip/title bar anywhere, or from the content when it's scrolled to the top.
function enableSheetDrag() {
  const el = $("#sheet"), body = $("#sheetBody"), scrim = $("#scrim");
  let y0 = null, x0 = 0, dy = 0, t0 = 0, decided = false, fromBody = false;
  const begin = (x, y, isBody) => { y0 = y; x0 = x; dy = 0; t0 = Date.now(); decided = !isBody; fromBody = isBody; if (!isBody) el.style.transition = "none"; };
  const reset = () => { el.style.transition = ""; el.style.transform = ""; scrim.style.opacity = ""; };
  const move = (x, y, e) => {
    if (y0 === null) return;
    if (!decided) {
      const ady = y - y0, adx = Math.abs(x - x0);
      if (Math.abs(ady) < 8 && adx < 8) return;
      // From the content: only a downward drag while already at the top closes; anything else is a normal scroll.
      if (ady <= 0 || adx > Math.abs(ady) || body.scrollTop > 0) { y0 = null; return; }
      decided = true; el.style.transition = "none";
    }
    dy = Math.max(0, y - y0);
    el.style.transform = `translateY(${dy}px)`;
    scrim.style.opacity = String(Math.max(0.2, 1 - dy / 500));
    if (e.cancelable) e.preventDefault();
  };
  const end = () => {
    if (y0 === null) return;
    y0 = null;
    const fast = dy / Math.max(1, Date.now() - t0) > 0.5 && dy > 40;
    const shut = decided && (dy > Math.min(160, el.offsetHeight * 0.25) || fast);
    reset();
    if (shut) closeSheet({ keepDraft: true });
  };
  const grabZone = (t) => t.closest(".sheet-grip, .sheet-head") && !t.closest("button, input, select");
  el.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (grabZone(e.target)) begin(t.clientX, t.clientY, false);
    else if (body.contains(e.target) && body.scrollTop <= 0 && !e.target.closest("video, .chips, .meal-tabs, .rec-row")) begin(t.clientX, t.clientY, true);
  }, { passive: true });
  el.addEventListener("touchmove", (e) => { const t = e.touches[0]; move(t.clientX, t.clientY, e); }, { passive: false });
  el.addEventListener("touchend", end);
  el.addEventListener("touchcancel", () => { y0 = null; reset(); });
  // Mouse: drag the grip or title bar.
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !grabZone(e.target)) return;
    begin(e.clientX, e.clientY, false);
    const mm = (ev) => move(ev.clientX, ev.clientY, ev);
    const mu = () => { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); end(); };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
  });
}

// Closes the sheet. After saving, the typed-in draft is dropped; when the user just
// dismisses the sheet (✕, drag, back), it's kept for 2 minutes in case that was an accident.
function closeSheet(opts = {}) {
  if (!opts.keepDraft) clearDraft();
  if (navDepth > 0) { const n = navDepth; navDepth = 0; try { history.go(-n); } catch { /* ignore */ } }
  hideSheet();
}
function hideSheet() {
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
  if (push) { sheet.stack.push([view, arg]); navPush(); }
  $("#sheetBack").hidden = sheet.stack.length < 2;
  const body = $("#sheetBody");
  body.scrollTop = 0;
  VIEWS[view](body, arg);
  if (DRAFT_VIEWS.has(view) && fillDraft(view, arg)) toast("Restored what you were typing");
}

function back() {
  if (navDepth > sheet.base) { history.back(); return; }
  sheet.stack.pop();
  const [view, arg] = sheet.stack[sheet.stack.length - 1] || ["add"];
  show(view, arg, false);
}

// ---------- Food data ----------
// data/foods.json: HPB SG FoodID, official chain data and labelled estimates (see scripts/foods).
// data/packaged.json: packaged foods sold in Singapore from Open Food Facts (refreshed weekly).
const foodDb = { items: [], info: null, loading: null, packaged: null, packLoading: null, byBarcode: new Map() };
const TIER_LABEL = { o: "Official", t: "From the product label", e: "Estimate – not official", u: "Your entry" };

function prepFood(f) {
  f.hay = `${f.name} ${f.brand || ""} ${f.category || ""} ${f.sub || ""} ${f.desc || ""}`.toLowerCase();
  f.words = f.hay.split(/[^a-z0-9%]+/).filter(Boolean);
  return f;
}

function loadFoods() {
  if (!foodDb.loading) {
    foodDb.loading = fetch("data/foods.json").then((r) => { if (!r.ok) throw new Error("foods " + r.status); return r.json(); }).then((j) => {
      foodDb.info = j.info;
      const S = j.sources;
      foodDb.items = j.items.map((x) => prepFood({
        id: x.i, name: x.n, brand: x.b || "", category: x.c, sub: x.g || "", desc: x.d || "", serving: x.s, grams: x.w || 0,
        kcal: x.k, protein: x.p, carbs: x.cb, fat: x.f, sugar: x.su ?? null, sodium: x.na ?? null,
        tier: x.t, source: S[x.src].label, srcNote: x.sn || S[x.src].note || "", kind: x.kd || "", bf: !!x.bf, alt: x.alt || null,
      }));
    });
    foodDb.loading.catch(() => { foodDb.loading = null; });
  }
  return foodDb.loading;
}

function loadPackaged() {
  if (!foodDb.packLoading) {
    foodDb.packLoading = fetch("data/packaged.json").then((r) => { if (!r.ok) throw new Error("packaged " + r.status); return r.json(); }).then((j) => {
      foodDb.packagedUpdated = j.updated;
      foodDb.packaged = j.items.map(([code, name, brand, serving, sg, k, p, c, f, s, na]) => {
        const g = sg || 100;
        const x = (v) => (v == null ? null : r1((v * g) / 100));
        const food = prepFood({
          id: "off" + code, barcode: code, name, brand, category: "Packaged", serving: sg ? serving : "100 g / ml", grams: g,
          kcal: r0((k * g) / 100), protein: x(p), carbs: x(c), fat: x(f), sugar: x(s), sodium: na == null ? null : r0((na * g) / 100),
          tier: "t", source: "Open Food Facts", srcNote: "Product label values, entered by Open Food Facts volunteers",
        });
        foodDb.byBarcode.set(code, food);
        return food;
      });
    });
    foodDb.packLoading.catch(() => { foodDb.packLoading = null; });
  }
  return foodDb.packLoading;
}

const customFoods = () => (state.profile?.customFoods || []).map((f) => prepFood({ ...f, tier: f.tier || "u", category: "My foods" }));
const allFoods = () => [...customFoods(), ...foodDb.items];

// ---------- Food search ----------
let activeCategory = "All";
const SYNONYMS = {
  "cai fan": ["economic rice", "mixed rice"], "cai png": ["economic rice", "mixed rice"], "chap chye png": ["economic rice", "mixed rice"],
  "economic rice": ["mixed rice"], "kopi": ["coffee"], "teh": ["tea"], "kosong": ["sugar % 0", "no sugar", "unsweetened"],
  "siew dai": ["less sugar"], "siu dai": ["less sugar"], "peng": ["iced", "cold"], "char siew": ["char siu"], "char siu": ["char siew"],
  "hor fun": ["kway teow", "flat rice noodles"], "kway teow": ["hor fun"], "prata": ["paratha"], "roti canai": ["prata"],
  "bubble tea": ["milk tea", "pearl"], "boba": ["pearl", "bubble tea"], "mcd": ["mcdonald"], "macs": ["mcdonald"], "mcdonalds": ["mcdonald"],
  "ckt": ["char kway teow"], "bcm": ["bak chor mee"], "ytf": ["yong tau foo"], "yong tau hu": ["yong tau foo"], "nuggets": ["mcnuggets"],
  "fries": ["french fries"], "chips": ["crisps"], "soya": ["soy"], "milo": ["malted"], "porridge": ["congee"], "congee": ["porridge"],
  "beehoon": ["bee hoon"], "mee hoon": ["bee hoon"], "laksa": ["laksa"],
};

function queryVariants(q) {
  const base = q.toLowerCase().replace(/[^a-z0-9%\s]/g, " ").replace(/\s+/g, " ").trim();
  const out = [base];
  for (const [key, alts] of Object.entries(SYNONYMS)) {
    if ((" " + base + " ").includes(" " + key + " ")) for (const a of alts) out.push(base.replace(key, a));
  }
  return [...new Set(out)].slice(0, 10);
}

function editDistance1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function scoreFood(f, tokens, phrase) {
  const name = f.name.toLowerCase();
  const base = name.replace(/\s*\(.*?\)\s*/g, " ").trim();
  let score = 0;
  if (base === phrase) score += 10;
  if (name.includes(phrase)) score += 4;
  if (name.startsWith(tokens[0])) score += 3;
  if (f.tier === "o") score += 1.5;
  if (f.tier === "u") score += 2;
  score -= base.length / 25;
  return score;
}

function searchList(list, q, limit = 60) {
  const variants = queryVariants(q).map((v) => v.split(" ").filter(Boolean)).filter((t) => t.length);
  if (!variants.length) return [];
  const hits = new Map();
  for (const f of list) {
    for (const tokens of variants) {
      if (tokens.every((t) => f.hay.includes(t))) {
        const s = scoreFood(f, tokens, tokens.join(" "));
        if (!hits.has(f) || hits.get(f) < s) hits.set(f, s);
      }
    }
  }
  if (hits.size < 3) {
    // Typo-tolerant pass: each word may be one letter off (for words of 4+ letters).
    const tokens = variants[0];
    for (const f of list) {
      if (hits.has(f)) continue;
      const fixed = [];
      const ok = tokens.every((t) => {
        if (f.hay.includes(t)) { fixed.push(t); return true; }
        if (t.length < 4) return false;
        const w = f.words.find((x) => editDistance1(t, x) || (x.length > t.length && editDistance1(t, x.slice(0, t.length))));
        if (w) fixed.push(w);
        return !!w;
      });
      // Score as if the typo had been typed correctly.
      if (ok) hits.set(f, scoreFood(f, fixed, fixed.join(" ")) - 1);
    }
  }
  return [...hits.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, limit);
}

function categoryList(cat) {
  if (cat === "My foods") return customFoods();
  if (cat === "Favourites") return (state.profile?.favorites || []).map((f) => prepFood({ ...f }));
  return foodDb.items.filter((f) => f.category === cat);
}

function searchFoods(q, cat = activeCategory, limit = 60) {
  const query = q.trim();
  const list = cat === "All" ? allFoods() : categoryList(cat);
  if (!query) return cat === "All" ? [] : list.slice(0, 200);
  return searchList(list, query, limit);
}

const tierTag = (f) => `<span class="tier tier-${esc(f.tier || "u")}">${esc(f.tier === "e" ? "Estimate" : f.tier === "o" ? "Official" : f.tier === "t" ? "Label" : "Yours")}</span>`;

function resultItem(f, idx) {
  return `<li><button class="result" data-pick="${idx}">
    <div class="r-main"><div class="r-name">${esc(f.name)}${f.brand && !f.name.toLowerCase().includes(f.brand.toLowerCase()) ? ` <span class="r-brand">${esc(f.brand)}</span>` : ""}</div>
    <div class="r-meta">${tierTag(f)} ${esc(f.serving)}${num(f.protein) || num(f.carbs) || num(f.fat) ? ` · P ${fmt(num(f.protein))}g · C ${fmt(num(f.carbs))}g · F ${fmt(num(f.fat))}g${f.sugar == null ? "" : ` · S ${fmt(f.sugar)}g`}` : ""}</div></div>
    <div class="r-kcal">${fmt(f.kcal)} kcal</div></button></li>`;
}

let pickList = [];
function renderResults(q) {
  const wrap = $("#resultsWrap");
  if (!wrap) return;
  const query = q.trim();
  let html = "";
  if (!foodDb.items.length) {
    wrap.innerHTML = '<div class="spinner"></div><p class="muted">Loading the food list…</p>';
    loadFoods().then(() => { if ($("#resultsWrap")) renderResults($("#q")?.value || ""); }).catch(() => {
      if ($("#resultsWrap")) $("#resultsWrap").innerHTML = '<p class="muted">Couldn\'t load the food list. Check your connection.</p>';
    });
    return;
  }
  if (!query && activeCategory === "All") {
    const favs = (state.profile?.favorites || []).slice(0, 8).map((f) => prepFood({ ...f }));
    const recents = (state.profile?.recents || []).filter((r) => !favs.some((f) => f.name === r.name && f.serving === r.serving)).slice(0, 10).map((f) => prepFood({ ...f }));
    pickList = [...favs, ...recents];
    if (favs.length) html += `<div class="section-label">Favourites</div><ul class="results">${favs.map((f, i) => resultItem(f, i)).join("")}</ul>`;
    if (recents.length) html += `<div class="section-label">Recent</div><ul class="results">${recents.map((f, i) => resultItem(f, favs.length + i)).join("")}</ul>`;
    if (!pickList.length) html = `<p class="muted">Search ${foodDb.items.length.toLocaleString("en-SG")} foods with official data (hawker dishes, drinks, McDonald's, Ya Kun and more), plus thousands of packaged products.</p>`;
    wrap.innerHTML = html;
    return;
  }
  pickList = searchFoods(query);
  html = pickList.length ? `<ul class="results">${pickList.map(resultItem).join("")}</ul>` : `<p class="muted">No match in the main food list.</p>`;
  if (query.length >= 2 && activeCategory === "All") {
    html += `<div id="packWrap"></div>`;
    html += `<button class="link-btn" id="onlineBtn">Search more packaged products online</button><div id="online"></div>`;
  }
  html += `<button class="link-btn" data-act="custom-q">Can't find it? Enter it manually</button>`;
  wrap.innerHTML = html;
  $("#onlineBtn")?.addEventListener("click", () => searchOnline(query));
  if (query.length >= 2 && activeCategory === "All") {
    const fill = () => {
      const box = $("#packWrap");
      if (!box || ($("#q")?.value || "").trim() !== query) return;
      const hits = searchList(foodDb.packaged || [], query, 25);
      if (!hits.length) return;
      const offset = pickList.length;
      pickList = pickList.concat(hits);
      box.innerHTML = `<div class="section-label">Packaged products</div><ul class="results">${hits.map((f, i) => resultItem(f, offset + i)).join("")}</ul>`;
    };
    if (foodDb.packaged) fill(); else loadPackaged().then(fill).catch(() => {});
  }
}

// ---------- Open Food Facts (online fallback for packaged products) ----------
function offToFood(p, code) {
  const n = p.nutriments || {};
  const hasServing = n["energy-kcal_serving"] != null && p.serving_size;
  const pick = (k) => { const v = hasServing ? n[k + "_serving"] : n[k + "_100g"]; return v == null || v === "" ? null : num(v); };
  let kcal = pick("energy-kcal");
  if (!kcal) { const kj = pick("energy"); if (kj) kcal = kj / 4.184; }
  const sodium = pick("sodium");
  return compactFood({
    id: "off" + (p.code || code || uid()), name: p.product_name || p.product_name_en || "Unnamed product", brand: p.brands ? p.brands.split(",")[0].trim() : "",
    serving: hasServing ? p.serving_size : "100 g / ml", kcal, protein: pick("proteins"), carbs: pick("carbohydrates"),
    fat: pick("fat"), sugar: pick("sugars"), sodium: sodium == null ? null : sodium * 1000, category: "Packaged", source: "Open Food Facts", tier: "t",
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
  if (mine) { show("detail", { ...mine, tier: mine.tier || "u" }); return; }
  const body = $("#sheetBody");
  try { await loadPackaged(); } catch { /* fall back to the online lookup */ }
  const local = foodDb.byBarcode.get(code);
  if (local) { show("detail", local); return; }
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

// ---------- Statistics: spending and weight ----------
const stats = { tab: "spend" };
const spend = { period: "week", offset: 0, filter: "all" };
const wstat = { period: "week", offset: 0 };
const PERIODS = [["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]];
const WPERIODS = [["week", "Week"], ["month", "Month"], ["90", "90 days"]];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const today0 = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
const daysBetween = (a, b) => Math.round((b - a) / 86400000);

// The selected period for a given offset (0 = the current one).
function periodRange(period, o) {
  const t = today0();
  if (period === "day") { const d = new Date(t); d.setDate(d.getDate() + o); return [d, d]; }
  if (period === "week") { const a = weekStart(t); a.setDate(a.getDate() + 7 * o); const b = new Date(a); b.setDate(a.getDate() + 6); return [a, b]; }
  if (period === "month") { const a = new Date(t.getFullYear(), t.getMonth() + o, 1); return [a, new Date(a.getFullYear(), a.getMonth() + 1, 0)]; }
  if (period === "90") { const b = new Date(t); b.setDate(b.getDate() + 90 * o); const a = new Date(b); a.setDate(b.getDate() - 89); return [a, b]; }
  const y = t.getFullYear() + o; return [new Date(y, 0, 1), new Date(y, 11, 31)];
}

function periodLabel(period, o, [a, b]) {
  const yr = (d) => (d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : "");
  if (period === "day") return o === 0 ? "Today" : o === -1 ? "Yesterday" : a.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  if (period === "week") return o === 0 ? "This week" : `${a.getDate()} ${MON[a.getMonth()]} – ${b.getDate()} ${MON[b.getMonth()]}${yr(b)}`;
  if (period === "month") return `${a.toLocaleDateString("en-SG", { month: "long" })} ${a.getFullYear()}`;
  if (period === "90") return o === 0 ? "Last 90 days" : `${a.getDate()} ${MON[a.getMonth()]}${yr(a)} – ${b.getDate()} ${MON[b.getMonth()]}${yr(b)}`;
  return String(a.getFullYear());
}

// A round number at or above v, for chart scales (1, 2, 2.5 or 5 × a power of ten).
function niceCeil(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v - 1e-9) return m * p;
  return 10 * p;
}
// Short money for chart labels: $7.90 → "$7.9", $12.40 → "$12", $1,250 → "$1.3k".
const moneyShort = (v) => (v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : v >= 10 || Number.isInteger(v) ? `$${Math.round(v)}` : `$${v.toFixed(1)}`);

// Vertical bar chart with a price scale on the left and the amount above each bar.
function barChart(buckets, color) {
  const max = Math.max(0, ...buckets.map((b) => b.v));
  const top = niceCeil(max);
  const ticks = [0, top / 2, top];
  return `<div class="vchart">
    <div class="yaxis">${ticks.map((t) => `<span style="bottom:${(t / top) * 100}%">${moneyShort(t)}</span>`).join("")}</div>
    <div class="plot">
      ${ticks.map((t) => `<i class="grid" style="bottom:${(t / top) * 100}%"></i>`).join("")}
      <div class="cols">${buckets.map((b) => {
        const h = (b.v / top) * 100;
        const tag = b.jump ? "button" : "div";
        return `<${tag} class="col${b.on ? " on" : ""}"${b.jump ? ` data-jump="${b.jump}"` : ""} title="${esc(b.title || b.label)}: ${money(b.v)}">
          ${b.v > 0 ? `<em style="bottom:calc(${h}% + 2px)">${moneyShort(b.v)}</em>` : ""}
          <i style="height:${b.v > 0 ? Math.max(1.5, h) : 0}%;${color ? "background:" + color : ""}"></i>
          <span class="xl">${esc(b.label)}</span></${tag}>`;
      }).join("")}</div>
    </div>
  </div>`;
}

async function runSpending() {
  const out = $("#spendOut");
  if (!out) return;
  const range = periodRange(spend.period, spend.offset);
  const [a, b] = range;
  const aKey = ymd(a), bKey = ymd(b);
  $("#spendLabel").textContent = periodLabel(spend.period, spend.offset, range);
  $("#spendNext").disabled = spend.offset >= 0;
  out.innerHTML = '<div class="spinner"></div>';
  // Load the whole chart's span: the week for Week, the year for Month, every year for Year.
  let days;
  try {
    if (spend.period === "year") days = (await allMonths()).flatMap(([, m]) => Object.entries(m.days || {}));
    else if (spend.period === "month") days = await loadRange(`${a.getFullYear()}-01-01`, `${a.getFullYear()}-12-31`);
    else days = await loadRange(aKey, bKey);
  } catch (e) { console.error(e); out.innerHTML = '<p class="muted">Couldn\'t load your spending. Check your connection.</p>'; return; }
  if (!$("#spendOut")) return;
  const ctx = [];
  let unpriced = 0;
  for (const [date, d] of days) for (const m of MEALS) for (const e of d[m.id] || []) {
    const inPeriod = date >= aKey && date <= bKey;
    if (hasPrice(e)) ctx.push({ date, meal: m.id, e, price: num(e.price), type: spendType(e), inPeriod });
    else if (inPeriod) unpriced++;
  }
  const typed = (list) => (spend.filter === "all" ? list : list.filter((x) => x.type === spend.filter));
  const all = ctx.filter((x) => x.inPeriod);
  const items = typed(all);
  const chartItems = typed(ctx);
  const total = items.reduce((s, x) => s + x.price, 0);
  const sum = (pred) => chartItems.filter(pred).reduce((s, x) => s + x.price, 0);

  let buckets, chartTitle, avg = "";
  const t = today0(), todayK = todayKey();
  if (spend.period === "day") {
    chartTitle = "By meal";
    buckets = MEALS.map((m) => ({ label: m.name, v: sum((x) => x.meal === m.id) }));
  } else if (spend.period === "week") {
    chartTitle = "By day";
    buckets = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(a); d.setDate(a.getDate() + i);
      const k = ymd(d);
      buckets.push({ label: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()], title: prettyDate(k), v: sum((x) => x.date === k), on: k === todayK,
        jump: d <= t ? `day:${daysBetween(t, d)}` : "" });
    }
    avg = `avg ${money(total / 7)} a day`;
  } else if (spend.period === "month") {
    chartTitle = `Every month of ${a.getFullYear()}`;
    buckets = MON.map((label, i) => {
      const first = new Date(a.getFullYear(), i, 1);
      const o = (first.getFullYear() - t.getFullYear()) * 12 + (i - t.getMonth());
      return { label: label.charAt(0), title: `${label} ${a.getFullYear()}`, v: sum((x) => +x.date.slice(5, 7) === i + 1), on: i === a.getMonth(), jump: o <= 0 ? `month:${o}` : "" };
    });
    const ytd = buckets.filter((bk, i) => new Date(a.getFullYear(), i, 1) <= t);
    if (ytd.length) avg = `avg ${money(ytd.reduce((s, bk) => s + bk.v, 0) / ytd.length)} a month`;
  } else {
    chartTitle = "Every year";
    const years = ctx.map((x) => +x.date.slice(0, 4));
    const cur = t.getFullYear();
    let y0 = Math.min(cur - 2, a.getFullYear(), ...years);
    y0 = Math.max(y0, cur - 9);
    buckets = [];
    for (let y = y0; y <= cur; y++) buckets.push({ label: String(y), title: String(y), v: sum((x) => +x.date.slice(0, 4) === y), on: y === a.getFullYear(), jump: `year:${y - cur}` });
  }
  const filterColor = spend.filter === "all" ? "" : SPEND_TYPES.find((x) => x.id === spend.filter).color;

  const byType = SPEND_TYPES.map((ty) => ({ ...ty, v: all.filter((x) => x.type === ty.id).reduce((s, x) => s + x.price, 0), n: all.filter((x) => x.type === ty.id).length })).filter((ty) => ty.v > 0).sort((p, q) => q.v - p.v);
  const allTotal = byType.reduce((s, ty) => s + ty.v, 0);
  const foods = new Map();
  for (const x of items) { const f = foods.get(x.e.name) || { name: x.e.name, v: 0, n: 0 }; f.v += x.price; f.n++; foods.set(x.e.name, f); }
  const top = [...foods.values()].sort((p, q) => q.v - p.v).slice(0, 8);
  const hasChart = buckets.some((bk) => bk.v > 0);

  $("#spendTotal").textContent = money(total);
  $("#spendSub").textContent = `${spend.filter === "all" ? "" : spendTypeName(spend.filter) + " · "}${items.length} item${items.length === 1 ? "" : "s"} with a price`;
  out.innerHTML = `
    ${hasChart ? `<div class="card-box"><div class="box-head"><span>${esc(chartTitle)}</span><small>${esc(avg)}</small></div>${barChart(buckets, filterColor)}
      ${buckets.some((bk) => bk.jump) ? '<p class="chart-hint">Tap a bar to open that ' + (spend.period === "week" ? "day" : spend.period) + ".</p>" : ""}</div>` : ""}
    ${!all.length ? `<p class="muted">No prices logged ${spend.period === "day" ? "on this day" : "in this period"}. Add a price when you log food, or tap a logged food to add one.</p>` : `
    <div class="card-box">
      <div class="box-head"><span>By type of food</span><small>tap to filter</small></div>
      <div class="type-stack">${byType.map((ty) => `<i style="flex:${ty.v};background:${ty.color};opacity:${spend.filter === "all" || spend.filter === ty.id ? 1 : 0.25}"></i>`).join("")}</div>
      <div class="type-list">${byType.map((ty) => `<button data-type="${ty.id}" class="${spend.filter !== "all" && spend.filter !== ty.id ? "dim" : ""}">
        <span class="tn"><i style="background:${ty.color}"></i>${esc(ty.name)}</span><span class="tv">${money(ty.v)}</span>
        <span class="tt"><i style="width:${(ty.v / allTotal) * 100}%;background:${ty.color}"></i></span>
        <span class="ts">${Math.round((ty.v / allTotal) * 100)}% · ${ty.n} item${ty.n === 1 ? "" : "s"}</span></button>`).join("")}</div>
    </div>
    <div class="section-label">Top spends</div>
    ${top.length ? `<ul class="top-foods">${top.map((f) => `<li><span>${esc(f.name)}${f.n > 1 ? ` <small>× ${f.n}</small>` : ""}</span><span>${money(f.v)}</span></li>`).join("")}</ul>` : '<p class="muted">Nothing of this type in this period.</p>'}`}
    ${unpriced ? `<p class="note">${unpriced} logged item${unpriced === 1 ? "" : "s"} in this period ha${unpriced === 1 ? "s" : "ve"} no price and ${unpriced === 1 ? "isn't" : "aren't"} counted. Tap a food on the main screen to add its price.</p>` : ""}
    ${all.length ? '<p class="note">The type of food is guessed from where the food comes from. To change it, tap the food on the main screen and pick a different type.</p>' : ""}`;
}

// Weight line chart with a kg scale on the left.
function weightChart(pts, a, b, period) {
  const W = 340, H = 170, L = 40, R = 10, T = 18, B = 22;
  const vals = pts.map((p) => p[1]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 2) { const mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1; }
  const step = [0.5, 1, 2, 5, 10, 20].find((s) => (hi - lo) / s <= 4) || 20;
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const span = Math.max(1, daysBetween(a, b));
  const x = (k) => L + (daysBetween(a, parseYmd(k)) / span) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 10) / 10);
  const xl = [];
  if (period === "week") for (let i = 0; i < 7; i++) { const d = new Date(a); d.setDate(a.getDate() + i); xl.push([ymd(d), ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]]); }
  else if (period === "month") for (const n of [1, 8, 15, 22, 29]) { const d = new Date(a.getFullYear(), a.getMonth(), n); if (d <= b) xl.push([ymd(d), String(n)]); }
  else { const d = new Date(a.getFullYear(), a.getMonth() + 1, 1); for (; d <= b; d.setMonth(d.getMonth() + 1)) xl.push([ymd(d), MON[d.getMonth()]]); }
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(" ");
  return `<svg class="w-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight chart">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" class="ax">${v % 1 ? v.toFixed(1) : v}</text>`).join("")}
    ${xl.map(([k, l]) => `<text x="${x(k).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="ax">${l}</text>`).join("")}
    ${pts.length > 1 ? `<path d="${line}" fill="none" stroke="var(--purple)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : ""}
    ${pts.map((p) => `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="${period === "90" ? 3 : 4}" fill="var(--card)" stroke="var(--purple)" stroke-width="2"><title>${esc(prettyDate(p[0]))}: ${p[1].toFixed(1)} kg</title></circle>`).join("")}
    ${period === "week" ? pts.map((p) => `<text x="${x(p[0]).toFixed(1)}" y="${(y(p[1]) - 9).toFixed(1)}" text-anchor="middle" class="pv">${p[1].toFixed(1)}</text>`).join("") : ""}
  </svg>`;
}

async function runWeightStats() {
  const out = $("#wsOut");
  if (!out) return;
  const range = periodRange(wstat.period, wstat.offset);
  const [a, b] = range;
  $("#wsLabel").textContent = periodLabel(wstat.period, wstat.offset, range);
  $("#wsNext").disabled = wstat.offset >= 0;
  out.innerHTML = '<div class="spinner"></div>';
  let days;
  try { days = await loadRange(ymd(a), ymd(b)); } catch (e) { console.error(e); out.innerHTML = '<p class="muted">Couldn\'t load your readings. Check your connection.</p>'; return; }
  if (!$("#wsOut")) return;
  const pts = days.filter(([, d]) => hasWeight(d)).map(([k, d]) => [k, d.weight]);
  // Change only uses readings inside this chart: latest minus first. With none or one reading it's 0.
  const first = pts[0], last = pts[pts.length - 1];
  const change = pts.length > 1 ? Math.round((last[1] - first[1]) * 10) / 10 : 0;
  const dm = (k) => prettyDate(k, { day: "numeric", month: "short" });
  const changeFrom = pts.length > 1 ? `${dm(first[0])} → ${last[0] === todayKey() ? "today" : dm(last[0])}` : pts.length ? "Only one reading" : "No readings yet";
  const avgW = pts.length ? pts.reduce((s, p) => s + p[1], 0) / pts.length : 0;
  out.innerHTML = `
    <div class="stat-row">
      <div class="stat"><div class="k">Latest</div><div class="v">${pts.length ? `${last[1].toFixed(1)}<small>kg</small>` : "–"}</div></div>
      <div class="stat"><div class="k">Change</div><div class="v">${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change).toFixed(1)}<small>kg</small></div><div class="k2">${esc(changeFrom)}</div></div>
      <div class="stat"><div class="k">Average</div><div class="v">${pts.length ? `${avgW.toFixed(1)}<small>kg</small>` : "–"}</div></div>
    </div>
    ${!pts.length ? `<p class="muted">No weight logged ${wstat.period === "week" ? "this week" : "in this period"} yet. Log it from the Weight card on the main screen.</p>` : `
    <div class="card-box">${weightChart(pts, a, b, wstat.period)}</div>
    <ul class="top-foods" style="margin-top:12px">${pts.slice().reverse().slice(0, 14).map(([k, v]) => `<li><span>${esc(prettyDate(k, { weekday: "short", day: "numeric", month: "short" }))}</span><span>${v.toFixed(1)} kg</span></li>`).join("")}</ul>
    <p class="note">${pts.length} reading${pts.length === 1 ? "" : "s"} in this period. Change compares the first and latest weight in this chart.</p>`}`;
}

function renderStatTab(body) {
  body.querySelectorAll("#statTabs button").forEach((x) => x.classList.toggle("on", x.dataset.tab === stats.tab));
  const box = $("#statBody", body);
  const seg = (list, cur, id) => `<div class="seg" id="${id}" style="grid-template-columns:repeat(${list.length},1fr)">${list.map(([k, l]) => `<button data-period="${k}" class="${k === cur ? "on" : ""}">${l}</button>`).join("")}</div>`;
  if (stats.tab === "weight") {
    box.innerHTML = `
      ${seg(WPERIODS, wstat.period, "wsPeriod")}
      <div class="spend-hero"><div class="spend-nav"><button id="wsPrev" aria-label="Previous">‹</button><span id="wsLabel"></span><button id="wsNext" aria-label="Next">›</button></div></div>
      <div id="wsOut"></div>`;
    $("#wsPeriod", box).addEventListener("click", (e) => {
      const b = e.target.closest("[data-period]");
      if (!b) return;
      wstat.period = b.dataset.period; wstat.offset = 0;
      box.querySelectorAll("#wsPeriod button").forEach((x) => x.classList.toggle("on", x === b));
      runWeightStats();
    });
    $("#wsPrev", box).addEventListener("click", () => { wstat.offset--; runWeightStats(); });
    $("#wsNext", box).addEventListener("click", () => { if (wstat.offset < 0) { wstat.offset++; runWeightStats(); } });
    runWeightStats();
    return;
  }
  box.innerHTML = `
    ${seg(PERIODS, spend.period, "spendPeriod")}
    <div class="spend-hero">
      <div class="spend-nav"><button id="spendPrev" aria-label="Previous">‹</button><span id="spendLabel"></span><button id="spendNext" aria-label="Next">›</button></div>
      <div class="spend-total" id="spendTotal">$0.00</div>
      <div class="spend-sub" id="spendSub"></div>
    </div>
    <div class="chips" id="spendFilter">${[{ id: "all", name: "All" }, ...SPEND_TYPES].map((ty) => `<button data-type="${ty.id}" class="${ty.id === spend.filter ? "on" : ""}">${esc(ty.name)}</button>`).join("")}</div>
    <div id="spendOut"></div>`;
  const setFilter = (id) => {
    spend.filter = spend.filter === id && id !== "all" ? "all" : id;
    box.querySelectorAll("#spendFilter button").forEach((x) => x.classList.toggle("on", x.dataset.type === spend.filter));
    runSpending();
  };
  const setPeriod = (p, o) => {
    spend.period = p; spend.offset = o;
    box.querySelectorAll("#spendPeriod button").forEach((x) => x.classList.toggle("on", x.dataset.period === p));
    runSpending();
  };
  $("#spendPeriod", box).addEventListener("click", (e) => { const b = e.target.closest("[data-period]"); if (b) setPeriod(b.dataset.period, 0); });
  $("#spendPrev", box).addEventListener("click", () => { spend.offset--; runSpending(); });
  $("#spendNext", box).addEventListener("click", () => { if (spend.offset < 0) { spend.offset++; runSpending(); } });
  $("#spendFilter", box).addEventListener("click", (e) => { const b = e.target.closest("[data-type]"); if (b) setFilter(b.dataset.type); });
  $("#spendOut", box).addEventListener("click", (e) => {
    const j = e.target.closest("[data-jump]");
    if (j) { const [p, o] = j.dataset.jump.split(":"); setPeriod(p, +o); return; }
    const b = e.target.closest("[data-type]");
    if (b) setFilter(b.dataset.type);
  });
  runSpending();
}

// ---------- Views (bottom sheet) ----------
const VIEWS = {
  add(body) {
    $("#sheetTitle").textContent = "Log a meal";
    renderMealTabs(true);
    const order = foodDb.info?.categories || [...new Set(foodDb.items.map((f) => f.category))];
    const cats = ["All"];
    if ((state.profile?.favorites || []).length) cats.push("Favourites");
    if ((state.profile?.customFoods || []).length) cats.push("My foods");
    cats.push(...order);
    if (!cats.includes(activeCategory)) activeCategory = "All";
    const prevKey = shiftDay(ymd(state.selectedDate), -1);
    const prevMeal = dayData(prevKey)[sheet.meal];
    const repeat = prevMeal.length
      ? `<button class="repeat" data-act="repeat" data-from="${prevKey}">${ICON.repeat}<span><b>Same as ${esc(relDay(prevKey) === "today" || relDay(prevKey) === "yesterday" ? relDay(prevKey) + "'s" : prettyDate(prevKey))} ${esc(mealName(sheet.meal).toLowerCase())}</b><small>${prevMeal.length} item${prevMeal.length > 1 ? "s" : ""} · ${fmt(totalsOf(prevMeal).kcal)} kcal · ${esc(prevMeal.map((e) => e.name).join(", ").slice(0, 70))}</small></span></button>`
      : "";
    body.innerHTML = `
      <div class="modes modes-3">
        <button class="mode" data-act="scan">${ICON.barcode}<b>Scan</b><span>Barcode</span></button>
        <button class="mode" data-act="quick">${ICON.bolt}<b>Quick add</b><span>Just calories</span></button>
        <button class="mode" data-act="custom">${ICON.pen}<b>Manual</b><span>Full details</span></button>
      </div>
      ${repeat}
      <div class="search">${ICON.search}<input id="q" type="search" placeholder="Search food, drinks, brands" autocomplete="off" enterkeyhint="search" aria-label="Search foods"></div>
      <div class="chips" id="chips">${cats.map((c) => `<button data-cat="${esc(c)}" class="${c === activeCategory ? "on" : ""}">${esc(c)}</button>`).join("")}</div>
      <div id="resultsWrap"></div>`;
    const input = $("#q", body);
    let t;
    const update = () => renderResults(input.value);
    input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(update, 120); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { input.blur(); update(); } });
    $("#chips", body).addEventListener("click", (e) => {
      const b = e.target.closest("[data-cat]");
      if (!b) return;
      activeCategory = b.dataset.cat;
      body.querySelectorAll("#chips button").forEach((x) => x.classList.toggle("on", x === b));
      update();
    });
    update();
  },

  quick(body) {
    $("#sheetTitle").textContent = "Quick add";
    renderMealTabs(true);
    body.innerHTML = `
      <div class="form">
        <div class="field full"><label for="qaKcal">Calories (kcal)</label><input id="qaKcal" type="number" inputmode="decimal" min="0" step="any" placeholder="e.g. 450"></div>
        <div class="field full"><label for="qaName">What was it? (optional)</label><input id="qaName" type="text" autocomplete="off" placeholder="e.g. Office snacks"></div>
        <div class="field"><label for="qaP">Protein g (optional)</label><input id="qaP" type="number" inputmode="decimal" min="0" step="any"></div>
        <div class="field"><label for="qaC">Carbs g (optional)</label><input id="qaC" type="number" inputmode="decimal" min="0" step="any"></div>
        <div class="field"><label for="qaF">Fat g (optional)</label><input id="qaF" type="number" inputmode="decimal" min="0" step="any"></div>
        <div class="field"><label for="qaS">Sugar g (optional)</label><input id="qaS" type="number" inputmode="decimal" min="0" step="any"></div>
        ${priceField("qaPrice")}
      </div>
      <button class="primary" id="qaAdd">Add to ${mealName(sheet.meal)}</button>`;
    setTimeout(() => $("#qaKcal")?.focus(), 250);
    $("#qaAdd", body).addEventListener("click", () => {
      const v = (id) => $("#" + id, body).value.trim();
      if (v("qaKcal") === "" || num(v("qaKcal")) <= 0) return toast("Enter the calories");
      const price = readPrice(v("qaPrice"));
      if (price === undefined) return toast("Check the price");
      addEntry(sheet.meal, { name: v("qaName") || "Quick add", serving: "1 serving", category: "Quick add", source: "Your entry", tier: "u",
        kcal: v("qaKcal"), protein: v("qaP"), carbs: v("qaC"), fat: v("qaF"), sugar: v("qaS") === "" ? null : v("qaS"), sodium: null }, 1, price);
      closeSheet();
      toast(`Added to ${mealName(sheet.meal)}`);
    });
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
    const portions = [{ label: food.serving, q: 1 }];
    if (food.grams && Array.isArray(food.alt)) for (const [label, g] of food.alt) if (g > 0) portions.push({ label, q: g / food.grams });
    portions.push({ label: "Small (¾ portion)", q: 0.75 }, { label: "Large (1½ portions)", q: 1.5 });
    if (food.grams) portions.push({ label: "Custom amount in grams / ml", q: "custom" });
    const fav = isFavourite(food);
    const tier = food.tier || "u";
    body.innerHTML = `
      <div class="detail-card">
        <div class="d-head"><h4>${esc(food.name)}</h4>
          <button class="star${fav ? " on" : ""}" id="favBtn" aria-pressed="${fav}" aria-label="${fav ? "Remove from" : "Add to"} favourites">${ICON.star}</button></div>
        ${food.brand && !food.name.toLowerCase().includes(food.brand.toLowerCase()) ? `<div class="src">${esc(food.brand)}</div>` : ""}
        <div class="srcline"><span class="tier tier-${esc(tier)}">${esc(TIER_LABEL[tier] || "")}</span> <span>${esc(food.source || "")}${food.srcNote ? " · " + esc(food.srcNote) : ""}</span></div>
        <div class="big-kcal"><span id="dk">${fmt(food.kcal)}</span> <small>kcal</small></div>
        <div class="macro-row" id="dm"></div>
        <div class="field" style="margin-top:14px"><label for="portion">Portion</label>
          <select id="portion" class="sel">${portions.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join("")}</select></div>
        <div class="field" id="gramsWrap" hidden style="margin-top:10px"><label for="grams">Amount (g / ml)</label><input id="grams" type="number" inputmode="decimal" min="1" step="any" value="${esc(food.grams || "")}"></div>
        <div class="qty">
          <span class="q-label">Servings</span>
          <div class="stepper">
            <button data-step="-0.5" aria-label="Fewer servings">−</button>
            <input id="qty" type="number" inputmode="decimal" min="0.1" step="0.5" value="1" aria-label="Servings">
            <button data-step="0.5" aria-label="More servings">+</button>
          </div>
        </div>
        <div style="margin-top:12px">${priceField("dPrice")}</div>
        <button class="primary" id="addBtn">Add to ${mealName(sheet.meal)}</button>
      </div>
      ${tier === "e" ? `<p class="note">There's no official nutrition data for this item, so these numbers are an estimate. You can change them after logging by tapping the entry.</p>` : ""}
      ${tier === "t" ? `<p class="note">From the product's nutrition label, entered by Open Food Facts volunteers. If anything looks off, check the pack and edit the entry after logging.</p>` : ""}
      ${food.sugar == null && tier !== "u" ? `<p class="note">Sugar isn't published by this source, so it isn't counted in your sugar total.</p>` : ""}
      <button class="link-btn" data-act="about-data">About the food data</button>`;
    const qty = $("#qty", body), sel = $("#portion", body), gramsIn = $("#grams", body);
    const mult = () => {
      const p = portions[+sel.value];
      const pq = p.q === "custom" ? num(gramsIn.value) / (food.grams || 1) : p.q;
      return pq * num(qty.value);
    };
    const paint = () => {
      $("#gramsWrap", body).hidden = portions[+sel.value].q !== "custom";
      const m = mult();
      $("#dk", body).textContent = fmt(food.kcal * m);
      $("#dm", body).innerHTML = [["Protein", food.protein, "g"], ["Carbs", food.carbs, "g"], ["Fat", food.fat, "g"], ["Sugar", food.sugar, "g"], ["Sodium", food.sodium, "mg"]]
        .map(([k, v, u]) => `<div><div class="k">${k}</div><div class="v">${v == null ? "–" : fmt(num(v) * m) + (u === "g" ? "g" : "")}</div></div>`).join("");
    };
    body.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => { qty.value = Math.max(0.5, r1(num(qty.value) + num(b.dataset.step))); paint(); }));
    qty.addEventListener("input", paint);
    sel.addEventListener("change", paint);
    gramsIn.addEventListener("input", paint);
    $("#favBtn", body).addEventListener("click", (e) => {
      const on = toggleFavourite(food);
      e.currentTarget.classList.toggle("on", on);
      e.currentTarget.setAttribute("aria-pressed", on);
      toast(on ? "Added to favourites" : "Removed from favourites");
    });
    $("#addBtn", body).addEventListener("click", () => {
      const m = mult();
      if (!(m > 0)) return toast("Enter how much you had");
      const price = readPrice($("#dPrice", body).value);
      if (price === undefined) return toast("Check the price");
      addEntry(sheet.meal, food, m, price);
      closeSheet();
      toast(`Added to ${mealName(sheet.meal)}`);
    });
    paint();
  },

  editEntry(body, ref) {
    const [mealId, id] = ref.split(":");
    const e = findEntry(mealId, id);
    if (!e) { closeSheet(); return; }
    $("#sheetTitle").textContent = "Edit entry";
    renderMealTabs(true);
    const f = (fid, label, val, cls = "", text = false) => `<div class="field ${cls}"><label for="${fid}">${label}</label><input id="${fid}" ${text ? 'type="text"' : 'type="number" inputmode="decimal" min="0" step="any"'} value="${esc(val ?? "")}"></div>`;
    body.innerHTML = `
      <p class="note" style="margin-top:0">Tap a meal above to move this entry. Values are for one serving.</p>
      <div class="form">
        ${f("eName", "Name", e.name, "full", true)}
        ${f("eServing", "Serving", e.serving, "full", true)}
        ${f("eQty", "Servings", e.qty || 1)}
        ${f("eKcal", "Calories (kcal)", e.kcal)}
        ${f("eP", "Protein (g)", e.protein)}
        ${f("eC", "Carbs (g)", e.carbs)}
        ${f("eF", "Fat (g)", e.fat)}
        ${f("eS", "Sugar (g)", e.sugar)}
        ${f("eNa", "Sodium (mg)", e.sodium)}
        ${priceField("ePrice", hasPrice(e) ? num(e.price).toFixed(2) : "")}
        <div class="field"><label for="eType">Type of food</label><select id="eType" class="sel">${SPEND_TYPES.map((t) => `<option value="${t.id}"${t.id === spendType(e) ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
      </div>
      <p class="note">${esc(TIER_LABEL[e.tier] || "")}${e.source ? " · " + esc(e.source) : ""}. Changing the numbers marks this entry as edited by you.</p>
      <button class="primary" id="eSave">Save changes</button>
      <button class="secondary danger" id="eDel">Remove entry</button>`;
    const vals = () => {
      const v = (fid) => $("#" + fid, body).value.trim();
      return { name: v("eName") || e.name, serving: v("eServing") || e.serving, qty: num(v("eQty")) || 1, kcal: r0(num(v("eKcal"))),
        protein: r1(num(v("eP"))), carbs: r1(num(v("eC"))), fat: r1(num(v("eF"))),
        sugar: v("eS") === "" ? null : r1(num(v("eS"))), sodium: v("eNa") === "" ? null : r0(num(v("eNa"))) };
    };
    $("#eSave", body).addEventListener("click", () => {
      const nv = vals();
      const price = readPrice($("#ePrice", body).value);
      if (price === undefined) return toast("Check the price");
      nv.price = price;
      const type = $("#eType", body).value;
      const guessed = spendType({ ...e, ptype: undefined });
      nv.ptype = type === guessed ? null : type;
      const changed = ["kcal", "protein", "carbs", "fat", "sugar", "sodium"].some((k) => (nv[k] ?? null) !== (e[k] ?? null));
      if (changed) nv.tier = "u";
      saveEditedEntry(mealId, sheet.meal, id, nv).then(() => toast("Saved")).catch(() => {});
      closeSheet();
    });
    $("#eDel", body).addEventListener("click", () => { removeEntry(mealId, id); closeSheet(); });
  },

  aboutData(body) {
    $("#sheetTitle").textContent = "About the food data";
    renderMealTabs(false);
    const info = foodDb.info || {};
    const counts = info.counts || {};
    body.innerHTML = `
      <div class="about">
        <p>Every food shows where its numbers come from:</p>
        <ul class="tiers">
          <li><span class="tier tier-o">Official</span> Published by the Health Promotion Board or by the brand itself.</li>
          <li><span class="tier tier-t">Label</span> Copied from the product's nutrition label by Open Food Facts volunteers.</li>
          <li><span class="tier tier-e">Estimate</span> No official data exists. Typical values; check and edit if you can.</li>
          <li><span class="tier tier-u">Yours</span> Entered or edited by you.</li>
        </ul>
        <h4>Sources</h4>
        <p><b>Singapore Food Insights Database (SG FoodID), Health Promotion Board</b>${counts.hpb ? ` · ${counts.hpb.toLocaleString("en-SG")} foods` : ""}<br>
        Contains information from Singapore Food Insights Database (SG FoodID) accessed on ${esc(info.hpbAccessed || "")} from Health Promotion Board which is made available under the terms found at
        <a href="https://pphtpc.hpb.gov.sg/web/sgfoodid" target="_blank" rel="noopener">pphtpc.hpb.gov.sg/web/sgfoodid</a>
        (<a href="https://file.go.gov.sg/termsofuse-hpbsgfoodid.pdf" target="_blank" rel="noopener">licence</a>).
        The information contained within this dataset is provided on an "as-is" basis. The data, including but not limited to nutritional information, is subject to inherent limitations. No warranty or representation is made as to the accuracy or completeness of the data contained herein.
        This app is not endorsed by the Health Promotion Board.</p>
        <p><b>McDonald's Singapore</b>${counts.mcd ? ` · ${counts.mcd} items` : ""}: nutrition facts published on <a href="https://www.mcdonalds.com.sg/nutrition-calculator" target="_blank" rel="noopener">mcdonalds.com.sg</a> (current as of ${esc(info.mcdAsOf || "Dec 2023")}). McDonald's doesn't publish sugar.</p>
        <p><b>Ya Kun Kaya Toast</b>${counts.yakun ? ` · ${counts.yakun} drinks` : ""}: official Nutrition Information Panel on <a href="https://app.yakun.com/nutritional-information" target="_blank" rel="noopener">yakun.com</a>, per 100ml, converted to each cup size.</p>
        <p><b>KFC Singapore</b>${counts.kfc ? ` · ${counts.kfc} items` : ""}: official <a href="https://www.kfc.com.sg/nutritionandallergen" target="_blank" rel="noopener">Nutrition &amp; Allergen page</a>. KFC doesn't publish sugar for food items.</p>
        <p><b>Subway Singapore</b>${counts.subway ? ` · ${counts.subway} items` : ""}: official <a href="https://subwayisfresh.com.sg/wp-content/uploads/2022/02/Singapore-Nutrition-Information-Webguide-Feb-2022.pdf" target="_blank" rel="noopener">nutrition guide (Feb 2022)</a>. Subs, wraps, flatbreads and salads exclude sauce and cheese: add those separately (they're listed as add-ons). A footlong is double a 6-inch.</p>
        <p><b>7-Eleven Singapore</b>${counts["7e"] ? ` · ${counts["7e"]} items` : ""}: nutrition tables on <a href="https://www.7-eleven.com.sg/products" target="_blank" rel="noopener">7-eleven.com.sg/products</a> (7-Select meals, burgers, sandwiches, wraps and 7Café drinks). 7Café drinks are listed per 100ml and converted to M (236ml) and L (354ml) cups. 7-Eleven doesn't publish sugar for food items, and its onigiri pages have no nutrition table.</p>
        <p><b>LiHO</b>${counts.liho ? ` · ${counts.liho} drinks and toppings` : ""}: LiHO doesn't publish nutrition data. These calories come from <a href="https://lihoteasg.org/liho-calories/" target="_blank" rel="noopener">lihoteasg.org</a>, an unofficial fan site that gives ranges (e.g. 150–250 kcal) for a regular cup. The app uses the middle of each range and tags them Estimate. Calories only; sugar level isn't stated.</p>
        <p><b>Open Food Facts</b>${foodDb.packaged ? ` · ${foodDb.packaged.length.toLocaleString("en-SG")} packaged products` : ""}: data from <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">openfoodfacts.org</a>, available under the <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">Open Database License</a>. Refreshed weekly.</p>
        ${counts.est ? `<p><b>Estimates</b> · ${counts.est} items from chains that don't publish nutrition data (e.g. Jollibee, Burger King, bubble tea shops), shown with an Estimate tag. Most are rough values from general knowledge, written by the AI assistant that built this app, not from a published source. Two (Stuff'd, Potato Corner) come from third-party sites, named on the item. Treat them as a starting point and edit them after logging if you know better.</p>` : ""}
        <p class="note">Nutrition varies with portion size, recipe and preparation. Use these numbers as a guide, not medical advice.</p>
      </div>`;
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
        ${priceField("cPrice")}
      </div>
      ${prefill.barcode ? `<p class="note">Barcode ${esc(prefill.barcode)} will be linked to this food.</p>` : ""}
      <label class="check"><input type="checkbox" id="cSave" checked${prefill.barcode ? " disabled" : ""}> Save to My foods for next time</label>
      <button class="primary" id="cAdd">Add to ${mealName(sheet.meal)}</button>`;
    $("#cAdd", body).addEventListener("click", () => {
      const v = (id) => $("#" + id, body).value.trim();
      const name = v("cName");
      if (!name) return toast("Give the food a name");
      if (v("cKcal") === "") return toast("Enter the calories");
      const price = readPrice(v("cPrice"));
      if (price === undefined) return toast("Check the price");
      const food = compactFood({ name, serving: v("cServing") || "1 serving", category: "My foods", source: "My foods", tier: "u", barcode: prefill.barcode,
        kcal: v("cKcal"), protein: v("cProtein"), carbs: v("cCarbs"), fat: v("cFat"), sugar: v("cSugar"), sodium: v("cSodium") });
      if ($("#cSave", body).checked) {
        const customFoods = [food, ...(state.profile?.customFoods || []).filter((c) => c.name.toLowerCase() !== name.toLowerCase() && (!food.barcode || c.barcode !== food.barcode))].slice(0, 300);
        updateProfile({ customFoods }).catch(() => {});
      }
      addEntry(sheet.meal, food, 1, price);
      closeSheet();
      toast(`Added to ${mealName(sheet.meal)}`);
    });
  },

  stats(body, tab) {
    $("#sheetTitle").textContent = "Statistics";
    renderMealTabs(false);
    if (tab) stats.tab = tab;
    spend.offset = 0; wstat.offset = 0;
    body.innerHTML = `
      <div class="stat-tabs" id="statTabs"><button data-tab="spend">Spending</button><button data-tab="weight">Weight</button></div>
      <div id="statBody"></div>`;
    $("#statTabs", body).addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]");
      if (!b || b.dataset.tab === stats.tab) return;
      stats.tab = b.dataset.tab;
      renderStatTab(body);
    });
    renderStatTab(body);
  },

  weight(body) {
    const sel = ymd(state.selectedDate);
    const d = dayData(sel);
    $("#sheetTitle").textContent = "Weight";
    renderMealTabs(false);
    const prev = previousWeight(sel);
    body.innerHTML = `
      <div class="field"><label for="wIn">Weight on ${esc(sel === todayKey() ? "today" : prettyDate(sel, { weekday: "short", day: "numeric", month: "short", year: "numeric" }))} (kg)</label>
        <input id="wIn" type="number" inputmode="decimal" min="20" max="400" step="0.1" placeholder="${prev ? esc(String(prev[1])) : "e.g. 55.0"}" value="${hasWeight(d) ? esc(d.weight.toFixed(1)) : ""}"></div>
      ${prev ? `<p class="note">Last reading: ${esc(kg(prev[1]))} on ${esc(prettyDate(prev[0]))}.</p>` : ""}
      <button class="primary" id="wSave">Save weight</button>
      ${hasWeight(d) ? '<button class="secondary danger" id="wDel">Remove this reading</button>' : ""}
      <button class="secondary" data-act="weight-stats">See weight charts</button>`;
    setTimeout(() => $("#wIn")?.focus(), 250);
    $("#wSave", body).addEventListener("click", () => {
      const v = num($("#wIn", body).value);
      if (!(v >= 20 && v <= 400)) return toast("Enter your weight in kg");
      setWeight(sel, v).catch(() => {});
      closeSheet();
      toast("Weight saved");
    });
    $("#wDel", body)?.addEventListener("click", () => { setWeight(sel, null).catch(() => {}); closeSheet(); toast("Removed"); });
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
    const hasPhoto = !!p.photo;
    body.innerHTML = `
      <div class="photo-row">
        <div class="avatar-lg"${hasPhoto ? ` style="background-image:url('${esc(p.photo)}')"` : ""}>${hasPhoto ? "" : esc((p.username || "?").charAt(0).toUpperCase())}</div>
        <div class="photo-btns">
          <button class="secondary" style="margin:0" id="photoPick">${hasPhoto ? "Change photo" : "Add profile photo"}</button>
          ${hasPhoto ? '<button class="link-btn danger" style="padding:6px 0;text-align:left" id="photoRemove">Remove photo</button>' : ""}
        </div>
        <input type="file" id="photoFile" accept="image/*" hidden>
      </div>
      <div class="kv">
        <div><span>Username</span><b>${esc(p.username || "")}</b></div>
        <div><span>Email</span><b>${esc(state.user?.email || p.email || "")}</b></div>
      </div>
      <div class="row2">
        <button class="secondary" data-act="edit-username">Change username</button>
        <button class="secondary" data-act="edit-email">Change email</button>
      </div>
      <div class="section-label">Colour theme</div>
      <div class="schemes" id="schemes">${SCHEMES.map((c) => `<button data-scheme="${c.id}" class="${c.id === currentScheme() ? "on" : ""}" aria-pressed="${c.id === currentScheme()}"><i style="background:linear-gradient(135deg, ${c.swatch[0]}, ${c.swatch[1]})"></i>${c.name}</button>`).join("")}</div>
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
      <div class="section-label">Notifications</div>
      <div class="kv"><div><span>Reminders</span><b>${esc(notifySummary())}</b></div></div>
      <button class="secondary" data-act="notifications">Notification settings</button>
      <div class="section-label">Your data</div>
      <button class="secondary" style="margin-top:0" id="exportCsv">Download my log as a spreadsheet (CSV)</button>
      <button class="secondary" id="backupJson">Download a full backup</button>
      <button class="secondary" data-act="restore">Restore from a backup</button>
      <div class="section-label">Password</div>
      <button class="secondary" style="margin-top:0" id="resetPw">Email me a link to change my password</button>
      <div class="section-label">Food data</div>
      <button class="secondary" style="margin-top:0" data-act="about-data">Where the nutrition numbers come from</button>
      <button class="secondary" id="signOutBtn" style="margin-top:22px">Sign out</button>
      <button class="secondary danger" data-act="delete-account">Delete my account</button>
      <p class="note">Nutrition data from HPB SG FoodID, McDonald's, KFC, Subway and 7-Eleven Singapore, Ya Kun and Open Food Facts. Tap "Where the nutrition numbers come from" for details and credits.</p>`;
    $("#autoGoals", body).addEventListener("click", () => {
      const a = goalsFor(num($("#gKcal", body).value) || 1800);
      $("#gProtein", body).value = a.protein; $("#gCarbs", body).value = a.carbs; $("#gFat", body).value = a.fat;
    });
    $("#saveGoals", body).addEventListener("click", async () => {
      const v = (id) => num($("#" + id, body).value);
      const goalsNew = { kcal: v("gKcal") || 1800, protein: v("gProtein"), carbs: v("gCarbs"), fat: v("gFat"), sugar: v("gSugar"), sodium: v("gSodium") };
      try { await updateProfile({ goals: goalsNew }); renderAll(); closeSheet(); toast("Goals saved"); } catch { /* toast shown */ }
    });
    $("#schemes", body).addEventListener("click", (e) => {
      const b = e.target.closest("[data-scheme]");
      if (!b) return;
      applyScheme(b.dataset.scheme);
      body.querySelectorAll("#schemes button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
      updateProfile({ scheme: b.dataset.scheme }).catch(() => {});
    });
    $("#photoPick", body).addEventListener("click", () => $("#photoFile", body).click());
    $("#photoFile", body).addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const photo = await makeProfilePhoto(file);
        await updateProfile({ photo });
        renderAll(false);
        show("profile", null, false);
        toast("Photo updated");
      } catch (err) { console.error(err); toast(err.message || "Couldn't use that photo. Try another one."); }
    });
    $("#photoRemove", body)?.addEventListener("click", async () => {
      try { await updateProfile({ photo: null }); renderAll(false); show("profile", null, false); toast("Photo removed"); } catch { /* toast shown */ }
    });
    $("#exportCsv", body).addEventListener("click", (e) => withBusy(e.target, exportCsv));
    $("#backupJson", body).addEventListener("click", (e) => withBusy(e.target, downloadBackup));
    $("#resetPw", body).addEventListener("click", async (e) => {
      e.target.disabled = true;
      try { await sendReset(state.user.email); toast(`Link sent to ${state.user.email}`); } catch { toast("Couldn't send the email. Try again later."); e.target.disabled = false; }
    });
    $("#signOutBtn", body).addEventListener("click", async () => { closeSheet(); await fb.signOut(fb.auth); });
  },

  editUsername(body) {
    $("#sheetTitle").textContent = "Change username";
    renderMealTabs(false);
    body.innerHTML = `
      <div class="field"><label for="nuName">New username</label><input id="nuName" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(state.profile?.username || "")}"><div class="hint">3–20 letters, numbers, dots, dashes or underscores. It can't already be used by someone else.</div></div>
      <button class="primary" id="nuSave">Save username</button>
      <p class="form-msg err" id="nuMsg" hidden></p>`;
    $("#nuSave", body).addEventListener("click", async (e) => {
      const msg = $("#nuMsg", body);
      msg.hidden = true;
      e.target.disabled = true;
      try { await changeUsername($("#nuName", body).value.trim()); closeSheet(); toast("Username changed"); }
      catch (err) { msg.textContent = err.message || "Couldn't change the username. Try again."; msg.hidden = false; e.target.disabled = false; }
    });
  },

  editEmail(body) {
    $("#sheetTitle").textContent = "Change email";
    renderMealTabs(false);
    body.innerHTML = `
      <p class="note" style="margin-top:0">We'll send a confirmation link to your <b>new</b> email. Your email only changes after you open that link. Your current email also gets a message with a way to undo it.</p>
      <div class="field" style="margin-top:12px"><label for="neEmail">New email</label><input id="neEmail" type="email" autocomplete="email" autocapitalize="none" spellcheck="false"></div>
      <div class="field" style="margin-top:12px"><label for="nePw">Current password</label><input id="nePw" type="password" autocomplete="current-password"><div class="hint">Needed to confirm it's you.</div></div>
      <button class="primary" id="neSend">Send confirmation link</button>
      <p class="form-msg" id="neMsg" hidden></p>`;
    $("#neSend", body).addEventListener("click", async (e) => {
      const msg = $("#neMsg", body);
      msg.hidden = true;
      e.target.disabled = true;
      try {
        const to = await requestEmailChange($("#neEmail", body).value.trim(), $("#nePw", body).value);
        msg.className = "form-msg ok";
        msg.textContent = `Confirmation link sent to ${to}. Open it to finish the change (check spam too). After that, sign in with your new email once, then your username works again as usual.`;
      } catch (err) {
        msg.className = "form-msg err";
        msg.textContent = err.message || authError(err);
        e.target.disabled = false;
      }
      msg.hidden = false;
    });
  },

  deleteAccount(body) {
    $("#sheetTitle").textContent = "Delete my account";
    renderMealTabs(false);
    const email = state.user?.email || "";
    body.innerHTML = `
      <p class="note" style="margin-top:0;font-size:14px;color:var(--ink-2)">Deleting your account erases your login, profile, goals, saved foods and your whole food log. It can't be undone.</p>
      <p class="note" style="font-size:14px;color:var(--ink-2)">To make sure it's really you, we'll email a confirmation link to <b>${esc(email)}</b>. Open it to finish deleting. If you don't open it, nothing happens.</p>
      <button class="secondary" id="delBackup">Download a backup first</button>
      <button class="primary" id="delSend" style="background:var(--over)">Email me the delete link</button>
      <p class="form-msg" id="delMsg" hidden></p>`;
    $("#delBackup", body).addEventListener("click", (e) => withBusy(e.target, downloadBackup));
    $("#delSend", body).addEventListener("click", async (e) => {
      const msg = $("#delMsg", body);
      e.target.disabled = true;
      try {
        await requestDeletionLink(email);
        msg.className = "form-msg ok";
        msg.textContent = `Link sent to ${email}. Open it on any device to confirm. Check your spam folder if you don't see it.`;
      } catch (err) {
        msg.className = "form-msg err";
        msg.textContent = err?.code === "auth/operation-not-allowed"
          ? "Email links aren't turned on in Firebase yet (Authentication > Sign-in method > Email/Password > Email link). See the README."
          : authError(err);
        e.target.disabled = false;
      }
      msg.hidden = false;
    });
  },

  restore(body) {
    $("#sheetTitle").textContent = "Restore from a backup";
    renderMealTabs(false);
    body.innerHTML = `
      <p class="note" style="margin-top:0;font-size:14px;color:var(--ink-2)">Pick a backup file you downloaded from this app. Days in the backup replace the same days in your log. Days that aren't in the backup are left alone. Your goals and saved foods are restored too.</p>
      <input type="file" id="restoreFile" accept="application/json,.json" hidden>
      <button class="primary" id="restorePick">Choose backup file</button>
      <div id="restoreOut"></div>`;
    const input = $("#restoreFile", body);
    $("#restorePick", body).addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files[0];
      input.value = "";
      if (!file) return;
      const out = $("#restoreOut", body);
      let backup;
      try { backup = parseBackup(await file.text()); }
      catch (err) { out.innerHTML = `<p class="form-msg err">${esc(err.message)}</p>`; return; }
      const months = Object.keys(backup.months);
      const days = months.reduce((n, m) => n + Object.keys(backup.months[m].days || {}).length, 0);
      out.innerHTML = `<p class="form-msg ok">Backup of <b>${esc(backup.profile?.username || "an account")}</b> from ${esc(new Date(backup.exportedAt).toLocaleString("en-SG"))}: ${days} logged day${days === 1 ? "" : "s"} across ${months.length} month${months.length === 1 ? "" : "s"}.</p>
        <button class="primary" id="restoreGo">Restore this backup</button>`;
      armButton($("#restoreGo", body), "Tap again to restore", async () => {
        out.innerHTML = '<div class="spinner"></div><p class="scan-status">Restoring…</p>';
        try { await restoreBackup(backup); closeSheet(); toast("Backup restored"); }
        catch (err) { console.error(err); out.innerHTML = '<p class="form-msg err">Couldn\'t finish restoring. Check your connection and try again; it\'s safe to run it again.</p>'; }
      });
    });
  },

  notifications(body) {
    $("#sheetTitle").textContent = "Notifications";
    renderMealTabs(false);
    const n = notifySettings();
    const hourOpts = (sel, from = 0, to = 23) => Array.from({ length: to - from + 1 }, (_, i) => i + from)
      .map((h) => `<option value="${h}"${h === sel ? " selected" : ""}>${hourLabel(h)}</option>`).join("");
    const support = pushSupport();
    body.innerHTML = `
      ${support.ok ? "" : `<p class="form-msg err" style="margin-top:0">${esc(support.why)}</p>`}
      <div class="chips" id="nOnOff" style="margin-top:0">
        <button data-on="0" class="${n.enabled ? "" : "on"}">Off</button>
        <button data-on="1" class="${n.enabled ? "on" : ""}">On</button>
      </div>
      <div id="nOpts"${n.enabled ? "" : " hidden"}>
        <div class="section-label">Regular reminders</div>
        <div class="form">
          <div class="field full"><label for="nEvery">Remind me</label><select id="nEvery" class="sel">
            ${[[0, "Never"], [1, "Every hour"], [2, "Every 2 hours"], [3, "Every 3 hours"], [4, "Every 4 hours"]].map(([v, l]) => `<option value="${v}"${v === n.every ? " selected" : ""}>${l}</option>`).join("")}
          </select></div>
          <div class="field"><label for="nFrom">From</label><select id="nFrom" class="sel">${hourOpts(n.from, 5, 14)}</select></div>
          <div class="field"><label for="nTo">Until</label><select id="nTo" class="sel">${hourOpts(n.to, 15, 23)}</select></div>
        </div>
        <div class="section-label">Meal reminders</div>
        <p class="note" style="margin-top:0">Only sent if that meal hasn't been logged yet.</p>
        ${["breakfast", "lunch", "dinner"].map((m) => `
          <div class="nrow"><label class="check" style="margin:0"><input type="checkbox" id="nm_${m}"${n.meals[m] != null ? " checked" : ""}> ${mealName(m)} not logged by</label>
          <select id="nmh_${m}" class="sel sel-sm">${hourOpts(n.meals[m] ?? { breakfast: 10, lunch: 14, dinner: 20 }[m], { breakfast: 6, lunch: 11, dinner: 17 }[m], { breakfast: 12, lunch: 16, dinner: 23 }[m])}</select></div>`).join("")}
        <div class="section-label">End of day</div>
        <div class="nrow"><label class="check" style="margin:0"><input type="checkbox" id="nEod"${n.eod != null ? " checked" : ""}> Nothing logged today by</label>
          <select id="nEodH" class="sel sel-sm">${hourOpts(n.eod ?? 21, 17, 23)}</select></div>
        <p class="note">Reminders are checked once an hour, so they can arrive up to about an hour after the time you pick. They use this phone's time zone (${esc(localTz())}).</p>
      </div>
      <button class="primary" id="nSave">Save</button>
      <button class="secondary" id="nTest"${n.enabled && support.ok ? "" : " hidden"}>Send a test notification to this device</button>
      <p class="form-msg" id="nMsg" hidden></p>`;
    let enabled = n.enabled;
    $("#nOnOff", body).addEventListener("click", (e) => {
      const b = e.target.closest("[data-on]");
      if (!b) return;
      enabled = b.dataset.on === "1";
      body.querySelectorAll("#nOnOff button").forEach((x) => x.classList.toggle("on", x === b));
      $("#nOpts", body).hidden = !enabled;
    });
    $("#nTest", body).addEventListener("click", async () => {
      try { await showLocalNotification("Test from Calorie Tracker", "Notifications are working on this device."); }
      catch { toast("Couldn't show a notification. Check the app's notification permission in your phone settings."); }
    });
    $("#nSave", body).addEventListener("click", async (e) => {
      const msg = $("#nMsg", body);
      msg.hidden = true;
      const pick = (id) => Number($("#" + id, body).value);
      const next = {
        enabled, tz: localTz(), every: pick("nEvery"), from: pick("nFrom"), to: pick("nTo"),
        meals: Object.fromEntries(["breakfast", "lunch", "dinner"].map((m) => [m, $("#nm_" + m, body).checked ? pick("nmh_" + m) : null])),
        eod: $("#nEod", body).checked ? pick("nEodH") : null,
      };
      e.target.disabled = true;
      try {
        if (enabled) await registerThisDevice();
        await updateProfile({ notify: next });
        closeSheet();
        toast(enabled ? "Notifications on" : "Notifications off");
      } catch (err) {
        console.error(err);
        msg.className = "form-msg err";
        msg.textContent = err.message || "Couldn't turn on notifications. Try again.";
        msg.hidden = false;
        e.target.disabled = false;
      }
    });
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

  $("#weight").addEventListener("click", (e) => { if (e.target.closest("[data-act-main=weight]")) openSheet(null, "weight"); });
  enableSheetDrag();
  enableSwipeDelete($("#meals"));
  $("#meals").addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) return openSheet(add.dataset.add, "add");
    const edit = e.target.closest("[data-edit]");
    if (edit) { openSheet(edit.dataset.edit.split(":")[0], "editEntry", edit.dataset.edit); return; }
    const cp = e.target.closest("[data-copyday]");
    if (cp) { cp.disabled = true; copyDay(cp.dataset.copyday).then(() => toast("Copied")).catch(() => {}); }
  });
  $("#recs").addEventListener("click", (e) => {
    const r = e.target.closest("[data-rec]");
    if (r) openSheet(state.recPlan?.next, "detail", state.recList[+r.dataset.rec]);
  });

  $("#fabScan").addEventListener("click", () => openSheet(null, "scan"));
  $("#fabManual").addEventListener("click", () => openSheet(null, "add"));
  $("#fabHistory").addEventListener("click", () => openSheet(null, "history"));
  $("#fabStats").addEventListener("click", () => openSheet(null, "stats", "spend"));
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

  $("#scrim").addEventListener("click", () => closeSheet({ keepDraft: true }));
  $("#sheetClose").addEventListener("click", () => closeSheet({ keepDraft: true }));
  // Remember which screen the typing happened on: by the time the save runs, another screen may be showing.
  const queueDraft = () => {
    const top = sheet.stack[sheet.stack.length - 1];
    if (!top) return;
    saveDraft(top[0], top[1]);
  };
  $("#sheetBody").addEventListener("input", (e) => { if (e.isTrusted) queueDraft(); });
  $("#sheetBody").addEventListener("change", (e) => { if (e.isTrusted) queueDraft(); });
  window.addEventListener("pagehide", () => { const top = sheet.stack[sheet.stack.length - 1]; if (sheetOpen() && top) saveDraft(top[0], top[1]); });
  $("#sheetBack").addEventListener("click", back);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheetOpen()) closeSheet({ keepDraft: true }); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopCamera(); });

  $("#mealTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-meal]");
    if (!b) return;
    sheet.meal = b.dataset.meal;
    $("#mealTabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    const top = sheet.stack[sheet.stack.length - 1];
    // Only the "Log a meal" list depends on the meal; elsewhere keep what's been typed and just relabel.
    if (top && top[0] === "add") show("add", null, false);
    else {
      document.querySelectorAll("#addBtn, #qaAdd, #cAdd").forEach((x) => { x.textContent = `Add to ${mealName(sheet.meal)}`; });
      if (top && top[0] === "detail") $("#sheetTitle").textContent = "Add to " + mealName(sheet.meal);
    }
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
    else if (act === "quick") show("quick");
    else if (act === "weight-stats") show("stats", "weight");
    else if (act === "about-data") show("aboutData");
    else if (act === "repeat") {
      const items = dayData(actEl.dataset.from)[sheet.meal];
      addEntries(sheet.meal, items).then(() => toast(`Added ${items.length} item${items.length > 1 ? "s" : ""} to ${mealName(sheet.meal)}`)).catch(() => {});
      closeSheet();
    }
    else if (act === "edit-username") show("editUsername");
    else if (act === "edit-email") show("editEmail");
    else if (act === "notifications") show("notifications");
    else if (act === "restore") show("restore");
    else if (act === "delete-account") show("deleteAccount");
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
  loadFoods().then(() => renderAll(false)).catch((e) => console.warn("food list", e));
  if (!firebaseConfig?.apiKey || /PASTE/i.test(firebaseConfig.apiKey)) { showSetupNeeded(); return; }
  try { await loadFirebase(); }
  catch (e) {
    console.error(e);
    $("#authScreen").hidden = false;
    $("#authCard").innerHTML = '<div class="setup"><h2>Can\'t connect</h2><p>The app couldn\'t load. Check your internet connection and reload.</p></div>';
    return;
  }
  if (fb.isSignInLink(fb.auth, location.href)) state.deleteFlow = true;
  fb.onAuthStateChanged(fb.auth, (user) => {
    stopSubscriptions();
    state.user = user;
    if (state.deleteFlow) {
      closeSheet();
      $("#appScreen").hidden = true;
      $("#authScreen").hidden = false;
      if (!state.deleteStarted) { state.deleteStarted = true; deleteFlowStart(); }
      return;
    }
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

// ---------- After sign-in housekeeping ----------
async function afterProfileLoad() {
  // Email changed through a confirmation link: keep the profile and username lookup in step.
  const email = state.user?.email;
  const p = state.profile;
  if (email && p && p.email !== email) {
    try {
      await updateProfile({ email });
      if (p.username) await fb.setDoc(fb.doc(`usernames/${p.username.toLowerCase()}`), { uid: state.user.uid, email }, { merge: true });
    } catch (e) { console.error(e); }
  }
  // Keep this device's notification token fresh.
  if (notifySettings().enabled && typeof Notification !== "undefined" && Notification.permission === "granted") {
    registerThisDevice({ quiet: true }).catch((e) => console.warn("push refresh", e));
  }
}

const appUrl = () => location.href.split("#")[0].split("?")[0];

async function withBusy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { console.error(e); toast("Something went wrong. Check your connection and try again."); }
  finally { btn.disabled = false; }
}

// ---------- Username and email changes ----------
async function changeUsername(name) {
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(name)) throw new Error("Usernames are 3–20 letters, numbers, dots, dashes or underscores.");
  const old = state.profile?.username || "";
  if (name === old) return;
  const uidNow = state.user.uid, email = state.user.email;
  const newKey = name.toLowerCase(), oldKey = old.toLowerCase();
  if (newKey !== oldKey) {
    const taken = await fb.getDoc(fb.doc(`usernames/${newKey}`));
    if (taken.exists()) throw new Error("That username is taken. Pick another one.");
    await fb.setDoc(fb.doc(`usernames/${newKey}`), { uid: uidNow, email });
    if (oldKey) await fb.deleteDoc(fb.doc(`usernames/${oldKey}`)).catch((e) => console.warn(e));
  }
  await updateProfile({ username: name });
  renderAll();
}

async function requestEmailChange(newEmail, password) {
  const current = state.user.email;
  if (!newEmail.includes("@")) throw new Error("Enter your new email address.");
  if (newEmail.toLowerCase() === String(current).toLowerCase()) throw new Error("That's already your email.");
  if (!password) throw new Error("Enter your current password.");
  try { await fb.reauth(state.user, current, password); }
  catch (e) { throw new Error(["auth/invalid-credential", "auth/wrong-password"].includes(e?.code) ? "That password is wrong." : authError(e)); }
  try { await fb.verifyBeforeUpdateEmail(state.user, newEmail, { url: appUrl() }); }
  catch (e) {
    if (String(e?.code).includes("continue-uri") || e?.code === "auth/unauthorized-domain") await fb.verifyBeforeUpdateEmail(state.user, newEmail);
    else throw new Error(authError(e));
  }
  return newEmail;
}

// ---------- Account deletion (confirmed through an emailed link) ----------
async function requestDeletionLink(email) {
  try { localStorage.setItem("gct.deleteEmail", email); } catch { /* optional */ }
  await fb.sendSignInLink(fb.auth, email, { url: appUrl() + "?confirm=delete", handleCodeInApp: true });
}

function deleteCard(html) {
  $("#authCard").innerHTML = html;
}

function deleteFlowStart() {
  let saved = "";
  try { saved = localStorage.getItem("gct.deleteEmail") || ""; } catch { /* optional */ }
  deleteCard(`
    <h2>Confirm account deletion</h2>
    <p class="lead">Enter the email of the account you want to delete.</p>
    <form id="dfForm" class="stack" novalidate>
      <div class="field"><label for="dfEmail">Email</label><input id="dfEmail" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="${esc(saved)}"></div>
      <button class="primary" type="submit" id="dfGo" style="margin-top:4px">Continue</button>
    </form>
    <p class="form-msg err" id="dfMsg" hidden></p>
    <div class="auth-links"><button id="dfCancel">Keep my account</button></div>`);
  $("#dfCancel").addEventListener("click", cancelDeleteFlow);
  $("#dfForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#dfEmail").value.trim();
    $("#dfGo").disabled = true;
    try {
      await fb.signInWithLink(fb.auth, email, location.href);
      deleteConfirmStep();
    } catch (err) {
      $("#dfMsg").textContent = err?.code === "auth/invalid-action-code" || err?.code === "auth/expired-action-code"
        ? "This delete link has expired or was already used. Request a new one from Profile > Delete my account."
        : err?.code === "auth/invalid-email" ? "That email doesn't match the link. Use the email the link was sent to." : authError(err);
      $("#dfMsg").hidden = false;
      $("#dfGo").disabled = false;
    }
  });
}

async function deleteConfirmStep() {
  const user = fb.auth.currentUser;
  state.user = user;
  let username = "";
  try { const snap = await fb.getDoc(fb.doc(`users/${user.uid}`)); username = snap.exists() ? snap.data().username || "" : ""; } catch { /* shown below */ }
  deleteCard(`
    <h2>Delete ${esc(username || user.email)}?</h2>
    <p class="lead">This erases the login for <b>${esc(user.email)}</b>, the profile, goals, saved foods and the whole food log. It can't be undone.</p>
    <button class="secondary" id="dcBackup">Download a backup first</button>
    <button class="primary" id="dcDelete" style="background:var(--over)">Delete forever</button>
    <p class="form-msg err" id="dcMsg" hidden></p>
    <div class="auth-links"><button id="dcCancel">Keep my account</button></div>`);
  $("#dcCancel").addEventListener("click", cancelDeleteFlow);
  $("#dcBackup").addEventListener("click", (e) => withBusy(e.target, async () => { state.profile = (await fb.getDoc(fb.doc(`users/${user.uid}`))).data() || {}; await downloadBackup(); }));
  armButton($("#dcDelete"), "Tap again to delete forever", async () => {
    try {
      await deleteEverything(user, username);
      try { localStorage.removeItem("gct.deleteEmail"); } catch { /* optional */ }
      history.replaceState(null, "", appUrl());
      deleteCard(`<h2>Account deleted</h2><p class="lead">Everything for ${esc(user.email)} has been erased.</p>
        <button class="primary" id="dcDone">Back to sign in</button>`);
      $("#dcDone").addEventListener("click", () => location.replace(appUrl()));
    } catch (err) {
      console.error(err);
      $("#dcMsg").textContent = "Couldn't finish deleting. Check your connection and open the link again, or request a new one.";
      $("#dcMsg").hidden = false;
    }
  });
}

async function deleteEverything(user, username) {
  const months = await fb.listMonths();
  for (const d of months.docs) await fb.deleteDoc(fb.doc(`users/${user.uid}/months/${d.id}`));
  if (username) {
    const key = username.toLowerCase();
    const snap = await fb.getDoc(fb.doc(`usernames/${key}`));
    if (snap.exists() && snap.data().uid === user.uid) await fb.deleteDoc(fb.doc(`usernames/${key}`));
  }
  await fb.deleteDoc(fb.doc(`users/${user.uid}`));
  await fb.deleteUser(user);
}

function cancelDeleteFlow() {
  state.deleteFlow = false;
  history.replaceState(null, "", appUrl());
  location.replace(appUrl());
}

// ---------- Profile photo ----------
// Stored as a small JPEG inside the profile document (Firebase file storage needs a paid plan).
async function makeProfilePhoto(file) {
  if (!/^image\//.test(file.type)) throw new Error("Pick an image file.");
  if (file.size > 25 * 1024 * 1024) throw new Error("That photo is too large. Pick one under 25 MB.");
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch {
    const url = URL.createObjectURL(file);
    try { const img = new Image(); img.src = url; await img.decode(); bmp = img; } finally { URL.revokeObjectURL(url); }
  }
  const w = bmp.width, h = bmp.height, side = Math.min(w, h);
  const canvas = document.createElement("canvas");
  for (const [size, q] of [[256, 0.82], [200, 0.75], [160, 0.7]]) {
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(bmp, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length < 60000) { bmp.close?.(); return url; }
  }
  bmp.close?.();
  throw new Error("Couldn't shrink that photo enough. Try another one.");
}

// ---------- Export, backup and restore ----------
function saveFile(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function allMonths() {
  const snap = await fb.listMonths();
  return snap.docs.map((d) => [d.id, d.data()]).sort((a, b) => a[0].localeCompare(b[0]));
}

async function exportCsv() {
  const months = await allMonths();
  const cell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [["Date", "Meal", "Food", "Serving", "Servings", "Calories (kcal)", "Protein (g)", "Carbs (g)", "Fat (g)", "Sugar (g)", "Sodium (mg)", "Price paid ($)", "Type of food", "Source"]];
  for (const [, m] of months) {
    for (const date of Object.keys(m.days || {}).sort()) {
      const d = m.days[date] || {};
      for (const meal of MEALS) for (const e of d[meal.id] || []) {
        const q = num(e.qty) || 1;
        const opt = (v, f) => (v == null ? "" : f(num(v) * q));
        rows.push([date, meal.name, e.name, e.serving, r1(q), r0(num(e.kcal) * q), r1(num(e.protein) * q), r1(num(e.carbs) * q), r1(num(e.fat) * q), opt(e.sugar, r1), opt(e.sodium, r0), hasPrice(e) ? num(e.price).toFixed(2) : "", spendTypeName(spendType(e)), e.source]);
      }
    }
  }
  if (rows.length === 1) { toast("Nothing logged yet"); return; }
  saveFile(`food-log-${(state.profile?.username || "me").toLowerCase()}-${todayKey()}.csv`, "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n"), "text/csv");
  toast(`Downloaded ${rows.length - 1} entries`);
}

async function downloadBackup() {
  const months = await allMonths();
  const p = state.profile || {};
  const backup = {
    app: "graces-calorie-tracker", version: 1, exportedAt: new Date().toISOString(),
    profile: { username: p.username || "", goals: p.goals || null, customFoods: p.customFoods || [], recents: p.recents || [] },
    months: Object.fromEntries(months.map(([id, m]) => [id, { days: m.days || {} }])),
  };
  saveFile(`calorie-tracker-backup-${(p.username || "me").toLowerCase()}-${todayKey()}.json`, JSON.stringify(backup), "application/json");
  toast("Backup downloaded");
}

function parseBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch { throw new Error("That file isn't a backup from this app."); }
  if (!b || b.app !== "graces-calorie-tracker" || typeof b.months !== "object") throw new Error("That file isn't a backup from this app.");
  for (const [m, v] of Object.entries(b.months)) {
    if (!/^\d{4}-\d{2}$/.test(m) || typeof v?.days !== "object") throw new Error("This backup file is damaged.");
    for (const d of Object.keys(v.days)) if (!d.startsWith(m + "-")) throw new Error("This backup file is damaged.");
  }
  return b;
}

async function restoreBackup(b) {
  for (const [month, v] of Object.entries(b.months)) {
    const days = {};
    for (const [date, day] of Object.entries(v.days)) days[date] = Object.fromEntries(MEALS.map((m) => [m.id, Array.isArray(day?.[m.id]) ? day[m.id] : []]));
    const path = monthPath(month);
    await queueWrite(path, () => fb.setDoc(fb.doc(path), { month, days, updatedAt: new Date().toISOString() }, { merge: true }));
  }
  const patch = {};
  if (b.profile?.goals) patch.goals = b.profile.goals;
  if (Array.isArray(b.profile?.customFoods)) {
    const mine = state.profile?.customFoods || [];
    const names = new Set(b.profile.customFoods.map((f) => String(f.name).toLowerCase()));
    patch.customFoods = [...b.profile.customFoods, ...mine.filter((f) => !names.has(String(f.name).toLowerCase()))].slice(0, 300);
  }
  if (Object.keys(patch).length) await updateProfile(patch);
  state.months = {};
  for (const unsub of state.monthSubs.values()) unsub();
  state.monthSubs.clear();
  renderAll();
}

// ---------- Notifications ----------
const localTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Singapore"; } catch { return "Asia/Singapore"; } };
const hourLabel = (h) => (h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`);

function notifySettings() {
  const n = state.profile?.notify || {};
  return {
    enabled: !!n.enabled, every: num(n.every), from: n.from ?? 9, to: n.to ?? 22,
    meals: { breakfast: n.meals?.breakfast ?? null, lunch: n.meals?.lunch ?? null, dinner: n.meals?.dinner ?? null },
    eod: n.eod === undefined ? 21 : n.eod, tokens: Array.isArray(n.tokens) ? n.tokens : [],
  };
}

function notifySummary() {
  const n = notifySettings();
  if (!n.enabled) return "Off";
  const parts = [];
  if (n.every) parts.push(n.every === 1 ? "hourly" : `every ${n.every}h`);
  const meals = Object.values(n.meals).filter((v) => v != null).length;
  if (meals) parts.push(`${meals} meal${meals > 1 ? "s" : ""}`);
  if (n.eod != null) parts.push(`end of day ${hourLabel(n.eod)}`);
  return parts.length ? "On: " + parts.join(", ") : "On";
}

const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function pushSupport() {
  if (!VAPID_KEY || /PASTE/i.test(VAPID_KEY)) return { ok: false, why: "Notifications aren't set up yet: the Web Push key is missing from firebase-config.js. See the README." };
  if (isIos() && !isStandalone()) return { ok: false, why: "On iPhone, notifications only work in the app added to your Home Screen (iOS 16.4 or newer). Add it from Safari's Share menu, open it from the icon, then turn notifications on there." };
  if (!("serviceWorker" in navigator) || typeof Notification === "undefined" || !("PushManager" in window)) return { ok: false, why: "This browser doesn't support notifications. Try Chrome on Android, or the Home Screen app on iPhone." };
  if (Notification.permission === "denied") return { ok: false, why: "Notifications are blocked for this app. Allow them in your phone or browser settings, then come back here." };
  return { ok: true };
}

let messagingMod = null, messagingInst = null;
async function getMessaging() {
  if (!messagingMod) messagingMod = await import(FB + "firebase-messaging.js");
  if (!(await messagingMod.isSupported())) throw new Error("This browser doesn't support notifications.");
  if (!messagingInst) {
    messagingInst = messagingMod.getMessaging(fb.app);
    messagingMod.onMessage(messagingInst, (payload) => {
      const d = payload?.data || payload?.notification || {};
      if (d.title || d.body) toast(d.body || d.title);
    });
  }
  return messagingInst;
}

async function registerThisDevice({ quiet = false } = {}) {
  const support = pushSupport();
  if (!support.ok) throw new Error(support.why);
  if (!quiet && Notification.permission !== "granted") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Notifications weren't allowed. Allow them in your phone or browser settings to get reminders.");
  }
  if (Notification.permission !== "granted") return;
  const messaging = await getMessaging();
  const reg = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  const token = await messagingMod.getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error("Couldn't register this device for notifications. Try again.");
  const tokens = notifySettings().tokens;
  if (!tokens.includes(token)) await updateProfile({ notify: { tokens: [token, ...tokens].slice(0, 10) } });
}

async function showLocalNotification(title, body) {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification(title, { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "gct-test" });
}

boot();
