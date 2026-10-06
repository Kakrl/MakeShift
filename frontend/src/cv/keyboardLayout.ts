/** One source for printed dimensions, playable white keys and MIDI bounds. */
export interface KeyboardLayout {
  octaves: number;
  startingMidi: number;
  whiteKeys: number;
  /** Legacy calibrations imply one sheet per selected octave. */
  paperOctaves?: number;
  paperFitOverride?: boolean;
}

export const DEFAULT_LAYOUT: Readonly<KeyboardLayout> = Object.freeze({
  octaves: 1, startingMidi: 48, whiteKeys: 8,
});
export const WHITE_KEY_PITCH_MM = 23.5;
export const OCTAVE_SPAN_MM = 7 * WHITE_KEY_PITCH_MM;
export const MARKER_INSET_MM = (8 * WHITE_KEY_PITCH_MM / 1.1) * 0.05;

export function validLayout(value: unknown): value is KeyboardLayout {
  if (!value || typeof value !== "object") return false;
  const v = value as KeyboardLayout;
  return [1, 2, 3].includes(v.octaves) &&
    Number.isInteger(v.startingMidi) && v.startingMidi >= 0 &&
    v.startingMidi % 12 === 0 && v.startingMidi + 12 * v.octaves <= 127 &&
    v.whiteKeys === 7 * v.octaves + 1 &&
    (v.paperOctaves === undefined || [1, 2, 3].includes(v.paperOctaves)) &&
    (v.paperFitOverride === undefined || typeof v.paperFitOverride === "boolean");
}

export function paperOctaves(layout: KeyboardLayout): number {
  return layout.paperOctaves ?? layout.octaves;
}
export function paperFits(layout: KeyboardLayout): boolean {
  return validLayout(layout) && layout.octaves <= paperOctaves(layout);
}
export function usableLayout(layout: KeyboardLayout): boolean {
  return validLayout(layout) && (paperFits(layout) || layout.paperFitOverride === true);
}
export function sameLayout(a: KeyboardLayout, b: KeyboardLayout): boolean {
  return a.octaves === b.octaves && a.startingMidi === b.startingMidi &&
    a.whiteKeys === b.whiteKeys && paperOctaves(a) === paperOctaves(b) &&
    !!a.paperFitOverride === !!b.paperFitOverride;
}
export function startingNotes(octaves: number): number[] {
  if (![1, 2, 3].includes(octaves)) return [];
  return Array.from({ length: Math.floor((127 - 12 * octaves) / 12) + 1 },
    (_, index) => index * 12);
}
export function keyboardWidthMm(octaves: number): number {
  return (7 * octaves + 1) * WHITE_KEY_PITCH_MM;
}
