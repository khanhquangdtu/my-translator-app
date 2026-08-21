/**
 * Live session state: the turn stream, speaker roster, connection status, and
 * the session record that gets written to disk.
 *
 * The pairing algorithm is ported from the desktop `src/js/ui.js`, and it is the
 * part most easily got wrong. Soniox does not emit a turn as one object — it
 * emits **two independent streams**: finalised source text (`onOriginal`) and
 * finalised translated text (`onTranslation`), with no correlation id between
 * them. They are matched FIFO: each translation fills the oldest turn still
 * waiting for one.
 *
 * One deliberate departure from the desktop: where it kept two parallel arrays
 * (a trimmed display list and an untrimmed `sessionLog`) and *deleted* turns
 * that never received a translation, this keeps a single array and instead
 * marks a stale turn final with an empty translation. The line stays visible as
 * source-only rather than vanishing from under the reader, and display and
 * saved transcript can't drift apart.
 */
import { create } from 'zustand';

import { QUIET_THRESHOLD } from '@/lib/audio/level';
import type { EngineStatus } from '@/lib/engine/types';
import {
  generateSessionId,
  type Chunk,
  type SessionData,
  type Segment,
} from '@/lib/sessions/format';

/** Soniox is billed at roughly $0.12 per hour of audio. */
const COST_PER_SECOND = 0.12 / 3600;

/** A turn waiting this long for its translation is never getting one. */
const STALE_PENDING_MS = 10000;
/** More than this many unmatched turns means pairing has drifted; flush oldest. */
const MAX_PENDING = 3;

export type Turn = {
  id: number;
  speaker: string | null;
  /** stable index into the 4-colour speaker rail palette */
  speakerIndex: number;
  language: string | null;
  src: string;
  dst: string;
  /** still waiting for its translation */
  pending: boolean;
  createdAt: number;
  /** offset from session start, "MM:SS" */
  ts: string;
};

export type Provisional = {
  text: string;
  speaker: string | null;
  speakerIndex: number;
  language: string | null;
};

type LiveState = {
  running: boolean;
  status: EngineStatus;
  error: string | null;
  reconnectAttempt: number;
  reconnectMax: number;

  turns: Turn[];
  provisional: Provisional | null;

  /** 0..1 mic loudness for the meter */
  level: number;
  /** session-clock second of the last buffer loud enough to count as speech */
  lastLoudAtSec: number;
  /** session-clock second of the last screen tap or orientation change */
  lastInteractionSec: number;

  /** when the CURRENT chunk started; null while stopped */
  startedAt: number | null;
  /** seconds banked by chunks that have already ended */
  accumulatedSec: number;
  elapsedSec: number;

  /** first-seen order of Soniox speaker ids — the index drives rail colour */
  speakerOrder: string[];
  speakerNames: Record<string, string>;
  turnCounts: Record<string, number>;

  // ── session record ──
  sessionId: string | null;
  sessionCreatedAt: string | null;
  sessionTitle: string;
  chunks: Chunk[];
  currentChunk: Chunk | null;
  /** first turn id belonging to the current chunk */
  chunkStartTurnId: number;
  /** bumped on every change; compared against the last persisted value */
  revision: number;

  // ── actions ──
  beginSession: () => void;
  beginChunk: () => void;
  endChunk: () => void;
  addOriginal: (text: string, speaker: string | null, language: string | null) => void;
  addTranslation: (text: string) => void;
  setProvisional: (text: string, speaker: string | null, language: string | null) => void;
  setStatus: (status: EngineStatus) => void;
  setError: (message: string | null, attempt?: number) => void;
  setLevel: (level: number) => void;
  /** Restart the table-mode chrome timer. */
  noteInteraction: () => void;
  setRunning: (running: boolean) => void;
  setTitle: (title: string) => void;
  tick: () => void;
  renameSpeaker: (id: string, name: string) => void;
  mergeSpeakers: (from: string, into: string) => void;
  reset: () => void;
  toSessionData: (engine: string, sourceLang: string, targetLang: string) => SessionData | null;
};

let nextTurnId = 1;

