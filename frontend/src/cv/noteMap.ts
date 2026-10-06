type NoteName = "C" | "D" | "E" | "F" | "G" | "A" | "B";

const WHITE_KEY_NOTES: readonly NoteName[] = [
  "C",
  "D",
  "E",
  "F",
  "G",
  "A",
  "B",
  "C",
];

/** Current sheet: eight white keys, MIDI 48–60 (C3–C4 in MIDI notation). */
export function keyIndexToMidi(keyIndex: number): number | null {
  if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex >= WHITE_KEY_NOTES.length) return null;
  const note = WHITE_KEY_NOTES[keyIndex];
  return (keyIndex === WHITE_KEY_NOTES.length - 1 ? 5 : 4) * 12 +
    { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[note];
}

export function midiToPitch(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Parses a recorder pitch such as `C4`, `F#3` or `Bb2`; null when malformed or outside MIDI 0-127. */
export function pitchToMidi(pitch: string): number | null {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch);
  if (!match) return null;
  const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1] as NoteName];
  const value = (Number(match[3]) + 1) * 12 + semitone +
    (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0);
  return Number.isInteger(value) && value >= 0 && value <= 127 ? value : null;
}
