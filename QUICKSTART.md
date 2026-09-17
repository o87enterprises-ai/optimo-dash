# Quick Start

From zero to a running dashboard on Termux (Android), Windows 11, or any Unix-like system.

---

## Termux (Android) — recommended for testing

### 0. Install Termux

Get it from **F-Droid** (not the Play Store — that version is unmaintained).

```bash
pkg update -y && pkg upgrade -y
pkg install -y git nodejs-lts python postgresql redis build-essential clang
npm install -g --allow-scripts=pnpm pnpm
```

### 1. Clone the repo

```bash
git clone <your-repo-url> ~/seo-aeo-geo-dashboard
cd ~/seo-aeo-geo-dashboard
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Create `.env`

```bash
cp .env.example .env
```

Set your Termux username in `DATABASE_URL`:

```bash
PGUSER=$(whoami)
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${PGUSER}@localhost:5432/seo_aeo_geo|" .env
sed -i 's/^PORT=.*/PORT=4000/' .env
```

Verify:

```bash
grep -E 'DATABASE_URL|PORT' .env
```

### 4. Start PostgreSQL (first time)

```bash
# Initialize the DB cluster
[ -d "$PREFIX/var/lib/postgresql/base" ] || initdb $PREFIX/var/lib/postgresql

# Start it
pg_ctl -D $PREFIX/var/lib/postgresql -l $PREFIX/var/log/postgresql.log start

# Create the database
createdb seo_aeo_geo

# Verify
pg_isready
```

### 5. Start Redis

```bash
redis-server --daemonize yes
redis-cli ping
```

Expect `PONG`.

### 6. Apply migrations

```bash
pnpm run migrate
```

Expect `Migrations complete.` Verify:

```bash
psql seo_aeo_geo -c "\dt"
```

Should list `sites`, `keywords`, `geo_prompts`, `backlinks`.

### 7. Start the API (Session A)

Open a **new Termux session** (swipe from the left edge → **NEW SESSION**):

```bash
cd ~/seo-aeo-geo-dashboard
termux-wake-lock
pnpm --filter api dev
```

Expect:
```
API listening on :4000
```

### 8. Start the Web GUI (Session B)

Another **new session**:

```bash
cd ~/seo-aeo-geo-dashboard
pnpm dev
```

Expect:
```
▲ Next.js 15.x
- Local: http://localhost:3000
✓ Ready
```

### 9. Open it

On the same Android device, open a browser:

```
http://localhost:3000
```

You'll see the dashboard. Add your first site:

1. Type your domain (e.g. `example.com`) in the **Add a site** form.
2. Click **Add site**.
3. The site appears as a card. Click it to make it active.
4. The three status pills (API · DB · Redis) should all be green.

---

## Windows 11 (Warp + PowerShell)

```powershell
# Run PowerShell as Administrator
Set-ExecutionPolicy Bypass -Scope Process -Force
.\install-windows.ps1
```

Then skip to **Step 7** above (start API + Web). Postgres and Redis run as Windows services, so no manual start needed.

---

## Unix (Linux, macOS, WSL)

```bash
git clone <your-repo-url> ~/seo-aeo-geo-dashboard
cd ~/seo-aeo-geo-dashboard
pnpm install
cp .env.example .env

# Use your OS user for Postgres
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://$USER@localhost:5432/seo_aeo_geo|" .env

# Start services (systemd)
sudo systemctl start postgresql redis

# Create DB
sudo -u postgres createdb seo_aeo_geo
sudo -u postgres createuser -s "$USER" 2>/dev/null

pnpm run migrate
pnpm --filter api dev &   # API
pnpm dev                  # Web
```

---

## Verify everything works

Run these in a fresh Termux session:

```bash
# API
curl http://localhost:4000/health
# → {"ok":true,"db":true,"redis":true}

# Web
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
# → 200

# Add a site via API
curl -X POST http://localhost:4000/api/sites \
  -H "Content-Type: application/json" \
  -d '{"domain":"example.com"}'

# List sites
curl http://localhost:4000/api/sites
```

---

## Restarting after closing Termux

Every fresh Termux session, run:

```bash
# Infrastructure
pg_ctl -D $PREFIX/var/lib/postgresql -l $PREFIX/var/log/postgresql.log start
redis-server --daemonize yes

# API (Session A)
cd ~/seo-aeo-geo-dashboard && pnpm --filter api dev

# Web (Session B)
cd ~/seo-aeo-geo-dashboard && pnpm dev
```

### One-shot startup script

```bash
cat > ~/SEO/start-stack.sh <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
set -e
echo "Starting Postgres..."
pg_isready -q || pg_ctl -D $PREFIX/var/lib/postgresql -l $PREFIX/var/log/postgresql.log start

echo "Starting Redis..."
redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes

echo "Starting API on :4000..."
cd ~/seo-aeo-geo-dashboard
pnpm --filter api dev
EOF
chmod +x ~/SEO/start-stack.sh
```

Then:

```bash
~/SEO/start-stack.sh      # Session A
pnpm dev                  # Session B
```

---

## tmux (recommended for background running)

```bash
pkg install -y tmux
tmux new -s stack
```

Inside tmux:

```
# Window 1: API
cd ~/seo-aeo-geo-dashboard && pnpm --filter api dev

# Ctrl+B, C for a new window
cd ~/seo-aeo-geo-dashboard && pnpm dev

# Ctrl+B, D to detach
```

Come back later:

```bash
tmux attach -t stack
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `pg_isready` fails | `pg_ctl -D $PREFIX/var/lib/postgresql start` |
| `redis-cli ping` fails | `redis-server --daemonize yes` |
| `EADDRINUSE :3000` | Another process is on 3000 — `pkill -f next` |
| `EADDRINUSE :4000` | `pkill -f ts-node` |
| `no PostgreSQL user name specified` | Fix `DATABASE_URL` in `.env` with `whoami` |
| `Cannot find name 'process'` | `pnpm --filter api add -D @types/node` |
| Next.js SWC error | Ensure `next@15`, no `--turbopack`, no `swcMinify` in config |
| `poetry install` fails on numpy | Use Termux `python-numpy` instead (see HANDOFF.md §fix) |
| Migration says `.env` missing | API expects `.env` at repo root; check `path.resolve(__dirname, "../../../.env")` |
| Termux kills servers on app switch | `termux-wake-lock` or use tmux |

---

## Next steps

Once the dashboard loads and you can add a site:

1. **Read [HANDOFF.md](./HANDOFF.md)** — the full remaining build plan.
2. **Wire the LLM visibility probe** — makes the GEO card show real numbers.
3. **Add the 3D scene** — the visual centerpiece.
4. **Enable GSC** — real keyword data.

---

## Cheat sheet

```bash
# Start infra
pg_ctl -D $PREFIX/var/lib/postgresql start
redis-server --daemonize yes

# Start apps (separate sessions)
pnpm --filter api dev     # :4000
pnpm dev                  # :3000

# DB
pnpm run migrate
psql seo_aeo_geo -c "\dt"

# Health
curl http://localhost:4000/health
curl http://localhost:4000/api/sites

# Stop everything
pkill -f "next dev"
pkill -f "ts-node"
redis-cli shutdown
pg_ctl -D $PREFIX/var/lib/postgresql stop
```
