import path from "path";
import { config } from "dotenv";
import { Pool } from "pg";

config({ path: path.resolve(__dirname, "../../../.env") });

(async () => {
  const pg = new Pool({ connectionString: process.env.DATABASE_URL });

  await pg.query(`
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

    -- GEO probe results: mentioned = in answer text, cited = in provider-reported sources
    ALTER TABLE geo_prompts
      ADD COLUMN IF NOT EXISTS provider TEXT,
      ADD COLUMN IF NOT EXISTS mentioned BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS excerpt TEXT,
      ADD COLUMN IF NOT EXISTS sources JSONB;

    -- Search Console: average position is fractional (e.g. 7.4); source marks rows a sync owns
    ALTER TABLE keywords ALTER COLUMN position TYPE REAL;
    ALTER TABLE keywords
      ADD COLUMN IF NOT EXISTS impressions INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS clicks INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ctr REAL,
      ADD COLUMN IF NOT EXISTS source TEXT;

    -- Prompts a user wants tracked per site
    CREATE TABLE IF NOT EXISTS site_prompts (
      id SERIAL PRIMARY KEY,
      site_id INT REFERENCES sites(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (site_id, prompt)
    );
  `);

  console.log("Migrations complete.");
  await pg.end();
})();
