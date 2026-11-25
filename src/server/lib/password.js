import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

// scrypt cost parameters (N = 2^15, r = 8, p = 1): about 32 MB of memory per hash,
// the OWASP baseline. They are stored in each hash so they can be raised later
// without invalidating existing passwords.
const DEFAULTS = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const PREFIX = 'scrypt';

const options = ({ N, r, p }) => ({ N, r, p, maxmem: 128 * N * r * 2 });

/**
 * Hashes a password with a random salt.
 * @param {string} password
 * @returns {Promise<string>} `scrypt$N$r$p$salt$hash`, salt and hash in base64url
 */
export async function hashPassword(password, params = DEFAULTS) {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options(params));
  return [
    PREFIX,
    params.N,
    params.r,
    params.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/**
 * Checks a password against a stored hash in constant time.
 * Returns false (never throws) for a malformed hash, so a bad row cannot crash sign-in.
 * @param {string} password
 * @param {string} stored
 */
export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger)) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options({ N, r, p }));
  return timingSafeEqual(actual, expected);
}

/** True when a hash was made with weaker parameters than today's defaults. */
export function needsRehash(stored) {
  const [prefix, N, r, p] = String(stored).split('$');
  return (
    prefix !== PREFIX || Number(N) < DEFAULTS.N || Number(r) < DEFAULTS.r || Number(p) < DEFAULTS.p
  );
}
