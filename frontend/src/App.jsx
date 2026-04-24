import { useState, useEffect } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const API = import.meta.env.PROD ? "/api" : "http://localhost:4000";

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

// ── Components ────────────────────────────────────────────────────────────────
function SiteCard({ site, onRemove, onRefresh }) {
  const up = site.latest?.up;
  const statusClass = up === true ? "up" : up === false ? "down" : "pending";
  const [checking, setChecking] = useState(false);

  async function checkNow() {
    setChecking(true);
    const token = localStorage.getItem("uptime_token");
    try {
      await fetch(`${API}/sites/${site.id}/check`, { method:"POST", headers: { "Authorization": `Bearer ${token}` } });
      onRefresh();
    } catch { toast.error("Check failed"); }
    finally { setChecking(false); }
  }

  return (
    <div className="site-card">
      <div className="card-header">
        <div>
          <h3 className="site-name">{site.name}</h3>
          <a href={site.url} target="_blank" rel="noreferrer" className="site-url">{site.url}</a>
        </div>
        <div className={`status-badge ${statusClass}`}>
          {up === true ? "UP" : up === false ? "DOWN" : "WAITING"}
        </div>
      </div>
      <div className="card-stats">
        <div className="stat-col"><div className="stat-label">Uptime (24h)</div><div className="stat-value">{site.uptimePct ?? "—"}%</div></div>
        <div className="stat-col"><div className="stat-label">Response (avg)</div><div className="stat-value">{site.avgResponseMs ? `${site.avgResponseMs}ms` : "—"}</div></div>
      </div>
      <div className="history-bar">
        {Array.from({ length: 48 }).map((_, i) => {
          const check = site.history && site.history[site.history.length - 48 + i];
          const cl = check === true ? "up" : check === false ? "down" : "empty";
          return <div key={i} className={`history-tick ${cl}`} />;
        })}
      </div>
      <div className="card-actions">
        <button className="btn btn-ghost" onClick={() => onRemove(site.id)}>Delete</button>
        <button className="btn btn-primary" onClick={checkNow} disabled={checking}>
          {checking ? <span className="spinner" /> : "Check Now"}
        </button>
      </div>
    </div>
  );
}

