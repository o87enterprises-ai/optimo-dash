```markdown

\# 0ptimo Prim3 - Project Handoff (Session 3)



\## 0. Project Context \& Architecture

\- \*\*Dashboard Name:\*\* 0ptimo Prim3

\- \*\*Current Local URL:\*\* `http://localhost:3000`

\- \*\*Target Domain (Data Source):\*\* `https://truegle.info` (Site ID: 1 in local DB)

\- \*\*Tech Stack:\*\* Next.js 15 (App Router), Tailwind CSS, React Three Fiber (`react-globe.gl`), pnpm Workspaces, Express API (`apps/api`), Postgres (Docker), Recharts.

\- \*\*Environment:\*\* Windows 11, PowerShell (NOT bash). 

\- \*\*Billing Constraint:\*\* 100% Free Tier. No GitHub Actions (billing issue). Must use GitHub REST API for any repo automation.



\## 1. Project Goals

Transform the existing Optimo Dash into \*\*0ptimo Prim3\*\*, a live interactive 3D SEO, AEO, and GEO analytics dashboard, wrapped in a SaaS shell.

\- \*\*Visual Identity:\*\* "Transformer vehicle" inspired (alloy, grilles, mechanical precision). Dark mode, HUD, glowing cyan/orange accents.

\- \*\*The Pivot:\*\* We are turning this into a multi-tenant SaaS with a Landing Page, Auth, Stripe Payments, and the Dashboard.

\- \*\*The Autopilot Feature:\*\* A core feature is the "Autopilot" UI (see screenshots from previous sessions). It takes a user's GitHub repo, scans static HTML files, uses an AI provider (NVIDIA, Groq, Gemini) to propose better SEO titles/descriptions, and creates a GitHub Pull Request. \*\*It must use the GitHub REST API directly from the backend (via user-provided Personal Access Token), not GitHub Actions.\*\*



\## 2. Current State (What is done)

1\. \*\*Database \& API:\*\* 

&#x20;  - Local Postgres running in Docker.

&#x20;  - Express API running on `http://localhost:4000`.

&#x20;  - Seeded with mock data for `truegle.info` (Site ID: 1).

&#x20;  - Endpoints built: `/api/sites/:id/rank` (keywords), `/api/sites/:id/regional\_metrics` (for globe).

2\. \*\*Frontend Routing Restructured (Just completed):\*\*

&#x20;  - `apps/web/app/page.tsx` is now the public \*\*Landing Page\*\*.

&#x20;  - `apps/web/app/login/page.tsx` is the \*\*Auth Page\*\* (currently a UI mock, needs Supabase).

&#x20;  - Old dashboards moved to `apps/web/app/dashboard/...`.

