import { DEFAULT_LAYOUT, usableLayout, type KeyboardLayout } from "./keyboardLayout";
type NoteName = "C" | "D" | "E" | "F" | "G" | "A" | "B";

const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11] as const;

/** Leftmost printed C is startingMidi; shared final C is included once. */
export function keyIndexToMidi(keyIndex: number, layout: KeyboardLayout = DEFAULT_LAYOUT): number | null {
  if (!usableLayout(layout) || !Number.isInteger(keyIndex) ||
      keyIndex < 0 || keyIndex >= layout.whiteKeys) return null;
  const pitch = layout.startingMidi + Math.floor(keyIndex / 7) * 12 +
    WHITE_OFFSETS[keyIndex % 7];
  return pitch <= 127 ? pitch : null;
}

export function midiToPitch(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Parses recorder pitches; null when malformed or outside MIDI 0-127. */
export function pitchToMidi(pitch: string): number | null {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch);
  if (!match) return null;
  const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1] as NoteName];
  const value = (Number(match[3]) + 1) * 12 + semitone +
    (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0);
  return Number.isInteger(value) && value >= 0 && value <= 127 ? value : null;
}
