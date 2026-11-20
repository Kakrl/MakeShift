# Vision WASM build and handoff

This build exports the current native `Vision` implementation, including chromatic
lookup in `ChromaticLookup.cpp` using the existing frontend key dimensions and
black-key priority. The home page now integrates this bundle through a module
worker; the standalone build and parity harness remain independent of Next.js.

## Build

From the repository root, with Git, CMake, Python 3, Node and a C++ toolchain
available:

```sh
bash backend/build_vision_wasm.sh
```

The first run downloads the pinned SDK and OpenCV into ignored
`build/vision-wasm-deps/`, then cross-compiles the dependencies and Vision.
Subsequent runs reuse them. Source revisions and versions live in
[`toolchain.env`](../backend/src/CV/wasm/toolchain.env): Emscripten 4.0.20 and
OpenCV 4.12.0. The script checks checkout revisions and does not change shell
startup files or install dependencies globally. Native Conan builds are separate.

OpenCV modules: core, imgproc, objdetect and required calib3d/features2d/flann.
Desktop camera/window modules, OpenCV.js bindings, SIMD and threads are excluded.
C++ exceptions are enabled. The first build is single-threaded; a normal Web
Worker can host it without shared-memory thread deployment requirements.

Tracked handoff directory: `backend/src/CV/wasm/dist/`. Keep these files together:

| File | Purpose |
| :--- | :--- |
| `makeshift-vision.mjs` | Public JavaScript loader and instance lifecycle/validation |
| `makeshift-vision-core.mjs` | Generated Emscripten loader, used internally |
| `makeshift-vision-core.wasm` | Compiled Vision/OpenCV code |
| `makeshift-vision.d.mts` | TypeScript declarations for the public module |
| `toolchain.env` | Compiler/source version pins |
| `build-info.json` | Source/artifact SHA-256 hashes and base Git revision |

Commit this generated bundle with its matching source changes so consumers can
use it without installing the compiler. Compiler/dependency caches and the
intermediate bundle stay under ignored `build/`; the script copies the final
bundle into the tracked handoff directory and records hashes. Serve the
WASM binary as `application/wasm` and modules as JavaScript. Pass `wasmURL` if
hosting the binary somewhere else. Rebuild after changing native source, flags
or compiler versions; publish the matching loader and WASM together.

## Use

```js
import loadVision from './makeshift-vision.mjs';

const api = await loadVision();
const model = api.createVision();
model.setReference(); // First frame should show empty piano and all four markers.

const result = model.processFrame({
  rgba, width, height, octaves: 1,
});
// result.pressedKeys: sorted unique semitone offsets from the leftmost C.
// MIDI pitch = configured startingMidi + key; dispatch changes through the session.
// result.fingertips: optional drawing data, current camera points and contact states.
// result.geometry: accepted homography, marker centers and white-key polygons.
// result.pressRanges: fixed anchors and projected matching-radius outlines.

model.reset();
model.destroy();
```

Load once per worker/runtime, then reuse the instance and input storage. Input
is tightly packed RGBA8 (`Uint8Array` or `Uint8ClampedArray`), dimensions 1..4096
per side, octaves 1..3. Nonzero-offset typed-array views are supported. Malformed
inputs throw JavaScript errors before native state changes. Processing failures
require reset. Destruction is idempotent; other calls after destruction throw.

Inputs are copied into a reusable native buffer; outputs are JavaScript-owned
snapshots. Input arrays may be reused after return. Large mask/measurement arrays
are omitted from ordinary results; `model.getDiagnostics()` returns copied
analysis-resolution planes, or null for unready/capture frames. These support
parity and a future browser shadow-class view. No raw WASM heap views escape.

