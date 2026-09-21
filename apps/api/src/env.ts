import fs from "fs";
import path from "path";
import { config } from "dotenv";

/**
 * Loads the repo-root .env exactly once, no matter which module is entered
 * first (index.ts, migrate.ts, or a connector invoked from the CLI).
 *
 * The root is found by walking up from this file rather than by a fixed
 * "../../../" hop, because that depth differs between running from src/ via
 * ts-node and running the compiled dist/.
 */
function findEnvFile(start: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

// ESM has no __dirname; import.meta.dirname is the ES-module equivalent.
const envFile = findEnvFile(import.meta.dirname);
if (envFile) {
  config({ path: envFile });
} else {
  // Not fatal: a container deployment supplies real environment variables.
  console.warn("[env] no .env found; relying on the process environment");
}

/** Returns the trimmed value of an env var, or undefined when unset/blank. */
export function envKey(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** True when every named var is present and non-blank. */
export function hasKeys(...names: string[]): boolean {
  return names.every((n) => envKey(n) !== undefined);
}
