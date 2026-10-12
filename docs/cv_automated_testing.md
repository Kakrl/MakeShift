# Automated CV performance testing

This is a working note for designing repeatable tests of key contact detection.
It records a proposed approach for discussion; it does not claim measured
accuracy or latency.

## Goals

Measure whether the CV pipeline reports the intended key presses and releases,
and how closely those events match their labeled times. Keep contact accuracy
separate from physical press-to-audible-output latency. The current targets and
reporting requirements are in the [browser architecture](architecture.md#accuracy-and-latency-verification)
and [RVTM addendum](rvtm_browser_addendum.md#measurement-rules).

## Labeled recordings

Collect recordings that cover short and long presses, different keys and
fingers, chords, hover, repeated presses, varied press speeds, and partial
occlusion. Use one JSON annotation file beside each video. The video supplies
the image and its timing; the annotation file supplies calibration and labeled
ground truth.

The copyable starting point is
[`cv_video_test_template.json`](cv_video_test_template.json). It includes the
video name, the labeled time range, keyboard layout and pitch mapping, depth
calibration captures, and annotated events. Replace the example values with
measurements for the paired video. `fullyLabeledRange` says which part of the
video has been reviewed; inside that range, time with no listed press event is
intended to mean no key was pressed. This makes hover and other negative
examples usable for false-trigger measurement.

Annotate physical contact onset and release. The template uses video frame
numbers to avoid assuming constant frame rate; the runner should map frame
numbers to the video's presentation timestamps. If contact time is ambiguous,
record the best estimate plus the earliest and latest plausible frame rather
than implying frame-level certainty.

The `depthCaptures` section is for the raw hand landmarks you enter after
performing calibration yourself. It has one record for each of the five
calibration positions for each hand. Put all 21 detected hand landmarks in the
`landmarks` array, in MediaPipe landmark-index order from 0 through 20. Each
entry is an `{ "x": ..., "y": ..., "z": ... }` object using normalized X/Y
and MediaPipe relative Z. Set `frame` to the video frame used for that
calibration capture. The test can then calculate fingertip positions, Z values,
knuckle spacing, and the calibration curves from the same raw input. If you
take repeated captures at a position, add another record for that hand and
position.

The current calibration page captures the five positions for the right hand
only. When calibration is completed, it prints those raw captures as JSON to
the browser developer console when `DEBUG_FLAGS.landmarkersTestGather` is set
to `true` in `frontend/src/debugFlags.ts`. The flag defaults to `false`. The
template includes left-hand slots for the dataset, but the current calibration
flow does not produce left-hand captures.

The calibration arrays are raw detector observations for those specific
calibration frames. Other frames do not need landmark arrays: the video test
can run hand detection over the recording. Keeping derived values out of the
annotation file means the test implementation, rather than manual arithmetic,
defines how knuckle and Z measurements are calculated.

Partition recordings by person or session before tuning. Do not split adjacent
frames or clips from one take across tuning and held-out evaluation sets.
Keep a small, stable regression set for development and a separate held-out
set for reporting performance.

## Event matching and metrics

Specify the matching tolerance before evaluating a model. A predicted press
matches a reference press only if its key agrees and its onset is within the
chosen time tolerance; match each event at most once. Apply the same policy to
releases. Count unmatched predictions and references rather than silently
discarding them.

Report at least:

- missed presses and false or duplicate presses;
- wrong-key presses;
- missed releases and notes left stuck;
- chord errors and repeated-key behavior;
- press-onset and release-time error distributions;
- results by scenario, alongside aggregate results.

Define the combined detection-error numerator and denominator explicitly
before comparing against the under-3% target. Include event counts so a low
rate from a small sample is visible. Do not combine physical latency with
video-label timing error.

## Test layers

1. **Deterministic unit tests:** feed recorded or hand-authored landmark
   sequences into geometry, gates, and per-finger state logic. Cover key
   boundaries, hover, short presses, release grace, chords, source loss, and
   calibration changes. These isolate logic and run quickly.
2. **Recorded-video integration tests:** replay selected clips through the
   actual hand detector and CV pipeline, then compare emitted key events with
   annotations. These exercise MediaPipe and the browser runtime. Record
   browser/model/runtime versions and hardware; investigate result variation
   instead of treating an environment-sensitive run as a deterministic unit
   test.
3. **Physical latency measurements:** separately capture a physical contact
   reference and the audio output on a shared or calibrated timebase. Report
   uncertainty and distributions. A video label measures timing against the
   camera recording and cannot by itself establish physical press-to-sound
   latency.

Recorded-video coverage is identified as planned in the
[verification inventory](../tests/verification_test_inventory.md). Any test
implementation should update its existing requirement row and execution
evidence there.

## Decisions to work through

- Which contact events and scenario labels are required for the first dataset?
- What annotation tool will be used?
- What onset/release matching tolerance is appropriate for the measured camera
  frame rate?
- Which browser and hardware configurations belong in repeatable integration
  runs?
- What is the exact combined-error denominator for requirement 2.1.1?
