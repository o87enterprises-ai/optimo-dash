import type { Db } from "./ports.ts";

/**
 * Schema, written once and rendered per dialect.
 *
 * Only the handful of genuinely dialect-specific tokens are substituted, which
 * keeps the D1 and Postgres schemas from drifting apart:
 *   {PK}   auto-incrementing primary key
 *   {BOOL} 0/1 integer (see ports.ts for why booleans are integers)
 *   {JSON} JSON document stored as text
 *
 * Timestamps are ISO-8601 TEXT in both dialects.
 */
const TABLES = `
CREATE TABLE IF NOT EXISTS sites (
  id {PK},
  domain TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS keywords (
  id {PK},
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  position INTEGER,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  country TEXT,
  device TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS geo_prompts (
  id {PK},
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  cited {BOOL} DEFAULT 0,
  excerpt TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backlinks (
  id {PK},
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  anchor TEXT,
  authority INTEGER,
  domain_authority INTEGER,
  first_seen TEXT NOT NULL,
  lost {BOOL} DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id {PK},
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  author TEXT,
  rating INTEGER,
  body TEXT,
  sentiment REAL,
  posted_at TEXT,
  url TEXT
);

CREATE TABLE IF NOT EXISTS citations (
  id {PK},
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  authority INTEGER,
  kind TEXT,
  verified {BOOL} DEFAULT 0,
  discovered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS regional_metrics (
  id {PK},
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  country TEXT NOT NULL,
  region TEXT,
  metric TEXT NOT NULL,
  value REAL,
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clone_reports (
  id {PK},
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  target_domain TEXT NOT NULL,
  report {JSON} NOT NULL,
  created_at TEXT NOT NULL
);

-- Single-operator admin account. Created on first run via the setup form.
CREATE TABLE IF NOT EXISTS admin_users (
  id {PK},
  username TEXT NOT NULL UNIQUE,
  password_hash {JSON} NOT NULL,
  created_at TEXT NOT NULL
);

-- Sessions store only a SHA-256 digest of the bearer token.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Failed logins, tracked in the database rather than the cache because
-- rate limiting must be strongly consistent to be worth anything.
CREATE TABLE IF NOT EXISTS login_attempts (
  id {PK},
  identifier TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);

-- API credentials, encrypted at rest with AES-GCM. The plaintext never leaves
-- this table, and is never returned to a browser.
CREATE TABLE IF NOT EXISTS api_credentials (
  name TEXT PRIMARY KEY,
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  masked TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const INDEXES = `
CREATE UNIQUE INDEX IF NOT EXISTS geo_prompts_unique
  ON geo_prompts (site_id, prompt, model);
CREATE UNIQUE INDEX IF NOT EXISTS keywords_unique
  ON keywords (site_id, keyword, COALESCE(country, ''), COALESCE(device, ''));
CREATE UNIQUE INDEX IF NOT EXISTS backlinks_unique
  ON backlinks (site_id, source, target);
CREATE UNIQUE INDEX IF NOT EXISTS citations_unique
  ON citations (site_id, url);
CREATE UNIQUE INDEX IF NOT EXISTS regional_metrics_unique
  ON regional_metrics (site_id, country, COALESCE(region, ''), metric);

CREATE INDEX IF NOT EXISTS keywords_site_idx ON keywords (site_id);
CREATE INDEX IF NOT EXISTS geo_prompts_site_idx ON geo_prompts (site_id);
CREATE INDEX IF NOT EXISTS backlinks_site_idx ON backlinks (site_id);
CREATE INDEX IF NOT EXISTS reviews_site_idx ON reviews (site_id);
CREATE INDEX IF NOT EXISTS citations_site_idx ON citations (site_id);
CREATE INDEX IF NOT EXISTS regional_metrics_site_idx ON regional_metrics (site_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS login_attempts_idx ON login_attempts (identifier, attempted_at);
`;

const SUBSTITUTIONS = {
  sqlite: { "{PK}": "INTEGER PRIMARY KEY AUTOINCREMENT", "{BOOL}": "INTEGER", "{JSON}": "TEXT" },
  postgres: { "{PK}": "SERIAL PRIMARY KEY", "{BOOL}": "SMALLINT", "{JSON}": "TEXT" },
} as const;

/** Renders the schema for a dialect as a list of individual statements. */
export function schemaStatements(dialect: "sqlite" | "postgres"): string[] {
  let sql = TABLES + INDEXES;
  for (const [token, replacement] of Object.entries(SUBSTITUTIONS[dialect])) {
    sql = sql.split(token).join(replacement);
  }
  return sql
    .split(";")
    .map(stripComments)
    .filter(Boolean);
}

/**
 * Removes `--` line comments and collapses whitespace.
 *
 * Both matter: a statement is split on `;` and may therefore carry the comment
 * that preceded it, and D1 runs DDL as a single line — so a surviving comment
 * would silently swallow the whole statement.
 */
function stripComments(statement: string): string {
  return statement
    .split("\n")
    .map((line) => {
      const marker = line.indexOf("--");
      return marker === -1 ? line : line.slice(0, marker);
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Applies the schema. Every statement is IF NOT EXISTS, so this is safe to run
 * on every deploy and is how the Cloudflare build migrates itself.
 */
export async function migrate(db: Db): Promise<{ statements: number }> {
  const statements = schemaStatements(db.dialect);
  for (const statement of statements) {
    await db.exec(statement);
  }
  return { statements: statements.length };
}
