"use client";

import { toDisplayStyle, type Point, type Size } from "../coverGeometry";

interface Props {
  /** Fingertips in normalized frame coordinates, 0 to 1. */
  fingertips: Point[];
  /** Source video frame size, needed to undo the object-cover crop. */
  frame: Size;
  /** Rendered size of the camera box. */
  size: Size;
}

/**
 * Red fingertip markers drawn over the live preview.
 *
 * These are shown for the whole hover and rest steps rather than only after a
 * capture, so the dots never appear out of nowhere and the user can see what
 * the detector is tracking while they position their hands (#8).
 */
export default function HandLandmarkOverlay({ fingertips, frame, size }: Props) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {fingertips.map((tip, i) => (
        <div
          key={i}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={toDisplayStyle(
            { x: tip.x * frame.width, y: tip.y * frame.height },
            frame.width,
            frame.height,
            size,
          )}
        >
          <div className="h-4 w-4 rounded-full bg-[#e05c5c] shadow-[0_0_0_2px_rgba(255,255,255,0.85)]" />
        </div>
      ))}
    </div>
  );
}
