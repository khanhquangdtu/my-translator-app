/**
 * Soniox real-time STT + translation over a single WebSocket.
 *
 * Ported from the Expo app, which in turn ported it from my-translator
 * (desktop) `src/js/soniox.js`. That file needed no platform shims to move
 * across — it only ever used `WebSocket` and timers — so the behaviour here is
 * deliberately identical, including the two non-obvious mechanisms that keep a
 * long meeting from falling apart:
 *
 *  - **Seamless session reset** every 3 minutes. Soniox caps session length, so
 *    a new socket is opened and configured BEFORE the old one is closed
 *    (make-before-break). Audio keeps flowing into the old socket until the new
 *    one is live, so no words are dropped at the seam.
 *  - **Context carryover**. The last ~500 characters of translation are replayed
 *    into the new session's `context.text`, so the model doesn't lose the thread
 *    of the conversation across a reset.
 *
 * The one web-only change is where the key comes from. The mobile build shipped
 * a real Soniox key inside the bundle; a browser bundle is even easier to read,
 * so instead every socket is opened with a short-lived temporary key minted by
 * `/api/soniox/token`. That makes `doConnect` async — which the make-before-break
 * reset survives untouched, because the old socket is not retired until the new
 * one has actually opened, and the await happens well before that.
 */
import type { CustomContext, EngineConfig, EngineStatus, TranslationEngine } from './types';
import { fetchSonioxToken, SonioxTokenError } from './token';

const SONIOX_ENDPOINT = 'wss://stt-rt.soniox.com/transcribe-websocket';

const MAX_RECONNECT = 3;
const RECONNECT_DELAY_MS = 2000;
/** Soniox sessions are time-boxed; roll over well before the limit. */
const SESSION_DURATION_MS = 3 * 60 * 1000;
const CONTEXT_HISTORY_CHARS = 500;
/** the socket times out during long silences without this */
const KEEPALIVE_INTERVAL_MS = 15000;

type SonioxToken = {
  text: string;
  is_final?: boolean;
  speaker?: string;
  language?: string;
  confidence?: number;
  translation_status?: 'original' | 'translation' | 'none';
};

type SonioxMessage = {
  tokens?: SonioxToken[];
  error_code?: number;
  error_message?: string;
};

/** WebSocket has no typed slot for our own bookkeeping flag. */
type TaggedSocket = WebSocket & { _isOld?: boolean };

export class SonioxEngine implements TranslationEngine {
  readonly name = 'soniox';

  private ws: TaggedSocket | null = null;
  private config: EngineConfig | null = null;
  private reconnectAttempts = 0;
  private intentionalDisconnect = false;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private recentTranslations: string[] = [];
  /**
   * Bumped by every connect/disconnect. A token fetch that resolves after the
   * user has already stopped belongs to a dead generation and must not open a
   * socket — without this, tapping Stop during the fetch leaves one behind.
   */
  private generation = 0;

  isConnected = false;

  onStatusChange?: (status: EngineStatus) => void;
  onOriginal?: (text: string, speaker: string | null, language: string | null) => void;
  onTranslation?: (text: string) => void;
  onProvisional?: (text: string, speaker: string | null, language: string | null) => void;
  onConfidence?: (avgConfidence: number) => void;
  onError?: (message: string) => void;

  connect(config: EngineConfig) {
    this.config = config;
    this.intentionalDisconnect = false;
    this.reconnectAttempts = 0;
    this.recentTranslations = [];
    this.generation++;

    void this.doConnect(config);
  }

