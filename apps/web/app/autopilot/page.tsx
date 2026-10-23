"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { copyRequests, CopyResult, mergeAiCopy } from "../../lib/autopilot/ai";
import { discard, history, HistoryItem, propose, publish, scan, ScanResult, undo } from "../../lib/autopilot/engine";
import { GitHubRepo } from "../../lib/autopilot/github";
import { DEMO_FILES, MemoryRepo } from "../../lib/autopilot/memory";
import { parseRepo, RepoProvider } from "../../lib/autopilot/repo";
import { LIMITS, PageProposal } from "../../lib/autopilot/rules";

type ProviderStatus = { id: string; label: string; model: string | null; enabled: boolean; reason?: string };
type AiInfo = { providers: ProviderStatus[]; access: "open" | "code" | "off"; serverKeys: boolean };

const BYOK = ["nvidia", "groq", "gemini", "ollama-cloud"];
const store = {
  get: (k: string) => { try { return sessionStorage.getItem(k) ?? ""; } catch { return ""; } },
  set: (k: string, v: string) => { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch {} },
};

const btn = (primary = false, disabled = false): React.CSSProperties => ({
  padding: "8px 16px", borderRadius: 8, fontWeight: 600, fontSize: 13,
  border: primary ? "none" : "1px solid var(--border)",
  background: primary ? "var(--accent)" : "transparent",
  color: primary ? "#001a33" : "var(--text)",
  cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
});
const input: React.CSSProperties = {
  flex: 1, minWidth: 180, padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)",
  background: "#0b0f17", color: "var(--text)", fontSize: 14,
};
const pill = (color: string): React.CSSProperties => ({
  border: `1px solid ${color}`, color, borderRadius: 999, padding: "1px 10px", fontSize: 12,
});

const FIELD: Record<string, string> = { title: "Title", description: "Description", "og:title": "Social title", "og:description": "Social description" };

