/**
 * Summary generation, tracked per session.
 *
 * Generation is kicked off from the save dialog and can also be retried or
 * regenerated from the Library. Either way it runs detached from whichever
 * screen started it, so the store — not a component — owns the in-flight state.
 *
 * The invariant the UI leans on in every state: **the transcript is already
 * saved**. A summary that is still generating, has no key, or failed outright
 * never puts the conversation itself at risk.
 *
 * The only web change is the call itself: instead of posting to OpenAI from the
 * device, it posts to `/api/summary`, which holds the key. Every error path,
 * including the missing-key branch, behaves exactly as before.
 */
'use client';

import { create } from 'zustand';

import { hasOpenAIKey } from '@/lib/config/capabilities';
import { speakerNameIn, toSummaryInput } from '@/lib/sessions/format';
import { attachSummary, readSession } from '@/lib/sessions/store';
import { requestSummary } from '@/lib/summary/request';
import { MissingKeyError, type Summary, type SummaryStatus } from '@/lib/summary/types';
import { resolveLanguage, useSettings } from '@/state/settingsStore';

type SummaryState = {
  status: Record<string, SummaryStatus>;
  errors: Record<string, string>;
  /** True when the failure was a missing key rather than a provider error. */
  missingKey: Record<string, boolean>;
  generate: (sessionId: string) => Promise<Summary | null>;
  statusOf: (sessionId: string) => SummaryStatus;
  clear: (sessionId: string) => void;
};

export const useSummaryStore = create<SummaryState>()((set, get) => ({
  status: {},
  errors: {},
  missingKey: {},

  statusOf: (sessionId) => get().status[sessionId] ?? 'idle',

  clear: (sessionId) => {
    const { status, errors, missingKey } = get();
    const nextStatus = { ...status };
    const nextErrors = { ...errors };
    const nextMissing = { ...missingKey };
    delete nextStatus[sessionId];
    delete nextErrors[sessionId];
    delete nextMissing[sessionId];
    set({ status: nextStatus, errors: nextErrors, missingKey: nextMissing });
  },

  generate: async (sessionId) => {
    if (get().status[sessionId] === 'generating') return null;

    set({
      status: { ...get().status, [sessionId]: 'generating' },
      errors: { ...get().errors, [sessionId]: '' },
      missingKey: { ...get().missingKey, [sessionId]: false },
    });

    const fail = (message: string, missing = false) => {
      set({
        status: { ...get().status, [sessionId]: 'error' },
        errors: { ...get().errors, [sessionId]: message },
        missingKey: { ...get().missingKey, [sessionId]: missing },
      });
      return null;
    };

    try {
      const data = await readSession(sessionId);
      if (!data) return fail('Session not found');

      const { prefs } = useSettings.getState();
      if (prefs.summaryProvider !== 'openai') {
        return fail('That provider is not supported in this build', true);
      }
      // No key means the deployment was published without one — a configuration
      // problem, not something the user can fix by typing.
      if (!hasOpenAIKey()) return fail('This build has no summary key', true);

      const transcript = toSummaryInput(data, (id) => speakerNameIn(data, id));
      if (!transcript.trim()) return fail('This session has nothing to summarize');

      const summary = await requestSummary(transcript, {
        language: resolveLanguage(prefs.summaryLanguage),
        includeSourceQuotes: prefs.summaryIncludeQuotes,
      });

      await attachSummary(sessionId, summary);
      set({ status: { ...get().status, [sessionId]: 'idle' } });
      return summary;
    } catch (err) {
      if (err instanceof MissingKeyError) return fail(err.message, true);
      return fail(err instanceof Error ? err.message : String(err));
    }
  },
}));

/** Start a summary without waiting for it — used right after Save. */
export function generateInBackground(sessionId: string) {
  void useSummaryStore.getState().generate(sessionId);
}
