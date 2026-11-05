# Running CV video tests

This guide covers the Playwright recorded-video replay tool. The current home
detector is selected explicitly with `CV_TECHNIQUE=shadow-baseline`. It uses the
same CPU reference subtraction, filtered fingertip proposals, white-key mapping
and locality4 DFS as home playback, without MediaPipe or temporal filtering.
Omitting `CV_TECHNIQUE` keeps the older MediaPipe/contact replay for historical
comparisons. Do not treat that default legacy replay as a test of the new home
detector.

## Run the current shadow baseline

From `frontend/`:

```sh
CV_TECHNIQUE=shadow-baseline CV_DFS_CUTOFF=20 \
CV_RESULT_DIR=test-results/cv-video/shadow-baseline-cutoff20 \
npm run test:cv-video:auto
```

This builds once and runs all four checked-in clips sequentially. Use
`-- --clip 1` for one clip. Valid DFS cutoffs are5/20/40/60; default20 is an
experimental baseline, not a validated threshold. A separate result directory
preserves older reports. The existing paused/manual controls also work with
this technique; candidate numbers are frame-local spatial IDs, not anatomy or
tracking identities. Landmark near/forward evidence and the old finger-specific
inspector assertions belong to legacy techniques.

The baseline uses aspect-preserving analysis with longest side640 pixels,
validates complete marker geometry, and captures that same decoded frame as
reference on acquisition and every successful10-second check. Marker misses
retain reference/geometry. As in home playback, complete markers are assumed
to mean no hands. A hand present during reference capture can be incorporated
into the baseline. Raw accepted candidates are unioned per key each frame;
UNKNOWN, rejection or missing tips contribute no press. No hand/depth model,
tracking, debounce or hysteresis is used. Sidecar depth captures are ignored
by this technique (the version1 parser still expects the `depthCaptures` array;
new baseline-only sidecars may use an empty array).

Reports include the exact detector/cutoff, reference capture frames, per-frame
anonymous proposals and tri-state decisions, eligible/accepted/UNKNOWN counts,
active keys and scored press/release transitions. `shadowBaselinePerformance`
reports `analysisMs` (image read/subtraction/proposals/mapping/DFS) and `totalCvMs`
(including frame capture, downsampling and marker/reference work), with median,
p95 and maximum over all reference-available frames, including empty frames.
Replay throughput also includes seeking and report/UI bookkeeping. The browser
runner asserts the selected baseline actually analyzed images with a captured
reference and made no MediaPipe model/inference-WASM requests. Completion is
not an accuracy pass.

Scores use the existing sidecars unchanged and one-frame matching tolerance.
Some older labels disagree with the user's newer contact annotations, including
first-middle onset in clip1; these are exploratory comparisons, not adjudicated
physical ground truth. Clips are previously inspected development footage, not
a held-out set. Ordered paused-frame seeking processes every requested frame;
it does not measure normal-speed dropped frames, camera pipeline behavior,
audio or physical press-to-sound latency. No under3% error or under50ms claim
follows from this run. See the [shadow status handoff](cv_shadow_detection_status_and_next_steps.md)
for current state and the execution record in `tests/README.md` for results.

### Inspect edges, DFS paths and the decision

Use the same manual command:

```sh
CV_TECHNIQUE=shadow-baseline CV_DFS_CUTOFF=20 \
CV_HEADFUL=1 CV_MANUAL_STEP=1 \
CV_RESULT_DIR=test-results/cv-video/manual-shadow-baseline \
npm run test:cv-video:auto -- --clip 1
```

Manual baseline replay opens **Shadow DFS inspection**. Pause or step with
Next/Previous, then select a numbered candidate from the dropdown or table.
The source overview shows the filtered geometry and all proposals. Four aligned
zoom panels show source pixels, geometry mask, raw darkening and filtered shadow,
with the selected candidate's actual measured edge and searches:

- Blue: selected lower/side edge. Purple: allowed locality band, attachment
  seeds and a-row; dashed box: the shown seed's local width window.
- Red translucent pixels: downward DFS visits. A red line/endpoint is an actual
  successful path to the veto row.
- Green translucent pixels: upward DFS visits. A green line/endpoint is an
  actual successful path to the support row.

The decision text follows the detector's ordering: any downward witness vetoes;
otherwise upward support plus available downward evidence can produce PRESS.
Known lack of upward support produces NO PRESS; unavailable/incomplete geometry
can remain UNKNOWN. NO PRESS is not independently proven hovering. Off-keyboard
proposals say EXCLUDED and have no DFS; they cannot activate a key. The table
shows all four cutoffs. Changing **Inspect DFS cutoff** affects only the display;
the original scored replay cutoff and result stay visible. The expandable search
table lists seeds, visited counts, endpoints, width bounds, unavailable pixels
and band/width caps. Known caps do not become UNKNOWN.

