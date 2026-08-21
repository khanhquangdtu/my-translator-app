/**
 * The anonymous owner id that partitions MongoDB.
 *
 * The app has no accounts and the mobile build needed none — transcripts never
 * left the phone. Moving them to a shared database means rows now need an owner,
 * so one is minted locally the first time it is asked for and sent as a header
 * on every request.
 *
 * It lives in localStorage rather than only in a cookie because it is also read
 * offline, before any request has been made. The server mirrors it into a
 * cookie so a request that arrives without the header (a service-worker replay,
 * say) still resolves to the same owner.
 */
'use client';

const KEY = 'mytranslator:device-id';

let cached: string | null = null;

export function deviceId(): string {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
    const minted = crypto.randomUUID();
    localStorage.setItem(KEY, minted);
    cached = minted;
    return minted;
  } catch {
    // Private mode with storage blocked. A per-tab id at least keeps the tab
    // consistent with itself; nothing syncs, which is the honest outcome.
    cached ??= crypto.randomUUID();
    return cached;
  }
}

/** Headers every /api call carries, so the server knows whose rows these are. */
export function ownerHeaders(): Record<string, string> {
  return { 'x-device-id': deviceId() };
}
