import "./env";
import express from "express";
import type { Request, Response, NextFunction } from "express";

import { pg, redis } from "./db";
import { streamHandler } from "./stream";
import { probeLLM, modelStatus, enabledModels, ALL_MODELS } from "./probes/llm";
import { syncGSC, gscStatus } from "./connectors/gsc";
import { syncBacklinks, backlinkStatus } from "./connectors/backlinks";
import { syncReviews, syncCitations, reviewStatus } from "./connectors/reviews";
import { syncRegional, getRegional } from "./connectors/regional";
import { runClone } from "./clone";
import { generateDebrief, debriefToMarkdown } from "./debrief";
import type { DebriefScope, LlmModel, RegionalMetricName } from "../../../shared/types";

const app = express();
app.use(express.json());

/**
 * Wraps an async route so a rejected promise becomes a 500 instead of an
 * unhandled rejection that takes the process down.
 */
function route(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

/** Parses and validates a :id path param. */
function siteId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "invalid site id");
  return id;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/* ---------- Health & capabilities ---------- */

app.get("/health", route(async (_req, res) => {
  const [db, cache] = await Promise.all([
    pg.query("SELECT 1").then((r) => r.rowCount === 1).catch(() => false),
    redis.ping().then((p) => p === "PONG").catch(() => false),
  ]);
  res.json({ ok: db && cache, db, redis: cache });
}));

/**
 * Which connectors are live. The GUI greys out a card whose connector is
 * disabled and shows `reason` as the "add key to enable" hint.
 */
app.get("/api/connectors", (_req, res) => {
  res.json({
    llm: modelStatus(),
    gsc: gscStatus(),
    backlinks: backlinkStatus(),
    reviews: reviewStatus(),
  });
});

/* ---------- Sites ---------- */

app.get("/api/sites", route(async (_req, res) => {
  const { rows } = await pg.query("SELECT * FROM sites ORDER BY created_at DESC");
  res.json(rows);
}));

app.post("/api/sites", route(async (req, res) => {
  let { domain, name } = req.body ?? {};
  if (!domain || typeof domain !== "string") throw new HttpError(400, "domain is required");
  domain = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!domain.includes(".")) throw new HttpError(400, "domain must look like example.com");

  try {
    const { rows } = await pg.query(
      "INSERT INTO sites (domain, name) VALUES ($1, $2) RETURNING *",
      [domain, name || domain]
    );
    res.status(201).json(rows[0]);
  } catch (e: any) {
    if (e.code === "23505") throw new HttpError(409, "site already exists");
    throw e;
  }
}));

app.delete("/api/sites/:id", route(async (req, res) => {
  await pg.query("DELETE FROM sites WHERE id = $1", [siteId(req)]);
  res.status(204).end();
}));

/** Everything the Overview tab needs, in one round trip. */
app.get("/api/sites/:id/summary", route(async (req, res) => {
  const id = siteId(req);
  const [site, kw, geo, bl, rv, ct] = await Promise.all([
    pg.query("SELECT * FROM sites WHERE id = $1", [id]),
    pg.query("SELECT COUNT(*)::int AS n, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions, AVG(position)::float AS avg_position FROM keywords WHERE site_id = $1", [id]),
    pg.query("SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE cited)::int AS cited FROM geo_prompts WHERE site_id = $1", [id]),
    pg.query("SELECT COUNT(*) FILTER (WHERE NOT lost)::int AS live, COUNT(*) FILTER (WHERE lost)::int AS lost FROM backlinks WHERE site_id = $1", [id]),
    pg.query("SELECT COUNT(*)::int AS n, AVG(sentiment)::float AS sentiment, AVG(rating)::float AS rating FROM reviews WHERE site_id = $1", [id]),
    pg.query("SELECT COUNT(*)::int AS n, AVG(authority)::float AS authority FROM citations WHERE site_id = $1", [id]),
  ]);
  if (!site.rows.length) throw new HttpError(404, "site not found");

  const g = geo.rows[0];
  res.json({
    site: site.rows[0],
    seo: kw.rows[0],
    geo: { ...g, visibility: g.n ? Math.round((g.cited / g.n) * 100) : 0 },
    backlinks: bl.rows[0],
    reviews: rv.rows[0],
    citations: ct.rows[0],
    updated: new Date().toISOString(),
  });
}));

