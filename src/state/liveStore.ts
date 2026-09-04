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

/**
 * How many turns stay in memory. Above this the oldest are banked as segments
 * and dropped, so a four-hour session costs the same as a four-minute one.
 *
 * Comfortably above the 900 ceiling of the Display setting's "lines kept", so
 * the window the screen may ask to render is always still here; "view more"
 * beyond it reads the autosaved record instead.
 */
const MEMORY_TURNS = 1000;

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

  /**
   * The live window, not the whole session. Older turns are banked into
   * `bankedSegments` and dropped — see `bankSettledPrefix`.
   */
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
  /** names suggested by AI but not yet confirmed */
  suggestedNames: Record<string, { name: string; confidence: string; evidence: string }>;
  /** speaker ids the user explicitly renamed — AI will never override these */
  manuallyNamed: Set<string>;

  // ── session record ──
  sessionId: string | null;
  sessionCreatedAt: string | null;
  sessionTitle: string;
  chunks: Chunk[];
  currentChunk: Chunk | null;
  /** first turn id belonging to the current chunk */
  chunkStartTurnId: number;
  /**
   * Segments of the current chunk whose turns have already left `turns`.
   * Prepended to whatever the live window still holds when the chunk is
   * written, so trimming memory never costs the transcript a line.
   */
  bankedSegments: Segment[];
  /**
   * How many of this session's segments are no longer in memory. The Live
   * screen uses it both to know that a "view more" exists and to page the
   * saved record backwards from the right place.
   */
  droppedSegments: number;
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
  suggestSpeakerName: (
    id: string,
    name: string,
    confidence: string,
    evidence: string
  ) => void;
  acceptSuggestion: (id: string) => void;
  dismissSuggestion: (id: string) => void;
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
  suggestedNames: {},
  manuallyNamed: new Set(),

  sessionId: null,
  sessionCreatedAt: null,
  sessionTitle: '',
  chunks: [],
  currentChunk: null,
  chunkStartTurnId: 1,
  bankedSegments: [],
  droppedSegments: 0,
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
      bankedSegments: [],
      droppedSegments: 0,
      revision: 0,
    });
  },

  beginChunk: () => {
    if (!get().sessionId) get().beginSession();
    set({
      currentChunk: { started_at: new Date().toISOString(), ended_at: null, segments: [] },
      chunkStartTurnId: nextTurnId,
      // Banked segments belong to one chunk; `droppedSegments` spans the
      // session and deliberately survives here.
      bankedSegments: [],
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
          segments: [
            ...state.bankedSegments,
            ...segmentsSince(state.turns, state.chunkStartTurnId),
          ],
        },
      ],
      bankedSegments: [],
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

    set({
      ...bankSettledPrefix(
        [...turns, turn],
        state.bankedSegments,
        state.droppedSegments,
        state.chunkStartTurnId
      ),
      speakerOrder,
      turnCounts,
      revision: state.revision + 1,
    });
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
      set({
        ...bankSettledPrefix(
          [...state.turns, turn],
          state.bankedSegments,
          state.droppedSegments,
          state.chunkStartTurnId
        ),
        revision: state.revision + 1,
      });
      return;
    }

    const turns = [...state.turns];
    turns[index] = { ...turns[index], dst: text, pending: false };
    // Settling can unblock a prefix that banking had to stop at, so try again
    // here rather than waiting for the next source turn to arrive.
    set({
      ...bankSettledPrefix(
        turns,
        state.bankedSegments,
        state.droppedSegments,
        state.chunkStartTurnId
      ),
      revision: state.revision + 1,
    });
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
    const manuallyNamed = new Set(get().manuallyNamed);
    manuallyNamed.add(id);
    const suggestedNames = { ...get().suggestedNames };
    delete suggestedNames[id];
    set({
      speakerNames: { ...get().speakerNames, [id]: name.trim() },
      manuallyNamed,
      suggestedNames,
    });
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

    /*
     * Segments already written carry their own copy of the speaker id, so a
     * merge has to reach them too — otherwise the half of the transcript that
     * has left memory keeps pointing at a speaker the roster no longer has.
     * Chunks closed by an earlier pause were always in that position; banking
     * simply makes it reachable sooner.
     */
    const remap = (segments: Segment[]) =>
      segments.some((seg) => seg.speaker === from)
        ? segments.map((seg) => (seg.speaker === from ? { ...seg, speaker: into } : seg))
        : segments;

    set({
      turns,
      turnCounts,
      speakerNames,
      speakerOrder: state.speakerOrder.filter((s) => s !== from),
      bankedSegments: remap(state.bankedSegments),
      chunks: state.chunks.map((chunk) => {
        const segments = remap(chunk.segments);
        return segments === chunk.segments ? chunk : { ...chunk, segments };
      }),
      revision: state.revision + 1,
    });
  },

  suggestSpeakerName: (id, name, confidence, evidence) => {
    if (get().manuallyNamed.has(id)) return;
    if (confidence === 'high') {
      // Auto-apply high-confidence names (direct self-introductions)
      set({
        speakerNames: { ...get().speakerNames, [id]: name },
        // Remove from suggestions if it was there
        suggestedNames: (() => {
          const s = { ...get().suggestedNames };
          delete s[id];
          return s;
        })(),
      });
    } else if (confidence === 'medium') {
      set({
        suggestedNames: {
          ...get().suggestedNames,
          [id]: { name, confidence, evidence },
        },
      });
    }
    // 'low' is silently discarded
  },

  acceptSuggestion: (id) => {
    const suggestion = get().suggestedNames[id];
    if (!suggestion) return;
    const suggestedNames = { ...get().suggestedNames };
    delete suggestedNames[id];
    set({
      speakerNames: { ...get().speakerNames, [id]: suggestion.name },
      suggestedNames,
    });
  },

  dismissSuggestion: (id) => {
    const suggestedNames = { ...get().suggestedNames };
    delete suggestedNames[id];
    const manuallyNamed = new Set(get().manuallyNamed);
    manuallyNamed.add(id);
    set({ suggestedNames, manuallyNamed });
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
      suggestedNames: {},
      manuallyNamed: new Set(),
      sessionId: null,
      sessionCreatedAt: null,
      sessionTitle: '',
      chunks: [],
      currentChunk: null,
      chunkStartTurnId: nextTurnId,
      bankedSegments: [],
      droppedSegments: 0,
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
            segments: [
              ...state.bankedSegments,
              ...segmentsSince(state.turns, state.chunkStartTurnId),
            ],
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
    .map(toSegment);
}

