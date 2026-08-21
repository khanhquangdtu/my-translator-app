/**
 * How many lines the Live transcript shows, and where each of them comes from.
 *
 * Two sources sit end to end: the saved record holds everything the memory
 * window has dropped, `turns` holds the rest, and the reader is shown the
 * newest N of the two combined. The arithmetic is small but easy to get wrong
 * by one — an off-by-one here either repeats a line at the seam or hides one —
 * and it is the kind of mistake that only shows up in a session long enough
 * that nobody is watching closely. Hence its own module, and its own test.
 *
 * Counts, not indices: `memoryCount` is how many turns are in memory,
 * `droppedCount` how many segments preceded them. Both come straight from
 * `liveStore`.
 */

/** The split of a requested line count across the two sources. */
export type Window = {
  /** newest turns to take from memory */
  fromMemory: number;
  /** lines to take from the saved record, immediately older than those */
  fromHistory: number;
  /** lines older still, which a further press would reach */
  remaining: number;
};

export function splitWindow(shown: number, memoryCount: number, droppedCount: number): Window {
  const total = memoryCount + droppedCount;
  // Asking for more than exists is normal: the window is requested before
  // anyone knows how long the session turned out to be.
  const capped = Math.max(0, Math.min(shown, total));
  const fromMemory = Math.min(capped, memoryCount);
  return { fromMemory, fromHistory: capped - fromMemory, remaining: total - capped };
}

/** What the next press of "view more" needs. */
export type NextPage = {
  /** the new line count to show */
  want: number;
  /** how many of them must come from the saved record */
  need: number;
  /** segment offsets to read, `[start, end)` */
  start: number;
  end: number;
};

/**
 * The range is always re-derived from the current `droppedCount` rather than
 * extended from whatever was loaded last. A live session keeps dropping lines
 * while the reader is looking at old ones, so a range anchored to an older
 * count would leave a hole between what was fetched and what memory still has.
 */
export function nextPage(
  shown: number,
  pageSize: number,
  memoryCount: number,
  droppedCount: number
): NextPage {
  const total = memoryCount + droppedCount;
  const want = Math.min(shown + pageSize, total);
  const need = Math.max(0, want - memoryCount);
  return { want, need, start: Math.max(0, droppedCount - need), end: droppedCount };
}
