/**
 * Microphone capture, audio-thread side.
 *
 * Runs in the AudioWorklet, which is the only place in the browser that sees
 * raw PCM without going through a decoder. Its job is deliberately small:
 * downmix to mono, convert float to s16, and post a block up to the main
 * thread. Sample-rate conversion happens up there, in the same `Resampler` the
 * mobile and desktop builds use, so all three agree on what 16 kHz means.
 *
 * A render quantum is 128 frames — posting each one would be ~375 messages a
 * second. Blocks are accumulated to 2048 frames (~43 ms at 48 kHz) first, which
 * is still far finer than the 200 ms the engine batches to.
 */

const BLOCK_FRAMES = 2048;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(BLOCK_FRAMES);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    // No input connected yet, or the track ended. Returning true keeps the node
    // alive so capture resumes if the device comes back.
    if (!input || input.length === 0 || !input[0]) return true;

    const channels = input.length;
    const frames = input[0].length;

    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += input[c][i];
      this.block[this.filled++] = sum / channels;

      if (this.filled === BLOCK_FRAMES) {
        this.flush();
      }
    }

    return true;
  }

  flush() {
    const pcm = new Int16Array(this.filled);
    for (let i = 0; i < this.filled; i++) {
      const s = Math.max(-1, Math.min(1, this.block[i]));
      // Asymmetric on purpose: the negative range is one step wider, and
      // scaling both by 0x7fff would clip the loudest negative peak.
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.filled = 0;
    this.port.postMessage(pcm, [pcm.buffer]);
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
