# Automated CV performance testing

This is a working plan for repeatable tests of key contact detection. It records
the current decisions for review; it does not claim measured accuracy or
latency.

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
ground truth. Calibration data is collected separately and supplied to the
test; calibration does not occur during a clip. Clips must show complete
presses and releases.

The copyable starting point is
[`cv_video_test_template.json`](cv_video_test_template.json). It includes the
video name and constant `framesPerSecond`, labeled time range, keyboard layout
and pitch mapping, depth calibration captures, and annotated events. Replace
the example values with
measurements for the paired video. `fullyLabeledRange` says which part of the
video has been reviewed; inside that range, time with no listed press event is
intended to mean no key was pressed. This makes hover and other negative
examples usable for false-trigger measurement.

Annotate physical contact onset and release. The browser replay uses frame
numbers and `framesPerSecond` to seek each frame in order, so use constant-
frame-rate clips. If contact time is ambiguous,
record the best estimate plus the earliest and latest plausible frame rather
than implying frame-level certainty.

The `depthCaptures` section is for the raw hand landmarks you enter after
performing calibration yourself. It has one record for each of the five
calibration positions for each hand. Put all 21 detected hand landmarks in the
`landmarks` array, in MediaPipe landmark-index order from 0 through 20. Each
entry is an `{ "x": ..., "y": ..., "z": ... }` object using normalized X/Y
and MediaPipe relative Z. The calibration capture does not need to correspond
to a frame in the paired test video. The test can calculate fingertip
positions, Z values, knuckle spacing, and calibration curves from the raw
input. If you take repeated captures at a position, add another record for
that hand and position.

The current calibration page captures the five positions for the right hand
only. When calibration is completed, it prints those raw captures as JSON to
the browser developer console when `DEBUG_FLAGS.landmarkersTestGather` is set
to `true` in `frontend/src/debugFlags.ts`. The flag defaults to `false`. The
template includes left-hand slots for the dataset, but the current calibration
flow does not produce left-hand captures.

The calibration arrays are raw detector observations from the separate
calibration procedure. Other frames do not need landmark arrays: the browser
replay runs hand detection over the recording. Keeping derived values out of
the annotation file means the test implementation, rather than manual
arithmetic, defines how knuckle and Z measurements are calculated.

Partition recordings by person or session before tuning. Do not split adjacent
frames or clips from one take across tuning and held-out evaluation sets.
Keep a small, stable regression set for development and a separate held-out
set for reporting performance.

## Replay modes and timebases

Use two replay modes because they answer different questions.

### Fast ordered replay: best-case accuracy ceiling

Seek and process every video frame in order as quickly as the machine allows.
Use the browser's video decoder and the sidecar frame rate to seek, then pass
the source-frame timestamp through hand inference and time-dependent contact
logic. The test can take longer in wall time than the video duration; model time
still follows the clip. This estimates
the best-case accuracy when every recorded observation is available. It does
not represent live performance or audio output timing.

Measure hand-inference duration per frame with a wall clock, such as
`performance.now()` before and after the inference call. Also measure total
per-frame CV processing time and processing throughput. For example, report
the number of completed frames per wall-clock second, plus median, p95, and
maximum inference and pipeline durations. Keep the source video timestamps
separate from these wall-clock durations.

### Normal-speed replay: live performance

Play the video at its original speed and process fresh frames as they arrive.
Do not build a backlog to process every frame later: when processing cannot
keep up, use the newest available frame and count frames skipped. This mode
shows whether the pipeline sustains the video's recorded frame rate and
recognizes presses/releases in time under live-like constraints. Report
processed FPS, skipped frames, inference and total pipeline duration, event
recognition delay, and detection accuracy.

For annotations and event matching, use the video's presentation timeline. A
label refers to a video frame/time; a detected event records the source frame
or source timestamp that caused the transition. Also record wall-clock times
for processing start/end and event emission. The source time answers “which
observation led to the event?”; wall time answers “how long did processing and
dispatch take?” Keeping both avoids confusing an event's source frame with the
time the application actually emitted it. A wall clock used by temporal state
logic in fast replay must advance according to video timestamps, not according
to how long the test takes to run.

