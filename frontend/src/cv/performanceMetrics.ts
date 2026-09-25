type MetricWindow = {
  startedAt: number;
  cameraFrames: number;
  handInferences: number;
  handInferenceMs: number;
  markerDetections: number;
  markerDetectionMs: number;
  completeMarkerDetections: number;
  keyPresses: number;
  keyReleases: number;
};

const REPORT_INTERVAL_MS = 1000;

let window: MetricWindow = {
  startedAt: performance.now(),
  cameraFrames: 0,
  handInferences: 0,
  handInferenceMs: 0,
  markerDetections: 0,
  markerDetectionMs: 0,
  completeMarkerDetections: 0,
  keyPresses: 0,
  keyReleases: 0,
};

function maybeReport(now: number): void {
  const elapsedMs = now - window.startedAt;
  if (elapsedMs < REPORT_INTERVAL_MS) return;

  const seconds = elapsedMs / 1000;
  console.info("[CV metrics]", {
    cameraFps: Number((window.cameraFrames / seconds).toFixed(1)),
    handInferenceFps: Number((window.handInferences / seconds).toFixed(1)),
    handInferenceMsAvg: window.handInferences
      ? Number((window.handInferenceMs / window.handInferences).toFixed(1))
      : 0,
    markerDetectionFps: Number((window.markerDetections / seconds).toFixed(1)),
    markerDetectionMsAvg: window.markerDetections
      ? Number((window.markerDetectionMs / window.markerDetections).toFixed(1))
      : 0,
    completeMarkerRate: window.markerDetections
      ? Number(
          ((window.completeMarkerDetections / window.markerDetections) * 100).toFixed(1),
        )
      : 0,
    keyPresses: window.keyPresses,
    keyReleases: window.keyReleases,
  });

  window = {
    startedAt: now,
    cameraFrames: 0,
    handInferences: 0,
    handInferenceMs: 0,
    markerDetections: 0,
    markerDetectionMs: 0,
    completeMarkerDetections: 0,
    keyPresses: 0,
    keyReleases: 0,
  };
}

export function recordCameraFrame(now: number): void {
  window.cameraFrames += 1;
  maybeReport(now);
}

export function recordHandInference(durationMs: number, now = performance.now()): void {
  window.handInferences += 1;
  window.handInferenceMs += durationMs;
  maybeReport(now);
}

export function recordMarkerDetection(
  durationMs: number,
  complete: boolean,
  now = performance.now(),
): void {
  window.markerDetections += 1;
  window.markerDetectionMs += durationMs;
  if (complete) window.completeMarkerDetections += 1;
  maybeReport(now);
}

export function recordKeyTransitions(
  pressed: number,
  released: number,
  now = performance.now(),
): void {
  window.keyPresses += pressed;
  window.keyReleases += released;
  maybeReport(now);
}
