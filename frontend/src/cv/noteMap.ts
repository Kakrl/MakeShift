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

/** The current printed keyboard is one octave of white keys, starting at C4. */
export function keyIndexToMidi(keyIndex: number): number | null {
  if (keyIndex < 0 || keyIndex >= WHITE_KEY_NOTES.length) return null;
  const note = WHITE_KEY_NOTES[keyIndex];
  return (keyIndex === WHITE_KEY_NOTES.length - 1 ? 5 : 4) * 12 +
    { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[note];
}

export function midiToPitch(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
