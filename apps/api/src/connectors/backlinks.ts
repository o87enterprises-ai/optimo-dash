import { envKey } from "../env";
import { pg, publishUpdate } from "../db";
import type { ConnectorStatus } from "../../../../shared/types";

/**
 * Backlink connector with pluggable adapters.
 *
 * Adapters are tried in order of data quality: paid APIs first when their key
 * is present, then Common Crawl, which needs no key and is always available.
 * Every adapter returns the same shape so the caller does not care which one
 * answered.
 */

export type BacklinkRow = {
  source: string;
  target: string;
  anchor?: string | null;
  domainAuthority?: number | null;
};

type Adapter = {
  name: string;
  status: () => ConnectorStatus;
  fetch: (domain: string) => Promise<BacklinkRow[]>;
};

/* ---------- Ahrefs ---------- */

const ahrefs: Adapter = {
  name: "ahrefs",
  status: () =>
    envKey("AHREFS_API_KEY")
      ? { name: "ahrefs", enabled: true }
      : { name: "ahrefs", enabled: false, reason: "AHREFS_API_KEY not set" },
  async fetch(domain) {
    const key = envKey("AHREFS_API_KEY")!;
    const url = new URL("https://api.ahrefs.com/v3/site-explorer/all-backlinks");
    url.searchParams.set("target", domain);
    url.searchParams.set("limit", "200");
    url.searchParams.set("select", "url_from,url_to,anchor,domain_rating_source");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`ahrefs: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return ((await res.json() as any).backlinks ?? []).map((b: any) => ({
      source: b.url_from,
      target: b.url_to,
      anchor: b.anchor ?? null,
      domainAuthority: b.domain_rating_source ?? null,
    }));
  },
};

/* ---------- Moz ---------- */

const moz: Adapter = {
  name: "moz",
  status: () =>
    envKey("MOZ_API_KEY")
      ? { name: "moz", enabled: true }
      : { name: "moz", enabled: false, reason: "MOZ_API_KEY not set" },
  async fetch(domain) {
    const key = envKey("MOZ_API_KEY")!;
    const res = await fetch("https://lsapi.seomoz.com/v2/links", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-moz-token": key },
      body: JSON.stringify({ target: domain, target_scope: "domain", limit: 200 }),
    });
    if (!res.ok) throw new Error(`moz: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return ((await res.json() as any).results ?? []).map((r: any) => ({
      source: r.source?.page ?? r.source_url,
      target: r.target?.page ?? r.target_url,
      anchor: r.anchor_text ?? null,
      domainAuthority: r.source?.domain_authority ?? null,
    }));
  },
};

/* ---------- Common Crawl (free, no key) ---------- */

const commonCrawl: Adapter = {
  name: "commoncrawl",
  status: () => ({ name: "commoncrawl", enabled: true }),
  async fetch(domain) {
    // Resolve the newest index, since the crawl id changes every few months.
    const indexes = await fetch("https://index.commoncrawl.org/collinfo.json");
    if (!indexes.ok) throw new Error(`commoncrawl: index list ${indexes.status}`);
    const newest = (await indexes.json() as any)[0];
    if (!newest?.["cdx-api"]) throw new Error("commoncrawl: no index available");

    const url = new URL(newest["cdx-api"]);
    url.searchParams.set("url", `*.${domain}`);
    url.searchParams.set("output", "json");
    url.searchParams.set("limit", "200");

    const res = await fetch(url);
    // 404 is the documented "no captures" response, not an error.
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`commoncrawl: ${res.status}`);

    const rows: BacklinkRow[] = [];
    for (const line of (await res.text()).split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.url) rows.push({ source: rec.url, target: domain, anchor: null, domainAuthority: null });
      } catch {
        // CDX occasionally emits a non-JSON status line; skip it.
      }
    }
    return rows;
  },
};

const ADAPTERS: Adapter[] = [ahrefs, moz, commonCrawl];

/**
 * Referring hosts for any domain using only key-free data. Used by the clone
 * engine, which must work against a competitor we have no paid data for.
 */
export async function fetchReferringHosts(domain: string): Promise<string[]> {
  const rows = await commonCrawl.fetch(domain);
  const hosts = new Set<string>();
  for (const row of rows) {
    try {
      const host = new URL(row.source).hostname.replace(/^www\./, "");
      // Self-references are not backlinks.
      if (!host.endsWith(domain)) hosts.add(host);
    } catch {
      // Skip unparseable CDX entries.
    }
  }
  return [...hosts];
}

export function backlinkStatus(): ConnectorStatus[] {
  return ADAPTERS.map((a) => a.status());
}

/**
 * Syncs backlinks using the best available adapter. Rows already stored but
 * absent from this pull are flagged `lost` rather than deleted, so the UI can
 * show link loss over time.
 */
export async function syncBacklinks(
  siteId: number,
  preferred?: string
): Promise<{ rows: number; adapter: string; lost: number }> {
  const site = await pg.query("SELECT domain FROM sites WHERE id = $1", [siteId]);
  if (!site.rows.length) throw new Error(`site ${siteId} not found`);
  const domain: string = site.rows[0].domain;

  const candidates = preferred
    ? ADAPTERS.filter((a) => a.name === preferred)
    : ADAPTERS.filter((a) => a.status().enabled);
  if (!candidates.length) throw new Error(`no backlink adapter available (requested: ${preferred ?? "any"})`);

  let rows: BacklinkRow[] | null = null;
  let used = "";
  const errors: string[] = [];

  for (const adapter of candidates) {
    try {
      rows = await adapter.fetch(domain);
      used = adapter.name;
      break;
    } catch (e: any) {
      errors.push(`${adapter.name}: ${e.message}`);
    }
  }
  if (rows === null) throw new Error(`all backlink adapters failed — ${errors.join("; ")}`);

  const seen: string[] = [];
  for (const row of rows) {
    if (!row.source || !row.target) continue;
    seen.push(row.source);
    await pg.query(
      `INSERT INTO backlinks (site_id, source, target, anchor, domain_authority, authority, lost)
       VALUES ($1, $2, $3, $4, $5, $5, FALSE)
       ON CONFLICT (site_id, source, target)
       DO UPDATE SET anchor = EXCLUDED.anchor,
                     domain_authority = EXCLUDED.domain_authority,
                     authority = EXCLUDED.authority,
                     lost = FALSE`,
      [siteId, row.source, row.target, row.anchor ?? null, row.domainAuthority ?? null]
    );
  }

  // Anything this adapter no longer reports is a lost link.
  const lost = await pg.query(
    `UPDATE backlinks SET lost = TRUE
     WHERE site_id = $1 AND NOT (source = ANY($2::text[])) AND lost = FALSE`,
    [siteId, seen]
  );

  await publishUpdate({ kind: "backlinks", siteId, payload: { rows: seen.length, adapter: used } });
  return { rows: seen.length, adapter: used, lost: lost.rowCount ?? 0 };
}
