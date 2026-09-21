/**
 * Two build modes:
 *
 * - Default (local dev): a normal Next dev server that proxies /api to the
 *   self-hosted API on :4000.
 * - CF_PAGES=1: a fully static export. Cloudflare Pages serves the assets and
 *   a Pages Function serves /api on the same origin, so no rewrite is needed
 *   (and `rewrites` is not supported by `output: "export"` anyway).
 */
const isStaticExport = process.env.CF_PAGES === "1";

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  ...(isStaticExport
    ? {
        output: "export",
        // Pages serves /settings as /settings/index.html.
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {
        async rewrites() {
          return [
            { source: "/api/:path*", destination: "http://localhost:4000/api/:path*" },
            { source: "/health", destination: "http://localhost:4000/health" },
          ];
        },
      }),
};

module.exports = config;
