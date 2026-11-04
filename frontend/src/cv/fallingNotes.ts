import type { Point } from "./types";
import { getBlackKeyPolygons, getPianoCorners, getWhiteKeyPolygons } from "./keyboardGeometry";
import type { KeyboardLayout } from "./keyboardLayout";
import { blackKeyIndexToMidi, keyIndexToMidi } from "./noteMap";

/** A note to fall, on the playback timeline's clock. */
export type FallingNote = Readonly<{ midi: number; startMs: number; endMs: number }>;

/** Where one key's notes land: its span on the keyboard line, in screen pixels. */
export type KeyColumn = Readonly<{ left: Point; right: Point; black: boolean }>;

export type FallingBar = Readonly<{ corners: Point[]; black: boolean; sounding: boolean }>;

/** How long a note takes to fall from the top of the frame to the keyboard line. */
export const FALL_LEAD_MS = 3000;
// Keeps very short notes visible as a sliver instead of a line.
const MIN_BAR_MS = 80;

/**
 * Projects each key's span on the keyboard line into the camera frame. The
 * line is whichever long edge of the piano is higher on screen, so notes
 * land on the top of the keyboard however the camera faces the sheet.
 * Null when any point fails to project.
 */
export function keyColumns(
  layout: KeyboardLayout,
  project: (point: Point) => Point | null,
): Map<number, KeyColumn> | null {
  const corners = getPianoCorners(layout);
  if (corners.length !== 4) return null;
  const projected = corners.map(project);
  if (!projected.every((point): point is Point => point !== null)) return null;
  const [topLeft, topRight, bottomRight, bottomLeft] = projected;
  const lineY = topLeft.y + topRight.y <= bottomLeft.y + bottomRight.y ? corners[0].y : corners[3].y;

  const columns = new Map<number, KeyColumn>();
  const add = (midi: number | null, key: Point[], black: boolean) => {
    if (midi === null) return;
    const left = project({ x: key[0].x, y: lineY });
    const right = project({ x: key[1].x, y: lineY });
    if (left && right) columns.set(midi, { left, right, black });
  };
  getWhiteKeyPolygons(layout).forEach((key, index) => add(keyIndexToMidi(index, layout), key, false));
  getBlackKeyPolygons(layout).forEach((key, index) => add(blackKeyIndexToMidi(index, layout), key, true));
  return columns.size === layout.whiteKeys + layout.octaves * 5 ? columns : null;
}

const lift = (point: Point, progress: number): Point => ({ x: point.x, y: point.y * (1 - progress) });

/**
 * Bars for the notes inside the lead window. A point on the keyboard line at
 * height y rises linearly to the top of the frame over `leadMs`, so a note's
 * bottom edge reaches the line exactly at its start and stays there while it
 * sounds, shrinking until its end. Notes outside the layout are skipped.
 */
export function fallingBars(
  notes: readonly FallingNote[],
  positionMs: number,
  columns: ReadonlyMap<number, KeyColumn>,
  leadMs = FALL_LEAD_MS,
): FallingBar[] {
  const bars: FallingBar[] = [];
  const horizon = positionMs + leadMs;
  for (const note of notes) {
    const end = Math.max(note.endMs, note.startMs + MIN_BAR_MS);
    if (end <= positionMs || note.startMs >= horizon) continue;
    const column = columns.get(note.midi);
    if (!column) continue;
    const bottom = (Math.max(note.startMs, positionMs) - positionMs) / leadMs;
    const top = (Math.min(end, horizon) - positionMs) / leadMs;
    bars.push({
      corners: [
        lift(column.left, top),
        lift(column.right, top),
        lift(column.right, bottom),
        lift(column.left, bottom),
      ],
      black: column.black,
      sounding: note.startMs <= positionMs,
    });
  }
  return bars;
}
