import { PullRequest, RepoError, RepoInfo, RepoProvider } from "./repo";

type Commit = { parent: string | null; files: Record<string, string>; message: string };

/** A tiny in-memory "GitHub" so the whole flow can be tried without a repo or a token. */
export class MemoryRepo implements RepoProvider {
  private commits = new Map<string, Commit>();
  private branches = new Map<string, string>();
  private forkPoint = new Map<string, string>();
  private prs: (PullRequest & { base: string })[] = [];
  private n = 0;

  constructor(files: Record<string, string>, private name = "demo/brightside-dental", private defaultBranch = "main") {
    const sha = this.newSha();
    this.commits.set(sha, { parent: null, files: { ...files }, message: "Initial site" });
    this.branches.set(defaultBranch, sha);
  }

  private newSha() {
    return `m${(++this.n).toString(16).padStart(7, "0")}`;
  }

  private resolve(ref: string): string {
    const sha = this.branches.get(ref) ?? (this.commits.has(ref) ? ref : undefined);
    if (!sha) throw new RepoError(404, `unknown ref ${ref}`);
    return sha;
  }

  private snapshot(ref: string) {
    return this.commits.get(this.resolve(ref))!.files;
  }

  async info(): Promise<RepoInfo> {
    return { name: this.name, defaultBranch: this.defaultBranch, headSha: this.resolve(this.defaultBranch), canWrite: true, url: "#demo" };
  }

  async listFiles(ref: string) {
    return Object.entries(this.snapshot(ref)).map(([path, c]) => ({ path, size: c.length }));
  }

  async readFile(path: string, ref: string) {
    const c = this.snapshot(ref)[path];
    if (c === undefined) throw new RepoError(404, `${path} not found`);
    return c;
  }

  async createBranch(name: string, fromSha: string) {
    if (this.branches.has(name)) throw new RepoError(422, "branch exists");
    this.branches.set(name, this.resolve(fromSha));
    this.forkPoint.set(name, this.resolve(fromSha));
  }

  async commitFiles(branch: string, files: { path: string; content: string }[], message: string) {
    const parent = this.resolve(branch);
    const next = { ...this.commits.get(parent)!.files };
    for (const f of files) next[f.path] = f.content;
    const sha = this.newSha();
    this.commits.set(sha, { parent, files: next, message });
    this.branches.set(branch, sha);
    return sha;
  }

  private changed(branch: string): string[] {
    const base = this.commits.get(this.forkPoint.get(branch)!)!.files;
    const cur = this.snapshot(branch);
    return Object.keys(cur).filter((p) => base[p] !== undefined && base[p] !== cur[p]);
  }

  async openPR(a: { branch: string; base: string; title: string; body: string }) {
    const pr = {
      number: this.prs.length + 1, title: a.title, url: `#demo-pr-${this.prs.length + 1}`, branch: a.branch,
      state: "open" as const, merged: false, mergeSha: null, createdAt: new Date().toISOString(), mergedAt: null, base: a.base,
    };
    this.prs.push(pr);
    return { ...pr };
  }

  private pr(n: number) {
    const p = this.prs.find((x) => x.number === n);
    if (!p) throw new RepoError(404, "pull request not found");
    return p;
  }

  async getPR(n: number) {
    return { ...this.pr(n) };
  }

  async listPRs(prefix: string) {
    return this.prs.filter((p) => p.branch.startsWith(prefix)).map((p) => ({ ...p })).reverse();
  }

  async prFiles(n: number) {
    return this.changed(this.pr(n).branch);
  }

  async mergePR(n: number) {
    const p = this.pr(n);
    if (p.state !== "open") throw new RepoError(409, "pull request is not open");
    const head = this.resolve(p.base);
    const next = { ...this.commits.get(head)!.files };
    const cur = this.snapshot(p.branch);
    for (const path of this.changed(p.branch)) next[path] = cur[path];
    const sha = this.newSha();
    this.commits.set(sha, { parent: head, files: next, message: p.title });
    this.branches.set(p.base, sha);
    p.state = "closed";
    p.merged = true;
    p.mergeSha = sha;
    p.mergedAt = new Date().toISOString();
    return { ...p };
  }

  async closePR(n: number) {
    const p = this.pr(n);
    p.state = "closed";
    return { ...p };
  }

  async parentOf(sha: string) {
    const c = this.commits.get(this.resolve(sha));
    if (!c?.parent) throw new RepoError(404, "no parent");
    return c.parent;
  }
}

/* ---------- demo site: a made-up dental practice with the usual SEO problems ---------- */

const page = (head: string, body: string, lang = ' lang="en"') =>
  `<!DOCTYPE html>\n<html${lang}>\n<head>\n  <meta charset="utf-8">\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

const nav = `  <nav><a href="/">Home</a> <a href="/services.html">Services</a> <a href="/about.html">About</a> <a href="/contact.html">Contact</a></nav>`;

export const DEMO_FILES: Record<string, string> = {
  "index.html": page(
    `  <title>Brightside Dental</title>`,
    `${nav}\n  <h1>Gentle family dentistry in Springfield</h1>\n  <p>Brightside Dental has cared for Springfield families since 2008, offering check-ups, cleanings, fillings and whitening in a calm, friendly office with evening appointments.</p>`
  ),
  "services.html": page(
    `  <meta name="description" content="Dental services at Brightside Dental: check-ups and cleanings, fillings, crowns, teeth whitening and emergency visits for children and adults in Springfield.">`,
    `${nav}\n  <h1>Our Dental Services</h1>\n  <p>We offer routine check-ups, professional cleanings, tooth-coloured fillings, crowns and teeth whitening, and we keep time free each day for dental emergencies.</p>`
  ),
  "about.html": page(
    `  <title>About Brightside Dental - Meet Our Team of Experienced Dentists and Hygienists Serving Springfield Families</title>\n  <meta name="description" content="About us.">`,
    `${nav}\n  <h1>About Brightside Dental</h1>\n  <p>Our small team of dentists and hygienists has treated three generations of Springfield families, and we focus on explaining every step so that nobody feels rushed or surprised.</p>`
  ),
  "contact.html": page(
    `  <title>Contact Brightside Dental | Springfield</title>\n  <meta name="description" content="Book an appointment or ask a question. Call, email or use the form and the Brightside Dental front desk will get back to you within one working day.">`,
    `${nav}\n  <h1>Contact us</h1>\n  <p>Call the front desk, email us or send the form below and we will reply within one working day to confirm your appointment.</p>`
  ),
  "blog/whitening-guide.html": page(
    `  <title>Teeth Whitening Guide | Brightside Dental</title>\n  <meta name="description" content="Everything you need to know about teeth whitening, including how in-office and take-home whitening differ, how long results usually last, who should avoid it and what to do about sensitivity afterwards, explained simply.">`,
    `${nav}\n  <h1>A simple guide to teeth whitening</h1>\n  <p>Whitening lightens stains on the outside of your teeth, and the right method depends on how sensitive your teeth are and how quickly you want results.</p>`
  ),
  "admin/preview.html": page(
    `  <title>Preview</title>\n  <meta name="robots" content="noindex">`,
    `  <h1>Internal preview</h1>\n  <p>This page is only for staff and should never appear in search results at all.</p>`
  ),
  "partials/header.html": `<header><a href="/">Brightside Dental</a></header>\n`,
};