/* ---------- Per-site data ---------- */

app.get("/api/sites/:id/rank", route(async (req, res) => {
  const { rows } = await pg.query(
    "SELECT * FROM keywords WHERE site_id = $1 ORDER BY position NULLS LAST LIMIT 200",
    [siteId(req)]
  );
  res.json({ keywords: rows, updated: new Date().toISOString() });
}));

app.get("/api/sites/:id/geo", route(async (req, res) => {
  const { rows } = await pg.query(
    "SELECT * FROM geo_prompts WHERE site_id = $1 ORDER BY updated_at DESC LIMIT 200",
    [siteId(req)]
  );
  const cited = rows.filter((r) => r.cited).length;

  // Per-model breakdown, so the GUI can show which engine we are losing on.
  const byModel: Record<string, { total: number; cited: number; visibility: number }> = {};
  for (const r of rows) {
    byModel[r.model] ??= { total: 0, cited: 0, visibility: 0 };
    byModel[r.model].total++;
    if (r.cited) byModel[r.model].cited++;
  }
  for (const m of Object.values(byModel)) {
    m.visibility = m.total ? Math.round((m.cited / m.total) * 100) : 0;
  }

  res.json({
    prompts: rows,
    visibility: rows.length ? Math.round((cited / rows.length) * 100) : 0,
    byModel,
    models: modelStatus(),
  });
}));

app.get("/api/sites/:id/backlinks", route(async (req, res) => {
  const { rows } = await pg.query(
    "SELECT * FROM backlinks WHERE site_id = $1 ORDER BY domain_authority DESC NULLS LAST, created_at DESC LIMIT 200",
    [siteId(req)]
  );
  res.json({ backlinks: rows });
}));

app.get("/api/sites/:id/reviews", route(async (req, res) => {
  const { rows } = await pg.query(
    "SELECT * FROM reviews WHERE site_id = $1 ORDER BY posted_at DESC NULLS LAST LIMIT 200",
    [siteId(req)]
  );
  res.json({ reviews: rows, sources: reviewStatus() });
}));

app.get("/api/sites/:id/citations", route(async (req, res) => {
  const { rows } = await pg.query(
    "SELECT * FROM citations WHERE site_id = $1 ORDER BY authority DESC NULLS LAST LIMIT 200",
    [siteId(req)]
  );
  res.json({ citations: rows });
}));

app.get("/api/sites/:id/regional", route(async (req, res) => {
  const metric = req.query.metric as RegionalMetricName | undefined;
  res.json(await getRegional(siteId(req), metric));
}));

/* ---------- GEO probe ---------- */

/** Kicks off an LLM probe for one prompt and returns the per-model result. */
app.post("/api/sites/:id/prompts", route(async (req, res) => {
  const id = siteId(req);
  const { prompt, models } = req.body ?? {};
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    throw new HttpError(400, "prompt is required");
  }
  if (models !== undefined && !Array.isArray(models)) {
    throw new HttpError(400, "models must be an array");
  }

  const runId = `run_${Date.now().toString(36)}`;
  try {
    const results = await probeLLM({
      siteId: id,
      prompt: prompt.trim(),
      models: models as LlmModel[] | undefined,
    });
    res.status(201).json({ runId, siteId: id, prompt: prompt.trim(), results });
  } catch (e: any) {
    // A missing key is a configuration problem, not a server fault.
    if (/no models enabled|unknown model/.test(e.message)) throw new HttpError(400, e.message);
    if (/not found/.test(e.message)) throw new HttpError(404, e.message);
    throw e;
  }
}));

/** Estimated cost of a probe, so the GUI can warn before spending. */
app.get("/api/sites/:id/prompts/estimate", route(async (req, res) => {
  const count = Number(req.query.prompts ?? 1);
  const models = enabledModels();
  res.json({
    prompts: count,
    models,
    calls: count * models.length,
    note: "Cached responses within 24h cost nothing. Disabled models are skipped.",
    disabled: ALL_MODELS.filter((m) => !models.includes(m)),
  });
}));

