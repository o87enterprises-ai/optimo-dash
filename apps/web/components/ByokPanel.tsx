"use client";

import { useEffect, useState } from "react";
import { ApiError, api, clearByok, readByok, writeByok } from "../lib/api";
import { citedState } from "../lib/viz";

/**
 * Bring your own key.
 *
 * Lets a visitor run a real LLM visibility probe with their own API key. The
 * key is kept in this browser tab (sessionStorage) and sent with the request;
 * the server uses it for that one call and never stores it, so it cannot be
 * reused by anyone else — including the operator.
 */

const PROVIDERS = [
  { name: "ANTHROPIC_API_KEY", label: "Anthropic", model: "claude-3.5", hint: "sk-ant-…" },
  { name: "OPENAI_API_KEY", label: "OpenAI", model: "gpt-4o", hint: "sk-proj-…" },
  { name: "GOOGLE_AI_API_KEY", label: "Google AI", model: "gemini-1.5", hint: "AIza…" },
  { name: "PERPLEXITY_API_KEY", label: "Perplexity", model: "perplexity", hint: "pplx-…" },
] as const;

type Result = { model: string; cited: boolean; excerpt: string; cached: boolean; error?: string };

export default function ByokPanel({
  siteId,
  domain,
  demo,
}: {
  siteId: number;
  domain: string;
  demo: boolean;
}) {
  const [provider, setProvider] = useState<string>(PROVIDERS[0].name);
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("best crm for startups");
  // On the demo a visitor checks a domain of their own; elsewhere the probe
  // always runs against the site being viewed.
  const [target, setTarget] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSaved(Object.keys(readByok())), []);

  const active = PROVIDERS.find((p) => p.name === provider)!;

  function saveKey() {
    if (!key.trim()) return;
    writeByok({ ...readByok(), [provider]: key.trim() });
    setSaved(Object.keys(readByok()));
    // Drop the plaintext from React state the moment it is stored.
    setKey("");
    setError(null);
  }

  function forget() {
    clearByok();
    setSaved([]);
    setResults(null);
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const res = await api<{ results: Result[] }>(`/api/sites/${siteId}/prompts`, {
        method: "POST",
        body: JSON.stringify({
          prompt: prompt.trim(),
          models: [active.model],
          domain: demo && target.trim() ? target.trim() : undefined,
        }),
      });
      setResults(res.results);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400 && /own API key/.test(err.message)
          ? "Add your key above first — the demo has none of its own."
          : (err as Error).message
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div>
        <div className="cred-name">Try it with your own key</div>
        <div className="hint">
          {demo
            ? "Check whether the LLMs cite any domain you like. "
            : `Runs a real check against ${domain}. `}
          Your key stays in this browser tab, is sent with the request, and is never stored on the
          server — close the tab and it is gone.
        </div>
      </div>

      <div className="row">
        <label className="sr-only" htmlFor="byok-provider">Provider</label>
        <select id="byok-provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
          {PROVIDERS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.label}
              {saved.includes(p.name) ? " ✓" : ""}
            </option>
          ))}
        </select>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={saved.includes(provider) ? "Key set for this tab — paste to replace" : active.hint}
          autoComplete="off"
          spellCheck={false}
          aria-label={`${active.label} API key`}
        />
        <button type="button" onClick={saveKey} disabled={!key.trim()}>Use key</button>
        {saved.length > 0 && (
          <button type="button" className="secondary" onClick={forget}>Forget keys</button>
        )}
      </div>

      <form className="row" onSubmit={run}>
        {demo && (
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={domain}
            aria-label="Domain to check"
          />
        )}
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask what a real user would ask"
          aria-label="Prompt to test"
        />
        <button disabled={busy || !saved.includes(provider)}>
          {busy ? "Asking the model…" : `Run on ${active.label}`}
        </button>
      </form>

      {!saved.includes(provider) && (
        <div className="hint">Add a {active.label} key above to enable the probe.</div>
      )}

      {error && <div className="banner error">{error}</div>}

      {results && (
        <div className="stack">
          {results.map((r) => {
            const state = citedState(r.cited);
            return (
              <div key={r.model} className="byok-result">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{r.model}</strong>
                  {r.error ? (
                    <span style={{ color: "var(--bad)" }}>failed</span>
                  ) : (
                    <span style={{ color: state.color }}>
                      <span aria-hidden="true">{state.mark} </span>
                      {state.label}
                      {r.cached ? " · cached" : ""}
                    </span>
                  )}
                </div>
                <p className="excerpt" style={{ maxWidth: "none", marginBottom: 0 }}>
                  {r.error ?? r.excerpt ?? "—"}
                </p>
              </div>
            );
          })}
          <div className="hint">
            Nothing here was saved. On the demo, probes are not written to the database.
          </div>
        </div>
      )}
    </div>
  );
}