function AddSiteForm({ onAdd }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setAdding(true);
    const token = localStorage.getItem("uptime_token");
    try {
      const res = await fetch(`${API}/sites`, {
        method:"POST", headers:{"Content-Type":"application/json", "Authorization": `Bearer ${token}`},
        body: JSON.stringify({ url, name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add site");
      setUrl(""); setName("");
      toast.success("Site added");
      onAdd();
    } catch(err) { toast.error(err.message); }
    finally { setAdding(false); }
  }

  return (
    <form className="add-site-form" onSubmit={submit}>
      <input className="input" placeholder="https://example.com" value={url} onChange={(e)=>setUrl(e.target.value)} required type="url" />
      <input className="input" placeholder="Name (optional)" value={name} onChange={(e)=>setName(e.target.value)} />
      <button className="btn btn-primary" disabled={adding}>{adding ? <span className="spinner" /> : "Add Site"}</button>
    </form>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function DashboardTab({ sites, globalStats, loading, onRefresh }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name"); // name, uptime, response

  const filtered = sites
    .filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.url.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => {
      if (sort === "uptime") return (a.uptimePct ?? 0) - (b.uptimePct ?? 0);
      if (sort === "response") return (b.avgResponseMs ?? 0) - (a.avgResponseMs ?? 0);
      return a.name.localeCompare(b.name);
    });

  async function remove(id) {
    if (!confirm("Remove this site?")) return;
    const token = localStorage.getItem("uptime_token");
    await fetch(`${API}/sites/${id}`, { method:"DELETE", headers: { "Authorization": `Bearer ${token}` } });
    onRefresh();
  }

  return (
    <div>
      <div className="toolbar">
        <AddSiteForm onAdd={onRefresh} />
        <div className="controls">
          <input className="input" placeholder="Search sites..." value={search} onChange={(e)=>setSearch(e.target.value)} />
          <select className="input" value={sort} onChange={(e)=>setSort(e.target.value)}>
            <option value="name">Sort by Name</option>
            <option value="uptime">Sort by Uptime (Low first)</option>
            <option value="response">Sort by Response (Slow first)</option>
          </select>
        </div>
      </div>
      {loading ? (
        <div className="empty-state"><div className="emoji">⏳</div><p>Loading your sites…</p></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="emoji">🌐</div>
          <p>{sites.length ? "No sites match your search." : "You aren't monitoring any sites yet. Add one above!"}</p>
        </div>
      ) : (
        <div className="grid">
          {filtered.map(s => <SiteCard key={s.id} site={s} onRemove={remove} onRefresh={onRefresh} />)}
        </div>
      )}
    </div>
  );
}

function LogsTab({ sites }) {
  const [logs, setLogs] = useState([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");

  const fetchLogs = () => {
    const token = localStorage.getItem("uptime_token");
    const q = new URLSearchParams();
    if (typeFilter) q.append("type", typeFilter);
    if (siteFilter) q.append("siteId", siteFilter);
    fetch(`${API}/logs?${q}`, { headers: { "Authorization": `Bearer ${token}` } }).then(r=>r.json()).then(setLogs);
  };

  useEffect(fetchLogs, [typeFilter, siteFilter]);

  async function clearLogs() {
    if (!confirm("Clear all your logs?")) return;
    const token = localStorage.getItem("uptime_token");
    await fetch(`${API}/logs`, { method:"DELETE", headers: { "Authorization": `Bearer ${token}` } });
    fetchLogs();
  }

  function downloadCSV() {
    const header = "Time,Type,Site,Message\n";
    const rows = logs.map(l => `"${new Date(l.createdAt).toISOString()}","${l.type}","${l.siteName || ""}","${l.message}"`).join("\n");
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'uptime-logs.csv'; a.click();
  }

  return (
    <div>
      <div className="toolbar" style={{justifyContent: "space-between"}}>
        <div className="controls">
          <select className="input" value={typeFilter} onChange={(e)=>setTypeFilter(e.target.value)}>
            <option value="">All Events</option>
            <option value="DOWN">Down</option>
            <option value="RECOVERY">Recovery</option>
            <option value="BOT">Bot / Scanner</option>
            <option value="ERROR">Error</option>
            <option value="INFO">Info</option>
          </select>
          <select className="input" value={siteFilter} onChange={(e)=>setSiteFilter(e.target.value)}>
            <option value="">All Sites</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="controls">
          <button className="btn btn-ghost" onClick={downloadCSV}>⬇ CSV</button>
          <button className="btn btn-ghost" style={{color:"var(--red)"}} onClick={clearLogs}>🗑 Clear</button>
        </div>
      </div>
      <div className="logs-table-wrap">
        <table className="logs-table">
          <thead><tr><th>Time</th><th>Type</th><th>Site</th><th>Message</th></tr></thead>
          <tbody>
            {logs.length === 0 ? <tr><td colSpan="4" style={{textAlign:"center", padding:"2rem"}}>No logs found</td></tr> : null}
            {logs.map(l => (
              <tr key={l.id}>
                <td style={{whiteSpace:"nowrap", color:"var(--muted)"}}>{new Date(l.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</td>
                <td><span className={`badge ${l.type.toLowerCase()}`}>{l.type}</span></td>
                <td>{l.siteName || "—"}</td>
                <td style={{width:"100%"}}>{l.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IncidentsTab({ sites }) {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    const token = localStorage.getItem("uptime_token");
    fetch(`${API}/logs`, { headers: { "Authorization": `Bearer ${token}` } }).then(r=>r.json()).then(setLogs);
  }, []);

  const incidents = [];
  const downEvents = logs.filter(l => l.type === "DOWN" && !l.meta?.reminder).reverse();
  const upEvents   = logs.filter(l => l.type === "RECOVERY").reverse();

  downEvents.forEach(down => {
    const recovery = upEvents.find(up => up.siteId === down.siteId && up.createdAt > down.createdAt);
    incidents.push({
      id: down.id, siteName: down.siteName,
      downAt: down.createdAt, upAt: recovery ? recovery.createdAt : null,
      durationMs: recovery ? (recovery.createdAt - down.createdAt) : (Date.now() - down.createdAt),
      resolved: !!recovery
    });
  });
  incidents.sort((a,b) => b.downAt - a.downAt);

  return (
    <div>
      <h2 className="section-title">Incident History</h2>
      {incidents.length === 0 ? (
        <div className="empty-state"><div className="emoji">🎉</div><p>No incidents recorded! 100% uptime.</p></div>
      ) : (
        <div className="incident-list">
          {incidents.map(inc => (
            <div key={inc.id} className={`incident-card ${inc.resolved ? "resolved" : "ongoing"}`}>
              <div className="incident-icon">{inc.resolved ? "✅" : "🔴"}</div>
              <div className="incident-details">
                <div className="incident-title"><strong>{inc.siteName}</strong> {inc.resolved ? "outage resolved" : "is currently down"}</div>
                <div className="incident-time">{new Date(inc.downAt).toLocaleString()}</div>
              </div>
              <div className="incident-duration">{Math.round(inc.durationMs / 60000)} min</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsTab({ globalStats, onStatsRefresh }) {
  const MASKED = "••••••••";
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("uptime_token");
    fetch(`${API}/settings`, { headers: { "Authorization": `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setForm({
        alertEmail:      d.alertEmail      || "",
        emailCooldownMs: String(d.emailCooldownMs || 1800000),
        // Admin fields
        smtpHost:        d.smtpHost        || "",
        smtpPort:        String(d.smtpPort || 587),
        smtpUser:        d.smtpUser        || "",
        smtpPass:        d.smtpPassSet ? MASKED : "",
        smtpFrom:        d.smtpFrom        || "",
        checkIntervalMs: String(d.checkIntervalMs || 60000),
      }))
      .catch(() => toast("Could not load settings", "error"));
  }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const token = localStorage.getItem("uptime_token");
    try {
      const body = { ...form };
      if (body.smtpPass === MASKED) delete body.smtpPass;
      body.emailCooldownMs = parseInt(body.emailCooldownMs);
      if (globalStats?.isAdmin) {
        body.smtpPort = parseInt(body.smtpPort);
        body.checkIntervalMs = parseInt(body.checkIntervalMs);
      }

      const res = await fetch(`${API}/settings`, { 
        method:"POST", 
        headers:{"Content-Type":"application/json", "Authorization": `Bearer ${token}`}, 
        body: JSON.stringify(body) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast("Settings saved!", "success");
      onStatsRefresh();
    } catch (err) { toast(err.message, "error"); }
    finally { setSaving(false); }
  }

  async function testEmail() {
    setTesting(true);
    const token = localStorage.getItem("uptime_token");
    try {
      const res  = await fetch(`${API}/settings/test-email`, { method:"POST", headers: { "Authorization": `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test failed");
      toast(`Test email sent to ${form?.alertEmail}`, "success");
    } catch (err) { toast.error(err.message); }
    finally { setTesting(false); }
  }

  if (!form) return <div className="empty-state"><div className="emoji">⏳</div><p>Loading settings…</p></div>;

  return (
    <div>
      <h2 className="section-title">Settings</h2>
      <form onSubmit={save} id="settings-form">
        <div className="settings-grid">

          {/* Personal Notifications */}
          <div className="settings-card">
            <h3 className="settings-card-title">📧 Personal Alerts</h3>
            <div className={`email-status-banner ${globalStats?.emailEnabled ? "enabled" : "disabled"}`}>
              {globalStats?.emailEnabled ? "✅ Global email system is ENABLED" : "⚠ Global email system is DISABLED — ask admin to configure SMTP."}
            </div>
            <div className="field-group">
              <label className="field-label">Send alerts to</label>
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

          {/* Monitor settings */}
          <div className="settings-card">
            <h3 className="settings-card-title">⏱ Monitor Settings</h3>
            {globalStats?.isAdmin ? (
              <div className="field-group" style={{marginBottom: "1rem"}}>
                <label className="field-label">Global Check interval (Admin)</label>
                <select className="field-input field-select" value={form.checkIntervalMs}
                  onChange={(e) => set("checkIntervalMs", e.target.value)}>
                  <option value="30000">30 seconds</option>
                  <option value="60000">1 minute</option>
                  <option value="120000">2 minutes</option>
                  <option value="300000">5 minutes</option>
                  <option value="600000">10 minutes</option>
                </select>
              </div>
            ) : null}
            <div className="settings-row">
              <span className="settings-label">Your total checks</span>
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

          {/* Admin SMTP Credentials */}
          {globalStats?.isAdmin && (
            <div className="settings-card">
              <h3 className="settings-card-title">🔐 Global SMTP Setup (Admin)</h3>
              <div className="field-group">
                <label className="field-label">SMTP host</label>
                <input className="field-input" type="text" value={form.smtpHost}
                  onChange={(e) => set("smtpHost", e.target.value)} placeholder="mail.dynamite.agency" />
              </div>
              <div className="field-row">
                <div className="field-group" style={{flex:1}}>
                  <label className="field-label">Port</label>
                  <input className="field-input" type="number" value={form.smtpPort}
                    onChange={(e) => set("smtpPort", e.target.value)} placeholder="587" />
                </div>
              </div>
              <div className="field-group">
                <label className="field-label">SMTP username / email</label>
                <input className="field-input" type="text" value={form.smtpUser}
                  onChange={(e) => set("smtpUser", e.target.value)} placeholder="alerts@dynamite.agency" />
              </div>
              <div className="field-group">
                <label className="field-label">SMTP password</label>
                <div className="pass-wrap">
                  <input className="field-input" type={showPass ? "text" : "password"}
                    value={form.smtpPass}
                    onChange={(e) => set("smtpPass", e.target.value)}
                    onFocus={() => { if (form.smtpPass === MASKED) set("smtpPass", ""); }}
                    placeholder="Enter password to update" />
                  <button type="button" className="pass-toggle" onClick={() => setShowPass((v) => !v)}>
                    {showPass ? "🙈" : "👁"}
                  </button>
                </div>
              </div>
              <div className="field-group">
                <label className="field-label">From address</label>
                <input className="field-input" type="text" value={form.smtpFrom}
                  onChange={(e) => set("smtpFrom", e.target.value)} placeholder="Uptime Monitor <alerts@dynamite.agency>" />
              </div>
            </div>
          )}

        </div>

        {/* Action bar */}
        <div className="settings-actions">
          <button type="button" className="btn btn-ghost" onClick={testEmail} disabled={testing || !globalStats?.emailEnabled}>
            {testing ? <span className="spinner" /> : "📨"} Send test email
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <span className="spinner" /> : "💾"} Save settings
          </button>
        </div>
      </form>
    </div>
  );
}

// ── App Container ─────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [sites, setSites] = useState([]);
  const [globalStats, setGlobalStats] = useState(null);
  const [tab, setTab] = useState("dashboard"); // dashboard, logs, incidents, settings
  const [loadingSites, setLoadingSites] = useState(true);

  // Check existing token
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

  const fetchSites = () => {
    if (!user) return;
    const token = localStorage.getItem("uptime_token");
    fetch(`${API}/sites`, { headers: { "Authorization": `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setSites(d); setLoadingSites(false); });

    fetch(`${API}/stats`, { headers: { "Authorization": `Bearer ${token}` } })
      .then(r => r.json())
      .then(setGlobalStats);
  };

  useEffect(fetchSites, [user]);

  function logout() {
    localStorage.removeItem("uptime_token");
    setUser(null);
  }

  if (loadingAuth) return <div className="empty-state"><div className="emoji">⏳</div></div>;
  if (!user) return <div><ToastContainer theme="dark" /><AuthScreen onLogin={setUser} /></div>;

  const allUp = sites.every(s => s.latest?.up !== false);

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1 className="logo">
            <div className={`status-dot ${allUp ? "up" : "down"}`} />
            Uptime Monitor
          </h1>
          <div className="system-status">
            {allUp ? "All systems operational" : "Some systems are down"}
            <span style={{margin: "0 8px"}}>·</span>
            {user.email} {user.role === 'admin' ? "(Admin)" : ""}
          </div>
        </div>
        <div style={{display: "flex", gap: "1rem", alignItems: "center"}}>
          <nav className="tabs">
            <button className={`tab ${tab==="dashboard"?"active":""}`} onClick={()=>setTab("dashboard")}>Dashboard</button>
            <button className={`tab ${tab==="logs"?"active":""}`} onClick={()=>setTab("logs")}>Logs</button>
            <button className={`tab ${tab==="incidents"?"active":""}`} onClick={()=>setTab("incidents")}>Incidents</button>
            <button className={`tab ${tab==="settings"?"active":""}`} onClick={()=>setTab("settings")}>Settings</button>
          </nav>
          <button className="btn btn-ghost" onClick={logout}>Logout</button>
        </div>
      </header>

      <main className="main-content">
        {tab === "dashboard" && <DashboardTab sites={sites} globalStats={globalStats} loading={loadingSites} onRefresh={fetchSites} />}
        {tab === "logs"      && <LogsTab sites={sites} />}
        {tab === "incidents" && <IncidentsTab sites={sites} />}
        {tab === "settings"  && <SettingsTab globalStats={globalStats} onStatsRefresh={fetchSites} />}
      </main>

      <ToastContainer theme="dark" position="bottom-right" />
    </div>
  );
}
