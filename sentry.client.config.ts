// sentry.client.config.ts
// Sentry browser/client configuration for ZURIA.
// Loaded automatically by @sentry/nextjs before the app bootstraps.

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,

  // Performance monitoring
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.15 : 1.0,

  // Session replay — capture 5% of normal sessions, 100% of error sessions
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,

  // Never send PII to Sentry
  sendDefaultPii: false,

  // Disable in development unless DSN is set
  enabled: !!SENTRY_DSN,

  // Strip financial data from breadcrumbs and events
  beforeSend(event) {
    // Remove any body/request data that might contain financial info
    if (event.request?.data) {
      event.request.data = "[REDACTED]";
    }
    return event;
  },

  integrations: [
    Sentry.replayIntegration({
      // Mask all text and inputs — no PII in replays
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
});