function toSegment(turn: Turn): Segment {
  return { ts: turn.ts, src: turn.src, tgt: turn.dst, speaker: turn.speaker };
}

/**
 * Moves the oldest turns out of memory once the window overflows, converting
 * them to segments on the way.
 *
 * Only a **settled prefix** is taken, and only from the front. Order is the
 * whole point: a translation that arrives without a source is appended as an
 * already-settled turn while an older one is still pending, so banking turns as
 * they settle would file them out of sequence. Stopping at the first pending
 * turn also cannot stall — `STALE_PENDING_MS` settles it within ten seconds
 * either way, and the next call picks up where this one stopped.
 *
 * Turns older than `chunkStartTurnId` belong to a chunk that has already been
 * written, so they are dropped rather than banked; that is the same rule
 * `segmentsSince` applies.
 */
function bankSettledPrefix(
  turns: Turn[],
  banked: Segment[],
  droppedSegments: number,
  chunkStartTurnId: number
): { turns: Turn[]; bankedSegments: Segment[]; droppedSegments: number } {
  const excess = turns.length - MEMORY_TURNS;
  if (excess <= 0) return { turns, bankedSegments: banked, droppedSegments };

  let cut = 0;
  let dropped = 0;
  const moved: Segment[] = [];
  while (cut < excess && !turns[cut].pending) {
    const turn = turns[cut];
    if (turn.src || turn.dst) {
      // Counted for every chunk, banked only for the open one: the count is
      // what tells the screen how far back the saved record goes, and a turn
      // from an already-written chunk has left memory just the same.
      dropped++;
      if (turn.id >= chunkStartTurnId) moved.push(toSegment(turn));
    }
    cut++;
  }
  if (cut === 0) return { turns, bankedSegments: banked, droppedSegments };

  return {
    turns: turns.slice(cut),
    bankedSegments: moved.length ? [...banked, ...moved] : banked,
    droppedSegments: droppedSegments + dropped,
  };
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
