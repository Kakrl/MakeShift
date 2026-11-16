"use client";

import { useId, useMemo } from "react";
import type { VisionResult } from "../../cv/visionCameraPipeline";
import type { KeyboardLayout } from "../../cv/keyboardLayout";
import { getBlackKeyPolygons } from "../../cv/keyboardGeometry";
import { projectPoint } from "../../cv/homography";
import { blackKeyIndexToMidi, keyIndexToMidi } from "../../cv/noteMap";
import type { Point } from "../../cv/types";

const points = (polygon: readonly Point[]) =>
  polygon.map((p) => `${p.x},${p.y}`).join(" ");

/** Drawing only: detection and chromatic selection remain inside Vision. */
export default function VisionKeyHighlights({
  result,
  layout,
  activePitches,
  enabled,
}: {
  result: VisionResult;
  layout: KeyboardLayout;
  activePitches: ReadonlySet<number>;
  enabled: boolean;
}) {
  const maskId = useId();
  const geometry = result.geometry;
  const blackKeys = useMemo(() => {
    if (!geometry) return [];
    return getBlackKeyPolygons(layout)
      .map((polygon) =>
        polygon.map((point) => projectPoint(geometry.sheetToFrame, point)),
      )
      .filter((polygon): polygon is Point[] =>
        polygon.every((point) => point !== null),
      );
  }, [geometry, layout]);
  if (!geometry) return null;
  return (
    <g>
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width={result.width}
          height={result.height}
        >
          <rect
            width={result.width}
            height={result.height}
            fill="var(--color-white)"
          />
          {blackKeys.map((polygon, i) => (
            <polygon
              key={i}
              points={points(polygon)}
              fill="var(--color-surface-dark)"
            />
          ))}
        </mask>
      </defs>
      {geometry.whiteKeyPolygons.map((polygon, i) => {
        const midi = keyIndexToMidi(i, layout);
        const active = enabled && midi !== null && activePitches.has(midi);
        return (
          <g key={i}>
            <polygon
              points={points(polygon)}
              fill={active ? "var(--color-red)" : "none"}
              fillOpacity="0.65"
              mask={`url(#${maskId})`}
              data-key-midi={midi}
              data-key-kind="white"
              data-key-active={active}
            />
            <polygon
              points={points(polygon)}
              fill="none"
              stroke="var(--color-accent-light)"
              strokeWidth="1"
            />
          </g>
        );
      })}
      {blackKeys.map((polygon, i) => {
        const midi = blackKeyIndexToMidi(i, layout);
        const active = enabled && midi !== null && activePitches.has(midi);
        return (
          <polygon
            key={i}
            points={points(polygon)}
            fill={active ? "var(--color-blue)" : "none"}
            fillOpacity="0.75"
            stroke={active ? "var(--color-blue)" : "var(--color-accent-light)"}
            strokeWidth="1"
            data-key-midi={midi}
            data-key-kind="black"
            data-key-active={active}
          />
        );
      })}
    </g>
  );
}
