// One .env at the repo root serves every app (the API loads it too), so the web app's
// server routes see the same AI provider keys. Real environment variables win over the file.
const fs = require("fs");
const path = require("path");
try {
  for (const line of fs.readFileSync(path.resolve(__dirname, "../../.env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#") || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2").replace(/\s+#.*$/, "");
  }
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
