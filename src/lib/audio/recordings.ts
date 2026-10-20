/** Audio stays on this device. Transcript sync never uploads these blobs. */
import { openDB, type DBSchema } from 'idb';

export type RecordingClip = {
  id: string;
  sessionId: string;
  mimeType: string;
  createdAt: string;
  durationMs: number;
  bytes: number;
  complete: boolean;
};

interface RecordingDB extends DBSchema {
  clips: { key: string; value: RecordingClip; indexes: { session: string } };
  parts: {
    key: [string, number];
    value: { clipId: string; index: number; blob: Blob };
    indexes: { clip: string };
  };
}

function openRecordings() {
  return openDB<RecordingDB>('mytranslator-audio', 1, {
    upgrade(db) {
      db.createObjectStore('clips', { keyPath: 'id' }).createIndex('session', 'sessionId');
      db.createObjectStore('parts', { keyPath: ['clipId', 'index'] }).createIndex('clip', 'clipId');
    },
  });
}

let database: ReturnType<typeof openRecordings> | null = null;
function db() {
  database ??= openRecordings().catch((error) => { database = null; throw error; });
  return database;
}

export async function createRecording(clip: RecordingClip): Promise<void> {
  await (await db()).put('clips', clip);
}

/** Each event is committed without loading or rewriting the previous audio. */
export async function appendRecordingPart(clipId: string, index: number, blob: Blob, durationMs: number) {
  const tx = (await db()).transaction(['clips', 'parts'], 'readwrite');
  const clip = await tx.objectStore('clips').get(clipId);
  if (!clip) throw new Error('This recording has been deleted.');
  await tx.objectStore('parts').put({ clipId, index, blob });
  await tx.objectStore('clips').put({ ...clip, bytes: clip.bytes + blob.size, durationMs });
  await tx.done;
}

export async function finishRecording(clipId: string, durationMs: number) {
  const tx = (await db()).transaction('clips', 'readwrite');
  const clip = await tx.store.get(clipId);
  if (clip) await tx.store.put({ ...clip, durationMs, complete: true });
  await tx.done;
}

export async function listRecordings(sessionId: string): Promise<RecordingClip[]> {
  const clips = await (await db()).getAllFromIndex('clips', 'session', sessionId);
  return clips.filter((clip) => clip.bytes > 0).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function readRecording(clip: RecordingClip): Promise<Blob> {
  const parts = await (await db()).getAllFromIndex('parts', 'clip', clip.id);
  parts.sort((a, b) => a.index - b.index);
  return new Blob(parts.map((part) => part.blob), { type: clip.mimeType });
}

export async function deleteRecordings(sessionId: string): Promise<void> {
  const tx = (await db()).transaction(['clips', 'parts'], 'readwrite');
  const clips = await tx.objectStore('clips').index('session').getAll(sessionId);
  for (const clip of clips) {
    const keys = await tx.objectStore('parts').index('clip').getAllKeys(clip.id);
    for (const key of keys) await tx.objectStore('parts').delete(key);
    await tx.objectStore('clips').delete(clip.id);
  }
  await tx.done;
}

export function recordingExtension(mimeType: string) {
  return mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
}
