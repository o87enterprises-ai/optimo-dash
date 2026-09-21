import type { Ctx } from "./ports.ts";
import { now } from "./ports.ts";
import { maskSecret, seal, unseal } from "./crypto.ts";

/**
 * Encrypted credential store.
 *
 * API keys entered through the settings form are sealed with AES-GCM and kept
 * in the database. Plaintext is returned only to server-side callers that need
 * to make an upstream request — never to a browser.
 *
 * A key may also come from the process environment (.env on a self-hosted box,
 * or a Wrangler secret). A stored credential wins, so the form can override a
 * deployment default without a redeploy.
 */

/**
 * Credentials the settings form may write. An allowlist, so a crafted request
 * cannot turn the store into arbitrary attacker-controlled key/value storage.
 */
export const CREDENTIAL_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_AI_API_KEY",
  "PERPLEXITY_API_KEY",
  "GOOGLE_SEARCH_CONSOLE_CREDENTIALS",
  "BING_WEBMASTER_API_KEY",
  "AHREFS_API_KEY",
  "SEMRUSH_API_KEY",
  "MOZ_API_KEY",
  "GOOGLE_BUSINESS_API_KEY",
  "TRUSTPILOT_API_KEY",
  "G2_API_KEY",
  "SLACK_WEBHOOK_URL",
] as const;

export type CredentialName = (typeof CREDENTIAL_NAMES)[number];

/** Human-facing grouping and help text for the settings UI. */
export const CREDENTIAL_META: Record<CredentialName, { group: string; label: string; help: string }> = {
  OPENAI_API_KEY: { group: "LLM visibility (GEO)", label: "OpenAI", help: "Enables the gpt-4o probe." },
  ANTHROPIC_API_KEY: { group: "LLM visibility (GEO)", label: "Anthropic", help: "Enables the claude-3.5 probe." },
  GOOGLE_AI_API_KEY: { group: "LLM visibility (GEO)", label: "Google AI", help: "Enables the gemini-1.5 probe." },
  PERPLEXITY_API_KEY: { group: "LLM visibility (GEO)", label: "Perplexity", help: "Enables the perplexity probe." },
  GOOGLE_SEARCH_CONSOLE_CREDENTIALS: {
    group: "SEO data",
    label: "Search Console service account",
    help: "Paste the full service-account JSON. Used to pull keyword performance.",
  },
  BING_WEBMASTER_API_KEY: { group: "SEO data", label: "Bing Webmaster", help: "Reserved; connector not built yet." },
  AHREFS_API_KEY: { group: "Backlinks", label: "Ahrefs", help: "Highest-quality backlink source." },
  SEMRUSH_API_KEY: { group: "Backlinks", label: "Semrush", help: "Reserved; connector not built yet." },
  MOZ_API_KEY: { group: "Backlinks", label: "Moz", help: "Backlink source with domain authority." },
  GOOGLE_BUSINESS_API_KEY: { group: "Reviews", label: "Google Business", help: "Pulls Google reviews." },
  TRUSTPILOT_API_KEY: { group: "Reviews", label: "Trustpilot", help: "Pulls Trustpilot reviews." },
  G2_API_KEY: { group: "Reviews", label: "G2", help: "Pulls G2 reviews." },
  SLACK_WEBHOOK_URL: { group: "Notifications", label: "Slack webhook", help: "Where alerts are posted." },
};

export function isCredentialName(name: string): name is CredentialName {
  return (CREDENTIAL_NAMES as readonly string[]).includes(name);
}

/** The master key the store seals with. Absent means the store is unusable. */
function masterKey(ctx: Ctx): string {
  const key = ctx.env.ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY is not set, so credentials cannot be stored securely. " +
        "Generate one with `openssl rand -base64 32` and set it as a secret."
    );
  }
  return key;
}

export function hasEncryptionKey(ctx: Ctx): boolean {
  return Boolean(ctx.env.ENCRYPTION_KEY?.trim());
}

type CredentialRow = { name: string; iv: string; ciphertext: string; masked: string; updated_at: string };

/**
 * Resolves a credential for server-side use: the stored, encrypted value if
 * present, otherwise the deployment environment.
 */
export async function getSecret(ctx: Ctx, name: string): Promise<string | undefined> {
  if (hasEncryptionKey(ctx)) {
    const row = await ctx.db.first<CredentialRow>(
      "SELECT name, iv, ciphertext, masked, updated_at FROM api_credentials WHERE name = ?",
      [name]
    );
    if (row) {
      try {
        return await unseal({ iv: row.iv, ciphertext: row.ciphertext }, masterKey(ctx));
      } catch {
        // A rotated ENCRYPTION_KEY leaves undecryptable rows. Fall through to
        // the environment rather than failing the whole request.
      }
    }
  }
  const fromEnv = ctx.env[name]?.trim();
  return fromEnv ? fromEnv : undefined;
}

/** Stores a credential, replacing any existing value for that name. */
export async function setSecret(ctx: Ctx, name: CredentialName, plaintext: string): Promise<void> {
  const value = plaintext.trim();
  if (!value) throw new Error("value is required");

  const sealed = await seal(value, masterKey(ctx));
  await ctx.db.run(
    `INSERT INTO api_credentials (name, iv, ciphertext, masked, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET
       iv = excluded.iv,
       ciphertext = excluded.ciphertext,
       masked = excluded.masked,
       updated_at = excluded.updated_at`,
    [name, sealed.iv, sealed.ciphertext, maskSecret(value), now()]
  );
}

export async function deleteSecret(ctx: Ctx, name: CredentialName): Promise<void> {
  await ctx.db.run("DELETE FROM api_credentials WHERE name = ?", [name]);
}

export type CredentialStatus = {
  name: CredentialName;
  label: string;
  group: string;
  help: string;
  configured: boolean;
  /** Where the value comes from. "env" values cannot be edited from the UI. */
  source: "stored" | "env" | "none";
  /** Masked tail, e.g. "••••1234". Never the full value. */
  masked: string | null;
  updatedAt: string | null;
};

/**
 * Status of every credential, for the settings form. Deliberately returns no
 * plaintext and no ciphertext — only whether a key exists and its masked tail.
 */
export async function listSecrets(ctx: Ctx): Promise<CredentialStatus[]> {
  const stored = new Map<string, CredentialRow>();
  if (hasEncryptionKey(ctx)) {
    const rows = await ctx.db.all<CredentialRow>(
      "SELECT name, iv, ciphertext, masked, updated_at FROM api_credentials"
    );
    for (const row of rows) stored.set(row.name, row);
  }

  return CREDENTIAL_NAMES.map((name) => {
    const row = stored.get(name);
    const fromEnv = ctx.env[name]?.trim();
    const meta = CREDENTIAL_META[name];

    if (row) {
      return {
        name, ...meta,
        configured: true,
        source: "stored" as const,
        masked: row.masked,
        updatedAt: row.updated_at,
      };
    }
    if (fromEnv) {
      return {
        name, ...meta,
        configured: true,
        source: "env" as const,
        masked: maskSecret(fromEnv),
        updatedAt: null,
      };
    }
    return { name, ...meta, configured: false, source: "none" as const, masked: null, updatedAt: null };
  });
}
