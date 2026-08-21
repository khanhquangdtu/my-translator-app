/**
 * The transcript must survive its own memory limit.
 *
 * `turns` is now a window rather than the whole session — old turns are banked
 * as segments and dropped so a long session stops growing. That trade is only
 * acceptable if the saved record is bit-for-bit what it would have been
 * without trimming, and the failure mode if it is not is the worst kind:
 * nothing throws, the screen looks right, and the file is missing its first
 * hour. So the properties asserted here are completeness and order, over a
 * stream long enough to trim many times.
 *
 * Everything is driven through the store's real actions — the same calls the
 * Soniox callbacks make — because the ordering hazards live in how those
 * interleave, not in the helper they share.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useLive } from './liveStore';

/** Comfortably past the 1000-turn window, so banking runs many times. */
const LONG = 2600;

function session() {
  useLive.getState().reset();
  useLive.getState().beginSession();
  useLive.getState().beginChunk();
}

function saved() {
  const data = useLive.getState().toSessionData('mock', 'en', 'vi');
  if (!data) throw new Error('no session data');
  return data.chunks.flatMap((chunk) => chunk.segments);
}

describe('memory window', () => {
  beforeEach(session);

  it('keeps every line of a session far longer than the window', () => {
    const live = useLive.getState();
    for (let i = 0; i < LONG; i++) {
      live.addOriginal(`source ${i}`, 'spk-1', 'en');
      live.addTranslation(`target ${i}`);
    }

    const segments = saved();
    expect(segments).toHaveLength(LONG);
    expect(segments.map((s) => s.src)).toEqual(
      Array.from({ length: LONG }, (_, i) => `source ${i}`)
    );
    expect(segments.map((s) => s.tgt)).toEqual(
      Array.from({ length: LONG }, (_, i) => `target ${i}`)
    );
  });

  it('actually drops turns rather than merely copying them', () => {
    const live = useLive.getState();
    for (let i = 0; i < LONG; i++) {
      live.addOriginal(`source ${i}`, null, 'en');
      live.addTranslation(`target ${i}`);
    }

    const state = useLive.getState();
    expect(state.turns.length).toBeLessThanOrEqual(1000);
    expect(state.droppedSegments).toBe(LONG - state.turns.length);
  });

  /*
   * Soniox sometimes emits a translation with no source waiting, which the
   * store appends as an already-settled turn while older ones are still
   * pending. Banking on settle rather than in prefix order would file that line
   * ahead of the ones it followed.
   */
  it('holds order when a translation arrives with no source waiting', () => {
    const live = useLive.getState();
    const expected: string[] = [];

    for (let i = 0; i < LONG; i++) {
      if (i % 50 === 7) {
        live.addTranslation(`orphan ${i}`);
        expected.push(`orphan ${i}`);
        continue;
      }
      live.addOriginal(`source ${i}`, 'spk-1', 'en');
      live.addTranslation(`target ${i}`);
      expected.push(`target ${i}`);
    }

    expect(saved().map((s) => s.tgt)).toEqual(expected);
  });

  it('keeps a source-only line when its translation never comes', () => {
    const live = useLive.getState();
    for (let i = 0; i < LONG; i++) {
      live.addOriginal(`source ${i}`, 'spk-1', 'en');
      // Every fifth turn is left unpaired; MAX_PENDING retires it shortly after.
      if (i % 5 !== 0) live.addTranslation(`target ${i}`);
    }

    const segments = saved();
    expect(segments).toHaveLength(LONG);
    expect(segments.map((s) => s.src)).toEqual(
      Array.from({ length: LONG }, (_, i) => `source ${i}`)
    );
    expect(segments.filter((s) => s.tgt === '').length).toBeGreaterThan(0);
  });

  it('splits across a pause without losing or duplicating a line', () => {
    const live = useLive.getState();
    for (let i = 0; i < 1400; i++) {
      live.addOriginal(`a ${i}`, 'spk-1', 'en');
      live.addTranslation(`ta ${i}`);
    }
    useLive.getState().endChunk();
    useLive.getState().beginChunk();
    for (let i = 0; i < 1400; i++) {
      live.addOriginal(`b ${i}`, 'spk-1', 'en');
      live.addTranslation(`tb ${i}`);
    }

    const data = useLive.getState().toSessionData('mock', 'en', 'vi');
    expect(data?.chunks).toHaveLength(2);
    expect(data?.chunks[0].segments.map((s) => s.src)).toEqual(
      Array.from({ length: 1400 }, (_, i) => `a ${i}`)
    );
    expect(data?.chunks[1].segments.map((s) => s.src)).toEqual(
      Array.from({ length: 1400 }, (_, i) => `b ${i}`)
    );
  });

  it('counts every dropped line across a pause, not just the open chunk', () => {
    const live = useLive.getState();
    for (let i = 0; i < 1400; i++) {
      live.addOriginal(`a ${i}`, null, 'en');
      live.addTranslation(`ta ${i}`);
    }
    useLive.getState().endChunk();
    useLive.getState().beginChunk();
    for (let i = 0; i < 1400; i++) {
      live.addOriginal(`b ${i}`, null, 'en');
      live.addTranslation(`tb ${i}`);
    }

    const state = useLive.getState();
    expect(state.droppedSegments).toBe(2800 - state.turns.length);
  });

  /*
   * A merge rewrites the speaker on every past line. Once a line has been
   * banked there is no turn left to rewrite, so the segment has to be reached
   * directly — otherwise the older half of a transcript keeps naming a speaker
   * the roster has dropped.
   */
  it('applies a speaker merge to lines that have left memory', () => {
    const live = useLive.getState();
    for (let i = 0; i < LONG; i++) {
      live.addOriginal(`source ${i}`, i % 2 === 0 ? 'spk-1' : 'spk-2', 'en');
      live.addTranslation(`target ${i}`);
    }

    useLive.getState().mergeSpeakers('spk-2', 'spk-1');

    const segments = saved();
    expect(segments).toHaveLength(LONG);
    expect(segments.some((s) => s.speaker === 'spk-2')).toBe(false);
    expect(segments.every((s) => s.speaker === 'spk-1')).toBe(true);
  });
});
