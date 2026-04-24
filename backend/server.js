const express    = require("express");
const axios      = require("axios");
const cors       = require("cors");
const fs         = require("fs");
const path       = require("path");
const nodemailer = require("nodemailer");

const app  = express();
const PORT = process.env.PORT || 4000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "db.json");

// ─── Mutable live config (env vars → db.settings override) ───────────────────
let cfg = {
  smtpHost:        process.env.SMTP_HOST        || "mail.dynamite.agency",
  smtpPort:        parseInt(process.env.SMTP_PORT || "587"),
  smtpUser:        process.env.SMTP_USER        || "",
  smtpPass:        process.env.SMTP_PASS        || "",
  smtpFrom:        process.env.SMTP_FROM        || "Uptime Monitor <alerts@dynamite.agency>",
  alertEmail:      process.env.ALERT_EMAIL      || "kamva@dynamite.agency",
  emailCooldownMs: parseInt(process.env.EMAIL_COOLDOWN_MS || "1800000"),
  checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS || "60000"),
  emailEnabled:    false,
};

// ─── JSON "database" ──────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); }
  catch { return { sites: [], checks: [], logs: [], settings: {}, _nextId: 1 }; }
}
function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// Merge saved settings from db into cfg on startup
function loadPersistedSettings() {
  const db = loadDB();
  if (db.settings && Object.keys(db.settings).length) {
    Object.assign(cfg, db.settings);
  }
}

function persistSettings() {
  const db = loadDB();
  db.settings = { ...cfg };
  saveDB(db);
}

// ─── Mailer (can be reinitialized after settings change) ──────────────────────
let mailer = null;
function initMailer() {
  if (cfg.smtpUser && cfg.smtpPass) {
    mailer = nodemailer.createTransport({
      host:   cfg.smtpHost,
      port:   cfg.smtpPort,
      secure: cfg.smtpPort === 465,
      auth:   { user: cfg.smtpUser, pass: cfg.smtpPass },
    });
    cfg.emailEnabled = true;
  } else {
    mailer = null;
    cfg.emailEnabled = false;
  }
}

async function sendEmail(subject, html) {
  if (!mailer) { console.log(`[EMAIL] Not configured — skipping: ${subject}`); return false; }
  try {
    await mailer.sendMail({ from: cfg.smtpFrom, to: cfg.alertEmail, subject, html });
    console.log(`[EMAIL] Sent: ${subject}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL] Failed: ${err.message}`);
    return false;
  }
}

function downEmailHtml(site, result) {
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
    <div style="background:#ef4444;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
      <h2 style="margin:0">🔴 Site Down Alert</h2></div>
    <div style="background:#1e293b;color:#e2e8f0;padding:24px;border-radius:0 0 8px 8px">
      <p><strong>${site.name}</strong> is currently <strong style="color:#ef4444">DOWN</strong></p>
      <p>URL: <a href="${site.url}" style="color:#3b82f6">${site.url}</a></p>
      <p>HTTP Status: ${result.statusCode ?? "No response / timeout"}</p>
      <p>Detected at: ${new Date().toUTCString()}</p>
      <hr style="border:1px solid #334155;margin:16px 0"/>
      <p style="color:#94a3b8;font-size:12px">Uptime Monitor · dynamite.agency</p>
    </div></div>`;
}

function recoveryEmailHtml(site, result) {
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
    <div style="background:#22c55e;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
      <h2 style="margin:0">✅ Site Recovery</h2></div>
    <div style="background:#1e293b;color:#e2e8f0;padding:24px;border-radius:0 0 8px 8px">
      <p><strong>${site.name}</strong> is back <strong style="color:#22c55e">ONLINE</strong></p>
      <p>URL: <a href="${site.url}" style="color:#3b82f6">${site.url}</a></p>
      <p>HTTP Status: ${result.statusCode}</p>
      <p>Recovered at: ${new Date().toUTCString()}</p>
      <hr style="border:1px solid #334155;margin:16px 0"/>
      <p style="color:#94a3b8;font-size:12px">Uptime Monitor · dynamite.agency</p>
    </div></div>`;
}

// ─── In-memory alert state per site ──────────────────────────────────────────
const siteState = {};
function getSiteState(id) {
  if (!siteState[id]) siteState[id] = { wasUp: null, lastAlertAt: 0, wentDownAt: null };
  return siteState[id];
}

