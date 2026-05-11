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
  | "PAYSTACK_SECRET_KEY";

const REQUIRED_SERVER: EnvKey[] = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_WHATSAPP_NUMBER",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "ADMIN_PHONE",
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
 * Safely read an env var and throw a clear error if it's missing.
 */
export function requireEnv(key: EnvKey): string {
  const value = process.env[key];
  if (isMissing(value)) {
    throw new Error(`Environment variable ${key} is not set. Add it to your .env.local or hosting platform.`);
  }
  return value!;
}
