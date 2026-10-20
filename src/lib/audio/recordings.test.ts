import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { appendRecordingPart, createRecording, deleteRecordings, finishRecording, listRecordings, readRecording, recordingExtension } from './recordings';

function clip(sessionId: string) {
  return { id: crypto.randomUUID(), sessionId, mimeType: 'audio/webm;codecs=opus', createdAt: new Date().toISOString(), durationMs: 0, bytes: 0, complete: false };
}

describe('device recordings', () => {
  it('saves ordered chunks and includes the final short tail without overwriting earlier audio', async () => {
    const first = clip('ordered');
    await createRecording(first);
    await appendRecordingPart(first.id, 0, new Blob(['first']), 1000);
    await appendRecordingPart(first.id, 1, new Blob(['tail']), 1220);
    await finishRecording(first.id, 1234);
    const [stored] = await listRecordings('ordered');
    expect(stored).toMatchObject({ bytes: 9, durationMs: 1234, complete: true });
    expect(await (await readRecording(stored)).text()).toBe('firsttail');
  });

  it('retains recoverable audio when recording ends before finalisation', async () => {
    const first = clip('interrupted');
    await createRecording(first);
    await appendRecordingPart(first.id, 0, new Blob(['recoverable']), 1000);
    const [stored] = await listRecordings('interrupted');
    expect(stored.complete).toBe(false);
    expect(await (await readRecording(stored)).text()).toBe('recoverable');
  });

  it('deletes all clips and blobs of the discarded session while keeping other sessions', async () => {
    const first = clip('discarded');
    const resumed = clip('discarded');
    const other = clip('retained');
    for (const item of [first, resumed, other]) {
      await createRecording(item);
      await appendRecordingPart(item.id, 0, new Blob([item.id]), 500);
    }
    await deleteRecordings('discarded');
    expect(await listRecordings('discarded')).toEqual([]);
    expect((await readRecording(first)).size).toBe(0);
    expect((await readRecording(resumed)).size).toBe(0);
    expect(await (await readRecording(other)).text()).toBe(other.id);
    await expect(appendRecordingPart(first.id, 1, new Blob(['late event']), 600)).rejects.toThrow('deleted');
  });

  it('does not present an empty recording as playable audio', async () => {
    await createRecording(clip('empty'));
    expect(await listRecordings('empty')).toEqual([]);
  });

  it('uses a download extension matching the browser recording format', () => {
    expect(recordingExtension('audio/mp4;codecs=mp4a.40.2')).toBe('m4a');
    expect(recordingExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(recordingExtension('audio/ogg;codecs=opus')).toBe('ogg');
  });
});
