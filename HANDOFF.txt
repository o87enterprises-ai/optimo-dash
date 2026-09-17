HANDOFF.md — SEO / AEO / GEO Dashboard

Save as ~/seo-aeo-geo-dashboard/HANDOFF.md

This is the single source of truth for finishing the build. It covers where you are, what remains, and detailed specs for the next three phases (3D interface, comparison/clone, world map + prompt debrief).

---

1. Current state (what works today)

Layer Status Notes
Termux toolchain ✅ Node 24, Python 3.14, Poetry, pnpm, Postgres 18, Redis 8
Postgres ✅ sites, keywords, geo_prompts, backlinks tables
Redis ✅ running on 6379
API (apps/api) ✅ Express on :4000, health + site CRUD + per-site stubs
Web (apps/web) ✅ Next.js 15.5 on :3000, site add/remove, live polling
CLI (packages/cli) ⚠️ scaffolded, unwired
MCP server (packages/mcp) ⚠️ 4 tools stubbed
Analytics (packages/analytics) ⚠️ venv works, no modules yet

Known quirks to keep in mind:

· Termux + Next.js: keep next@15 with WASM SWC. Do not add --turbopack.
· next.config.js must not contain swcMinify (removed in Next 15).
· .env lives at repo root. API loads it via path.resolve(__dirname, "../../../.env").
· DATABASE_URL uses your Termux user: postgresql://u0_a459@localhost:5432/seo_aeo_geo.
· API port = 4000, Web port = 3000.

---

2. Environment variables

Extend .env with the following as you enable each connector. Any not set → that feature is disabled gracefully in the UI (greyed out, "add key to enable").

```bash
# --- LLM visibility (GEO) ---
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_AI_API_KEY=
PERPLEXITY_API_KEY=

# --- SEO data sources ---
GOOGLE_SEARCH_CONSOLE_CREDENTIALS=   # path to service-account JSON
GA4_PROPERTY_ID=
BING_WEBMASTER_API_KEY=
AHREFS_API_KEY=
SEMRUSH_API_KEY=
MOZ_API_KEY=

# --- Reviews / citations ---
GOOGLE_BUSINESS_API_KEY=
TRUSTPILOT_API_KEY=
G2_API_KEY=

# --- Notifications ---
SLACK_WEBHOOK_URL=
SMTP_URL=

# --- 3D / map ---
NEXT_PUBLIC_MAPBOX_TOKEN=            # or use free Leaflet + OSM
NEXT_PUBLIC_CESIUM_ION_TOKEN=        # only if using Cesium
```

---

3. Remaining backend work

Build in this order. Each block is independent; you can pause between them.

3.1 LLM visibility probe (highest priority)

File: apps/api/src/probes/llm.ts

Purpose: For each prompt attached to a site, query one or more LLMs, detect brand/domain mentions, persist to geo_prompts.

Function signature:

```ts
export async function probeLLM(opts: {
  siteId: number;
  prompt: string;
  models?: Array<"gpt-4o"|"claude-3.5"|"gemini-1.5"|"perplexity">;
}): Promise<{ model: string; cited: boolean; excerpt: string }[]>
```

Logic:

1. For each enabled model, call its API with the prompt.
2. Scan response for the site's domain (and any aliases you add to sites later).
3. If found → cited = true, capture ±200 chars around the mention as excerpt.
4. Insert one row per (site, prompt, model) into geo_prompts with cited, excerpt, updated_at.
5. Return summary.

Rate limiting: serial per provider, ~1 req/sec, exponential backoff on 429.

Cost control: cache responses by sha256(prompt + model) in Redis for 24h.

New endpoint:

· POST /api/sites/:id/prompts — body { prompt, models? } — kicks off probe, returns run id.
· GET /api/sites/:id/geo — already exists, extend to include excerpt and per-model breakdown.

---

3.2 Google Search Console connector

File: apps/api/src/connectors/gsc.ts

· OAuth2 via googleapis npm package.
· Endpoint: POST /api/sites/:id/sync/gsc — pulls last 28 days of query + page + clicks + impressions + position.
· Writes into keywords (site_id, keyword, position, impressions, clicks).
· Extend keywords table:
  ```sql
  ALTER TABLE keywords
    ADD COLUMN impressions INT DEFAULT 0,
    ADD COLUMN clicks INT DEFAULT 0,
    ADD COLUMN country TEXT,
    ADD COLUMN device TEXT;
  ```

