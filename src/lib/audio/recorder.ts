import { appendRecordingPart, createRecording, finishRecording } from './recordings';

export type RecordingState = 'off' | 'recording' | 'saving' | 'saved' | 'error';

/** Shares the translation's microphone; never asks for a second audio stream. */
export class ConversationRecorder {
  private recorder: MediaRecorder | null = null;
  private finished: Promise<void> = Promise.resolve();
  private failed = false;
  private generation = 0;

  constructor(private onState: (state: RecordingState, error?: string) => void) {}

  async start(stream: MediaStream, sessionId: string): Promise<void> {
    await this.stop();
    const generation = this.generation;
    this.failed = false;
    try {
      if (typeof MediaRecorder === 'undefined') throw new Error('Audio recording is not supported in this browser.');
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
      const id = crypto.randomUUID();
      await createRecording({
        id, sessionId, mimeType: recorder.mimeType, createdAt: new Date().toISOString(),
        durationMs: 0, bytes: 0, complete: false,
      });
      if (generation !== this.generation) return;
      let writes = Promise.resolve();
      let index = 0;
      const started = performance.now();
      this.recorder = recorder;
      this.finished = new Promise<void>((resolve) => {
        recorder.ondataavailable = (event) => {
          if (!event.data.size || this.failed) return;
          const part = index++;
          const duration = performance.now() - started;
          writes = writes.then(() => appendRecordingPart(id, part, event.data, duration)).catch((error) => {
            this.fail(error);
            if (recorder.state !== 'inactive') recorder.stop();
          });
        };
        recorder.onerror = () => this.fail(new Error('The browser could not continue recording.'));
        recorder.onstop = () => {
          const duration = performance.now() - started;
          void writes.then(async () => {
            if (!this.failed) {
              await finishRecording(id, duration);
              this.onState('saved');
            }
          }).catch((error) => this.fail(error)).finally(() => {
            if (this.recorder === recorder) this.recorder = null;
            resolve();
          });
        };
      });
      try {
        recorder.start(1000);
      } catch (error) {
        this.recorder = null;
        // No stop event is dispatched if start() itself failed.
        this.finished = Promise.resolve();
        throw error;
      }
      this.onState('recording');
    } catch (error) {
      this.fail(error);
    }
  }

  async stop(): Promise<void> {
    this.generation++;
    if (this.recorder && this.recorder.state !== 'inactive') {
      if (!this.failed) this.onState('saving');
      this.recorder.stop();
    }
    // stop follows the final dataavailable event and all its IndexedDB writes.
    await this.finished;
  }

  private fail(error: unknown) {
    this.failed = true;
    const full = (error as DOMException)?.name === 'QuotaExceededError';
    this.onState('error', full
      ? 'Device storage is full. Audio recording stopped; free some space before recording again.'
      : error instanceof Error ? error.message : 'Could not save the audio recording.');
  }
}
