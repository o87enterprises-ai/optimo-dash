import path from "path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "../../../.env") });

import express from "express";
import Redis from "ioredis";
import { Pool } from "pg";
import { GscError, gscStatus, listProperties, syncGsc } from "./connectors/gsc";
import { NoProviderError, probeLLM } from "./probes/llm";
import { resolveProviders } from "./probes/providers";

const app = express();
app.use(express.json());

const pg = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// An idle connection dropping (e.g. Postgres restarted) must not take the API down; pg reconnects on the next query
pg.on("error", (e) => console.error("postgres pool error:", e.message));

/* ---------- Health ---------- */
app.get("/health", async (_req, res) => {
  // ok = the API itself is up; db/redis report their own state so the UI can show an outage
  const [db, cache] = await Promise.all([
    pg.query("SELECT 1").then((r) => r.rowCount === 1, () => false),
    redis.ping().then((r) => r === "PONG", () => false),
  ]);
  res.json({ ok: true, db, redis: cache });
});

/* ---------- Sites ---------- */
app.get("/api/sites", async (_req, res) => {
  const { rows } = await pg.query("SELECT * FROM sites ORDER BY created_at DESC");
  res.json(rows);
});

app.post("/api/sites", async (req, res) => {
  let { domain, name } = req.body;
  if (!domain || typeof domain !== "string") {
    return res.status(400).json({ error: "domain is required" });
  }
  domain = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  try {
    const { rows } = await pg.query(
      "INSERT INTO sites (domain, name) VALUES ($1, $2) RETURNING *",
      [domain, name || domain]
    );
    res.status(201).json(rows[0]);
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: "site already exists" });
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/sites/:id", async (req, res) => {
  await pg.query("DELETE FROM sites WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

/* ---------- Per-site data (stubs for now) ---------- */
app.get("/api/sites/:id/rank", async (req, res) => {
  const { rows } = await pg.query(
    `SELECT * FROM keywords WHERE site_id = $1
     ORDER BY clicks DESC NULLS LAST, impressions DESC NULLS LAST, position NULLS LAST LIMIT 100`,
    [req.params.id]
  );
  const t = (
    await pg.query(
      `SELECT COUNT(*)::int AS keywords, COALESCE(SUM(clicks),0)::int AS clicks,
              COALESCE(SUM(impressions),0)::int AS impressions, MAX(updated_at) AS updated
       FROM keywords WHERE site_id = $1`,
      [req.params.id]
    )
  ).rows[0];
  res.json({
    keywords: rows,
    totals: { keywords: t.keywords, clicks: t.clicks, impressions: t.impressions },
    updated: t.updated ?? null,
  });
});

app.get("/api/sites/:id/geo", async (req, res) => {
  // latest result per (prompt, model); older runs stay in the table as history
  const { rows } = await pg.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (prompt, model) * FROM geo_prompts
       WHERE site_id = $1 ORDER BY prompt, model, updated_at DESC
     ) latest ORDER BY updated_at DESC LIMIT 100`,
    [req.params.id]
  );
  const seen = (r: any) => r.cited || r.mentioned;
  const pct = (xs: any[]) => (xs.length ? Math.round((xs.filter(seen).length / xs.length) * 100) : 0);
  const byProvider: Record<string, { prompts: number; visibility: number }> = {};
  for (const id of new Set(rows.map((r) => r.provider || r.model))) {
    const set = rows.filter((r) => (r.provider || r.model) === id);
    byProvider[id as string] = { prompts: set.length, visibility: pct(set) };
  }
  res.json({ prompts: rows, visibility: pct(rows), byProvider });
});

app.get("/api/sites/:id/backlinks", async (req, res) => {
  const { rows } = await pg.query(
    "SELECT * FROM backlinks WHERE site_id = $1 ORDER BY created_at DESC LIMIT 100",
    [req.params.id]
  );
  res.json({ backlinks: rows });
});

/* ---------- LLM providers + GEO probes ---------- */
const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>): express.RequestHandler =>
  (req, res) =>
    fn(req, res).catch((e) => {
      if (e instanceof NoProviderError) return res.status(409).json({ error: e.message });
      if (e instanceof GscError) return res.status(e.httpStatus).json({ error: e.message, ...e.extra });
      res.status(500).json({ error: e.message });
    });

const MAX_PROMPTS_PER_RUN = 20;

app.get("/api/providers", wrap(async (_req, res) => {
  res.json(await resolveProviders());
}));

app.get("/api/sites/:id/prompts", wrap(async (req, res) => {
  const { rows } = await pg.query(
    "SELECT * FROM site_prompts WHERE site_id = $1 ORDER BY created_at DESC",
    [req.params.id]
  );
  res.json(rows);
}));

// Save a prompt and probe it. body: { prompt, providers?: string[], run?: boolean (default true) }
app.post("/api/sites/:id/prompts", wrap(async (req, res) => {
  const prompt = typeof req.body.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt) return res.status(400).json({ error: "prompt is required" });
  const siteId = Number(req.params.id);
  const saved = await pg.query(
    `INSERT INTO site_prompts (site_id, prompt) VALUES ($1, $2)
     ON CONFLICT (site_id, prompt) DO UPDATE SET prompt = EXCLUDED.prompt RETURNING *`,
    [siteId, prompt]
  );
  let results: Awaited<ReturnType<typeof probeLLM>> = [];
  let warning: string | undefined;
  if (req.body.run !== false) {
    try {
      results = await probeLLM({ pg, redis }, { siteId, prompt, providers: req.body.providers });
    } catch (e) {
      // the prompt is saved either way, so it can be added before any provider is configured
      if (!(e instanceof NoProviderError)) throw e;
      warning = e.message;
    }
  }
  res.status(201).json({ prompt: saved.rows[0], results, warning });
}));

app.delete("/api/sites/:id/prompts/:promptId", wrap(async (req, res) => {
  await pg.query("DELETE FROM site_prompts WHERE id = $1 AND site_id = $2", [req.params.promptId, req.params.id]);
  res.status(204).end();
}));

// Re-probe every saved prompt for a site (capped to keep API spend predictable)
app.post("/api/sites/:id/probe", wrap(async (req, res) => {
  const siteId = Number(req.params.id);
  const { rows } = await pg.query(
    "SELECT prompt FROM site_prompts WHERE site_id = $1 ORDER BY created_at DESC LIMIT $2",
    [siteId, MAX_PROMPTS_PER_RUN]
  );
  const out = [];
  for (const r of rows) {
    out.push({ prompt: r.prompt, results: await probeLLM({ pg, redis }, { siteId, prompt: r.prompt, providers: req.body?.providers }) });
  }
  res.json({ ran: out.length, runs: out });
}));

// Generic starter prompts built from the site's name/domain; the user edits or ignores them
app.get("/api/sites/:id/prompt-suggestions", wrap(async (req, res) => {
  const { rows } = await pg.query("SELECT domain, name FROM sites WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "site not found" });
  const brand = rows[0].name || rows[0].domain.replace(/^www\./, "");
  res.json([
    `What is ${brand}?`,
    `Is ${rows[0].domain.replace(/^www\./, "")} legit and trustworthy?`,
    `What are the best alternatives to ${brand}?`,
    `${brand} reviews: is it worth it?`,
    `Who are the main competitors of ${brand}?`,
  ]);
}));

/* ---------- Search Console ---------- */
app.get("/api/connectors", wrap(async (_req, res) => {
  res.json({ gsc: gscStatus() });
}));

app.get("/api/gsc/properties", wrap(async (_req, res) => {
  res.json(await listProperties());
}));

// Pull the last N days (default 28) of query-level clicks/impressions/position. body: { days?, property? }
app.post("/api/sites/:id/sync/gsc", wrap(async (req, res) => {
  const days = req.body?.days === undefined ? undefined : Number(req.body.days);
  if (days !== undefined && !Number.isFinite(days)) return res.status(400).json({ error: "days must be a number" });
  res.json(await syncGsc(pg, { siteId: Number(req.params.id), days, property: req.body?.property }));
}));

/* ---------- Legacy global ---------- */
app.get("/api/rank", async (_req, res) => res.json({ keywords: [], updated: new Date().toISOString() }));
app.get("/api/geo/visibility", async (_req, res) => res.json({ prompts: [], visibility: 0 }));

const port = process.env.PORT || 4000;
// local tool: loopback only, so nothing outside this machine can reach an unauthenticated API
app.listen(Number(port), process.env.API_HOST || "127.0.0.1", () => console.log(`API listening on :${port}`));
