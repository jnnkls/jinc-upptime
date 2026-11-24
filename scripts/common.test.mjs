import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { applyOngoing, level } = createRequire(import.meta.url)("../assets/common.js");
const inc = (o) => ({ number: 1, state: "open", type: "incident", sites: ["immich"], createdAt: "2026-11-24T18:42:00Z", ...o });
const site = (dmd = {}) => ({ slug: "immich", dailyMinutesDown: dmd });

test("open incident adds elapsed minutes to today", () => {
  const [s] = applyOngoing([site({ "2026-11-24": 0 })], [inc()], new Date("2026-11-24T22:42:00Z"));
  assert.equal(s.dailyMinutesDown["2026-11-24"], 240);
  assert.equal(level("2026-11-24", 240), "major");
});

test("open incident spanning midnight is split per UTC day", () => {
  const [s] = applyOngoing([site()], [inc({ createdAt: "2026-11-24T23:30:00Z" })], new Date("2026-11-25T00:45:00Z"));
  assert.deepEqual(s.dailyMinutesDown, { "2026-11-24": 30, "2026-11-25": 45 });
});

test("recorded downtime is kept when larger, closed/maintenance/other sites untouched", () => {
  const now = new Date("2026-11-24T19:00:00Z");
  const [s] = applyOngoing([site({ "2026-11-24": 120 })], [inc()], now);
  assert.equal(s.dailyMinutesDown["2026-11-24"], 120);
  const others = applyOngoing([site(), { slug: "mail", dailyMinutesDown: {} }],
    [inc({ state: "closed" }), inc({ type: "maintenance" }), inc({ sites: ["ntfy"] })], now);
  assert.deepEqual(others.map((x) => x.dailyMinutesDown), [{}, {}]);
});
