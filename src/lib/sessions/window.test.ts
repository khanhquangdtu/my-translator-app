/**
 * The seam between memory and the saved record.
 *
 * Every case here is a place the two sources meet: exactly at the boundary,
 * one either side of it, an empty session, and a window asking for more than
 * exists. A line lost or repeated at that seam is invisible in a short session
 * and maddening in a long one, which is the wrong order to find out.
 */
import { describe, expect, it } from 'vitest';

import { nextPage, splitWindow } from './window';

describe('splitWindow', () => {
  it('takes everything from memory while memory is enough', () => {
    expect(splitWindow(300, 1000, 0)).toEqual({
      fromMemory: 300,
      fromHistory: 0,
      remaining: 700,
    });
  });

  it('reaches into history only past the end of memory', () => {
    expect(splitWindow(1200, 1000, 5000)).toEqual({
      fromMemory: 1000,
      fromHistory: 200,
      remaining: 4800,
    });
  });

  it('takes nothing from history at exactly the boundary', () => {
    expect(splitWindow(1000, 1000, 5000)).toEqual({
      fromMemory: 1000,
      fromHistory: 0,
      remaining: 5000,
    });
  });

  it('takes one from history one line past it', () => {
    expect(splitWindow(1001, 1000, 5000)).toEqual({
      fromMemory: 1000,
      fromHistory: 1,
      remaining: 4999,
    });
  });

  it('stops at the start of the session rather than inventing lines', () => {
    expect(splitWindow(9999, 40, 10)).toEqual({
      fromMemory: 40,
      fromHistory: 10,
      remaining: 0,
    });
  });

  it('handles a session that has produced nothing', () => {
    expect(splitWindow(300, 0, 0)).toEqual({ fromMemory: 0, fromHistory: 0, remaining: 0 });
  });

  /** The sources always account for exactly the lines that exist. */
  it('never loses or repeats a line, at any window size', () => {
    const memoryCount = 1000;
    const droppedCount = 3000;
    for (let shown = 0; shown <= 4200; shown += 7) {
      const w = splitWindow(shown, memoryCount, droppedCount);
      expect(w.fromMemory + w.fromHistory + w.remaining).toBe(memoryCount + droppedCount);
      expect(w.fromMemory).toBeLessThanOrEqual(memoryCount);
      expect(w.fromHistory).toBeLessThanOrEqual(droppedCount);
      // History is only drawn on once memory is exhausted, never alongside it.
      if (w.fromHistory > 0) expect(w.fromMemory).toBe(memoryCount);
    }
  });
});

describe('nextPage', () => {
  it('asks for nothing from the record while memory still covers the page', () => {
    expect(nextPage(300, 100, 1000, 5000)).toEqual({
      want: 400,
      need: 0,
      start: 5000,
      end: 5000,
    });
  });

  it('reads the record for the part memory cannot cover', () => {
    expect(nextPage(950, 100, 1000, 5000)).toEqual({
      want: 1050,
      need: 50,
      start: 4950,
      end: 5000,
    });
  });

  it('stops at the first line of the session', () => {
    expect(nextPage(120, 100, 40, 100)).toEqual({ want: 140, need: 100, start: 0, end: 100 });
  });

  it('cannot ask beyond what the session holds', () => {
    const page = nextPage(1000, 500, 40, 100);
    expect(page.want).toBe(140);
    expect(page.start).toBe(0);
  });

  /*
   * Lines keep dropping out of memory while the reader is paging. The range is
   * re-derived from the current count each time, so it must still end where
   * memory now begins — not where it began when the last page was read.
   */
  it('re-anchors to the record as the live end keeps dropping lines', () => {
    const first = nextPage(1000, 100, 1000, 5000);
    expect(first).toEqual({ want: 1100, need: 100, start: 4900, end: 5000 });

    // 60 more lines have since left memory.
    const second = nextPage(1100, 100, 1000, 5060);
    expect(second.end).toBe(5060);
    expect(second.need).toBe(200);
    expect(second.start).toBe(4860);
    // The newly dropped lines fall inside the range, not through the gap.
    expect(second.end - second.start).toBe(second.need);
  });
});