/* ---------- Connector syncs ---------- */

app.post("/api/sites/:id/sync/gsc", route(async (req, res) => {
  res.json(await syncGSC(siteId(req)));
}));

app.post("/api/sites/:id/sync/backlinks", route(async (req, res) => {
  const adapter = typeof req.body?.adapter === "string" ? req.body.adapter : undefined;
  res.json(await syncBacklinks(siteId(req), adapter));
}));

app.post("/api/sites/:id/sync/reviews", route(async (req, res) => {
  res.json(await syncReviews(siteId(req)));
}));

app.post("/api/sites/:id/sync/citations", route(async (req, res) => {
  res.json(await syncCitations(siteId(req)));
}));

app.post("/api/sites/:id/sync/regional", route(async (req, res) => {
  res.json(await syncRegional(siteId(req)));
}));

/* ---------- Clone & debrief ---------- */

app.post("/api/clone", route(async (req, res) => {
  const { targetDomain, siteId: id } = req.body ?? {};
  if (!targetDomain || typeof targetDomain !== "string") {
    throw new HttpError(400, "targetDomain is required");
  }
  if (!Number.isInteger(id)) throw new HttpError(400, "siteId is required");
  res.json(await runClone({ targetDomain, siteId: id }));
}));

app.get("/api/sites/:id/clone", route(async (req, res) => {
  const { rows } = await pg.query(
    "SELECT id, target_domain, report, created_at FROM clone_reports WHERE site_id = $1 ORDER BY created_at DESC LIMIT 20",
    [siteId(req)]
  );
  res.json({ reports: rows });
}));

app.post("/api/sites/:id/debrief", route(async (req, res) => {
  const id = siteId(req);
  const { scope, targetAudience, tone, country } = req.body ?? {};
  const debrief = await generateDebrief({
    siteId: id,
    scope: scope as DebriefScope | undefined,
    targetAudience,
    tone,
    country,
  });
  await respondDebrief(req, res, id, debrief);
}));

/**
 * Serves a debrief as JSON, or as markdown when the caller asks for it with
 * ?format=md or an Accept: text/markdown header. Keeping the markdown
 * rendering here means the GUI export and the CLI's --out produce identical
 * files.
 */
async function respondDebrief(req: Request, res: Response, id: number, debrief: Awaited<ReturnType<typeof generateDebrief>>) {
  const wantsMarkdown =
    req.query.format === "md" || (req.headers.accept ?? "").includes("text/markdown");
  if (!wantsMarkdown) return void res.json(debrief);

  const { rows } = await pg.query("SELECT domain FROM sites WHERE id = $1", [id]);
  res.type("text/markdown").send(debriefToMarkdown(debrief, rows[0]?.domain));
}

// Convenience GET so the world map's "Generate regional debrief" button can
// link straight to ?scope=regional&country=DE.
app.get("/api/sites/:id/debrief", route(async (req, res) => {
  const id = siteId(req);
  const debrief = await generateDebrief({
    siteId: id,
    scope: req.query.scope as DebriefScope | undefined,
    targetAudience: req.query.audience as string | undefined,
    tone: req.query.tone as string | undefined,
    country: req.query.country as string | undefined,
  });
  await respondDebrief(req, res, id, debrief);
}));

/* ---------- Live stream ---------- */

app.get("/api/stream", streamHandler);

/* ---------- Errors ---------- */

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // Honour a status set by middleware too — express.json() rejects a malformed
  // body with status 400, which is the client's fault, not a server error.
  const candidate = err instanceof HttpError ? err.status : (err?.status ?? err?.statusCode);
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate < 600 ? candidate : 500;

  if (status >= 500) console.error("[api]", err);
  res.status(status).json({ error: err.message ?? "internal error" });
});

const port = Number(process.env.PORT) || 4000;

// Exported for tests; only listen when run directly.
export const server =
  require.main === module ? app.listen(port, () => console.log(`API listening on :${port}`)) : null;

export default app;
