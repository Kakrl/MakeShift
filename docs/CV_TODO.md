# CV accuracy and performance TODO

This checklist records the planned synchronous shadow-contact experiment. It
does not establish measured accuracy or latency. See
[`cv_shadow_experiments.md`](cv_shadow_experiments.md) for the current visual
evidence and limitations.

## Synchronous shadow contact experiment

- [x] Add a new, separate shadow detector file (for example,
  `frontend/src/cv/synchronousShadowDetector.ts`) that owns the new detector
  logic and measurements. Keep it isolated from the existing
  `shadowHeuristics.ts` and `shadowWorker.ts` implementations. It consumes the
  current camera frame, MediaPipe fingertip location, and current
  knuckle-eligibility result. The live pipeline calls it synchronously
  immediately after knuckle evaluation so both operate on the same frame; do
  not queue it in a Web Worker.
- [x] Implement the current visual candidate shape in the new detector: sample
  the three short luma rays around the fingertip, smooth the profiles, and
  report dip depth, steepest rebound, rebound width, and candidate status.
  Keep thresholds configurable/provisional and expose measurements for debug.
- [x] Keep the synchronous path limited to its fingertip/ray region; do not
  perform the legacy worker's full-crop segmentation or masking. The live path
  now copies at most a 48 × 68 region, while its note decision reads the three
  ray profiles. Background difference at those ray samples remains diagnostic
  only.
- [x] Gate shadow analysis on knuckle eligibility being high, plus the existing
  key/fingertip validity conditions. Do not spend per-finger shadow work when
  the knuckle gate is low.
- [x] Add an independent feature switch for the new detector. Allow the old
  asynchronous shadow detector to be disabled while the new detector is
  enabled, so labeled CV runs can isolate and compare the paths.
- [x] Reuse the valid marker geometry flow to capture the piano-sheet
  background from the camera frame whenever all required markers are detected
  and a valid homography is computed. Keep the last captured background when
  marker detection or homography computation fails. Align/use the reference
  consistently with the live frame for subtraction; do not let a failed scan
  replace it.
- [x] Feed background-subtraction data to the new detector as a per-frame
  input, while keeping the detector synchronous and its results associated
  with that same frame. If no valid background has been captured, report the
  background-dependent measurement as unavailable.
- [x] Preserve diagnostic-only mode and add overlays/readouts for the sampled
  region/rays, profile measurements, candidate state, and background
  availability. Ensure diagnostics alone cannot dispatch notes.
- [x] Route the new detector's contact evidence into the existing per-finger
  contact state only when its switch is enabled. Preserve press identity,
  release behavior, and stale-frame protections; remove the old async shadow
  path from that mode rather than combining both signals.
- [x] Run the labeled CV video evaluation with the old shadow detector off and
  the new synchronous detector on. Record clip/setup conditions, event
  precision and recall, false/missed presses, release behavior, and timing.
  Near-sheet hovers are deferred from this first pass and must remain listed as
  an unevaluated edge case, not counted as solved.
- [x] Update the shadow experiment notes and verification inventory with the
  actual coverage and execution evidence. Do not claim general accuracy or
  latency from a small labeled set or a visual preview.

## Deferred CV follow-ups

- [ ] Evaluate very near-sheet hovers after the initial detector comparison.
- [ ] Measure synchronous detector cost and dropped frames on representative
  camera sessions after the compact crop change. If still costly, consider
  sampling only ray pixels directly from the live and saved-background frames.
