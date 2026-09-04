/**
 * The two pieces of cryptography the admin area needs, and nothing else.
 *
 * Both are keyed off one environment variable, `ADMIN_SECRET`, because a
 * deployment that has to manage two independent secrets tends to end up
 * managing one and a default. Separate purposes get separate derived keys via
 * HKDF-style info strings, so a cookie signature can never be replayed as an
 * encryption key or vice versa.
 *
 * Why encrypt provider keys at all, when the database is only reachable from
 * inside the compose network? Because "only reachable from inside" is a
 * property of today's deployment, not of the data. A Mongo backup, an exported
 * volume, or a future decision to point at a hosted cluster all move those rows
 * somewhere the network argument no longer holds. Ciphertext travels safely;
 * plaintext does not.
 */
import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Raised when ADMIN_SECRET is absent, so callers can answer 503 rather than 500. */
export class NoAdminSecretError extends Error {
  constructor() {
    super('ADMIN_SECRET is not set, so the admin area is disabled.');
    this.name = 'NoAdminSecretError';
  }
}

export function hasAdminSecret(): boolean {
  return !!process.env.ADMIN_SECRET?.trim();
}

function rootSecret(): string {
  const secret = process.env.ADMIN_SECRET?.trim();
  if (!secret) throw new NoAdminSecretError();
  return secret;
}

/**
 * One 32-byte key per purpose, derived rather than reused.
 *
 * Recomputed per call. HKDF over a short secret is microseconds, and caching it
 * would mean holding key material in a module-level variable across hot
 * reloads for no measurable gain.
 */
function derive(purpose: 'cookie' | 'provider-key'): Buffer {
  return Buffer.from(hkdfSync('sha256', rootSecret(), 'my-translator', purpose, 32));
}

// ─── provider key encryption ───────────────────────────────────────────

/**
 * AES-256-GCM. The nonce is random per encryption and stored alongside; GCM's
 * tag makes tampering detectable, which matters because a silently corrupted
 * key would surface as a confusing 401 from the provider rather than as a
 * decryption failure here.
 */
export type Sealed = {
  /** base64 */ iv: string;
  /** base64 */ tag: string;
  /** base64 */ data: string;
};

export function seal(plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive('provider-key'), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

/**
 * Returns null rather than throwing on any failure.
 *
 * The realistic cause is a changed `ADMIN_SECRET`, which makes every stored key
 * undecryptable at once. Callers treat that as "no key stored" and fall back to
 * the environment, so a rotated secret degrades to the pre-admin-page behaviour
 * instead of taking the whole deployment down.
 */
export function unseal(sealed: Sealed): string | null {
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      derive('provider-key'),
      Buffer.from(sealed.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

// ─── session cookie signing ────────────────────────────────────────────

export function sign(payload: string): string {
  return createHmac('sha256', derive('cookie')).update(payload).digest('base64url');
}

/**
 * Constant-time comparison.
 *
 * `===` on a signature leaks how many leading bytes matched through timing.
 * The window is small over a network, but the fix costs nothing and the
 * alternative is arguing about how small.
 */
export function verifySignature(payload: string, signature: string): boolean {
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  // timingSafeEqual throws on a length mismatch, which is itself a giveaway —
  // check length first and return the same false either way.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Constant-time string equality, for the admin password check. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
