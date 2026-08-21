/**
 * The OpenAI summary call, run server-side.
 *
 * The mobile build posted the transcript to OpenAI straight from the device on
 * a key baked into the bundle. Here the key stays on the server and the browser
 * posts the transcript to us instead. The request/response shapes are otherwise
 * the mobile call's, so the store on the other end is unchanged.
 *
 * Note what is *not* validated: the transcript's contents. It is the user's own
 * conversation and it is clipped downstream — rejecting it here on a length
 * guess would fail the exact meeting most worth summarising.
 */
import { NextResponse } from 'next/server';

import { MissingKeyError } from '@/lib/summary/types';
import { summarizeWithOpenAI } from '@/server/openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The model is allowed up to 90 s; the platform must not cut in before that. */
export const maxDuration = 120;

type Body = {
  transcript?: unknown;
  language?: unknown;
  includeSourceQuotes?: unknown;
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'This deployment has no summary key configured.', missingKey: true },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const transcript = typeof body.transcript === 'string' ? body.transcript : '';
  if (!transcript.trim()) {
    return NextResponse.json({ error: 'This session has nothing to summarize' }, { status: 400 });
  }

  try {
    const summary = await summarizeWithOpenAI(transcript, {
      apiKey,
      language: typeof body.language === 'string' && body.language ? body.language : 'en',
      includeSourceQuotes: body.includeSourceQuotes === true,
    });
    return NextResponse.json({ summary }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof MissingKeyError) {
      return NextResponse.json({ error: err.message, missingKey: true }, { status: 503 });
    }
    // summarizeWithOpenAI already phrases its failures for the user ("Provider
    // returned 429 (rate limited). Nothing was lost."), so pass them straight
    // through rather than flattening them to a generic 500.
    const message = (err as Error)?.message || 'The summary failed.';
    console.error('[api/summary]', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
