import type { NextConfig } from "next";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const securityResponseHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  headers() {
    return [
      { source: "/:path*", headers: securityResponseHeaders },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/agents/**/*": [
      "src/server/codex/snapshot-worker.mjs",
      "src/server/codex/limits.mjs",
      "src/server/codex/owned-temp.mjs",
      "src/server/codex/stable-copy.mjs",
    ],
  },
  serverExternalPackages: ["better-sqlite3"],
  typedRoutes: true,
};

export default nextConfig;
