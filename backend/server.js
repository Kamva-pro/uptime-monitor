const express    = require("express");
const axios      = require("axios");
const cors       = require("cors");
const fs         = require("fs");
const path       = require("path");
const nodemailer = require("nodemailer");
const jwt        = require("jsonwebtoken");
const bcrypt     = require("bcryptjs");

const app  = express();
const PORT = process.env.PORT || 4000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "db.json");
const JWT_SECRET = process.env.JWT_SECRET || "dynamite-super-secret-key-change-in-prod";

// ─── Global Config (Admin controlled) ────────────────────────────────────────
let cfg = {
  smtpHost:        process.env.SMTP_HOST        || "mail.dynamite.agency",
  smtpPort:        parseInt(process.env.SMTP_PORT || "587"),
  smtpUser:        process.env.SMTP_USER        || "",
  smtpPass:        process.env.SMTP_PASS        || "",
  smtpFrom:        process.env.SMTP_FROM        || "Uptime Monitor <alerts@dynamite.agency>",
  checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS || "60000"),
  emailEnabled:    false,
};

// ─── Database ─────────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
function loadDB() {
  try { 
    const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    if (!db.users) db.users = [];
    if (!db.sites) db.sites = [];
    if (!db.checks) db.checks = [];
    if (!db.logs) db.logs = [];
    if (!db.settings) db.settings = {};
    if (!db._nextId) db._nextId = 1;
    return db;
  }
  catch { return { users: [], sites: [], checks: [], logs: [], settings: {}, _nextId: 1 }; }
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

function loadPersistedSettings() {
  const db = loadDB();
  if (db.settings && Object.keys(db.settings).length) Object.assign(cfg, db.settings);
}
function persistSettings() {
  const db = loadDB();
  db.settings = { ...cfg };
  saveDB(db);
}

// ─── Mailer ───────────────────────────────────────────────────────────────────
let mailer = null;
function initMailer() {
  if (cfg.smtpUser && cfg.smtpPass) {
    mailer = nodemailer.createTransport({
      host:   cfg.smtpHost,
      port:   cfg.smtpPort,
      secure: cfg.smtpPort === 465,
      auth:   { user: cfg.smtpUser, pass: cfg.smtpPass },
      tls:    { rejectUnauthorized: false } // Fixed for Xneelo strict TLS issues
    });
    cfg.emailEnabled = true;
  } else {
    mailer = null;
    cfg.emailEnabled = false;
  }
}

async function sendEmail(to, subject, html) {
  if (!mailer) { console.log(`[EMAIL] Not configured — skipping: ${subject}`); return false; }
  if (!to) { console.log(`[EMAIL] No recipient configured — skipping: ${subject}`); return false; }
  try {
    await mailer.sendMail({ from: cfg.smtpFrom, to, subject, html });
    console.log(`[EMAIL] Sent to ${to}: ${subject}`);
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
    </div></div>`;
}

// ─── In-memory alert state per site ──────────────────────────────────────────
const siteState = {};
function getSiteState(id) {
  if (!siteState[id]) siteState[id] = { wasUp: null, lastAlertAt: 0, wentDownAt: null };
  return siteState[id];
}

// ─── Logging ──────────────────────────────────────────────────────────────────
function addLog(userId, type, siteId, siteName, message, meta = {}) {
  const db = loadDB();
  if (!db.logs) db.logs = [];
  db.logs.push({ id: db._nextId++, userId, type, siteId: siteId ?? null,
    siteName: siteName ?? null, message, meta, createdAt: Date.now() });
  if (db.logs.length > 10000) db.logs = db.logs.slice(-10000);
  saveDB(db);
  console.log(`[${type}] ${message}`);
}

// ─── Ping ─────────────────────────────────────────────────────────────────────
async function ping(url) {
  const start = Date.now();
  try {
    const res = await axios.get(url, {
      timeout: 10000, validateStatus: () => true, maxRedirects: 5,
      headers: { "User-Agent": "UptimeMonitorBot/2.0" },
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
  if (db.checks.length > 5000) db.checks = db.checks.slice(-5000);
  saveDB(db);
}

// ─── Alert handler ────────────────────────────────────────────────────────────
async function handleAlerts(site, user, result) {
  const st  = getSiteState(site.id);
  const now = Date.now();
  if (st.wasUp === null) { st.wasUp = result.up; return; }

  const alertEmail = user.alertEmail || user.email;
  const cooldownMs = user.emailCooldownMs || 1800000;

  if (st.wasUp && !result.up) {
    st.wasUp = false; st.wentDownAt = now; st.lastAlertAt = now;
    const msg = `${site.name} went DOWN — HTTP ${result.statusCode ?? "timeout"}`;
    addLog(user.id, "DOWN", site.id, site.name, msg, { statusCode: result.statusCode, url: site.url });
    await sendEmail(alertEmail, `🔴 ALERT: ${site.name} is DOWN`, downEmailHtml(site, result));

  } else if (!st.wasUp && result.up) {
    const downDuration = st.wentDownAt ? now - st.wentDownAt : null;
    st.wasUp = true; st.wentDownAt = null;
    const msg = `${site.name} recovered — back ONLINE${downDuration ? ` after ${Math.round(downDuration/60000)}m` : ""}`;
    addLog(user.id, "RECOVERY", site.id, site.name, msg, { statusCode: result.statusCode, url: site.url, downDurationMs: downDuration });
    await sendEmail(alertEmail, `✅ RECOVERY: ${site.name} is back UP`, recoveryEmailHtml(site, result));

  } else if (!result.up && (now - st.lastAlertAt) > cooldownMs) {
    st.lastAlertAt = now;
    addLog(user.id, "DOWN", site.id, site.name, `${site.name} still DOWN (reminder)`, { statusCode: result.statusCode, url: site.url, reminder: true });
    await sendEmail(alertEmail, `🔴 REMINDER: ${site.name} is still DOWN`, downEmailHtml(site, result));
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

const adminMiddleware = (req, res, next) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
};

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post("/auth/register", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  const db = loadDB();
  if (!db.users) db.users = [];
  if (db.users.find(u => u.email === email)) return res.status(400).json({ error: "Email already exists" });

  const role = db.users.length === 0 ? "admin" : "user";
  const user = {
    id: db._nextId++,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    alertEmail: email,
    emailCooldownMs: 1800000,
    createdAt: Date.now()
  };
  db.users.push(user);
  saveDB(db);

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

app.post("/auth/login", (req, res) => {
  const { email, password } = req.body;
  const db = loadDB();
  const user = (db.users || []).find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

app.get("/auth/me", authMiddleware, (req, res) => {
  res.json(req.user);
});

// ─── Protected Routes ─────────────────────────────────────────────────────────

app.get("/sites", authMiddleware, (req, res) => {
  const db = loadDB();
  const userSites = db.sites.filter(s => s.userId === req.user.id);
  
  const enriched = userSites.map((site) => {
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
  });
  res.json(enriched);
});

app.post("/sites", authMiddleware, (req, res) => {
  const { name, url } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });
  const db = loadDB();
  const site = { id: db._nextId++, userId: req.user.id, name: name || url, url, createdAt: Date.now() };
  db.sites.push(site); saveDB(db);
  addLog(req.user.id, "INFO", site.id, site.name, `Site added: ${site.url}`);
  ping(url).then((result) => recordCheck(site.id, result));
  res.status(201).json(site);
});

app.delete("/sites/:id", authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const db = loadDB();
  const site = db.sites.find((s) => s.id === id && s.userId === req.user.id);
  if (!site) return res.status(404).json({ error: "Site not found" });
  
  addLog(req.user.id, "INFO", id, site.name, `Site removed: ${site.url}`);
  db.sites  = db.sites.filter((s) => s.id !== id);
  db.checks = db.checks.filter((c) => c.siteId !== id);
  saveDB(db); delete siteState[id]; res.json({ ok: true });
});

app.post("/sites/:id/check", authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  const db = loadDB();
  const site = db.sites.find((s) => s.id === id && s.userId === req.user.id);
  if (!site) return res.status(404).json({ error: "Not found" });
  const user = db.users.find(u => u.id === req.user.id);
  
  const result = await ping(site.url);
  recordCheck(site.id, result); await handleAlerts(site, user, result); res.json(result);
});

app.post("/check-all", authMiddleware, async (req, res) => {
  const db = loadDB();
  const userSites = db.sites.filter(s => s.userId === req.user.id);
  const user = db.users.find(u => u.id === req.user.id);
  
  const results = await Promise.all(userSites.map(async (site) => {
    const result = await ping(site.url);
    recordCheck(site.id, result); await handleAlerts(site, user, result);
    return { site: site.name, ...result };
  }));
  res.json(results);
});

app.get("/sites/:id/checks", authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const limit = parseInt(req.query.limit || "100");
  const db = loadDB();
  const site = db.sites.find((s) => s.id === id && s.userId === req.user.id);
  if (!site) return res.status(404).json({ error: "Not found" });
  res.json(db.checks.filter((c) => c.siteId === id).slice(-limit).reverse());
});

app.get("/logs", authMiddleware, (req, res) => {
  const db = loadDB();
  let logs = (db.logs || []).filter(l => l.userId === req.user.id);
  const { type, siteId, limit = 200 } = req.query;
  if (type)   logs = logs.filter((l) => l.type === type);
  if (siteId) logs = logs.filter((l) => l.siteId === parseInt(siteId));
  res.json(logs.slice(-parseInt(limit)).reverse());
});

app.delete("/logs", authMiddleware, (req, res) => {
  const db = loadDB(); 
  db.logs = (db.logs || []).filter(l => l.userId !== req.user.id); 
  saveDB(db);
  addLog(req.user.id, "INFO", null, null, "All logs cleared by user");
  res.json({ ok: true });
});

app.get("/stats", authMiddleware, (req, res) => {
  const db  = loadDB();
  const userSites = db.sites.filter(s => s.userId === req.user.id);
  const siteIds = userSites.map(s => s.id);
  const now = Date.now();
  
  const checks24h   = db.checks.filter((c) => siteIds.includes(c.siteId) && c.checkedAt > now - 86400_000);
  const upChecks24h = checks24h.filter((c) => c.up && c.responseMs != null);
  const avgResponseMs = upChecks24h.length
    ? Math.round(upChecks24h.reduce((a, c) => a + c.responseMs, 0) / upChecks24h.length) : null;
  
  const logs = (db.logs || []).filter(l => l.userId === req.user.id);
  res.json({
    totalSites:      userSites.length,
    totalChecks:     db.checks.filter(c => siteIds.includes(c.siteId)).length,
    avgResponseMs,
    totalIncidents:  logs.filter((l) => l.type === "DOWN" && !l.meta?.reminder).length,
    totalRecoveries: logs.filter((l) => l.type === "RECOVERY").length,
    totalBotAlerts:  logs.filter((l) => l.type === "BOT").length,
    emailEnabled:    cfg.emailEnabled,
    isAdmin:         req.user.role === "admin"
  });
});

// ─── Settings Routes ──────────────────────────────────────────────────────────
app.get("/settings", authMiddleware, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  const data = {
    alertEmail:      user.alertEmail || user.email,
    emailCooldownMs: user.emailCooldownMs || 1800000,
  };
  // Only admin sees global SMTP config
  if (req.user.role === "admin") {
    Object.assign(data, {
      smtpHost:        cfg.smtpHost,
      smtpPort:        cfg.smtpPort,
      smtpUser:        cfg.smtpUser,
      smtpPassSet:     !!cfg.smtpPass,
      smtpFrom:        cfg.smtpFrom,
      checkIntervalMs: cfg.checkIntervalMs,
    });
  }
  res.json(data);
});

app.post("/settings", authMiddleware, (req, res) => {
  const { alertEmail, emailCooldownMs, smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, checkIntervalMs } = req.body;
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  
  if (alertEmail !== undefined) user.alertEmail = alertEmail;
  if (emailCooldownMs !== undefined) user.emailCooldownMs = parseInt(emailCooldownMs);
  saveDB(db);

  let intervalChanged = false;
  
  // Admin only updates
  if (req.user.role === "admin") {
    if (smtpHost !== undefined) cfg.smtpHost = smtpHost;
    if (smtpPort !== undefined) cfg.smtpPort = parseInt(smtpPort);
    if (smtpUser !== undefined) cfg.smtpUser = smtpUser;
    if (smtpPass !== undefined && smtpPass.trim() !== "" && !smtpPass.startsWith("•")) {
      cfg.smtpPass = smtpPass;
    }
    if (smtpFrom !== undefined) cfg.smtpFrom = smtpFrom;
    if (checkIntervalMs !== undefined) {
      intervalChanged = parseInt(checkIntervalMs) !== cfg.checkIntervalMs;
      cfg.checkIntervalMs = parseInt(checkIntervalMs);
    }
    initMailer();
    persistSettings();
    if (intervalChanged) startScheduler();
  }

  addLog(req.user.id, "INFO", null, null, "Settings updated via UI");
  res.json({ ok: true, emailEnabled: cfg.emailEnabled });
});

app.post("/settings/test-email", authMiddleware, async (req, res) => {
  if (!mailer) return res.status(400).json({ error: "Email not configured — admin must set SMTP user & password first." });
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  const targetEmail = user.alertEmail || user.email;
  
  const ok = await sendEmail(
    targetEmail,
    "✅ Test — Uptime Monitor",
    `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#1e293b;color:#e2e8f0;padding:28px;border-radius:10px">
      <h2 style="margin:0 0 12px">✅ Test email successful</h2>
      <p>Your Uptime Monitor email notifications are configured and working.</p>
      <p style="color:#64748b;font-size:12px;margin-top:20px">dynamite.agency</p>
    </div>`
  );
  if (ok) res.json({ ok: true, message: `Sent to ${targetEmail}` });
  else res.status(500).json({ error: "SMTP send failed — check credentials and logs." });
});

// ─── Scheduled checks ────────────────────────────────────────────────────────
async function runScheduledChecks() {
  const db = loadDB();
  if (!db.sites || !db.sites.length) return;
  console.log(`[${new Date().toISOString()}] Scheduled check — ${db.sites.length} site(s)`);
  
  await Promise.all(db.sites.map(async (site) => {
    const user = db.users.find(u => u.id === site.userId);
    if (!user) return; // Orphaned site
    
    const result = await ping(site.url);
    recordCheck(site.id, result);
    await handleAlerts(site, user, result);
    
    if (!result.up && result.error) {
      addLog(user.id, "ERROR", site.id, site.name, `Ping error: ${result.error}`, { url: site.url });
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
  console.log(`Email system : ${cfg.emailEnabled ? `ENABLED` : "DISABLED"}`);
  console.log(`Check interval: ${cfg.checkIntervalMs / 1000}s\n`);
});
