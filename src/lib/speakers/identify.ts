/**
 * Client-side orchestrator for automatic speaker name identification.
 *
 * Subscribes to the live store and watches for new turns from unnamed speakers.
 * When turns accumulate, it debounces and sends a batch to the server endpoint
 * for LLM-based name extraction, then applies the results back to the store.
 *
 * This is module-level state (not in Zustand) because it is async side-effect
 * logic — Zustand actions should remain synchronous.
 */
import { useLive } from '@/state/liveStore';

/** Debounce delay after the last unnamed-speaker turn before firing a request. */
const DEBOUNCE_MS = 5000;

/** Maximum turns to include in each extraction request. */
const CONTEXT_WINDOW = 20;

/** Minimum turns before the first extraction attempt. */
const MIN_TURNS_TO_TRY = 2;

type State = {
  /** Turn id of the last turn we included in an extraction request. */
  analyzedUpTo: number;
  /** Debounce timer handle. */
  debounceTimer: ReturnType<typeof setTimeout> | null;
  /** Zustand unsubscribe function. */
  unsubscribe: (() => void) | null;
  /** Whether an extraction request is currently in flight. */
  inflight: boolean;
  /** Whether the orchestrator is active. */
  active: boolean;
  /** Last observed turn count — used to detect new turns. */
  lastTurnCount: number;
};

const state: State = {
  analyzedUpTo: 0,
  debounceTimer: null,
  unsubscribe: null,
  inflight: false,
  active: false,
  lastTurnCount: 0,
};

function hasUnnamedSpeakers(): boolean {
  const { speakerOrder, speakerNames, manuallyNamed } = useLive.getState();
  return speakerOrder.some((id) => !speakerNames[id] && !manuallyNamed.has(id));
}

function clearDebounce() {
  if (state.debounceTimer !== null) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
}

async function fireExtraction() {
  if (state.inflight || !state.active) return;

  const { turns, speakerOrder, speakerNames, manuallyNamed } = useLive.getState();
  if (turns.length < MIN_TURNS_TO_TRY) return;

  const unknownSpeakers = speakerOrder.filter(
    (id) => !speakerNames[id] && !manuallyNamed.has(id)
  );
  if (unknownSpeakers.length === 0) return;

  // Build the context window: last N turns
  const window = turns.slice(-CONTEXT_WINDOW);
  const turnPayload = window
    .filter((t) => t.src.trim())
    .map((t) => ({
      speaker: t.speaker ?? 'unknown',
      text: t.src,
      language: t.language,
    }));

  if (turnPayload.length === 0) return;

  // Build known names for context
  const knownNames: Record<string, string> = {};
  for (const id of speakerOrder) {
    if (speakerNames[id]) knownNames[id] = speakerNames[id];
  }

  state.inflight = true;
  const lastTurnId = turns[turns.length - 1].id;

  try {
    const response = await fetch('/api/identify-speakers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        turns: turnPayload,
        knownNames,
        unknownSpeakers,
      }),
    });

    if (!response.ok) {
      console.warn('[identify] extraction failed:', response.status);
      return;
    }

    const result = (await response.json()) as {
      names?: Record<string, { name: string; confidence: string; evidence: string }>;
    };

    if (!state.active) return; // stopped while request was in flight

    const names = result.names;
    if (!names || typeof names !== 'object') return;

    // Check for name conflicts: same name assigned to multiple speakers
    const nameValues = Object.values(names).map((v) => v.name.toLowerCase());
    const duplicates = new Set(
      nameValues.filter((n, i) => nameValues.indexOf(n) !== i)
    );

    const store = useLive.getState();
    for (const [id, match] of Object.entries(names)) {
      if (store.manuallyNamed.has(id)) continue;
      if (store.speakerNames[id]) continue;
      if (duplicates.has(match.name.toLowerCase())) continue;
      store.suggestSpeakerName(id, match.name, match.confidence, match.evidence);
    }

    state.analyzedUpTo = lastTurnId;
  } catch (err) {
    console.warn('[identify] extraction error:', err);
  } finally {
    state.inflight = false;
  }
}

function onStoreChange() {
  if (!state.active) return;
  if (!hasUnnamedSpeakers()) {
    clearDebounce();
    return;
  }

  const { turns } = useLive.getState();
  if (turns.length === 0) return;

  const lastId = turns[turns.length - 1].id;
  if (lastId <= state.analyzedUpTo) return;

  // Debounce: restart timer on each new turn
  clearDebounce();
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    void fireExtraction();
  }, DEBOUNCE_MS);
}

export function startIdentification() {
  if (state.active) return;
  state.active = true;
  state.analyzedUpTo = 0;
  state.inflight = false;
  state.lastTurnCount = useLive.getState().turns.length;

  state.unsubscribe = useLive.subscribe((s) => {
    // Only react to new turns or speaker roster changes
    const turnCount = s.turns.length;
    if (turnCount === state.lastTurnCount) return;
    state.lastTurnCount = turnCount;
    onStoreChange();
  });
}

export function stopIdentification() {
  state.active = false;
  clearDebounce();
  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }
}
