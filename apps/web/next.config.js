// One .env at the repo root serves every app (the API loads it too), so the web app's
// server routes see the same AI provider keys. Real environment variables win over the file.
const fs = require("fs");
const path = require("path");
const { parseEnv } = require("./lib/env-file");
try {
  const vars = parseEnv(fs.readFileSync(path.resolve(__dirname, "../../.env"), "utf8"));
  for (const [k, v] of Object.entries(vars)) if (!(k in process.env)) process.env[k] = v;
} catch {
  // no root .env: fine
}

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // the AI layer (providers.ts) is shared with the Express API and lives in apps/api
  experimental: { externalDir: true },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${process.env.API_URL || "http://localhost:4000"}/api/:path*` },
      { source: "/health", destination: `${process.env.API_URL || "http://localhost:4000"}/health` },
    ];
  },
};
