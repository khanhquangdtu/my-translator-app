/**
 * Microphone level, for the 7-bar meter and the "barely hearing anything"
 * warning. Speech is quiet in linear terms, so the RMS is mapped through dBFS
 * — a linear 0..1 meter would sit near zero for normal room speech and tell the
 * user nothing about whether their phone is placed well.
 */

/** Anything below this on a sustained basis means the phone is placed badly. */
export const QUIET_THRESHOLD = 0.18;

const FLOOR_DB = -60;

/** @returns 0..1, where ~0.5 is comfortable speech at conversational distance. */
export function rmsLevel(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] / 32768;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / samples.length);
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));
}
