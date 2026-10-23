import { analyzePage, applyEdits, Field, fieldValue, LIMITS, PageProposal } from "./rules";
import { readPage } from "./html";
import { PullRequest, RepoError, RepoInfo, RepoProvider } from "./repo";

export const BRANCH_PREFIX = "optimo/";
const MARKER = "<!-- optimo-autopilot -->";

export type ScanResult = {
  repo: RepoInfo;
  siteName: string | null;
  scanned: number;
  proposals: PageProposal[];
  deferred: number; // more pages need work than the per-run cap allows
  needsHuman: { message: string; paths: string[] }[];
  skipped: { path: string; reason: string }[];
  framework: string | null; // set when there are no static pages to work on
  truncated: boolean;
};

const IGNORED = /(^|\/)(node_modules|\.next|\.git|\.github|dist|build|out|vendor|coverage)\//;
const isHtml = (p: string) => /\.html?$/i.test(p);

const humanizeRepo = (name: string) =>
  name.split("/").pop()!.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function detectFramework(pkg: string | null, paths: string[]): string | null {
  if (pkg) {
    for (const [dep, label] of [["next", "Next.js"], ["astro", "Astro"], ["gatsby", "Gatsby"], ["nuxt", "Nuxt"], ["vite", "Vite"], ["react", "React"]]) {
      if (new RegExp(`"${dep}"\\s*:`).test(pkg)) return label;
    }
  }
  if (paths.includes("_config.yml")) return "Jekyll";
  if (paths.some((p) => /^(hugo|config)\.(toml|ya?ml|json)$/.test(p))) return "Hugo";
  return pkg ? "a Node project" : null;
}

function siteNameFrom(index: string | null, repoName: string): string {
  if (index) {
    const info = readPage(index);
    if (info.ogSiteName) return info.ogSiteName;
    if (info.title) {
      const parts = info.title.split(/\s+[|–—-]\s+/);
      if (parts.length > 1) return parts[parts.length - 1];
      if (info.title.length <= 30) return info.title;
    }
  }
  return humanizeRepo(repoName);
}

export async function scan(repo: RepoProvider, opts: { maxPages?: number } = {}): Promise<ScanResult> {
  const info = await repo.info();
  const files = await repo.listFiles(info.headSha);
  const paths = files.map((f) => f.path);
  const skipped: ScanResult["skipped"] = [];

  let candidates = files.filter((f) => isHtml(f.path) && !IGNORED.test(f.path));
  for (const f of candidates.filter((f) => /(^|\/)404\.html?$/i.test(f.path))) skipped.push({ path: f.path, reason: "error page" });
  candidates = candidates.filter((f) => !/(^|\/)404\.html?$/i.test(f.path));
  for (const f of candidates.filter((f) => f.size > LIMITS.maxFileBytes)) skipped.push({ path: f.path, reason: "file is too large" });
  candidates = candidates.filter((f) => f.size <= LIMITS.maxFileBytes);
  const truncated = candidates.length > LIMITS.maxFilesRead;
  candidates = candidates.slice(0, LIMITS.maxFilesRead);

  if (!candidates.length) {
    const pkg = paths.includes("package.json") ? await repo.readFile("package.json", info.headSha).catch(() => null) : null;
    return {
      repo: info, siteName: humanizeRepo(info.name), scanned: 0, proposals: [], deferred: 0, needsHuman: [],
      skipped, framework: detectFramework(pkg, paths) ?? "unknown", truncated: false,
    };
  }

  const contents = await Promise.all(candidates.map(async (f) => [f.path, await repo.readFile(f.path, info.headSha)] as const));
  const index = contents.find(([p]) => /^index\.html?$/i.test(p))?.[1] ?? null;
  const siteName = siteNameFrom(index, info.name);

  const analyzed: PageProposal[] = [];
  for (const [path, html] of contents) {
    const r = analyzePage(path, html, { siteName });
    if ("skipped" in r) skipped.push({ path, reason: r.skipped });
    else analyzed.push(r);
  }

  // site-wide findings that a person has to decide
  const notes = new Map<string, string[]>();
  const note = (m: string, p: string) => notes.set(m, [...(notes.get(m) ?? []), p]);
  for (const p of analyzed) for (const n of p.notes) note(n, p.path);
  const byTitle = new Map<string, string[]>();
  for (const p of analyzed) if (p.finalTitle) byTitle.set(p.finalTitle.toLowerCase(), [...(byTitle.get(p.finalTitle.toLowerCase()) ?? []), p.path]);
  for (const [, ps] of byTitle) if (ps.length > 1) note(`These pages share the same title, so each competes with the others: ${ps.join(", ")}`, ps[0]);
  const needsHuman = [...notes].map(([message, ps]) => ({ message, paths: ps })).sort((a, b) => b.paths.length - a.paths.length);

  const work = analyzed.filter((p) => p.edits.length).sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path));
  const max = opts.maxPages ?? LIMITS.maxPagesPerRun;
  return {
    repo: info, siteName, scanned: contents.length, proposals: work.slice(0, max), deferred: Math.max(0, work.length - max),
    needsHuman, skipped, framework: null, truncated,
  };
}

/* ---------- changes ---------- */

const stamp = (d: Date) =>
  d.toISOString().replace(/[-:T]/g, "").slice(0, 14) + Math.random().toString(16).slice(2, 5);

const FIELD_LABEL: Record<Field, string> = {
  title: "Title", description: "Description", "og:title": "Social title", "og:description": "Social description",
};

const cell = (s: string | null) => (s ? s.replace(/\|/g, "\\|").replace(/\n/g, " ") : "_none_");