---

3.3 Backlinks connector

File: apps/api/src/connectors/backlinks.ts

· Pluggable: AhrefsAdapter, MozAdapter, CommonCrawlAdapter (free), OwnCrawlerAdapter.
· Endpoint: POST /api/sites/:id/sync/backlinks.
· Extend backlinks:
  ```sql
  ALTER TABLE backlinks
    ADD COLUMN anchor TEXT,
    ADD COLUMN domain_authority INT,
    ADD COLUMN first_seen TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN lost BOOLEAN DEFAULT FALSE;
  ```

---

3.4 Reviews + citations

File: apps/api/src/connectors/reviews.ts

· Google Business Profile, Trustpilot, G2, Yelp, App Store, Play Store.
· New tables:
  ```sql
  CREATE TABLE reviews (
    id SERIAL PRIMARY KEY,
    site_id INT REFERENCES sites(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    author TEXT,
    rating INT,
    body TEXT,
    sentiment REAL,
    posted_at TIMESTAMPTZ,
    url TEXT
  );
  
  CREATE TABLE citations (
    id SERIAL PRIMARY KEY,
    site_id INT REFERENCES sites(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    url TEXT NOT NULL,
    authority INT,
    kind TEXT,           -- gov | edu | journal | directory | social
    verified BOOLEAN DEFAULT FALSE,
    discovered_at TIMESTAMPTZ DEFAULT NOW()
  );
  ```

---

3.5 Regional data (needed for world map)

File: apps/api/src/connectors/regional.ts

· Sources: GSC country dimension, Bing Webmaster geo, SimilarWeb (paid), or free Common Crawl geo hints.
· New table:
  ```sql
  CREATE TABLE regional_metrics (
    id SERIAL PRIMARY KEY,
    site_id INT REFERENCES sites(id) ON DELETE CASCADE,
    country TEXT NOT NULL,      -- ISO-3166 alpha-2
    region TEXT,                -- optional sub-region
    metric TEXT NOT NULL,       -- 'clicks' | 'impressions' | 'rank' | 'llm_citations'
    value REAL,
    captured_at TIMESTAMPTZ DEFAULT NOW()
  );
  ```

---

3.6 SSE live stream

File: apps/api/src/stream.ts

· Endpoint: GET /api/stream — Server-Sent Events.
· Every 5 seconds, push a diff of changed rows (keywords, geo_prompts, backlinks) via Redis pub/sub.
· Client subscribes once and receives incremental updates instead of polling.

```ts
app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const sub = redis.duplicate();
  sub.subscribe("dash:updates");
  sub.on("message", (_ch, msg) => res.write(`data: ${msg}\n\n`));
  req.on("close", () => sub.disconnect());
});
```

---

3.7 Clone engine

File: apps/api/src/clone.ts

Purpose: Take a target domain, reverse-engineer its public strategy, output an actionable plan for the user's own site.

Input: POST /api/clone body { targetDomain, siteId }

Steps (all free-tier where possible):

1. Crawl target — fetch sitemap.xml, then top N URLs, extract:
   · Title, H1/H2/H3 structure
   · Word count per page
   · Schema.org types present
   · Internal link graph
   · Meta description patterns
