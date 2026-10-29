"use client";

import { memo, useEffect, useState } from "react";
import { calibrationReason, MARKER_CHECK_INTERVAL_MS, type CalibrationResult, type CameraSignature } from "../cv/calibration";
import type { Point } from "../cv/types";

export type AlignmentScan = { camera: CameraSignature; corners: Point[]; at: number };

/** Sheet-reference corners, not the printable paper boundary or piano footprint. */
function SheetAlignment({ saved, camera, scan }: {
  saved: CalibrationResult | null;
  camera: CameraSignature | null;
  scan: AlignmentScan | null;
}) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!scan) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.max(0,
      scan.at + MARKER_CHECK_INTERVAL_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [scan]);
  if (!saved || !camera) return null;
  const reason = calibrationReason(saved, camera, null, saved.layout);
  // Never compare unrelated camera pixel spaces, even when dimensions match.
  if (reason !== "markers-unavailable") return null;
  const current = scan && calibrationReason(saved, scan.camera, null, saved.layout) === "markers-unavailable" &&
    clock - scan.at < MARKER_CHECK_INTERVAL_MS ? scan.corners : null;
  const points = (corners: Point[]) => corners.map(p => `${p.x},${p.y}`).join(" ");
  return <>
    <svg aria-hidden="true" viewBox={`0 0 ${camera.width} ${camera.height}`}
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 z-10 h-full w-full scale-x-[-1] pointer-events-none">
      {[saved.corners, current].map((corners, i) => corners && <g key={i} fill="none">
        <polygon points={points(corners)} stroke="var(--color-surface-dark)" strokeWidth="7" vectorEffect="non-scaling-stroke" strokeDasharray={i ? "8 5" : undefined} />
        <polygon points={points(corners)} stroke={i ? "var(--color-accent-light)" : "var(--color-white)"}
          strokeWidth="3" vectorEffect="non-scaling-stroke" strokeDasharray={i ? "8 5" : undefined} />
      </g>)}
    </svg>
    <aside aria-label="Sheet-reference alignment" className="absolute top-3 left-3 right-3 z-20 w-fit max-w-[calc(100%-1.5rem)] rounded-lg bg-surface px-3 py-2 text-xs text-ink pointer-events-none">
      <p className="font-semibold">Sheet-reference alignment</p>
      <p>― Calibrated position (solid)</p>
      <p>{current ? "┄ Current position (dashed; last complete scan)" : "Current position unavailable — show all four markers"}</p>
      <p className="sr-only">Position checks up to 10 seconds apart</p>
    </aside>
  </>;
}

export default memo(SheetAlignment);
