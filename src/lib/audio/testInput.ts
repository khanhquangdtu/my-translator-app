/** Deterministic input for browser acceptance checks; enabled only in dev. */
export async function createTestAudioInput() {
  const context = new AudioContext();
  await context.resume();
  const oscillator = context.createOscillator();
  oscillator.frequency.value = 440;
  const gain = context.createGain();
  gain.gain.value = 0.15;
  const destination = context.createMediaStreamDestination();
  oscillator.connect(gain).connect(destination);
  oscillator.start();
  return {
    stream: destination.stream,
    close: () => { oscillator.stop(); void context.close(); },
  };
}
