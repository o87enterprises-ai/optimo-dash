import fs from "fs";
import { envKey } from "../env";
import { pg, publishUpdate } from "../db";
import type { ConnectorStatus } from "../../../../shared/types";

/**
 * Google Search Console connector.
 *
 * Authenticates with a service-account JSON (path in
 * GOOGLE_SEARCH_CONSOLE_CREDENTIALS), signs its own JWT so the API has no
 * googleapis dependency to install on Termux, and pulls the last 28 days of
 * query performance into `keywords`.
 */

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const LOOKBACK_DAYS = 28;
const ROW_LIMIT = 500;

export function gscStatus(): ConnectorStatus {
  const path = envKey("GOOGLE_SEARCH_CONSOLE_CREDENTIALS");
  if (!path) {
    return { name: "gsc", enabled: false, reason: "GOOGLE_SEARCH_CONSOLE_CREDENTIALS not set" };
  }
  if (!fs.existsSync(path)) {
    return { name: "gsc", enabled: false, reason: `credentials file not found: ${path}` };
  }
  return { name: "gsc", enabled: true };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Exchanges a service-account key for an OAuth2 access token. */
async function getAccessToken(): Promise<string> {
  const path = envKey("GOOGLE_SEARCH_CONSOLE_CREDENTIALS")!;
  const creds = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!creds.client_email || !creds.private_key) {
    throw new Error("credentials JSON missing client_email or private_key");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    })
  );

  const crypto = await import("crypto");
  const signature = base64url(
    crypto.createSign("RSA-SHA256").update(`${header}.${claims}`).sign(creds.private_key)
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json() as any).access_token;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

/**
 * Pulls query/country/device performance for a site and upserts it into
 * `keywords`. Returns the number of rows written.
 */
export async function syncGSC(siteId: number): Promise<{ rows: number; synced: string }> {
  const status = gscStatus();
  if (!status.enabled) throw new Error(status.reason);

  const site = await pg.query("SELECT domain FROM sites WHERE id = $1", [siteId]);
  if (!site.rows.length) throw new Error(`site ${siteId} not found`);
  const domain: string = site.rows[0].domain;

  const token = await getAccessToken();
  const property = `sc-domain:${domain}`;

  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: isoDaysAgo(LOOKBACK_DAYS),
        endDate: isoDaysAgo(1),
        dimensions: ["query", "country", "device"],
        rowLimit: ROW_LIMIT,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`GSC query failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  const rows: any[] = (await res.json() as any).rows ?? [];

  for (const row of rows) {
    const [query, country, device] = row.keys ?? [];
    await pg.query(
      `INSERT INTO keywords (site_id, keyword, position, impressions, clicks, country, device, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (site_id, keyword, COALESCE(country, ''), COALESCE(device, ''))
       DO UPDATE SET position = EXCLUDED.position,
                     impressions = EXCLUDED.impressions,
                     clicks = EXCLUDED.clicks,
                     updated_at = NOW()`,
      [
        siteId,
        query,
        row.position != null ? Math.round(row.position) : null,
        row.impressions ?? 0,
        row.clicks ?? 0,
        country ?? null,
        device ?? null,
      ]
    );
  }

  await publishUpdate({ kind: "keywords", siteId, payload: { rows: rows.length } });
  return { rows: rows.length, synced: new Date().toISOString() };
}
