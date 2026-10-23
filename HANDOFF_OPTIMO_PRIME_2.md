# 0ptimo Prim3 - Project Handoff (Session 2)

## 0. Project Context & Architecture
- **Dashboard Name:** 0ptimo Prim3
- **Dashboard Live URL:** `https://optimo-dash.vercel.app/`
- **Target Domain (Data Source):** `https://truegle.info` (This is the site being analyzed by the dashboard).
- **Tech Stack:** Next.js 15, Tailwind CSS, React Three Fiber (`react-globe.gl`), pnpm Workspaces.

## 1. Project Goals
Transform the existing Optimo Dash into **0ptimo Prim3**, a live interactive 3D SEO, AEO, and GEO analytics dashboard.
- **Visual Identity:** "Transformer vehicle" inspired (alloy, grilles, mechanical precision) without humanoid robot elements. 
- **Brand Spelling:** 0ptimo Prim3 (Note the zero and the three).
- **UI Architecture:** Three distinct dash modes sharing a persistent "Cockpit" HUD shell.
  1. **Text Dash:** Diagnostics, issue queues, keyword tables.
  2. **Chart Dash:** Telemetry, trend lines, choropleth maps.
  3. **3D Dash:** Holographic globe with geographic data highlighting and glowing data arcs.

## 2. Action Plan
1. **Data Integration (Next):** Connect the backend API (`regional_metrics` and diagnostic endpoints) to all three dashes.
2. **Text & Chart Dashes:** Replace placeholders with real data tables and Recharts components.
3. **3D Holographic Globe:** Map real backend geo-data to the `GlobeCanvas.tsx` arcs and points.
4. **TopBar Update:** Update `TopBar.tsx` to pull the correct Target Domain (`truegle.info`) from the backend/environment variables.
5. **Live Deployment:** Push to the Git repo and verify the build and live functionality on Vercel (`optimo-dash.vercel.app`).

## 3. Tasks Completed
- Installed and configured Tailwind CSS v3, PostCSS, Autoprefixer, and Lucide React.
- Established `app/globals.css` with the 0ptimo Prim3 palette and custom HUD scrollbars.
- Built the Master Layout Shell (`app/layout.tsx`, `Sidebar.tsx`, `TopBar.tsx`).
- Installed 3D dependencies (`react-globe.gl`, `three`) into the `apps/web` workspace.
- Engineered `components/3d/GlobeCanvas.tsx` featuring a dark-earth texture, glowing atmosphere, animated arcs, and interactive nodes.
- Engineered `app/3d/page.tsx` with a client-side dynamic import (`ssr: false`) to bypass Next.js SSR window errors, wrapped in HUD telemetry overlays.
- Resolved `EADDRINUSE` server conflicts and verified Tailwind compilation.

## 4. Tasks Left
- [ ] Wire backend data to `app/page.tsx` (Text Dash).
- [ ] Wire backend data to `app/charts/page.tsx` (Chart Dash).
- [ ] Wire backend `regional_metrics` to `GlobeCanvas.tsx`.
- [ ] Update `TopBar.tsx` to display `truegle.info` instead of the placeholder.
- [ ] Sync to Git repo and trigger production build for `optimo-dash.vercel.app`.

## 5. Relevant Directory Tree
```text
optimo-dash/
├── apps/
│   └── web/
│       ├── app/
│       │   ├── 3d/
│       │   │   └── page.tsx         # 3D Globe Page (Client Dynamic Import)
│       │   ├── charts/
│       │   │   └── page.tsx         # Chart Dash placeholder
│       │   ├── layout.tsx           # Master HUD shell
│       │   ├── page.tsx             # Text Dash placeholder
│       │   └── globals.css          # Brand tokens & Tailwind
│       ├── components/
│       │   ├── 3d/
│       │   │   └── GlobeCanvas.tsx  # React-Globe.GL 3D Component
│       │   └── layout/
│       │       ├── Sidebar.tsx      # Left nav rail
│       │       └── TopBar.tsx       # Top telemetry bar
│       ├── postcss.config.js
│       ├── tailwind.config.js
│       └── package.json
└── pnpm-workspace.yaml

6.  AI Interaction Rules (For the next session)

    ONE SEQUENCE/COMMAND AT A TIME: Do not dump 5 commands at once. Provide one command, wait for the user's output, verify it, then provide the next.

    FULL FILE CONTENTS: When providing code for a file, provide the entire file contents to prevent copy-paste errors or accidental deletions.

    NO ASSUMPTIONS: Verify paths and framework versions (e.g., Next.js 15 caching quirks) before providing terminal commands.