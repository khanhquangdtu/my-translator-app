/**
 * What each provider has cost, normalised.
 *
 * The two providers answer completely different questions, and the admin page
 * should not have to know that:
 *
 *  - Soniox publishes `/v1/usage/summary`, which returns real money — daily
 *    cost in USD, split per model, plus audio duration. Ask it.
 *  - OpenAI publishes nothing usable. `/v1/organization/costs` needs the
 *    `api.usage.read` scope that only an admin key carries, and the old
 *    `/v1/dashboard/billing/credit_grants` refuses anything but a browser
 *    session key. Both were checked against a live key; both answer 403. So the
 *    app counts what it spends, from the `usage` block every completion already
 *    returns, and reports tokens rather than inventing a price.
 *
 * Neither provider exposes a remaining balance, so nothing here pretends to
 * know one. Every figure is spend-to-date over an explicit window.
 */
import 'server-only';

import type { ProviderId, UsageSource } from '@/lib/providers/registry';

import { isMongoConfigured, usageEvents } from './mongo';
import { providerKey } from './secrets';

/** One shape for every provider, so the dashboard renders them identically. */
export type UsageSeries = {
  provider: ProviderId;
  source: UsageSource;
  /** Null when the provider gives volume but not money — OpenAI's case. */
  totalCostUsd: number | null;
  totalRequests: number;
  totalTokens: number | null;
  /** Seconds of audio, for speech providers. Null where meaningless. */
  audioSeconds: number | null;
  days: { day: string; costUsd: number | null; requests: number; tokens: number | null }[];
  models: { model: string; costUsd: number | null; requests: number; tokens: number | null }[];
  /** Set when the figures could not be obtained. The card shows this instead. */
  error: string | null;
};

// ─── recording (self-tracked providers) ────────────────────────────────

export type UsageRecord = {
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  route: string;
};

/**
 * Record one billable call. Never throws, never awaited by the caller.
 *
 * This runs on the response path of a request the user is waiting for. A
 * bookkeeping row is worth strictly less than the summary it is describing, so
 * a database hiccup must lose the row rather than the response.
 */
export function recordUsage(record: UsageRecord): void {
  if (!isMongoConfigured()) return;

  void (async () => {
    try {
      await (
        await usageEvents()
      ).insertOne({
        provider: record.provider,
        at: new Date().toISOString(),
        model: record.model,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        totalTokens: record.inputTokens + record.outputTokens,
        route: record.route,
      });
    } catch (err) {
      console.error('[usage] could not record', (err as Error)?.message ?? err);
    }
  })();
}

/**
 * Pull token counts out of a provider response.
 *
 * Defensive because this parses somebody else's JSON on a path that must not
 * throw: a shape change at OpenAI should cost us a usage row, not a summary.
 */
export function readOpenAIUsage(payload: unknown): { input: number; output: number } | null {
  const usage = (payload as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage) return null;
  const input = Number(usage.prompt_tokens ?? usage.input_tokens);
  const output = Number(usage.completion_tokens ?? usage.output_tokens);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return { input, output };
}

// ─── reading ───────────────────────────────────────────────────────────

function emptySeries(
  provider: ProviderId,
  source: UsageSource,
  error: string | null = null
): UsageSeries {
  return {
    provider,
    source,
    totalCostUsd: null,
    totalRequests: 0,
    totalTokens: null,
    audioSeconds: null,
    days: [],
    models: [],
    error,
  };
}

/** UTC day boundary `days` back, so windows line up with what providers report. */
export function windowStart(days: number): Date {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - (days - 1));
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/**
 * OpenAI, from our own rows.
 *
 * Counts only what this app spent, which is the more useful number anyway: an
 * org-wide figure would mix in every other project on the same account.
 */
