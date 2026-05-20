import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const PIN_HASH_PREFIX = "scrypt";
const KEY_LENGTH = 32;

// Most-guessed 4-digit PINs (NIST guidance + empirical leak data).
// Kept short — full blocklists belong in a separate data file.
const WEAK_PINS = new Set([
  "0000","1111","2222","3333","4444","5555","6666","7777","8888","9999",
  "1234","4321","0123","9876","1212","2121","1122","2211","1313","3131",
  "2580","0852","2468","1357","1470","7410","0007","6969","1000","0001",
]);

/**
 * Returns true if the PIN is trivially guessable.
 * Call server-side at registration and PIN-reset time.
 */
export function isWeakPin(pin: string): boolean {
  return WEAK_PINS.has(pin);
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(pin, salt, KEY_LENGTH).toString("base64url");
  return `${PIN_HASH_PREFIX}$${salt}$${hash}`;
}

export function verifyPin(pin: string, stored: string | undefined): { valid: boolean; needsRehash: boolean } {
  if (!stored) return { valid: false, needsRehash: false };

  const [prefix, salt, expected] = stored.split("$");
  if (prefix !== PIN_HASH_PREFIX || !salt || !expected) {
    const valid =
      stored.length === pin.length &&
      timingSafeEqual(Buffer.from(stored, "utf8"), Buffer.from(pin, "utf8"));
    return { valid, needsRehash: valid };
  }

  const actual = scryptSync(pin, salt, KEY_LENGTH);
  const expectedBuffer = Buffer.from(expected, "base64url");
  const valid = actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
  return { valid, needsRehash: false };
}
