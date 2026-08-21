/**
 * A fake engine that replays the mockup's sample meeting.
 *
 * Enabled with `NEXT_PUBLIC_MOCK_ENGINE=1`. Every screen — the turn stream,
 * speaker rails, provisional dimming, the degraded banners — can then be walked
 * through and compared against `mockup_2.html` without a Soniox key and without
 * spending session credit. The desktop build had the same idea in
 * `src/js/tauri-mock.js`.
 */
import type { EngineConfig, EngineStatus, TranslationEngine } from './types';

type Script = { speaker: string; src: string; dst: string };

const SCRIPT: Script[] = [
  { speaker: 'spk-3', src: 'ご参加ありがとうございます。', dst: 'Thanks everyone for joining.' },
  {
    speaker: 'spk-1',
    src: '売上のレポートから始めます。',
    dst: "Let's start with the Q3 sales report.",
  },
  {
    speaker: 'spk-2',
    src: '前年同期比で十二パーセント増加しました。',
    dst: 'Revenue is up twelve percent year over year.',
  },
  {
    speaker: 'spk-1',
    src: '増加の大部分は東南アジア、特にベトナムとインドネシアです。',
    dst: 'Most of that came from Southeast Asia — Vietnam and Indonesia especially.',
  },
  {
    speaker: 'spk-2',
    src: '今は第四四半期の予算計画に移ります。',
    dst: "Now I'll move on to the Q4 budget plan…",
  },
];

const TURN_INTERVAL_MS = 4200;
const PROVISIONAL_STEP_MS = 320;

export class MockEngine implements TranslationEngine {
  readonly name = 'mock';
  isConnected = false;

  onStatusChange?: (status: EngineStatus) => void;
  onOriginal?: (text: string, speaker: string | null, language: string | null) => void;
  onTranslation?: (text: string) => void;
  onProvisional?: (text: string, speaker: string | null, language: string | null) => void;
  onConfidence?: (avgConfidence: number) => void;
  onError?: (message: string) => void;

  private timers: ReturnType<typeof setTimeout>[] = [];
  private index = 0;

  connect(_config: EngineConfig) {
    this.onStatusChange?.('connecting');
    this.timers.push(
      setTimeout(() => {
        this.isConnected = true;
        this.onStatusChange?.('connected');
        this.scheduleTurn();
      }, 700)
    );
  }

  private scheduleTurn() {
    const line = SCRIPT[this.index % SCRIPT.length];
    this.index++;

    // Type the source out word by word so the provisional dimming is visible.
    const words = line.src.split('');
    let shown = '';
    words.forEach((ch, i) => {
      this.timers.push(
        setTimeout(
          () => {
            shown += ch;
            this.onProvisional?.(shown, line.speaker, 'ja');
          },
          PROVISIONAL_STEP_MS + i * 40
        )
      );
    });

    const finaliseAt = PROVISIONAL_STEP_MS + words.length * 40 + 300;
    this.timers.push(
      setTimeout(() => {
        this.onProvisional?.('', null, null);
        this.onOriginal?.(line.src, line.speaker, 'ja');
        this.onConfidence?.(0.93);
      }, finaliseAt)
    );
    this.timers.push(setTimeout(() => this.onTranslation?.(line.dst), finaliseAt + 500));

    this.timers.push(setTimeout(() => this.scheduleTurn(), TURN_INTERVAL_MS));
  }

  sendAudio(_pcm: ArrayBuffer) {
    // the script drives itself; captured audio is discarded
  }

  disconnect() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.index = 0;
    this.isConnected = false;
    this.onStatusChange?.('disconnected');
  }
}

// Trimmed on purpose: env values pick up stray whitespace depending on how they
// were set (shell export, .env line ending, CI), and a strict === would then
// silently disable the mock while looking correct.
export const MOCK_ENABLED = process.env.NEXT_PUBLIC_MOCK_ENGINE?.trim() === '1';