  private async doConnect(config: EngineConfig, carryoverContext: string | null = null) {
    const generation = this.generation;
    this.setStatus('connecting');

    let apiKey: string;
    try {
      apiKey = await fetchSonioxToken();
    } catch (err) {
      if (generation !== this.generation) return;
      this.fail(
        err instanceof SonioxTokenError
          ? err.message
          : `Could not reach the server for a session key: ${String(err)}`
      );
      return;
    }
    // Stop was pressed while the token was in flight.
    if (generation !== this.generation || this.intentionalDisconnect) return;

    let next: TaggedSocket;
    try {
      next = new WebSocket(SONIOX_ENDPOINT) as TaggedSocket;
    } catch (err) {
      this.setStatus('error');
      this.onError?.(`Could not create the WebSocket: ${String(err)}`);
      return;
    }
    next.binaryType = 'arraybuffer';

    next.onopen = () => {
      next.send(JSON.stringify(this.buildConfigMessage(apiKey, config, carryoverContext)));

      // Make-before-break: only now is it safe to retire the previous socket.
      const old = this.ws;
      if (old && old !== next) {
        old._isOld = true; // so its onclose doesn't trigger a reconnect
        try {
          if (old.readyState === WebSocket.OPEN) {
            old.send(new ArrayBuffer(0)); // Soniox's graceful end-of-stream marker
          }
        } catch {
          // some stacks refuse a zero-length binary frame; close() below still ends it
        }
        try {
          old.close(1000, 'Session reset');
        } catch {
          // already closing
        }
      }

      this.ws = next;
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.setStatus('connected');
      this.startSessionTimer();
      this.startKeepalive();
    };

    next.onmessage = (event: MessageEvent) => {
      if (next._isOld) return;
      try {
        const data: SonioxMessage = JSON.parse(String(event.data));
        if (data.error_code) {
          this.handleApiError(data);
          return;
        }
        this.handleResponse(data);
      } catch {
        // a malformed frame is not worth tearing the session down for
      }
    };

    next.onerror = () => {
      if (next._isOld) return;
      this.onError?.('WebSocket connection error.');
    };

    next.onclose = (event: CloseEvent) => {
      if (next._isOld) return; // expected during a seamless reset

      this.isConnected = false;
      if (this.ws === next) this.ws = null;

      if (this.intentionalDisconnect) {
        this.setStatus('disconnected');
        return;
      }

      const code = event.code ?? 0;
      if (code === 1000) {
        this.setStatus('disconnected');
      } else if (code === 1006) {
        this.tryReconnect('Connection lost');
      } else if (code === 4001 || code === 4003) {
        this.fail('The server rejected its Soniox key.');
      } else if (code === 4029) {
        this.fail('Rate limit exceeded. Wait a moment and try again.');
      } else if (code === 4002) {
        this.fail('Problem with the Soniox plan. Check your account.');
      } else {
        this.tryReconnect(`Connection closed (code ${code})`);
      }
    };
  }

  private buildConfigMessage(
    apiKey: string,
    config: EngineConfig,
    carryoverContext: string | null
  ) {
    const msg: Record<string, unknown> = {
      api_key: apiKey,
      model: 'stt-rt-v5',
      audio_format: 'pcm_s16le',
      sample_rate: 16000,
      num_channels: 1,
      enable_endpoint_detection: true,
      max_endpoint_delay_ms: config.endpointDelay || 3000,
      enable_speaker_diarization: true,
      enable_language_identification: true,
    };

    if (config.sourceLanguage && config.sourceLanguage !== 'auto') {
      msg.language_hints = [config.sourceLanguage];
    }
    if (config.languageHintsStrict) {
      msg.language_hints_strict = true;
    }

    if (config.translationType === 'two_way' && config.languageA && config.languageB) {
      msg.translation = {
        type: 'two_way',
        language_a: config.languageA,
        language_b: config.languageB,
      };
      // two-way needs both sides hinted, overriding any single source hint
      msg.language_hints = [config.languageA, config.languageB];
    } else if (config.targetLanguage) {
      msg.translation = { type: 'one_way', target_language: config.targetLanguage };
    }

    const context = this.buildContext(config.customContext ?? null, carryoverContext);
    if (context) msg.context = context;

    return msg;
  }

