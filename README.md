# SEO / AEO / GEO Dashboard

A live, self-hosted dashboard for tracking **SEO**, **AEO** (Answer Engine Optimization), and **GEO** (Generative Engine Optimization) — plus backlinks, citations, and reviews — for any website you own.

Built to run **entirely on Termux (Android)** with no cloud dependency, then deployable to Vercel / Railway / Fly.io when you're ready.

- **Non-programmers** get a GUI with add/remove sites, live cards, and one-click debriefs.
- **Developers** get a CLI, REST API, MCP server for AI agents, and a shared TypeScript type layer.

---

## Features

| Layer | What it does |
|---|---|
| **SEO** | Keyword rankings, impressions, clicks, position over time (via Google Search Console, Bing Webmaster). |
| **AEO** | Featured snippet capture, People Also Ask, FAQ schema coverage. |
| **GEO** | Prompt-based LLM visibility — checks whether GPT, Claude, Gemini, Perplexity cite your domain when asked real user questions. |
| **Backlinks** | New/lost links, domain authority, anchor text, competitor gaps. |
| **Citations** | Authority-scored credible sources (.gov, .edu, journals, directories). |
| **Reviews** | Google Business, Trustpilot, G2, Yelp, App Store, Play Store — with sentiment and reply drafting. |
| **3D View** | Interactive "data galaxy" — zoom / pan / tilt / fullscreen on touch or mouse. Hover any node for detail modals. |
| **Comparison** | Overlay your site against global benchmarks, top performers, or a specific competitor. |
| **World Map** | Regional SEO/AEO/GEO intel with choropleth, bubbles, and flow arcs. |
| **Clone Engine** | Reverse-engineer a public competitor's content/schema/backlink strategy using only free data. |
| **Debrief** | Turn raw findings into prompt-engineering-grade prompts you can hand to an agency or paste into ChatGPT/Claude. |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  apps/web   — Next.js 15 GUI (port 3000)                │
│              3D scene + text panels                     │
├─────────────────────────────────────────────────────────┤
│  apps/api   — Express + Postgres + Redis (port 4000)    │
│              REST + SSE + probes + connectors           │
├─────────────────────────────────────────────────────────┤
│  packages/cli   — seo-geo command line                  │
│  packages/mcp   — Model Context Protocol server         │
│  packages/analytics — Python (pandas, sklearn, LLM SDKs)│
└─────────────────────────────────────────────────────────┘
```

Storage:

- **PostgreSQL 18** — sites, keywords, geo_prompts, backlinks, reviews, citations, regional_metrics
- **Redis 8** — cache, pub/sub for live updates

---

## Requirements

**Termux (Android):**

- Termux from F-Droid (not Play Store)
- ~2 GB free space
- Node 22+, Python 3.11+, Postgres 16+, Redis 7+

**Windows 11:** Warp terminal, PowerShell as admin (see `install-windows.ps1`).

---

## Install

See **[QUICKSTART.md](./QUICKSTART.md)** for the full step-by-step.

TL;DR:

```bash
git clone <your-repo-url> ~/seo-aeo-geo-dashboard
cd ~/seo-aeo-geo-dashboard
pnpm install
cp .env.example .env
# edit .env — set DATABASE_URL with your Termux user
pnpm run migrate
```

Then start:

```bash
# Session 1
pnpm --filter api dev      # API on :4000

# Session 2
pnpm dev                   # Web on :3000
```

Open `http://localhost:3000`.

---

## Environment variables

All configuration lives in `.env` at the repo root.

**Required to boot:**

```bash
DATABASE_URL=postgresql://<termux-user>@localhost:5432/seo_aeo_geo
REDIS_URL=redis://localhost:6379
PORT=4000
```

**Optional (enable features as you add keys):**

```bash
# LLM visibility (GEO)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_AI_API_KEY=
PERPLEXITY_API_KEY=

# SEO data
GOOGLE_SEARCH_CONSOLE_CREDENTIALS=
BING_WEBMASTER_API_KEY=
AHREFS_API_KEY=
SEMRUSH_API_KEY=
MOZ_API_KEY=

# Reviews & citations
GOOGLE_BUSINESS_API_KEY=
TRUSTPILOT_API_KEY=
G2_API_KEY=

# Notifications
SLACK_WEBHOOK_URL=
```

Missing keys simply disable that connector — the UI greys out the corresponding card.

---

## CLI

```bash
pnpm cli health
pnpm cli sites list
pnpm cli sites add example.com
pnpm cli rank --site 1
pnpm cli geo --site 1
pnpm cli geo probe --site 1 --prompt "best crm for startups"
pnpm cli backlinks --site 1
pnpm cli clone --target competitor.com --site 1
pnpm cli debrief --site 1 --scope full --out debrief.md
```

Add `--json` to any command for machine-readable output.

---

## MCP server (AI agents)

The MCP server exposes tools, resources, and prompts so AI agents can query the dashboard.

```bash
pnpm mcp:serve
```

Tools exposed: `list_sites`, `get_live_rankings`, `get_llm_visibility`, `list_backlinks`, `run_geo_prompt`, `clone_strategy`, `generate_debrief`.

Configure your MCP client to run `pnpm mcp:serve` over stdio.

---

## 3D Dashboard (planned / in progress)

The top ~65 vh of the GUI is a live 3D scene:

- Central node = your site
- Inner ring = pages (size = traffic)
- Mid ring = keywords (color = rank)
- Outer ring = LLM prompts (glow = cited)
- Arcs = backlinks

Controls: one-finger drag = rotate, pinch = zoom, twist = tilt, header button = fullscreen. Hover any node for a detail modal.

View modes: **My Sites** · **Global** · **Top Performers** · **Comparison**.

Under the 3D scene: tabbed text panel (Overview, Keywords, GEO Prompts, Backlinks, Reviews, Citations, Clone, Debrief, Regional).

See **[HANDOFF.md](./HANDOFF.md)** for the full build plan.

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

Full startup cheat sheet in [QUICKSTART.md](./QUICKSTART.md).

---

## Deploy

- **Web → Vercel** (`npx vercel --prod`)
- **API + DB → Railway** (`railway up` with Postgres & Redis plugins)
- **API only → Fly.io** (`fly launch`)
- **Local only → Cloudflare Tunnel** (`cloudflared tunnel --url http://localhost:3000`)

---

## Roadmap

| Phase | Status |
|---|---|
| Scaffold, DB, live API + GUI | ✅ done |
| LLM visibility probe + SSE stream | ⏳ next |
| 3D scene + hover modals | ⏳ |
| View mode switcher + comparison overlay | ⏳ |
| World map (Leaflet) + regional drill-down | ⏳ |
| Clone engine (free-data MVP) | ⏳ |
| Debrief generator | ⏳ |
| GSC + backlinks + reviews connectors | ⏳ |
| MCP + CLI wired to live endpoints | ⏳ |
| Auth, multi-tenant, RBAC | later |

---

## License

MIT — see `LICENSE` if present, else add one before publishing.

---

## Contributing

1. Fork
2. `git checkout -b feat/your-feature`
3. `pnpm -r build && pnpm -r test`
4. Open a PR
