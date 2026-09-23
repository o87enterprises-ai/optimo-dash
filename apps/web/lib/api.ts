"use client";

/**
 * Client-side API helper.
 *
 * The session lives in an httpOnly cookie the script cannot read, so every
 * request sends credentials and every mutating request carries the CSRF token
 * the server handed back at login.
 */

export type SessionState = {
  migrated: boolean;
  setupComplete: boolean;
  setupTokenRequired: boolean;
  publicReads: boolean;
  demo: boolean;
  authenticated: boolean;
  username: string | null;
  csrfToken: string | null;
};

/**
 * Caller-supplied API keys ("bring your own key").
 *
 * Held in sessionStorage so they die with the tab, and sent as a request
 * header. They are never written to the server's database — on the public
 * demo that is the only way to run a probe, because the deployment's own
 * credentials are unreachable there.
 */
const BYOK_STORAGE = "sag_byok";
export const BYOK_HEADER = "x-byok";

export type ByokKeys = Record<string, string>;

export function readByok(): ByokKeys {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.sessionStorage.getItem(BYOK_STORAGE) ?? "{}") as ByokKeys;
  } catch {
    return {};
  }
}

export function writeByok(keys: ByokKeys): void {
  try {
    const cleaned = Object.fromEntries(
      Object.entries(keys).filter(([, v]) => typeof v === "string" && v.trim())
    );
    if (Object.keys(cleaned).length) {
      window.sessionStorage.setItem(BYOK_STORAGE, JSON.stringify(cleaned));
    } else {
      window.sessionStorage.removeItem(BYOK_STORAGE);
    }
  } catch {
    // Private browsing can refuse storage; the keys then last for this page
    // view only, which is an acceptable degradation.
  }
}

export function clearByok(): void {
  try {
    window.sessionStorage.removeItem(BYOK_STORAGE);
  } catch {
    /* nothing to clear */
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;

  // Attach any keys the visitor supplied, base64 so the header stays ASCII.
  const byok = readByok();
  if (Object.keys(byok).length) {
    headers[BYOK_HEADER] = btoa(JSON.stringify(byok));
  }

  // A dropped connection or DNS hiccup throws before any response exists.
  // Retried once, and only for GET — a mutating request must never be
  // silently replayed, since the server may already have applied it.
  let res: Response;
  try {
    res = await fetch(path, { ...init, method, headers, credentials: "same-origin" });
  } catch (err) {
    if (method !== "GET") throw err;
    await new Promise((r) => setTimeout(r, 400));
    res = await fetch(path, { ...init, method, headers, credentials: "same-origin" });
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) throw new ApiError(res.status, body?.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

/** Reads the current session and keeps the CSRF token in sync. */
export async function loadSession(): Promise<SessionState> {
  const state = await api<SessionState>("/api/auth/session");
  setCsrfToken(state.csrfToken);
  return state;
}
