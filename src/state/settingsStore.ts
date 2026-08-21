/**
 * Settings — ported from the desktop `src/js/settings.js`, minus every key that
 * belonged to an engine or TTS provider this build doesn't ship yet.
 *
 * There are no API-key fields any more: on web the keys never leave the server
 * (`lib/config/capabilities.ts`), and they never came from the user even on
 * mobile.
 */
'use client';

import { create } from 'zustand';

import type { CustomContext, TranslationType } from '@/lib/engine/types';
import { readJson, writeJson } from '@/lib/storage/prefs';
import type { SummaryProvider } from '@/lib/summary/types';
import {
  DEFAULT_TRANSCRIPT_SIZE,
  MAX_TRANSCRIPT_SIZE,
  MIN_TRANSCRIPT_SIZE,
} from '@/theme/tokens';

/** Live layout. Panels need width, so they are landscape-locked. */
export type ViewMode = 'stream' | 'panels';

/** `'auto'` on the target side means "follow the device language". */
export const AUTO = 'auto';

export type Prefs = {
  sourceLanguage: string;
  /** a language code, or 'auto' to follow the device */
  targetLanguage: string;
  translationType: TranslationType;
  languageA: string;
  languageB: string;
  /** reject speech outside the hinted language instead of guessing at it */
  languageHintsStrict: boolean;
  /** how long a pause must run before Soniox finalises a turn, ms */
  endpointDelay: number;
  customContext: CustomContext | null;

  /** transcript type size, clamped to the range in theme/tokens */
  fontSize: number;
  /** how many turns stay on screen; older ones remain in the saved transcript */
  maxLinesKept: number;
  viewMode: ViewMode;

  speakerDetection: boolean;
  showSpeakerChip: boolean;

  keepAwake: boolean;
  backgroundListening: boolean;
  costWarnings: boolean;
  autoHideControls: boolean;
  dimInTableMode: boolean;

  // ── AI summary ──
  summaryProvider: SummaryProvider;
  /** BCP-47 code, or 'auto' to follow the device */
  summaryLanguage: string;
  /** attach the original-language line to each key point */
  summaryIncludeQuotes: boolean;

  /** most recently picked language codes, newest first */
  recentLanguages: string[];
  onboarded: boolean;
};

/** Whatever the browser is set to — the fallback for every 'auto' target. */
export function deviceLanguage(): string {
  try {
    // navigator.language is a full tag ("en-GB"); the engines want the subtag.
    return globalThis.navigator?.language?.split('-')[0] || 'en';
  } catch {
    return 'en';
  }
}

/** Turns an 'auto' preference into a concrete code for the engine. */
export function resolveLanguage(code: string): string {
  return code === AUTO ? deviceLanguage() : code;
}

const DEFAULTS: Prefs = {
  sourceLanguage: AUTO,
  targetLanguage: AUTO,
  translationType: 'one_way',
  languageA: AUTO,
  languageB: 'en',
  languageHintsStrict: false,
  endpointDelay: 3000,
  customContext: null,

  fontSize: DEFAULT_TRANSCRIPT_SIZE,
  maxLinesKept: 300,
  viewMode: 'stream',

  speakerDetection: true,
  showSpeakerChip: true,

  keepAwake: true,
  backgroundListening: true,
  costWarnings: true,
  autoHideControls: true,
  dimInTableMode: true,

  summaryProvider: 'openai',
  // English by default rather than AUTO: the app's own chrome is English, and a
  // summary that silently changed language with the phone's locale read as a
  // bug. Still switchable per user in Settings → AI summary.
  summaryLanguage: 'en',
  summaryIncludeQuotes: false,

  recentLanguages: [],
  onboarded: false,
};

const PREFS_KEY = 'prefs';

type SettingsState = {
  prefs: Prefs;
  loaded: boolean;
  load: () => Promise<void>;
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  merge: (patch: Partial<Prefs>) => void;
  rememberLanguage: (code: string) => void;
};

/**
 * Saved prefs are spread *over* `DEFAULTS`, so narrowing the size range never
 * reaches a device that has already stored a value. An install that picked 90px
 * back when the range was 16–140 would load holding a size the slider can no
 * longer represent — the thumb would sit off the end of the track — and the
 * transcript would keep rendering at it. Pull it into range on the way in.
 *
 * Only in memory: `set`/`merge` write the whole prefs object, so the clamped
 * value reaches disk the first time anything else changes, and a load that
 * clamps again in the meantime costs nothing.
 */
function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_TRANSCRIPT_SIZE;
  return Math.min(MAX_TRANSCRIPT_SIZE, Math.max(MIN_TRANSCRIPT_SIZE, size));
}

export const useSettings = create<SettingsState>()((set, get) => ({
  prefs: DEFAULTS,
  loaded: false,

  load: async () => {
    const stored = await readJson<Prefs>(PREFS_KEY, DEFAULTS);
    set({ prefs: { ...stored, fontSize: clampFontSize(stored.fontSize) }, loaded: true });
  },

  set: (key, value) => {
    const prefs = { ...get().prefs, [key]: value };
    set({ prefs });
    void writeJson(PREFS_KEY, prefs);
  },

  merge: (patch) => {
    const prefs = { ...get().prefs, ...patch };
    set({ prefs });
    void writeJson(PREFS_KEY, prefs);
  },

  rememberLanguage: (code) => {
    if (code === AUTO) return;
    const current = get().prefs.recentLanguages.filter((c) => c !== code);
    get().merge({ recentLanguages: [code, ...current].slice(0, 3) });
  },
}));

export { DEFAULTS as DEFAULT_PREFS };
