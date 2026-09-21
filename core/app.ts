import { Hono } from "hono";
import type { Context } from "hono";

import type { Ctx } from "./ports.ts";
import { migrate } from "./schema.ts";
import { timingSafeEqual } from "./crypto.ts";
import {
  CSRF_HEADER,
  SESSION_COOKIE,
  clearCookie,
  createAdmin,
  getSession,
  isSetupComplete,
  login,
  logout,
  readCookie,
  sessionCookie,
  verifyCsrf,
} from "./auth.ts";
import type { Session } from "./auth.ts";
import {
  CREDENTIAL_NAMES,
  deleteSecret,
  hasEncryptionKey,
  isCredentialName,
  listSecrets,
  setSecret,
} from "./secrets.ts";
import * as sites from "./services/sites.ts";
import * as geo from "./services/geo.ts";
import { runClone, listCloneReports } from "./services/clone.ts";
import { generateDebrief, debriefToMarkdown } from "./services/debrief.ts";
import { gscStatus, syncGSC } from "./connectors/gsc.ts";
import { backlinkStatus, syncBacklinks } from "./connectors/backlinks.ts";
import { reviewStatus, syncReviews, syncCitations } from "./connectors/reviews.ts";
import { getRegional, syncRegional } from "./connectors/regional.ts";
import type { DebriefScope, LlmModel, RegionalMetricName } from "./types";

/**
 * The HTTP surface, defined once and mounted by both runtimes.
 *
 * Hono runs on Workers and on Node, so the Cloudflare deployment and the
 * self-hosted one share this router verbatim; only the storage adapters and
 * the entry point differ.
 *
 * Authorisation model: reads are open (the deployment is single-operator and
 * usually private), but everything that mutates state, spends money on an LLM
 * call, or touches credentials requires a session plus a CSRF token.
 */

export type Vars = { ctx: Ctx; session: Session | null };
export type App = Hono<{ Variables: Vars }>;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function siteId(c: Context): number {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "invalid site id");
  return id;
}

