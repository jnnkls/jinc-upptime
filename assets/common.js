// Shared helpers for index.html, incidents/ and uptime/. All user content goes through textContent.
const REPO = "jnnkls/jinc-upptime";
// shortcut: monitoring started here; earlier days render as "no data". Upgrade by reading each history/<slug>.yml startTime.
const DATA_START = "2026-11-15";
const STATE_TEXT = { up: "Operational", degraded: "Degraded Performance", down: "Major Outage" };

// The old Upptime site registered a service worker that would keep serving its cached pages.
navigator.serviceWorker?.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function link(text, href, cls) { const a = el("a", cls, text); a.href = href; return a; }

const dayKey = (d) => d.toISOString().slice(0, 10);
const fmtDay = (key) => new Date(key + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtTime = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
const fmtDur = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const level = (day, minutes) => (day < DATA_START ? "nodata" : !minutes ? "up" : minutes < 60 ? "minor" : "major");
const levelText = (day, minutes) => (day < DATA_START ? "No data" : minutes ? `${fmtDur(minutes * 60000)} downtime` : "No downtime recorded");

// Upptime only counts downtime of closed issues, so a running outage would show green bars.
// Adds the elapsed minutes of open incidents per UTC day (max with the recorded value, never double).
function applyOngoing(sites, incidents, now = new Date()) {
  for (const inc of incidents) {
    if (inc.state !== "open" || inc.type !== "incident") continue;
    for (const s of sites) {
      if (!inc.sites.includes(s.slug)) continue;
      const dmd = (s.dailyMinutesDown = { ...s.dailyMinutesDown });
      for (let t = new Date(inc.createdAt); t < now; ) {
        const next = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1));
        const key = dayKey(t);
        dmd[key] = Math.max(dmd[key] || 0, Math.round((Math.min(next, now) - t) / 60000));
        t = next;
      }
    }
  }
  return sites;
}

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
const loadSummary = () => getJSON(`https://raw.githubusercontent.com/${REPO}/HEAD/history/summary.json`);

function updatesEl(incident) {
  const box = el("div", "updates");
  // newest first, like classic status pages
  for (const u of [...incident.updates].reverse()) {
    const d = el("div", "update");
    d.append(el("b", "s-" + u.status.replace(/\s+/g, "-"), u.status), el("p", null, u.text));
    const t = el("time", null, fmtTime(u.createdAt)); t.dateTime = u.createdAt;
    d.append(t);
    box.append(d);
  }
  return box;
}

// collapsed: title + latest update only, full timeline in <details>
function incidentEl(incident, { collapsed = false } = {}) {
  const cls = "incident" + (incident.state === "open" ? " open" : "") + (incident.type === "maintenance" ? " maintenance" : "");
  const wrap = el(collapsed ? "details" : "div", cls);
  wrap.id = String(incident.number);
  const h = el("h3"); h.append(link(incident.title, `/incidents/#${incident.number}`));
  const end = incident.closedAt ? new Date(incident.closedAt) : new Date();
  const meta = el("div", "muted", `${incident.state === "open" ? "Ongoing" : "Resolved"} · ${fmtDur(end - new Date(incident.createdAt))}`);
  meta.style.fontSize = ".8rem";
  if (collapsed) {
    const s = el("summary"); s.append(h, meta); wrap.append(s, updatesEl(incident));
  } else {
    wrap.append(h, updatesEl(incident));
  }
  return wrap;
}

// one shared tooltip for all [data-tip-day] elements (thousands of nodes; per-node listeners would be wasteful)
function initTooltip() {
  const tip = el("div"); tip.id = "tip"; tip.setAttribute("role", "tooltip"); document.body.append(tip);
  document.addEventListener("pointerover", (e) => {
    const b = e.target.closest("[data-tip-day]");
    if (!b) { tip.style.display = "none"; return; }
    tip.replaceChildren(el("b", null, fmtDay(b.dataset.tipDay)), document.createTextNode(levelText(b.dataset.tipDay, +b.dataset.min)));
    const r = b.getBoundingClientRect();
    tip.style.display = "block";
    tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2)) + "px";
    tip.style.top = Math.max(8, r.top - tip.offsetHeight - 8) + "px";
  });
}

// lets the node tests require this browser script
if (typeof module === "object") module.exports = { applyOngoing, level };
