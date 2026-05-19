// sentry.edge.config.ts
// Sentry Edge Runtime configuration for ZURIA.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.15 : 1.0,
  sendDefaultPii: false,
  enabled: !!process.env.SENTRY_DSN,
});
