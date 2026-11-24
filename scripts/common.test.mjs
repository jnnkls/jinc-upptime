import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { applyIncidents, applyLiveStatus, applyOverrides, level } = createRequire(import.meta.url)("../assets/common.js");
const inc = (o) => ({ number: 1, title: "Immich is down", state: "open", type: "incident", sites: ["immich"], createdAt: "2026-11-24T18:42:00Z", closedAt: null, ...o });
const site = (dmd = {}, status = "up") => ({ slug: "immich", status, dailyMinutesDown: dmd });

test("open incident adds elapsed minutes to today", () => {
  const [s] = applyIncidents([site({ "2026-11-24": 0 })], [inc()], new Date("2026-11-24T22:42:00Z"));
  assert.equal(s.dailyMinutesDown["2026-11-24"], 240);
  assert.equal(level("2026-11-24", 240), "major");
});

test("incident spanning midnight is split per UTC day", () => {
  const [s] = applyIncidents([site()], [inc({ createdAt: "2026-11-24T23:30:00Z" })], new Date("2026-11-25T00:45:00Z"));
  assert.deepEqual(s.dailyMinutesDown, { "2026-11-24": 30, "2026-11-25": 45 });
});

test("closed incident counts before the daily summary rebuild, override window wins", () => {
  const closed = inc({ state: "closed", closedAt: "2026-11-24T19:12:00Z" });
  assert.deepEqual(applyIncidents([site()], [closed])[0].dailyMinutesDown, { "2026-11-24": 30 });
  const corrected = { ...closed, downtime: { start: "2026-11-24T18:40:00Z", end: "2026-11-24T18:44:00Z" } };
  assert.deepEqual(applyIncidents([site()], [corrected])[0].dailyMinutesDown, { "2026-11-24": 4 });
});

test("recorded downtime is kept when larger; maintenance and other sites untouched", () => {
  const now = new Date("2026-11-24T19:00:00Z");
  assert.equal(applyIncidents([site({ "2026-11-24": 120 })], [inc()], now)[0].dailyMinutesDown["2026-11-24"], 120);
  const others = applyIncidents([site(), { slug: "mail", dailyMinutesDown: {} }], [inc({ type: "maintenance" }), inc({ sites: ["ntfy"] })], now);
  assert.deepEqual(others.map((x) => x.dailyMinutesDown), [{}, {}]);
});

test("live status comes from open incidents, not the stale summary", () => {
  const sites = [site({}, "down"), { slug: "mail", status: "up", dailyMinutesDown: {} }, { slug: "ntfy", status: "up", dailyMinutesDown: {} }];
  applyLiveStatus(sites, [inc({ state: "closed" }), inc({ sites: ["mail"] }), inc({ sites: ["ntfy"], title: "ntfy has degraded performance" })]);
  assert.deepEqual(sites.map((s) => s.status), ["up", "down", "degraded"]);
});

test("downtime override replaces the issue window per day", () => {
  // Upptime recorded 18:42:30-22:41:07 (239 min); real outage 18:40:25-18:44:07 (4 min)
  const o = { number: 12, sites: ["immich"], createdAt: "2026-11-24T18:42:30Z", closedAt: "2026-11-24T22:41:07Z",
    downtime: { start: "2026-11-24T18:40:25Z", end: "2026-11-24T18:44:07Z" } };
  const [s, other] = applyOverrides([site({ "2026-11-24": 239, "2026-11-23": 5 }), { slug: "mail", dailyMinutesDown: { "2026-11-24": 7 } }], [o]);
  assert.deepEqual(s.dailyMinutesDown, { "2026-11-24": 4, "2026-11-23": 5 });
  assert.deepEqual(other.dailyMinutesDown, { "2026-11-24": 7 });
  // open incidents are skipped; never below zero (stale summary without the 239 yet)
  const [z] = applyOverrides([site({ "2026-11-24": 0 })], [{ ...o, closedAt: null }, o]);
  assert.deepEqual(z.dailyMinutesDown, { "2026-11-24": 4 });
});
