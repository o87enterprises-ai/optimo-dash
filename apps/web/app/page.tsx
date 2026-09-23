"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, api, loadSession } from "../lib/api";
import type { SessionState } from "../lib/api";
import { buildSceneData } from "../lib/scene-data";
import type { SceneNode } from "../lib/scene-data";
import FilterPanel, { DEFAULT_FILTERS, withinRange } from "../components/FilterPanel";
import type { Filters } from "../components/FilterPanel";
import SceneStage from "../components/SceneStage";
import ByokPanel from "../components/ByokPanel";
import OverviewPanel from "../components/panels/OverviewPanel";
import ClonePanel from "../components/panels/ClonePanel";
import DebriefPanel from "../components/panels/DebriefPanel";
import {
  BacklinksPanel,
  CitationsPanel,
  GeoPromptsPanel,
  KeywordsPanel,
  ReviewsPanel,
} from "../components/panels/RecordPanels";

/**
 * The dashboard: a live scene on top, the records that feed it underneath.
 *
 * Leaflet touches `window` at import time, so the map is loaded dynamically
 * and only when its tab is opened.
 */
const WorldMap = dynamic(() => import("../components/WorldMap"), {
  ssr: false,
  loading: () => <div className="empty">Loading map…</div>,
});

type Site = { id: number; domain: string; name: string; created_at: string };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "keywords", label: "Keywords" },
  { key: "geo", label: "GEO prompts" },
  { key: "backlinks", label: "Backlinks" },
  { key: "reviews", label: "Reviews" },
  { key: "citations", label: "Citations" },
  { key: "regional", label: "Regional" },
  { key: "clone", label: "Clone" },
  { key: "debrief", label: "Debrief" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function Home() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [focus, setFocus] = useState<string | undefined>();
  const [country, setCountry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [busy, setBusy] = useState(false);

  const [summary, setSummary] = useState<any | null>(null);
  const [keywords, setKeywords] = useState<any[]>([]);
  const [prompts, setPrompts] = useState<any[]>([]);
  const [backlinks, setBacklinks] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [citations, setCitations] = useState<any[]>([]);
  const [regional, setRegional] = useState<{ countries: Record<string, any> }>({ countries: {} });

  const signedIn = session?.authenticated ?? false;
  const demo = session?.demo ?? false;
  const activeSite = sites.find((s) => s.id === activeId) ?? null;

  const loadSites = useCallback(async () => {
    try {
      const data = await api<Site[]>("/api/sites");
      setSites(data);
      setActiveId((current) => current ?? data[0]?.id ?? null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      throw e;
    }
  }, []);

  /** One pass over every endpoint the dashboard renders. */
  const loadSiteData = useCallback(async (id: number) => {
    const [s, r, g, b, rv, ct, rg] = await Promise.all([
      api(`/api/sites/${id}/summary`),
      api(`/api/sites/${id}/rank`),
      api(`/api/sites/${id}/geo`),
      api(`/api/sites/${id}/backlinks`),
      api(`/api/sites/${id}/reviews`),
      api(`/api/sites/${id}/citations`),
      api(`/api/sites/${id}/regional`),
    ]);
    setSummary(s);
    setKeywords((r as any).keywords ?? []);
    setPrompts((g as any).prompts ?? []);
    setBacklinks((b as any).backlinks ?? []);
    setReviews((rv as any).reviews ?? []);
    setCitations((ct as any).citations ?? []);
    setRegional((rg as any) ?? { countries: {} });
  }, []);

  useEffect(() => {
    void loadSession()
      .then(async (state) => {
        setSession(state);
        if (state.authenticated || state.publicReads) {
          await loadSites().catch((e) => setError((e as Error).message));
        }
      })
      .catch(() => undefined);
  }, [loadSites]);

  useEffect(() => {
    if (activeId == null) return;
    void loadSiteData(activeId).catch((e) => setError((e as Error).message));
    // The Cloudflare build has no SSE, so both deployments poll on the same
    // interval; it is cheap next to the render cost of the scene.
    const timer = setInterval(() => void loadSiteData(activeId).catch(() => undefined), 20000);
    return () => clearInterval(timer);
  }, [activeId, loadSiteData]);

  /* ---------- Filtering: applied to the scene and the tables alike ---------- */

  const filtered = useMemo(() => {
    const { days, categories } = filters;
    return {
      keywords: categories.keywords ? keywords.filter((k) => withinRange(k, days, "updated_at")) : [],
      prompts: categories.prompts ? prompts.filter((p) => withinRange(p, days, "updated_at")) : [],
      citations: categories.citations ? citations.filter((c) => withinRange(c, days, "discovered_at")) : [],
      backlinks: categories.backlinks ? backlinks.filter((b) => withinRange(b, days, "first_seen")) : [],
    };
  }, [filters, keywords, prompts, citations, backlinks]);

  const sceneData = useMemo(
    () => buildSceneData({ domain: activeSite?.domain ?? "—", ...filtered }),
    [activeSite, filtered]
  );

  /** Clicking a node jumps to the matching row in the table below. */
  const onSelectNode = useCallback((node: SceneNode) => {
    setTab(node.tab as TabKey);
    setFocus(node.title);
    document.getElementById("records")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

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
      setActiveId(site.id);
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

  return (
    <main className="container">
      <header className="header">
        <div>
          <div className="title">SEO / AEO / GEO Dashboard</div>
          <div className="subtitle">
            {activeSite ? `Tracking ${activeSite.domain}` : "Add a site to start tracking"}
          </div>
        </div>
        <div className="row">
          {sites.length > 0 && (
            <>
              <label className="sr-only" htmlFor="site-switcher">Site</label>
              <select
                id="site-switcher"
                value={activeId ?? ""}
                onChange={(e) => {
                  setActiveId(Number(e.target.value));
                  setFocus(undefined);
                }}
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.domain}</option>
                ))}
              </select>
            </>
          )}
          <span className="status">
            <span className={`dot ${demo ? "ok" : signedIn ? "ok" : "bad"}`} />
            {demo ? "demo" : signedIn ? session?.username : "signed out"}
          </span>
          {!demo && <a href="/settings/">Settings</a>}
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {session && !session.setupComplete && (
        <div className="banner warn">
          This deployment has no admin account yet. <a href="/settings/">Finish setup</a> to protect
          it before adding any API keys.
        </div>
      )}

      {demo && (
        <div className="banner demo-banner">
          <strong>Public demo.</strong> The data below is a seeded sample, and this deployment
          holds no API keys of its own — bring your own in the <em>GEO prompts</em> tab to run a
          real check. Nothing you do here is saved.{" "}
          <a href="https://github.com/o87enterprises-ai/optimo-dash">Source</a>
        </div>
      )}

      {!demo && session?.setupComplete && !signedIn && (
        <div className="banner">
          {session.publicReads ? "Viewing read-only. " : "This dashboard is private. "}
          <a href="/settings/">Sign in</a> to view your sites, run probes and manage API keys.
        </div>
      )}

      {signedIn && !sites.length && (
        <form onSubmit={addSite} className="card row">
          <input
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            placeholder="example.com"
            aria-label="Domain to track"
          />
          <button disabled={busy}>{busy ? "Adding…" : "Add your first site"}</button>
        </form>
      )}

      {activeSite && (
        <>
          <FilterPanel filters={filters} onChange={setFilters} />
          <SceneStage data={sceneData} onSelect={onSelectNode} />

          <nav className="tabs" id="records" aria-label="Records">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={tab === t.key ? "tab-on" : "tab-off"}
                aria-current={tab === t.key ? "page" : undefined}
                onClick={() => {
                  setTab(t.key);
                  setFocus(undefined);
                }}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <section className="panel">
            {tab === "overview" && summary && (
              <OverviewPanel summary={summary} keywords={filtered.keywords} />
            )}
            {tab === "keywords" && <KeywordsPanel rows={filtered.keywords} focus={focus} />}
            {tab === "geo" && (
              <div className="stack">
                {(demo || signedIn) && (
                  <ByokPanel siteId={activeSite.id} domain={activeSite.domain} demo={demo} />
                )}
                <GeoPromptsPanel rows={filtered.prompts} focus={focus} />
              </div>
            )}
            {tab === "backlinks" && <BacklinksPanel rows={filtered.backlinks} focus={focus} />}
            {tab === "reviews" && <ReviewsPanel rows={reviews} />}
            {tab === "citations" && <CitationsPanel rows={filtered.citations} focus={focus} />}
            {tab === "regional" && (
              <WorldMap data={regional} selected={country} onSelectCountry={setCountry} />
            )}
            {tab === "clone" && <ClonePanel siteId={activeSite.id} canRun={signedIn} />}
            {tab === "debrief" && (
              <DebriefPanel siteId={activeSite.id} country={country ?? undefined} />
            )}
          </section>
        </>
      )}

      <footer className="footer">
        Updates every 20s · {sites.length} site{sites.length === 1 ? "" : "s"} tracked
      </footer>
    </main>
  );
}
