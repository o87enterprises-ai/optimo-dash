import type { Ctx } from "../ports.ts";
import { now, toBool } from "../ports.ts";

/** Site CRUD and the one-round-trip overview the dashboard opens with. */

/** Normalises user input to a bare registrable domain. */
export function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export async function listSites(ctx: Ctx) {
  return ctx.db.all("SELECT * FROM sites ORDER BY created_at DESC");
}

export async function addSite(ctx: Ctx, rawDomain: string, name?: string) {
  const domain = normalizeDomain(rawDomain);
  if (!domain.includes(".")) throw Object.assign(new Error("domain must look like example.com"), { status: 400 });

  const existing = await ctx.db.first("SELECT id FROM sites WHERE domain = ?", [domain]);
  if (existing) throw Object.assign(new Error("site already exists"), { status: 409 });

  await ctx.db.run("INSERT INTO sites (domain, name, created_at) VALUES (?, ?, ?)", [
    domain,
    name?.trim() || domain,
    now(),
  ]);
  // RETURNING is supported by both dialects but not by every driver path, so
  // read the row back explicitly.
  return ctx.db.first("SELECT * FROM sites WHERE domain = ?", [domain]);
}

export async function removeSite(ctx: Ctx, siteId: number) {
  await ctx.db.run("DELETE FROM sites WHERE id = ?", [siteId]);
}

/** Headline numbers for every layer, in one round trip. */
export async function getSummary(ctx: Ctx, siteId: number) {
  const site = await ctx.db.first("SELECT * FROM sites WHERE id = ?", [siteId]);
  if (!site) throw Object.assign(new Error("site not found"), { status: 404 });

  const [seo, geo, backlinks, reviews, citations] = await Promise.all([
    ctx.db.first<any>(
      `SELECT COUNT(*) AS n, SUM(clicks) AS clicks, SUM(impressions) AS impressions,
              CAST(AVG(position) AS REAL) AS avg_position
       FROM keywords WHERE site_id = ?`,
      [siteId]
    ),
    ctx.db.first<any>("SELECT COUNT(*) AS n, SUM(cited) AS cited FROM geo_prompts WHERE site_id = ?", [siteId]),
    ctx.db.first<any>(
      `SELECT SUM(CASE WHEN lost = 0 THEN 1 ELSE 0 END) AS live,
              SUM(CASE WHEN lost = 1 THEN 1 ELSE 0 END) AS lost
       FROM backlinks WHERE site_id = ?`,
      [siteId]
    ),
    ctx.db.first<any>(
      "SELECT COUNT(*) AS n, CAST(AVG(sentiment) AS REAL) AS sentiment, CAST(AVG(rating) AS REAL) AS rating FROM reviews WHERE site_id = ?",
      [siteId]
    ),
    ctx.db.first<any>(
      "SELECT COUNT(*) AS n, CAST(AVG(authority) AS REAL) AS authority FROM citations WHERE site_id = ?",
      [siteId]
    ),
  ]);

  const geoTotal = Number(geo?.n ?? 0);
  const geoCited = Number(geo?.cited ?? 0);

  return {
    site,
    seo: {
      n: Number(seo?.n ?? 0),
      clicks: Number(seo?.clicks ?? 0),
      impressions: Number(seo?.impressions ?? 0),
      avg_position: seo?.avg_position ?? null,
    },
    geo: {
      n: geoTotal,
      cited: geoCited,
      visibility: geoTotal ? Math.round((geoCited / geoTotal) * 100) : 0,
    },
    backlinks: { live: Number(backlinks?.live ?? 0), lost: Number(backlinks?.lost ?? 0) },
    reviews: { n: Number(reviews?.n ?? 0), sentiment: reviews?.sentiment ?? null, rating: reviews?.rating ?? null },
    citations: { n: Number(citations?.n ?? 0), authority: citations?.authority ?? null },
    updated: now(),
  };
}

export async function getRank(ctx: Ctx, siteId: number) {
  const keywords = await ctx.db.all(
    "SELECT * FROM keywords WHERE site_id = ? ORDER BY position LIMIT 200",
    [siteId]
  );
  return { keywords, updated: now() };
}

export async function getBacklinks(ctx: Ctx, siteId: number) {
  const rows = await ctx.db.all<any>(
    "SELECT * FROM backlinks WHERE site_id = ? ORDER BY domain_authority DESC, created_at DESC LIMIT 200",
    [siteId]
  );
  return { backlinks: rows.map((r) => ({ ...r, lost: toBool(r.lost) })) };
}

export async function getReviews(ctx: Ctx, siteId: number) {
  return {
    reviews: await ctx.db.all("SELECT * FROM reviews WHERE site_id = ? ORDER BY posted_at DESC LIMIT 200", [siteId]),
  };
}

export async function getCitations(ctx: Ctx, siteId: number) {
  const rows = await ctx.db.all<any>(
    "SELECT * FROM citations WHERE site_id = ? ORDER BY authority DESC LIMIT 200",
    [siteId]
  );
  return { citations: rows.map((r) => ({ ...r, verified: toBool(r.verified) })) };
}
