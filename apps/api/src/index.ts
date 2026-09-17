import path from "path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "../../../.env") });

import express from "express";
import Redis from "ioredis";
import { Pool } from "pg";

const app = express();
app.use(express.json());

const pg = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

/* ---------- Health ---------- */
app.get("/health", async (_req, res) => {
  const db = await pg.query("SELECT 1");
  const cache = await redis.ping();
  res.json({ ok: true, db: db.rowCount === 1, redis: cache === "PONG" });
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
    "SELECT * FROM keywords WHERE site_id = $1 ORDER BY position NULLS LAST LIMIT 100",
    [req.params.id]
  );
  res.json({ keywords: rows, updated: new Date().toISOString() });
});

app.get("/api/sites/:id/geo", async (req, res) => {
  const { rows } = await pg.query(
    "SELECT * FROM geo_prompts WHERE site_id = $1 ORDER BY updated_at DESC LIMIT 100",
    [req.params.id]
  );
  const cited = rows.filter((r) => r.cited).length;
  const visibility = rows.length ? Math.round((cited / rows.length) * 100) : 0;
  res.json({ prompts: rows, visibility });
});

app.get("/api/sites/:id/backlinks", async (req, res) => {
  const { rows } = await pg.query(
    "SELECT * FROM backlinks WHERE site_id = $1 ORDER BY created_at DESC LIMIT 100",
    [req.params.id]
  );
  res.json({ backlinks: rows });
});

/* ---------- Legacy global ---------- */
app.get("/api/rank", async (_req, res) => res.json({ keywords: [], updated: new Date().toISOString() }));
app.get("/api/geo/visibility", async (_req, res) => res.json({ prompts: [], visibility: 0 }));

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API listening on :${port}`));
