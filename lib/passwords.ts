import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing for /app email registrations.
 *
 * Uses Node's built-in `scrypt` so we don't have to ship a native bcrypt/argon2
 * binary on Vercel. The format we persist is `scrypt$N$r$p$saltB64$hashB64`,
 * which lets us tune parameters in future without breaking existing rows.
 */

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

const N = 1 << 15; // 32768 — keeps hashing under ~150ms on Vercel's hobby tier.
const R = 8;
const P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error("Password cannot be empty");
  }
  const salt = randomBytes(SALT_LEN);
  const derived = await scrypt(plain, salt, KEY_LEN, { N, r: R, p: P });
  return [
    "scrypt",
    N.toString(),
    R.toString(),
    P.toString(),
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(plain: string, encoded: string): Promise<boolean> {
  if (typeof plain !== "string" || typeof encoded !== "string") return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }

  const derived = await scrypt(plain, salt, expected.length, { N: n, r, p });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
