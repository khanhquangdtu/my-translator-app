/**
 * The provider-key cache, which fails silently in both directions.
 *
 * This sits directly in front of `/api/soniox/token`, so its whole reason to
 * exist is keeping a database round trip off the path that starts a session.
 * That makes both failure modes quiet and expensive: cache too eagerly and an
 * admin's new key does not take effect, and nobody finds out until a session
 * fails with a rejected credential; cache too little and the latency the cache
 * was added to remove comes back with no visible symptom at all.
 *
 * Mongo is stubbed rather than booted, because what is under test is the
 * caching logic — how many reads happen, which one wins a race, and what a
 * failed read is allowed to poison. A real mongod would prove none of that any
 * better and would make the timing-sensitive cases slower and flakier.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findOne = vi.fn();
const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });

vi.mock('./mongo', () => ({
  isMongoConfigured: () => true,
  settings: async () => ({ findOne, updateOne }),
}));

vi.mock('./crypto', () => ({
  NoAdminSecretError: class NoAdminSecretError extends Error {},
  seal: (key: string) => ({ iv: 'iv', tag: 'tag', data: key }),
  // The fake seal is the identity function, so unsealing is reading `data`.
  unseal: (sealed: { data: string }) => sealed.data,
}));

/** A settings row whose Soniox key is `value`. */
function row(value: string) {
  return {
    _id: 'providers',
    updatedAt: '2026-01-01T00:00:00.000Z',
    providerKeys: { soniox: { iv: 'iv', tag: 'tag', data: value, updatedAt: 'x' } },
  };
}

/**
 * Fresh module state per test. The cache lives on `globalThis` so that it
 * survives Next's dev-mode module re-evaluation, which also means it survives
 * `resetModules` — so it is cleared explicitly.
 */
async function load() {
  const g = globalThis as Record<string, unknown>;
  delete g._secretDoc;
  delete g._secretDocInflight;
  delete g._secretDocGeneration;
  vi.resetModules();
  return import('./secrets');
}

beforeEach(() => {
  findOne.mockReset();
  updateOne.mockClear();
  process.env.SONIOX_API_KEY = 'from-env';
});

afterEach(() => {
  delete process.env.SONIOX_API_KEY;
});

describe('provider key cache', () => {
  it('reads the document once for many callers', async () => {
    findOne.mockResolvedValue(row('stored'));
    const { providerKey } = await load();

    expect(await providerKey('soniox')).toBe('stored');
    expect(await providerKey('soniox')).toBe('stored');
    expect(await providerKey('soniox')).toBe('stored');

    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent cold reads into one query', async () => {
    findOne.mockResolvedValue(row('stored'));
    const { providerKey } = await load();

    // What `/api/config` does: two providers asked about at the same instant.
    const [a, b] = await Promise.all([providerKey('soniox'), providerKey('openai')]);

    expect(a).toBe('stored');
    expect(b).toBeNull();
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('serves the new key immediately after a write', async () => {
    findOne.mockResolvedValue(row('old'));
    const { providerKey, setProviderKey } = await load();
    expect(await providerKey('soniox')).toBe('old');

    findOne.mockResolvedValue(row('new'));
    await setProviderKey('soniox', 'new');

    // Not "in under five minutes" — on the very next call.
    expect(await providerKey('soniox')).toBe('new');
  });

  it('does not let an in-flight read undo a write that lands mid-flight', async () => {
    // The race the generation counter exists for: a refresh reads the old
    // document, an admin saves, and the refresh resolves last. Without the
    // guard it would reinstate the old key for another full TTL.
    let release: (v: unknown) => void = () => {};
    findOne.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );

    const { providerKey, setProviderKey } = await load();
    const inFlight = providerKey('soniox');

    findOne.mockResolvedValue(row('new'));
    await setProviderKey('soniox', 'new');

    release(row('old'));
    await inFlight;

    expect(await providerKey('soniox')).toBe('new');
  });

  it('falls back to the environment when the database is unreachable', async () => {
    findOne.mockRejectedValue(new Error('no route to host'));
    const { providerKey } = await load();

    expect(await providerKey('soniox')).toBe('from-env');
  });

  it('does not cache a failed read as "no stored key"', async () => {
    findOne.mockRejectedValueOnce(new Error('blip'));
    const { providerKey } = await load();
    expect(await providerKey('soniox')).toBe('from-env');

    // The database comes back. A cached failure would keep serving the
    // environment key for the rest of the TTL instead of asking again.
    findOne.mockResolvedValue(row('stored'));
    expect(await providerKey('soniox')).toBe('stored');
  });
});