export function renderPrBody(proposals: PageProposal[], extra = ""): string {
  const sections = proposals.map(
    (p) =>
      `### \`${p.path}\`\n\n| Field | Before | After | Written by |\n| --- | --- | --- | --- |\n` +
      p.edits.map((e) => `| ${FIELD_LABEL[e.field]} | ${cell(e.before)} | ${cell(e.after)} | ${e.source === "rules" ? "built-in rules" : `AI (${e.source})`} |`).join("\n")
  );
  return [
    MARKER,
    "Proposed by **Optimo Autopilot**. Nothing changes on the live site until this pull request is merged.",
    "",
    "Only the `<head>` of each page was edited; page content is untouched. To undo after merging, use **Undo** in the Optimo dashboard or revert this pull request.",
    extra,
    "",
    ...sections,
  ].filter((l) => l !== undefined).join("\n");
}

export type ApplyResult = { pr: PullRequest; applied: string[]; skipped: { path: string; reason: string }[] };

export async function propose(repo: RepoProvider, proposals: PageProposal[], now = new Date()): Promise<ApplyResult> {
  const info = await repo.info();
  if (!info.canWrite) {
    throw new RepoError(403, "This token can read the repository but not write to it. It needs Contents and Pull requests set to read and write.");
  }
  if (proposals.length > LIMITS.maxPagesPerRun) {
    throw new RepoError(422, `Change limit: at most ${LIMITS.maxPagesPerRun} pages per run.`);
  }
  const files: { path: string; content: string }[] = [];
  const done: PageProposal[] = [];
  const skipped: ApplyResult["skipped"] = [];

  for (const p of proposals) {
    const html = await repo.readFile(p.path, info.headSha);
    const now_ = readPage(html);
    const stale = p.edits.find((e) => (fieldValue(now_, e.field) ?? "") !== (e.before ?? ""));
    if (stale) {
      skipped.push({ path: p.path, reason: `${FIELD_LABEL[stale.field].toLowerCase()} changed since the scan; re-scan to continue` });
      continue;
    }
    try {
      files.push({ path: p.path, content: applyEdits(html, p.edits) });
      done.push(p);
    } catch (e: any) {
      skipped.push({ path: p.path, reason: e.message });
    }
  }
  if (!files.length) throw new RepoError(409, "Nothing could be applied: " + skipped.map((s) => `${s.path} (${s.reason})`).join("; "));

  const branch = `${BRANCH_PREFIX}autopilot-${stamp(now)}`;
  const title = `Optimo Autopilot: improve search snippets on ${files.length} page${files.length === 1 ? "" : "s"}`;
  await repo.createBranch(branch, info.headSha);
  await repo.commitFiles(branch, files, title);
  const pr = await repo.openPR({ branch, base: info.defaultBranch, title, body: renderPrBody(done) });
  return { pr, applied: files.map((f) => f.path), skipped };
}

/** The autopilot only ever acts on its own pull requests. */
async function ownPR(repo: RepoProvider, n: number): Promise<PullRequest> {
  const pr = await repo.getPR(n);
  if (!pr.branch.startsWith(BRANCH_PREFIX)) throw new RepoError(403, "That pull request was not created by Optimo Autopilot.");
  return pr;
}

export async function publish(repo: RepoProvider, n: number) {
  const pr = await ownPR(repo, n);
  if (pr.state !== "open") throw new RepoError(409, "That pull request is already closed.");
  return repo.mergePR(n);
}

export async function discard(repo: RepoProvider, n: number) {
  const pr = await ownPR(repo, n);
  if (pr.state !== "open") throw new RepoError(409, "That pull request is already closed.");
  return repo.closePR(n);
}

/** Open a pull request that puts the pre-change content back. Files edited by someone since are left alone. */
export async function undo(repo: RepoProvider, n: number, now = new Date()): Promise<ApplyResult> {
  const pr = await ownPR(repo, n);
  if (!pr.merged || !pr.mergeSha) throw new RepoError(409, "Only merged changes can be undone; discard an open one instead.");
  const info = await repo.info();
  if (!info.canWrite) throw new RepoError(403, "This token cannot write to the repository.");
  const before = await repo.parentOf(pr.mergeSha);
  const files: { path: string; content: string }[] = [];
  const skipped: ApplyResult["skipped"] = [];
  for (const path of await repo.prFiles(n)) {
    const [current, changed, original] = await Promise.all([
      repo.readFile(path, info.headSha), repo.readFile(path, pr.mergeSha), repo.readFile(path, before),
    ]);
    if (current !== changed) skipped.push({ path, reason: "edited again after the change, so it was left alone" });
    else files.push({ path, content: original });
  }
  if (!files.length) throw new RepoError(409, "Nothing to undo: " + (skipped.map((s) => `${s.path} ${s.reason}`).join("; ") || "no files changed"));
  const branch = `${BRANCH_PREFIX}undo-${n}-${stamp(now)}`;
  const title = `Undo Optimo Autopilot change #${n}`;
  await repo.createBranch(branch, info.headSha);
  await repo.commitFiles(branch, files, title);
  const body = [MARKER, `Restores the pages changed by #${n} to how they were before.`, "", ...files.map((f) => `- \`${f.path}\``)].join("\n");
  const out = await repo.openPR({ branch, base: info.defaultBranch, title, body });
  return { pr: out, applied: files.map((f) => f.path), skipped };
}

export type HistoryItem = PullRequest & { kind: "change" | "undo" };

export async function history(repo: RepoProvider): Promise<HistoryItem[]> {
  const prs = await repo.listPRs(BRANCH_PREFIX);
  return prs.map((p) => ({ ...p, kind: p.branch.startsWith(`${BRANCH_PREFIX}undo-`) ? "undo" : "change" }));
}
