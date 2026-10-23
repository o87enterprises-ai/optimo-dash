import { PullRequest, RepoError, RepoInfo, RepoProvider } from "./repo";

const API = "https://api.github.com";

function friendly(status: number, body: any, authed: boolean): string {
  const msg = body?.message ? String(body.message) : "";
  if (status === 401) return "GitHub rejected the token. Check that it was copied in full and has not expired.";
  if (status === 403 && /rate limit/i.test(msg)) {
    return authed
      ? "GitHub rate limit reached. Wait a few minutes and try again."
      : "GitHub rate limit reached for anonymous use. Add a token to continue.";
  }
  if (status === 403) return `GitHub says this token is not allowed to do that (${msg || "forbidden"}). It needs Contents and Pull requests set to read and write.`;
  if (status === 404) return authed
    ? "Repository not found, or the token has no access to it."
    : "Repository not found. If it is private, add a token.";
  if (status === 409 || status === 422) return `GitHub refused the change: ${msg || status}`;
  return `GitHub error ${status}${msg ? `: ${msg}` : ""}`;
}


export class GitHubRepo implements RepoProvider {
  constructor(private owner: string, private repo: string, private token?: string, private fetchImpl: typeof fetch = (input, init) => fetch(input, init)) {}
  // the default is a closure on purpose: browsers throw "Illegal invocation" when window.fetch is called as a method of another object

  private async gh<T = any>(path: string, init: RequestInit & { raw?: boolean } = {}): Promise<T> {
    const { raw, ...rest } = init;
    const res = await this.fetchImpl(`${API}${path}`, {
      ...rest,
      headers: {
        Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(rest.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new RepoError(res.status, friendly(res.status, body, !!this.token));
    }
    if (res.status === 204) return undefined as T;
    return (raw ? await res.text() : await res.json()) as T;
  }

  private base = () => `/repos/${this.owner}/${this.repo}`;

  async info(): Promise<RepoInfo> {
    const r = await this.gh(this.base());
    const ref = await this.gh(`${this.base()}/git/ref/heads/${encodeURIComponent(r.default_branch)}`);
    return {
      name: r.full_name,
      defaultBranch: r.default_branch,
      headSha: ref.object.sha,
      canWrite: !!r.permissions?.push,
      url: r.html_url,
    };
  }

  async listFiles(ref: string) {
    const t = await this.gh(`${this.base()}/git/trees/${ref}?recursive=1`);
    return (t.tree as any[]).filter((e) => e.type === "blob").map((e) => ({ path: e.path as string, size: (e.size ?? 0) as number }));
  }

  readFile(path: string, ref: string) {
    const enc = path.split("/").map(encodeURIComponent).join("/");
    return this.gh<string>(`${this.base()}/contents/${enc}?ref=${encodeURIComponent(ref)}`, { raw: true });
  }

  async createBranch(name: string, fromSha: string) {
    await this.gh(`${this.base()}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${name}`, sha: fromSha }) });
  }

  async commitFiles(branch: string, files: { path: string; content: string }[], message: string) {
    const ref = await this.gh(`${this.base()}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`);
    const parent = await this.gh(`${this.base()}/git/commits/${ref.object.sha}`);
    const tree = await this.gh(`${this.base()}/git/trees`, {
      method: "POST",
      body: JSON.stringify({
        base_tree: parent.tree.sha,
        tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
      }),
    });
    const commit = await this.gh(`${this.base()}/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }),
    });
    await this.gh(`${this.base()}/git/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha }),
    });
    return commit.sha as string;
  }

  private toPR(p: any): PullRequest {
    return {
      number: p.number,
      title: p.title,
      url: p.html_url,
      branch: p.head.ref,
      state: p.state,
      merged: !!p.merged || !!p.merged_at,
      mergeSha: p.merge_commit_sha ?? null,
      createdAt: p.created_at,
      mergedAt: p.merged_at ?? null,
    };
  }

  async openPR(a: { branch: string; base: string; title: string; body: string }) {
    const p = await this.gh(`${this.base()}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title: a.title, head: a.branch, base: a.base, body: a.body }),
    });
    return this.toPR(p);
  }

  async getPR(n: number) {
    return this.toPR(await this.gh(`${this.base()}/pulls/${n}`));
  }

  async listPRs(prefix: string) {
    const list = await this.gh<any[]>(`${this.base()}/pulls?state=all&per_page=50&sort=created&direction=desc`);
    return list.filter((p) => String(p.head?.ref).startsWith(prefix)).map((p) => this.toPR(p));
  }

  async prFiles(n: number) {
    const files = await this.gh<any[]>(`${this.base()}/pulls/${n}/files?per_page=100`);
    return files.filter((f) => f.status === "modified" || f.status === "changed").map((f) => f.filename as string);
  }

  async mergePR(n: number) {
    // GitHub works out mergeability in the background; a brand-new PR can answer 405 for a moment
    for (let attempt = 0; ; attempt++) {
      try {
        await this.gh(`${this.base()}/pulls/${n}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash" }) });
        break;
      } catch (e: any) {
        if (attempt >= 3 || !(e instanceof RepoError) || !/\b405\b/.test(e.message)) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    return this.getPR(n);
  }

  async closePR(n: number) {
    await this.gh(`${this.base()}/pulls/${n}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
    return this.getPR(n);
  }

  async parentOf(sha: string) {
    const c = await this.gh(`${this.base()}/commits/${sha}`);
    return c.parents[0].sha as string;
  }
}
