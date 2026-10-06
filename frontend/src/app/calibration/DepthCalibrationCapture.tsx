"use client";

import type {
  DepthCalibrationPosition,
} from "../../cv/depthCalibration";

interface DepthCalibrationCaptureProps {
  position: DepthCalibrationPosition;
  sampleCount: number;
  rightHandDetected?: boolean;
  disabled?: boolean;
  onCapture: () => void;
}

const POSITION_LABELS: Record<DepthCalibrationPosition, string> = {
  "top-left": "top-left corner",
  "top-right": "top-right corner",
  "bottom-left": "bottom-left corner",
  "bottom-right": "bottom-right corner",
  center: "center",
};

/** Button-driven UI for collecting one right-hand depth position. */
export default function DepthCalibrationCapture({
  position,
  sampleCount,
  rightHandDetected,
  disabled = false,
  onCapture,
}: DepthCalibrationCaptureProps) {
  const positionLabel = POSITION_LABELS[position];

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <button
        type="button"
        onClick={onCapture}
        disabled={disabled || rightHandDetected === false}
        className="ms-key ms-key-primary px-5"
      >
        Capture {positionLabel} position
      </button>
      <div className="flex flex-col">
        <p className="text-[15px] text-ink">
          Place your right hand at the {positionLabel} of the sheet.
        </p>
        <p className="text-[13px] text-ink-muted" aria-live="polite">
          <span className="hidden sm:inline">
            {rightHandDetected === true
              ? "Hold still, then capture this position."
              : "Place your right hand at this position, then capture."}
            {" · "}
          </span>
          <span className="tabular-nums">Captured: {sampleCount}</span>
        </p>
      </div>
    </div>
  );
}
