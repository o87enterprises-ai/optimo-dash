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
