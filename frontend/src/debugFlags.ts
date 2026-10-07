/** Shared developer switches. Diagnostics are hidden unless explicitly enabled at build time. */
export const DEBUG_FLAGS = {
  pipelineDiagnostics: process.env.NEXT_PUBLIC_PIPELINE_DIAGNOSTICS === "1",
  // Preserve main's current CV debugging behavior until its owner changes it.
  visualDebug: true,
  showSheetWithoutCalibration: true,
} as const;

/**
 * `?dev=1` skips saved calibration so live marker geometry alone gates
 * playing. Local and preview builds only; production ignores it.
 */
export function isDevMode(): boolean {
  if (process.env.NEXT_PUBLIC_VERCEL_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("dev") === "1";
}
