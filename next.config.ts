import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";

const securityHeaders = [
  // Prevent clickjacking
  { key: "X-Frame-Options", value: "DENY" },
  // Prevent MIME-type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Enable XSS filter
  { key: "X-XSS-Protection", value: "1; mode=block" },
  // Referrer policy — don't leak full URL to third-party
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Permissions policy — disable camera, mic, etc.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), getelocation=(), interest-cohort=()" },
  // Content Security Policy — prevents XSS via script injection
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.sentry-cdn.com https://browser.sentry-cdn.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.sentry.io https://*.firebaseio.com https://*.googleapis.com https://api.groq.com wss://*.firebaseio.com",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  // HSTS — force HTTPS for 1 year (only for production)
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Don't advertise our tech stack to attackers (removes "X-Powered-By: Next.js")
  poweredByHeader: false,

  // Fix Vercel workspace-root detection when package-lock.json is above this dir
  outputFileTracingRoot: path.resolve(__dirname),

  eslint: {
    ignoreDuringBuilds: false,
    dirs: ["app", "components", "hooks", "lib", "stores", "providers", "constants", "types"],
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      // Long-term cache for Next.js static assets (hashed filenames — safe to cache 1 year)
      {
        source: "/_next/static/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // API routes: no caching by default (override per-route as needed)
      {
        source: "/api/(.*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },

  // Never ship source maps to browsers in production
  productionBrowserSourceMaps: false,

  // Gzip / Brotli compression on Vercel
  compress: true,

  // Tree-shake icon libraries and Firebase so only imported symbols are bundled.
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "firebase/app",
      "firebase/auth",
      "firebase/firestore",
      "firebase/storage",
    ],
  },

  // Keep firebase-admin in Node.js runtime (not bundled into Edge/browser chunks)
  serverExternalPackages: ["firebase-admin"],
};

export default withSentryConfig(nextConfig, {
  // Sentry organization and project (set in .env or CI)
  org:     process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Auth token for uploading source maps (set in CI/Vercel env — never in .env.local)
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Suppress verbose Sentry build output
  silent: !process.env.CI,

  // Automatically instrument routes for performance tracing
  autoInstrumentServerFunctions: true,
  autoInstrumentMiddleware: true,

  // Don't widen ESLint rules
  disableLogger: true,

  // Upload source maps only in CI / production builds
  sourcemaps: {
    disable: process.env.NODE_ENV !== "production",
  },

  // Tunnel Sentry requests through our own domain to avoid ad-blockers
  tunnelRoute: "/monitoring",

});
