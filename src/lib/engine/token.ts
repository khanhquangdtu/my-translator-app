/**
 * Short-lived Soniox keys, fetched from our own API route.
 *
 * The Expo build read a real key out of the bundle (`config/credentials.ts`
 * carried a note admitting a published .apk makes that key public). A JS bundle
 * is even easier to read, so the browser never sees the real key at all: it
 * asks `/api/soniox/token`, gets back a key that can only open a stream for the
 * next minute, and opens the WebSocket with that.
 *
 * A fresh one is fetched per socket — which means once per connect, once per
 * reconnect, and once every three minutes for the make-before-break rollover.
 */

/** A failure the user can act on, already phrased for the error banner. */
export class SonioxTokenError extends Error {}

export async function fetchSonioxToken(signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch('/api/soniox/token', { method: 'POST', signal });
  } catch (err) {
    throw new SonioxTokenError(
      `Could not reach the server for a session key: ${(err as Error)?.message ?? String(err)}`
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new SonioxTokenError(body?.error || `Server returned ${response.status}.`);
  }

  const body = (await response.json().catch(() => null)) as { apiKey?: unknown } | null;
  if (typeof body?.apiKey !== 'string' || !body.apiKey) {
    throw new SonioxTokenError('The server returned an unusable session key.');
  }
  return body.apiKey;
}
