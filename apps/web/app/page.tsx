"use client";

import { useEffect, useState } from "react";

type Health = { ok: boolean; db: boolean; redis: boolean };
type Site = { id: number; domain: string; name: string; created_at: string };
type Rank = { keywords: any[]; updated: string };
type Geo = { prompts: any[]; visibility: number };
type Backlinks = { backlinks: any[] };

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [activeSite, setActiveSite] = useState<Site | null>(null);
  const [rank, setRank] = useState<Rank | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [links, setLinks] = useState<Backlinks | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [lastUpdate, setLastUpdate] = useState("—");

  async function loadHealth() {
    try {
      setHealth(await fetch("/health").then((r) => r.json()));
    } catch {
      setHealth({ ok: false, db: false, redis: false });
    }
  }

  async function loadSites() {
    const data = await fetch("/api/sites").then((r) => r.json());
    setSites(data);
    if (!activeSite && data.length) setActiveSite(data[0]);
  }

  async function loadSiteData(site: Site) {
    const [r, g, b] = await Promise.all([
      fetch(`/api/sites/${site.id}/rank`).then((x) => x.json()),
      fetch(`/api/sites/${site.id}/geo`).then((x) => x.json()),
      fetch(`/api/sites/${site.id}/backlinks`).then((x) => x.json()),
    ]);
    setRank(r);
    setGeo(g);
    setLinks(b);
    setLastUpdate(new Date().toLocaleTimeString());
  }

  async function addSite(e: React.FormEvent) {
    e.preventDefault();
    if (!domainInput.trim()) return;
    setAdding(true);
    const res = await fetch("/api/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: domainInput }),
    });
    setAdding(false);
    if (res.ok) {
      const site = await res.json();
      setDomainInput("");
      setActiveSite(site);
      await loadSites();
    } else {
      const err = await res.json();
      alert(err.error || "Failed to add site");
    }
  }

  async function removeSite(id: number) {
    if (!confirm("Remove this site and all its data?")) return;
    await fetch(`/api/sites/${id}`, { method: "DELETE" });
    if (activeSite?.id === id) setActiveSite(null);
    await loadSites();
  }

  useEffect(() => {
    loadHealth();
    loadSites();
    const id = setInterval(loadHealth, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!activeSite) return;
    loadSiteData(activeSite);
    const id = setInterval(() => loadSiteData(activeSite), 10000);
    return () => clearInterval(id);
  }, [activeSite?.id]);

  return (
    <main className="container">
      <div className="header">
        <div>
          <div className="title">SEO / AEO / GEO Dashboard</div>
          <div className="subtitle">
            {activeSite ? `Tracking: ${activeSite.domain}` : "Add a site to start tracking"}
          </div>
        </div>
        <div className="row">
          <span className="status"><span className={`dot ${health?.ok ? "ok" : "bad"}`} />API</span>
          <span className="status"><span className={`dot ${health?.db ? "ok" : "bad"}`} />DB</span>
          <span className="status"><span className={`dot ${health?.redis ? "ok" : "bad"}`} />Redis</span>
        </div>
      </div>

      <div className="section-title">Add a site</div>
      <form onSubmit={addSite} className="card" style={{ display: "flex", gap: 12 }}>
        <input
          type="text"
          placeholder="example.com"
          value={domainInput}
          onChange={(e) => setDomainInput(e.target.value)}
          style={{
            flex: 1, padding: "10px 14px", borderRadius: 8,
            border: "1px solid var(--border)", background: "#0b0f17",
            color: "var(--text)", fontSize: 14,
          }}
        />
        <button
          type="submit"
          disabled={adding}
          style={{
            padding: "10px 20px", borderRadius: 8, border: "none",
            background: "var(--accent)", color: "#001a33",
            fontWeight: 600, cursor: adding ? "wait" : "pointer",
          }}
        >
          {adding ? "Adding…" : "Add site"}
        </button>
      </form>

      {sites.length > 0 && (
        <>
          <div className="section-title">Your sites</div>
          <div className="grid">
            {sites.map((s) => (
              <div
                key={s.id}
                className="card"
                style={{
                  cursor: "pointer",
                  borderColor: activeSite?.id === s.id ? "var(--accent)" : "var(--border)",
                }}
                onClick={() => setActiveSite(s)}
              >
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{s.domain}</div>
                    <div className="meta">Added {new Date(s.created_at).toLocaleDateString()}</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeSite(s.id); }}
                    style={{
                      background: "transparent", border: "1px solid var(--border)",
                      color: "var(--bad)", borderRadius: 6, padding: "4px 10px",
                      cursor: "pointer", fontSize: 12,
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {activeSite && (
        <>
          <div className="section-title">Overview · {activeSite.domain}</div>
          <div className="grid">
            <div className="card">
              <h3>SEO · Keywords tracked</h3>
              <div className="value">{rank?.keywords?.length ?? 0}</div>
              <div className="meta">Updated {rank?.updated ? new Date(rank.updated).toLocaleString() : "—"}</div>
            </div>
            <div className="card">
              <h3>AEO · Snippets / PAA</h3>
              <div className="value">0</div>
              <div className="meta">Connector pending</div>
            </div>
            <div className="card">
              <h3>GEO · LLM visibility</h3>
              <div className="value">{geo?.visibility ?? 0}%</div>
              <div className="meta">{geo?.prompts?.length ?? 0} prompts tracked</div>
            </div>
            <div className="card">
              <h3>Backlinks</h3>
              <div className="value">{links?.backlinks?.length ?? 0}</div>
              <div className="meta">Connector pending</div>
            </div>
            <div className="card">
              <h3>Citations</h3>
              <div className="value">0</div>
              <div className="meta">Connector pending</div>
            </div>
            <div className="card">
              <h3>Reviews</h3>
              <div className="value">0</div>
              <div className="meta">Connector pending</div>
            </div>
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Live polling every 10s</div>
              <div className="meta">Last update: {lastUpdate}</div>
            </div>
          </div>
        </>
      )}

      <div className="footer">
        Stack running on Termux · Next.js 15 · Express · PostgreSQL 18 · Redis 8
      </div>
    </main>
  );
}
