/**
 * Speaker name extraction via OpenAI.
 *
 * Given a window of recent transcript turns with opaque speaker IDs, asks the
 * model to identify any real names from self-introductions, greetings, or
 * contextual references. Uses the same `gpt-5-mini` model as the summary
 * endpoint — name extraction from a 20-turn window is trivial for it.
 *
 * Follows the same patterns as `server/openai.ts`: strict JSON schema response,
 * defensive parsing, and descriptive error messages.
 */
import 'server-only';

import { OPENAI_SUMMARY_MODEL } from '@/lib/summary/model';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const REQUEST_TIMEOUT_MS = 15000;

export type IdentifyTurn = {
  speaker: string;
  text: string;
  language: string | null;
};

export type SpeakerMatch = {
  name: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
};

export type IdentifyResult = {
  names: Record<string, SpeakerMatch>;
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['names'],
  properties: {
    names: {
      type: 'object',
      description:
        'Map from speaker ID (e.g. "spk-1") to identified name. Only include speakers whose names you found.',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'confidence', 'evidence'],
        properties: {
          name: {
            type: 'string',
            description: 'The person\'s name in the original language/script as spoken.',
          },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description:
              'high = direct self-introduction, medium = addressed by name with clear mapping, low = indirect reference.',
          },
          evidence: {
            type: 'string',
            description: 'The phrase or sentence that reveals the name.',
          },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = [
  'You extract speaker names from conversation transcripts.',
  '',
  'You are given a transcript with speaker IDs (like "spk-1", "spk-2") and must determine the real names of speakers based on what is said.',
  '',
  'Look for:',
  '- Self-introductions: "I\'m John", "My name is Tanaka", "This is Maria speaking", "私は田中です"',
  '- Greetings addressed to specific speakers: "Hello John" (if you can determine which speaker is being greeted)',
  '- Third-party references that make the speaker identity clear from context',
  '',
  'Rules:',
  '- Only return names you are confident about. Missing a name is far better than assigning the wrong one.',
  '- A name must be a proper noun (person name), not a role, title, or description.',
  '- If someone says "I\'m the project manager", that is NOT a name.',
  '- Return the name in its original language/script as spoken.',
  '- If multiple possible names exist for one speaker, pick the one with strongest evidence.',
  '- For "high" confidence, there must be a direct, unambiguous self-introduction by that speaker.',
  '- Return an empty names object {} if no names can be identified.',
].join('\n');

function buildUserMessage(
  turns: IdentifyTurn[],
  knownNames: Record<string, string>,
  unknownSpeakers: string[]
): string {
  const lines: string[] = [];

  if (Object.keys(knownNames).length > 0) {
    lines.push('Already identified speakers:');
    for (const [id, name] of Object.entries(knownNames)) {
      lines.push(`  ${id} = ${name}`);
    }
    lines.push('');
  }

  lines.push(`Speakers to identify: ${unknownSpeakers.join(', ')}`);
  lines.push('');
  lines.push('Transcript:');

  for (const turn of turns) {
    const lang = turn.language ? ` [${turn.language}]` : '';
    lines.push(`${turn.speaker}${lang}: ${turn.text}`);
  }

  return lines.join('\n');
}

export async function identifySpeakers(
  turns: IdentifyTurn[],
  knownNames: Record<string, string>,
  unknownSpeakers: string[],
  apiKey: string
): Promise<IdentifyResult> {
  if (!apiKey.trim()) throw new Error('No API key');
  if (turns.length === 0 || unknownSpeakers.length === 0) return { names: {} };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
        max_completion_tokens: 500,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(turns, knownNames, unknownSpeakers) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'speaker_names', strict: true, schema: SCHEMA },
        },
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) throw new Error('Timed out identifying speakers');
    throw new Error(`Could not reach OpenAI: ${String(err)}`);
  }
  clearTimeout(timer);

  if (!response.ok) {
    throw new Error(await describeFailure(response));
  }

  const payload = await response.json();
  const content: string | undefined = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned empty content');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Could not parse identification result');
  }

  // Defensive: validate shape before returning
  const names: Record<string, SpeakerMatch> = {};
  const raw = parsed.names;
  if (raw && typeof raw === 'object') {
    for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
      if (!val || typeof val !== 'object') continue;
      const v = val as Record<string, unknown>;
      if (
        typeof v.name === 'string' &&
        v.name.trim() &&
        typeof v.confidence === 'string' &&
        ['high', 'medium', 'low'].includes(v.confidence) &&
        typeof v.evidence === 'string'
      ) {
        names[id] = {
          name: v.name.trim(),
          confidence: v.confidence as 'high' | 'medium' | 'low',
          evidence: v.evidence,
        };
      }
    }
  }

  return { names };
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
      return 'Rate limited by OpenAI.';
    case 402:
      return 'OpenAI account is out of quota.';
    default:
      return `OpenAI error ${response.status}${detail ? `: ${detail}` : ''}`;
  }
}
