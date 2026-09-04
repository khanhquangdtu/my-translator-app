/**
 * Meeting summaries via OpenAI.
 *
 * Ported unchanged from the Expo app except for where it runs: this module is
 * server-only, reached through `/api/summary`, so the OpenAI key never enters a
 * browser. The response is constrained with a strict JSON schema so the five
 * sections always come back in the shape the UI renders, rather than as prose
 * we would have to parse.
 *
 * Two things here look like they could be simplified and cannot:
 *  - `max_completion_tokens`, not `max_tokens` — the gpt-5 family rejects the
 *    latter outright, and takes no custom `temperature` either.
 *  - the defensive parsing at the bottom. A model can satisfy a strict schema
 *    and still hand back the wrong types, and a summary is rendered straight
 *    into the UI.
 */
import 'server-only';

import { OPENAI_SUMMARY_MODEL } from '@/lib/summary/model';
import { MissingKeyError, type Summary } from '@/lib/summary/types';

import { readOpenAIUsage, recordUsage } from './usage';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const REQUEST_TIMEOUT_MS = 90000;

/** Keeps a long meeting inside the context window and the cost estimate. */
const MAX_TRANSCRIPT_CHARS = 120000;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tldr', 'keyPoints', 'decisions', 'actions', 'openQuestions'],
  properties: {
    tldr: {
      type: 'string',
      description: 'Two or three sentences covering the whole conversation.',
    },
    keyPoints: { type: 'array', items: { type: 'string' } },
    decisions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Things the group actually settled. Empty if nothing was decided.',
    },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['owner', 'text'],
        properties: {
          owner: {
            type: ['string', 'null'],
            description:
              'Speaker name exactly as it appears in the transcript, or null if nobody was named.',
          },
          text: { type: 'string' },
        },
      },
    },
    openQuestions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Questions raised but left unresolved. Empty if there were none.',
    },
  },
} as const;

export type SummarizeOptions = {
  apiKey: string;
  /** the language the summary should be written in, e.g. "vi", "en" */
  language: string;
  /** attach the original-language line to each key point */
  includeSourceQuotes: boolean;
  signal?: AbortSignal;
};

export async function summarizeWithOpenAI(
  transcript: string,
  { apiKey, language, includeSourceQuotes, signal }: SummarizeOptions
): Promise<Summary> {
  if (!apiKey.trim()) throw new MissingKeyError();
  if (!transcript.trim()) throw new Error('Nothing to summarize');

  const clipped =
    transcript.length > MAX_TRANSCRIPT_CHARS
      ? // Keep the end: the close of a meeting carries the decisions.
        `…\n${transcript.slice(-MAX_TRANSCRIPT_CHARS)}`
      : transcript;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  signal?.addEventListener('abort', () => controller.abort());

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_SUMMARY_MODEL,
        // gpt-5 family: `max_tokens` is rejected, and temperature is fixed.
        max_completion_tokens: 4000,
        messages: [
          { role: 'system', content: systemPrompt(language, includeSourceQuotes) },
          { role: 'user', content: clipped },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'conversation_summary', strict: true, schema: SCHEMA },
        },
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) throw new Error('Timed out while summarizing');
    throw new Error(`Could not reach OpenAI: ${String(err)}`);
  }
  clearTimeout(timer);

  if (!response.ok) {
    throw new Error(await describeFailure(response));
  }

  const payload = await response.json();

  // Bookkeeping for the admin dashboard. OpenAI publishes no usage endpoint a
  // project key may call, so what the response already tells us is the only
  // record there will be. Fire-and-forget by design -- see `recordUsage`.
  const spent = readOpenAIUsage(payload);
  if (spent) {
    recordUsage({
      provider: 'openai',
      model: OPENAI_SUMMARY_MODEL,
      inputTokens: spent.input,
      outputTokens: spent.output,
      route: 'summary',
    });
  }
  const content: string | undefined = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned empty content');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Could not parse the summary result');
  }

  return {
    tldr: typeof parsed.tldr === 'string' ? parsed.tldr : '',
    keyPoints: stringList(parsed.keyPoints),
    decisions: stringList(parsed.decisions),
    actions: actionList(parsed.actions),
    openQuestions: stringList(parsed.openQuestions),
    model: OPENAI_SUMMARY_MODEL,
    provider: 'openai',
    generatedAt: new Date().toISOString(),
  };
}

function systemPrompt(language: string, includeSourceQuotes: boolean): string {
  return [
    'You summarise transcripts of real conversations and meetings.',
    `Write every part of the summary in this language (BCP-47 code): ${language}.`,
    'The transcript is bilingual: each turn shows the translated line and, indented under it, the original line. Read both.',
    'Speaker labels are as detected by diarization; use those exact names when attributing action items.',
    includeSourceQuotes
      ? 'For each key point, append the original-language sentence it came from in quotation marks.'
      : 'Do not quote the transcript verbatim; paraphrase.',
    'Be concrete and short. Prefer specifics (numbers, dates, names) over generalities.',
    'Leave a section as an empty array when the conversation genuinely contains nothing for it. Do not invent decisions or action items that were not discussed.',
  ].join('\n');
}

async function describeFailure(response: Response): Promise<string> {
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message ?? '';
  } catch {
    // a non-JSON error body tells us nothing extra
  }

  switch (response.status) {
    case 401:
      return 'Invalid OpenAI API key.';
    case 429:
      return 'Provider returned 429 (rate limited). Nothing was lost.';
    case 402:
      return 'OpenAI account is out of quota.';
    default:
      return `OpenAI error ${response.status}${detail ? `: ${detail}` : ''}`;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function actionList(value: unknown): Summary['actions'] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    .map((v) => ({
      owner: typeof v.owner === 'string' && v.owner.trim() ? v.owner : null,
      text: typeof v.text === 'string' ? v.text : '',
    }))
    .filter((a) => a.text);
}