The fast ordered result is a best-case accuracy ceiling with all frames
available. The normal-speed result is the live-performance result and is the
one that determines whether the system keeps up during playing.

## Event matching and metrics

Score presses and releases separately because they are distinct transitions
that may need different tuning. Specify the timing tolerance before evaluating
a model. A predicted press matches a reference press only if its key agrees and
its onset is within the chosen tolerance. Each predicted transition and each
reference transition can match at most once. Apply the same one-to-one rule to
releases. Count unmatched predictions and references rather than silently
discarding them. Chords are simultaneous independent events; matching one note
must not hide a missing or extra chord note.

Report at least:

- missed presses and false or duplicate presses;
- wrong-key presses;
- missed releases and notes left stuck;
- chord errors and repeated-key behavior;
- press-onset and release-time error distributions, reported separately;
- results by scenario, alongside aggregate results.

Include counts, precision, and recall for presses and releases. Define the
combined detection-error numerator and denominator explicitly before
comparing against the under-3% target. Include event counts so a low rate from
a small sample is visible. Do not combine video-label timing error with sound
output latency.

## Sound and latency measurements

Report these stages separately:

- **Inference duration:** wall time spent running hand inference for a frame.
- **CV recognition delay:** labeled contact time to the source-video time of
  the frame that first causes the matching press/release event.
- **Event-emission delay:** labeled contact time to wall-clock note event
  emission during normal-speed replay.
- **Audible output delay:** labeled contact time to measured sound onset (and,
  if required, physical release to measured sound ending).

Inference duration helps explain CV cost, but it does not include waiting for a
frame, contact confirmation, or event dispatch. Audible output delay also
includes audio scheduling and device output. Measuring it requires the physical
contact label and actual captured audio on a shared or calibrated timebase; it
cannot be inferred by adding inference duration alone. If test audio is captured
alongside the video, document microphone and camera timing limits. Otherwise,
use a synchronized or calibrated output capture. Fast ordered replay is not
used to claim real audible latency.

## Test layers

1. **Calibration setup:** parse the JSON and build the depth model from the
   manually supplied raw calibration landmarks. Validate that each required
   hand and position has 21 finite landmarks before constructing the model.
2. **Deterministic unit tests:** feed recorded or hand-authored landmark
   sequences into geometry, gates, and per-finger state logic. Cover key
   boundaries, hover, short presses, release grace, chords, source loss, and
   calibration changes. These isolate logic and run quickly.
3. **Recorded-video integration tests:** replay selected clips through the
   actual hand detector and CV pipeline. The fast ordered mode is implemented;
   add normal-speed replay for live-performance evaluation. Save the raw
   detected press/release transitions and per-frame timing measurements in a
   generated report separate from the hand-authored annotations. Compare
   transitions one-to-one with labels. These exercise MediaPipe and the browser
   runtime; record browser/model/runtime versions and hardware, and investigate
   result variation instead of treating an environment-sensitive run as a
   deterministic unit test.
4. **Physical latency measurements:** separately capture a physical contact
   reference and the audio output on a shared or calibrated timebase. Report
   uncertainty and distributions. A video label measures timing against the
   camera recording and cannot by itself establish physical press-to-sound
   latency.

The Playwright replay harness is implemented at `/cv-video-replay` and its
command and current limits are recorded in the [test guide](../tests/README.md#cv-video-replay-39)
and [verification inventory](../tests/verification_test_inventory.md). It
currently supports constant-frame-rate clips and fast ordered replay; normal-
speed replay and tests against labeled clips remain pending.

## Decisions to work through

- Which contact events and scenario labels are required for the first dataset?
- What annotation tool will be used?
- What onset/release matching tolerances are appropriate for the measured
  camera frame rate and annotation uncertainty?
- What is the exact combined-error denominator for requirement 2.1.1?
