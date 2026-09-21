#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { Command } from "commander";

/**
 * seo-geo — command line for the SEO / AEO / GEO dashboard.
 *
 * Every command talks to the same REST API the GUI and MCP server use, so all
 * three surfaces expose identical capabilities. Add --json to any command for
 * machine-readable output.
 */

const API = process.env.API_URL || "http://localhost:4000";

/** Calls the API, turning a non-2xx into a readable CLI error. */
async function api(path: string, init?: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (e: any) {
    throw new Error(`cannot reach API at ${API} — is it running? (pnpm --filter api dev)\n  ${e.message}`);
  }

  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  return body;
}

/** Fetches a text/markdown response from the API. */
async function apiText(path: string, init?: RequestInit): Promise<string> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Accept: "text/markdown", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error((await res.text()) || `${res.status} ${res.statusText}`);
  return res.text();
}

/** Prints JSON when --json is set, otherwise the human-readable renderer. */
function output(opts: { json?: boolean }, data: unknown, pretty: (d: any) => void) {
  if (opts.json) console.log(JSON.stringify(data, null, 2));
  else pretty(data);
}

/** Renders rows as an aligned table. */
function table(rows: Record<string, unknown>[], columns: string[]) {
  if (!rows.length) return console.log("  (none)");
  const widths = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length))
  );
  const line = (cells: string[]) =>
    "  " + cells.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd();

  console.log(line(columns));
  console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) {
    console.log(line(columns.map((c) => truncate(String(r[c] ?? ""), 60))));
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Required --site, validated so a typo fails loudly instead of hitting /NaN. */
function requireSite(value: string | undefined): number {
  const id = Number(value);
  if (!value || !Number.isInteger(id) || id < 1) {
    throw new Error("--site <id> is required (see: seo-geo sites list)");
  }
  return id;
}

const program = new Command();
program
  .name("seo-geo")
  .description("SEO / AEO / GEO dashboard CLI")
  .version("0.1.0")
  .option("--json", "machine-readable output")
  // Without this, a parent's --site is consumed before its subcommand sees it,
  // so `geo probe --site 1` would fail as if --site were missing.
  .enablePositionalOptions();

/** --json is accepted globally or per-command. */
function opts(local: any): any {
  return { ...program.opts(), ...local };
}

/* ---------- health ---------- */

program
  .command("health")
  .description("check API, database and cache")
  .option("--json")
  .action(async (o) => {
    const d = await api("/health");
    output(opts(o), d, (h) => {
      console.log(`  API    ${h.ok ? "ok" : "down"}`);
      console.log(`  DB     ${h.db ? "ok" : "down"}`);
      console.log(`  Redis  ${h.redis ? "ok" : "down"}`);
    });
  });

program
  .command("connectors")
  .description("show which connectors are enabled and what each needs")
  .option("--json")
  .action(async (o) => {
    const d = await api("/api/connectors");
    output(opts(o), d, (c) => {
      const all = [
        ...c.llm.map((x: any) => ({ ...x, group: "llm" })),
        { ...c.gsc, group: "seo" },
        ...c.backlinks.map((x: any) => ({ ...x, group: "backlinks" })),
        ...c.reviews.map((x: any) => ({ ...x, group: "reviews" })),
      ];
      table(
        all.map((x) => ({
          group: x.group,
          connector: x.name,
          status: x.enabled ? "enabled" : "disabled",
          reason: x.reason ?? "",
        })),
        ["group", "connector", "status", "reason"]
      );
    });
  });

/* ---------- sites ---------- */

const sites = program.command("sites").description("manage tracked sites");

sites
  .command("list")
  .description("list tracked sites")
  .option("--json")
  .action(async (o) => {
    const d = await api("/api/sites");
    output(opts(o), d, (rows) => table(rows, ["id", "domain", "name", "created_at"]));
  });

sites
  .command("add <domain>")
  .description("start tracking a site")
  .option("--name <name>")
  .option("--json")
  .action(async (domain, o) => {
    const d = await api("/api/sites", {
      method: "POST",
      body: JSON.stringify({ domain, name: o.name }),
    });
    output(opts(o), d, (s) => console.log(`  added #${s.id} ${s.domain}`));
  });

sites
  .command("remove <id>")
  .description("stop tracking a site and delete its data")
  .action(async (id) => {
    await api(`/api/sites/${Number(id)}`, { method: "DELETE" });
    console.log(`  removed site ${id}`);
  });

/* ---------- data ---------- */

program
  .command("rank")
  .description("keyword rankings for a site")
  .requiredOption("--site <id>")
  .option("--json")
  .action(async (o) => {
    const d = await api(`/api/sites/${requireSite(o.site)}/rank`);
    output(opts(o), d, (r) =>
      table(r.keywords, ["keyword", "position", "clicks", "impressions", "country", "device"])
    );
  });

const geo = program
  .command("geo")
  .description("LLM visibility for a site")
  .option("--site <id>")
  .option("--json")
  .passThroughOptions()
  .action(async (o) => {
    const d = await api(`/api/sites/${requireSite(o.site)}/geo`);
    output(opts(o), d, (g) => {
      console.log(`  Visibility: ${g.visibility}% across ${g.prompts.length} prompts`);
      for (const [model, m] of Object.entries<any>(g.byModel)) {
        console.log(`    ${model.padEnd(12)} ${m.visibility}% (${m.cited}/${m.total})`);
      }
      console.log();
      table(
        g.prompts.map((p: any) => ({
          prompt: p.prompt,
          model: p.model,
          cited: p.cited ? "yes" : "no",
          excerpt: truncate(p.excerpt ?? "", 50),
        })),
        ["prompt", "model", "cited", "excerpt"]
      );
    });
  });

geo
  .command("probe")
  .description("ask the LLMs a question and record whether they cite your domain")
  .requiredOption("--site <id>")
  .requiredOption("--prompt <text>")
  .option("--models <list>", "comma-separated subset, e.g. gpt-4o,claude-3.5")
  .option("--json")
  .action(async (o) => {
    const models = o.models ? String(o.models).split(",").map((m) => m.trim()) : undefined;
    const d = await api(`/api/sites/${requireSite(o.site)}/prompts`, {
      method: "POST",
      body: JSON.stringify({ prompt: o.prompt, models }),
    });
    output(opts(o), d, (r) => {
      console.log(`  "${r.prompt}"`);
      for (const res of r.results) {
        const mark = res.error ? "!" : res.cited ? "✓" : "✗";
        console.log(`    ${mark} ${res.model.padEnd(12)} ${res.error ?? truncate(res.excerpt, 60)}`);
      }
    });
  });

program
  .command("backlinks")
  .description("backlinks for a site")
  .requiredOption("--site <id>")
  .option("--json")
  .action(async (o) => {
    const d = await api(`/api/sites/${requireSite(o.site)}/backlinks`);
    output(opts(o), d, (b) =>
      table(
        b.backlinks.map((x: any) => ({
          source: x.source,
          anchor: x.anchor ?? "",
          da: x.domain_authority ?? "",
          lost: x.lost ? "yes" : "",
        })),
        ["source", "anchor", "da", "lost"]
      )
    );
  });

program
  .command("reviews")
  .description("reviews for a site")
  .requiredOption("--site <id>")
  .option("--json")
  .action(async (o) => {
    const d = await api(`/api/sites/${requireSite(o.site)}/reviews`);
    output(opts(o), d, (r) =>
      table(
        r.reviews.map((x: any) => ({
          source: x.source,
          rating: x.rating ?? "",
          sentiment: x.sentiment != null ? x.sentiment.toFixed(2) : "",
          body: truncate(x.body ?? "", 50),
        })),
        ["source", "rating", "sentiment", "body"]
      )
    );
  });

program
  .command("citations")
  .description("authority-scored citations for a site")
  .requiredOption("--site <id>")
  .option("--json")
  .action(async (o) => {
    const d = await api(`/api/sites/${requireSite(o.site)}/citations`);
    output(opts(o), d, (c) => table(c.citations, ["kind", "authority", "source", "url"]));
  });

program
  .command("regional")
  .description("regional metrics for a site")
  .requiredOption("--site <id>")
  .option("--metric <name>", "clicks | impressions | rank | llm_citations")
  .option("--json")
  .action(async (o) => {
    const q = o.metric ? `?metric=${encodeURIComponent(o.metric)}` : "";
    const d = await api(`/api/sites/${requireSite(o.site)}/regional${q}`);
    output(opts(o), d, (r) => {
      const rows = Object.entries<any>(r.countries).map(([country, m]) => ({ country, ...m }));
      table(rows, ["country", "clicks", "impressions", "rank", "llm_citations"]);
    });
  });

/* ---------- syncs ---------- */

const sync = program.command("sync").description("pull fresh data from a connector");

for (const [name, desc] of [
  ["gsc", "Google Search Console keyword performance"],
  ["backlinks", "backlinks via Ahrefs, Moz or Common Crawl"],
  ["reviews", "reviews from every configured platform"],
  ["citations", "authority-scored citations derived from backlinks"],
  ["regional", "country rollup for the world map"],
] as const) {
  sync
    .command(name)
    .description(desc)
    .requiredOption("--site <id>")
    .option("--json")
    .action(async (o) => {
      const d = await api(`/api/sites/${requireSite(o.site)}/sync/${name}`, { method: "POST" });
      output(opts(o), d, (r) => console.log(`  ${name}: ${JSON.stringify(r)}`));
    });
}

/* ---------- clone & debrief ---------- */

program
  .command("clone")
  .description("reverse-engineer a competitor's public strategy")
  .requiredOption("--target <domain>")
  .requiredOption("--site <id>")
  .option("--json")
  .action(async (o) => {
    const d = await api("/api/clone", {
      method: "POST",
      body: JSON.stringify({ targetDomain: o.target, siteId: requireSite(o.site) }),
    });
    output(opts(o), d, (r) => {
      console.log(`  Target: ${r.targetDomain} (${r.pagesAnalyzed} pages analysed — all figures estimated)`);
      console.log(`  Topic gaps:    ${r.yourGaps.topics.slice(0, 8).join(", ") || "none"}`);
      console.log(`  Schema gaps:   ${r.yourGaps.schema.join(", ") || "none"}`);
      console.log(`  Backlink gaps: ${r.yourGaps.backlinks.slice(0, 5).join(", ") || "none"}`);
      console.log("\n  Recommended actions:");
      table(
        r.recommendedActions.map((a: any) => ({
          p: a.priority,
          type: a.type,
          action: a.title,
        })),
        ["p", "type", "action"]
      );
    });
  });

program
  .command("debrief")
  .description("generate copy-ready prompts for an agency or another LLM")
  .requiredOption("--site <id>")
  .option("--scope <scope>", "full | content | aeo | geo | regional", "full")
  .option("--audience <text>")
  .option("--tone <text>")
  .option("--country <code>", "ISO-3166 alpha-2, for regional scope")
  .option("--out <file>", "write markdown to a file")
  .option("--json")
  .action(async (o) => {
    const d = await api(`/api/sites/${requireSite(o.site)}/debrief`, {
      method: "POST",
      body: JSON.stringify({
        scope: o.scope,
        targetAudience: o.audience,
        tone: o.tone,
        country: o.country,
      }),
    });

    if (o.out) {
      // The API renders the markdown so the CLI export and the GUI export
      // are byte-identical.
      const md = await apiText(`/api/sites/${requireSite(o.site)}/debrief?format=md`, {
        method: "POST",
        body: JSON.stringify({
          scope: o.scope,
          targetAudience: o.audience,
          tone: o.tone,
          country: o.country,
        }),
      });
      const file = resolve(process.cwd(), o.out);
      writeFileSync(file, md, "utf8");
      console.log(`  wrote ${d.prompts.length} prompts to ${file}`);
      return;
    }

    output(opts(o), d, (r) => {
      console.log(`  ${r.summary}\n`);
      for (const p of r.prompts) console.log(`  [${p.id}] ${p.category} — ${p.title}`);
      console.log("\n  Use --out debrief.md to export the full prompt text.");
    });
  });

/* ---------- stream ---------- */

program
  .command("stream")
  .description("tail the live update feed")
  .option("--site <id>", "only events for this site")
  .action(async (o) => {
    const q = o.site ? `?site=${Number(o.site)}` : "";
    const res = await fetch(`${API}/api/stream${q}`, { headers: { Accept: "text/event-stream" } });
    if (!res.ok || !res.body) throw new Error(`stream failed: ${res.status}`);
    console.log(`  tailing ${API}/api/stream${q} — ctrl-c to stop`);

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body as any) {
      buffer += decoder.decode(chunk, { stream: true });
      // SSE frames are separated by a blank line.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
        if (!data) continue;
        const event = JSON.parse(data);
        if (event.kind === "heartbeat") continue;
        console.log(`  ${event.at}  ${event.kind}  site=${event.siteId ?? "-"}  ${JSON.stringify(event.payload ?? {})}`);
      }
    }
  });

/* ---------- mcp ---------- */

program
  .command("mcp")
  .argument("[action]", "serve", "serve")
  .description("run the MCP server over stdio for AI agents")
  .action((action) => {
    if (action !== "serve") throw new Error("usage: seo-geo mcp serve");
    // Hand stdio straight to the server; the protocol owns this channel.
    const child = spawn("pnpm", ["--filter", "mcp", "start"], { stdio: "inherit" });
    child.on("exit", (code) => process.exit(code ?? 0));
  });

program.parseAsync().catch((e: any) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
