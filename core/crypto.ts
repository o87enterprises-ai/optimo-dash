/**
 * Cryptography for credential storage and admin auth.
 *
 * Uses only WebCrypto, which is present in both Workers and Node 18+, so the
 * same code protects the Cloudflare deployment and the self-hosted one.
 *
 * - Admin passwords: PBKDF2-HMAC-SHA256, per-user random salt.
 * - API keys at rest: AES-256-GCM under a master key supplied by the
 *   deployment (ENCRYPTION_KEY), with a fresh random IV per record.
 *
 * Iteration count: the Workers runtime refuses PBKDF2 above 100,000
 * iterations outright ("iteration counts above 100000 are not supported"),
 * so that is the ceiling here. It is below OWASP's 600,000 recommendation for
 * PBKDF2-HMAC-SHA256, and deliberately so — the alternative is a login that
 * cannot run on Cloudflare at all.
 *
 * The cap is applied on both runtimes rather than only on Workers, so a
 * password hashed by the self-hosted build still verifies on the Cloudflare
 * build and vice versa. A hash is stored with the count used to produce it,
 * so raising this later does not invalidate existing passwords.
 *
 * If you need a higher work factor, put the deployment behind Cloudflare
 * Access or another SSO layer rather than raising this past the runtime limit.
 */

/** Hard ceiling imposed by the Workers WebCrypto implementation. */
export const MAX_PBKDF2_ITERATIONS = 100_000;

const DEFAULT_ITERATIONS = MAX_PBKDF2_ITERATIONS;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ---------- encoding ---------- */

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/**
 * Compares two strings without leaking their contents through timing.
 * Length is compared first only to size the loop; the result still folds in a
 * length mismatch so an early return cannot reveal it.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/* ---------- password hashing ---------- */

export type PasswordHash = {
  algorithm: "pbkdf2-sha256";
  iterations: number;
  salt: string;
  hash: string;
};

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    KEY_BITS
  );
  return new Uint8Array(bits);
}

export async function hashPassword(
  password: string,
  iterations = DEFAULT_ITERATIONS
): Promise<PasswordHash> {
  // Clamped rather than rejected: a deployment that asks for more should get
  // the strongest count the runtime allows, not a failed login.
  const rounds = Math.min(Math.max(1000, iterations), MAX_PBKDF2_ITERATIONS);
  const salt = randomBytes(SALT_BYTES);
  const hash = await pbkdf2(password, salt, rounds);
  return {
    algorithm: "pbkdf2-sha256",
    iterations: rounds,
    salt: toBase64(salt),
    hash: toBase64(hash),
  };
}

/** Verifies a password against a stored hash, in constant time. */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  if (stored.algorithm !== "pbkdf2-sha256") return false;
  if (stored.iterations > MAX_PBKDF2_ITERATIONS) {
    // Hashed by a runtime with a higher ceiling (e.g. Node) and now being
    // checked on Workers, which cannot recompute it. Say so plainly instead
    // of failing as a generic 500.
    throw new Error(
      `stored password uses ${stored.iterations} PBKDF2 iterations, above this runtime's limit of ` +
        `${MAX_PBKDF2_ITERATIONS}. Reset the admin password on the deployment that created it.`
    );
  }
  const hash = await pbkdf2(password, fromBase64(stored.salt), stored.iterations);
  return timingSafeEqual(toBase64(hash), stored.hash);
}

/* ---------- session and CSRF tokens ---------- */

/** A URL-safe random token with 256 bits of entropy. */
export function newToken(): string {
  return toBase64(randomBytes(32)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Hashes a session token for storage. Sessions are bearer credentials, so the
 * database holds only a digest — a leaked backup cannot be replayed. A single
 * SHA-256 is right here (unlike passwords) because the input is already
 * high-entropy random.
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return toBase64(new Uint8Array(digest));
}

/* ---------- secret encryption ---------- */

/** Imports the deployment's 32-byte master key (base64) for AES-GCM. */
async function importMasterKey(masterKeyBase64: string): Promise<CryptoKey> {
  const raw = fromBase64(masterKeyBase64);
  if (raw.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be exactly 32 bytes, base64-encoded (see: openssl rand -base64 32)");
  }
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Generates a master key for the operator to store as a secret. */
export function generateMasterKey(): string {
  return toBase64(randomBytes(32));
}

export type SealedSecret = { iv: string; ciphertext: string };

/** Encrypts a plaintext secret. A fresh IV per call is required by GCM. */
export async function seal(plaintext: string, masterKeyBase64: string): Promise<SealedSecret> {
  const key = await importMasterKey(masterKeyBase64);
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    encoder.encode(plaintext)
  );
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

/** Decrypts a sealed secret. Throws if the key is wrong or data was tampered with. */
export async function unseal(sealed: SealedSecret, masterKeyBase64: string): Promise<string> {
  const key = await importMasterKey(masterKeyBase64);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(sealed.iv) as BufferSource },
      key,
      fromBase64(sealed.ciphertext) as BufferSource
    );
    return decoder.decode(plaintext);
  } catch {
    // GCM authentication failure: wrong master key, or the record was altered.
    throw new Error("could not decrypt stored secret — ENCRYPTION_KEY may have changed");
  }
}

/** The masked form shown in the UI. Never reveals enough to use the key. */
export function maskSecret(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return plaintext.length <= 4 ? "••••" : `••••${tail}`;
}
