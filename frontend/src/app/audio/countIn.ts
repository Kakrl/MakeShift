import { beatIntervalMs, type Meter } from "../../lib/meter";

/** Schedule the bounded measure once; UI/frame delays cannot move its clicks. */
export function scheduleCountInClicks(ctx: AudioContext, bpm: number, meter: Meter): () => void {
  const intervalSeconds = beatIntervalMs(bpm, meter) / 1000;
  const origin = ctx.currentTime;
  const voices: { oscillator: OscillatorNode; gain: GainNode; started: boolean }[] = [];
  const cancel = () => {
    for (const { oscillator, gain, started } of voices) {
      if (started) oscillator.stop();
      oscillator.disconnect();
      gain.disconnect();
    }
    voices.length = 0;
  };
  try {
    for (let beat = 0; beat < meter.numerator; beat++) {
      const start = origin + beat * intervalSeconds;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const voice = { oscillator, gain, started: false };
      voices.push(voice);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.type = "sine";
      oscillator.frequency.value = beat === 0 ? 1050 : 820;
      gain.gain.setValueAtTime(beat === 0 ? 0.65 : 0.38, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.055);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(start);
      voice.started = true;
      oscillator.stop(start + 0.06);
    }
  } catch (error) {
    cancel();
    throw error;
  }
  return cancel;
}
