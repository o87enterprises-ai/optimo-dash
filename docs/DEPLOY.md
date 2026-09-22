# Deploying to Cloudflare Pages

The live preview at **https://optimo-dash.pages.dev** was created with exactly
these steps.

```bash
npx wrangler login

# 1. Storage. Paste the returned ids into wrangler.toml.
npx wrangler d1 create seo-aeo-geo
npx wrangler kv namespace create SEO_CACHE

# 2. Project.
npx wrangler pages project create optimo-dash --production-branch main

# 3. Secrets.
openssl rand -base64 32 | npx wrangler pages secret put ENCRYPTION_KEY --project-name optimo-dash
openssl rand -hex 16    | npx wrangler pages secret put SETUP_TOKEN    --project-name optimo-dash

# 4. Build and ship.
pnpm pages:deploy
```

Then, once:

1. `POST /api/admin/migrate` — or open **Settings** and press *Run migration*.
   Idempotent; safe to re-run.
2. Create the admin account. It asks for `SETUP_TOKEN`, which stops anyone
   else claiming the deployment before you do. The form disables itself
   afterwards.
3. Paste API keys into **Settings**. Each one takes effect immediately, with
   no redeploy.

## Keep these two values

| Secret | Why it matters |
|---|---|
| `ENCRYPTION_KEY` | Encrypts every stored API key. Lose or rotate it and all stored credentials become undecryptable and must be re-entered. **Back it up.** |
| `SETUP_TOKEN` | Needed once, to create the admin account. |

## Plan limits worth knowing

- **Clone engine.** A run crawls dozens of pages. Workers Free allows 50
  subrequests and 10ms CPU per request, which a full crawl exceeds. Set
  `CLONE_MAX_PAGES=8` on free, or use Workers Paid.
- **Password hashing.** The Workers runtime refuses PBKDF2 above 100,000
  iterations, so that is the cap. See the README's security section.

## Resetting the deployment

```bash
npx wrangler d1 execute seo-aeo-geo --remote \
  --command "DELETE FROM sessions; DELETE FROM admin_users;"
```

That returns the deployment to its pre-setup state so the setup form comes
back. It does not touch your tracked sites or stored credentials.