2. Keyword surface — pull top keywords via free tier of GSC (if user's site) or estimate from page text + headings.
3. Backlink footprint — Common Crawl or free Ahrefs/Moz trial.
4. LLM probe — run 20 prompts derived from the target's H2s/H3s against each LLM. Record which sources the LLMs cite.
5. Gap analysis — diff against user's site:
   · Content topics target covers that user doesn't
   · Schema types target uses that user doesn't
   · Backlink domains target has that user doesn't
   · LLM prompts where target is cited but user isn't
6. Output:
   ```json
   {
     "targetDomain": "...",
     "yourGaps": {
       "topics": [...],
       "schema": [...],
       "backlinks": [...],
       "llmPrompts": [...]
     },
     "recommendedActions": [
       { "type": "content", "title": "...", "priority": 1, "rationale": "..." },
       { "type": "schema", "type_value": "FAQPage", "priority": 1 },
       { "type": "outreach", "domain": "...", "priority": 2 }
     ]
   }
   ```

Persist to: new table clone_reports (id, site_id, target_domain, report JSONB, created_at).

---

3.8 Prompt engineering debrief (for outsourcing)

File: apps/api/src/debrief.ts

Purpose: Convert raw SEO/AEO/GEO findings into LLM-ready prompts a user can paste into ChatGPT/Claude to brief a third-party agency or to execute themselves.

Input: POST /api/sites/:id/debrief body { scope: 'full'|'content'|'aeo'|'geo'|'regional', targetAudience?, tone? }

Output structure:

```json
{
  "summary": "...",
  "prompts": [
    {
      "id": "content-1",
      "category": "content",
      "title": "Write 5 pillar pages",
      "prompt": "You are an SEO content strategist. For [domain] targeting [audience], produce a content plan that...",
      "inputs": { "topics": [...], "keywords": [...] }
    },
    {
      "id": "aeo-1",
      "category": "aeo",
      "title": "Generate FAQ schema for top 20 pages",
      "prompt": "Given these pages and their primary questions, output valid FAQPage JSON-LD for each..."
    },
    {
      "id": "geo-1",
      "category": "geo",
      "title": "Improve LLM citation rate",
      "prompt": "For each prompt below, analyze why [competitor] is cited over us and propose content changes..."
    },
    {
      "id": "regional-1",
      "category": "regional",
      "title": "Localize top pages for [country]",
      "prompt": "Adapt these pages for [country], preserving SEO intent and adding hreflang..."
    }
  ]
}
```

UI: "Debrief" tab → user picks scope → sees list of prompts with Copy buttons → can export all as .md or .txt.

Rules for prompt generation:

· Always include role, task, constraints, output format, and evaluation criteria.
· Always embed the site's actual data (topics, keywords, competitor names) so the prompt is self-contained.
· Include a "success criteria" section so agency output is measurable.

---

4. MCP server wiring

File: packages/mcp/src/server.ts

Replace stub handlers with real calls to the API:

MCP tool Hits Returns
list_sites GET /api/sites array of sites
get_live_rankings GET /api/sites/:id/rank keyword table
get_llm_visibility GET /api/sites/:id/geo prompts + visibility %
list_backlinks GET /api/sites/:id/backlinks backlink rows
run_geo_prompt POST /api/sites/:id/prompts probe result
clone_strategy POST /api/clone clone report
generate_debrief POST /api/sites/:id/debrief prompt pack

Add MCP resources: site://list, site://{id}/summary, site://{id}/geo.

---

5. CLI expansion

File: packages/cli/src/index.ts

Add commands:

```bash
seo-geo sites list
seo-geo sites add <domain>
seo-geo rank --site <id>
seo-geo geo --site <id>
seo-geo geo probe --site <id> --prompt "best crm for startups"
seo-geo backlinks --site <id>
seo-geo reviews --site <id>
seo-geo clone --target competitor.com --site <id>
seo-geo debrief --site <id> --scope full --out debrief.md
seo-geo stream --site <id>          # tails the SSE feed
seo-geo mcp serve
```

All commands accept --json for machine-readable output.

---

6. Web GUI — the 3D-first redesign

This is the focal point. The dashboard's top half becomes a 3D interactive scene; the text/table UI sits directly beneath it.

6.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│  Header: brand · site switcher · view mode · fullscreen │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                  3D SCENE (60–70 vh)                    │
│         zoom / pan / tilt / orbit / fullscreen          │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  Text panel: cards, tables, live feed, debrief tabs     │
└─────────────────────────────────────────────────────────┘
```

6.2 Tech choice

Recommended: react-three-fiber + drei + three.js.

Install:

```bash
pnpm --filter web add three @react-three/fiber @react-three/drei @react-three/postprocessing
```

Fallback (lighter for Termux): deck.gl with OrbitView — better perf on mobile, less code.

Android perf note: cap at 60 fps, use <Canvas dpr={[1, 2]}>, and disable shadows on mid-range devices.

6.3 Scene content — "Data Galaxy"

Each site is rendered as a central node. Orbiting nodes represent data categories:

Orbit ring Represents Visual
Inner Pages / URLs small spheres, size = traffic
Mid Keywords octahedrons, color = position (green→red)
Outer LLM prompts torus knots, glowing if cited
Outer-outer Backlinks connecting arcs to invisible "source" spheres
Around Reviews / Citations small tetrahedrons, color = sentiment

Interactions:

· OrbitControls (drei) — one-finger drag = rotate, two-finger pinch = zoom, two-finger twist = tilt.
· Fullscreen toggle button in header → requestFullscreen() on the canvas container.
· Reset view button.
· Auto-rotate toggle.

6.4 Hover / tap modals

Use drei's <Html> or onPointerOver on each mesh:

```tsx
<mesh
  onPointerOver={(e) => setHover({ id, kind, data: e.object.userData })}
  onPointerOut={() => setHover(null)}
>
```

Hover popup shows:

· Category (Page / Keyword / Prompt / Backlink / Review)
· Primary metric
· Delta vs last period
· Mini sparkline (last 14 days)
· "Open detail" button → scrolls to text table below, filters to that row

6.5 View modes (header switcher)

```
[ My Sites ] [ Global ] [ Top Performers ] [ Comparison ]
```

· My Sites — show only the user's registered sites.
· Global — aggregate anonymized benchmarks (populated by your own telemetry across users; until then, seed with public industry averages or a static JSON).
· Top Performers — leaderboard of top N sites in the same category (requires a public source; can be a curated static list).
· Comparison — superimpose user's site over a chosen benchmark. Two rendering modes:
  · Overlay: user = solid, benchmark = wireframe.
  · Side-by-side: split scene vertically, synced camera.

6.6 Site switcher

Header dropdown: All | Site A | Site B | + Add.

When All is selected, the 3D scene shows one node per site, connected by an aggregate hub. Clicking a node focuses that site.

6.7 Filters

Floating panel (bottom-right of canvas):

· Date range: 24h / 7d / 28d / 90d / custom
· Metric: rank / clicks / impressions / citations / sentiment
· Category toggles: SEO · AEO · GEO · Backlinks · Citations · Reviews

Filters apply to both 3D scene and text panel simultaneously.

6.8 Text panel below the 3D scene

Tabs:

1. Overview — 6 summary cards (SEO, AEO, GEO, Backlinks, Citations, Reviews) with sparklines.
2. Keywords — sortable table, GSC-style.
3. GEO prompts — prompt, model, cited (✓/✗), excerpt, timestamp.
4. Backlinks — table with source, anchor, DA, first/last seen.
5. Reviews — inbox with sentiment, source, rating, draft-reply button.
6. Citations — quality-scored list with authority badges.
7. Clone — run clone report, view gaps, action list.
8. Debrief — prompt pack generator with copy/export.
9. Regional — world map (see §7) plus country table.

6.9 Real-time

Replace 5s polling with SSE:

```tsx
useEffect(() => {
  const es = new EventSource("/api/stream");
  es.onmessage = (e) => setLiveData(JSON.parse(e.data));
  return () => es.close();
}, []);
```

3D scene reads from liveData — new keywords/prompts/backlinks appear as animated node spawns (scale from 0 → 1 over 400ms).

---

7. World map — regional SEO/AEO/GEO intel

7.1 Tech

Free: Leaflet + OpenStreetMap tiles (react-leaflet).
Premium: Mapbox GL JS (needs token).

Recommended: Leaflet for the free tier, swap to Mapbox if you add a key.

```bash
pnpm --filter web add leaflet react-leaflet
```

7.2 Layers

1. Choropleth — countries shaded by chosen metric (clicks, rank, LLM citations).
2. Bubbles — city-level dots scaled by traffic.
3. Flow arcs — backlink origin → target (great-circle arcs).
4. Heat — LLM citation density across regions.

7.3 Interaction

· Click country → drill-down panel: top keywords, top pages, top prompts, competitor presence.
· Hover → tooltip with the metric + delta.
· Toggle layers from a side panel.

7.4 Debrief integration

The world map has a "Generate regional debrief" button. It calls /api/sites/:id/debrief?scope=regional&country=DE and produces prompts like:

"Localize the following pages for the German market. Preserve keyword intent. Add hreflang. Adjust schema for de-DE. Here are the pages and their current English topics: …"

---

8. Recommended file structure (target)

```
seo-aeo-geo-dashboard/
├── HANDOFF.md
├── .env / .env.example
├── package.json
├── pnpm-workspace.yaml
├── docker-compose.yml
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── migrate.ts
│   │       ├── stream.ts
│   │       ├── clone.ts
│   │       ├── debrief.ts
│   │       ├── probes/llm.ts
│   │       └── connectors/
│   │           ├── gsc.ts
│   │           ├── backlinks.ts
│   │           ├── reviews.ts
│   │           └── regional.ts
│   └── web/
│       └── app/
│           ├── layout.tsx
│           ├── globals.css
│           ├── page.tsx
│           └── components/
│               ├── Scene3D.tsx
│               ├── HoverModal.tsx
│               ├── ViewModeSwitcher.tsx
│               ├── SiteSwitcher.tsx
│               ├── FilterPanel.tsx
│               ├── WorldMap.tsx
│               ├── ClonePanel.tsx
│               ├── DebriefPanel.tsx
│               └── panels/
│                   ├── Keywords.tsx
│                   ├── GeoPrompts.tsx
│                   ├── Backlinks.tsx
│                   ├── Reviews.tsx
│                   └── Citations.tsx
├── packages/
│   ├── cli/
│   ├── mcp/
│   └── analytics/
└── shared/
    └── types.ts        # shared TS types across api/web/cli/mcp
```

---

9. Build order (recommended)

Phase Deliverable Est. effort
1 LLM probe + geo_prompts filling + SSE stream 1–2 sessions
2 3D scene (static data), hover modals, fullscreen, filters 2–3 sessions
3 View mode switcher + comparison overlay 1 session
4 World map with choropleth + drill-down 1–2 sessions
5 Clone engine (public-data-only MVP) 2 sessions
6 Debrief generator + copy/export UI 1 session
7 GSC + backlinks + reviews connectors 2–3 sessions
8 MCP + CLI wiring to real endpoints 1 session
9 Auth, multi-tenant, RBAC, deploy later

---

10. Guardrails and known limits

· Clone engine uses only public/free data. Do not scrape behind logins or ToS-restricted sources. Label all estimates as "estimated."
· LLM probes cost money. Default to 1 model, 20 prompts max, cached 24h. Show estimated cost before running.
· Global benchmarks are only meaningful once you have multiple users. Until then, seed with a static JSON of industry averages and clearly label as "reference data."
· Termux perf: 3D scene should degrade gracefully — if navigator.hardwareConcurrency < 4, drop to 2D charts automatically with a "3D unavailable on this device" notice.
· Postgres on Termux must be started manually each session (pg_ctl ... start). Wrap in ~/SEO/start-stack.sh.
· Secrets: never commit .env. Rotate keys if leaked.

---

11. Startup cheat sheet

Every fresh Termux session:

```bash
pg_ctl -D $PREFIX/var/lib/postgresql -l $PREFIX/var/log/postgresql.log start
redis-server --daemonize yes

# Session A
cd ~/seo-aeo-geo-dashboard && termux-wake-lock && pnpm --filter api dev

# Session B
cd ~/seo-aeo-geo-dashboard && pnpm dev
```

Open http://localhost:3000.

---

12. Definition of done

The project is "feature-complete for v1" when:

☐ A user can register a site and see live data populate within 60 seconds
☐ The 3D scene renders, is interactive on touch and mouse, and has hover modals
☐ View modes switch between My / Global / Top / Comparison
☐ World map shows regional metrics with drill-down
☐ Clone report runs against a public competitor and lists actionable gaps
☐ Debrief generates copy-ready prompts for all four scopes
☐ SSE streams updates without polling
☐ CLI and MCP expose the same capabilities as the GUI
☐ pnpm -r build passes clean
☐ All secrets in .env, nothing hardcoded

---

13. Next action

Open apps/api/src/probes/llm.ts, implement the LLM probe, wire one endpoint, and watch the GEO card come alive. Everything else in this document builds on that foundation.

For 3D: pnpm --filter web add three @react-three/fiber @react-three/drei and stub <Scene3D /> with 3 orbiting spheres reading from /api/sites/:id/geo.

Ping back with the file you want written next — probe, 3D scene, world map, or debrief generator — and I'll write it in full.
