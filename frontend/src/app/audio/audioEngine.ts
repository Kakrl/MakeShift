const activeOscillators = new Map<number, { oscillator: OscillatorNode; gain: GainNode }>();
let audioContext: AudioContext | null = null;

export function initializeAudio(): void {
  if (!audioContext) {
    audioContext = new AudioContext({ latencyHint: "interactive" });
  }
  if (audioContext.state === "suspended") void audioContext.resume();
}

export function audioNoteOn(note: number, velocity = 0.8): void {
  initializeAudio();
  if (!audioContext || activeOscillators.has(note)) return;

  console.log("playing sound!");

  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(Math.max(0.02, Math.min(1, velocity)) * 0.2, now + 0.01);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(now);
  activeOscillators.set(note, { oscillator, gain });
}

export function audioNoteOff(note: number): void {
  const active = activeOscillators.get(note);
  if (!active || !audioContext) return;

  console.log("stop playing sound!");

  const now = audioContext.currentTime;
  active.gain.gain.cancelScheduledValues(now);
  active.gain.gain.setTargetAtTime(0, now, 0.04);
  active.oscillator.stop(now + 0.2);
  activeOscillators.delete(note);
}

export function releaseAllAudioNotes(): void {
  for (const note of activeOscillators.keys()) audioNoteOff(note);
}