function elapsedStamp(startedAt: number | null): string {
  const sec = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const useLive = create<LiveState>()((set, get) => ({
  running: false,
  status: 'idle',
  error: null,
  reconnectAttempt: 0,
  reconnectMax: 3,

  turns: [],
  provisional: null,
  level: 0,
  lastLoudAtSec: 0,
  lastInteractionSec: 0,

  startedAt: null,
  accumulatedSec: 0,
  elapsedSec: 0,

  speakerOrder: [],
  speakerNames: {},
  turnCounts: {},

  sessionId: null,
  sessionCreatedAt: null,
  sessionTitle: '',
  chunks: [],
  currentChunk: null,
  chunkStartTurnId: 1,
  revision: 0,

  beginSession: () => {
    const now = new Date();
    set({
      sessionId: generateSessionId(now),
      sessionCreatedAt: now.toISOString(),
      sessionTitle: '',
      chunks: [],
      currentChunk: null,
      startedAt: null,
      accumulatedSec: 0,
      elapsedSec: 0,
      lastLoudAtSec: 0,
      lastInteractionSec: 0,
      chunkStartTurnId: nextTurnId,
      revision: 0,
    });
  },

  beginChunk: () => {
    if (!get().sessionId) get().beginSession();
    set({
      currentChunk: { started_at: new Date().toISOString(), ended_at: null, segments: [] },
      chunkStartTurnId: nextTurnId,
      startedAt: Date.now(),
      lastLoudAtSec: get().elapsedSec,
      lastInteractionSec: get().elapsedSec,
    });
  },

  endChunk: () => {
    const state = get();
    if (!state.currentChunk) return;
    const banked = state.startedAt
      ? state.accumulatedSec + Math.floor((Date.now() - state.startedAt) / 1000)
      : state.accumulatedSec;
    set({
      chunks: [
        ...state.chunks,
        {
          ...state.currentChunk,
          ended_at: new Date().toISOString(),
          segments: segmentsSince(state.turns, state.chunkStartTurnId),
        },
      ],
      currentChunk: null,
      startedAt: null,
      accumulatedSec: banked,
      elapsedSec: banked,
      revision: state.revision + 1,
    });
  },

  addOriginal: (text, speaker, language) => {
    const state = get();
    const now = Date.now();

    let speakerOrder = state.speakerOrder;
    let speakerIndex = 0;
    if (speaker) {
      const existing = speakerOrder.indexOf(speaker);
      if (existing === -1) {
        speakerOrder = [...speakerOrder, speaker];
        speakerIndex = speakerOrder.length - 1;
      } else {
        speakerIndex = existing;
      }
    }

    // Retire turns that will never be paired, oldest first, before adding.
    let turns = state.turns.map((t) =>
      t.pending && now - t.createdAt > STALE_PENDING_MS ? { ...t, pending: false } : t
    );
    const pendingIds = turns.filter((t) => t.pending).map((t) => t.id);
    if (pendingIds.length > MAX_PENDING) {
      const drop = new Set(pendingIds.slice(0, pendingIds.length - MAX_PENDING));
      turns = turns.map((t) => (drop.has(t.id) ? { ...t, pending: false } : t));
    }

    const turn: Turn = {
      id: nextTurnId++,
      speaker,
      speakerIndex,
      language,
      src: text,
      dst: '',
      pending: true,
      createdAt: now,
      ts: elapsedStamp(state.startedAt),
    };

    const turnCounts = speaker
      ? { ...state.turnCounts, [speaker]: (state.turnCounts[speaker] ?? 0) + 1 }
      : state.turnCounts;

    set({ turns: [...turns, turn], speakerOrder, turnCounts, revision: state.revision + 1 });
  },

  addTranslation: (text) => {
    const state = get();
    const index = state.turns.findIndex((t) => t.pending);

    if (index === -1) {
      // Translation with no source waiting — Soniox sometimes leads with it.
      const turn: Turn = {
        id: nextTurnId++,
        speaker: null,
        speakerIndex: 0,
        language: null,
        src: '',
        dst: text,
        pending: false,
        createdAt: Date.now(),
        ts: elapsedStamp(state.startedAt),
      };
      set({ turns: [...state.turns, turn], revision: state.revision + 1 });
      return;
    }

    const turns = [...state.turns];
    turns[index] = { ...turns[index], dst: text, pending: false };
    set({ turns, revision: state.revision + 1 });
  },

  setProvisional: (text, speaker, language) => {
    if (!text) {
      if (get().provisional !== null) set({ provisional: null });
      return;
    }
    const order = get().speakerOrder;
    const speakerIndex = speaker ? Math.max(0, order.indexOf(speaker)) : 0;
    set({ provisional: { text, speaker, speakerIndex, language } });
  },

  setStatus: (status) => {
    // A successful (re)connection clears the degraded banner.
    if (status === 'connected') set({ status, error: null, reconnectAttempt: 0 });
    else set({ status });
  },

  setError: (message, attempt) =>
    set({ error: message, ...(attempt !== undefined ? { reconnectAttempt: attempt } : {}) }),

  setLevel: (level) => {
    // Throttled to whole seconds: setLevel runs on every hardware buffer, and
    // bumping a field the screen subscribes to that often would re-render the
    // transcript ~15×/s.
    const state = get();
    const nowSec = state.startedAt
      ? state.accumulatedSec + Math.floor((Date.now() - state.startedAt) / 1000)
      : state.accumulatedSec;
    if (level >= QUIET_THRESHOLD && nowSec !== state.lastLoudAtSec) {
      set({ level, lastLoudAtSec: nowSec });
    } else {
      set({ level });
    }
  },

  noteInteraction: () => set({ lastInteractionSec: get().elapsedSec }),

  setRunning: (running) => set({ running }),

  setTitle: (title) =>
    set({ sessionTitle: title.slice(0, 200), revision: get().revision + 1 }),

  tick: () => {
    const { startedAt, accumulatedSec, running } = get();
    if (!running || !startedAt) return;
    set({ elapsedSec: accumulatedSec + Math.floor((Date.now() - startedAt) / 1000) });
  },

  renameSpeaker: (id, name) => {
    // Retroactive by construction: the name is resolved at render time from
    // this map, so every past turn picks it up at once.
    set({ speakerNames: { ...get().speakerNames, [id]: name.trim() } });
  },

  mergeSpeakers: (from, into) => {
    const state = get();
    const turns = state.turns.map((t) =>
      t.speaker === from
        ? { ...t, speaker: into, speakerIndex: Math.max(0, state.speakerOrder.indexOf(into)) }
        : t
    );
    const turnCounts = { ...state.turnCounts };
    turnCounts[into] = (turnCounts[into] ?? 0) + (turnCounts[from] ?? 0);
    delete turnCounts[from];
    const speakerNames = { ...state.speakerNames };
    delete speakerNames[from];

    set({
      turns,
      turnCounts,
      speakerNames,
      speakerOrder: state.speakerOrder.filter((s) => s !== from),
      revision: state.revision + 1,
    });
  },

  reset: () =>
    set({
      running: false,
      status: 'idle',
      error: null,
      reconnectAttempt: 0,
      turns: [],
      provisional: null,
      level: 0,
      lastLoudAtSec: 0,
      lastInteractionSec: 0,
      startedAt: null,
      accumulatedSec: 0,
      elapsedSec: 0,
      speakerOrder: [],
      speakerNames: {},
      turnCounts: {},
      sessionId: null,
      sessionCreatedAt: null,
      sessionTitle: '',
      chunks: [],
      currentChunk: null,
      chunkStartTurnId: nextTurnId,
      revision: 0,
    }),

  toSessionData: (engine, sourceLang, targetLang) => {
    const state = get();
    if (!state.sessionId || !state.sessionCreatedAt) return null;

    const chunks = state.currentChunk
      ? [
          ...state.chunks,
          {
            ...state.currentChunk,
            ended_at: new Date().toISOString(),
            segments: segmentsSince(state.turns, state.chunkStartTurnId),
          },
        ]
      : state.chunks;

    return {
      id: state.sessionId,
      created_at: state.sessionCreatedAt,
      ended_at: state.running ? null : new Date().toISOString(),
      title: state.sessionTitle,
      engine,
      source_lang: sourceLang,
      target_lang: targetLang,
      duration_sec: state.elapsedSec,
      chunks,
      speaker_names: rosterNames(state),
    };
  },
}));

/**
 * Segments for one chunk, derived from the turn list rather than accumulated as
 * translations arrive. Deriving is what guarantees the saved transcript matches
 * what was on screen: a turn that never received a translation still lands in
 * the file as a source-only line instead of being silently dropped.
 */
function segmentsSince(turns: Turn[], fromTurnId: number): Segment[] {
  return turns
    .filter((t) => t.id >= fromTurnId && (t.src || t.dst))
    .map((t) => ({ ts: t.ts, src: t.src, tgt: t.dst, speaker: t.speaker }));
}

/**
 * The full speaker roster as id → display name, including the auto-generated
 * "Speaker N" labels. Written into the session so the archive doesn't have to
 * re-derive names that the user may have already corrected.
 */
function rosterNames(state: LiveState): Record<string, string> {
  const names: Record<string, string> = {};
  state.speakerOrder.forEach((id, index) => {
    names[id] = state.speakerNames[id] || `Speaker ${index + 1}`;
  });
  return names;
}

/** Estimated spend so far, in USD. */
export function estimateCost(elapsedSec: number): number {
  return elapsedSec * COST_PER_SECOND;
}

/** Resolve a speaker's display name, honouring any retroactive rename. */
export function speakerDisplayName(
  id: string | null,
  names: Record<string, string>,
  order: string[]
): string | null {
  if (!id) return null;
  if (names[id]) return names[id];
  const index = order.indexOf(id);
  return `Speaker ${index >= 0 ? index + 1 : 1}`;
}