All ordinary result points use original input camera pixels. Apply display
scaling/mirroring consistently in the frontend. Fingertip IDs remain frame-local;
white-key polygon array indices are **white-strip indices**, not chromatic/MIDI
key IDs. `pressedKeys` uses chromatic offsets 0..12*octaves (C=0, C#=1),
including the final C. It maps fixed press anchors, so retained movement does not
change pitch, and merges multiple anchors on one key. Capture/unready/released
frames have an empty key snapshot. Starting pitch, velocity and musical events
remain caller responsibilities. Calibration now uses an explicit Vision setup capture (see #297 below).
The full reference/retention semantics are in the
[interface contract](../backend/cv_wasm_interface.md).

## Verify

Use clang-format 17 for C++ formatting, matching the lint workflow. That workflow
checks all C++ files under `backend/src/`, including the WASM bindings. Rebuild
the handoff bundle after formatting CV sources so its source hashes stay current.

Build the native oracle through the existing native viewer build:

```sh
sh backend/run_shadow_camera.sh --help
ctest --test-dir build/vision --output-on-failure
ctest --test-dir build/vision-wasm --output-on-failure
node tests/cv/wasm_parity.mjs
node tests/cv/wasm_browser.mjs
```

Native/WASM CTest runs the same chromatic lookup, pipeline and controlled-clock
reference-policy suites. Lookup covers every key across 1–3 octaves, perspective,
black priority/dimensions, bounds, invalid inputs and sorted/deduplicated snapshots.
Reference tests check pitch retention across a key boundary and release. The
Node/browser runners generate temporary native RGBA fixtures and oracle snapshots. Both run the real public loader; the browser runs a module
worker served locally, without camera access or app integration. Browser testing
uses the frontend's existing Playwright dependency and Chrome by default;
`VISION_BROWSER_CHANNEL=chromium` selects an installed Playwright Chromium.
`VISION_NATIVE_ORACLE` overrides the native exporter path if needed.

Comparisons cover complete mask/valid planes (exact), raw/score planes (absolute
tolerance 0.001), press states and anchor positions, resize, homography, reference
capture/blocked checks/timing, reset/layout/dimension invalidation, 1–3 octaves,
independent instances, input validation and snapshot ownership. Drawing vertices
allow one camera pixel for cross-platform rounding; homography/marker values
allow absolute 0.001; other result numbers allow 0.000001. A fake monotonic clock
in the test runtime makes the 9999/10000 ms boundary reproducible without sleeps;
it is not part of the production frame input API.

Timing printed by the harness is test-condition processing time, not physical
press-to-sound latency. Fixture results are development/synthetic parity, not
held-out physical contact or empty-paper accuracy. Execution status belongs in
[the testing guide](../tests/README.md#vision-wasm-export).

## Frontend worker integration

`npm run dev` and `npm run build` in `frontend/` run
`scripts/prepare-vision.mjs`, verify artifact hashes and copy the tracked bundle
into ignored `public/vision/` files. No native compiler is needed for a frontend
build. Keep the checked-in `public/vision/vision.worker.mjs` alongside those
assets. This is a plain browser module worker so the generated Emscripten loader
and binary retain their relative URLs. It requires no shared memory headers.

`CVOverlayCoordinator` replaces the home hand/marker/contact overlays with
`VisionCameraPipeline`. A canvas reads raw camera RGBA on the main thread and
transfers the buffer, with at most one frame in flight. Vision copies the bytes
into reusable native memory and downsamples internally; full-frame readback and
copy costs remain to profile. Results carry main-clock observation times and
captured session IDs. Stale results, camera changes and reset epochs cannot
supply new notes to a replacement session. Failure releases notes and offers
Reload tracker. Teardown terminates the worker, freeing its runtime/model memory.

Clear the piano, show all four markers, then press Set reference. A blocked
request preserves the old reference and normal detections. Accepted empty
reference refreshes preserve playing/recording while clearing any old held-key
snapshot. Normal playing still requires compatible saved calibration; the
existing local/preview `?dev=1` bypass remains available. Matching paper/playable
octaves are required; unsupported mixed settings show a recovery message.

`createChromaticKeyProducer` differences complete snapshots into note-on/off,
adds starting MIDI pitch and uses fixed velocity 0.2. It reuses LiveSession,
NoteSession, AudioWorklet, MIDI recording, count-in and accepted-pitch feedback.
No frontend landmark model is loaded. Calibration and video replay now use
the same worker; legacy modules were removed in #297. This is software integration,
not physical accuracy or latency verification.

## Frontend cleanup (#297)

Calibration uses the production camera worker for an explicit empty-keyboard
capture and saves version 2 setup metadata without landmarks. Home owns a new
worker after navigation and still needs Set reference. Offline replay sends
ordered frames through `visionReplay.ts` to the same worker and requires version
2 chromatic sidecars with an explicit referenceFrame. The old MediaPipe,
OpenCV.js and TypeScript contact/shadow stack has been removed. See
[calibration](calibration.md) and [replay](cv_video_tests.md).
