/**
 * The engine seam.
 *
 * The desktop app never declared this interface — `app.js` branched inline
 * across four `_start*Mode()` methods — but the four clients had converged on
 * the same callback shape anyway. Naming it here is what lets a second engine
 * (OpenAI Realtime, Qwen) drop in later without touching the UI.
 *
 * Every engine consumes the same audio contract: PCM s16le, 16 kHz, mono.
 */

export type EngineStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type TranslationType = 'one_way' | 'two_way';

/** Soniox `context` object — improves both transcription and translation. */
export type CustomContext = {
  /** free-form key/value pairs: domain, topic, participants… */
  general?: { key: string; value: string }[];
  /** domain-specific words the recogniser should expect */
  terms?: string[];
  /** forced translations, e.g. { source: 'Original sin', target: 'Erbsünde' } */
  translation_terms?: { source: string; target: string }[];
  /** longer unstructured background text */
  text?: string;
};

export type EngineConfig = {
  /**
   * Unused on web and deliberately absent from what the UI builds: the browser
   * has no provider key. SonioxEngine mints a short-lived one per socket from
   * `/api/soniox/token`. Kept in the type only so an engine that genuinely does
   * take a caller-supplied key still has a slot for it.
   */
  apiKey?: string;
  /** BCP-47-ish code, or 'auto' */
  sourceLanguage?: string;
  targetLanguage?: string;
  translationType?: TranslationType;
  /** two-way only */
  languageA?: string;
  languageB?: string;
  /** reject speech outside the hinted language instead of guessing */
  languageHintsStrict?: boolean;
  /** how long a pause must be before a turn is finalised, ms */
  endpointDelay?: number;
  customContext?: CustomContext | null;
};

export type EngineCallbacks = {
  onStatusChange?: (status: EngineStatus) => void;
  /** a finalised chunk of source-language speech */
  onOriginal?: (text: string, speaker: string | null, language: string | null) => void;
  /** a finalised chunk of translation — pairs with the oldest pending original */
  onTranslation?: (text: string) => void;
  /** in-flight recognition; replaces (never appends to) the previous value */
  onProvisional?: (text: string, speaker: string | null, language: string | null) => void;
  /**
   * In-flight *translation*, replacing (never appending to) the previous value.
   *
   * Separate from `onTranslation` on purpose. That one feeds the FIFO pairing
   * in `liveStore`, which matches each finalised translation to the oldest turn
   * still waiting for one; a provisional value must never enter that queue or
   * the pairing scrambles. This is a preview line and nothing else — it is
   * overwritten wholesale and cleared the moment the real translation lands.
   */
  onProvisionalTranslation?: (text: string) => void;
  onConfidence?: (avgConfidence: number) => void;
  onError?: (message: string) => void;
};

export interface TranslationEngine extends EngineCallbacks {
  readonly name: string;
  connect(config: EngineConfig): void;
  /** raw PCM s16le 16 kHz mono */
  sendAudio(pcm: ArrayBuffer): void;
  disconnect(): void;
  readonly isConnected: boolean;
}
