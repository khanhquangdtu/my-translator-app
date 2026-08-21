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
 * Start refuses outright when Soniox is unconfigured).
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

export const useCapabilities = create<Capabilities>((set, get) => ({
  // Assume yes until told otherwise. Guessing "no" would flash a
  // build-misconfigured error on every cold start before the fetch lands.
  soniox: true,
  openai: true,
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const response = await fetch('/api/config');
      const body = (await response.json()) as { soniox?: boolean; openai?: boolean };
      set({ soniox: !!body.soniox, openai: !!body.openai, loaded: true });
    } catch {
      // Offline. The cached session list still works and Start will fail with
      // its own network error, which is the more accurate message anyway.
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
