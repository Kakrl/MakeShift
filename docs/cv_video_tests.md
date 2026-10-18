# Running CV video tests

This guide covers the current Playwright replay tool. It runs a recorded clip
through the browser's video decoder, MediaPipe hand detector, ArUco marker
detector, and the same live contact pipeline used by the app.

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
5. After doing calibration separately, put the 21 MediaPipe `{x, y, z}`
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
existing overlap-only replay.

## Read the report

The replay pauses the video, seeks through frames in order, and advances the
contact pipeline's clock using video time. It requests the MediaPipe GPU
delegate and falls back to CPU if GPU initialization fails. The report records
the selected delegate and WebGL renderer. ArUco detection follows the live
250 ms acquisition / 10 s recheck cadence, retaining the last usable key
geometry between scans. The default replay uses overlap-only contact. The
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
default replay has knuckle and shadow gates disabled. This runner is the fast
ordered accuracy run. It does
not currently measure normal-speed frame drops or physical press-to-sound
latency. Check the [full measurement plan](cv_automated_testing.md) before
interpreting results.

The five automated evaluation-core cases cover parser and scoring setup.
Validate that browser seeking selects the intended encoded frame on each clip
before using its scores as an accuracy ceiling.
