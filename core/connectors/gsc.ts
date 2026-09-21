import type { Ctx } from "../ports.ts";
import { now } from "../ports.ts";
import { getSecret } from "../secrets.ts";
import { fromBase64, toBase64 } from "../crypto.ts";
import type { ConnectorStatus } from "../types";

/**
 * Google Search Console connector.
 *
 * The service-account JSON is pasted into the settings form and stored
 * encrypted, rather than read from disk — Workers have no filesystem, and a
 * key on disk is a key in a backup.
 *
 * The OAuth2 JWT is signed with WebCrypto, so there is no googleapis
 * dependency to install on Termux and the same code runs on Workers.
 */

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const LOOKBACK_DAYS = 28;
const ROW_LIMIT = 500;

type ServiceAccount = { client_email: string; private_key: string };

async function credentials(ctx: Ctx): Promise<ServiceAccount | null> {
  const raw = await getSecret(ctx, "GOOGLE_SEARCH_CONSOLE_CREDENTIALS");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed as ServiceAccount;
  } catch {
    return null;
  }
}

export async function gscStatus(ctx: Ctx): Promise<ConnectorStatus> {
  const raw = await getSecret(ctx, "GOOGLE_SEARCH_CONSOLE_CREDENTIALS");
  if (!raw) {
    return { name: "gsc", enabled: false, reason: "GOOGLE_SEARCH_CONSOLE_CREDENTIALS not set" };
  }
  if (!(await credentials(ctx))) {
    return {
      name: "gsc",
      enabled: false,
      reason: "credentials must be the service-account JSON, including client_email and private_key",
    };
  }
  return { name: "gsc", enabled: true };
}

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Converts a PEM private key into the PKCS#8 bytes WebCrypto expects. */
function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  return fromBase64(body);
}

/** Exchanges the service-account key for an OAuth2 access token. */
async function getAccessToken(ctx: Ctx): Promise<string> {
  const creds = await credentials(ctx);
  if (!creds) throw new Error("Search Console credentials are missing or malformed");

  const issued = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      exp: issued + 3600,
      iat: issued,
    })
  );

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(creds.private_key) as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`)
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${base64url(new Uint8Array(signature))}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as any).access_token;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

/** Pulls query performance and upserts it into keywords. */
export async function syncGSC(ctx: Ctx, siteId: number): Promise<{ rows: number; synced: string }> {
  const status = await gscStatus(ctx);
  if (!status.enabled) throw new Error(status.reason!);

  const site = await ctx.db.first<{ domain: string }>("SELECT domain FROM sites WHERE id = ?", [siteId]);
  if (!site) throw new Error(`site ${siteId} not found`);

  const token = await getAccessToken(ctx);
  const property = `sc-domain:${site.domain}`;

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
  if (!res.ok) throw new Error(`GSC query failed: ${res.status} ${(await res.text()).slice(0, 300)}`);

  const rows: any[] = ((await res.json()) as any).rows ?? [];
  const timestamp = now();

  for (const row of rows) {
    const [query, country, device] = row.keys ?? [];
    await ctx.db.run(
      `INSERT INTO keywords (site_id, keyword, position, impressions, clicks, country, device, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (site_id, keyword, COALESCE(country, ''), COALESCE(device, ''))
       DO UPDATE SET position = excluded.position,
                     impressions = excluded.impressions,
                     clicks = excluded.clicks,
                     updated_at = excluded.updated_at`,
      [
        siteId,
        query,
        row.position != null ? Math.round(row.position) : null,
        row.impressions ?? 0,
        row.clicks ?? 0,
        country ?? null,
        device ?? null,
        timestamp,
      ]
    );
  }

  await ctx.bus.publish({ kind: "keywords", siteId, payload: { rows: rows.length } });
  return { rows: rows.length, synced: timestamp };
}
