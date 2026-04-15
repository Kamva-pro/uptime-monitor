const express = require("express");
const axios   = require("axios");
const cors    = require("cors");
const fs      = require("fs");
const path    = require("path");

const app  = express();
const PORT = process.env.PORT || 4000;
const DB_PATH           = process.env.DB_PATH || path.join(__dirname, "data", "db.json");
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS || "60000"); // 1 minute

// ─── Simple JSON "database" ──────────────────────────────────────────────────
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); }
  catch { return { sites: [], checks: [], _nextId: 1 }; }
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Ping helper ─────────────────────────────────────────────────────────────
async function ping(url, retries = 3) {
  const start = Date.now();
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, {
        timeout: 30000, // 30 second timeout per attempt
        validateStatus: () => true,
        maxRedirects: 5,
        headers: { "User-Agent": "UptimeMonitorBot/1.0" },
      });
      
      // If we get a response >= 500, it's a server error, we might want to retry
      if (res.status >= 500 && attempt < retries) {
        console.log(`[RETRY] ${url} returned ${res.status}, attempt ${attempt}/${retries}`);
        await new Promise(r => setTimeout(r, 2000)); // wait 2s before retry
        continue;
      }

      return { up: res.status < 500, statusCode: res.status, responseMs: Date.now() - start };
    } catch (err) {
      if (attempt < retries) {
        console.log(`[RETRY] ${url} failed (${err.message}), attempt ${attempt}/${retries}`);
        await new Promise(r => setTimeout(r, 2000)); // wait 2s before retry
        continue;
      }
      return { up: false, statusCode: null, responseMs: null };
    }
  }
}

function recordCheck(siteId, result) {
  const db = loadDB();
  db.checks.push({
    id:         db._nextId++,
    siteId,
    up:         result.up,
    statusCode: result.statusCode,
    responseMs: result.responseMs,
    checkedAt:  Date.now(),
  });
  // Keep only last 2000 checks total to avoid unbounded file growth
  if (db.checks.length > 2000) db.checks = db.checks.slice(-2000);
  saveDB(db);
}

function enrichSite(site, db) {
  const now    = Date.now();
  const siteChecks = db.checks.filter((c) => c.siteId === site.id);
  const latest = siteChecks[siteChecks.length - 1] || null;

  const checks24h   = siteChecks.filter((c) => c.checkedAt > now - 86400_000);
  const uptimePct   = checks24h.length
    ? Math.round((checks24h.filter((c) => c.up).length / checks24h.length) * 100)
    : null;

  const history = siteChecks.slice(-48).map((c) => c.up);

  return { ...site, latest, uptimePct, history };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /sites
app.get("/sites", (req, res) => {
  const db = loadDB();
  res.json(db.sites.map((s) => enrichSite(s, db)));
});

// POST /sites
app.post("/sites", (req, res) => {
  const { name, url } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  const db = loadDB();
  if (db.sites.find((s) => s.url === url)) {
    return res.status(409).json({ error: "Site already exists" });
  }

  const site = { id: db._nextId++, name: name || url, url, createdAt: Date.now() };
  db.sites.push(site);
  saveDB(db);

  // Immediately check it (async, don't await)
  ping(url).then((result) => recordCheck(site.id, result));

  res.status(201).json(site);
});

// DELETE /sites/:id
app.delete("/sites/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const db = loadDB();
  db.sites  = db.sites.filter((s) => s.id !== id);
  db.checks = db.checks.filter((c) => c.siteId !== id);
  saveDB(db);
  res.json({ ok: true });
});

// POST /sites/:id/check
app.post("/sites/:id/check", async (req, res) => {
  const id   = parseInt(req.params.id);
  const db   = loadDB();
  const site = db.sites.find((s) => s.id === id);
  if (!site) return res.status(404).json({ error: "Not found" });

  const result = await ping(site.url);
  recordCheck(site.id, result);
  res.json(result);
});

// POST /check-all
app.post("/check-all", async (req, res) => {
  const db = loadDB();
  const results = await Promise.all(
    db.sites.map(async (site) => {
      const result = await ping(site.url);
      recordCheck(site.id, result);
      return { site: site.name, ...result };
    })
  );
  res.json(results);
});

// ─── Scheduled checks ────────────────────────────────────────────────────────
async function runScheduledChecks() {
  const db = loadDB();
  if (!db.sites.length) return;
  console.log(`[${new Date().toISOString()}] Checking ${db.sites.length} site(s)...`);
  await Promise.all(
    db.sites.map(async (site) => {
      const result = await ping(site.url);
      recordCheck(site.id, result);
      console.log(`  ${result.up ? "UP  " : "DOWN"} ${site.url} (${result.responseMs ?? "—"}ms)`);
    })
  );
}

setInterval(runScheduledChecks, CHECK_INTERVAL_MS);
runScheduledChecks();

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Uptime monitor backend running on http://localhost:${PORT}`);
});