export async function openaiUsage(days: number): Promise<UsageSeries> {
  const series = emptySeries('openai', 'self-tracked');
  if (!isMongoConfigured()) {
    return { ...series, error: 'No database configured, so nothing is being recorded.' };
  }

  const since = windowStart(days).toISOString();

  try {
    const rows = await (await usageEvents())
      .find({ provider: 'openai', at: { $gte: since } })
      .toArray();

    const byDay = new Map<string, { requests: number; tokens: number }>();
    const byModel = new Map<string, { requests: number; tokens: number }>();
    let totalTokens = 0;

    for (const row of rows) {
      const day = row.at.slice(0, 10);
      const d = byDay.get(day) ?? { requests: 0, tokens: 0 };
      d.requests += 1;
      d.tokens += row.totalTokens;
      byDay.set(day, d);

      const m = byModel.get(row.model) ?? { requests: 0, tokens: 0 };
      m.requests += 1;
      m.tokens += row.totalTokens;
      byModel.set(row.model, m);

      totalTokens += row.totalTokens;
    }

    return {
      ...series,
      totalRequests: rows.length,
      totalTokens,
      days: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, v]) => ({ day, costUsd: null, requests: v.requests, tokens: v.tokens })),
      models: [...byModel.entries()]
        .sort((a, b) => b[1].tokens - a[1].tokens)
        .map(([model, v]) => ({ model, costUsd: null, requests: v.requests, tokens: v.tokens })),
    };
  } catch (err) {
    return { ...series, error: `Could not read usage: ${(err as Error)?.message ?? err}` };
  }
}

const SONIOX_USAGE_ENDPOINT = 'https://api.soniox.com/v1/usage/summary';
const SONIOX_TIMEOUT_MS = 15000;

type SonioxBucket = {
  model?: string | null;
  days?: string[];
  total_cost_usd?: string;
  total_num_requests?: number;
  total_input_audio_duration_ms?: number;
  total_input_audio_tokens?: number;
  total_output_text_tokens?: number;
  cost_usd?: string[];
  num_requests?: number[];
};

/**
 * Soniox, from the provider.
 *
 * Costs come back as decimal *strings* — Soniox is avoiding float rounding on
 * fractions of a cent, and parsing them to numbers here is safe only because
 * these are display totals, never re-billed.
 */
export async function sonioxUsage(days: number): Promise<UsageSeries> {
  const series = emptySeries('soniox', 'provider-api');

  const key = await providerKey('soniox');
  if (!key) return { ...series, error: 'No Soniox key configured.' };

  const start = windowStart(days);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + 1);
  end.setUTCHours(0, 0, 0, 0);

  const url = `${SONIOX_USAGE_ENDPOINT}?start_time=${start.toISOString()}&end_time=${end.toISOString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SONIOX_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);

    if (!response.ok) {
      const detail = response.status === 401 ? 'Soniox rejected the key.' : `Soniox returned ${response.status}.`;
      return { ...series, error: detail };
    }

    const body = (await response.json()) as { total?: SonioxBucket; models?: SonioxBucket[] };
    const total = body.total ?? {};
    const dayLabels = total.days ?? [];
    const costs = total.cost_usd ?? [];
    const requests = total.num_requests ?? [];

    return {
      ...series,
      totalCostUsd: Number(total.total_cost_usd ?? 0),
      totalRequests: total.total_num_requests ?? 0,
      totalTokens: (total.total_input_audio_tokens ?? 0) + (total.total_output_text_tokens ?? 0),
      audioSeconds: Math.round((total.total_input_audio_duration_ms ?? 0) / 1000),
      days: dayLabels.map((day, i) => ({
        day,
        costUsd: Number(costs[i] ?? 0),
        requests: requests[i] ?? 0,
        tokens: null,
      })),
      models: (body.models ?? []).map((m) => ({
        model: m.model ?? 'unknown',
        costUsd: Number(m.total_cost_usd ?? 0),
        requests: m.total_num_requests ?? 0,
        tokens: null,
      })),
    };
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) return { ...series, error: 'Soniox timed out.' };
    return { ...series, error: `Could not reach Soniox: ${(err as Error)?.message ?? err}` };
  }
}

/**
 * Every provider's figures, gathered concurrently.
 *
 * One slow provider must not serialise behind another — the dashboard shows
 * whatever arrived, and a card whose fetch failed carries its own error.
 */
export async function allUsage(days: number): Promise<UsageSeries[]> {
  return Promise.all([sonioxUsage(days), openaiUsage(days)]);
}
