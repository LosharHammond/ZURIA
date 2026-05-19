// Server-side environment variable validation.
// Import this at the top of any API route that requires specific env vars.
// Throws at request time (not build time) with a clear message.

type EnvKey =
  | "TWILIO_ACCOUNT_SID"
  | "TWILIO_AUTH_TOKEN"
  | "TWILIO_WHATSAPP_NUMBER"
  | "FIREBASE_CLIENT_EMAIL"
  | "FIREBASE_PRIVATE_KEY"
  | "ADMIN_PHONE"
  | "ADMIN_MOMO_NUMBER"
  | "SUPPORT_WA_NUMBER"
  | "NEXT_PUBLIC_APP_URL"
  | "PAYSTACK_SECRET_KEY"
  // Session / cron security secrets (required in production)
  | "AUTH_SESSION_SECRET"
  | "CRON_SECRET"
  // Telegram integration (required when Telegram bot is active)
  | "TELEGRAM_BOT_TOKEN"
  | "TELEGRAM_WEBHOOK_SECRET";

const REQUIRED_SERVER: EnvKey[] = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_WHATSAPP_NUMBER",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "ADMIN_PHONE",
  // Must be set in production — session cookies are invalid without it
  "AUTH_SESSION_SECRET",
  // Must be set in production — cron routes reject all requests without it
  "CRON_SECRET",
  // Must be set in production — webhook signature verification fails without it
  "PAYSTACK_SECRET_KEY",
];

const PLACEHOLDERS = ["paste_your_key_here", "from Firebase", "sk_live_paste"];

function isMissing(value: string | undefined): boolean {
  if (!value) return true;
  return PLACEHOLDERS.some((p) => value.includes(p));
}

/**
 * Validate that required server-side env vars are present.
 * Call during app startup (e.g., from a server component or API route health check).
 */
export function validateServerEnv(keys: EnvKey[] = REQUIRED_SERVER): void {
  const missing: string[] = [];
  for (const key of keys) {
    if (isMissing(process.env[key])) missing.push(key);
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing or placeholder environment variables: ${missing.join(", ")}.\n` +
      `Check your .env.local (development) or hosting platform environment settings (production).`
    );
  }
}

/**
 * Check if Paystack is fully configured (optional — app degrades gracefully without it).
 */
export function isPaystackConfigured(): boolean {
  return !isMissing(process.env.PAYSTACK_SECRET_KEY);
}

/**
 * Check if the Telegram bot is fully configured (optional — app degrades gracefully without it).
 */
export function isTelegramConfigured(): boolean {
  return !isMissing(process.env.TELEGRAM_BOT_TOKEN);
}

/**
 * Safely read an env var and throw a clear error if it's missing.
 */
export function requireEnv(key: EnvKey): string {
  const value = process.env[key];
  if (isMissing(value)) {
    throw new Error(`Environment variable ${key} is not set. Add it to your .env.local or hosting platform.`);
  }
  return value!;
}
