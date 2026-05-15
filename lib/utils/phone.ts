/**
 * Normalise any Ghana phone input → E.164 (+233XXXXXXXXX).
 *
 * Accepted formats:
 *   0241234567        → +233241234567
 *   233241234567      → +233241234567
 *   +233241234567     → +233241234567  (already canonical)
 *   +1XXXXXXXXXX      → +1XXXXXXXXXX   (international numbers passed through)
 *
 * All non-digit characters are stripped first, so spaces, dashes, and
 * parentheses are tolerated (e.g. "024 123 4567" → "+233241234567").
 *
 * This function ALWAYS returns a string starting with "+". The caller must
 * validate the result with /^\+\d{10,15}$/ before using it.
 */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) return `+233${digits.slice(1)}`;
  if (digits.startsWith("233") && digits.length === 12) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return `+${digits}`; // Let the caller's regex validate length
}

/** Regex that a fully normalised E.164 phone must satisfy. */
export const E164_REGEX = /^\+\d{10,15}$/;
