import "./env";
import { Pool } from "pg";

/**
 * Idempotent schema migration. Safe to re-run on every deploy: every statement
 * uses IF NOT EXISTS, so an existing Termux database is upgraded in place
 * without dropping data.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sites (
    id SERIAL PRIMARY KEY,
    domain TEXT NOT NULL UNIQUE,
    name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS keywords (
    id SERIAL PRIMARY KEY,
    site_id INT REFERENCES sites(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    position INT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS geo_prompts (
    id SERIAL PRIMARY KEY,
    site_id INT REFERENCES sites(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    model TEXT NOT NULL,
    cited BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS backlinks (
    id SERIAL PRIMARY KEY,
    site_id INT REFERENCES sites(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    authority INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- v2 columns (added to tables that shipped in v1)
  ALTER TABLE keywords
    ADD COLUMN IF NOT EXISTS impressions INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS clicks INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS country TEXT,
    ADD COLUMN IF NOT EXISTS device TEXT;

  ALTER TABLE geo_prompts
    ADD COLUMN IF NOT EXISTS excerpt TEXT;

  ALTER TABLE backlinks
    ADD COLUMN IF NOT EXISTS anchor TEXT,
    ADD COLUMN IF NOT EXISTS domain_authority INT,
    ADD COLUMN IF NOT EXISTS first_seen TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS lost BOOLEAN DEFAULT FALSE;

  -- v2 tables
  CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    site_id INT REFERENCES sites(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    author TEXT,
    rating INT,
    body TEXT,
    sentiment REAL,
    posted_at TIMESTAMPTZ,
    url TEXT
  );

  CREATE TABLE IF NOT EXISTS citations (
    id SERIAL PRIMARY KEY,
    site_id INT REFERENCES sites(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    url TEXT NOT NULL,
    authority INT,
    kind TEXT,
    verified BOOLEAN DEFAULT FALSE,
    discovered_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS regional_metrics (
    id SERIAL PRIMARY KEY,
    site_id INT REFERENCES sites(id) ON DELETE CASCADE,
    country TEXT NOT NULL,
    region TEXT,
    metric TEXT NOT NULL,
    value REAL,
    captured_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS clone_reports (
    id SERIAL PRIMARY KEY,
    site_id INT REFERENCES sites(id) ON DELETE CASCADE,
    target_domain TEXT NOT NULL,
    report JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- One row per (site, prompt, model) so re-probing updates instead of piling up.
  CREATE UNIQUE INDEX IF NOT EXISTS geo_prompts_unique
    ON geo_prompts (site_id, prompt, model);

  -- Re-syncing a connector must not duplicate rows.
  CREATE UNIQUE INDEX IF NOT EXISTS keywords_unique
    ON keywords (site_id, keyword, COALESCE(country, ''), COALESCE(device, ''));
  CREATE UNIQUE INDEX IF NOT EXISTS backlinks_unique
    ON backlinks (site_id, source, target);
  CREATE UNIQUE INDEX IF NOT EXISTS citations_unique
    ON citations (site_id, url);
  CREATE UNIQUE INDEX IF NOT EXISTS regional_metrics_unique
    ON regional_metrics (site_id, country, COALESCE(region, ''), metric);

  -- Hot read paths.
  CREATE INDEX IF NOT EXISTS keywords_site_idx ON keywords (site_id);
  CREATE INDEX IF NOT EXISTS geo_prompts_site_idx ON geo_prompts (site_id);
  CREATE INDEX IF NOT EXISTS backlinks_site_idx ON backlinks (site_id);
  CREATE INDEX IF NOT EXISTS reviews_site_idx ON reviews (site_id);
  CREATE INDEX IF NOT EXISTS citations_site_idx ON citations (site_id);
  CREATE INDEX IF NOT EXISTS regional_metrics_site_idx ON regional_metrics (site_id);
`;

(async () => {
  const pg = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pg.query(SCHEMA);
    console.log("Migrations complete.");
  } catch (e: any) {
    console.error("Migration failed:", e.message);
    process.exitCode = 1;
  } finally {
    await pg.end();
  }
})();
