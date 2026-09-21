import "./env.ts";
import { Pool } from "pg";
import { PostgresAdapter } from "../../../adapters/postgres.ts";
import { migrate } from "../../../core/schema.ts";

/**
 * Applies the schema to the self-hosted Postgres database. The Cloudflare
 * build migrates D1 through POST /api/admin/migrate instead.
 */
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { statements } = await migrate(new PostgresAdapter(pool));
    console.log(`Migrations complete (${statements} statements).`);
  } catch (e: any) {
    console.error("Migration failed:", e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