// ─── Bot detection ────────────────────────────────────────────────────────────
const BOT_UA_PATTERNS = [
  /curl/i, /python-requests/i, /wget/i, /sqlmap/i, /nikto/i,
  /masscan/i, /nmap/i, /zgrab/i, /gobuster/i, /dirbuster/i,
  /nuclei/i, /burpsuite/i, /hydra/i, /metasploit/i,
  /(?<!google|bing|slack)bot\b/i, /crawler/i, /scraper/i,
];
const ipCounters = {};
const RATE_WINDOW = 10_000;
const RATE_LIMIT  = 40;

function botMiddleware(req, res, next) {
  const ua = req.headers["user-agent"] || "";
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
          || req.socket?.remoteAddress || "unknown";

  if (BOT_UA_PATTERNS.some((p) => p.test(ua))) {
    addLog("BOT", null, null, `Scanner/bot UA detected from ${ip}`, {
      ip, ua: ua.substring(0, 200), path: req.path, reason: "suspicious_ua",
    });
  }
  const now = Date.now();
  if (!ipCounters[ip] || now - ipCounters[ip].windowStart > RATE_WINDOW) {
    ipCounters[ip] = { count: 1, windowStart: now };
  } else {
    ipCounters[ip].count++;
    if (ipCounters[ip].count === RATE_LIMIT) {
      addLog("BOT", null, null, `Rate limit hit from ${ip}`, {
        ip, path: req.path, reqsPer10s: ipCounters[ip].count, reason: "rate_limit",
      });
    }
  }
  next();
}

// ─── Logging ──────────────────────────────────────────────────────────────────
function addLog(type, siteId, siteName, message, meta = {}) {
  const db = loadDB();
  if (!db.logs) db.logs = [];
  db.logs.push({ id: db._nextId++, type, siteId: siteId ?? null,
    siteName: siteName ?? null, message, meta, createdAt: Date.now() });
  if (db.logs.length > 5000) db.logs = db.logs.slice(-5000);
  saveDB(db);
  console.log(`[${type}] ${message}`);
}

// ─── Ping ─────────────────────────────────────────────────────────────────────
async function ping(url) {
  const start = Date.now();
  try {
    const res = await axios.get(url, {
      timeout: 10000, validateStatus: () => true, maxRedirects: 5,
      headers: { "User-Agent": "UptimeMonitorBot/1.0" },
    });
    return { up: res.status < 500, statusCode: res.status, responseMs: Date.now() - start };
  } catch (err) {
    return { up: false, statusCode: null, responseMs: null, error: err.message };
  }
}

function recordCheck(siteId, result) {
  const db = loadDB();
  db.checks.push({ id: db._nextId++, siteId, up: result.up,
    statusCode: result.statusCode, responseMs: result.responseMs, checkedAt: Date.now() });
  if (db.checks.length > 2000) db.checks = db.checks.slice(-2000);
  saveDB(db);
}

function enrichSite(site, db) {
  const now = Date.now();
  const siteChecks  = db.checks.filter((c) => c.siteId === site.id);
  const latest      = siteChecks[siteChecks.length - 1] || null;
  const checks24h   = siteChecks.filter((c) => c.checkedAt > now - 86400_000);
  const upChecks24h = checks24h.filter((c) => c.up && c.responseMs != null);

  const uptimePct = checks24h.length
    ? Math.round((checks24h.filter((c) => c.up).length / checks24h.length) * 100) : null;
  const avgResponseMs = upChecks24h.length
    ? Math.round(upChecks24h.reduce((a, c) => a + c.responseMs, 0) / upChecks24h.length) : null;

  return { ...site, latest, uptimePct, avgResponseMs, history: siteChecks.slice(-48).map((c) => c.up) };
}

