import assert from "node:assert/strict";
import { test } from "node:test";
import { atom, parseUpdate, plain, toIncident } from "./incidents.mjs";

test("plain strips markdown, links and html comments", () => {
  assert.equal(plain("**Resolved:** back up in [`90e72d0`](https://x/commit\n) <!-- meta -->"), "Resolved: back up in 90e72d0");
  assert.equal(plain("<script>alert(1)</script>"), "<script>alert(1)</script>"); // stays text; page uses textContent
  assert.equal(plain("x".repeat(5000)).length, 2000);
});

test("parseUpdate reads status prefixes in the usual spellings", () => {
  assert.deepEqual(parseUpdate(1, "t", "**Resolved:** Mail is back up."), { id: 1, createdAt: "t", status: "resolved", text: "Mail is back up." });
  assert.equal(parseUpdate(1, "t", "Identified: disk full").status, "identified");
  assert.equal(parseUpdate(1, "t", "**Monitoring** fix deployed").text, "fix deployed");
  assert.equal(parseUpdate(1, "t", "just a note").status, "update");
});

test("toIncident maps an Upptime auto issue", () => {
  const issue = {
    number: 4, title: "🛑 Mail is down", html_url: "https://github.com/o/r/issues/4", state: "closed",
    labels: [{ name: "status" }, { name: "mail" }], created_at: "2026-11-15T22:04:53Z", closed_at: "2026-11-15T22:22:44Z",
    body: "In [`b5327f6`](https://github.com/o/r/commit/b5327f6\n), Mail (https://mail.jinc.io) was **down**:\n- HTTP code: 0",
  };
  const i = toIncident(issue, [{ id: 9, created_at: "2026-11-15T22:22:44Z", body: "**Resolved:** Mail is back up." }]);
  assert.equal(i.title, "Mail is down");
  assert.deepEqual(i.sites, ["mail"]);
  assert.equal(i.type, "incident");
  assert.equal(i.updates[0].status, "investigating");
  assert.match(i.updates[0].text, /^Mail \(https:\/\/mail\.jinc\.io\) was down/);
  assert.equal(i.updates[1].status, "resolved");
});

test("maintenance issues default to scheduled", () => {
  const i = toIncident({ number: 5, title: "DB upgrade", html_url: "u", state: "open", labels: [{ name: "maintenance" }],
    created_at: "2026-11-16T00:00:00Z", closed_at: null, body: "Upgrading Postgres" }, []);
  assert.equal(i.type, "maintenance");
  assert.equal(i.updates[0].status, "scheduled");
});

test("atom escapes content and has a stable updated timestamp", () => {
  const inc = { number: 1, title: "A & <B>", url: "u", state: "open", createdAt: "2026-01-01T00:00:00Z", closedAt: null,
    updates: [{ status: "investigating", createdAt: "2026-01-01T00:05:00Z", text: "x < y" }] };
  const xml = atom([inc]);
  assert.match(xml, /<title>A &amp; &lt;B&gt;<\/title>/);
  assert.match(xml, /<updated>2026-01-01T00:05:00Z<\/updated>/);
  assert.equal(atom([inc]), xml);
});
