import type { NextConfig } from "next";

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
            `img-src 'self' https://cdn.discordapp.com data: blob:; ` +
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
