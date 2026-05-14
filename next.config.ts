import type { NextConfig } from "next";

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
    ];
  },

  // Reduce bundle size: don't include source maps in production
  productionBrowserSourceMaps: false,

  // Compress output
  compress: true,

  // Tree-shake icon libraries and Firebase so only imported symbols are bundled
  experimental: {
    optimizePackageImports: ["lucide-react", "firebase/app", "firebase/auth", "firebase/firestore"],
  },

  // Shorter Vercel serverless function timeout for webhook routes
  // (the default 10 s is fine for most routes; WhatsApp webhook needs a fast 200 OK)
  serverExternalPackages: ["firebase-admin"],
};

export default nextConfig;
