# SEO / AEO / GEO Dashboard

A live, self-hosted dashboard for tracking **SEO**, **AEO** (Answer Engine Optimization), and **GEO** (Generative Engine Optimization) — plus backlinks, citations, and reviews — for any website you own.

**Live preview:** https://optimo-dash.pages.dev — running on Cloudflare Pages
with D1 and KV. It is private by default, so it shows the sign-in screen until
you create the admin account.

Built to run **entirely on Termux (Android)** with no cloud dependency, then deployable to Vercel / Railway / Fly.io when you're ready.

- **Non-programmers** get a GUI with add/remove sites, live cards, and one-click debriefs.
- **Developers** get a CLI, REST API, MCP server for AI agents, and a shared TypeScript type layer.

---

## Features

| Layer | What it does |
|---|---|
| **SEO** | Keyword rankings, impressions, clicks and position via Google Search Console. A Bing Webmaster connector is _planned_. |
| **AEO** | FAQ schema coverage and question-keyword analysis, surfaced through the clone report and debrief. Featured snippet / People Also Ask capture is _planned_. |
| **GEO** | Prompt-based LLM visibility — checks whether GPT, Claude, Gemini, Perplexity cite your domain when asked real user questions. |
| **Backlinks** | New/lost links, domain authority, anchor text, competitor gaps. Ahrefs and Moz when keyed, Common Crawl for free. |
| **Citations** | Authority-scored credible sources (.gov, .edu, journals, directories). |
| **Reviews** | Google Business, Trustpilot and G2, with sentiment scoring. Yelp, App Store, Play Store and reply drafting are _planned_. |
| **3D View** _(planned)_ | Interactive "data galaxy" — zoom / pan / tilt / fullscreen on touch or mouse. Hover any node for detail modals. |
| **Comparison** _(planned)_ | Overlay your site against global benchmarks, top performers, or a specific competitor. |
| **World Map** _(planned)_ | Regional SEO/AEO/GEO intel with choropleth, bubbles, and flow arcs. The `/api/sites/:id/regional` data behind it is live. |
| **Clone Engine** | Reverse-engineer a public competitor's content/schema/backlink strategy using only free data. |
| **Debrief** | Turn raw findings into prompt-engineering-grade prompts you can hand to an agency or paste into ChatGPT/Claude. |

---

## Architecture

The same application runs in two places. Business logic lives in `core/` and
depends only on small interfaces; each runtime supplies its own storage.

```
┌──────────────────────────────────────────────────────────┐
│  core/          shared logic — routes, services,         │
│                 connectors, crypto, auth, schema         │
│                 (no runtime-specific imports)            │
├──────────────────────────────────────────────────────────┤
│  adapters/d1.ts        D1 + KV        → Cloudflare       │
│  adapters/postgres.ts  Postgres + Redis → self-hosted    │
├──────────────────────────────────────────────────────────┤
│  functions/api/  Cloudflare Pages Function (Hono)        │
│  apps/api/       Node server (Hono + @hono/node-server)  │
├──────────────────────────────────────────────────────────┤
│  apps/web/       Next.js 15 GUI                          │
│  packages/cli    seo-geo command line                    │
│  packages/mcp    Model Context Protocol server           │
│  packages/analytics  Python (pandas, sklearn)            │
└──────────────────────────────────────────────────────────┘
```

| | Cloudflare Pages | Self-hosted |
|---|---|---|
| Storage | D1 (SQLite) | PostgreSQL |
| Cache | KV | Redis |
| Live updates | polling | SSE (`/api/stream`) |
| Hosting | global edge, free tier | Termux, VPS, Docker |

Schema and queries are written once and work on both: one dialect-neutral SQL
style, `?` placeholders rewritten for Postgres, booleans stored as 0/1, and
timestamps as ISO-8601 text.

---

## Requirements

**Cloudflare Pages** — a Cloudflare account and `wrangler`. Nothing else to run.
Note that the clone engine crawls dozens of pages per run, which exceeds the
Workers *free* plan's 50-subrequest / 10ms-CPU limits; lower `CLONE_MAX_PAGES`
to about 8 on free, or run on Workers Paid.

**Termux (Android)** — Termux from F-Droid (not Play Store), ~2 GB free space,
Node 22+, Python 3.11+, Postgres 16+, Redis 7+.

**Windows 11 / macOS / Linux** — Node 22+, Python 3.11+, Postgres 16+, Redis 7+.

---

## Deploy to Cloudflare Pages

```bash
# 1. Create the database and cache.
npx wrangler d1 create seo-aeo-geo
npx wrangler kv namespace create SEO_CACHE
#    Paste the returned ids into wrangler.toml.

# 2. Set the secrets.
npx wrangler pages secret put ENCRYPTION_KEY   # openssl rand -base64 32
npx wrangler pages secret put SETUP_TOKEN      # openssl rand -hex 16

# 3. Build the static site and deploy it with its API.
pnpm pages:deploy
```

