"use client";

import { useCamera } from "./CameraContext";

/**
 * Covers the camera area while the stream is being acquired or after it failed.
 * Renders nothing once the camera is ready, so the live preview shows through.
 */
export default function CameraStatusOverlay() {
  const { status, error, retry } = useCamera();

  if (status === "ready") return null;

  const isRequesting = status === "requesting";

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-surface-dark px-6 text-center"
      role="status"
      aria-live="polite"
    >
      {isRequesting ? (
        <div className="flex flex-col items-center gap-3">
          <span
            aria-hidden="true"
            className="camera-spinner h-7 w-7 rounded-full border-2 border-white/20 border-t-white"
          />
          <p className="font-display text-[19px] font-semibold text-white">Starting camera…</p>
          <p className="text-[14px] text-ink-inverse-muted">
            Allow camera access if your browser asks.
          </p>
        </div>
      ) : (
        <div className="flex max-w-[420px] flex-col items-center gap-3">
          <svg
            aria-hidden="true"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M12 3L22 20H2L12 3Z" fill="var(--color-danger)" stroke="var(--color-danger)" strokeWidth="2" strokeLinejoin="round" />
            <line x1="12" y1="9" x2="12" y2="14" stroke="var(--color-white)" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="17" r="1" fill="var(--color-white)" />
          </svg>
          <p className="font-display text-[20px] font-semibold text-white">
            {error?.title ?? "Could not start the camera"}
          </p>
          <p className="text-[14px] leading-relaxed text-ink-inverse-muted">
            {error?.detail}
          </p>
          {error?.kind !== "unsupported" && (
            <button
              onClick={retry}
              className="ms-key ms-key-glass mt-2 px-5"
            >
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
