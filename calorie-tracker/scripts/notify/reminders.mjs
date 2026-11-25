// Decides which reminder (if any) is due for one person right now.
// Pure logic with no Firebase calls, so it can be tested on its own (see reminders.test.mjs).

export const MEALS = ["breakfast", "lunch", "dinner"];
const MEAL_NAMES = { breakfast: "breakfast", lunch: "lunch", dinner: "dinner" };

// Local date and hour in the person's time zone.
export function localParts(now, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

const qty = (e) => Number(e?.qty) || 1;
export function dayTotals(day) {
  let kcal = 0;
  for (const m of [...MEALS, "supper"]) for (const e of day?.[m] || []) kcal += (Number(e.kcal) || 0) * qty(e);
  return { kcal: Math.round(kcal) };
}

/**
 * @param n      notify settings: { every, from, to, meals: {breakfast, lunch, dinner}, eod, state }
 * @param day    today's log { breakfast: [], lunch: [], dinner: [], supper: [] } or undefined
 * @param local  { date, hour } in the person's time zone
 * @param now    Date
 * @param goal   daily calorie goal
 * @returns { message: {title, body, tag} | null, state }  state is what to store for next time
 */
export function decide(n, day, local, now, goal) {
  const prev = n.state || {};
  const sent = prev.date === local.date ? [...(prev.sent || [])] : [];
  let lastEvery = prev.lastEvery || null;
  const H = local.hour;
  const logged = Object.fromEntries([...MEALS, "supper"].map((m) => [m, (day?.[m] || []).length > 0]));
  const anyLogged = Object.values(logged).some(Boolean);
  const due = { eod: false, meals: [], every: false };

  // End of day: nothing logged today by the chosen hour.
  if (n.eod != null && H >= n.eod && !sent.includes("eod")) {
    sent.push("eod");
    if (!anyLogged) due.eod = true;
  }
  // Meal reminders: that meal isn't logged by the chosen hour (skipped if the job runs 3+ hours late).
  for (const m of MEALS) {
    const h = n.meals?.[m];
    if (h == null || sent.includes(m) || H < h) continue;
    if (H < h + 3) { sent.push(m); if (!logged[m]) due.meals.push(m); }
  }
  // Regular reminders: every N hours inside the waking window.
  const every = Number(n.every) || 0;
  const from = n.from ?? 9, to = n.to ?? 22;
  if (every > 0 && H >= from && H <= to) {
    const since = lastEvery ? now - new Date(lastEvery) : Infinity;
    if (since >= every * 3600e3 - 20 * 60e3) { due.every = true; lastEvery = now.toISOString(); }
  }

  let message = null;
  if (due.eod) {
    message = { title: "Nothing logged today", body: "Take a minute to add what you ate today.", tag: "gct-eod" };
  } else if (due.meals.length) {
    const names = due.meals.map((m) => MEAL_NAMES[m]);
    const list = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " or " + names[names.length - 1];
    message = { title: `Did you have ${names[names.length - 1]}?`, body: `You haven't logged ${list} yet. Tap to add it.`, tag: "gct-meal" };
  } else if (due.every) {
    const { kcal } = dayTotals(day);
    message = { title: "Time to check in", body: kcal > 0 ? `You've logged ${kcal.toLocaleString("en-SG")} of ${Number(goal || 1800).toLocaleString("en-SG")} kcal today.` : "You haven't logged anything yet today.", tag: "gct-every" };
  }

  const state = { date: local.date, sent, lastEvery };
  return { message, state, changed: JSON.stringify(state) !== JSON.stringify({ date: prev.date, sent: prev.sent || [], lastEvery: prev.lastEvery || null }) };
}