See **[docs/DEPLOY.md](./docs/DEPLOY.md)** for the exact sequence used for the live preview.

Then open the deployment, go to **Settings**, run the one-click migration,
create your admin account using the setup token, and paste your API keys.

`ENCRYPTION_KEY` is what protects your stored keys — **back it up**. If it is
lost or rotated, every stored credential becomes undecryptable and has to be
re-entered.

Run it locally the same way Cloudflare will:

```bash
pnpm pages:dev
```

---

## Install (self-hosted)

See **[QUICKSTART.md](./QUICKSTART.md)** for the full step-by-step.

```bash
git clone <your-repo-url> ~/seo-aeo-geo-dashboard
cd ~/seo-aeo-geo-dashboard
pnpm install
cp .env.example .env
# edit .env — DATABASE_URL and ENCRYPTION_KEY are required
pnpm run migrate
```

Then start:

```bash
pnpm --filter api dev      # API on :4000
pnpm dev                   # Web on :3000
```

Open `http://localhost:3000`, then finish setup on the Settings page.

---

## Security model

The dashboard holds live API keys, so it is protected by default.

- **Admin account.** One operator account, created on first run. The password
  is hashed with PBKDF2-HMAC-SHA256 (100,000 iterations, per-user salt).
  That is the ceiling the Workers runtime allows — it rejects PBKDF2 above
  100,000 iterations outright — and is below OWASP's 600,000 recommendation.
  The same cap applies to the self-hosted build so a password stays valid
  across both deployments. For a stronger factor, put the deployment behind
  Cloudflare Access rather than raising this.
- **Sessions.** A random 256-bit token in an httpOnly, SameSite=Strict,
  Secure cookie. Only its SHA-256 digest is stored, so a database backup
  cannot be replayed as a login.
- **CSRF.** State-changing requests carry a per-session token.
- **Rate limiting.** Failed logins are tracked in the database (not the cache,
  which is only eventually consistent) and lock out after 8 attempts in 15
  minutes. An unknown username costs the same time as a wrong password, so
  the response does not reveal which it was.
- **API keys at rest.** AES-256-GCM under `ENCRYPTION_KEY`, with a fresh IV
  per record. The plaintext is never returned to the browser — the settings
  form shows only `••••` and the last four characters. Only names on a fixed
  allowlist can be stored.
- **Reads.** Authenticated by default. Set `PUBLIC_READS=1` to deliberately
  serve a read-only dashboard to anonymous visitors.
- **First-run race.** With `SETUP_TOKEN` set, creating the admin account
  requires it, so a stranger who finds a fresh deployment cannot claim it.

### Public demo mode

`DEMO_MODE=1` turns a deployment into a public demo that cannot spend the
operator's money:

- `getSecret` returns nothing for any stored or environment credential, so
  there is **no code path from an anonymous visitor to your keys**. Enforced
  at the single function every connector reads through, not at each call site.
- Reads are open; the only write allowed is an LLM probe, and only when the
  caller supplies their own key.
- A visitor's key travels in an `x-byok` header, is used for that one request
  and discarded. It is never written to the database, so the next visitor
  cannot reuse it either. In the browser it lives in `sessionStorage` and dies
  with the tab.
- Demo probes are not persisted, so one visitor's prompts never show up in
  another's view. A visitor may point a probe at any domain they like.
- Storing credentials, adding sites, syncs and clone reports are all refused.

Run the demo as a **separate deployment** from your real one. Same code, its
own D1, `DEMO_MODE=1`, and `scripts/seed-demo.sql` for sample data.

---

## Environment variables

**You do not need to put API keys in a file.** The Settings page stores them
encrypted in the database, which is the recommended route on both deployments.
A key set in the environment still works and is shown read-only in the UI.

Required:

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | self-hosted | Postgres connection string |
| `REDIS_URL` | self-hosted | Cache and SSE pub/sub |
| `ENCRYPTION_KEY` | both | Encrypts stored API keys. `openssl rand -base64 32`. **Back it up.** |

Recommended:

| Variable | Purpose |
|---|---|
| `SETUP_TOKEN` | Required to create the admin account; closes the first-run race |
| `PUBLIC_READS` | `1` serves a read-only dashboard anonymously. Off by default |
| `CLONE_MAX_PAGES` | Pages per clone run. Lower to ~8 on the Workers free plan |
| `PBKDF2_ITERATIONS` | Password hashing rounds. Clamped to 100,000, the Workers ceiling |

