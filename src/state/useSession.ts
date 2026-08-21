/**
 * Session controller — the wiring the desktop kept inside `app.js`'s
 * `start()` / `pause()` / `stopSession()`, minus the DOM.
 *
 * It owns the engine instance, drives microphone capture into it, mirrors the
 * engine's callbacks into `liveStore`, and keeps the transcript on disk. Nothing
 * in the UI talks to the engine directly.
 *
 * Ported from the Expo app with only its platform seams swapped — microphone,
 * keep-awake, persistence. The lifecycle itself is untouched, including the
 * three things that are easy to "fix" wrongly: the revision-based dirty check,
 * the refusal to write a session that has captured nothing, and `discardSession`
 * genuinely deleting what autosave already wrote.
 */
'use client';

import { useCallback, useEffect, useRef } from 'react';

import { useMicCapture } from '@/lib/audio/capture';
import { hasSonioxKey } from '@/lib/config/capabilities';
import { MOCK_ENABLED, MockEngine } from '@/lib/engine/mock';
import { SonioxEngine } from '@/lib/engine/soniox';
import type { TranslationEngine } from '@/lib/engine/types';
import { activateKeepAwake, deactivateKeepAwake } from '@/lib/platform';
import { deleteSession, saveSession } from '@/lib/sessions/store';
import { useLive } from '@/state/liveStore';
import { resolveLanguage, useSettings } from '@/state/settingsStore';

/** A crash should cost at most this much of the live chunk. */
const AUTOSAVE_MS = 15000;

export type StartResult = 'ok' | 'not-configured' | 'permission-denied' | 'start-failed';

