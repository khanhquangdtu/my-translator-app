/**
 * What this deployment can actually do — the web replacement for the Expo
 * app's `config/credentials.ts`.
 *
 * That module answered `hasSonioxKey()` / `hasOpenAIKey()` by reading keys the
 * bundle carried, and its header carried a warning about exactly that: a key
 * inlined into a shipped bundle is public. Here the keys live only on the
 * server, so the browser cannot read them — it can only ask whether they are
 * configured. `/api/config` answers with two booleans and never the values.
 *
 * The answer is fetched once during hydration and cached, because the screens
 * ask synchronously while rendering (Live decides whether to offer a summary;
 * Start refuses outright when Soniox is unconfigured). The last answer is also
 * remembered in localStorage, so a cold or offline start begins from what this
 * deployment actually said rather than from an optimistic guess.
 */
'use client';

import { create } from 'zustand';

type Capabilities = {
  /** live translation — without it a session cannot start at all */
  soniox: boolean;
  /** meeting summaries — optional, the transcript is saved either way */
  openai: boolean;
  loaded: boolean;
  load: () => Promise<void>;
};

/**
 * What the last successful answer said, remembered across loads.
 *
 * Whether a deployment has its keys is a property of the deployment, not of the
 * session, so re-deriving it from scratch on every cold start was always a
 * round trip spent to learn something already known. Reading the remembered
 * answer synchronously also makes an offline start honest: without it the fetch
 * failed, the optimistic defaults stood, and the app claimed a Soniox key it
 * had no evidence for.
 *
 * localStorage rather than the service worker: `/api/*` is deliberately never
 * cached there, and this is our own summary of an answer rather than a replay
 * of the response.
 */
const CACHE_KEY = 'capabilities';

type CachedCapabilities = { soniox: boolean; openai: boolean };

function remembered(): CachedCapabilities | null {
  try {
    const raw = globalThis.localStorage?.getItem(`mytranslator:${CACHE_KEY}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedCapabilities>;
    if (typeof parsed?.soniox !== 'boolean' || typeof parsed?.openai !== 'boolean') return null;
    return { soniox: parsed.soniox, openai: parsed.openai };
  } catch {
    return null;
  }
}

export const useCapabilities = create<Capabilities>((set, get) => ({
  // Assume yes until told otherwise. Guessing "no" would flash a
  // build-misconfigured error on every cold start before the fetch lands.
  soniox: true,
  openai: true,
  loaded: false,

  load: async () => {
    if (get().loaded) return;

    // Start from what the deployment said last time, so the window before the
    // fetch resolves is an informed guess rather than a blanket optimistic one.
    // `loaded` stays false: this is a head start, not an answer.
    const cached = remembered();
    if (cached) set({ soniox: cached.soniox, openai: cached.openai });

    try {
      const response = await fetch('/api/config');
      const body = (await response.json()) as { soniox?: boolean; openai?: boolean };
      const next = { soniox: !!body.soniox, openai: !!body.openai };
      set({ ...next, loaded: true });
      try {
        globalThis.localStorage?.setItem(`mytranslator:${CACHE_KEY}`, JSON.stringify(next));
      } catch {
        // A full or blocked localStorage costs a round trip next time, nothing more.
      }
    } catch {
      // Offline. The cached session list still works and Start will fail with
      // its own network error, which is the more accurate message anyway —
      // and the remembered answer above is a better guess than the defaults.
      set({ loaded: true });
    }
  },
}));

export function hasSonioxKey(): boolean {
  return useCapabilities.getState().soniox;
}

export function hasOpenAIKey(): boolean {
  return useCapabilities.getState().openai;
}

/**
 * True when the deployment was published without a Soniox key — an operator
 * mistake, not a user problem. Surfaced as a configuration error rather than
 * "add your key", because there is nowhere for a user to add one.
 */
export function isMisconfigured(): boolean {
  return !useCapabilities.getState().soniox;
}