// ─── Alert handler ────────────────────────────────────────────────────────────
async function handleAlerts(site, result) {
  const st  = getSiteState(site.id);
  const now = Date.now();
  if (st.wasUp === null) { st.wasUp = result.up; return; }

  if (st.wasUp && !result.up) {
    st.wasUp = false; st.wentDownAt = now; st.lastAlertAt = now;
    const msg = `${site.name} went DOWN — HTTP ${result.statusCode ?? "timeout"}`;
    addLog("DOWN", site.id, site.name, msg, { statusCode: result.statusCode, url: site.url });
    await sendEmail(`🔴 ALERT: ${site.name} is DOWN`, downEmailHtml(site, result));

  } else if (!st.wasUp && result.up) {
    const downDuration = st.wentDownAt ? now - st.wentDownAt : null;
    st.wasUp = true; st.wentDownAt = null;
    const msg = `${site.name} recovered — back ONLINE${downDuration ? ` after ${Math.round(downDuration/60000)}m` : ""}`;
    addLog("RECOVERY", site.id, site.name, msg, { statusCode: result.statusCode, url: site.url, downDurationMs: downDuration });
    await sendEmail(`✅ RECOVERY: ${site.name} is back UP`, recoveryEmailHtml(site, result));

  } else if (!result.up && (now - st.lastAlertAt) > cfg.emailCooldownMs) {
    st.lastAlertAt = now;
    addLog("DOWN", site.id, site.name, `${site.name} still DOWN (reminder)`, { statusCode: result.statusCode, url: site.url, reminder: true });
    await sendEmail(`🔴 REMINDER: ${site.name} is still DOWN`, downEmailHtml(site, result));
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(botMiddleware);

// ─── Site Routes ──────────────────────────────────────────────────────────────
app.get("/sites", (req, res) => {
  const db = loadDB();
  res.json(db.sites.map((s) => enrichSite(s, db)));
});

app.post("/sites", (req, res) => {
  const { name, url } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });
  const db = loadDB();
  if (db.sites.find((s) => s.url === url))
    return res.status(409).json({ error: "Site already exists" });
  const site = { id: db._nextId++, name: name || url, url, createdAt: Date.now() };
  db.sites.push(site); saveDB(db);
  addLog("INFO", site.id, site.name, `Site added: ${site.url}`);
  ping(url).then((result) => recordCheck(site.id, result));
  res.status(201).json(site);
});

app.delete("/sites/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const db = loadDB();
  const site = db.sites.find((s) => s.id === id);
  if (site) addLog("INFO", id, site.name, `Site removed: ${site.url}`);
  db.sites  = db.sites.filter((s) => s.id !== id);
  db.checks = db.checks.filter((c) => c.siteId !== id);
  saveDB(db); delete siteState[id]; res.json({ ok: true });
});

app.post("/sites/:id/check", async (req, res) => {
  const id = parseInt(req.params.id);
  const db = loadDB();
  const site = db.sites.find((s) => s.id === id);
  if (!site) return res.status(404).json({ error: "Not found" });
  const result = await ping(site.url);
  recordCheck(site.id, result); await handleAlerts(site, result); res.json(result);
});

app.post("/check-all", async (req, res) => {
  const db = loadDB();
  const results = await Promise.all(db.sites.map(async (site) => {
    const result = await ping(site.url);
    recordCheck(site.id, result); await handleAlerts(site, result);
    return { site: site.name, ...result };
  }));
  res.json(results);
});

app.get("/sites/:id/checks", (req, res) => {
  const id    = parseInt(req.params.id);
  const limit = parseInt(req.query.limit || "100");
  const db    = loadDB();
  res.json(db.checks.filter((c) => c.siteId === id).slice(-limit).reverse());
});

// ─── Log Routes ──────────────────────────────────────────────────────────────
app.get("/logs", (req, res) => {
  const db = loadDB();
  let logs = db.logs || [];
  const { type, siteId, limit = 200 } = req.query;
  if (type)   logs = logs.filter((l) => l.type === type);
  if (siteId) logs = logs.filter((l) => l.siteId === parseInt(siteId));
  res.json(logs.slice(-parseInt(limit)).reverse());
});

app.delete("/logs", (req, res) => {
  const db = loadDB(); db.logs = []; saveDB(db);
  addLog("INFO", null, null, "All logs cleared by admin");
  res.json({ ok: true });
});

// ─── Stats Route ──────────────────────────────────────────────────────────────
app.get("/stats", (req, res) => {
  const db  = loadDB();
  const now = Date.now();
  const checks24h   = db.checks.filter((c) => c.checkedAt > now - 86400_000);
  const upChecks24h = checks24h.filter((c) => c.up && c.responseMs != null);
  const avgResponseMs = upChecks24h.length
    ? Math.round(upChecks24h.reduce((a, c) => a + c.responseMs, 0) / upChecks24h.length) : null;
  const logs = db.logs || [];
  res.json({
    totalSites:      db.sites.length,
    totalChecks:     db.checks.length,
    avgResponseMs,
    totalIncidents:  logs.filter((l) => l.type === "DOWN" && !l.meta?.reminder).length,
    totalRecoveries: logs.filter((l) => l.type === "RECOVERY").length,
    totalBotAlerts:  logs.filter((l) => l.type === "BOT").length,
    emailEnabled:    cfg.emailEnabled,
    alertEmail:      cfg.alertEmail,
    checkIntervalMs: cfg.checkIntervalMs,
  });
});

