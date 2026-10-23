import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCopy, copyRequests, mergeAiCopy, parseCopyJson } from "./ai";
import { briefError, copyWithFallback } from "./fallback";
import { discard, history, propose, publish, scan, undo } from "./engine";
import { onlyHeadChanged, readPage, setMeta, setTitle } from "./html";
import { DEMO_FILES, MemoryRepo } from "./memory";
import { applyEdits, shortenTitle, summarize, validateCopy } from "./rules";

const demo = () => new MemoryRepo({ ...DEMO_FILES });

test("html: setTitle / setMeta edit only the head and read back", () => {
  const html = DEMO_FILES["services.html"];
  let out = setTitle(html, "Dental Services | Brightside Dental");
  out = setMeta(out, "property", "og:title", 'Dental "Services" & more');
  assert.ok(onlyHeadChanged(html, out));
  const info = readPage(out);
  assert.equal(info.title, "Dental Services | Brightside Dental");
  assert.equal(info.ogTitle, 'Dental "Services" & more');
  assert.match(out, /<title>Dental Services/);
});

test("html: existing description is replaced in place, not duplicated", () => {
  const html = DEMO_FILES["contact.html"];
  const out = setMeta(html, "name", "description", "New text that is long enough to read back properly here.");
  assert.equal((out.match(/name="description"/g) ?? []).length, 1);
  assert.equal(readPage(out).description, "New text that is long enough to read back properly here.");
});

test("rules: title shortening and summaries respect limits", () => {
  const long = "About Brightside Dental - Meet Our Team of Experienced Dentists and Hygienists Serving Springfield Families";
  assert.ok(shortenTitle(long).length <= 60);
  assert.ok(summarize("word ".repeat(80)).length <= 160);
});

test("scan: demo site finds the planted problems and skips what it should", async () => {
  const r = await scan(demo());
  const by = Object.fromEntries(r.proposals.map((p) => [p.path, p]));
  assert.equal(r.siteName, "Brightside Dental");
  assert.ok(by["services.html"].edits.some((e) => e.field === "title" && e.before === null));
  assert.ok(by["index.html"].edits.some((e) => e.field === "description"));
  assert.ok(by["about.html"].edits.some((e) => e.field === "title"));
  assert.ok(r.proposals.length <= 5);
  const reasons = Object.fromEntries(r.skipped.map((s) => [s.path, s.reason]));
  assert.match(reasons["admin/preview.html"], /noindex/);
  assert.match(reasons["partials/header.html"], /no <head>/);
  assert.ok(r.needsHuman.length > 0);
});

test("flow: propose -> publish -> undo restores the original files byte for byte", async () => {
  const repo = demo();
  const s = await scan(repo);
  const res = await propose(repo, s.proposals);
  assert.ok(res.pr.branch.startsWith("optimo/"));
  assert.equal((await repo.info()).headSha, s.repo.headSha, "nothing is live before publishing");

  const merged = await publish(repo, res.pr.number);
  assert.ok(merged.merged);
  const live = await repo.readFile("services.html", (await repo.info()).headSha);
  assert.ok(readPage(live).title);

  const u = await undo(repo, res.pr.number);
  await publish(repo, u.pr.number);
  for (const path of res.applied) {
    assert.equal(await repo.readFile(path, (await repo.info()).headSha), DEMO_FILES[path], path);
  }
  const h = await history(repo);
  assert.deepEqual(h.map((x) => x.kind), ["undo", "change"]);
});

test("guardrails: change cap, discard, and undo only after merge", async () => {
  const repo = demo();
  const s = await scan(repo);
  await assert.rejects(propose(repo, [...s.proposals, ...s.proposals]), /at most 5/);
  await assert.rejects(publish(repo, 99), /not found/);
  const res = await propose(repo, s.proposals);
  await discard(repo, res.pr.number);
  assert.equal((await repo.getPR(res.pr.number)).state, "closed");
  await assert.rejects(undo(repo, res.pr.number), /Only merged/);
  await assert.rejects(publish(repo, res.pr.number), /already closed/);
});

test("guardrails: a page edited after the scan is skipped, not overwritten", async () => {
  const repo = demo();
  const s = await scan(repo);
  const head = (await repo.info()).headSha;
  await repo.createBranch("optimo/other", head);
  await repo.commitFiles("optimo/other", [{ path: "about.html", content: DEMO_FILES["about.html"].replace("About us.", "Changed by a person, long enough.") }], "x");
  const pr = await repo.openPR({ branch: "optimo/other", base: "main", title: "x", body: "" });
  await repo.mergePR(pr.number);
  const res = await propose(repo, s.proposals);
  assert.ok(res.skipped.some((x) => x.path === "about.html" && /changed since the scan/.test(x.reason)));
  assert.ok(!res.applied.includes("about.html"));
});

