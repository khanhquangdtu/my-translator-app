/**
 * Microphone capture — getUserMedia + an AudioWorklet, in place of expo-audio.
 *
 * The contract downstream is unchanged from the desktop and mobile builds:
 * **PCM s16le, 16 kHz, mono, batched into 200 ms blocks**. One WebSocket frame
 * every 200 ms instead of one per audio block.
 *
 * The resampling is not optional and not a fallback path. A browser AudioContext
 * runs at the hardware's rate — 44100 or 48000 on nearly every machine — and
 * `sampleRate` in the constructor is a request the platform may ignore. Soniox
 * does not notice audio at the wrong rate; it returns fluent nonsense. So the
 * context's real rate is read and every block goes through `Resampler`.
 *
 * The three browser-specific constraints on the track are also deliberate:
 * echo cancellation, noise suppression and auto gain are all tuned for a voice
 * call with one near speaker, and this app's whole use case is a phone lying on
 * a table picking up a room. AGC in particular pumps hard on the pauses between
 * turns and drags the level meter around with it.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { QUIET_THRESHOLD, rmsLevel } from './level';
import { Resampler, TARGET_SAMPLE_RATE } from './resample';

/** 16000 samples/s × 0.2 s = 3200 samples = 6400 bytes per batch. */
const BATCH_SAMPLES = TARGET_SAMPLE_RATE / 5;

const WORKLET_URL = '/pcm-worklet.js';

export type MicCaptureOptions = {
  /** One 200 ms block of PCM s16le 16 kHz mono, ready for the engine. */
  onPcm: (pcm: ArrayBuffer) => void;
  /** 0..1 loudness, emitted per audio block for the level meter. */
  onLevel?: (level: number) => void;
};

export type MicCaptureError = 'permission-denied' | 'start-failed';

export function useMicCapture({ onPcm, onLevel }: MicCaptureOptions) {
  const resampler = useRef(new Resampler(TARGET_SAMPLE_RATE));
  const pending = useRef<Int16Array[]>([]);
  const pendingSamples = useRef(0);

  const contextRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isStreaming, setIsStreaming] = useState(false);
  /** The rate the hardware actually gave us — surfaced for diagnostics. */
  const [inputSampleRate, setInputSampleRate] = useState<number | null>(null);
  const reportedRate = useRef<number | null>(null);

  // Latched in an effect rather than assigned during render: the audio callback
  // fires asynchronously, so it only ever needs the value as of the last commit.
  const onPcmRef = useRef(onPcm);
  const onLevelRef = useRef(onLevel);
  useEffect(() => {
    onPcmRef.current = onPcm;
    onLevelRef.current = onLevel;
  });

  const handleBlock = useCallback((mono: Int16Array, sampleRate: number) => {
    if (reportedRate.current !== sampleRate) {
      reportedRate.current = sampleRate;
      setInputSampleRate(sampleRate);
      // Deliberately noisy: a silent rate mismatch is the one failure mode that
      // produces plausible-looking but wrong transcripts.
      console.log(
        `[audio] AudioContext running at ${sampleRate} Hz` +
          (sampleRate === TARGET_SAMPLE_RATE
            ? ' (no conversion needed)'
            : ` → resampling to ${TARGET_SAMPLE_RATE} Hz`)
      );
    }

    const resampled = resampler.current.push(mono, sampleRate);
    if (resampled.length === 0) return;

    const level = rmsLevel(resampled);
    onLevelRef.current?.(level);

    if (process.env.NODE_ENV !== 'production') logSignal(resampled, level);

    pending.current.push(resampled);
    pendingSamples.current += resampled.length;

    while (pendingSamples.current >= BATCH_SAMPLES) {
      const batch = new Int16Array(BATCH_SAMPLES);
      let filled = 0;
      while (filled < BATCH_SAMPLES) {
        const head = pending.current[0];
        const take = Math.min(head.length, BATCH_SAMPLES - filled);
        batch.set(head.subarray(0, take), filled);
        filled += take;
        if (take === head.length) pending.current.shift();
        else pending.current[0] = head.subarray(take);
      }
      pendingSamples.current -= BATCH_SAMPLES;
      onPcmRef.current(batch.buffer);
    }
  }, []);

  const teardown = useCallback(() => {
    nodeRef.current?.port.close();
    nodeRef.current?.disconnect();
    nodeRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    void contextRef.current?.close().catch(() => {});
    contextRef.current = null;

    pending.current = [];
    pendingSamples.current = 0;
    resampler.current.reset();
    setIsStreaming(false);
  }, []);

  const start = useCallback(async (): Promise<MicCaptureError | null> => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (err) {
      const name = (err as DOMException)?.name;
      return name === 'NotAllowedError' || name === 'SecurityError'
        ? 'permission-denied'
        : 'start-failed';
    }

    resampler.current.reset();
    pending.current = [];
    pendingSamples.current = 0;

    try {
      // Asking for 16 kHz here is worth doing — some platforms honour it and
      // the resampler then short-circuits — but never worth trusting.
      const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      contextRef.current = context;
      // Safari can hand back a suspended context even inside a user gesture.
      if (context.state === 'suspended') await context.resume();

      await context.audioWorklet.addModule(WORKLET_URL);

      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, 'pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      node.port.onmessage = (event: MessageEvent<Int16Array>) => {
        handleBlock(event.data, context.sampleRate);
      };
      source.connect(node);

      nodeRef.current = node;
      streamRef.current = stream;
      setIsStreaming(true);
      return null;
    } catch (err) {
      console.warn('[audio] could not start capture', err);
      stream.getTracks().forEach((track) => track.stop());
      teardown();
      return 'start-failed';
    }
  }, [handleBlock, teardown]);

  const stop = useCallback(() => {
    teardown();
  }, [teardown]);

  // A tab closed mid-session must not leave the recording indicator lit.
  useEffect(() => teardown, [teardown]);

  return { start, stop, isStreaming, inputSampleRate };
}

/**
 * Dev-only signal probe, throttled to once a second.
 *
 * Separates the two failures that look identical from the UI — a capture path
 * that is delivering pure silence (no mic routed to the device at all) from one
 * that is delivering real audio the level thresholds are misjudging. Peak is
 * the honest number here: RMS of speech with pauses can look low even when the
 * signal is fine.
 */
let lastSignalLog = 0;
function logSignal(samples: Int16Array, level: number) {
  const now = Date.now();
  if (now - lastSignalLog < 1000) return;
  lastSignalLog = now;

  let peak = 0;
  let nonZero = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
    if (v !== 0) nonZero++;
  }
  console.log(
    `[audio] peak=${peak}/32767 nonZero=${nonZero}/${samples.length} level=${level.toFixed(3)}` +
      (peak === 0 ? '  ← SILENT: no microphone signal reaching the app' : '')
  );
}

export { QUIET_THRESHOLD, TARGET_SAMPLE_RATE };
