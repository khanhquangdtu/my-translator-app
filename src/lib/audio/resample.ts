/**
 * Sample-rate conversion to the 16 kHz mono PCM that every engine expects.
 *
 * This is NOT optional. In the browser the mismatch is the rule, not the
 * exception: an AudioContext runs at whatever rate the hardware picked —
 * 44100 or 48000 on nearly every machine — and asking for 16000 is a hint the
 * platform is free to ignore. So the real `AudioContext.sampleRate` is read and
 * converted here. Soniox does not detect the mismatch: fed 48 kHz audio
 * labelled as 16 kHz, it returns confident nonsense rather than an error.
 *
 * The conversion is area averaging (each output sample is the mean of the input
 * window it covers) rather than plain decimation. It costs nothing extra and
 * acts as a crude anti-alias filter, which decimation — what the desktop Rust
 * did with `.step_by(3)` — does not.
 */

export const TARGET_SAMPLE_RATE = 16000;

/** Collapse interleaved multi-channel PCM to mono by averaging channels. */
export function downmixToMono(interleaved: Int16Array, channels: number): Int16Array {
  if (channels <= 1) return interleaved;
  const frames = Math.floor(interleaved.length / channels);
  const mono = new Int16Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += interleaved[f * channels + c];
    mono[f] = sum / channels;
  }
  return mono;
}

/**
 * Stateful resampler. Must be stateful: buffers arrive continuously and the
 * conversion window rarely lands on a buffer boundary, so the leftover input
 * samples and the fractional read position carry over to the next call.
 * Throwing that state away per buffer would click at every seam.
 */
export class Resampler {
  private residual = new Int16Array(0);
  private frac = 0;

  constructor(private readonly targetRate: number = TARGET_SAMPLE_RATE) {}

  reset() {
    this.residual = new Int16Array(0);
    this.frac = 0;
  }

  /** @param mono single-channel PCM at `inputRate`. */
  push(mono: Int16Array, inputRate: number): Int16Array {
    if (inputRate === this.targetRate) return mono;

    const buf = this.concat(this.residual, mono);
    const ratio = inputRate / this.targetRate;
    const out: number[] = [];

    let t = this.frac;
    while (t + ratio <= buf.length) {
      const end = t + ratio;
      let sum = 0;
      let count = 0;
      for (let i = Math.floor(t); i < end && i < buf.length; i++) {
        sum += buf[i];
        count++;
      }
      out.push(count > 0 ? sum / count : 0);
      t = end;
    }

    const consumed = Math.min(Math.floor(t), buf.length);
    this.residual = buf.slice(consumed);
    this.frac = t - consumed;

    return Int16Array.from(out);
  }

  private concat(a: Int16Array, b: Int16Array): Int16Array {
    if (a.length === 0) return b;
    const merged = new Int16Array(a.length + b.length);
    merged.set(a, 0);
    merged.set(b, a.length);
    return merged;
  }
}
