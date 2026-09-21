import type { Ctx } from "./ports.ts";
import { now } from "./ports.ts";
import { hashPassword, hashToken, newToken, timingSafeEqual, verifyPassword } from "./crypto.ts";
import type { PasswordHash } from "./crypto.ts";

/**
 * Single-operator admin authentication.
 *
 * The dashboard holds live API keys, so every mutating route and every
 * settings route sits behind a session. Sessions are random bearer tokens kept
 * in an httpOnly cookie; the database stores only their SHA-256 digest.
 */

const SESSION_TTL_SECONDS = 60 * 60 * 12;
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_SECONDS = 15 * 60;
export const SESSION_COOKIE = "sag_session";
export const CSRF_HEADER = "x-csrf-token";

/**
 * PBKDF2 iteration count override. Returns undefined when unset so the
 * crypto module's (much stronger) default applies. A floor of 1000 stops a
 * misconfigured value from silently disabling the work factor.
 */
function iterations(ctx: Ctx): number | undefined {
  const raw = Number(ctx.env.PBKDF2_ITERATIONS);
  return Number.isInteger(raw) && raw >= 1000 ? raw : undefined;
}

/* ---------- Setup ---------- */

/** True once an admin exists. Until then the app shows the setup form. */
export async function isSetupComplete(ctx: Ctx): Promise<boolean> {
  const row = await ctx.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM admin_users");
  return Number(row?.n ?? 0) > 0;
}

export type PasswordPolicyResult = { ok: true } | { ok: false; reason: string };

/**
 * Minimum password policy. Length carries most of the strength here, so the
 * rule is a long minimum rather than composition rules that push people toward
 * predictable substitutions.
 */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  if (password.length < 12) return { ok: false, reason: "password must be at least 12 characters" };
  if (password.length > 512) return { ok: false, reason: "password must be at most 512 characters" };
  if (/^\s|\s$/.test(password)) return { ok: false, reason: "password must not start or end with whitespace" };
  return { ok: true };
}

/**
 * Creates the one admin account. Refuses if an account already exists, so the
 * setup endpoint cannot be used to take over a live deployment.
 */
export async function createAdmin(ctx: Ctx, username: string, password: string): Promise<void> {
  if (await isSetupComplete(ctx)) throw new Error("setup has already been completed");

  const name = username.trim();
  if (name.length < 3) throw new Error("username must be at least 3 characters");

  const policy = checkPasswordPolicy(password);
  if (!policy.ok) throw new Error(policy.reason);

  const hash = await hashPassword(password, iterations(ctx));
  await ctx.db.run(
    "INSERT INTO admin_users (username, password_hash, created_at) VALUES (?, ?, ?)",
    [name, JSON.stringify(hash), now()]
  );
}

/* ---------- Rate limiting ---------- */

function windowStart(): string {
  return new Date(Date.now() - ATTEMPT_WINDOW_SECONDS * 1000).toISOString();
}

async function recentAttempts(ctx: Ctx, identifier: string): Promise<number> {
  const row = await ctx.db.first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE identifier = ? AND attempted_at > ?",
    [identifier, windowStart()]
  );
  return Number(row?.n ?? 0);
}

async function recordAttempt(ctx: Ctx, identifier: string): Promise<void> {
  await ctx.db.run("INSERT INTO login_attempts (identifier, attempted_at) VALUES (?, ?)", [
    identifier,
    now(),
  ]);
  // Opportunistic cleanup keeps the table from growing without a scheduled job.
  await ctx.db.run("DELETE FROM login_attempts WHERE attempted_at < ?", [windowStart()]);
}

/* ---------- Login ---------- */

export type LoginResult =
  | { ok: true; token: string; csrfToken: string; expiresAt: string }
  | { ok: false; reason: string; retryAfterSeconds?: number };

/**
 * Verifies credentials and opens a session.
 *
 * Failures are deliberately indistinguishable — an unknown username and a bad
 * password return the same message, and the password hash is still computed
 * for an unknown user so the response time does not reveal which it was.
 */
export async function login(
  ctx: Ctx,
  username: string,
  password: string,
  identifier: string
): Promise<LoginResult> {
  if (await recentAttempts(ctx, identifier) >= MAX_ATTEMPTS) {
    return {
      ok: false,
      reason: "too many attempts — try again later",
      retryAfterSeconds: ATTEMPT_WINDOW_SECONDS,
    };
  }

  const user = await ctx.db.first<{ id: number; username: string; password_hash: string }>(
    "SELECT id, username, password_hash FROM admin_users WHERE username = ?",
    [username.trim()]
  );

  let valid = false;
  if (user) {
    valid = await verifyPassword(password, JSON.parse(user.password_hash) as PasswordHash);
  } else {
    // Dummy verification against a throwaway hash, so a missing user costs the
    // same wall time as a wrong password.
    const decoy = await hashPassword("decoy", iterations(ctx));
    await verifyPassword(password, decoy);
  }

  if (!user || !valid) {
    await recordAttempt(ctx, identifier);
    return { ok: false, reason: "invalid username or password" };
  }

  const token = newToken();
  const csrfToken = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  await ctx.db.run(
    "INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    [await hashToken(token), user.id, csrfToken, now(), expiresAt]
  );

  return { ok: true, token, csrfToken, expiresAt };
}

export type Session = { userId: number; username: string; csrfToken: string; expiresAt: string };

/** Resolves a session token, or null when absent, unknown or expired. */
export async function getSession(ctx: Ctx, token: string | undefined): Promise<Session | null> {
  if (!token) return null;

  const row = await ctx.db.first<{
    user_id: number;
    username: string;
    csrf_token: string;
    expires_at: string;
  }>(
    `SELECT s.user_id, s.csrf_token, s.expires_at, u.username
     FROM sessions s JOIN admin_users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
    [await hashToken(token)]
  );
  if (!row) return null;

  if (row.expires_at <= now()) {
    await ctx.db.run("DELETE FROM sessions WHERE token_hash = ?", [await hashToken(token)]);
    return null;
  }

  return {
    userId: row.user_id,
    username: row.username,
    csrfToken: row.csrf_token,
    expiresAt: row.expires_at,
  };
}

export async function logout(ctx: Ctx, token: string | undefined): Promise<void> {
  if (!token) return;
  await ctx.db.run("DELETE FROM sessions WHERE token_hash = ?", [await hashToken(token)]);
  // Expired rows are only cleaned here and on read, which is enough at this scale.
  await ctx.db.run("DELETE FROM sessions WHERE expires_at <= ?", [now()]);
}

/**
 * Verifies the CSRF token for a state-changing request. SameSite=Strict
 * already blocks cross-site form posts; this defends the cases it does not
 * cover, such as a subdomain takeover.
 */
export function verifyCsrf(session: Session, presented: string | undefined): boolean {
  return Boolean(presented) && timingSafeEqual(session.csrfToken, presented!);
}

/** Builds the Set-Cookie header for a session. */
export function sessionCookie(token: string, expiresAt: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  // Secure is omitted only for plain-HTTP localhost, where it would stop the
  // cookie being stored at all.
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Reads a cookie value from a raw Cookie header. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}
