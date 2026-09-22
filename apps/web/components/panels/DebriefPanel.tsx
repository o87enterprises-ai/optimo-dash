"use client";

import { useState } from "react";
import { api } from "../../lib/api";

/**
 * Debrief panel — generates copy-ready prompts for an agency or another LLM,
 * with per-prompt copy buttons and a markdown export.
 */

const SCOPES = ["full", "content", "aeo", "geo", "regional"] as const;
type Scope = (typeof SCOPES)[number];

export default function DebriefPanel({ siteId, country }: { siteId: number; country?: string }) {
  const [scope, setScope] = useState<Scope>("full");
  const [audience, setAudience] = useState("");
  const [debrief, setDebrief] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDebrief(await api(`/api/sites/${siteId}/debrief`, {
        method: "POST",
        body: JSON.stringify({ scope, targetAudience: audience || undefined, country }),
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch {
      setError("Could not copy — your browser blocked clipboard access.");
    }
  }

  function download() {
    // The API renders the markdown so this file matches the CLI's --out byte
    // for byte; the browser just saves what the server produced.
    const params = new URLSearchParams({ scope, format: "md" });
    if (audience) params.set("audience", audience);
    if (country) params.set("country", country);
    window.open(`/api/sites/${siteId}/debrief?${params}`, "_blank", "noopener");
  }

  return (
    <div className="stack">
      <form className="row debrief-controls" onSubmit={generate}>
        <label className="sr-only" htmlFor="debrief-scope">Scope</label>
        <select id="debrief-scope" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
          {SCOPES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="Target audience, e.g. early-stage SaaS founders"
          aria-label="Target audience"
        />
        <button disabled={busy}>{busy ? "Generating…" : "Generate"}</button>
        {debrief && (
          <button type="button" className="secondary" onClick={download}>
            Export .md
          </button>
        )}
      </form>

      <p className="hint">
        Each prompt embeds your real data plus a role, constraints, an output format and success
        criteria, so whoever receives it needs no further context.
      </p>

      {error && <div className="banner error">{error}</div>}

      {debrief && (
        <>
          <div className="banner">{debrief.summary}</div>
          {debrief.prompts.map((p: any) => (
            <div key={p.id} className="card stack">
              <div className="cred-head">
                <div>
                  <div className="cred-name">{p.title}</div>
                  <div className="hint">
                    <span className="pill">{p.category}</span> <span className="mono">{p.id}</span>
                  </div>
                </div>
                <button type="button" className="secondary" onClick={() => copy(p.id, p.prompt)}>
                  {copied === p.id ? "Copied" : "Copy prompt"}
                </button>
              </div>
              <pre className="prompt-text">{p.prompt}</pre>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
