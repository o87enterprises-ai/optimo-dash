/**
 * Google Search Console connector (read-only), no SDK: a signed JWT (service account)
 * or a refresh token (OAuth) is exchanged for an access token, then plain REST calls.
 *
 * Credentials, first match wins:
 *   GOOGLE_SEARCH_CONSOLE_CREDENTIALS  path to a service-account JSON file, or the JSON itself
 *   GSC_CLIENT_ID + GSC_CLIENT_SECRET + GSC_REFRESH_TOKEN   OAuth installed-app credentials
 */
import { createSign } from "crypto";
import { readFileSync } from "fs";
import type { Pool } from "pg";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const API = () => (process.env.GSC_API_BASE || "https://www.googleapis.com/webmasters/v3").replace(/\/+$/, "");
const OAUTH_TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";

/** Carries an HTTP status so route handlers can surface it unchanged. */
export class GscError extends Error {
  constructor(public httpStatus: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export interface GscProperty {
  siteUrl: string;
  permissionLevel: string;
}

type Creds =
  | { kind: "service-account"; email: string; key: string; tokenUri: string }
  | { kind: "oauth"; clientId: string; clientSecret: string; refreshToken: string };

/* ---------- credentials ---------- */

function loadCreds(env = process.env): Creds | null {
  const raw = env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS?.trim();
  if (raw) {
    let j: any;
    try {
      j = JSON.parse(raw.startsWith("{") ? raw : readFileSync(raw, "utf8"));
    } catch (e: any) {
      throw new GscError(409, `GOOGLE_SEARCH_CONSOLE_CREDENTIALS is not readable JSON: ${e.message}`);
    }
    if (!j.client_email || !j.private_key) {
      throw new GscError(409, "GOOGLE_SEARCH_CONSOLE_CREDENTIALS must be a service-account key (client_email + private_key)");
    }
    return {
      kind: "service-account",
      email: j.client_email,
      key: j.private_key,
      tokenUri: j.token_uri || OAUTH_TOKEN_URL(),
    };
  }
  if (env.GSC_CLIENT_ID && env.GSC_CLIENT_SECRET && env.GSC_REFRESH_TOKEN) {
    return {
      kind: "oauth",
      clientId: env.GSC_CLIENT_ID,
      clientSecret: env.GSC_CLIENT_SECRET,
      refreshToken: env.GSC_REFRESH_TOKEN,
    };
  }
  return null;
}

export function gscStatus(): { configured: boolean; mode?: string; reason?: string } {
  try {
    const c = loadCreds();
    return c ? { configured: true, mode: c.kind } : { configured: false, reason: "add Search Console credentials to enable" };
  } catch (e: any) {
    return { configured: false, reason: e.message };
  }
}

/* ---------- auth ---------- */

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
let cached: { token: string; expiresAt: number; fingerprint: string } | null = null;

async function postForm(url: string, form: Record<string, string>): Promise<any> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(20_000),
  });
  const body: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new GscError(502, `Google auth failed (${r.status}): ${body.error_description || body.error || "unknown error"}`);
  }
  return body;
}

