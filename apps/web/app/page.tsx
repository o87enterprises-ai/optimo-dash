"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Health = { ok: boolean; db: boolean; redis: boolean };
type Site = { id: number; domain: string; name: string; created_at: string };
type Rank = { keywords: any[]; updated: string | null; totals?: { keywords: number; clicks: number; impressions: number } };
type Gsc = { configured: boolean; mode?: string; reason?: string };
type Geo = { prompts: any[]; visibility: number; byProvider?: Record<string, { prompts: number; visibility: number }> };
type Backlinks = { backlinks: any[] };
type Provider = { id: string; label: string; model: string | null; enabled: boolean; grounded: boolean; reason?: string };
type SavedPrompt = { id: number; prompt: string };
type ProbeRow = { provider: string; model: string; mentioned: boolean; cited: boolean; excerpt: string; cached: boolean; error?: string };

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
  const [providers, setProviders] = useState<Provider[]>([]);
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [promptInput, setPromptInput] = useState("");
  const [probing, setProbing] = useState(false);
  const [probeNote, setProbeNote] = useState("");
  const [gsc, setGsc] = useState<Gsc | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<{ ok: boolean; text: string } | null>(null);

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

  async function loadProviders() {
    setProviders(await fetch("/api/providers").then((r) => r.json()).catch(() => []));
  }

  async function loadConnectors() {
    const c = await fetch("/api/connectors").then((r) => r.json()).catch(() => null);
    setGsc(c?.gsc ?? null);
  }

  async function syncSearchConsole() {
    if (!activeSite) return;
    setSyncing(true);
    setSyncNote(null);
    const res = await fetch(`/api/sites/${activeSite.id}/sync/gsc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    setSyncing(false);
    if (!res.ok) {
      const avail = data.available?.length ? ` Available properties: ${data.available.join(", ")}` : "";
      return setSyncNote({ ok: false, text: (data.error || "Sync failed") + avail });
    }
    setSyncNote({
      ok: true,
      text: `Synced ${data.keywords} queries from ${data.property} (${data.startDate} → ${data.endDate})`,
    });
    await loadSiteData(activeSite);
  }

  async function loadPrompts(site: Site) {
    const [p, s] = await Promise.all([
      fetch(`/api/sites/${site.id}/prompts`).then((x) => x.json()),
      fetch(`/api/sites/${site.id}/prompt-suggestions`).then((x) => x.json()),
    ]);
    setPrompts(p);
    setSuggestions(s);
  }

  async function runPrompt(prompt: string) {
    if (!activeSite || !prompt.trim()) return;
    setProbing(true);
    setProbeNote("");
    const res = await fetch(`/api/sites/${activeSite.id}/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    setProbing(false);
    if (!res.ok) return setProbeNote(data.error || "Probe failed");
    const errs = (data.results as ProbeRow[]).filter((r) => r.error).map((r) => `${r.provider}: ${r.error}`);
    setProbeNote(data.warning || errs.join(" · "));
    setPromptInput("");
    await Promise.all([loadPrompts(activeSite), loadSiteData(activeSite)]);
  }

  async function removePrompt(id: number) {
    if (!activeSite) return;
    await fetch(`/api/sites/${activeSite.id}/prompts/${id}`, { method: "DELETE" });
    await loadPrompts(activeSite);
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
    loadProviders();
    loadConnectors();
    const id = setInterval(loadHealth, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!activeSite) return;
    loadSiteData(activeSite);
    loadPrompts(activeSite);
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
          <Link href="/autopilot" className="status">Autopilot →</Link>
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
              <div className="value">{rank?.totals?.keywords ?? 0}</div>
              <div className="meta">
                {rank?.totals?.keywords
                  ? `${rank.totals.clicks.toLocaleString()} clicks · ${rank.totals.impressions.toLocaleString()} impressions`
                  : "Sync Search Console below"}
              </div>
            </div>
            <div className="card">
              <h3>AEO · Snippets / PAA</h3>
              <div className="value">0</div>
              <div className="meta">Connector pending</div>
            </div>
            <div className="card">
              <h3>GEO · LLM visibility</h3>
              <div className="value">{geo?.visibility ?? 0}%</div>
              <div className="meta">{geo?.prompts?.length ?? 0} results across {Object.keys(geo?.byProvider ?? {}).length} models</div>
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
          <div className="section-title">SEO · Google Search Console</div>
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span className="meta">
                <span className={`dot ${gsc?.configured ? "ok" : "bad"}`} />{" "}
                {gsc?.configured
                  ? `Connected (${gsc.mode === "oauth" ? "OAuth" : "service account"})`
                  : gsc?.reason || "Not connected"}
                {rank?.updated ? ` · last sync ${new Date(rank.updated).toLocaleString()}` : ""}
              </span>
              <button
                onClick={syncSearchConsole}
                disabled={syncing || !gsc?.configured}
                title={gsc?.configured ? "Pull the last 28 days" : gsc?.reason}
                style={{
                  padding: "8px 16px", borderRadius: 8, border: "none",
                  background: "var(--accent)", color: "#001a33", fontWeight: 600,
                  cursor: syncing ? "wait" : gsc?.configured ? "pointer" : "not-allowed",
                  opacity: gsc?.configured ? 1 : 0.5,
                }}
              >
                {syncing ? "Syncing…" : "Sync Search Console"}
              </button>
            </div>
            {syncNote && (
              <div className="meta" style={{ marginTop: 8, color: syncNote.ok ? "var(--ok)" : "var(--bad)" }}>
                {syncNote.text}
              </div>
            )}
          </div>

          {rank && rank.keywords.length > 0 && (
            <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr className="meta" style={{ textAlign: "left" }}>
                    <th>Query</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Avg. position</th>
                  </tr>
                </thead>
                <tbody>
                  {rank.keywords.slice(0, 25).map((k) => (
                    <tr key={k.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px 6px 0" }}>{k.keyword}</td>
                      <td>{k.clicks ?? 0}</td>
                      <td>{k.impressions ?? 0}</td>
                      <td>{k.ctr != null ? `${(k.ctr * 100).toFixed(1)}%` : "—"}</td>
                      <td>{k.position != null ? Number(k.position).toFixed(1) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rank.keywords.length > 25 && (
                <div className="meta" style={{ marginTop: 8 }}>
                  Showing top 25 of {rank.totals?.keywords ?? rank.keywords.length} queries
                </div>
              )}
            </div>
          )}

          <div className="section-title">GEO · LLM visibility probes</div>
          <div className="card">
            <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {providers.map((p) => (
                <span
                  key={p.id}
                  className="meta"
                  title={p.enabled ? `${p.model}${p.grounded ? " · web-grounded" : ""}` : p.reason}
                  style={{ border: "1px solid var(--border)", borderRadius: 999, padding: "2px 10px", opacity: p.enabled ? 1 : 0.5 }}
                >
                  <span className={`dot ${p.enabled ? "ok" : "bad"}`} /> {p.label}
                  {p.enabled ? ` · ${p.model}` : ` · ${p.reason}`}
                </span>
              ))}
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); runPrompt(promptInput); }}
              style={{ display: "flex", gap: 12 }}
            >
              <input
                type="text"
                placeholder="Ask an LLM something your customers would, e.g. best CRM for startups"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                style={{
                  flex: 1, padding: "10px 14px", borderRadius: 8,
                  border: "1px solid var(--border)", background: "#0b0f17",
                  color: "var(--text)", fontSize: 14,
                }}
              />
              <button
                type="submit"
                disabled={probing}
                style={{
                  padding: "10px 20px", borderRadius: 8, border: "none",
                  background: "var(--accent)", color: "#001a33",
                  fontWeight: 600, cursor: probing ? "wait" : "pointer",
                }}
              >
                {probing ? "Probing…" : "Save & probe"}
              </button>
            </form>
            {probeNote && <div className="meta" style={{ marginTop: 8, color: "var(--bad)" }}>{probeNote}</div>}
            {suggestions.length > 0 && prompts.length === 0 && (
              <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                <span className="meta">Try:</span>
                {suggestions.map((sg) => (
                  <button
                    key={sg}
                    onClick={() => setPromptInput(sg)}
                    style={{
                      background: "transparent", border: "1px solid var(--border)", color: "var(--text)",
                      borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12,
                    }}
                  >
                    {sg}
                  </button>
                ))}
              </div>
            )}
          </div>

          {geo && geo.prompts.length > 0 && (
            <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr className="meta" style={{ textAlign: "left" }}>
                    <th>Prompt</th><th>Model</th><th>Mentioned</th><th>Cited</th><th>Excerpt</th>
                  </tr>
                </thead>
                <tbody>
                  {geo.prompts.map((r) => (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px 6px 0" }}>{r.prompt}</td>
                      <td>{r.provider || r.model}</td>
                      <td>{r.mentioned ? "✓" : "✗"}</td>
                      <td>{r.sources === null ? <span className="meta">n/a</span> : r.cited ? "✓" : "✗"}</td>
                      <td className="meta">{r.excerpt ? `…${r.excerpt}…` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {prompts.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="meta" style={{ marginBottom: 8 }}>Tracked prompts</div>
              {prompts.map((p) => (
                <div key={p.id} className="row" style={{ justifyContent: "space-between", padding: "4px 0" }}>
                  <span>{p.prompt}</span>
                  <span className="row" style={{ gap: 8 }}>
                    <button onClick={() => runPrompt(p.prompt)} disabled={probing}
                      style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontSize: 12 }}>
                      Re-run
                    </button>
                    <button onClick={() => removePrompt(p.id)}
                      style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--bad)", borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontSize: 12 }}>
                      Remove
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

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
