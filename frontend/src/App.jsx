import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "/api";

// ── helpers ──────────────────────────────────────────────────────────────────
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

// ── Toast context (simple) ────────────────────────────────────────────────────
let _addToast = () => {};
function toast(msg, type = "info") { _addToast(msg, type); }

function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  _addToast = (msg, type) => {
    const id = Date.now();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  };
  const icons = { success: "✅", error: "❌", info: "ℹ️" };
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          {icons[t.type]} {t.msg}
        </div>
      ))}
    </div>
  );
}

// ── Add site form ─────────────────────────────────────────────────────────────
function AddSiteForm({ onAdd }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!url.trim()) { toast("URL is required", "error"); return; }
    let finalUrl = url.trim();
    if (!/^https?:\/\//i.test(finalUrl)) finalUrl = "https://" + finalUrl;

    setLoading(true);
    try {
      const res = await fetch(`${API}/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || finalUrl, url: finalUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add site");
      toast(`Added ${data.name}`, "success");
      onAdd();
      setName(""); setUrl("");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="add-form" onSubmit={handleSubmit} id="add-site-form">
      <div className="form-group">
        <label htmlFor="site-name">Display name</label>
        <input
          id="site-name"
          type="text"
          placeholder="My Website"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label htmlFor="site-url">URL *</label>
        <input
          id="site-url"
          type="text"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
      </div>
      <button className="btn btn-primary" type="submit" disabled={loading} id="add-site-submit">
        {loading ? <span className="spinner" /> : "＋ Add"}
      </button>
    </form>
  );
}

// ── History bar ───────────────────────────────────────────────────────────────
function HistoryBar({ history }) {
  const displayCount = 30;
  const padded = [...Array(Math.max(0, displayCount - history.length)).fill(null), ...history.slice(-displayCount)];
  return (
    <div className="history-bar" title="Last 30 checks">
      {padded.map((v, i) => (
        <div
          key={i}
          className={`history-tick ${v === null ? "unknown" : v ? "up" : "down"}`}
        />
      ))}
    </div>
  );
}

// ── Site card ─────────────────────────────────────────────────────────────────
function SiteCard({ site, onDelete, onRefresh }) {
  const [checking, setChecking] = useState(false);
  const status = siteStatus(site);

  async function handleCheck() {
    setChecking(true);
    try {
      const res = await fetch(`${API}/sites/${site.id}/check`, { method: "POST" });
      const data = await res.json();
      toast(`${site.name}: ${data.up ? "UP" : "DOWN"} (${fmtMs(data.responseMs)})`, data.up ? "success" : "error");
      onRefresh();
    } catch {
      toast("Check failed", "error");
    } finally {
      setChecking(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove "${site.name}"?`)) return;
    try {
      await fetch(`${API}/sites/${site.id}`, { method: "DELETE" });
      toast(`Removed ${site.name}`, "info");
      onRefresh();
    } catch {
      toast("Delete failed", "error");
    }
  }

  return (
    <div className={`site-card ${status}`} id={`site-card-${site.id}`}>
      <div className={`status-dot ${status}`} />

      <div className="site-info">
        <div className="site-name">{site.name}</div>
        <div className="site-url">
          <a href={site.url} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
            {site.url}
          </a>
        </div>
      </div>

      <HistoryBar history={site.history || []} />

      <div className="site-meta">
        <div className="meta-item">
          <span className="meta-label">Status</span>
          <span className={`badge ${status}`}>{status === "unknown" ? "—" : status.toUpperCase()}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Response</span>
          <span className={`meta-value ${site.latest?.up ? "green" : "red"}`}>
            {fmtMs(site.latest?.response_ms)}
          </span>
        </div>
        <div className="meta-item">
          <span className="meta-label">24h Uptime</span>
          <span className={`meta-value ${uptimeColor(site.uptimePct)}`}>
            {site.uptimePct != null ? `${site.uptimePct}%` : "—"}
          </span>
        </div>
        <div className="meta-item">
          <span className="meta-label">HTTP</span>
          <span className="meta-value muted">
            {site.latest?.status_code ?? "—"}
          </span>
        </div>
      </div>

      <div className="site-actions">
        <button
          className="icon-btn"
          title="Check now"
          id={`check-btn-${site.id}`}
          onClick={handleCheck}
          disabled={checking}
        >
          {checking ? <span className="spinner" /> : "↻"}
        </button>
        <button
          className="icon-btn del"
          title="Remove site"
          id={`delete-btn-${site.id}`}
          onClick={handleDelete}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ── Stats row ─────────────────────────────────────────────────────────────────
function StatsRow({ sites }) {
  const total = sites.length;
  const up    = sites.filter((s) => siteStatus(s) === "up").length;
  const down  = sites.filter((s) => siteStatus(s) === "down").length;
  const avgUptime = sites.length
    ? Math.round(sites.filter((s) => s.uptimePct != null).reduce((a, s) => a + s.uptimePct, 0) /
        (sites.filter((s) => s.uptimePct != null).length || 1))
    : null;

  return (
    <div className="stats-row">
      <div className="stat-card">
        <span className="stat-label">Total sites</span>
        <span className="stat-value blue">{total}</span>
      </div>
      <div className="stat-card">
        <span className="stat-label">Online</span>
        <span className="stat-value green">{up}</span>
      </div>
      <div className="stat-card">
        <span className="stat-label">Down</span>
        <span className="stat-value red">{down}</span>
      </div>
      <div className="stat-card">
        <span className="stat-label">Avg 24h uptime</span>
        <span className={`stat-value ${uptimeColor(avgUptime)}`}>
          {avgUptime != null ? `${avgUptime}%` : "—"}
        </span>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [sites, setSites]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [checkingAll, setCA]      = useState(false);
  const intervalRef               = useRef(null);

  const fetchSites = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/sites`);
      const data = await res.json();
      setSites(Array.isArray(data) ? data : []);
    } catch {
      // silently fail on background polls
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSites();
    intervalRef.current = setInterval(fetchSites, 30_000); // auto-refresh every 30s
    return () => clearInterval(intervalRef.current);
  }, [fetchSites]);

  async function handleCheckAll() {
    setCA(true);
    try {
      await fetch(`${API}/check-all`, { method: "POST" });
      toast("All sites checked!", "success");
      await fetchSites();
    } catch {
      toast("Check-all failed", "error");
    } finally {
      setCA(false);
    }
  }

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-left">
          <div className="logo-dot" />
          <div>
            <h1>Uptime Monitor</h1>
            <div className="header-subtitle">Refreshes every 30s · backend checks every 60s</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: ".6rem" }}>
          <button
            id="check-all-btn"
            className="btn btn-ghost"
            onClick={handleCheckAll}
            disabled={checkingAll || sites.length === 0}
          >
            {checkingAll ? <span className="spinner" /> : "↻"} Check all
          </button>
          <button
            id="add-site-btn"
            className="btn btn-primary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "✕ Cancel" : "＋ Add site"}
          </button>
        </div>
      </header>

      {/* ── Stats ── */}
      <StatsRow sites={sites} />

      {/* ── Add form ── */}
      {showForm && (
        <AddSiteForm
          onAdd={() => { fetchSites(); setShowForm(false); }}
        />
      )}

      {/* ── Sites list ── */}
      <div className="toolbar">
        <h2>Monitored sites ({sites.length})</h2>
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="emoji">⏳</div>
          <p>Loading sites…</p>
        </div>
      ) : sites.length === 0 ? (
        <div className="empty-state">
          <div className="emoji">🌐</div>
          <p>No sites added yet. Click <strong>+ Add site</strong> to start monitoring.</p>
        </div>
      ) : (
        <div className="sites-list">
          {sites.map((site) => (
            <SiteCard
              key={site.id}
              site={site}
              onDelete={fetchSites}
              onRefresh={fetchSites}
            />
          ))}
        </div>
      )}

      <ToastContainer />
    </div>
  );
}
