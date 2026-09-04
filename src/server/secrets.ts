/**
 * Where a provider key actually comes from.
 *
 * Two sources, in order: the admin-managed row in Mongo, then the environment
 * variable that was the only source before this page existed. That order lets
 * the admin page override a deployment without a redeploy, while a fresh
 * install with an empty database still boots on `.env.local` alone.
 *
 * Every route that used to read `process.env.SONIOX_API_KEY` goes through here
 * instead, so there is exactly one answer to "which key is live right now".
 */
import 'server-only';

import { type ProviderId, providerSpec } from '@/lib/providers/registry';

import { NoAdminSecretError, seal, unseal } from './crypto';
import { isMongoConfigured, settings } from './mongo';

const SETTINGS_ID = 'providers';

/**
 * Keys are read on every session start and every summary. Going to Mongo each
 * time would put a database round trip in front of a latency-critical path for
 * a value that changes roughly never.
 *
 * Short TTL rather than cache-forever because the app runs as more than one
 * process in principle; 30 seconds bounds how long a second process can serve
 * a key the admin just replaced. A write through `setProviderKey` clears this
 * process immediately, so the operator doing the editing sees it at once.
 */
const CACHE_TTL_MS = 30_000;

type CacheEntry = { value: string | null; at: number };
const globalForSecrets = globalThis as unknown as {
  _secretCache?: Map<string, CacheEntry>;
};
const cache = (globalForSecrets._secretCache ??= new Map<string, CacheEntry>());

function fromEnv(id: ProviderId): string | null {
  const spec = providerSpec(id);
  if (!spec) return null;
  return process.env[spec.envVar]?.trim() || null;
}

/**
 * The live key for a provider, or null if neither source has one.
 *
 * Never throws. A database that is down, a missing `ADMIN_SECRET`, a key sealed
 * under a secret that has since been rotated — all of them fall through to the
 * environment, because failing closed here would take live translation down for
 * a problem in the admin plumbing.
 */
export async function providerKey(id: ProviderId): Promise<string | null> {
  const cached = cache.get(id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  let value: string | null = null;
  try {
    value = (await storedKey(id)) ?? fromEnv(id);
  } catch {
    value = fromEnv(id);
  }

  cache.set(id, { value, at: Date.now() });
  return value;
}

/** Whether a key exists at all, without materialising it. */
export async function hasProviderKey(id: ProviderId): Promise<boolean> {
  return !!(await providerKey(id));
}

async function storedKey(id: ProviderId): Promise<string | null> {
  if (!isMongoConfigured()) return null;
  const row = await (await settings()).findOne({ _id: SETTINGS_ID });
  const sealed = row?.providerKeys?.[id];
  if (!sealed) return null;
  return unseal(sealed);
}

export type KeyOrigin = 'database' | 'environment' | 'missing';

export type ProviderStatus = {
  id: ProviderId;
  origin: KeyOrigin;
  /** Last four characters, or null when nothing is configured. */
  masked: string | null;
  /** When the stored key was last written. Null for an environment key. */
  updatedAt: string | null;
};

/**
 * What the admin page renders per card.
 *
 * Returns the masked tail rather than the key: the page needs to show which
 * credential is live, and the last four characters are enough to check against
 * a provider dashboard without being enough to spend anything.
 */
export async function providerStatus(id: ProviderId): Promise<ProviderStatus> {
  let stored: string | null = null;
  let updatedAt: string | null = null;

  if (isMongoConfigured()) {
    try {
      const row = await (await settings()).findOne({ _id: SETTINGS_ID });
      const sealed = row?.providerKeys?.[id];
      if (sealed) {
        stored = unseal(sealed);
        updatedAt = sealed.updatedAt ?? null;
      }
    } catch {
      // Reported as an environment or missing key below, which is what the
      // rest of the app will fall back to anyway.
    }
  }

  const live = stored ?? fromEnv(id);
  const origin: KeyOrigin = stored ? 'database' : live ? 'environment' : 'missing';

  return {
    id,
    origin,
    masked: live ? `••••••••${live.slice(-4)}` : null,
    updatedAt: origin === 'database' ? updatedAt : null,
  };
}

/**
 * Store a key, replacing whatever was there.
 *
 * Requires `ADMIN_SECRET` — without it there is nothing to encrypt under, and
 * writing the key in plaintext instead would quietly downgrade the guarantee
 * the caller believes it has.
 */
export async function setProviderKey(id: ProviderId, key: string): Promise<void> {
  const sealed = seal(key);
  await (
    await settings()
  ).updateOne(
    { _id: SETTINGS_ID },
    {
      $set: {
        [`providerKeys.${id}`]: { ...sealed, updatedAt: new Date().toISOString() },
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true }
  );
  cache.delete(id);
}

/**
 * Drop the stored key so the environment variable takes over again.
 *
 * The way back from a mistyped key on a deployment whose `.env.local` is still
 * correct — otherwise the only recovery would be editing the database by hand.
 */
export async function clearProviderKey(id: ProviderId): Promise<void> {
  await (
    await settings()
  ).updateOne(
    { _id: SETTINGS_ID },
    { $unset: { [`providerKeys.${id}`]: '' }, $set: { updatedAt: new Date().toISOString() } }
  );
  cache.delete(id);
}

export { NoAdminSecretError };