On Cloudflare, bindings (`DB`, `CACHE`) live in `wrangler.toml` and secrets are
set with `wrangler pages secret put NAME`. Everything else lives in `.env` at
the repo root — see `.env.example`.

Optional API keys, all settable from the Settings page:
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`,
`PERPLEXITY_API_KEY`, `GOOGLE_SEARCH_CONSOLE_CREDENTIALS`,
`BING_WEBMASTER_API_KEY`, `AHREFS_API_KEY`, `SEMRUSH_API_KEY`, `MOZ_API_KEY`,
`GOOGLE_BUSINESS_API_KEY`, `TRUSTPILOT_API_KEY`, `G2_API_KEY`,
`SLACK_WEBHOOK_URL`.

A connector with no key is greyed out in the UI with the reason shown.

---

## CLI

```bash
pnpm cli health                 # API, database, encryption and session state
pnpm cli login --username admin # mutations require a session
pnpm cli logout
pnpm cli connectors             # which connectors are enabled, and what each needs

pnpm cli sites list
pnpm cli sites add example.com
pnpm cli sites remove 1

pnpm cli rank --site 1
pnpm cli geo --site 1
pnpm cli geo probe --site 1 --prompt "best crm for startups"
pnpm cli geo probe --site 1 --prompt "..." --models gpt-4o,claude-3.5
pnpm cli backlinks --site 1
pnpm cli reviews --site 1
pnpm cli citations --site 1
pnpm cli regional --site 1 --metric clicks

pnpm cli sync gsc --site 1
pnpm cli sync backlinks --site 1
pnpm cli sync reviews --site 1
pnpm cli sync citations --site 1
pnpm cli sync regional --site 1

pnpm cli clone --target competitor.com --site 1
pnpm cli debrief --site 1 --scope full --out debrief.md
pnpm cli stream --site 1        # tails the SSE feed
pnpm cli mcp serve
```

Add `--json` to any command for machine-readable output.

---

## MCP server (AI agents)

The MCP server exposes the dashboard to AI agents over stdio. Every tool is a
wrapper over the same REST API the GUI uses, so agents and humans see identical
data.

```bash
pnpm mcp:serve
```

**Tools:** `list_sites`, `get_live_rankings`, `get_llm_visibility`,
`list_backlinks`, `run_geo_prompt`, `clone_strategy`, `generate_debrief`.

**Resources:** `site://list`, `site://{id}/summary`, `site://{id}/geo`.

Configure your MCP client to run `pnpm mcp:serve` over stdio. Set `API_URL` if
the API is not on `http://localhost:4000`.

---

## API reference

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | API, database and encryption status |
| GET | `/api/auth/session` | Setup, migration and sign-in state |
| POST | `/api/auth/setup` | Create the admin account (once) |
| POST | `/api/auth/login` · `/api/auth/logout` | Session lifecycle |
| GET | `/api/settings/credentials` | Credential status — masked, never plaintext |
| PUT·DELETE | `/api/settings/credentials/:name` | Store or remove a key |
| POST | `/api/admin/migrate` | Apply the schema (open until setup completes) |
| GET | `/api/connectors` | Which connectors are enabled, and what each is missing |
| GET | `/api/sites` | List sites |
| POST | `/api/sites` | Add a site (`{ domain, name? }`) |
| DELETE | `/api/sites/:id` | Remove a site and its data |
| GET | `/api/sites/:id/summary` | Headline counts for every layer, in one round trip |
| GET | `/api/sites/:id/rank` | Keyword rankings |
| GET | `/api/sites/:id/geo` | LLM visibility, with a per-model breakdown |
| GET | `/api/sites/:id/backlinks` | Backlinks, including lost links |
| GET | `/api/sites/:id/reviews` | Reviews with sentiment |
| GET | `/api/sites/:id/citations` | Authority-scored citations |
| GET | `/api/sites/:id/regional` | Country rollup for the world map |
| POST | `/api/sites/:id/prompts` | Run an LLM probe (`{ prompt, models? }`) |
| GET | `/api/sites/:id/prompts/estimate` | Estimated call count before spending |
| POST | `/api/sites/:id/sync/{gsc,backlinks,reviews,citations,regional}` | Pull fresh data |
| POST | `/api/clone` | Clone report (`{ targetDomain, siteId }`) |
| GET | `/api/sites/:id/clone` | Stored clone reports |
| POST·GET | `/api/sites/:id/debrief` | Prompt pack; add `?format=md` for markdown |
| GET | `/api/stream` | SSE live feed, self-hosted only; `?site=<id>` to filter |

All routes except `/api/health`, `/api/auth/*` and `/api/admin/migrate`
require a session unless `PUBLIC_READS=1`.

---

## The dashboard

See **[docs/SCREENSHOTS.md](./docs/SCREENSHOTS.md)** for a full walkthrough with screenshots of every panel.