export default function Autopilot() {
  const [mode, setMode] = useState<"demo" | "github">("demo");
  const [repoInput, setRepoInput] = useState("");
  const [token, setToken] = useState("");
  const demo = useRef<MemoryRepo | null>(null);

  const [result, setResult] = useState<ScanResult | null>(null);
  const [proposals, setProposals] = useState<PageProposal[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<HistoryItem[]>([]);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const [ai, setAi] = useState<AiInfo | null>(null);
  const [useAi, setUseAi] = useState(true);
  const [aiProvider, setAiProvider] = useState("");
  const [aiKey, setAiKey] = useState("");
  const [access, setAccess] = useState("");
  const [aiNote, setAiNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setToken(store.get("optimo.gh"));
    setAiKey(store.get("optimo.ai.key"));
    setAiProvider(store.get("optimo.ai.provider"));
    setAccess(store.get("optimo.ai.access"));
  }, []);

  const aiHeaders = (): Record<string, string> => ({ "Content-Type": "application/json", ...(access ? { "x-autopilot-access": access } : {}) });

  async function loadAi() {
    try {
      setAi(await fetch("/api/autopilot/providers", { headers: aiHeaders() }).then((r) => r.json()));
    } catch {
      setAi(null);
    }
  }
  useEffect(() => { loadAi(); }, [access]);

  const aiBody = () => ({ provider: aiProvider || undefined, apiKey: aiKey || undefined });
  const aiReady = !!ai && (aiKey ? !!aiProvider : ai.providers.some((p) => p.enabled));

  async function testAi() {
    setAiNote(null);
    setBusy("test");
    const r = await fetch("/api/autopilot/test", { method: "POST", headers: aiHeaders(), body: JSON.stringify(aiBody()) });
    const d = await r.json().catch(() => ({}));
    setBusy("");
    setAiNote(d.ok ? { ok: true, text: `${d.provider} / ${d.model} answered in ${d.ms} ms` } : { ok: false, text: d.error || `Failed (${r.status})` });
  }

  function repoFor(): RepoProvider {
    if (mode === "demo") return (demo.current ||= new MemoryRepo({ ...DEMO_FILES }));
    const p = parseRepo(repoInput);
    if (!p) throw new Error("Enter the repository as owner/name, for example acme/website.");
    return new GitHubRepo(p.owner, p.repo, token.trim() || undefined);
  }

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setNote(null);
    try {
      return await fn();
    } catch (e: any) {
      setNote({ ok: false, text: e.message || String(e) });
    } finally {
      setBusy("");
    }
  }

  async function improve(list: PageProposal[], siteName: string | null): Promise<PageProposal[]> {
    const pages = copyRequests(list, siteName);
    if (!pages.length) return list;
    const r = await fetch("/api/autopilot/rewrite", { method: "POST", headers: aiHeaders(), body: JSON.stringify({ ...aiBody(), pages }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setAiNote({ ok: false, text: `AI copy skipped (${d.error || r.status}). Using the built-in copy.` });
      return list;
    }
    const results: CopyResult[] = d.results;
    const ok = results.filter((x) => !x.error).length;
    const bad = results.filter((x) => x.error);
    setAiNote({
      ok: bad.length === 0,
      text: `${d.provider} / ${d.model} wrote copy for ${ok} of ${results.length} pages.` + (bad.length ? ` Kept built-in copy for: ${bad.map((b) => `${b.path} (${b.error})`).join("; ")}` : ""),
    });
    return mergeAiCopy(list, results, d.provider);
  }

  async function doScan() {
    if (mode === "github" && !repoInput.trim()) return setNote({ ok: false, text: "Enter a repository first." });
    await run("scan", async () => {
      const repo = repoFor();
      const s = await scan(repo);
      let list = s.proposals;
      if (useAi && aiReady && list.length) list = await improve(list, s.siteName);
      setResult(s);
      setProposals(list);
      setPicked(new Set(list.map((p) => p.path)));
      setLog(await history(repo));
    });
  }

  async function doPropose() {
    const chosen = proposals.filter((p) => picked.has(p.path));
    await run("propose", async () => {
      const repo = repoFor();
      const r = await propose(repo, chosen);
      setLog(await history(repo));
      setNote({
        ok: true,
        text: `Pull request #${r.pr.number} opened for ${r.applied.length} page${r.applied.length === 1 ? "" : "s"}. Nothing is live until you publish it.` +
          (r.skipped.length ? ` Skipped: ${r.skipped.map((s) => `${s.path} (${s.reason})`).join("; ")}` : ""),
      });
    });
  }

  async function act(kind: "publish" | "discard" | "undo", n: number) {
    await run(`${kind}-${n}`, async () => {
      const repo = repoFor();
      if (kind === "publish") await publish(repo, n);
      else if (kind === "discard") await discard(repo, n);
      else {
        const r = await undo(repo, n);
        setNote({ ok: true, text: `Undo pull request #${r.pr.number} opened. Publish it to put the old text back.` + (r.skipped.length ? ` Left alone: ${r.skipped.map((s) => s.path).join(", ")}` : "") });
      }
      if (kind !== "undo") setNote({ ok: true, text: kind === "publish" ? `#${n} is now live on the main branch.` : `#${n} was discarded. Nothing changed.` });
      setLog(await history(repo));
      if (kind !== "discard") {
        const s = await scan(repo);
        setResult(s);
        setProposals(s.proposals);
        setPicked(new Set(s.proposals.map((p) => p.path)));
      }
    });
  }

  const sel = proposals.filter((p) => picked.has(p.path));
  const label = (s: string) => (busy === s ? "Working…" : "");

  return (
    <main className="container">
      <div className="header">
        <div>
          <div className="title">Autopilot</div>
          <div className="subtitle">Finds weak titles and descriptions, writes better ones, and proposes them as a reviewable change. Nothing goes live until you approve it.</div>
        </div>
        <Link href="/" className="status">← Dashboard</Link>
      </div>

      <div className="section-title">1 · Connect a site</div>
      <div className="card">
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <button style={btn(mode === "demo")} onClick={() => { setMode("demo"); setResult(null); setProposals([]); setNote(null); }}>Demo site</button>
          <button style={btn(mode === "github")} onClick={() => { setMode("github"); setResult(null); setProposals([]); setNote(null); }}>My GitHub repo</button>
        </div>
        {mode === "demo" ? (
          <div className="meta">
            A made-up dental practice with the usual problems. It lives in this browser tab, so you can approve, publish and undo freely; refreshing resets it.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <input style={input} placeholder="owner/repository" value={repoInput} onChange={(e) => setRepoInput(e.target.value)} />
              <input
                style={input} type="password" autoComplete="off" placeholder="GitHub token (needed to propose changes)"
                value={token} onChange={(e) => { setToken(e.target.value); store.set("optimo.gh", e.target.value); }}
              />
            </div>
            <div className="meta" style={{ marginTop: 8 }}>
              Create a{" "}
              <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">fine-grained token</a>{" "}
              for just this repository with <b>Contents</b> and <b>Pull requests</b> set to read and write. The token stays in this tab and goes straight to GitHub; it is never sent to Optimo&apos;s server.
              Public repos can be scanned without one. A one-click GitHub App install replaces this in the full product.
            </div>
          </>
        )}
        <div className="row" style={{ marginTop: 14, flexWrap: "wrap", gap: 12 }}>
          <button style={btn(true, !!busy)} disabled={!!busy} onClick={doScan}>{busy === "scan" ? "Scanning…" : result ? "Scan again" : "Scan site"}</button>
          <label className="meta" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={useAi && aiReady} disabled={!aiReady} onChange={(e) => setUseAi(e.target.checked)} />
            Write the copy with AI {aiReady ? "" : "(add a key below)"}
          </label>
        </div>
      </div>

      <div className="section-title">AI provider (optional)</div>
      <div className="card">
        <div className="meta" style={{ marginBottom: 10 }}>
          Copy is written by whichever AI service you connect: NVIDIA, Groq, Gemini, Ollama or any OpenAI-compatible endpoint (free tiers work).
          Suggestions are checked before use: they must fit the length limits and may not introduce numbers or links that are not on the page.
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {ai?.providers.map((p) => (
            <span key={p.id} className="meta" style={{ ...pill("var(--border)"), opacity: p.enabled ? 1 : 0.8 }} title={p.reason}>
              <span className={`dot ${p.enabled ? "ok" : "bad"}`} /> {p.label}{p.enabled ? ` · ${p.model}` : ` · ${p.reason}`}
            </span>
          ))}
          {!ai && <span className="meta">Could not load providers.</span>}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <select
            style={{ ...input, flex: "0 0 200px" }} value={aiProvider}
            onChange={(e) => { setAiProvider(e.target.value); store.set("optimo.ai.provider", e.target.value); }}
          >
            <option value="">Automatic (first ready)</option>
            {ai?.providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {BYOK.includes(aiProvider) && (
            <input
              style={input} type="password" autoComplete="off" placeholder={`Your ${aiProvider} API key (kept in this tab)`}
              value={aiKey} onChange={(e) => { setAiKey(e.target.value); store.set("optimo.ai.key", e.target.value); }}
            />
          )}
          {ai?.access === "code" && !ai.serverKeys && (
            <input
              style={input} type="password" autoComplete="off" placeholder="Access code to use the server's keys"
              value={access} onChange={(e) => { setAccess(e.target.value); store.set("optimo.ai.access", e.target.value); }}
            />
          )}
          <button style={btn(false, !!busy || !aiReady)} disabled={!!busy || !aiReady} onClick={testAi}>{busy === "test" ? "Testing…" : "Test connection"}</button>
        </div>
        {ai && !ai.serverKeys && ai.access === "off" && (
          <div className="meta" style={{ marginTop: 8 }}>This deployment has no shared keys, so paste your own above. They are sent only with your own requests and never stored.</div>
        )}
        {aiNote && <div className="meta" style={{ marginTop: 8, color: aiNote.ok ? "var(--ok)" : "var(--bad)" }}>{aiNote.text}</div>}
      </div>

      {note && (
        <div className="card" style={{ marginTop: 16, borderColor: note.ok ? "var(--ok)" : "var(--bad)" }}>
          <span style={{ color: note.ok ? "var(--ok)" : "var(--bad)" }}>{note.text}</span>
        </div>
      )}

      {result && (
        <>
          <div className="section-title">2 · Review proposed changes</div>
          {result.framework ? (
            <div className="card">
              No static HTML pages were found. This looks like a <b>{result.framework}</b> project, where page titles live in the source code.
              Autopilot edits static HTML sites today; framework support is planned.
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 12, color: "var(--muted)", fontSize: 12 }}>
                {result.repo.name} · {result.scanned} pages read · {result.proposals.length} need changes
                {result.deferred ? ` · ${result.deferred} more waiting (limit ${LIMITS.maxPagesPerRun} pages per run)` : ""}
                {result.truncated ? ` · only the first ${LIMITS.maxFilesRead} pages were read` : ""}
              </div>
              {proposals.length === 0 && <div className="card">Nothing to fix: every page already has a good title and description.</div>}
              <div style={{ display: "grid", gap: 16 }}>
                {proposals.map((p) => (
                  <div className="card" key={p.path} style={{ borderColor: picked.has(p.path) ? "var(--accent)" : "var(--border)" }}>
                    <label className="row" style={{ gap: 10, cursor: "pointer" }}>
                      <input
                        type="checkbox" checked={picked.has(p.path)}
                        onChange={(e) => setPicked((s) => { const n = new Set(s); e.target.checked ? n.add(p.path) : n.delete(p.path); return n; })}
                      />
                      <b>{p.path}</b>
                    </label>
                    <div style={{ overflowX: "auto", marginTop: 8 }}>
                      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                        <thead><tr className="meta" style={{ textAlign: "left" }}><th>Field</th><th>Before</th><th>After</th><th>Why</th></tr></thead>
                        <tbody>
                          {p.edits.map((e) => (
                            <tr key={e.field} style={{ borderTop: "1px solid var(--border)", verticalAlign: "top" }}>
                              <td style={{ padding: "6px 8px 6px 0", whiteSpace: "nowrap" }}>{FIELD[e.field]}</td>
                              <td className="meta" style={{ padding: "6px 8px" }}>{e.before ?? <i>none</i>}</td>
                              <td style={{ padding: "6px 8px" }}>
                                {e.after} <span className="meta">({e.after.length})</span>{" "}
                                <span style={pill(e.source === "rules" ? "var(--muted)" : "var(--accent)")}>{e.source === "rules" ? "rules" : `AI · ${e.source}`}</span>
                              </td>
                              <td className="meta" style={{ padding: "6px 0 6px 8px" }}>{e.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
              {proposals.length > 0 && (
                <div className="row" style={{ marginTop: 16, flexWrap: "wrap" }}>
                  <button style={btn(true, !!busy || !sel.length)} disabled={!!busy || !sel.length} onClick={doPropose}>
                    {busy === "propose" ? "Creating…" : `Create pull request for ${sel.length} page${sel.length === 1 ? "" : "s"}`}
                  </button>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>Review mode: this only proposes the change. You publish it in step 3.</span>
                </div>
              )}
              {result.needsHuman.length > 0 && (
                <div className="card" style={{ marginTop: 16 }}>
                  <div className="meta" style={{ marginBottom: 6 }}>Needs a person (Autopilot never changes these)</div>
                  {result.needsHuman.map((n) => (
                    <div key={n.message} style={{ padding: "4px 0", fontSize: 13 }}>
                      {n.message} <span className="meta">{n.paths.length > 1 ? `(${n.paths.length} pages)` : `(${n.paths[0]})`}</span>
                    </div>
                  ))}
                </div>
              )}
              {result.skipped.length > 0 && (
                <div style={{ marginTop: 12, color: "var(--muted)", fontSize: 12 }}>
                  Skipped: {result.skipped.map((s) => `${s.path} (${s.reason})`).join(" · ")}
                </div>
              )}
            </>
          )}
        </>
      )}

      {log.length > 0 && (
        <>
          <div className="section-title">3 · Publish, undo and history</div>
          <div className="card">
            {log.map((it) => (
              <div key={it.number} className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                <div>
                  <div>#{it.number} · {it.title}</div>
                  <div className="meta">
                    {new Date(it.createdAt).toLocaleString()} ·{" "}
                    <span style={pill(it.merged ? "var(--ok)" : it.state === "open" ? "var(--warn)" : "var(--muted)")}>
                      {it.merged ? "live" : it.state === "open" ? "waiting for approval" : "discarded"}
                    </span>
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {it.state === "open" && (
                    <>
                      <button style={btn(true, !!busy)} disabled={!!busy} onClick={() => act("publish", it.number)}>{busy === `publish-${it.number}` ? "Publishing…" : "Publish"}</button>
                      <button style={btn(false, !!busy)} disabled={!!busy} onClick={() => act("discard", it.number)}>Discard</button>
                    </>
                  )}
                  {it.merged && it.kind === "change" && (
                    <button style={btn(false, !!busy)} disabled={!!busy} onClick={() => act("undo", it.number)}>{busy === `undo-${it.number}` ? "Working…" : "Undo"}</button>
                  )}
                  {mode === "github" && <a href={it.url} target="_blank" rel="noreferrer" style={btn()}>View on GitHub</a>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title">Approval mode and guardrails</div>
      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={pill("var(--accent)")}>● Review: you approve every change</span>
          <span style={{ ...pill("var(--border)"), opacity: 0.8 }}>Safe auto: coming in the daily-run phase</span>
          <span style={{ ...pill("var(--border)"), opacity: 0.8 }}>Full auto: coming later</span>
        </div>
        <ul className="meta" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Only the page head (title, description, social tags) is edited; page content is checked to be byte-for-byte unchanged.</li>
          <li>Never writes to your main branch directly: every change is a pull request you publish, and every publish can be undone.</li>
          <li>At most {LIMITS.maxPagesPerRun} pages per run. Pages marked noindex, templates and partials are skipped.</li>
          <li>Only acts on its own pull requests (branches starting with optimo/). A page edited by someone else after the scan is left alone.</li>
          <li>The history above is the audit log: each change lists what it did, when, and whether the rules or an AI wrote it.</li>
        </ul>
      </div>
    </main>
  );
}
