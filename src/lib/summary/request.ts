/**
 * The client half of the summary call.
 *
 * All this does is post the transcript to `/api/summary` and re-raise whatever
 * went wrong. The messages are the route's, which are in turn the ones
 * `server/openai.ts` writes ("Provider returned 429 (rate limited). Nothing was
 * lost."), so the wording the user sees is the same as on mobile.
 */
'use client';

import { MissingKeyError, type Summary } from './types';

export type SummaryRequestOptions = {
  /** the language the summary should be written in, e.g. "vi", "en" */
  language: string;
  /** attach the original-language line to each key point */
  includeSourceQuotes: boolean;
  signal?: AbortSignal;
};

export async function requestSummary(
  transcript: string,
  { language, includeSourceQuotes, signal }: SummaryRequestOptions
): Promise<Summary> {
  let response: Response;
  try {
    response = await fetch('/api/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ transcript, language, includeSourceQuotes }),
    });
  } catch (err) {
    throw new Error(`Could not reach the server: ${(err as Error)?.message ?? String(err)}`);
  }

  const body = (await response.json().catch(() => null)) as {
    summary?: Summary;
    error?: string;
    missingKey?: boolean;
  } | null;

  if (!response.ok) {
    // Preserved as its own type so the UI can say "no key" rather than
    // "the provider failed" — they call for different copy.
    if (body?.missingKey) throw new MissingKeyError();
    throw new Error(body?.error || `The summary failed (${response.status}).`);
  }
  if (!body?.summary) throw new Error('Could not parse the summary result');

  return body.summary;
}