export function useSession() {
  const engineRef = useRef<TranslationEngine | null>(null);
  const autosaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSavedRevision = useRef(-1);

  const mic = useMicCapture({
    onPcm: (pcm) => engineRef.current?.sendAudio(pcm),
    onLevel: (level) => useLive.getState().setLevel(level),
  });

  const persist = useCallback(async (force = false) => {
    const live = useLive.getState();
    const { prefs } = useSettings.getState();
    if (!live.sessionId) return;
    if (!force && live.revision === lastSavedRevision.current) return;

    const data = live.toSessionData(
      MOCK_ENABLED ? 'mock' : 'soniox',
      prefs.sourceLanguage,
      resolveLanguage(prefs.targetLanguage)
    );
    if (!data) return;

    // Nothing captured yet — don't create a record. Otherwise a session that is
    // killed before its first turn (tab closed, crash, OS reclaim) leaves an
    // empty entry in the Library that the Stop flow never gets to clean up.
    if (data.chunks.every((chunk) => chunk.segments.length === 0)) return;

    lastSavedRevision.current = live.revision;
    try {
      await saveSession(data);
    } catch (err) {
      // Losing an autosave is recoverable; the next one re-runs from scratch.
      lastSavedRevision.current = -1;
      console.warn('[session] autosave failed', err);
    }
  }, []);

  const buildEngine = useCallback((): TranslationEngine => {
    const engine: TranslationEngine = MOCK_ENABLED ? new MockEngine() : new SonioxEngine();
    const live = useLive.getState();

    engine.onStatusChange = (status) => useLive.getState().setStatus(status);
    engine.onOriginal = (text, speaker, language) =>
      useLive.getState().addOriginal(text, speaker, language);
    engine.onTranslation = (text) => useLive.getState().addTranslation(text);
    engine.onProvisional = (text, speaker, language) =>
      useLive.getState().setProvisional(text, speaker, language);
    engine.onError = (message) => {
      const attempt = engine instanceof SonioxEngine ? engine.attempt : 0;
      useLive.getState().setError(message, attempt);
    };
    void live;
    return engine;
  }, []);

  const start = useCallback(async (): Promise<StartResult> => {
    const { prefs } = useSettings.getState();
    if (!MOCK_ENABLED && !hasSonioxKey()) return 'not-configured';

    const live = useLive.getState();
    if (!live.sessionId) live.beginSession();
    live.beginChunk();
    live.setError(null);
    live.setRunning(true);

    const engine = buildEngine();
    engineRef.current = engine;
    // No apiKey: the browser holds none. SonioxEngine mints a short-lived one
    // per socket from /api/soniox/token.
    engine.connect({
      sourceLanguage: prefs.sourceLanguage,
      targetLanguage: resolveLanguage(prefs.targetLanguage),
      translationType: prefs.translationType,
      languageA: resolveLanguage(prefs.languageA),
      languageB: prefs.languageB,
      languageHintsStrict: prefs.languageHintsStrict,
      endpointDelay: prefs.endpointDelay,
      customContext: prefs.customContext,
    });

    const micError = await mic.start();
    if (micError) {
      engine.disconnect();
      engineRef.current = null;
      useLive.getState().setRunning(false);
      useLive.getState().setStatus('idle');
      return micError;
    }

    if (prefs.keepAwake) void activateKeepAwake();

    tickRef.current = setInterval(() => useLive.getState().tick(), 1000);
    autosaveRef.current = setInterval(() => void persist(), AUTOSAVE_MS);

    return 'ok';
  }, [buildEngine, mic, persist]);

  /** Ends the capture but keeps the transcript on screen — Start resumes it as
   *  a new chunk of the same session, exactly as the desktop did. */
  const stop = useCallback(async () => {
    mic.stop();
    engineRef.current?.disconnect();
    engineRef.current = null;

    if (tickRef.current) clearInterval(tickRef.current);
    if (autosaveRef.current) clearInterval(autosaveRef.current);
    tickRef.current = null;
    autosaveRef.current = null;

    deactivateKeepAwake();

    const live = useLive.getState();
    live.setRunning(false);
    live.setProvisional('', null, null);
    live.setLevel(0);
    live.endChunk();
    live.setStatus('disconnected');

    await persist(true);
  }, [mic, persist]);

  /**
   * Keep the session: flush it to disk and return to a cold Idle state.
   * Returns the id so the caller can kick off a summary for it.
   *
   * `title` comes from the optional name field in the save dialog; left empty,
   * the transcript falls back to its first translated sentence.
   */
  const keepSession = useCallback(
    async (title?: string) => {
      const id = useLive.getState().sessionId;
      if (title?.trim()) useLive.getState().setTitle(title.trim());
      await stop();
      useLive.getState().reset();
      lastSavedRevision.current = -1;
      return id;
    },
    [stop]
  );

  /**
   * Discard the session. Autosave has already written it during the run — to
   * IndexedDB and, if the network allowed, to the server — so "delete" has to
   * actually remove it. The dialog promises nothing is kept, and a stale
   * autosave sitting in the Library would break that promise.
   */
  const discardSession = useCallback(async () => {
    const id = useLive.getState().sessionId;
    mic.stop();
    engineRef.current?.disconnect();
    engineRef.current = null;

    if (tickRef.current) clearInterval(tickRef.current);
    if (autosaveRef.current) clearInterval(autosaveRef.current);
    tickRef.current = null;
    autosaveRef.current = null;
    deactivateKeepAwake();

    useLive.getState().reset();
    lastSavedRevision.current = -1;
    if (id) await deleteSession(id);
  }, [mic]);

  const retry = useCallback(async () => {
    await stop();
    return start();
  }, [start, stop]);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (autosaveRef.current) clearInterval(autosaveRef.current);
      engineRef.current?.disconnect();
      deactivateKeepAwake();
    };
  }, []);

  return {
    start,
    stop,
    keepSession,
    discardSession,
    retry,
    /**
     * Brings the autosaved record up to date on demand.
     *
     * "View more" reads the transcript back out of that record, and autosave is
     * on a fifteen-second timer — so without this the oldest lines a reader
     * asks for can be ones the record has not been told about yet.
     */
    persist,
    inputSampleRate: mic.inputSampleRate,
  };
}