test("guardrails: a pull request not made by the autopilot cannot be merged", async () => {
  const repo = demo();
  const head = (await repo.info()).headSha;
  await repo.createBranch("feature/x", head);
  await repo.commitFiles("feature/x", [{ path: "index.html", content: DEMO_FILES["index.html"] + " " }], "x");
  const pr = await repo.openPR({ branch: "feature/x", base: "main", title: "human PR", body: "" });
  await assert.rejects(publish(repo, pr.number), /not created by Optimo/);
});

test("ai: copy is validated before it is accepted", () => {
  const req = {
    path: "services.html", siteName: "Brightside Dental",
    context: { h1: "Our Dental Services", excerpt: "We offer routine check-ups, cleanings and whitening since 2008.", title: null, description: null },
    wants: ["title", "description"] as ("title" | "description")[],
  };
  const good = checkCopy(req, '```json\n{"title":"Dental Services in Springfield | Brightside Dental","description":"Check-ups, professional cleanings and teeth whitening from a friendly practice that has cared for families since 2008, with emergencies seen daily."}\n```');
  assert.equal(good.error, undefined);
  const invented = checkCopy(req, '{"title":"Dental Services | Brightside Dental","description":"Check-ups and whitening from only $49 with a 25 year guarantee on every single procedure we carry out for you."}');
  assert.match(invented.error!, /introduces/);
  assert.equal(invented.title, "Dental Services | Brightside Dental");
  assert.match(checkCopy(req, "sorry, I cannot help").error!, /JSON/);
  assert.equal(validateCopy("title", "Too short", ""), "title must be 15-60 characters (got 9)");
  assert.equal(parseCopyJson("no json here"), null);
});

test("ai: accepted copy replaces rules copy and flows into the social tags", async () => {
  const s = await scan(demo());
  const reqs = copyRequests(s.proposals, s.siteName);
  const services = reqs.find((r) => r.path === "services.html")!;
  assert.deepEqual(services.wants, ["title"]);
  const merged = mergeAiCopy(s.proposals, [{ path: "services.html", title: "Dental Services in Springfield | Brightside Dental" }], "groq");
  const p = merged.find((x) => x.path === "services.html")!;
  assert.equal(p.edits.find((e) => e.field === "title")!.after, "Dental Services in Springfield | Brightside Dental");
  assert.equal(p.edits.find((e) => e.field === "title")!.source, "groq");
  assert.equal(p.edits.find((e) => e.field === "og:title")!.after, "Dental Services in Springfield | Brightside Dental");
  const html = applyEdits(DEMO_FILES["services.html"], p.edits);
  assert.equal(readPage(html).title, "Dental Services in Springfield | Brightside Dental");
});

test("fallback: a failing provider is skipped and the next one finishes the run", async () => {
  const pages = ["a.html", "b.html"].map((path) => ({
    path, siteName: "Brightside Dental", wants: ["title" as const],
    context: { h1: "Our Dental Services", excerpt: "We offer check-ups.", title: null, description: null },
  }));
  const calls: string[] = [];
  const { results, failures } = await copyWithFallback(["nvidia", "gemini"], pages, async (id) => {
    calls.push(id);
    if (id === "nvidia") throw new Error('HTTP 410: {"detail":"The model has reached its end of life"}');
    return '{"title":"Our Dental Services | Brightside Dental"}';
  });
  assert.deepEqual(calls, ["nvidia", "gemini", "gemini"], "a failed provider is not retried on later pages");
  assert.deepEqual(results.map((r) => r.provider), ["gemini", "gemini"]);
  assert.equal(failures.length, 1);
  assert.match(failures[0].error, /end of life.*List models/);
});

test("fallback: when every provider fails, pages report the error and keep built-in copy", async () => {
  const pages = [{ path: "a.html", siteName: null, wants: ["title" as const], context: { h1: null, excerpt: null, title: null, description: null } }];
  const { results } = await copyWithFallback(["x"], pages, async () => { throw new Error("HTTP 429: slow down"); });
  assert.match(results[0].error!, /rate limit/);
  assert.equal(results[0].title, undefined);
});

test("fallback: an invalid reply does not count as a provider failure", async () => {
  const pages = [{ path: "a.html", siteName: null, wants: ["title" as const], context: { h1: "x", excerpt: "y", title: null, description: null } }];
  const calls: string[] = [];
  const { results, failures } = await copyWithFallback(["one", "two"], pages, async (id) => { calls.push(id); return "not json"; });
  assert.deepEqual(calls, ["one"]);
  assert.equal(failures.length, 0);
  assert.match(results[0].error!, /JSON/);
});

test("briefError: unwraps JSON error bodies and hides nothing important", () => {
  assert.match(briefError('HTTP 401: {"error":{"message":"bad"}}'), /key was rejected/);
  assert.equal(briefError("fetch failed"), "fetch failed");
  assert.match(briefError('HTTP 404: {"message":"model not found"}'), /model not found.*List models/);
});
