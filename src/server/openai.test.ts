/**
 * Contract tests for the OpenAI summary client.
 *
 * These cover the parts that fail quietly in production: a request shaped for
 * the wrong API (the gpt-5 family rejects `max_tokens`), and a model that
 * returns JSON of the right shape but the wrong types. Both are cheap to
 * assert here and expensive to discover after a meeting.
 *
 * `fetch` is stubbed rather than a local server being started, so the real
 * module is exercised — not a patched copy of it.
 *
 * Ported from the Expo build's `scripts/summary.test.mjs`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { summarizeWithOpenAI } from './openai';

type Recorded = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

const RESPONSES = {
  ok: {
    status: 200,
    body: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              tldr: 'Revenue grew 12%.',
              keyPoints: ['Up 12% YoY', 'Growth from SE Asia'],
              decisions: ['Shift 20% of Q4 budget'],
              actions: [
                { owner: 'Kenji', text: 'Send revised budget by Friday' },
                { owner: null, text: 'Draft JDs' },
              ],
              openQuestions: ['Does Jakarta slip?'],
            }),
          },
        },
      ],
    },
  },
  /** right shape, wrong types — what a model actually does on a bad day */
  partial: {
    status: 200,
    body: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              tldr: 'Short recap.',
              keyPoints: ['a', 5, 'b'],
              decisions: null,
              actions: [
                { owner: '  ', text: 'Do the thing' },
                { owner: 'Kenji', text: '' },
                'junk',
              ],
            }),
          },
        },
      ],
    },
  },
  garbage: { status: 200, body: { choices: [{ message: { content: 'not json at all' } }] } },
  unauthorized: { status: 401, body: { error: { message: 'bad key' } } },
  ratelimit: { status: 429, body: { error: { message: 'slow down' } } },
} as const;

let mode: keyof typeof RESPONSES = 'ok';
let lastRequest: Recorded;

beforeEach(() => {
  mode = 'ok';
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    lastRequest = {
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    };
    const { status, body } = RESPONSES[mode];
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  });
});

afterEach(() => vi.unstubAllGlobals());

const TRANSCRIPT =
  '[00:04] Kenji: Revenue is up twelve percent.\n    (前年同期比で十二パーセント増加しました。)';

const opts = (over: Partial<Parameters<typeof summarizeWithOpenAI>[1]> = {}) => ({
  apiKey: 'sk-test',
  language: 'vi',
  includeSourceQuotes: false,
  ...over,
});

describe('summarizeWithOpenAI — request shape', () => {
  it('calls the chat endpoint with bearer auth', async () => {
    await summarizeWithOpenAI(TRANSCRIPT, opts());
    expect(lastRequest.url).toContain('/v1/chat/completions');
    expect(lastRequest.headers.Authorization).toBe('Bearer sk-test');
  });

  it('requests a strict json_schema', async () => {
    await summarizeWithOpenAI(TRANSCRIPT, opts());
    const format = lastRequest.body.response_format as {
      type: string;
      json_schema: { strict: boolean };
    };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.strict).toBe(true);
  });

  it('uses max_completion_tokens, which gpt-5 requires instead of max_tokens', async () => {
    await summarizeWithOpenAI(TRANSCRIPT, opts());
    expect(lastRequest.body.max_completion_tokens).toBeTruthy();
    expect(lastRequest.body.max_tokens).toBeUndefined();
  });

  it('does not pin temperature, which the gpt-5 family refuses', async () => {
    await summarizeWithOpenAI(TRANSCRIPT, opts());
    expect(lastRequest.body.temperature).toBeUndefined();
  });

  it('puts the requested language in the system prompt', async () => {
    await summarizeWithOpenAI(TRANSCRIPT, opts());
    const messages = lastRequest.body.messages as { content: string }[];
    expect(messages[0].content).toContain('vi');
  });

  it('changes the prompt when source quotes are wanted', async () => {
    await summarizeWithOpenAI(TRANSCRIPT, opts({ language: 'en', includeSourceQuotes: true }));
    const messages = lastRequest.body.messages as { content: string }[];
    expect(messages[0].content).toContain('quotation marks');
  });
});

describe('summarizeWithOpenAI — response parsing', () => {
  it('parses a well-formed response', async () => {
    const summary = await summarizeWithOpenAI(TRANSCRIPT, opts());
    expect(summary.tldr).toBe('Revenue grew 12%.');
    expect(summary.keyPoints).toHaveLength(2);
    expect(summary.actions[0].owner).toBe('Kenji');
    expect(summary.actions[1].owner).toBeNull();
    expect(summary.model).toBe('gpt-5-mini');
    expect(summary.provider).toBe('openai');
  });

  it('survives a response with the right shape and the wrong types', async () => {
    mode = 'partial';
    const summary = await summarizeWithOpenAI(TRANSCRIPT, opts());
    expect(summary.keyPoints).toEqual(['a', 'b']);
    // A null section and a missing one both become an empty array — the UI
    // renders these directly and must never see a non-array here.
    expect(summary.decisions).toEqual([]);
    expect(summary.openQuestions).toEqual([]);
    // Blank owner normalised, empty-text and non-object actions dropped.
    expect(summary.actions).toEqual([{ owner: null, text: 'Do the thing' }]);
  });
});

describe('summarizeWithOpenAI — failures', () => {
  it('maps 401 to a key message', async () => {
    mode = 'unauthorized';
    await expect(summarizeWithOpenAI(TRANSCRIPT, opts())).rejects.toThrow(/Invalid OpenAI API key/);
  });

  it('maps 429 to a rate-limit message that says nothing was lost', async () => {
    mode = 'ratelimit';
    await expect(summarizeWithOpenAI(TRANSCRIPT, opts())).rejects.toThrow(/429/);
  });

  it('turns unparseable content into a readable error', async () => {
    mode = 'garbage';
    await expect(summarizeWithOpenAI(TRANSCRIPT, opts())).rejects.toThrow(/Could not parse/);
  });

  it('rejects a missing key before making a request', async () => {
    await expect(summarizeWithOpenAI(TRANSCRIPT, opts({ apiKey: '  ' }))).rejects.toThrow(
      /API key/
    );
  });

  it('rejects an empty transcript', async () => {
    await expect(summarizeWithOpenAI('   ', opts())).rejects.toThrow(/Nothing to summarize/);
  });
});
