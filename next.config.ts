import type { NextConfig } from "next";
import path from "path";

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
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  // HSTS — force HTTPS for 1 year (only for production)
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

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
  // Significantly reduces First Load JS for pages that use lucide-react.
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

export default nextConfig;
