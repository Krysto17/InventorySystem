import type { NextConfig } from "next";

// Security headers. Applied to every response, including API routes and the
// PWA files, so they hold regardless of which handler served the request.
//
// Deliberately NOT a full Content-Security-Policy yet. The app loads its two
// typefaces from Google Fonts at runtime (see src/app/layout.tsx), so a
// default-src policy written today would either break typography or have to
// carry a font-host allowance that becomes stale the moment the fonts move.
// `frame-ancestors` is the one directive that cannot break subresource
// loading, so the clickjacking protection lands now and the rest waits until
// the fonts are self-hosted.
const securityHeaders = [
  // The app approves payments and releases stock with one click; it must never
  // be framed. X-Frame-Options for older browsers, frame-ancestors for current.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },

  // Stop the browser second-guessing a declared content type — matters for the
  // PDF routes and the service worker, which must not be sniffed as something
  // else.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Send the full URL only to ourselves. Visit and supplier ids live in paths,
  // and those should not leak to Google Fonts in a Referer header.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Nothing here needs any of these capabilities.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()",
  },

  // One year, subdomains included. Not `preload` — that is a one-way listing
  // that would also bind every future subdomain, and it should be a deliberate
  // decision rather than a side effect of this change.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // A stray lockfile in the home directory makes Next guess the wrong workspace
  // root and warn on every build. This repo IS the root.
  turbopack: { root: __dirname },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