// ─── Settings Routes ──────────────────────────────────────────────────────────
app.get("/settings", (req, res) => {
  res.json({
    smtpHost:        cfg.smtpHost,
    smtpPort:        cfg.smtpPort,
    smtpUser:        cfg.smtpUser,
    smtpPassSet:     !!cfg.smtpPass,   // never expose raw password
    smtpFrom:        cfg.smtpFrom,
    alertEmail:      cfg.alertEmail,
    emailCooldownMs: cfg.emailCooldownMs,
    checkIntervalMs: cfg.checkIntervalMs,
    emailEnabled:    cfg.emailEnabled,
  });
});

app.post("/settings", (req, res) => {
  const { smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom,
          alertEmail, emailCooldownMs, checkIntervalMs } = req.body;

  if (smtpHost        !== undefined) cfg.smtpHost        = smtpHost;
  if (smtpPort        !== undefined) cfg.smtpPort        = parseInt(smtpPort);
  if (smtpUser        !== undefined) cfg.smtpUser        = smtpUser;
  // Only update password if caller sends a real new value (not masked placeholder)
  if (smtpPass        !== undefined && smtpPass.trim() !== "" && !smtpPass.startsWith("•")) {
    cfg.smtpPass = smtpPass;
  }
  if (smtpFrom        !== undefined) cfg.smtpFrom        = smtpFrom;
  if (alertEmail      !== undefined) cfg.alertEmail      = alertEmail;
  if (emailCooldownMs !== undefined) cfg.emailCooldownMs = parseInt(emailCooldownMs);

  const intervalChanged = checkIntervalMs !== undefined &&
    parseInt(checkIntervalMs) !== cfg.checkIntervalMs;
  if (checkIntervalMs !== undefined) cfg.checkIntervalMs = parseInt(checkIntervalMs);

  initMailer();
  persistSettings();
  if (intervalChanged) startScheduler();

  addLog("INFO", null, null, "Settings updated via UI", {
    alertEmail: cfg.alertEmail,
    emailEnabled: cfg.emailEnabled,
    checkIntervalMs: cfg.checkIntervalMs,
  });

  res.json({ ok: true, emailEnabled: cfg.emailEnabled, checkIntervalMs: cfg.checkIntervalMs });
});

// POST /settings/test-email
app.post("/settings/test-email", async (req, res) => {
  if (!mailer) return res.status(400).json({ error: "Email not configured — set SMTP user & password first." });
  const ok = await sendEmail(
    "✅ Test — Uptime Monitor",
    `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#1e293b;color:#e2e8f0;padding:28px;border-radius:10px">
      <h2 style="margin:0 0 12px">✅ Test email successful</h2>
      <p>Your Uptime Monitor email notifications are configured and working.</p>
      <p style="color:#64748b;font-size:12px;margin-top:20px">dynamite.agency</p>
    </div>`
  );
  if (ok) res.json({ ok: true });
  else res.status(500).json({ error: "SMTP send failed — check your credentials." });
});

// ─── Scheduled checks ────────────────────────────────────────────────────────
async function runScheduledChecks() {
  const db = loadDB();
  if (!db.sites.length) return;
  console.log(`[${new Date().toISOString()}] Scheduled check — ${db.sites.length} site(s)`);
  await Promise.all(db.sites.map(async (site) => {
    const result = await ping(site.url);
    recordCheck(site.id, result);
    await handleAlerts(site, result);
    if (!result.up && result.error) {
      addLog("ERROR", site.id, site.name, `Ping error: ${result.error}`, { url: site.url });
    }
    console.log(`  ${result.up ? "UP  " : "DOWN"} ${site.url} (${result.responseMs ?? "—"}ms)`);
  }));
}

let checkInterval = null;
function startScheduler() {
  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(runScheduledChecks, cfg.checkIntervalMs);
  console.log(`[SCHEDULER] Check interval set to ${cfg.checkIntervalMs / 1000}s`);
}

// ─── Boot sequence ────────────────────────────────────────────────────────────
loadPersistedSettings();
initMailer();
startScheduler();
runScheduledChecks();

app.listen(PORT, () => {
  console.log(`\nUptime monitor backend → http://localhost:${PORT}`);
  console.log(`Email alerts : ${cfg.emailEnabled ? `ENABLED → ${cfg.alertEmail}` : "DISABLED (configure in Settings)"}`);
  console.log(`Check interval: ${cfg.checkIntervalMs / 1000}s\n`);
});
