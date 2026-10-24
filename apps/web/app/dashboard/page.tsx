"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

type Keyword = {
  id: number;
  keyword: string;
  position: number;
  clicks: number;
  impressions: number;
  ctr: number;
};

type RankData = {
  keywords: Keyword[];
  totals: { keywords: number; clicks: number; impressions: number };
  updated: string | null;
};

export default function TextDash() {
  const [data, setData] = useState<RankData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        // 1. Get the active site (defaults to the first one in the DB)
        const sitesRes = await fetch(`${API_BASE}/api/sites`);
        const sites = await sitesRes.json();
        
        if (!sites || sites.length === 0) {
          throw new Error("No sites configured in database.");
        }

        const siteId = sites[0].id;

        // 2. Fetch rank data for that site
        const rankRes = await fetch(`${API_BASE}/api/sites/${siteId}/rank`);
        if (!rankRes.ok) throw new Error("Failed to fetch rank data");
        
        const rankData = await rankRes.json();
        setData(rankData);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  return (
    <div className="hud-panel p-6 flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-mono text-xl text-primary mb-1">TEXT DASH // DIAGNOSTICS</h2>
          <p className="text-foreground/50 font-mono text-xs uppercase tracking-widest">
            Keyword Telemetry & Issue Queues
          </p>
        </div>
        {data && (
          <div className="flex gap-6 font-mono text-sm">
            <div className="flex flex-col items-end">
              <span className="text-foreground/50 text-xs">TOTAL CLICKS</span>
              <span className="text-success hud-text-glow">{data.totals.clicks.toLocaleString()}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-foreground/50 text-xs">IMPRESSIONS</span>
              <span className="text-primary">{data.totals.impressions.toLocaleString()}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-foreground/50 text-xs">KEYWORDS</span>
              <span className="text-foreground">{data.totals.keywords.toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto border border-panel-border rounded-sm bg-panel/10">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <span className="font-mono text-primary animate-pulse">SCANNING DATABASE...</span>
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center flex-col gap-2">
            <span className="font-mono text-danger hud-text-glow">SYSTEM ERROR</span>
            <span className="font-mono text-foreground/50 text-sm">{error}</span>
          </div>
        ) : !data || data.keywords.length === 0 ? (
          <div className="flex h-full items-center justify-center flex-col gap-2">
            <span className="font-mono text-foreground/60">NO TELEMETRY DATA FOUND</span>
            <span className="font-mono text-foreground/40 text-xs">Run a GSC Sync to populate this queue.</span>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-panel border-b border-panel-border z-10">
              <tr className="font-mono text-xs text-foreground/50 uppercase tracking-widest">
                <th className="p-3 font-normal">Keyword</th>
                <th className="p-3 font-normal text-right">Clicks</th>
                <th className="p-3 font-normal text-right">Impressions</th>
                <th className="p-3 font-normal text-right">CTR</th>
                <th className="p-3 font-normal text-right">Position</th>
              </tr>
            </thead>
            <tbody className="font-mono text-sm">
              {data.keywords.map((kw) => (
                <tr key={kw.id} className="border-b border-panel-border/50 hover:bg-panel/30 transition-colors">
                  <td className="p-3 text-foreground truncate max-w-xs">{kw.keyword}</td>
                  <td className="p-3 text-right text-success">{kw.clicks.toLocaleString()}</td>
                  <td className="p-3 text-right text-primary">{kw.impressions.toLocaleString()}</td>
                  <td className="p-3 text-right text-foreground/70">
                    {kw.ctr ? `${(kw.ctr * 100).toFixed(1)}%` : "-"}
                  </td>
                  <td className="p-3 text-right text-foreground/70">
                    {kw.position ? kw.position.toFixed(1) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      
      {data && data.updated && (
        <div className="mt-3 text-right font-mono text-xs text-foreground/40">
          LAST SYNC: {new Date(data.updated).toLocaleString()}
        </div>
      )}
    </div>
  );
}