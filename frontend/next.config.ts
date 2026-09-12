import type { NextConfig } from "next";
import { version as packageVersion } from "./package.json";

/**
 * In dev, the Next.js dev server proxies /api/* to the backend so the browser
 * only ever talks to one origin (localhost:3000). That keeps CSP `connect-src
 * 'self'` happy, avoids CORS preflight, and makes SameSite cookies work without
 * any special configuration.
 *
 * In prod, NEXT_PUBLIC_API_URL is typically empty and Caddy (or whatever
 * reverse proxy is in front) does the same /api/* → backend proxying, so no
 * rewrite is needed. If you DO set NEXT_PUBLIC_API_URL to a cross-origin URL,
 * the rewrite is skipped and the CSP connect-src below is widened to allow it.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const USE_REWRITE = !API_BASE; // same-origin proxy only when API_BASE is empty
const DEV_BACKEND = 'http://localhost:8000';

const nextConfig: NextConfig = {
  output: "standalone",
  // The version shown in the app comes from package.json and nowhere else, so
  // bumping the release is one edit and the footer cannot drift from it.
  env: { NEXT_PUBLIC_APP_VERSION: packageVersion },
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.discordapp.com' },
    ],
  },
  async rewrites() {
    if (!USE_REWRITE) return [];
    return [
      // Proxy every /api/* request to the local backend in dev.
      { source: '/api/:path*', destination: `${DEV_BACKEND}/api/:path*` },
    ];
  },
  async headers() {
    // If the API is on a different origin (cross-origin mode), allow that
    // origin in connect-src. Otherwise 'self' covers it (rewrites make the
    // request same-origin).
    let connectSrc = "'self'";
    if (API_BASE) {
      try {
        const u = new URL(API_BASE);
        connectSrc = `'self' ${u.origin}`;
      } catch {
        // not a URL — ignore
      }
    }

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value:
            "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
            "style-src 'self' 'unsafe-inline'; " +
            // Item images are links an admin pastes, pointing at whatever host
            // they happen to use — the feature has no allowlist to be had, so
            // any scheme-wide source is the honest expression of it. `https:`
            // already covers the Discord CDN the avatars come from.
            //
            // `http:` sits alongside it on purpose, and buys less than it looks
            // like: on an HTTPS deployment the browser blocks a plain-http
            // image as mixed content no matter what this header allows. It is
            // here so those images still work while the app itself is served
            // over http — localhost, or a box on the LAN. Drop it once every
            // deployment is on TLS.
            `img-src 'self' http: https: data: blob:; ` +
            "font-src 'self' data:; " +
            `connect-src ${connectSrc}; ` +
            "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};

export default nextConfig;
