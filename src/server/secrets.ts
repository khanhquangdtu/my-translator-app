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
import { isMongoConfigured, settings, type SettingsRow } from './mongo';

const SETTINGS_ID = 'providers';

/**
 * Keys are read on every session start and every summary. Going to Mongo each
 * time would put a database round trip in front of a latency-critical path for
 * a value that changes roughly never.
 *
 * Cache-forever is still wrong — the app runs as more than one process in
 * principle, and the TTL bounds how long a second process can serve a key the
 * admin just replaced — but 30 seconds was far shorter than that argument
 * needs. It also happened to equal the Docker healthcheck interval, so the
 * healthcheck kept landing on a just-expired cache and paying for the refill.
 * Five minutes is still promptly enough for an operator watching the admin
 * page, and a write through `setProviderKey` clears this process immediately,
 * so the one doing the editing sees it at once regardless.
 */
const CACHE_TTL_MS = 5 * 60_000;

/**
 * The whole settings document, not one entry per provider.
 *
 * All the keys live in a single row, so a per-provider cache turned one
 * document into N round trips for it — `/api/config` asks about Soniox and
 * OpenAI together and used to issue two identical `findOne` calls.
 */
type DocCache = { doc: SettingsRow | null; at: number };
const globalForSecrets = globalThis as unknown as {
  _secretDoc?: DocCache;
  _secretDocInflight?: Promise<SettingsRow | null>;
  /**
   * Bumped by every write and every explicit invalidation.
   *
   * Without it a refresh that began before an admin saved a key could resolve
   * after the save and reinstate the document it read on the way in — pinning
   * the *old* key in cache for another full TTL, which is exactly the bug the
   * invalidation exists to prevent. A read whose generation no longer matches
   * is still returned to its caller; it just does not get to be the cache.
   */
  _secretDocGeneration?: number;
};

async function readSettingsDoc(): Promise<SettingsRow | null> {
  return (await (await settings()).findOne({ _id: SETTINGS_ID })) ?? null;
}

/**
 * The settings document, cached, coalesced, and served stale while it refills.
 *
 * Three things this has to get right, all of them about keeping Mongo off the
 * path that mints a Soniox token:
 *
 *  - **Coalescing.** Concurrent callers share one in-flight read instead of
 *    racing to issue the same query.
 *  - **Stale-while-revalidate.** Once the app has read the document even once,
 *    expiry never blocks a caller again: the stale copy is returned and the
 *    refresh happens behind it. Only the very first read of a process waits.
 *  - **Failing soft.** A database that is down resolves to `null`, which sends
 *    every caller to the environment variable. Callers already treat that as
 *    the normal fallback, so an admin-plumbing problem cannot take live
 *    translation down with it.
 */
function settingsDoc(): Promise<SettingsRow | null> | SettingsRow | null {
  const cached = globalForSecrets._secretDoc;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.doc;

  if (!globalForSecrets._secretDocInflight) {
    const generation = globalForSecrets._secretDocGeneration ?? 0;
    globalForSecrets._secretDocInflight = (
      isMongoConfigured() ? readSettingsDoc() : Promise.resolve(null)
    )
      .then((doc) => {
        // Only cache a read that nothing invalidated while it was in flight.
        if ((globalForSecrets._secretDocGeneration ?? 0) === generation) {
          globalForSecrets._secretDoc = { doc, at: Date.now() };
        }
        return doc;
      })
      .catch(() => {
        /*
         * The database is unreachable. Deliberately *not* cached: storing
         * `null` here would mean a momentary blip convinced the process there
         * were no stored keys, and it would keep believing that for a full TTL
         * rather than retrying. The stale copy above (if any) keeps being
         * served, and callers fall through to the environment either way.
         */
        return globalForSecrets._secretDoc?.doc ?? null;
      })
      .finally(() => {
        globalForSecrets._secretDocInflight = undefined;
      });
  }

  // Stale but present: hand it back now, let the refresh land behind it.
  if (cached) return cached.doc;
  return globalForSecrets._secretDocInflight;
}

/** Drops the cache, and disowns any read already in flight, so the next read is fresh. */
function forgetSettingsDoc() {
  globalForSecrets._secretDoc = undefined;
  globalForSecrets._secretDocGeneration = (globalForSecrets._secretDocGeneration ?? 0) + 1;
}

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
  try {
    const doc = await settingsDoc();
    return storedKeyFrom(doc, id) ?? fromEnv(id);
  } catch {
    return fromEnv(id);
  }
}

/** Whether a key exists at all, without materialising it. */
export async function hasProviderKey(id: ProviderId): Promise<boolean> {
  return !!(await providerKey(id));
}

/**
 * Unseal one provider's key out of an already-fetched settings document.
 *
 * Decryption is deliberately not cached: `hkdfSync` plus one AES-256-GCM open
 * over a ~50-byte payload is single-digit microseconds, and the derived key is
 * the one thing here worth not keeping in memory. The round trip was always
 * the cost; this only ever needed to happen once per document read.
 */
function storedKeyFrom(doc: SettingsRow | null, id: ProviderId): string | null {
  const sealed = doc?.providerKeys?.[id];
  if (!sealed) return null;
  try {
    return unseal(sealed);
  } catch {
    // Sealed under a rotated ADMIN_SECRET. The environment takes over.
    return null;
  }
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

  try {
    // The shared document cache, so rendering N cards costs one read rather
    // than N identical ones. Staleness is not a hazard here: every write goes
    // through `setProviderKey`/`clearProviderKey`, both of which drop the
    // cache, so the page an operator sees straight after saving is fresh.
    const doc = await settingsDoc();
    const sealed = doc?.providerKeys?.[id];
    if (sealed) {
      stored = storedKeyFrom(doc, id);
      updatedAt = sealed.updatedAt ?? null;
    }
  } catch {
    // Reported as an environment or missing key below, which is what the
    // rest of the app will fall back to anyway.
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
  forgetSettingsDoc();
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
  forgetSettingsDoc();
}

export { NoAdminSecretError };
