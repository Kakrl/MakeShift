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
  front: "front",
  middle: "middle",
  back: "back",
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
    <div className="flex flex-col gap-3 rounded-[8px] border border-control-border bg-white p-4">
      <p className="text-[18px] text-black font-sans">
        Place your right hand at the {positionLabel} of the sheet.
      </p>
      <p className="text-[14px] text-ink-muted font-sans" aria-live="polite">
        {rightHandDetected === true
          ? "Hold still, then capture this position."
          : "Place your right hand at this position, then capture."}
      </p>
      <button
        type="button"
        onClick={onCapture}
        disabled={disabled || rightHandDetected === false}
        className="self-start rounded-[8px] border-[1.5px] border-black bg-surface px-5 py-2 text-[18px] text-black font-sans transition-[background-color,transform] hover:bg-black/5 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Capture {positionLabel} position
      </button>
      <p className="text-[13px] text-ink-muted font-sans">
        Captured: {sampleCount}
      </p>
    </div>
  );
}
