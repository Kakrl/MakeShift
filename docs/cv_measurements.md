# CV performance baseline

Captured from the browser console on 2026-09-22 using the current local CV
pipeline. The measurements were reported in approximately one-second windows
by `performanceMetrics.ts`.

## Observed results

| Metric | Observed range |
| --- | ---: |
| Camera loop FPS | 2.7–5.6 FPS |
| MediaPipe inference FPS | 2.7–5.6 FPS |
| MediaPipe inference duration | 81–198 ms |
| Marker detection FPS | 2.7–5.5 FPS |
| Marker detection duration | 92–125 ms |
| Key presses in a reporting window | 3 observed |
| Key releases in a reporting window | 2 observed |
| Complete marker rate | 0% in the displayed sample |

Representative windows included:

```text
cameraFps: 3.9, handInferenceMsAvg: 144.3,
markerDetectionFps: 3.9, markerDetectionMsAvg: 97.3

cameraFps: 2.9, handInferenceMsAvg: 197.8,
markerDetectionFps: 3.9, markerDetectionMsAvg: 95.7

cameraFps: 5.6, handInferenceMsAvg: 83.7,
markerDetectionFps: 4.6, markerDetectionMsAvg: 101.8
```

## Initial interpretation

- The camera FPS and MediaPipe inference FPS are nearly identical, indicating
  that synchronous MediaPipe inference is pacing the animation-frame loop.
- Both MediaPipe and marker detection are expensive enough to compete for the
  main thread. Their durations are individually large, before canvas drawing,
  React updates, and collision processing are included.
- The current pipeline is far below the desired 20–30 FPS interactive target.
  A finger can enter and leave a key between observations, so accuracy results
  are currently confounded by missed temporal samples.
- The displayed complete marker rate of 0% came from a run with the paper
  removed, so it is expected and does not indicate a marker-detection defect.
  With the paper present, marker detection should be measured during initial
  geometry acquisition before it is disabled.
- The key transition counts confirm that events are being produced, but this
  sample is too small to estimate accuracy or latency.

## Baseline conclusion

The first optimization target should be the main-thread CV schedule and model
execution path, not audio/MIDI dispatch. Because the printed piano is static,
marker detection now runs frequently during initial acquisition and once every
10 seconds afterward. Hand tracking continues against the cached key polygons
between those checks, and a failed periodic check leaves the last usable
geometry in place. The next comparison should measure MediaPipe processing
separately, then test latest-frame scheduling, reduced React updates, and
worker/GPU options. Accuracy testing should follow once the observation rate is
high enough to capture short presses and releases.

## Post-marker-lock measurement

After marker detection was removed from the active loop, with hands visible:

| Metric | Observed result |
| --- | ---: |
| Camera/hand-tracking FPS | 14.5–15.6 FPS |
| MediaPipe inference duration | 63.3–68.2 ms |
| Marker detection FPS | 0 in the sampled windows |
| Key presses/releases | 7–12 presses, 10–15 releases per window |

With no hands visible, the loop reached approximately 20–22 FPS. This indicates
that the remaining performance cost is primarily the hand-present MediaPipe
path, not marker detection or audio/MIDI dispatch. Reaching 20 FPS with hands
would require reducing the approximately 63–68 ms inference cost below about
50 ms per frame.
