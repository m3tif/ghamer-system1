import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'", "img-src 'self' data:", "font-src 'self' data:", "style-src 'self' 'unsafe-inline'",
      // Next.js needs inline bootstrap scripts; tighten with nonces later if required.
      process.env.NODE_ENV === "production" ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "connect-src 'self'", "frame-ancestors 'none'", "form-action 'self'", "base-uri 'self'",
    ].join("; "),
  },
];

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg", "@node-rs/argon2"],
  // signed contracts / payment proofs are uploaded through server actions (files up to 4 MB — the hosting limit is 4.5 MB per request)
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  async headers() { return [{ source: "/:path*", headers: securityHeaders }]; },
};
export default config;
