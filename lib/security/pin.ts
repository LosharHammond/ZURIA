import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const PIN_HASH_PREFIX = "scrypt";
const KEY_LENGTH = 32;

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
