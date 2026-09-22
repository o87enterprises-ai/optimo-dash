"use client";

import { useState } from "react";
import { ApiError, api } from "../../lib/api";
import { STATUS } from "../../lib/viz";

/**
 * Clone engine panel.
 *
 * Runs a competitor analysis and renders the gaps it found. Every figure the
 * engine produces is an estimate from public data, and the panel says so
 * rather than presenting it as measured.
 */

const PRIORITY_LABEL: Record<number, string> = { 1: "Now", 2: "Next", 3: "Later" };

export default function ClonePanel({ siteId, canRun }: { siteId: number; canRun: boolean }) {
  const [target, setTarget] = useState("");
  const [report, setReport] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!target.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setReport(await api("/api/clone", {
        method: "POST",
        body: JSON.stringify({ targetDomain: target.trim(), siteId }),
      }));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Sign in to run a clone report."
          : (err as Error).message
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <form className="row" onSubmit={run}>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="competitor.com"
          aria-label="Competitor domain to analyse"
          disabled={!canRun}
        />
        <button disabled={busy || !canRun || !target.trim()}>{busy ? "Crawling…" : "Run clone report"}</button>
      </form>

      <p className="hint">
        Crawls the competitor&apos;s public sitemap and pages, then diffs their topics, schema and
        referring domains against yours. Public data only — no logged-in or paywalled sources.
      </p>

      {error && <div className="banner error">{error}</div>}

      {report && (
        <>
          <div className="banner warn">
            All figures below are <strong>estimates</strong> from {report.pagesAnalyzed} public pages
            on {report.targetDomain}.
          </div>

          <div className="grid">
            <GapList title="Topic gaps" items={report.yourGaps.topics} empty="No topic gaps found." />
            <GapList title="Schema gaps" items={report.yourGaps.schema} empty="No schema gaps found." />
            <GapList title="Referring domains they have" items={report.yourGaps.backlinks} empty="No backlink gaps found." />
            <GapList title="Prompts where you are not cited" items={report.yourGaps.llmPrompts} empty="No uncited prompts." />
          </div>

          <div className="section-title">Recommended actions</div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Type</th>
                  <th scope="col">Action</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                {report.recommendedActions.map((a: any, i: number) => (
                  <tr key={i}>
                    <td>
                      <span
                        className="pill"
                        style={a.priority === 1 ? { borderColor: STATUS.warning, color: STATUS.warning } : undefined}
                      >
                        {PRIORITY_LABEL[a.priority] ?? `P${a.priority}`}
                      </span>
                    </td>
                    <td>{a.type}</td>
                    <td>{a.title}</td>
                    <td className="excerpt">{a.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function GapList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {items.length ? (
        <ul className="gap-list">
          {items.slice(0, 10).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <div className="meta">{empty}</div>
      )}
    </div>
  );
}
