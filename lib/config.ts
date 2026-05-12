/**
 * Centralized app configuration.
 *
 * To change the canonical URL for the whole platform, set `NEXT_PUBLIC_APP_URL`
 * in your `.env.local` or hosting config (Vercel → Settings → Environment Variables).
 * Every part of the codebase imports `APP_URL` from here — no need to touch
 * individual files when the domain changes in the future.
 */

export const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? "https://zuria.vercel.app"
).replace(/\/$/, "");

/**
 * MoMo number users send subscription payments to.
 * Priority: ADMIN_MOMO_NUMBER → ADMIN_PHONE → default.
 * (ADMIN_PHONE is the legacy env var — ADMIN_MOMO_NUMBER takes precedence
 *  if set separately.)
 */
export const ADMIN_MOMO_NUMBER =
  process.env.ADMIN_MOMO_NUMBER ??
  process.env.ADMIN_PHONE ??
  "0242176603";

/**
 * WhatsApp support link — opens a chat with the support number.
 * Derived from ADMIN_MOMO_NUMBER unless SUPPORT_WA_NUMBER is explicitly set.
 * International format without "+" (e.g. "233242176603").
 */
export const SUPPORT_WA_NUMBER =
  process.env.SUPPORT_WA_NUMBER ??
  `233${ADMIN_MOMO_NUMBER.replace(/^0/, "").replace(/^\+233/, "")}`;

/** Full WhatsApp deep-link for support chats. */
export const SUPPORT_WA_LINK = `https://wa.me/${SUPPORT_WA_NUMBER}`;
