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
  authenticated: boolean;
  username: string | null;
  csrfToken: string | null;
};

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

  const res = await fetch(path, { ...init, method, headers, credentials: "same-origin" });

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
