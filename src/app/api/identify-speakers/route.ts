/**
 * Speaker name extraction endpoint.
 *
 * Receives a window of recent transcript turns with opaque speaker IDs and
 * returns any real names the model can identify from the conversation. Called
 * by the client-side identification orchestrator during a live session.
 */
import { NextResponse } from 'next/server';

import { identifySpeakers, type IdentifyTurn } from '@/server/identify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Body = {
  turns?: unknown;
  knownNames?: unknown;
  unknownSpeakers?: unknown;
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'No OpenAI key configured.', missingKey: true },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const turns = Array.isArray(body.turns) ? (body.turns as IdentifyTurn[]) : [];
  const knownNames =
    body.knownNames && typeof body.knownNames === 'object'
      ? (body.knownNames as Record<string, string>)
      : {};
  const unknownSpeakers = Array.isArray(body.unknownSpeakers)
    ? (body.unknownSpeakers as string[])
    : [];

  if (turns.length === 0 || unknownSpeakers.length === 0) {
    return NextResponse.json({ names: {} });
  }

  try {
    const result = await identifySpeakers(turns, knownNames, unknownSpeakers, apiKey);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = (err as Error)?.message || 'Speaker identification failed.';
    console.error('[api/identify-speakers]', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
