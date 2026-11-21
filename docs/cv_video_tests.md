# Running CV video tests

The replay tool sends decoded RGBA frames through the production Vision module
worker. It does not load a separate hand model or marker detector.

## Make a test case

1. Record constant-frame-rate footage with all four markers visible. Include
   an empty-keyboard frame before the fully labeled interval.
2. Copy [`cv_video_test_template.json`](cv_video_test_template.json). Set
   `schemaVersion: 2`, the filename and the actual source frame rate.
3. Set `calibration.keyboard.octaves` (1–3) and `startingMidiNote` (a supported
   C root). Set `referenceFrame` to a manually verified empty-keyboard frame,
   strictly before `fullyLabeledRange.startFrame`.
4. Annotate each press/release and its earliest/latest plausible source frames.
   `keyIndex` now means a chromatic offset: C=0, C#=1, D=2, through final C at
   `12 * octaves`. `midiNote` must equal `startingMidiNote + keyIndex`.
   Hand/finger fields remain annotation metadata; attribution is not scored.
5. Review every frame in the labeled interval, including silence. A reference
   frame containing hands produces an unsuitable baseline even if accepted.

Version 1 sidecars use depth captures and white-strip indexes. The tool rejects
them explicitly; convert pitches and choose an empty reference by reviewing the
clip. Do not infer a reference frame or reinterpret old indexes automatically.
Checked-in old sidecars/reports remain historical evidence; the automatic runner
reports that they need migration before replaying them.

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

## Read the report

Replay seeks each frame in order from the reference through the labeled end,
transfers its pixels, and waits for the worker response before submitting the
next frame. Capture must succeed on the designated reference frame. Lost
reference/geometry fails the run. Navigation terminates the worker and cancels
pending video waits. Video and worker operations have bounded timeouts.

The report scores press and release transitions by chromatic key, one-to-one,
with the existing one-frame matching tolerance. It includes frame seek time,
combined worker processing time, main-thread readback/worker round-trip time,
and processing distributions. Reference/pre-roll frames are processed for state,
but only transitions in the labeled interval are scored.

This is offline ordered throughput, not live camera FPS, physical contact
accuracy certification or physical press-to-sound latency. Browser seeking must
be checked against the intended encoded frames. Vision's automatic reference
refresh uses worker wall time, not source-video time; long replays can refresh
at a different source frame than live playback. Reports state that limitation.
See the [measurement plan](cv_automated_testing.md) and verification inventory.