async function accessToken(): Promise<string> {
  const creds = loadCreds();
  if (!creds) throw new GscError(409, "Search Console is not configured: " + gscStatus().reason);

  const fingerprint = creds.kind === "service-account" ? creds.email : creds.clientId;
  if (cached && cached.fingerprint === fingerprint && cached.expiresAt > Date.now() + 60_000) return cached.token;

  let body: any;
  if (creds.kind === "service-account") {
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(
      JSON.stringify({ iss: creds.email, scope: SCOPE, aud: creds.tokenUri, iat: now, exp: now + 3600 })
    );
    let sig: string;
    try {
      sig = b64url(createSign("RSA-SHA256").update(`${head}.${claims}`).sign(creds.key));
    } catch (e: any) {
      throw new GscError(409, `service-account private_key could not sign: ${e.message}`);
    }
    body = await postForm(creds.tokenUri, {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${head}.${claims}.${sig}`,
    });
  } else {
    body = await postForm(OAUTH_TOKEN_URL(), {
      grant_type: "refresh_token",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
    });
  }
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000, fingerprint };
  return cached.token;
}

/* ---------- REST ---------- */

async function gsc(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  const token = await accessToken();
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${API()}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && attempt < 2) {
      await new Promise((res) => setTimeout(res, 1000 * 2 ** (attempt + 1)));
      continue;
    }
    const body: any = await r.json().catch(() => ({}));
    const msg = body.error?.message || `HTTP ${r.status}`;
    throw new GscError(r.status === 401 || r.status === 403 ? r.status : 502, `Search Console: ${msg}`);
  }
}

export async function listProperties(): Promise<GscProperty[]> {
  const data = await gsc("/sites");
  return (data.siteEntry ?? []) as GscProperty[];
}

/* ---------- property matching ---------- */

const bare = (d: string) => d.toLowerCase().replace(/^www\./, "");

/** Pick the Search Console property for a domain: domain property first, then https URL-prefix. */
export function pickProperty(domain: string, props: GscProperty[]): GscProperty | null {
  const d = bare(domain);
  const usable = props.filter((p) => p.permissionLevel !== "siteUnverifiedUser");
  const dom = usable.find((p) => p.siteUrl.toLowerCase() === `sc-domain:${d}`);
  if (dom) return dom;
  const prefixes = usable.filter((p) => {
    try {
      return bare(new URL(p.siteUrl).hostname) === d;
    } catch {
      return false;
    }
  });
  return prefixes.find((p) => p.siteUrl.startsWith("https://")) ?? prefixes[0] ?? null;
}

/* ---------- sync ---------- */

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export interface GscSyncResult {
  property: string;
  startDate: string;
  endDate: string;
  keywords: number;
  clicks: number;
  impressions: number;
}

export async function syncGsc(
  pg: Pool,
  opts: { siteId: number; days?: number; property?: string }
): Promise<GscSyncResult> {
  const site = (await pg.query("SELECT domain FROM sites WHERE id = $1", [opts.siteId])).rows[0];
  if (!site) throw new GscError(404, "site not found");

  const props = await listProperties();
  const property = opts.property
    ? props.find((p) => p.siteUrl === opts.property)
    : pickProperty(site.domain, props);
  if (!property) {
    throw new GscError(
      404,
      opts.property
        ? `"${opts.property}" is not a property this account can read`
        : `No Search Console property matches ${site.domain}. Add it in Search Console and grant this account access, or pass { "property": "<siteUrl>" }.`,
      { available: props.map((p) => p.siteUrl) }
    );
  }

  // Search Console data lags ~2 days; the window ends there so it never includes partial days
  const days = Math.min(Math.max(Math.floor(opts.days ?? 28), 1), 480);
  const end = new Date(Date.now() - 2 * 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);

  const data = await gsc(`/sites/${encodeURIComponent(property.siteUrl)}/searchAnalytics/query`, {
    method: "POST",
    body: {
      startDate: isoDay(start),
      endDate: isoDay(end),
      dimensions: ["query"],
      type: "web",
      rowLimit: 5000,
    },
  });
  const rows: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] = data.rows ?? [];

  // Replace this site's Search Console keywords as one unit: the window is the source of truth
  const client = await pg.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM keywords WHERE site_id = $1 AND source = 'gsc'", [opts.siteId]);
    if (rows.length) {
      await client.query(
        `INSERT INTO keywords (site_id, keyword, position, impressions, clicks, ctr, source)
         SELECT $1, k, p, i, c, t, 'gsc'
         FROM unnest($2::text[], $3::real[], $4::int[], $5::int[], $6::real[]) AS x(k, p, i, c, t)`,
        [
          opts.siteId,
          rows.map((r) => r.keys[0]),
          rows.map((r) => r.position),
          rows.map((r) => r.impressions),
          rows.map((r) => r.clicks),
          rows.map((r) => r.ctr),
        ]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  return {
    property: property.siteUrl,
    startDate: isoDay(start),
    endDate: isoDay(end),
    keywords: rows.length,
    clicks: rows.reduce((a, r) => a + r.clicks, 0),
    impressions: rows.reduce((a, r) => a + r.impressions, 0),
  };
}
