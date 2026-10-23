import assert from "node:assert/strict";
import { test } from "node:test";
import { history, propose, publish, scan, undo } from "./engine";
import { GitHubRepo } from "./github";
import { DEMO_FILES } from "./memory";

/** A stand-in for api.github.com that follows the documented REST shapes the connector uses. */
function fakeGitHub(files: Record<string, string>) {
  const commits = new Map<string, { parent: string | null; tree: string; msg: string }>();
  const trees = new Map<string, Record<string, string>>();
  const refs = new Map<string, string>();
  const forks = new Map<string, string>();
  const prs: any[] = [];
  let n = 0;
  const id = (p: string) => `${p}${(++n).toString(16).padStart(6, "0")}`;
  const t0 = id("t"); trees.set(t0, { ...files });
  const c0 = id("c"); commits.set(c0, { parent: null, tree: t0, msg: "init" }); refs.set("main", c0);
  const calls: string[] = [];
  const j = (v: any, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

  const impl: typeof fetch = async (input, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const m = init.method ?? "GET";
    const path = decodeURIComponent(url.pathname).replace("/repos/o/r", "");
    const body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push(`${m} ${path}`);
    const auth = (init.headers as Record<string, string>)?.Authorization;
    if (!auth && m !== "GET") return j({ message: "Requires authentication" }, 401);
    const tree = (sha: string) => trees.get(commits.get(sha)!.tree)!;
    const headOf = (name: string) => refs.get(name)!;
    let mt: RegExpMatchArray | null;

    if (m === "GET" && path === "") return j({ full_name: "o/r", default_branch: "main", html_url: "https://github.com/o/r", permissions: { push: true } });
    if (m === "GET" && (mt = path.match(/^\/git\/ref\/heads\/(.+)$/))) return refs.has(mt[1]) ? j({ object: { sha: headOf(mt[1]) } }) : j({ message: "Not Found" }, 404);
    if (m === "GET" && (mt = path.match(/^\/git\/trees\/(.+)$/))) {
      const sha = commits.has(mt[1]) ? mt[1] : headOf(mt[1]);
      return j({ tree: Object.entries(tree(sha)).map(([p, c]) => ({ path: p, type: "blob", size: c.length })) });
    }
    if (m === "GET" && (mt = path.match(/^\/contents\/(.+)$/))) {
      assert.match(String((init.headers as any).Accept), /raw/);
      const ref = url.searchParams.get("ref")!;
      const sha = commits.has(ref) ? ref : headOf(ref);
      const c = tree(sha)[mt[1]];
      return c === undefined ? j({ message: "Not Found" }, 404) : new Response(c);
    }
    if (m === "POST" && path === "/git/refs") { const name = body.ref.replace("refs/heads/", ""); refs.set(name, body.sha); forks.set(name, body.sha); return j({}, 201); }
    if (m === "GET" && (mt = path.match(/^\/git\/commits\/(.+)$/))) return j({ tree: { sha: commits.get(mt[1])!.tree } });
    if (m === "POST" && path === "/git/trees") {
      const next = { ...trees.get(body.base_tree)! };
      for (const e of body.tree) { assert.equal(e.mode, "100644"); next[e.path] = e.content; }
      const sha = id("t"); trees.set(sha, next); return j({ sha }, 201);
    }
    if (m === "POST" && path === "/git/commits") { const sha = id("c"); commits.set(sha, { parent: body.parents[0], tree: body.tree, msg: body.message }); return j({ sha }, 201); }
    if (m === "PATCH" && (mt = path.match(/^\/git\/refs\/heads\/(.+)$/))) { refs.set(mt[1], body.sha); return j({}); }
    if (m === "POST" && path === "/pulls") {
      const pr = { number: prs.length + 1, title: body.title, html_url: `https://github.com/o/r/pull/${prs.length + 1}`, head: { ref: body.head }, base: body.base, state: "open", merged_at: null, merge_commit_sha: null, created_at: new Date().toISOString(), forkBase: forks.get(body.head)! };
      prs.push(pr); return j(pr, 201);
    }
    if (m === "GET" && path === "/pulls") return j([...prs].reverse().map(({ forkBase, ...p }) => p));
    if (m === "GET" && (mt = path.match(/^\/pulls\/(\d+)$/))) { const { forkBase, ...p } = prs[+mt[1] - 1]; return j({ ...p, merged: !!p.merged_at }); }
    if (m === "GET" && (mt = path.match(/^\/pulls\/(\d+)\/files$/))) {
      const p = prs[+mt[1] - 1]; const base = tree(p.forkBase), cur = tree(headOf(p.head.ref));
      return j(Object.keys(cur).filter((f) => base[f] !== cur[f]).map((f) => ({ filename: f, status: "modified" })));
    }
    if (m === "PUT" && (mt = path.match(/^\/pulls\/(\d+)\/merge$/))) {
      assert.equal(body.merge_method, "squash");
      const p = prs[+mt[1] - 1]; const base = headOf("main"); const next = { ...tree(base) };
      const old = tree(p.forkBase), cur = tree(headOf(p.head.ref));
      for (const f of Object.keys(cur)) if (old[f] !== cur[f]) next[f] = cur[f];
      const t = id("t"); trees.set(t, next); const c = id("c"); commits.set(c, { parent: base, tree: t, msg: p.title }); refs.set("main", c);
      p.state = "closed"; p.merged_at = new Date().toISOString(); p.merge_commit_sha = c; return j({ merged: true });
    }
    if (m === "GET" && (mt = path.match(/^\/commits\/(.+)$/))) return j({ parents: [{ sha: commits.get(mt[1])!.parent }] });
    return j({ message: `unhandled ${m} ${path}` }, 500);
  };
  return { impl, calls, head: () => refs.get("main")!, file: (p: string) => tree_(trees, commits, refs.get("main")!)[p] };
}
const tree_ = (trees: Map<string, Record<string, string>>, commits: Map<string, { tree: string }>, sha: string) => trees.get(commits.get(sha)!.tree)!;

test("github connector: scan, propose, publish and undo through the REST API", async () => {
  const gh = fakeGitHub({ ...DEMO_FILES });
  const repo = new GitHubRepo("o", "r", "tok", gh.impl);
  const s = await scan(repo);
  assert.equal(s.repo.name, "o/r");
  assert.ok(s.proposals.length > 0);

  const res = await propose(repo, s.proposals);
  assert.ok(res.pr.branch.startsWith("optimo/autopilot-"));
  assert.equal(gh.head(), s.repo.headSha, "main untouched until publish");

  await publish(repo, res.pr.number);
  assert.notEqual(gh.head(), s.repo.headSha);
  assert.notEqual(gh.file("services.html"), DEMO_FILES["services.html"]);

  const u = await undo(repo, res.pr.number);
  await publish(repo, u.pr.number);
  for (const p of res.applied) assert.equal(gh.file(p), DEMO_FILES[p], p);
  assert.deepEqual((await history(repo)).map((h) => h.kind), ["undo", "change"]);
});

test("github connector: friendly errors and no writes without a token", async () => {
  const gh = fakeGitHub({ ...DEMO_FILES });
  const anon = new GitHubRepo("o", "r", undefined, gh.impl);
  const s = await scan(anon);
  await assert.rejects(propose(anon, s.proposals), /Requires authentication|token/);
  const limited = new GitHubRepo("o", "r", undefined, async () => new Response(JSON.stringify({ message: "API rate limit exceeded" }), { status: 403 }));
  await assert.rejects(limited.info(), /rate limit.*token/i);
  const missing = new GitHubRepo("o", "r", "tok", async () => new Response("{}", { status: 404 }));
  await assert.rejects(missing.info(), /not found/i);
});

test("github connector: the default fetch is not called as a method of the repo (browsers reject that)", async () => {
  const realFetch = globalThis.fetch;
  let thisSeen: unknown = "not called";
  globalThis.fetch = function (this: unknown) {
    thisSeen = this;
    return Promise.resolve(new Response(JSON.stringify({ default_branch: "main", visibility: "public" }), { status: 200 }));
  } as any;
  try {
    await new GitHubRepo("o", "r").info().catch(() => {});
    assert.ok(thisSeen === undefined || thisSeen === globalThis, `fetch was called with this=${String(thisSeen)}`);
  } finally {
    globalThis.fetch = realFetch;
  }
});
