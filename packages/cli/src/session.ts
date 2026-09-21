import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/**
 * Local session storage for the CLI.
 *
 * Mutating endpoints require an authenticated session, so `seo-geo login`
 * stores the cookie and CSRF token here. The file is written 0600 because it
 * is a bearer credential — anyone holding it can act as the operator.
 */

export type StoredSession = { api: string; cookie: string; csrfToken: string; expiresAt: string };

function sessionPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "seo-geo", "session.json");
}

export function saveSession(session: StoredSession): string {
  const path = sessionPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(session, null, 2), { mode: 0o600 });
  // writeFileSync only applies mode on creation, so enforce it explicitly.
  chmodSync(path, 0o600);
  return path;
}

/** Returns the stored session for this API, or null when absent or expired. */
export function loadSession(api: string): StoredSession | null {
  const path = sessionPath();
  if (!existsSync(path)) return null;
  try {
    const session = JSON.parse(readFileSync(path, "utf8")) as StoredSession;
    if (session.api !== api) return null;
    if (session.expiresAt && session.expiresAt <= new Date().toISOString()) return null;
    return session;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  const path = sessionPath();
  if (existsSync(path)) rmSync(path);
}
