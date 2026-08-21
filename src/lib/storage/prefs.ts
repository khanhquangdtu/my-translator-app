/**
 * Preference storage — localStorage in place of AsyncStorage.
 *
 * The API is kept async even though localStorage is not, because every caller
 * already awaits it and because switching the backing store later (to the same
 * IndexedDB the sessions use, say) should not touch a single call site.
 *
 * The key name is unchanged from the mobile build on purpose: same product,
 * same shape, and one less thing to be surprised by when comparing the two.
 */

const PREFIX = 'mytranslator:';

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // a failed preference write should never take the session down
  }
}