The top of the page is a live 3D scene; the records that feed it sit directly
beneath, and a filter applies to both at once.

**The data galaxy.** Your site is the centre. Each shell is one kind of record:

| Ring | Shape | What colour and size mean |
|---|---|---|
| Keywords | ◆ octahedron | brighter = better position · larger = more impressions |
| LLM prompts | ◍ torus knot | glowing green = cited · red = not cited |
| Citations | ▲ tetrahedron | brighter and larger = higher authority |
| Backlinks | ● sphere + arc | brighter = higher domain authority · amber = lost |

Identity is carried by **shape and ring, not hue**. That is deliberate: no
categorical palette keeps more than three colours separable under
colour-vision deficiency when any two marks can sit side by side. Colour is
therefore free to do the two jobs it is good at — magnitude (one sequential
blue ramp) and state (the reserved status palette, always with a mark and a
label beside it).

Drag to orbit, pinch or scroll to zoom, two fingers to pan. Hover or tap any
node for detail; click it to jump to its row in the table below. There is a
fullscreen toggle, a reset-view button and an auto-rotate switch.

**It degrades.** On a device with fewer than four cores, or without WebGL, the
scene renders as 2D SVG with the same shapes, the same colour scales and the
same data — and three.js is never downloaded, because the import is dynamic.
You can also switch to 2D by hand at any time. Every mark in the 2D view is
keyboard-focusable.

**The panels.** Overview (stat tiles), Keywords, GEO prompts, Backlinks,
Reviews, Citations, Regional, Clone and Debrief. Every table sorts, and every
table doubles as the accessible view of the scene above it.

**Regional.** A Leaflet world map on OpenStreetMap tiles — no Mapbox token
needed. Countries are drawn as area-proportional bubbles coloured by the
metric you pick (clicks, impressions, LLM citations, average position), with a
sortable country table underneath. Clicking a country scopes the regional
debrief to it.

---

## Development

```bash
pnpm install              # install all workspaces
pnpm -r build             # build everything
pnpm --filter api dev     # API only
pnpm --filter web dev     # Web only
pnpm run migrate          # apply DB schema
```

Type-check everything:

```bash
pnpm -r exec tsc --noEmit
```

---

## Termux notes

- Start Postgres manually each session:
  ```bash
  pg_ctl -D $PREFIX/var/lib/postgresql -l $PREFIX/var/log/postgresql.log start
  ```
- Start Redis:
  ```bash
  redis-server --daemonize yes
  ```
- Keep Termux alive in background:
  ```bash
  termux-wake-lock
  ```
- Next.js on Termux uses the WASM SWC binary. Do **not** add `--turbopack` to the dev script.
- Behind an HTTP proxy, Node's `fetch` ignores `HTTPS_PROXY` unless you start
  the API with `NODE_USE_ENV_PROXY=1`. The clone engine and every connector
  make outbound requests, so set it if they time out immediately.

Full startup cheat sheet in [QUICKSTART.md](./QUICKSTART.md).

---

## Deploy

- **Cloudflare Pages** (recommended) — see [above](#deploy-to-cloudflare-pages).
  `pnpm pages:deploy`.
- **Self-hosted** — run `apps/api` (Node 22+) behind any reverse proxy with
  Postgres and Redis; serve `apps/web` with `next start` or export it statically.
- **Local only** — `cloudflared tunnel --url http://localhost:3000`.

---

## Roadmap

| Phase | Status |
|---|---|
| Scaffold, DB, live API + GUI | ✅ done |
| LLM visibility probe + SSE stream | ✅ done |
| Clone engine (free-data MVP) | ✅ done |
| Debrief generator | ✅ done |
| GSC + backlinks + reviews + citations + regional connectors | ✅ done |
| MCP + CLI wired to live endpoints | ✅ done |
| Cloudflare Pages deployment (D1 + KV) | ✅ done |
| Admin auth + encrypted API key entry | ✅ done |
| 3D scene, hover detail, 2D fallback | ✅ done |
| Tabbed record panels + filters | ✅ done |
| World map + regional drill-down | ✅ done |
| Cross-user benchmarks ("global", "top performers") | needs multiple users |
| Multi-tenant, RBAC | later |

The view-mode switcher from the original plan offered **Global** and **Top
Performers** built on anonymised cross-user telemetry. That data does not
exist in a self-hosted, single-operator deployment, and seeding it with
invented industry averages would put made-up numbers next to real ones. The
site switcher is real; those two modes are deferred until there is something
true to put behind them.

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Contributing

1. Fork
2. `git checkout -b feat/your-feature`
3. `pnpm -r build` and `pnpm -r exec tsc --noEmit`
4. Open a PR
