// Builds static incident data for the status page from GitHub issues labelled "status"/"maintenance".
// Output (served via assets/ -> GitHub Pages):
//   assets/incidents/index.json    { cursor, months: [{ month: "YYYY-MM", count }] }        newest first; cursor = newest issue updated_at
//   assets/incidents/YYYY-MM.json  { month, incidents: Incident[] }                          one file per month, bounded size
//   assets/incidents/recent.json   { incidents: Incident[] }                                  open + last RECENT_DAYS days
//   assets/feed.xml                Atom feed of the latest FEED_ITEMS incidents
// Incident: { number, title, url, state, type, sites, createdAt, closedAt, updates: [{ id, createdAt, status, text }] }
// Incremental: only issues updated since the cursor are refetched; FULL=1 rebuilds everything.
// No wall-clock timestamps in the output, so an unchanged run writes identical files (no commit, no site rebuild).
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = process.env.GITHUB_REPOSITORY || "jnnkls/jinc-upptime";
const OUT = process.env.OUT_DIR || "assets";
const SITE_URL = "https://status.jinc.io";
const RECENT_DAYS = 14;
const FEED_ITEMS = 30;
const MAX_TEXT = 2000;
const LABELS = new Set(["status", "maintenance"]);
const STATUS_RE = /^\s*\**\s*(investigating|identified|monitoring|resolved|update|scheduled|in progress|completed)\s*:?\s*\**\s*:?\s*/i;

// Markdown -> plain text: the page renders text only (no HTML injection from issue bodies).
export function plain(md) {
  return (md || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\(\s*([^)]*?)\s*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/^#+\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
}

export function parseUpdate(id, createdAt, body) {
  const m = (body || "").match(STATUS_RE);
  return { id, createdAt, status: m ? m[1].toLowerCase() : "update", text: plain(m ? body.slice(m[0].length) : body) };
}

export function toIncident(issue, comments) {
  const labels = issue.labels.map((l) => (typeof l === "string" ? l : l.name));
  const auto = /^\s*In \[`/.test(issue.body || ""); // Upptime's own "X was down" body
  const first = parseUpdate(`issue-${issue.number}`, issue.created_at, issue.body);
  if (first.status === "update") first.status = labels.includes("maintenance") ? "scheduled" : "investigating";
  if (auto) first.text = first.text.replace(/^In [0-9a-f]{7},\s*/, "");
  return {
    number: issue.number,
    title: issue.title.replace(/^[🛑🟥🟧⚠️\s]+/u, ""),
    url: issue.html_url,
    state: issue.state,
    type: labels.includes("maintenance") ? "maintenance" : "incident",
    sites: labels.filter((l) => !LABELS.has(l)),
    createdAt: issue.created_at,
    closedAt: issue.closed_at,
    updates: [first, ...comments.map((c) => parseUpdate(c.id, c.created_at, c.body))].filter((u) => u.text),
  };
}

const monthOf = (iso) => iso.slice(0, 7);

export function atom(incidents) {
  const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
  const entries = incidents.slice(0, FEED_ITEMS).map((i) => {
    const last = i.updates.at(-1) || { createdAt: i.createdAt, status: "", text: "" };
    const content = [...i.updates].reverse().map((u) => `${u.status.toUpperCase()} (${u.createdAt}): ${u.text}`).join("\n\n");
    return `  <entry>
    <id>${esc(i.url)}</id>
    <title>${esc(`${i.state === "open" ? "" : "[Resolved] "}${i.title}`)}</title>
    <link href="${esc(`${SITE_URL}/incidents/#${i.number}`)}"/>
    <published>${i.createdAt}</published>
    <updated>${i.closedAt || last.createdAt}</updated>
    <content type="text">${esc(content)}</content>
  </entry>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>jinc.io Status</title>
  <id>${SITE_URL}/</id>
  <link href="${SITE_URL}/"/>
  <link rel="self" href="${SITE_URL}/feed.xml"/>
  <updated>${incidents.flatMap((i) => [i.closedAt, ...i.updates.map((u) => u.createdAt)]).filter(Boolean).sort().at(-1) || "1970-01-01T00:00:00Z"}</updated>
${entries.join("\n")}
</feed>
`;
}

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`);
  return res.json();
}

async function ghAll(path) {
  const all = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

const readJson = async (f, fallback) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return fallback; } };

async function main() {
  const dir = join(OUT, "incidents");
  await mkdir(dir, { recursive: true });
  const full = process.env.FULL === "1";
  const index = await readJson(join(dir, "index.json"), null);
  // 1 h overlap so issues edited during the previous run are not missed
  const since = !full && index?.cursor ? new Date(Date.parse(index.cursor) - 3600e3).toISOString() : null;

  // Load the existing store (all month files) keyed by issue number.
  const store = new Map();
  if (!full) for (const f of await readdir(dir)) {
    if (/^\d{4}-\d{2}\.json$/.test(f)) for (const i of (await readJson(join(dir, f), { incidents: [] })).incidents) store.set(i.number, i);
  }

  const issues = await ghAll(`/repos/${REPO}/issues?state=all&sort=updated&direction=desc${since ? `&since=${since}` : ""}`);
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const relevant = issue.labels.some((l) => LABELS.has(l.name));
    if (!relevant) { store.delete(issue.number); continue; }
    const comments = issue.comments ? await ghAll(`/repos/${REPO}/issues/${issue.number}/comments`) : [];
    store.set(issue.number, toIncident(issue, comments));
  }

  const all = [...store.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const byMonth = Map.groupBy(all, (i) => monthOf(i.createdAt));
  for (const f of await readdir(dir)) if (/^\d{4}-\d{2}\.json$/.test(f) && !byMonth.has(f.slice(0, 7))) await rm(join(dir, f));
  for (const [month, incidents] of byMonth) await writeFile(join(dir, `${month}.json`), JSON.stringify({ month, incidents }) + "\n");

  const cutoff = new Date(Date.now() - RECENT_DAYS * 864e5).toISOString();
  const recent = all.filter((i) => i.state === "open" || i.createdAt >= cutoff);
  const cursor = [index?.cursor, ...issues.map((i) => i.updated_at)].filter(Boolean).sort().at(-1) || null;
  await writeFile(join(dir, "recent.json"), JSON.stringify({ incidents: recent }) + "\n");
  await writeFile(join(dir, "index.json"), JSON.stringify({ cursor, months: [...byMonth].map(([month, l]) => ({ month, count: l.length })) }) + "\n");
  await writeFile(join(OUT, "feed.xml"), atom(all));
  console.log(`${issues.length} issues fetched${since ? ` since ${since}` : " (full)"}, ${all.length} incidents in ${byMonth.size} month files, ${recent.length} recent`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