  sendAudio(pcm: ArrayBuffer) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcm);
    }
  }

  disconnect() {
    this.intentionalDisconnect = true;
    this.generation++;
    this.stopSessionTimer();
    this.stopKeepalive();

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(new ArrayBuffer(0));
        }
      } catch {
        // see note in doConnect
      }
      try {
        this.ws.close(1000, 'User disconnected');
      } catch {
        // already closing
      }
      this.ws = null;
    }
    this.isConnected = false;
    this.setStatus('disconnected');
  }

  // ─── Response handling ───────────────────────────────────────────────

  private handleResponse(data: SonioxMessage) {
    if (!data.tokens || data.tokens.length === 0) return;

    let originalText = '';
    let translationText = '';
    let provisionalText = '';
    let hasEnd = false;
    let speaker: string | null = null;
    let language: string | null = null;
    let confidenceSum = 0;
    let confidenceCount = 0;

    for (const token of data.tokens) {
      if (token.text === '<end>') {
        hasEnd = true;
        continue;
      }

      if (token.speaker && token.translation_status === 'original') {
        speaker = token.speaker;
      }
      if (token.language && token.translation_status !== 'translation') {
        language = token.language;
      }
      if (
        token.confidence !== undefined &&
        token.is_final &&
        token.translation_status === 'original'
      ) {
        confidenceSum += token.confidence;
        confidenceCount++;
      }

      if (token.translation_status === 'translation') {
        if (token.is_final) translationText += token.text;
      } else {
        // 'original', 'none' (third-language speech in two-way mode), or absent
        if (token.is_final) originalText += token.text;
        else provisionalText += token.text;
      }
    }

    if (confidenceCount > 0) {
      this.onConfidence?.(confidenceSum / confidenceCount);
    }
    if (originalText.trim()) {
      this.onOriginal?.(originalText, speaker, language);
    }
    if (translationText.trim()) {
      this.onTranslation?.(translationText);
      this.addToHistory(translationText);
    }

    if (provisionalText.trim()) {
      this.onProvisional?.(provisionalText, speaker, language);
    } else if (originalText.trim() || translationText.trim() || hasEnd) {
      // the in-flight line resolved into a final one — clear it
      this.onProvisional?.('', null, null);
    }
  }

  // ─── Session lifecycle ───────────────────────────────────────────────

  private startSessionTimer() {
    this.stopSessionTimer();
    this.sessionTimer = setTimeout(() => this.seamlessReset(), SESSION_DURATION_MS);
  }

  private stopSessionTimer() {
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
  }

  private seamlessReset() {
    if (!this.config || this.intentionalDisconnect) return;
    void this.doConnect(this.config, this.getCarryoverContext());
  }

  private startKeepalive() {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'keepalive' }));
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  // ─── Context ─────────────────────────────────────────────────────────

  private buildContext(custom: CustomContext | null, carryover: string | null) {
    const context: Record<string, unknown> = {};
    let hasContent = false;

    if (custom?.general?.length) {
      context.general = custom.general;
      hasContent = true;
    }
    if (custom?.terms?.length) {
      context.terms = custom.terms;
      hasContent = true;
    }
    if (custom?.translation_terms?.length) {
      context.translation_terms = custom.translation_terms;
      hasContent = true;
    }

    const textParts: string[] = [];
    if (custom?.text) textParts.push(custom.text);
    if (carryover) textParts.push(`Recent conversation: ${carryover}`);
    if (textParts.length) {
      context.text = textParts.join('\n\n');
      hasContent = true;
    }

    return hasContent ? context : null;
  }

  private addToHistory(text: string) {
    this.recentTranslations.push(text);
    let total = this.recentTranslations.reduce((sum, t) => sum + t.length, 0);
    while (total > CONTEXT_HISTORY_CHARS && this.recentTranslations.length > 1) {
      total -= this.recentTranslations.shift()!.length;
    }
  }

  private getCarryoverContext(): string | null {
    if (!this.recentTranslations.length) return null;
    return this.recentTranslations.join(' ').trim() || null;
  }

  // ─── Errors ──────────────────────────────────────────────────────────

  private handleApiError(data: SonioxMessage) {
    const code = data.error_code ?? 0;
    const message = data.error_message ?? 'Unknown API error';

    if (code === 408) {
      this.tryReconnect('Timed out');
      return;
    }

    let userMessage = message;
    if (code === 401) userMessage = 'The server rejected its Soniox key.';
    else if (code === 429) userMessage = 'Rate limit exceeded. Wait a moment.';
    else if (code === 402) userMessage = 'Out of credit. Check your Soniox account.';
    else if (code === 400) userMessage = `Configuration error: ${message}`;

    this.fail(userMessage);
  }

  private tryReconnect(reason: string) {
    if (this.reconnectAttempts >= MAX_RECONNECT) {
      this.fail(`${reason}. Reconnect failed after ${MAX_RECONNECT} attempts.`);
      return;
    }

    this.reconnectAttempts++;
    const delay = RECONNECT_DELAY_MS * this.reconnectAttempts;

    this.setStatus('connecting');
    this.onError?.(`${reason}. Reconnecting (${this.reconnectAttempts}/${MAX_RECONNECT})…`);

    setTimeout(() => {
      if (!this.intentionalDisconnect && this.config) {
        void this.doConnect(this.config, this.getCarryoverContext());
      }
    }, delay);
  }

  /** Reconnect progress, for the degraded-state banner. */
  get attempt() {
    return this.reconnectAttempts;
  }
  get maxAttempts() {
    return MAX_RECONNECT;
  }

  private fail(message: string) {
    this.setStatus('error');
    this.onError?.(message);
  }

  private setStatus(status: EngineStatus) {
    this.onStatusChange?.(status);
  }
}
