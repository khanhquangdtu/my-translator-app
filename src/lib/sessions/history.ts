/**
 * Reading back the part of a live session that has left memory.
 *
 * Autosave has already written the whole transcript to IndexedDB every fifteen
 * seconds — before the outbox pushes anything to the server — so the lines
 * behind the live window are on the device, not across a network. Reading them
 * locally is instant, survives a tunnel or a dead cell, and needs no endpoint:
 * the server copy is by definition the more stale of the two while a session is
 * still running.
 *
 * The range is expressed in segment offsets from the start of the session,
 * which is what `liveStore.droppedSegments` counts. Chunks are flattened
 * because a pause is not a boundary the reader cares about — it is one
 * conversation, and "the hundred lines before this one" may well straddle it.
 */
'use client';

import type { Segment } from './format';
import { readSession } from './store';

/**
 * Segments `[start, end)` of a session.
 *
 * The window slides rather than truncating when the record is shorter than the
 * range asked for. Callers ask in offsets from the start of the session, taken
 * from a counter that advances the moment a line leaves memory — while the
 * record only advances when autosave runs. Clamping just the far end would then
 * return an empty slice the one time the reader actually needed something, and
 * an empty slice is indistinguishable from "there is nothing older": the button
 * stays, pressing it does nothing, and no error is raised anywhere.
 *
 * Sliding keeps the requested width and gives back the newest lines the record
 * does hold. Callers that need the range to be exact should flush the record
 * first — `useSession().persist()`.
 */
export async function readSegmentRange(
  id: string,
  start: number,
  end: number
): Promise<Segment[]> {
  const width = end - start;
  if (width <= 0 || end <= 0) return [];

  const data = await readSession(id);
  if (!data) return [];

  const all = data.chunks.flatMap((chunk) => chunk.segments);
  const to = Math.min(end, all.length);
  return all.slice(Math.max(0, to - width), to);
}
