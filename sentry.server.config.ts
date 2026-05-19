// sentry.server.config.ts
// Sentry server/Node.js configuration for ZURIA.

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,

  // Capture 15% of server transactions in production
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.15 : 1.0,

  // Never send PII
  sendDefaultPii: false,

  enabled: !!SENTRY_DSN,

  // Strip financial request bodies
  beforeSend(event) {
    if (event.request?.data) {
      event.request.data = "[REDACTED]";
    }
    // Remove any extra context that might carry financial figures
    if (event.extra) {
      delete event.extra["amount"];
      delete event.extra["balance"];
      delete event.extra["revenue"];
    }
    return event;
  },
});