/** Whether cookies should carry Secure. Plain-HTTP localhost must not. */
function isSecureRequest(c: Context): boolean {
  const url = new URL(c.req.url);
  if (url.protocol === "https:") return true;
  return (c.req.header("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";
}

/** Best-effort client identifier for login rate limiting. */
function clientId(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-real-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

async function readJson(c: Context): Promise<any> {
  try {
    return (await c.req.json()) ?? {};
  } catch {
    throw new HttpError(400, "request body must be valid JSON");
  }
}

/**
 * Builds the router.
 *
 * `resolveCtx` supplies the per-request runtime context. Workers derive it
 * from the request's bindings; the Node server closes over long-lived Postgres
 * and Redis clients. Nothing else differs between the two deployments.
 */
export function createApp(resolveCtx: (c: Context) => Ctx): App {
  const app = new Hono<{ Variables: Vars }>();

  /* ---------- Context and session resolution ---------- */

  app.use("*", async (c, next) => {
    c.set("ctx", resolveCtx(c));
    const token = readCookie(c.req.header("cookie"), SESSION_COOKIE);
    try {
      c.set("session", await getSession(c.get("ctx"), token));
    } catch {
      // The sessions table does not exist until the first migration runs.
      c.set("session", null);
    }
    await next();
  });

  /**
   * Guard for protected routes: a valid session, plus a CSRF token on any
   * request that changes state.
   *
   * Safe methods are exempt from the CSRF check because CSRF defends against
   * a cross-site request *causing an effect* — a cross-origin read cannot see
   * the response anyway, and the cookie is SameSite=Strict. Requiring it on
   * GET would only break legitimate clients.
   */
  const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

  /**
   * Endpoints reachable without a session: the health probe, the auth flow
   * itself, and the one-time migration.
   */
  const PUBLIC_PATHS = [/^\/api\/health$/, /^\/api\/auth\//, /^\/api\/admin\/migrate$/];

  /**
   * Reads are authenticated by default.
   *
   * A deployment sits on a public URL and holds competitive intelligence and
   * the shape of the operator's key configuration, so leaving reads open would
   * expose all of it to anyone who found the address. Set PUBLIC_READS=1 to
   * deliberately serve a read-only dashboard to anonymous visitors.
   */
  app.use("/api/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (PUBLIC_PATHS.some((p) => p.test(path))) return next();

    const session = c.get("session") as Session | null;
    const publicReads = c.get("ctx").env.PUBLIC_READS === "1";
    const safe = ["GET", "HEAD", "OPTIONS"].includes(c.req.method);

    if (!session && !(safe && publicReads)) throw new HttpError(401, "sign in required");
    await next();
  });

  const requireAuth = async (c: Context, next: () => Promise<void>) => {
    const session = c.get("session") as Session | null;
    if (!session) throw new HttpError(401, "sign in required");
    if (!SAFE_METHODS.has(c.req.method) && !verifyCsrf(session, c.req.header(CSRF_HEADER))) {
      throw new HttpError(403, "invalid or missing CSRF token");
    }
    await next();
  };

  /* ---------- Health & capabilities ---------- */

  app.get("/api/health", async (c) => {
    const ctx = c.get("ctx");
    let db = false;
    try {
      await ctx.db.first("SELECT 1 AS ok");
      db = true;
    } catch {
      db = false;
    }
    return c.json({
      ok: db,
      db,
      dialect: ctx.db.dialect,
      encryptionConfigured: hasEncryptionKey(ctx),
    });
  });

  app.get("/api/connectors", async (c) => {
    const ctx = c.get("ctx");
    const [llm, gsc, backlinks, reviews] = await Promise.all([
      geo.modelStatus(ctx),
      gscStatus(ctx),
      backlinkStatus(ctx),
      reviewStatus(ctx),
    ]);
    return c.json({ llm, gsc, backlinks, reviews });
  });

  /* ---------- Auth ---------- */

  app.get("/api/auth/session", async (c) => {
    const ctx = c.get("ctx");
    const session = c.get("session") as Session | null;
    // Before the first migration the tables do not exist yet. That is a
    // state the client must be able to see, not a 500.
    let setupComplete = false;
    let migrated = true;
    try {
      setupComplete = await isSetupComplete(ctx);
    } catch {
      migrated = false;
    }
    return c.json({
      migrated,
      setupComplete,
      // Lets the setup form ask for a token only when one is required.
      setupTokenRequired: Boolean(ctx.env.SETUP_TOKEN?.trim()),
      publicReads: ctx.env.PUBLIC_READS === "1",
      authenticated: Boolean(session),
      username: session?.username ?? null,
      // The CSRF token is only useful to a client that already holds the
      // session cookie, so returning it here is safe and saves a round trip.
      csrfToken: session?.csrfToken ?? null,
    });
  });

  /** First-run setup. Self-disables once an admin exists. */
  app.post("/api/auth/setup", async (c) => {
    const ctx = c.get("ctx");
    const { username, password, setupToken } = await readJson(c);
    if (typeof username !== "string" || typeof password !== "string") {
      throw new HttpError(400, "username and password are required");
    }

    // A fresh public deployment is otherwise a race: whoever reaches this
    // endpoint first becomes the operator. SETUP_TOKEN closes that window.
    const expected = ctx.env.SETUP_TOKEN?.trim();
    if (expected && (typeof setupToken !== "string" || !timingSafeEqual(expected, setupToken))) {
      throw new HttpError(403, "invalid setup token");
    }

    try {
      await createAdmin(ctx, username, password);
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
    return c.json({ ok: true }, 201);
  });

  app.post("/api/auth/login", async (c) => {
    const ctx = c.get("ctx");
    const { username, password } = await readJson(c);
    if (typeof username !== "string" || typeof password !== "string") {
      throw new HttpError(400, "username and password are required");
    }

    const result = await login(ctx, username, password, clientId(c));
    if (!result.ok) {
      if (result.retryAfterSeconds) c.header("Retry-After", String(result.retryAfterSeconds));
      throw new HttpError(result.retryAfterSeconds ? 429 : 401, result.reason);
    }

    c.header("Set-Cookie", sessionCookie(result.token, result.expiresAt, isSecureRequest(c)));
    return c.json({ ok: true, csrfToken: result.csrfToken, expiresAt: result.expiresAt });
  });

  app.post("/api/auth/logout", async (c) => {
    await logout(c.get("ctx"), readCookie(c.req.header("cookie"), SESSION_COOKIE));
    c.header("Set-Cookie", clearCookie(isSecureRequest(c)));
    return c.json({ ok: true });
  });

  /* ---------- Credentials ---------- */

  /** Status only. Never returns plaintext or ciphertext. */
  app.get("/api/settings/credentials", requireAuth, async (c) => {
    const ctx = c.get("ctx");
    return c.json({
      encryptionConfigured: hasEncryptionKey(ctx),
      credentials: await listSecrets(ctx),
    });
  });

  app.put("/api/settings/credentials/:name", requireAuth, async (c) => {
    const ctx = c.get("ctx");
    const name = c.req.param("name") ?? "";
    if (!isCredentialName(name)) {
      throw new HttpError(400, `unknown credential — expected one of ${CREDENTIAL_NAMES.join(", ")}`);
    }
    if (!hasEncryptionKey(ctx)) {
      throw new HttpError(
        503,
        "ENCRYPTION_KEY is not configured, so credentials cannot be stored securely"
      );
    }

    const { value } = await readJson(c);
    if (typeof value !== "string" || !value.trim()) throw new HttpError(400, "value is required");

    try {
      await setSecret(ctx, name, value);
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
    return c.json({ ok: true });
  });

  app.delete("/api/settings/credentials/:name", requireAuth, async (c) => {
    const name = c.req.param("name") ?? "";
    if (!isCredentialName(name)) throw new HttpError(400, "unknown credential");
    await deleteSecret(c.get("ctx"), name);
    return c.json({ ok: true });
  });

  /* ---------- Sites ---------- */

  app.get("/api/sites", async (c) => c.json(await sites.listSites(c.get("ctx"))));

  app.post("/api/sites", requireAuth, async (c) => {
    const { domain, name } = await readJson(c);
    if (typeof domain !== "string" || !domain.trim()) throw new HttpError(400, "domain is required");
    return c.json(await sites.addSite(c.get("ctx"), domain, name), 201);
  });

  app.delete("/api/sites/:id", requireAuth, async (c) => {
    await sites.removeSite(c.get("ctx"), siteId(c));
    return c.body(null, 204);
  });

  app.get("/api/sites/:id/summary", async (c) => c.json(await sites.getSummary(c.get("ctx"), siteId(c))));
  app.get("/api/sites/:id/rank", async (c) => c.json(await sites.getRank(c.get("ctx"), siteId(c))));
  app.get("/api/sites/:id/geo", async (c) => c.json(await geo.getGeo(c.get("ctx"), siteId(c))));
  app.get("/api/sites/:id/backlinks", async (c) => c.json(await sites.getBacklinks(c.get("ctx"), siteId(c))));
  app.get("/api/sites/:id/reviews", async (c) => c.json(await sites.getReviews(c.get("ctx"), siteId(c))));
  app.get("/api/sites/:id/citations", async (c) => c.json(await sites.getCitations(c.get("ctx"), siteId(c))));

  app.get("/api/sites/:id/regional", async (c) => {
    const metric = c.req.query("metric") as RegionalMetricName | undefined;
    return c.json(await getRegional(c.get("ctx"), siteId(c), metric));
  });

  /* ---------- GEO probe (spends money — always authenticated) ---------- */

  app.post("/api/sites/:id/prompts", requireAuth, async (c) => {
    const ctx = c.get("ctx");
    const id = siteId(c);
    const { prompt, models } = await readJson(c);
    if (typeof prompt !== "string" || !prompt.trim()) throw new HttpError(400, "prompt is required");
    if (models !== undefined && !Array.isArray(models)) throw new HttpError(400, "models must be an array");

    try {
      const results = await geo.probeLLM(ctx, {
        siteId: id,
        prompt: prompt.trim(),
        models: models as LlmModel[] | undefined,
      });
      return c.json({ runId: `run_${Date.now().toString(36)}`, siteId: id, prompt: prompt.trim(), results }, 201);
    } catch (e: any) {
      if (/no models enabled|unknown model/.test(e.message)) throw new HttpError(400, e.message);
      if (/not found/.test(e.message)) throw new HttpError(404, e.message);
      throw e;
    }
  });

  app.get("/api/sites/:id/prompts/estimate", async (c) => {
    const ctx = c.get("ctx");
    const count = Number(c.req.query("prompts") ?? 1);
    const models = await geo.enabledModels(ctx);
    return c.json({
      prompts: count,
      models,
      calls: count * models.length,
      note: "Cached responses within 24h cost nothing. Disabled models are skipped.",
      disabled: geo.ALL_MODELS.filter((m) => !models.includes(m)),
    });
  });

  /* ---------- Connector syncs ---------- */

  const syncs: Record<string, (ctx: Ctx, id: number, body: any) => Promise<unknown>> = {
    gsc: (ctx, id) => syncGSC(ctx, id),
    backlinks: (ctx, id, body) => syncBacklinks(ctx, id, body?.adapter),
    reviews: (ctx, id) => syncReviews(ctx, id),
    citations: (ctx, id) => syncCitations(ctx, id),
    regional: (ctx, id) => syncRegional(ctx, id),
  };

  app.post("/api/sites/:id/sync/:connector", requireAuth, async (c) => {
    const connector = c.req.param("connector") ?? "";
    const run = syncs[connector];
    if (!run) throw new HttpError(404, `unknown connector: ${connector}`);

    const body = c.req.header("content-type")?.includes("json") ? await readJson(c) : {};
    try {
      return c.json(await run(c.get("ctx"), siteId(c), body));
    } catch (e: any) {
      if (/not set|not enabled|no .* available|malformed/.test(e.message)) throw new HttpError(400, e.message);
      if (/not found/.test(e.message)) throw new HttpError(404, e.message);
      throw e;
    }
  });

  /* ---------- Clone & debrief ---------- */

  app.post("/api/clone", requireAuth, async (c) => {
    const ctx = c.get("ctx");
    const { targetDomain, siteId: id, maxPages } = await readJson(c);
    if (typeof targetDomain !== "string") throw new HttpError(400, "targetDomain is required");
    if (!Number.isInteger(id)) throw new HttpError(400, "siteId is required");

    try {
      // The runtime knows its own subrequest/CPU budget; honour it.
      const budget = Number(maxPages) || Number(ctx.env.CLONE_MAX_PAGES) || undefined;
      return c.json(await runClone(ctx, { targetDomain, siteId: id, maxPages: budget }));
    } catch (e: any) {
      if (/must be a domain|could not fetch/.test(e.message)) throw new HttpError(400, e.message);
      if (/not found/.test(e.message)) throw new HttpError(404, e.message);
      throw e;
    }
  });

  app.get("/api/sites/:id/clone", async (c) => c.json(await listCloneReports(c.get("ctx"), siteId(c))));

  const debrief = async (c: Context, opts: any) => {
    const ctx = c.get("ctx") as Ctx;
    const id = siteId(c);
    const result = await generateDebrief(ctx, { siteId: id, ...opts });

    const wantsMarkdown =
      c.req.query("format") === "md" || (c.req.header("accept") ?? "").includes("text/markdown");
    if (!wantsMarkdown) return c.json(result);

    const site = await ctx.db.first<{ domain: string }>("SELECT domain FROM sites WHERE id = ?", [id]);
    c.header("Content-Type", "text/markdown; charset=utf-8");
    return c.body(debriefToMarkdown(result, site?.domain));
  };

  app.post("/api/sites/:id/debrief", async (c) => {
    const { scope, targetAudience, tone, country } = await readJson(c);
    return debrief(c, { scope: scope as DebriefScope | undefined, targetAudience, tone, country });
  });

  app.get("/api/sites/:id/debrief", async (c) =>
    debrief(c, {
      scope: c.req.query("scope") as DebriefScope | undefined,
      targetAudience: c.req.query("audience"),
      tone: c.req.query("tone"),
      country: c.req.query("country"),
    })
  );

  /* ---------- Migration ---------- */

  /**
   * Applies the schema. Open only until setup completes, so a fresh
   * deployment can initialise itself; authenticated thereafter.
   */
  app.post("/api/admin/migrate", async (c) => {
    const ctx = c.get("ctx");
    const setupDone = await isSetupComplete(ctx).catch(() => false);
    if (setupDone) {
      const session = c.get("session") as Session | null;
      if (!session || !verifyCsrf(session, c.req.header(CSRF_HEADER))) {
        throw new HttpError(401, "sign in required");
      }
    }
    return c.json(await migrate(ctx.db));
  });

  /* ---------- Errors ---------- */

  app.onError((err, c) => {
    const status = err instanceof HttpError ? err.status : (err as any)?.status;
    const code = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
    if (code >= 500) console.error("[api]", err);
    // Internal failures must not leak driver or stack detail to the client.
    const message = code >= 500 ? "internal error" : err.message;
    return c.json({ error: message }, code as 400);
  });

  app.notFound((c) => c.json({ error: "not found" }, 404));

  return app;
}
