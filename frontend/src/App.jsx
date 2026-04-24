import { useState, useEffect, useCallback, useRef } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const API = import.meta.env.PROD ? "/api" : "http://localhost:4000";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtMs(ms) {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
function uptimeColor(pct) {
  if (pct == null) return "muted";
  if (pct >= 99) return "green";
  if (pct >= 95) return "yellow";
  return "red";
}
function siteStatus(site) {
  if (!site.latest) return "unknown";
  return site.latest.up ? "up" : "down";
}
function timeAgo(ts) {
  if (!ts) return "—";
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}
function exportLogsCSV(logs) {
  const rows = [["ID","Type","Site","Message","Time"],
    ...logs.map((l) => [l.id, l.type, l.siteName||"", `"${(l.message||"").replace(/"/g,"'")}"`, new Date(l.createdAt).toISOString()])];
  const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `logs-${Date.now()}.csv` });
  a.click();
}

function getAuthHeaders() {
  const token = localStorage.getItem("uptime_token");
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

// ── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    const endpoint = isLogin ? "/auth/login" : "/auth/register";
    try {
      const res = await fetch(`${API}${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");
      localStorage.setItem("uptime_token", data.token);
      onLogin(data.user);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="status-dot up" style={{marginRight: "8px"}} />
          Uptime Monitor
        </div>
        <h2 className="auth-title">{isLogin ? "Welcome back" : "Create an account"}</h2>
        <form onSubmit={submit}>
          <div className="field-group">
            <label className="field-label">Email</label>
            <input type="email" required className="field-input" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label">Password</label>
            <input type="password" required className="field-input" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" style={{width: "100%", marginTop: "1rem"}} disabled={loading}>
            {loading ? <span className="spinner" /> : (isLogin ? "Sign In" : "Register")}
          </button>
        </form>
        <div className="auth-toggle">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button type="button" className="btn-link" onClick={() => setIsLogin(!isLogin)}>
            {isLogin ? "Sign up" : "Log in"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── History Bar ───────────────────────────────────────────────────────────────
function HistoryBar({ history }) {
  const n = 30;
  const padded = [...Array(Math.max(0, n - history.length)).fill(null), ...history.slice(-n)];
  return (
    <div className="history-bar" title="Last 30 checks">
      {padded.map((v, i) => <div key={i} className={`history-tick ${v === null ? "unknown" : v ? "up" : "down"}`} />)}
    </div>
  );
}

// ── Add Site Form ─────────────────────────────────────────────────────────────
function AddSiteForm({ onAdd }) {
  const [name, setName] = useState("");
  const [url, setUrl]   = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!url.trim()) { toast.error("URL is required"); return; }
    let u = url.trim();
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    setBusy(true);
    try {
      const res  = await fetch(`${API}/sites`, { 
        method:"POST", 
        headers:{"Content-Type":"application/json", ...getAuthHeaders()}, 
        body: JSON.stringify({ name: name.trim()||u, url: u }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(`Added ${data.name}`);
      onAdd(); setName(""); setUrl("");
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  }

  return (
    <form className="add-form" onSubmit={submit} id="add-site-form">
      <div className="form-group">
        <label htmlFor="site-name">Display name</label>
        <input id="site-name" type="text" placeholder="My Website" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="form-group">
        <label htmlFor="site-url">URL *</label>
        <input id="site-url" type="text" placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} required />
      </div>
      <button className="btn btn-primary" type="submit" disabled={busy} id="add-site-submit">
        {busy ? <span className="spinner" /> : "+ Add"}
      </button>
    </form>
  );
}

// ── Site Card ─────────────────────────────────────────────────────────────────
function SiteCard({ site, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const status = siteStatus(site);

  async function checkNow() {
    setBusy(true);
    try {
      const res  = await fetch(`${API}/sites/${site.id}/check`, { method:"POST", headers: getAuthHeaders() });
      const data = await res.json();
      if (data.up) toast.success(`${site.name}: UP (${fmtMs(data.responseMs)})`);
      else toast.error(`${site.name}: DOWN`);
      onRefresh();
    } catch { toast.error("Check failed"); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm(`Remove "${site.name}"?`)) return;
    try {
      await fetch(`${API}/sites/${site.id}`, { method:"DELETE", headers: getAuthHeaders() });
      toast.info(`Removed ${site.name}`); onRefresh();
    } catch { toast.error("Delete failed"); }
  }

  return (
    <div className={`site-card ${status}`} id={`site-card-${site.id}`}>
      <div className={`status-dot ${status}`} />
      <div className="site-info">
        <div className="site-name">{site.name}</div>
        <div className="site-url">
          <a href={site.url} target="_blank" rel="noopener noreferrer">{site.url}</a>
        </div>
        <div className="site-last">{timeAgo(site.latest?.checkedAt)}</div>
      </div>
      <HistoryBar history={site.history || []} />
      <div className="site-meta">
        <div className="meta-item">
          <span className="meta-label">Status</span>
          <span className={`badge ${status}`}>{status === "unknown" ? "—" : status.toUpperCase()}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Response</span>
          <span className={`meta-value ${site.latest?.up ? "green" : "red"}`}>{fmtMs(site.latest?.responseMs)}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Avg (24h)</span>
          <span className="meta-value muted">{fmtMs(site.avgResponseMs)}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Uptime</span>
          <span className={`meta-value ${uptimeColor(site.uptimePct)}`}>{site.uptimePct != null ? `${site.uptimePct}%` : "—"}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">HTTP</span>
          <span className="meta-value muted">{site.latest?.statusCode ?? "—"}</span>
        </div>
      </div>
      <div className="site-actions">
        <button className="icon-btn" title="Check now" id={`check-btn-${site.id}`} onClick={checkNow} disabled={busy}>
          {busy ? <span className="spinner" /> : "↺"}
        </button>
        <button className="icon-btn del" title="Remove" id={`delete-btn-${site.id}`} onClick={remove}>✕</button>
      </div>
    </div>
  );
}

// ── Stats Row ─────────────────────────────────────────────────────────────────
function StatsRow({ sites, globalStats }) {
  const up   = sites.filter((s) => siteStatus(s) === "up").length;
  const down = sites.filter((s) => siteStatus(s) === "down").length;
  const avg  = sites.filter((s) => s.uptimePct != null);
  const avgPct = avg.length ? Math.round(avg.reduce((a, s) => a + s.uptimePct, 0) / avg.length) : null;

  return (
    <div className="stats-row">
      <div className="stat-card"><span className="stat-label">Total Sites</span><span className="stat-value blue">{sites.length}</span></div>
      <div className="stat-card"><span className="stat-label">Online</span><span className="stat-value green">{up}</span></div>
      <div className="stat-card"><span className="stat-label">Down</span><span className="stat-value red">{down}</span></div>
      <div className="stat-card"><span className="stat-label">Avg Uptime</span><span className={`stat-value ${uptimeColor(avgPct)}`}>{avgPct != null ? `${avgPct}%` : "—"}</span></div>
      <div className="stat-card"><span className="stat-label">Avg Response</span><span className="stat-value blue">{fmtMs(globalStats?.avgResponseMs)}</span></div>
      <div className="stat-card"><span className="stat-label">Incidents</span><span className="stat-value yellow">{globalStats?.totalIncidents ?? "—"}</span></div>
    </div>
  );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────
function DashboardTab({ sites, globalStats, loading, onRefresh }) {
  const [showForm, setShowForm] = useState(false);
  const [search,   setSearch]   = useState("");
  const [sort,     setSort]     = useState("name");
  const [checkAll, setCheckAll] = useState(false);

  async function handleCheckAll() {
    setCheckAll(true);
    try {
      await fetch(`${API}/check-all`, { method:"POST", headers: getAuthHeaders() });
      toast.success("All sites checked!");
      onRefresh();
    } catch { toast.error("Check-all failed"); }
    finally { setCheckAll(false); }
  }

  const filtered = sites
    .filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.url.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === "status") return siteStatus(a).localeCompare(siteStatus(b));
      if (sort === "uptime") return (b.uptimePct ?? -1) - (a.uptimePct ?? -1);
      if (sort === "response") return (a.latest?.responseMs ?? 9999) - (b.latest?.responseMs ?? 9999);
      return a.name.localeCompare(b.name);
    });

  return (
    <div>
      <StatsRow sites={sites} globalStats={globalStats} />
      <div className="toolbar">
        <div className="toolbar-left">
          <input className="search-input" placeholder="Search sites..." value={search} onChange={(e) => setSearch(e.target.value)} id="site-search" />
          <select className="select-input" value={sort} onChange={(e) => setSort(e.target.value)} id="site-sort">
            <option value="name">Sort: Name</option>
            <option value="status">Sort: Status</option>
            <option value="uptime">Sort: Uptime</option>
            <option value="response">Sort: Response</option>
          </select>
        </div>
        <div style={{display:"flex",gap:".6rem"}}>
          <button id="check-all-btn" className="btn btn-ghost" onClick={handleCheckAll} disabled={checkAll || sites.length === 0}>
            {checkAll ? <span className="spinner" /> : "↺ Check all"}
          </button>
          <button id="add-site-btn" className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "✕ Cancel" : "+ Add site"}
          </button>
        </div>
      </div>

      {showForm && <AddSiteForm onAdd={() => { onRefresh(); setShowForm(false); }} />}

      <h2 className="section-title">Monitored sites ({filtered.length})</h2>

      {loading ? (
        <div className="empty-state"><p>Loading...</p></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><p>{sites.length === 0 ? "No sites yet. Click + Add site." : "No sites match your search."}</p></div>
      ) : (
        <div className="sites-list">
          {filtered.map((s) => <SiteCard key={s.id} site={s} onRefresh={onRefresh} />)}
        </div>
      )}
    </div>
  );
}

// ── Log type badge colours ────────────────────────────────────────────────────
const LOG_COLORS = { DOWN:"red", RECOVERY:"green", BOT:"purple", ERROR:"orange", INFO:"blue", CHECK:"muted" };

function LogBadge({ type }) {
  return <span className={`log-badge log-${(LOG_COLORS[type]||"muted")}`}>{type}</span>;
}

// ── Logs Tab ──────────────────────────────────────────────────────────────────
function LogsTab({ sites }) {
  const [logs,     setLogs]   = useState([]);
  const [loading,  setLoad]   = useState(true);
  const [typeF,    setTypeF]  = useState("");
  const [siteF,    setSiteF]  = useState("");

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: 500 });
      if (typeF) params.set("type", typeF);
      if (siteF) params.set("siteId", siteF);
      const res  = await fetch(`${API}/logs?${params}`, { headers: getAuthHeaders() });
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } catch { toast.error("Failed to load logs"); }
    finally { setLoad(false); }
  }, [typeF, siteF]);

  useEffect(() => { fetchLogs(); const t = setInterval(fetchLogs, 15_000); return () => clearInterval(t); }, [fetchLogs]);

  async function clearAll() {
    if (!confirm("Clear all logs? This cannot be undone.")) return;
    await fetch(`${API}/logs`, { method:"DELETE", headers: getAuthHeaders() });
    toast.info("Logs cleared");
    fetchLogs();
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <select className="select-input" value={typeF} onChange={(e) => setTypeF(e.target.value)} id="log-type-filter">
            <option value="">All types</option>
            {["DOWN","RECOVERY","BOT","ERROR","INFO","CHECK"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="select-input" value={siteF} onChange={(e) => setSiteF(e.target.value)} id="log-site-filter">
            <option value="">All sites</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{display:"flex",gap:".6rem"}}>
          <button className="btn btn-ghost" onClick={() => exportLogsCSV(logs)} id="export-logs-btn">Download CSV</button>
          <button className="btn btn-danger" onClick={clearAll} id="clear-logs-btn">Clear logs</button>
          <button className="btn btn-ghost" onClick={fetchLogs} id="refresh-logs-btn">Refresh</button>
        </div>
      </div>

      {loading ? (
        <div className="empty-state"><p>Loading logs...</p></div>
      ) : logs.length === 0 ? (
        <div className="empty-state"><p>No logs found.</p></div>
      ) : (
        <div className="log-table-wrap">
          <table className="log-table">
            <thead><tr><th>Type</th><th>Site</th><th>Message</th><th>Time</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className={`log-row log-row-${LOG_COLORS[l.type]||"muted"}`}>
                  <td><LogBadge type={l.type} /></td>
                  <td className="log-site">{l.siteName || <span className="muted">—</span>}</td>
                  <td className="log-msg">{l.message}</td>
                  <td className="log-time" title={fmtDate(l.createdAt)}>{timeAgo(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Incidents Tab ─────────────────────────────────────────────────────────────
function IncidentsTab({ sites }) {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    fetch(`${API}/logs?limit=2000`, { headers: getAuthHeaders() })
      .then((r) => r.json())
      .then((data) => setLogs(Array.isArray(data) ? data : []));
  }, []);

  // Build incident list: pair DOWN with next RECOVERY for same site
  const incidents = [];
  const downMap = {}; // siteId → log
  [...logs].reverse().forEach((l) => {
    if (l.type === "DOWN" && !l.meta?.reminder) {
      downMap[l.siteId] = l;
    } else if (l.type === "RECOVERY" && downMap[l.siteId]) {
      const d = downMap[l.siteId];
      incidents.push({ id: d.id, siteName: d.siteName, siteId: d.siteId, wentDown: d.createdAt, recovered: l.createdAt, duration: l.createdAt - d.createdAt });
      delete downMap[l.siteId];
    }
  });
  // Still-down sites (no recovery yet)
  Object.values(downMap).forEach((d) => {
    incidents.push({ id: d.id, siteName: d.siteName, siteId: d.siteId, wentDown: d.createdAt, recovered: null, duration: Date.now() - d.createdAt });
  });
  incidents.sort((a, b) => b.wentDown - a.wentDown);

  function fmtDur(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
  }

  return (
    <div>
      <h2 className="section-title">Incident History ({incidents.length})</h2>
      {incidents.length === 0 ? (
        <div className="empty-state"><p>No incidents recorded. 100% uptime!</p></div>
      ) : (
        <div className="incident-list">
          {incidents.map((inc) => (
            <div key={inc.id} className={`incident-card ${inc.recovered ? "resolved" : "ongoing"}`}>
              <div className="incident-status">
                <span className={`badge ${inc.recovered ? "up" : "down"}`}>{inc.recovered ? "RESOLVED" : "ONGOING"}</span>
              </div>
              <div className="incident-info">
                <div className="incident-site">{inc.siteName || `Site #${inc.siteId}`}</div>
                <div className="incident-times">
                  <span>Start: {fmtDate(inc.wentDown)}</span>
                  {inc.recovered && <span style={{marginLeft: "1rem"}}>End: {fmtDate(inc.recovered)}</span>}
                </div>
              </div>
              <div className="incident-duration">
                <span className="meta-label">Duration</span>
                <span className={`meta-value ${inc.recovered ? "muted" : "red"}`}>{fmtDur(inc.duration)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────────────────
function SettingsTab({ globalStats, onStatsRefresh }) {
  const MASKED = "••••••••";
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch(`${API}/settings`, { headers: getAuthHeaders() })
      .then((r) => r.json())
      .then((d) => setForm({
        smtpHost:        d.smtpHost        || "",
        smtpPort:        String(d.smtpPort || 587),
        smtpUser:        d.smtpUser        || "",
        smtpPass:        d.smtpPassSet ? MASKED : "",
        smtpFrom:        d.smtpFrom        || "",
        alertEmail:      d.alertEmail      || "",
        emailCooldownMs: String(d.emailCooldownMs || 1800000),
        checkIntervalMs: String(d.checkIntervalMs || 60000),
      }))
      .catch(() => toast.error("Could not load settings"));
  }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...form };
      if (body.smtpPass === MASKED) delete body.smtpPass;
      body.smtpPort        = parseInt(body.smtpPort);
      body.emailCooldownMs = parseInt(body.emailCooldownMs);
      body.checkIntervalMs = parseInt(body.checkIntervalMs);

      const res  = await fetch(`${API}/settings`, { 
        method:"POST", 
        headers:{"Content-Type":"application/json", ...getAuthHeaders()}, 
        body: JSON.stringify(body) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success("Settings saved!");
      onStatsRefresh();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  async function testEmail() {
    setTesting(true);
    try {
      const res  = await fetch(`${API}/settings/test-email`, { method:"POST", headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test failed");
      toast.success(`Test email sent to ${form?.alertEmail}`);
    } catch (err) { toast.error(err.message); }
    finally { setTesting(false); }
  }

  if (!form) return <div className="empty-state"><p>Loading settings...</p></div>;

  return (
    <div>
      <h2 className="section-title">Settings</h2>
      <form onSubmit={save} id="settings-form">
        <div className="settings-grid">

          {/* Email Notifications */}
          <div className="settings-card">
            <h3 className="settings-card-title">Personal Alerts</h3>
            <div className={`email-status-banner ${globalStats?.emailEnabled ? "enabled" : "disabled"}`}>
              {globalStats?.emailEnabled ? "Global email system is ENABLED" : "Global email system is DISABLED - Ask admin to configure SMTP"}
            </div>
            <div className="field-group">
              <label className="field-label">Alert recipient</label>
              <input id="alert-email" className="field-input" type="email" value={form.alertEmail}
                onChange={(e) => set("alertEmail", e.target.value)} placeholder="kamva@dynamite.agency" />
            </div>
            <div className="field-group">
              <label className="field-label">Reminder cooldown (ms)</label>
              <select id="email-cooldown" className="field-input field-select" value={form.emailCooldownMs}
                onChange={(e) => set("emailCooldownMs", e.target.value)}>
                <option value="900000">15 minutes</option>
                <option value="1800000">30 minutes</option>
                <option value="3600000">1 hour</option>
                <option value="7200000">2 hours</option>
                <option value="86400000">24 hours</option>
              </select>
            </div>
          </div>

          {/* SMTP Credentials */}
          {globalStats?.isAdmin && (
            <div className="settings-card">
              <h3 className="settings-card-title">SMTP Credentials (Admin)</h3>
              <div className="field-group">
                <label className="field-label">SMTP host</label>
                <input id="smtp-host" className="field-input" type="text" value={form.smtpHost}
                  onChange={(e) => set("smtpHost", e.target.value)} placeholder="mail.dynamite.agency" />
              </div>
              <div className="field-row">
                <div className="field-group" style={{flex:1}}>
                  <label className="field-label">Port</label>
                  <input id="smtp-port" className="field-input" type="number" value={form.smtpPort}
                    onChange={(e) => set("smtpPort", e.target.value)} placeholder="587" />
                </div>
              </div>
              <div className="field-group">
                <label className="field-label">SMTP username / email</label>
                <input id="smtp-user" className="field-input" type="text" value={form.smtpUser}
                  onChange={(e) => set("smtpUser", e.target.value)} placeholder="alerts@dynamite.agency" />
              </div>
              <div className="field-group">
                <label className="field-label">SMTP password</label>
                <input id="smtp-pass" className="field-input" type="password"
                  value={form.smtpPass}
                  onChange={(e) => set("smtpPass", e.target.value)}
                  onFocus={() => { if (form.smtpPass === MASKED) set("smtpPass", ""); }}
                  placeholder="Enter password to update" />
              </div>
              <div className="field-group">
                <label className="field-label">From address</label>
                <input id="smtp-from" className="field-input" type="text" value={form.smtpFrom}
                  onChange={(e) => set("smtpFrom", e.target.value)} placeholder="Uptime Monitor <alerts@dynamite.agency>" />
              </div>
            </div>
          )}

          {/* Monitor settings */}
          <div className="settings-card">
            <h3 className="settings-card-title">Monitor Stats</h3>
            {globalStats?.isAdmin && (
              <div className="field-group" style={{marginBottom: "1rem"}}>
                <label className="field-label">Check interval (Admin)</label>
                <select id="check-interval" className="field-input field-select" value={form.checkIntervalMs}
                  onChange={(e) => set("checkIntervalMs", e.target.value)}>
                  <option value="30000">30 seconds</option>
                  <option value="60000">1 minute</option>
                  <option value="120000">2 minutes</option>
                  <option value="300000">5 minutes</option>
                  <option value="600000">10 minutes</option>
                  <option value="1800000">30 minutes</option>
                </select>
              </div>
            )}
            <div className="settings-row" style={{marginTop:"1rem"}}>
              <span className="settings-label">Your total checks run</span>
              <span className="settings-value">{globalStats?.totalChecks?.toLocaleString() ?? "—"}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Your bot alerts</span>
              <span className="settings-value">{globalStats?.totalBotAlerts ?? "—"}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Your total incidents</span>
              <span className="settings-value">{globalStats?.totalIncidents ?? "—"}</span>
            </div>
          </div>
        </div>

        {/* Action bar */}
        <div className="settings-actions">
          <button type="button" id="test-email-btn" className="btn btn-ghost" onClick={testEmail} disabled={testing || !globalStats?.emailEnabled}>
            {testing ? <span className="spinner" /> : "Send test email"}
          </button>
          <button type="submit" id="save-settings-btn" className="btn btn-primary" disabled={saving}>
            {saving ? <span className="spinner" /> : "Save settings"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [tab,         setTab]   = useState("dashboard");
  const [sites,       setSites] = useState([]);
  const [globalStats, setStats] = useState(null);
  const [loading,     setLoad]  = useState(true);
  const intervalRef = useRef(null);

  // Check auth
  useEffect(() => {
    const token = localStorage.getItem("uptime_token");
    if (token) {
      fetch(`${API}/auth/me`, { headers: { "Authorization": `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) setUser(data);
          else localStorage.removeItem("uptime_token");
        })
        .finally(() => setLoadingAuth(false));
    } else {
      setLoadingAuth(false);
    }
  }, []);

  const fetchSites = useCallback(async () => {
    if (!user) return;
    try {
      const token = localStorage.getItem("uptime_token");
      const [sRes, stRes] = await Promise.all([
        fetch(`${API}/sites`, { headers: { "Authorization": `Bearer ${token}` } }),
        fetch(`${API}/stats`, { headers: { "Authorization": `Bearer ${token}` } })
      ]);
      const [sData, stData] = await Promise.all([sRes.json(), stRes.json()]);
      setSites(Array.isArray(sData) ? sData : []);
      setStats(stData);
    } catch { /* silent */ }
    finally { setLoad(false); }
  }, [user]);

  useEffect(() => {
    fetchSites();
    intervalRef.current = setInterval(fetchSites, 30_000);
    return () => clearInterval(intervalRef.current);
  }, [fetchSites]);

  function logout() {
    localStorage.removeItem("uptime_token");
    setUser(null);
  }

  if (loadingAuth) return <div className="empty-state"><p>Loading...</p></div>;
  if (!user) return <div><ToastContainer theme="dark" /><AuthScreen onLogin={setUser} /></div>;

  const allDown = sites.filter((s) => siteStatus(s) === "down").length;

  const TABS = [
    { id:"dashboard", label:"Dashboard" },
    { id:"logs",      label:"Logs" },
    { id:"incidents", label:`Incidents${globalStats?.totalIncidents ? ` (${globalStats.totalIncidents})` : ""}` },
    { id:"settings",  label:"Settings" },
  ];

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className={`logo-dot ${allDown > 0 ? "red" : "green"}`} />
          <div>
            <h1>Uptime Monitor</h1>
            <div className="header-subtitle">
              {allDown > 0 ? `⚠ ${allDown} site${allDown > 1 ? "s" : ""} down` : "All systems operational"} · auto-refresh 30s
            </div>
          </div>
        </div>
        <div style={{display: "flex", gap: "1rem", alignItems: "center"}}>
          <nav className="tab-nav" role="navigation">
            {TABS.map((t) => (
              <button key={t.id} id={`tab-${t.id}`} className={`tab-btn ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <button className="btn btn-ghost" onClick={logout} style={{padding: "0.4rem 0.8rem", fontSize: "0.8rem"}}>Logout</button>
        </div>
      </header>

      <main>
        {tab === "dashboard" && <DashboardTab sites={sites} globalStats={globalStats} loading={loading} onRefresh={fetchSites} />}
        {tab === "logs"      && <LogsTab sites={sites} />}
        {tab === "incidents" && <IncidentsTab sites={sites} />}
        {tab === "settings"  && <SettingsTab globalStats={globalStats} onStatsRefresh={fetchSites} />}
      </main>

      <ToastContainer theme="dark" position="bottom-right" />
    </div>
  );
}
