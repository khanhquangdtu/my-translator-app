/**
 * Numerical check on the audio resampler — the one piece of this app whose
 * failure mode is silent. Fed the wrong rate, Soniox returns confident nonsense
 * rather than an error, so drift and pitch are asserted here rather than
 * discovered in a meeting.
 *
 * Ported from the Expo build's `scripts/resample.test.mjs`, which compiled the
 * module to CommonJS first because the RN toolchain had no test runner. Vitest
 * imports the TypeScript directly, so the assertions are the same and the
 * scaffolding is gone.
 *
 * The rates matter more here than they did on the phone: a browser AudioContext
 * runs at 44100 or 48000 on nearly every machine, so those two rows are the
 * normal path, not the edge case.
 */
import { describe, expect, it } from 'vitest';

import { downmixToMono, Resampler } from './resample';

function sine(freq: number, rate: number, seconds: number): Int16Array {
  const n = Math.round(rate * seconds);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000);
  return out;
}

/** Runs a 440 Hz tone through the resampler in `chunkMs` blocks. */
function convert(inRate: number, chunkMs: number, seconds = 2) {
  const resampler = new Resampler(16000);
  const input = sine(440, inRate, seconds);
  const chunk = Math.round((inRate * chunkMs) / 1000);

  const collected: Int16Array[] = [];
  let total = 0;
  for (let i = 0; i < input.length; i += chunk) {
    const out = resampler.push(input.subarray(i, Math.min(i + chunk, input.length)), inRate);
    total += out.length;
    collected.push(out);
  }

  const flat = new Int16Array(total);
  let offset = 0;
  for (const c of collected) {
    flat.set(c, offset);
    offset += c.length;
  }

  // Zero crossings are the cheapest honest pitch estimate: a resampler that
  // drops or duplicates samples shifts the frequency, which is exactly the
  // "confident nonsense" failure we are guarding against.
  let crossings = 0;
  for (let i = 1; i < flat.length; i++) if (flat[i - 1] < 0 !== flat[i] < 0) crossings++;

  return { samples: total, expected: 16000 * seconds, hz: crossings / 2 / seconds };
}

describe('Resampler', () => {
  it.each([
    ['48000 Hz / 20 ms', 48000, 20],
    ['48000 Hz / 7 ms', 48000, 7],
    ['44100 Hz / 23 ms', 44100, 23],
    ['16000 Hz passthrough', 16000, 20],
    ['32000 Hz / 11 ms', 32000, 11],
    ['22050 Hz / 17 ms', 22050, 17],
  ])('holds rate and pitch: %s', (_label, inRate, chunkMs) => {
    const { samples, expected, hz } = convert(inRate, chunkMs);
    // Four samples of drift over two seconds is a quarter of a millisecond;
    // anything more accumulates over a long meeting.
    expect(Math.abs(samples - expected)).toBeLessThanOrEqual(4);
    expect(Math.abs(hz - 440)).toBeLessThanOrEqual(6);
  });

  it('carries state across chunk boundaries', () => {
    // The same audio in one block and in many must produce the same count. A
    // resampler that reset per buffer would come up short here — and would
    // click at every seam in real use.
    const oneBlock = convert(48000, 2000);
    const manyBlocks = convert(48000, 7);
    expect(manyBlocks.samples).toBe(oneBlock.samples);
  });
});

describe('downmixToMono', () => {
  it('averages the channels of each frame', () => {
    const mono = downmixToMono(Int16Array.from([100, 300, -100, -300, 0, 0]), 2);
    expect(Array.from(mono)).toEqual([200, -200, 0]);
  });

  it('returns mono input untouched', () => {
    const input = Int16Array.from([1, 2, 3]);
    expect(downmixToMono(input, 1)).toBe(input);
  });
});
