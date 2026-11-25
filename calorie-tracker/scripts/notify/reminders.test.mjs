// Run with: node --test reminders.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, localParts } from "./reminders.mjs";

const at = (iso) => new Date(iso);
const base = { every: 0, from: 9, to: 22, meals: { breakfast: null, lunch: 14, dinner: null }, eod: 21 };
const meal = (kcal = 500) => [{ name: "x", kcal, qty: 1 }];

test("local time uses the person's time zone", () => {
  assert.deepEqual(localParts(at("2026-11-25T13:30:00Z"), "Asia/Singapore"), { date: "2026-11-25", hour: 21 });
  assert.deepEqual(localParts(at("2026-11-25T16:30:00Z"), "Asia/Singapore"), { date: "2026-11-26", hour: 0 });
});

test("lunch reminder only if lunch not logged, only once", () => {
  const r1 = decide(base, {}, { date: "2026-11-25", hour: 14 }, at("2026-11-25T06:05:00Z"), 1800);
  assert.match(r1.message.body, /lunch/);
  const r2 = decide({ ...base, state: r1.state }, {}, { date: "2026-11-25", hour: 15 }, at("2026-11-25T07:05:00Z"), 1800);
  assert.equal(r2.message, null);
  const r3 = decide(base, { lunch: meal() }, { date: "2026-11-25", hour: 14 }, at("2026-11-25T06:05:00Z"), 1800);
  assert.equal(r3.message, null);
});

test("late job still sends within 3 hours, skips after", () => {
  assert.ok(decide(base, {}, { date: "d", hour: 16 }, at("2026-11-25T08:05:00Z"), 1800).message);
  assert.equal(decide({ ...base, eod: null }, {}, { date: "d", hour: 17 }, at("2026-11-25T09:05:00Z"), 1800).message, null);
});

test("end of day beats other reminders and only fires when nothing logged", () => {
  const r = decide({ ...base, every: 1 }, {}, { date: "d", hour: 21 }, at("2026-11-25T13:05:00Z"), 1800);
  assert.equal(r.message.tag, "gct-eod");
  assert.equal(decide(base, { supper: meal() }, { date: "d", hour: 21 }, at("2026-11-25T13:05:00Z"), 1800).message, null);
});

test("every 2 hours inside the window, with totals", () => {
  const n = { ...base, every: 2, meals: {}, eod: null };
  const r1 = decide(n, { breakfast: meal(450) }, { date: "d", hour: 9 }, at("2026-11-25T01:07:00Z"), 1600);
  assert.equal(r1.message.body, "You've logged 450 of 1,600 kcal today.");
  const r2 = decide({ ...n, state: r1.state }, {}, { date: "d", hour: 10 }, at("2026-11-25T02:07:00Z"), 1600);
  assert.equal(r2.message, null);
  const r3 = decide({ ...n, state: r1.state }, {}, { date: "d", hour: 11 }, at("2026-11-25T03:01:00Z"), 1600);
  assert.ok(r3.message, "a slightly early run still counts");
  assert.equal(decide(n, {}, { date: "d", hour: 23 }, at("2026-11-25T15:07:00Z"), 1600).message, null, "outside window");
});

test("new day resets what was sent", () => {
  const r = decide({ ...base, state: { date: "2026-11-24", sent: ["lunch", "eod"] } }, {}, { date: "2026-11-25", hour: 14 }, at("2026-11-25T06:05:00Z"), 1800);
  assert.ok(r.message);
});

test("nothing chosen means nothing sent", () => {
  assert.equal(decide({ every: 0, meals: {}, eod: null }, {}, { date: "d", hour: 21 }, at("2026-11-25T13:05:00Z"), 1800).message, null);
});