3\. \*\*The Immediate Bug (Visible in user's latest screenshot):\*\*

&#x20;  - The new Landing Page is rendering \*inside\* the dashboard shell (it has the Sidebar and TopBar).

&#x20;  - \*\*Cause:\*\* `apps/web/app/layout.tsx` is wrapping ALL routes with `<Sidebar />` and `<TopBar />`.

&#x20;  - \*\*Fix Required:\*\* Move the Sidebar and TopBar out of the root `layout.tsx` and into a new `apps/web/app/dashboard/layout.tsx`. The root layout should only contain `<html>`, `<body>`, and global context/providers.



\## 3. Action Plan / Tasks Left

1\. \*\*Fix the Layout Bug (NEXT STEP):\*\* Separate the marketing layout from the dashboard layout.

2\. \*\*Build the Autopilot UI:\*\* Create `apps/web/app/dashboard/autopilot/page.tsx` to match the screenshots. Needs a UI to input a GitHub Repo URL, PAT token, and AI API keys. 

3\. \*\*Backend GitHub API:\*\* Build a new Express endpoint in `apps/api` that uses `fetch` to talk to `api.github.com` to read files, create branches, and open PRs.

4\. \*\*Auth (Supabase):\*\* Wire up `apps/web/app/login/page.tsx` to actually use Supabase Auth (`@supabase/supabase-js`). 

5\. \*\*Subscriptions (Stripe):\*\* Add a Stripe Checkout flow for the "Start Free Trial" button.

6\. \*\*Deployment:\*\* Move local Postgres to Supabase, deploy API to Render (Free), Frontend to Vercel.



\## 4. Relevant Directory Tree (Current)

```text

optimo-dash/

├── apps/

│   ├── api/

│   │   ├── src/

│   │   │   ├── connectors/gsc.ts    # Google Search Console sync

│   │   │   ├── index.ts             # Express API entrypoint

│   │   │   └── migrate.ts           # DB schema

│   │   └── package.json

│   └── web/

│       ├── app/

│       │   ├── dashboard/           # Old dashboards moved here

│       │   │   ├── charts/page.tsx

│       │   │   ├── 3d/page.tsx

│       │   │   └── page.tsx         # Text Dash

│       │   ├── login/page.tsx       # New Auth UI

│       │   ├── globals.css

│       │   ├── layout.tsx           # \*\* BUG IS HERE \*\* (currently wraps everything with Sidebar/TopBar)

│       │   └── page.tsx             # New Landing Page

│       └── components/

│           ├── 3d/GlobeCanvas.tsx

│           └── layout/Sidebar.tsx, TopBar.tsx

├── docker-compose.yml

└── pnpm-workspace.yaml

```



\## 5. How to Start the App (Local Dev)

The user will need these commands. Provide them if they need to restart:

\*\*Terminal 1 (Database \& API):\*\*

```powershell

docker desktop start

cd C:\\Users\\there\\o87DevMobile\\Builds\\optimo-dash

docker-compose up -d

cd apps\\api

pnpm dev

```

\*\*Terminal 2 (Frontend):\*\*

```powershell

cd C:\\Users\\there\\o87DevMobile\\Builds\\optimo-dash\\apps\\web

pnpm dev

```



\## 6. AI Interaction Rules (CRITICAL - MUST FOLLOW)

To prevent copy-paste errors and confusion, you must adhere to these rules strictly:

1\. \*\*ONE SEQUENCE/COMMAND AT A TIME:\*\* Do not dump multiple terminal commands or file replacements at once. Provide one step, wait for the user's output/screenshot, verify it, then provide the next.

2\. \*\*FULL FILE CONTENTS:\*\* When providing code for a file, provide the \*entire\* file contents. Do not provide diffs or partial updates.

3\. \*\*WINDOWS/POWERSHELL:\*\* The user is on Windows. Do NOT use bash commands (no `grep`, `cat`, `touch`). Use PowerShell equivalents (`Select-String`, `Get-Content`, `New-Item`).

4\. \*\*NO ASSUMPTIONS:\*\* Verify paths and framework versions (Next.js 15 App Router) before providing commands. 

5\. \*\*EXPLICIT INSTRUCTIONS:\*\* When asking the user to run a command, tell them exactly which directory they should be in first (e.g., `cd apps\\web`).



\## 7. Immediate Next Step for the New AI

Welcome to Session 3. The user just successfully moved the dashboard pages and created the landing/login pages, but the global layout is leaking the dashboard sidebar onto the landing page.

Your first task is to fix the Next.js Route Group layout issue.

Ask the user for the current contents of `apps\\web\\app\\layout.tsx` and `apps\\web\\app\\dashboard\\page.tsx` so you can provide the full file replacements to separate the Marketing layout from the Dashboard layout.

```



\*\*\*



\### What to do now:

1\. Create a new file in your project root called `HANDOFF\_OPTIMO\_PRIME\_3.md`.

2\. Paste the markdown text above into it and save.

3\. Open a new AI chat context.

4\. Provide the new AI with that file, and tell it: \*"Here is the handoff for Session 3. Please read Section 7 and begin."\*

