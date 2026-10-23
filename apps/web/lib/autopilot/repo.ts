// The one interface the autopilot engine needs from a code host. GitHub is the first
// implementation; GitLab, Bitbucket or a local folder can be added without touching the engine.

export type RepoInfo = {
  name: string; // owner/name
  defaultBranch: string;
  headSha: string;
  canWrite: boolean;
  url: string;
};

export type PullRequest = {
  number: number;
  title: string;
  url: string;
  branch: string;
  state: "open" | "closed";
  merged: boolean;
  mergeSha: string | null;
  createdAt: string;
  mergedAt: string | null;
};

export interface RepoProvider {
  info(): Promise<RepoInfo>;
  listFiles(ref: string): Promise<{ path: string; size: number }[]>;
  readFile(path: string, ref: string): Promise<string>;
  /** ref may be a branch, a tag or a commit sha */
  createBranch(name: string, fromSha: string): Promise<void>;
  /** one commit containing every file; returns the new commit sha */
  commitFiles(branch: string, files: { path: string; content: string }[], message: string): Promise<string>;
  openPR(args: { branch: string; base: string; title: string; body: string }): Promise<PullRequest>;
  getPR(number: number): Promise<PullRequest>;
  listPRs(prefix: string): Promise<PullRequest[]>;
  prFiles(number: number): Promise<string[]>;
  mergePR(number: number): Promise<PullRequest>;
  closePR(number: number): Promise<PullRequest>;
  /** first parent of a commit: what the code looked like before it */
  parentOf(sha: string): Promise<string>;
}

export class RepoError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function parseRepo(input: string): { owner: string; repo: string } | null {
  const m = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  return m ? { owner: m[1], repo: m[2] } : null;
}
