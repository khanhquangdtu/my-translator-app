/**
 * Mints a short-lived Soniox key for one WebSocket.
 *
 * This is the piece that replaces the desktop app's Rust layer for the STT
 * side. The browser cannot be given the real key — a JS bundle is readable by
 * anyone who opens devtools — but it *can* be given one that only works for the
 * next minute, which is all it needs to open a socket.
 *
 * Proxying the audio itself through here was the alternative and is worse: a
 * Next route handler cannot host a WebSocket server, and relaying 200 ms PCM
 * frames through a serverless function would add a hop to every packet of a
 * latency-critical stream for no security gain, since the temporary key already
 * keeps the real credential server-side.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SONIOX_AUTH_ENDPOINT = 'https://api.soniox.com/v1/auth/temporary-api-key';

/**
 * `expires_in_seconds` bounds how long the key may be used to *open* a stream,
 * not how long an open stream may run — an in-flight session is never cut off
 * by it. A minute is ample: the client fetches one immediately before every
 * connect.
 */
const EXPIRES_IN_SECONDS = 60;

/**
 * A hard ceiling on a single stream. The engine rolls the socket over every 3
 * minutes (`SESSION_DURATION_MS`), so 4 leaves room for the make-before-break
 * overlap while still capping what a leaked key could spend.
 */
const MAX_SESSION_DURATION_SECONDS = 240;

export async function POST() {
  const apiKey = process.env.SONIOX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'This deployment has no Soniox key configured.' },
      { status: 503 }
    );
  }

  let response: Response;
  try {
    response = await fetch(SONIOX_AUTH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        usage_type: 'transcribe_websocket',
        expires_in_seconds: EXPIRES_IN_SECONDS,
        max_session_duration_seconds: MAX_SESSION_DURATION_SECONDS,
      }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not reach Soniox: ${(err as Error)?.message ?? String(err)}` },
      { status: 502 }
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // Deliberately vague about *which* key failed: the message reaches the
    // error banner, and the user has no key of their own to fix.
    const message =
      response.status === 401
        ? 'Soniox rejected this deployment’s key.'
        : response.status === 402
          ? 'The Soniox account is out of credit.'
          : `Soniox returned ${response.status}.`;
    console.error('[soniox/token]', response.status, detail.slice(0, 500));
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const body = (await response.json().catch(() => null)) as { api_key?: unknown } | null;
  if (typeof body?.api_key !== 'string' || !body.api_key) {
    return NextResponse.json({ error: 'Soniox returned an unusable key.' }, { status: 502 });
  }

  return NextResponse.json(
    { apiKey: body.api_key, expiresInSeconds: EXPIRES_IN_SECONDS },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
