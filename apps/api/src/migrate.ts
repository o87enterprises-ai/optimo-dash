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
  `);

  console.log("Migrations complete.");
  await pg.end();
})();
