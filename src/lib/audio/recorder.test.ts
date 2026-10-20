import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationRecorder } from './recorder';
import { appendRecordingPart, createRecording, finishRecording } from './recordings';

vi.mock('./recordings', () => ({
  createRecording: vi.fn().mockResolvedValue(undefined),
  appendRecordingPart: vi.fn().mockResolvedValue(undefined),
  finishRecording: vi.fn().mockResolvedValue(undefined),
}));

class TestRecorder {
  static instance: TestRecorder;
  static isTypeSupported = (mime: string) => mime === 'audio/mp4';
  state = 'inactive';
  mimeType: string;
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  constructor(_stream: MediaStream, options: MediaRecorderOptions) {
    this.mimeType = options.mimeType ?? 'audio/webm';
    TestRecorder.instance = this;
  }
  start() { this.state = 'recording'; }
  chunk(text: string) { this.ondataavailable?.({ data: new Blob([text]) }); }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => { this.chunk('final tail'); this.onstop?.(); });
  }
}

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('MediaRecorder', TestRecorder); });
afterEach(() => vi.unstubAllGlobals());

describe('ConversationRecorder', () => {
  it('awaits the final event and durable writes before reporting saved', async () => {
    let release!: () => void;
    vi.mocked(appendRecordingPart).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const state = vi.fn();
    const recorder = new ConversationRecorder(state);
    await recorder.start({} as MediaStream, 'session');
    expect(createRecording).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'audio/mp4' }));
    TestRecorder.instance.chunk('first');
    await Promise.resolve();
    const stopped = recorder.stop();
    await Promise.resolve();
    expect(state).not.toHaveBeenCalledWith('saved');
    expect(finishRecording).not.toHaveBeenCalled();
    release();
    await stopped;
    expect(appendRecordingPart).toHaveBeenCalledTimes(2);
    expect(finishRecording).toHaveBeenCalledOnce();
    expect(state).toHaveBeenLastCalledWith('saved');
    await recorder.stop();
    expect(finishRecording).toHaveBeenCalledOnce();
  });

  it('reports storage full and stops recording without claiming the clip was saved', async () => {
    vi.mocked(appendRecordingPart).mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'));
    const state = vi.fn();
    const recorder = new ConversationRecorder(state);
    await recorder.start({} as MediaStream, 'session');
    TestRecorder.instance.chunk('data');
    await vi.waitFor(() => expect(state).toHaveBeenCalledWith('error', expect.stringContaining('storage is full')));
    await recorder.stop();
    expect(TestRecorder.instance.state).toBe('inactive');
    expect(state).not.toHaveBeenCalledWith('saved');
    expect(finishRecording).not.toHaveBeenCalled();
  });

  it('reports an unsupported browser while allowing the caller to continue translation', async () => {
    vi.stubGlobal('MediaRecorder', undefined);
    const state = vi.fn();
    const recorder = new ConversationRecorder(state);
    await expect(recorder.start({} as MediaStream, 'session')).resolves.toBeUndefined();
    expect(state).toHaveBeenCalledWith('error', expect.stringContaining('not supported'));
    await recorder.stop();
  });

  it('does not start a late recorder after Stop was pressed during storage setup', async () => {
    let release!: () => void;
    vi.mocked(createRecording).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const state = vi.fn();
    const recorder = new ConversationRecorder(state);
    const starting = recorder.start({} as MediaStream, 'cancelled');
    await vi.waitFor(() => expect(createRecording).toHaveBeenCalled());
    await recorder.stop();
    release();
    await starting;
    expect(TestRecorder.instance.state).toBe('inactive');
    expect(state).not.toHaveBeenCalledWith('recording');
  });
});