The inspector recomputes detailed paths only while paused using that frame's
original reference and transform. It checks the displayed pixel fingerprint
and the original proposals/decisions before showing paths; a mismatch is shown
explicitly and hides the paths. Cached frames retain their reference version,
including across a periodic reference replacement. Resume clears the paused
visuals. Only the current inspection retains full masks/DFS traces; the replay
history stores small per-frame snapshots and reference images, not all full
frame masks or paths. Zooms use analysis pixels and add no source detail.

For automated UI verification, set `CV_BASELINE_STEP_CHECK=1` with
`CV_TECHNIQUE=shadow-baseline` (headless is supported). This checks candidate and
cutoff selection, actual witness availability, exact five-canvas restoration
across Previous/Next, mobile fit and clearing on Resume. Optional
`CV_BASELINE_INSPECT_FRAME` selects the frame to pause near (default110).
Set `CV_BASELINE_REFERENCE_CHECK=1 CV_BASELINE_INSPECT_FRAME=308` with clip3
for the reference-boundary check, which also accepts a fresh reference's valid
empty-proposal state. These diagnostic runs include inspection/UI overhead and
are not baseline throughput measurements. Local clip1 stepping and clip3
reference-boundary assertions passed; see [inspector execution](../tests/README.md#paused-shadow-dfs-inspector-2026-11-01).

### Latest local baseline run (2026-11-01)

All four clips completed at cutoff20:1,434 frames, with reference-backed
analysis on1,402. Presses and releases each scored24 matched /103 extra /21
missed transitions against the unchanged sidecars (18.9% precision,53.3% recall).
The replay structural checks passed; this is not an accuracy pass. Pooled
analysis median/p95/max was34.1/45.8/83.8ms and total CV43.2/56.1/147.4ms;
ordered replay throughput was15.5FPS. See [the execution record](../tests/README.md#automatic-shadow-baseline-video-replay-2026-11-01)
for per-clip counts, environment, timing definitions and limitations. Reports
and hashes are preserved in ignored
`frontend/test-results/cv-video/shadow-baseline-cutoff20-2026-11-01/`.

## Make a test case

1. Record a **constant-frame-rate** clip with the printed keyboard and all four
   ArUco markers visible. Include the whole press and release for every note.
2. Copy [`cv_video_test_template.json`](cv_video_test_template.json) beside the
   clip and edit the copy. Keep large video files wherever convenient; the
   runner takes paths to the clip and sidecar separately.
3. Set `video` to the clip filename and `framesPerSecond` to its constant frame
   rate. The replay uses those values to seek each frame in order. The example
   template uses 30 FPS; change it to match the recording.
4. Set the keyboard `layoutId` and `startingMidiNote` to match the printed
   sheet. The current replay recognizes layout IDs containing `one`, `two`, or
   `three` to select the octave count.
5. For legacy MediaPipe techniques, after doing calibration separately, put the 21 MediaPipe `{x, y, z}`
   landmarks at each of the five calibration positions in `depthCaptures`.
   Add captures for either hand you want in the dataset. Do not leave a capture
   empty when running the test.
6. Label each note in `events`: `hand` and `finger` identify the performer,
   `keyIndex` is the zero-based white-key index, and `midiNote` is the note.
   Give press and release a best-estimate frame plus earliest/latest plausible
   frames. `fullyLabeledRange` covers the clip interval you reviewed, including
   intervals where no note should be detected.

## Run it

Run all checked-in clips in sequence with one command:

```sh
cd frontend
npm run test:cv-video:auto
```

This builds and starts the production app once, runs each replay in sequence,
then shuts the app down. It prints each full report and a combined score and
performance summary. Per-clip reports and the summary are saved under
`frontend/test-results/cv-video/`. On Apple Silicon Macs the runner uses
installed Google Chrome automatically because Playwright Chromium is not
available for macOS 13 arm64. On other platforms, install Playwright Chromium
once with `cd frontend && npx playwright install chromium`. Pass
`-- --clip 2` to run only video 2, `-- --browser chrome` to choose Chrome, or
`-- --browser chromium` to choose bundled Chromium.

For custom clips, use the manual steps below.

To inspect a replay manually, launch Playwright visibly and enable the frame
controls. For example, open clip 1 with synchronous shadows and no knuckle
gate:

```sh
cd frontend
CV_TECHNIQUE=synchronous-shadow-no-knuckles \
CV_HEADFUL=1 CV_MANUAL_STEP=1 \
npm run test:cv-video:auto -- --clip 1
```

Chromium opens with the source video and overlays the projected keys. Pressed
keys are filled red; fingertip dots are green for shadow candidates, blue when
eligible, red when active, and muted otherwise. Use **Pause/Resume**, **Next
frame**, **Previous frame**, **Capture hover**, and **Capture press** to navigate
and save the current raw video frame as a labeled PNG without the diagnostic
overlay. Each capture opens a form to select one or more fingers on the left
and/or right hand. The whole frame is saved to retain hand joints for future
knuckle tests; filenames include the hover/press label, selected fingers, frame
number, and video timestamp. By default, the Playwright runner saves captures
directly in the repository root with their suggested filenames; set
`CV_CAPTURE_DIR` to choose another folder.
Previous/Next browse cached results
when moving within already processed frames; resuming catches up to the latest
processed frame before running new frames, so the contact pipeline keeps its
correct temporal state. The status shows the frame number, active key indices,
and shadow-candidate count. The existing paced mode remains available with
`CV_HEADFUL=1 CV_FRAME_DELAY_MS=33`; visual replay delay affects total duration
and FPS, so use the regular headless run for throughput measurements.

Start the production app in one terminal:

```sh
cd frontend
npm run build
npm start
```

In another terminal, run the clip and sidecar through Playwright:

```sh
cd frontend
CV_VIDEO_FILE=/path/to/clip.mp4 \
CV_SIDECAR_FILE=/path/to/clip.json \
npm run test:cv-video
```

The app URL defaults to `http://127.0.0.1:3000`; set `MAKE_SHIFT_URL` to use a
different server. Playwright uses its Chromium browser by default. If that
browser is unavailable but Google Chrome is installed, set
`CV_BROWSER_CHANNEL=chrome`. Set `CV_RESULT_FILE=/path/to/result.json` to save
the report; otherwise it is printed to the terminal.

To evaluate the synchronous shadow experiment, set
`CV_TECHNIQUE=synchronous-shadow` for the same command. This replay enables the
knuckle and synchronous-shadow gates, keeps the legacy shadow worker off, and
captures a same-coordinate background when a complete marker set produces a
valid homography. Set `CV_TECHNIQUE=synchronous-shadow-no-knuckles` to run the
synchronous detector with knuckle gating disabled. Omit the variable for the
existing legacy switches in `cv/liveContactPipeline.ts` (currently the
Y/shadow press-hysteresis experiment is enabled; knuckle, legacy shadow-worker,
z-motion and synchronous-profile gates are disabled).

## Read the report

The replay pauses the video, seeks through frames in order, and advances the
contact pipeline's clock using video time. Legacy techniques request the MediaPipe GPU
delegate and falls back to CPU if GPU initialization fails. The report records
the selected delegate and WebGL renderer. ArUco detection follows the live
250 ms acquisition / 10 s recheck cadence, retaining the last usable key
geometry between scans. The default legacy replay uses `CONTACT_TECHNIQUES`
from `cv/liveContactPipeline.ts`; inspect those switches when comparing old runs. The
legacy shadow worker starts only when its switch is enabled and uses replay
time for asynchronous results. The synchronous-shadow experiments are selected
with `CV_TECHNIQUE=synchronous-shadow` or
`CV_TECHNIQUE=synchronous-shadow-no-knuckles` as described above.

For the synchronous-shadow replay, per-frame contact-pipeline timing includes
its synchronous image sampling and background-difference work. This remains a
fast ordered replay and does not measure live frame drops.

The report includes every detected transition, matched and unmatched expected
and predicted events, and scores presses and releases separately. It also
includes per-frame seek, marker, geometry, inference, contact-pipeline and
total-CV timings, plus aggregate median, p95 and maximum values. Save the
complete output with `CV_RESULT_FILE` to inspect all frames and transitions.

The current score matches transitions by key and press/release type. Although
the sidecar records hand and finger, finger attribution is not scored yet. The
legacy switches do not apply to `shadow-baseline`. This runner performs an
ordered recorded-video comparison. It does
not currently measure normal-speed frame drops or physical press-to-sound
latency. Check the [full measurement plan](cv_automated_testing.md) before
interpreting results.

The five automated evaluation-core cases cover parser and scoring setup.
Validate that browser seeking selects the intended encoded frame on each clip
before using its scores as an accuracy ceiling.

## Shadow evidence frame review

Manual replay automatically displays the same near/forward darkness metrics
as `/cv-image-test`. Use the existing visible frame controls:

```sh
cd frontend
CV_HEADFUL=1 CV_MANUAL_STEP=1 npm run test:cv-video:auto -- --clip 1
```

Green rectangles mark the near band (2–10 px below the landmark), blue the
forward band (11–45 px), both ±40 px wide. The table below the video reports
dark pixel count, darkness strength, each band's frame-to-frame strength
change, spatial gradient and image ΔY. Positive ΔY means downward in image
coordinates; it is not calibrated physical descent. Finger labels use detected
handedness and finger name. Unknown/duplicate handedness and missing references
are unavailable. Losing a finger or replacing the background resets comparison.

Previous/Next restore cached measurements together with their source frame;
browsing backward does not rerun contact state. Measurement definitions and
limitations match [the image experiment](cv_image_tests.md#comparing-darkness-hypotheses-locally-2026-10-27).
There are no added contact thresholds or note decisions. Near bands are only
landmark-relative guesses; inspect whether they actually contain the contact
edge. The strict mask can miss shadows and include occluding fingers.

For headless exports use `CV_SHADOW_EVIDENCE=1`; the report adds
`shadowEvidenceFrames` for all processed frames. Extra full-frame reads and
analysis affect throughput; the extra measurements run outside contact timing.
Default headless runs omit them. `CV_SHADOW_STEP_CHECK=1 CV_SHADOW_EVIDENCE=1`
automates Next/Previous/Next and asserts identical cached display before
resuming the clip, saving `shadow-evidence-stepping.png` beside the report.

The same **Experimental dark-pixel filter** controls are available before a
replay. Edit and rerun; the displayed recorded filter belongs to the current
run, and old cached frames are never reinterpreted using edited controls.
Translucent blue spans show every matching pixel in the measurement bands,
including when there is no fitted oval. The exported `darkPixelFilter` records
all four limits. These changes affect diagnostics only; the live contact rule
keeps its existing defaults. The automated step check also edits and resets a
filter control before replay. Dark-pixel limits still need tuning against
multiple press and near-hover examples.

### Finger inspector layout

The replay places the video beside a selected-finger inspector on desktop,
stacking the panels on narrow screens. Choose a finger in **Inspect finger**
or expand **All fingers** and select its row. The selected finger is outlined
in the video and shown in a magnified crop with the same measurement overlays.
Motion, near darkness, forward darkness and spatial sharpness have separate
cards; signed changes distinguish increasing from decreasing measurements.
Frame indices are zero-based, matching captured filenames and exported data.

Four charts share the same last-60-frame horizontal window ending at the
currently displayed frame. Each has its own labeled vertical range; compare
when changes occur, not their drawn heights across charts. Missing samples
break the line. Previous/Next restores the matching crop, metrics and history
without advancing the contact pipeline. Source/filter setup, the full finger
table and raw JSON report are collapsible. The video stays visible while
scrolling the inspector on desktop. Analysis and contact rules are unchanged.

Local UI validation on clip 1: automated filter edit/reset, cached frame
restoration, finger selection, four rendered charts, populated crop canvas,
and a 390-pixel viewport without horizontal overflow passed. Desktop and
mobile screenshots were inspected; the 288-frame replay completed with no
page errors. See [execution evidence](../tests/README.md#video-replay-inspector-ui-2026-10-27).

## Finger-independent heatmap

For the current shadow-only experiment, open `/cv-shadow-test` using the link
at the top of this page. It supports images and paused video without finger
tracking, marker detection or a sidecar. See [heatmap usage and limits](cv_shadow_heatmap.md).

### Heatmaps inside the replay

The **Diagnostic view** selector now defaults to **Shadow heatmaps**. During
manual review, pause and use the existing Previous/Next controls to inspect
full-frame darkening and normalized color-change maps beside the source video.
The finger measurements remain selectable. Heatmap display controls update
immediately and are separate from the strict dark-pixel detector's settings.
Finger/key overlays are hidden in heatmap mode so the source stays unobstructed.

The maps use the empty-sheet background captured by the replay's existing
complete-marker scan; start with hands out of view and all markers visible.
Each cached frame records a reference ID, and the small reference snapshots
are kept separately so revisiting a frame uses that frame's original reference.
The PNG/color output is not stored for every frame. References are capped at
640 pixels on the longest edge; map rendering runs only while paused, outside
contact-pipeline timing. Headless runs without shadow evidence omit reference
sampling. Missing references are visibly unavailable. No fingertip locations,
clusters, or strict dark-pixel masks enter the heatmap calculation. The replay
itself runs the selected detector; `shadow-baseline` uses anonymous filtered
fingertips/DFS, while legacy techniques use MediaPipe/contact evaluation.

The same [subtraction/color interpretation and limits](cv_shadow_heatmap.md)
apply: finger occlusion is still visible, color shift is ambiguous, and whole
frames include pixels outside the paper. `CV_SHADOW_STEP_CHECK=1` checks the
finger inspector and then heatmap view switching, scale updates, cached frame
navigation, paused/resumed behavior and mobile overflow. Execution evidence is
recorded in the [testing guide](../tests/README.md#integrated-replay-heatmaps-2026-10-27).
