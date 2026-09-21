"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api, loadSession } from "../lib/api";
import type { SessionState } from "../lib/api";

type Health = { ok: boolean; db: boolean; dialect: string; encryptionConfigured: boolean };
type Site = { id: number; domain: string; name: string; created_at: string };
type Summary = {
  seo: { n: number; clicks: number; impressions: number; avg_position: number | null };
  geo: { n: number; cited: number; visibility: number };
  backlinks: { live: number; lost: number };
  reviews: { n: number; sentiment: number | null; rating: number | null };
  citations: { n: number; authority: number | null };
  updated: string;
};

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [activeSite, setActiveSite] = useState<Site | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState("—");

  const loadHealth = useCallback(async () => {
    try {
      setHealth(await api<Health>("/api/health"));
    } catch {
      setHealth({ ok: false, db: false, dialect: "?", encryptionConfigured: false });
    }
  }, []);

  const loadSites = useCallback(async () => {
    try {
      const data = await api<Site[]>("/api/sites");
      setSites(data);
      setActiveSite((current) => current ?? data[0] ?? null);
    } catch (e) {
      // Reads are authenticated unless the deployment opts into public reads.
      if (e instanceof ApiError && e.status === 401) {
        setSites([]);
        setActiveSite(null);
        return;
      }
      throw e;
    }
  }, []);

  const loadSummary = useCallback(async (site: Site) => {
    setSummary(await api<Summary>(`/api/sites/${site.id}/summary`));
    setLastUpdate(new Date().toLocaleTimeString());
  }, []);

  useEffect(() => {
    void loadHealth();
    void loadSession()
      .then(async (state) => {
        setSession(state);
        // Skip the request entirely when it is known to be unauthorised;
        // firing it anyway would only log a 401 in the console.
        if (state.authenticated || state.publicReads) {
          await loadSites().catch((e) => setError((e as Error).message));
        }
      })
      .catch(() => undefined);
    const id = setInterval(loadHealth, 10000);
    return () => clearInterval(id);
  }, [loadHealth, loadSites]);

  useEffect(() => {
    if (!activeSite) return;
    void loadSummary(activeSite).catch(() => undefined);
    const id = setInterval(() => void loadSummary(activeSite).catch(() => undefined), 15000);
    return () => clearInterval(id);
  }, [activeSite, loadSummary]);

  const signedIn = session?.authenticated ?? false;

  async function addSite(e: React.FormEvent) {
    e.preventDefault();
    if (!domainInput.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const site = await api<Site>("/api/sites", {
        method: "POST",
        body: JSON.stringify({ domain: domainInput }),
      });
      setDomainInput("");
      setActiveSite(site);
      await loadSites();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? "Sign in on the Settings page to add a site."
          : (e as Error).message
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeSite(id: number) {
    if (!confirm("Remove this site and all its data?")) return;
    try {
      await api(`/api/sites/${id}`, { method: "DELETE" });
      if (activeSite?.id === id) setActiveSite(null);
      await loadSites();
    } catch (e) {
      setError((e as Error).message);
    }
  }

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
          <span className="status">
            <span className={`dot ${health?.ok ? "ok" : "bad"}`} />
            {health?.dialect === "sqlite" ? "D1" : "DB"}
          </span>
          <span className="status">
            <span className={`dot ${signedIn ? "ok" : "bad"}`} />
            {signedIn ? session?.username : "signed out"}
          </span>
          <a href="/settings/">Settings</a>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      {session && !session.setupComplete && (
        <div className="banner warn">
          This deployment has no admin account yet. <a href="/settings/">Finish setup</a> to protect it
          before adding any API keys.
        </div>
      )}

      {session?.setupComplete && !signedIn && (
        <div className="banner">
          {session.publicReads
            ? "Viewing read-only. "
            : "This dashboard is private. "}
          <a href="/settings/">Sign in</a> to view your sites, run probes and manage API keys.
        </div>
      )}

      <div className="section-title">Add a site</div>
      <form onSubmit={addSite} className="card row">
        <input
          type="text"
          placeholder="example.com"
          value={domainInput}
          onChange={(e) => setDomainInput(e.target.value)}
          aria-label="Domain to track"
          disabled={!signedIn}
        />
        <button type="submit" disabled={busy || !signedIn}>
          {busy ? "Adding…" : "Add site"}
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
                  {signedIn && (
                    <button
                      className="danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeSite(s.id);
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {activeSite && summary && (
        <>
          <div className="section-title">Overview · {activeSite.domain}</div>
          <div className="grid">
            <Stat title="SEO · Keywords" value={summary.seo.n} meta={`${summary.seo.clicks} clicks · ${summary.seo.impressions} impressions`} />
            <Stat
              title="SEO · Avg position"
              value={summary.seo.avg_position ? summary.seo.avg_position.toFixed(1) : "—"}
              meta="Lower is better"
            />
            <Stat
              title="GEO · LLM visibility"
              value={`${summary.geo.visibility}%`}
              meta={`${summary.geo.cited} of ${summary.geo.n} prompts cited`}
            />
            <Stat title="Backlinks" value={summary.backlinks.live} meta={`${summary.backlinks.lost} lost`} />
            <Stat
              title="Citations"
              value={summary.citations.n}
              meta={summary.citations.authority ? `avg authority ${Math.round(summary.citations.authority)}` : "Run a sync"}
            />
            <Stat
              title="Reviews"
              value={summary.reviews.n}
              meta={
                summary.reviews.sentiment != null
                  ? `sentiment ${summary.reviews.sentiment.toFixed(2)}`
                  : "Connector pending"
              }
            />
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>Refreshing every 15s</div>
              <div className="meta">Last update: {lastUpdate}</div>
            </div>
          </div>
        </>
      )}

      <div className="footer">
        {health?.dialect === "sqlite"
          ? "Cloudflare Pages · D1 · KV"
          : "Self-hosted · Next.js · Hono · PostgreSQL · Redis"}
      </div>
    </main>
  );
}

function Stat({ title, value, meta }: { title: string; value: string | number; meta: string }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="value">{value}</div>
      <div className="meta">{meta}</div>
    </div>
  );
}
