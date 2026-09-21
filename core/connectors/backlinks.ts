import type { Ctx } from "../ports.ts";
import { now, placeholders } from "../ports.ts";
import { getSecret } from "../secrets.ts";
import type { ConnectorStatus } from "../types";

/**
 * Backlink connector with pluggable adapters, tried in order of data quality:
 * paid APIs when their key is present, then Common Crawl, which needs no key.
 */

export type BacklinkRow = {
  source: string;
  target: string;
  anchor?: string | null;
  domainAuthority?: number | null;
};

type Adapter = {
  name: string;
  envVar?: string;
  fetch: (domain: string, key: string) => Promise<BacklinkRow[]>;
};

const ADAPTERS: Adapter[] = [
  {
    name: "ahrefs",
    envVar: "AHREFS_API_KEY",
    async fetch(domain, key) {
      const url = new URL("https://api.ahrefs.com/v3/site-explorer/all-backlinks");
      url.searchParams.set("target", domain);
      url.searchParams.set("limit", "200");
      url.searchParams.set("select", "url_from,url_to,anchor,domain_rating_source");
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) throw new Error(`ahrefs: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return (((await res.json()) as any).backlinks ?? []).map((b: any) => ({
        source: b.url_from,
        target: b.url_to,
        anchor: b.anchor ?? null,
        domainAuthority: b.domain_rating_source ?? null,
      }));
    },
  },
  {
    name: "moz",
    envVar: "MOZ_API_KEY",
    async fetch(domain, key) {
      const res = await fetch("https://lsapi.seomoz.com/v2/links", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-moz-token": key },
        body: JSON.stringify({ target: domain, target_scope: "domain", limit: 200 }),
      });
      if (!res.ok) throw new Error(`moz: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return (((await res.json()) as any).results ?? []).map((r: any) => ({
        source: r.source?.page ?? r.source_url,
        target: r.target?.page ?? r.target_url,
        anchor: r.anchor_text ?? null,
        domainAuthority: r.source?.domain_authority ?? null,
      }));
    },
  },
  {
    // Free, key-less, and therefore always available as a fallback.
    name: "commoncrawl",
    async fetch(domain) {
      const indexes = await fetch("https://index.commoncrawl.org/collinfo.json");
      if (!indexes.ok) throw new Error(`commoncrawl: index list ${indexes.status}`);
      const newest = ((await indexes.json()) as any)[0];
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
  },
];

export async function backlinkStatus(ctx: Ctx): Promise<ConnectorStatus[]> {
  return Promise.all(
    ADAPTERS.map(async (a) => {
      if (!a.envVar) return { name: a.name, enabled: true };
      const key = await getSecret(ctx, a.envVar);
      return { name: a.name, enabled: Boolean(key), reason: key ? undefined : `${a.envVar} not set` };
    })
  );
}

/** Referring hosts for any domain using only key-free data (clone engine). */
export async function fetchReferringHosts(domain: string): Promise<string[]> {
  const commonCrawl = ADAPTERS.find((a) => a.name === "commoncrawl")!;
  const rows = await commonCrawl.fetch(domain, "");
  const hosts = new Set<string>();
  for (const row of rows) {
    try {
      const host = new URL(row.source).hostname.replace(/^www\./, "");
      if (!host.endsWith(domain)) hosts.add(host);
    } catch {
      // Skip unparseable CDX entries.
    }
  }
  return [...hosts];
}

/**
 * Syncs backlinks using the best available adapter. Rows already stored but
 * absent from this pull are flagged lost rather than deleted, so link loss
 * stays visible.
 */
export async function syncBacklinks(
  ctx: Ctx,
  siteId: number,
  preferred?: string
): Promise<{ rows: number; adapter: string; lost: number }> {
  const site = await ctx.db.first<{ domain: string }>("SELECT domain FROM sites WHERE id = ?", [siteId]);
  if (!site) throw new Error(`site ${siteId} not found`);

  const candidates: { adapter: Adapter; key: string }[] = [];
  for (const adapter of ADAPTERS) {
    if (preferred && adapter.name !== preferred) continue;
    if (!adapter.envVar) {
      candidates.push({ adapter, key: "" });
      continue;
    }
    const key = await getSecret(ctx, adapter.envVar);
    if (key) candidates.push({ adapter, key });
  }
  if (!candidates.length) throw new Error(`no backlink adapter available (requested: ${preferred ?? "any"})`);

  let rows: BacklinkRow[] | null = null;
  let used = "";
  const errors: string[] = [];

  for (const { adapter, key } of candidates) {
    try {
      rows = await adapter.fetch(site.domain, key);
      used = adapter.name;
      break;
    } catch (e: any) {
      errors.push(`${adapter.name}: ${e.message}`);
    }
  }
  if (rows === null) throw new Error(`all backlink adapters failed — ${errors.join("; ")}`);

  const timestamp = now();
  const seen: string[] = [];

  for (const row of rows) {
    if (!row.source || !row.target) continue;
    seen.push(row.source);
    await ctx.db.run(
      `INSERT INTO backlinks (site_id, source, target, anchor, domain_authority, authority, lost, first_seen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT (site_id, source, target)
       DO UPDATE SET anchor = excluded.anchor,
                     domain_authority = excluded.domain_authority,
                     authority = excluded.authority,
                     lost = 0`,
      [
        siteId,
        row.source,
        row.target,
        row.anchor ?? null,
        row.domainAuthority ?? null,
        row.domainAuthority ?? null,
        timestamp,
        timestamp,
      ]
    );
  }

  // Anything this adapter no longer reports is a lost link. Built as an IN
  // list rather than a Postgres array so the statement works on D1 too.
  const lost = seen.length
    ? await ctx.db.run(
        `UPDATE backlinks SET lost = 1
         WHERE site_id = ? AND lost = 0 AND source NOT IN (${placeholders(seen.length)})`,
        [siteId, ...seen]
      )
    : await ctx.db.run("UPDATE backlinks SET lost = 1 WHERE site_id = ? AND lost = 0", [siteId]);

  await ctx.bus.publish({ kind: "backlinks", siteId, payload: { rows: seen.length, adapter: used } });
  return { rows: seen.length, adapter: used, lost: lost.changes };
}
