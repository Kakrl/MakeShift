# Native finger and shadow pipeline

The clean implementation on `feature/184-finger-shadow-impl` provides one native
contact pipeline and a side-by-side live camera viewer. Start at
[`Pipeline::processFrame`](../backend/src/CV/Pipeline.cpp); algorithm settings
live in [`Constants.hpp`](../backend/src/CV/Constants.hpp).

## Build and run

Requires CMake, a C++17 compiler, Conan 2 with a default profile
(`conan profile detect` once), and a camera for live review. OpenCV is pinned to
4.12.0, with recipe revisions in `backend/src/CV/conan.lock`. The first build may
compile dependencies. This standalone project does not require PortAudio,
nanobind, or the frontend toolchain.

From the repository root:

```sh
sh backend/run_shadow_camera.sh --camera=0 --octaves=1
# Choose --camera=1 if that is the appropriate device.
```

The left panel shows the live frame and accepted/released/unknown tip circles;
the right panel shows the shadow classes from the same pipeline result.

- **B:** with hands removed and four markers visible, capture the empty reference
  and marker geometry from the same frame. A missing marker leaves geometry and
  black-key processing inactive; the viewer explicitly displays that state.
- **R:** clear reference and geometry together.
- **Q / Escape / close window:** exit and release the camera.

Keep the camera, paper, and lighting fixed. Recapture after changes. B does not
prove that the frame is empty; marker motion is not automatically monitored.
Native or analysis frame-size changes automatically clear the reference.
The viewer does not play notes or write captures/reports.

To run the automated checks after building:

```sh
ctest --test-dir build/vision --output-on-failure
```

For the core without a camera executable, after the dependency installation:

```sh
cmake -S backend/src/CV -B build/vision-core \
  -DCMAKE_TOOLCHAIN_FILE="$PWD/build/vision/conan_toolchain.cmake" \
  -DCMAKE_BUILD_TYPE=Release -DMAKESHIFT_LIVE_CAMERA=OFF
cmake --build build/vision-core --parallel 4
ctest --test-dir build/vision-core --output-on-failure
```

## Module overview

| Module | Responsibility |
| :--- | :--- |
| `Pipeline` | Own the reference/geometry revision and call stages in order |
| `Constants` | Algorithm thresholds, physical dimensions, analysis and capture settings |
| `Homography`, `KeyboardGeometry` | Sheet projection, keyboard eligibility and cached geometric black-key regions |
| `FingerSegmentation` | Positive RGB seeds, localized reverse seeds, frozen exterior-ring refinement |
| `Fingertips` | Connected components, supported lower envelope, plateau/lobe geometry |
| `ShadowMeasurements` | Raw luma drops, effective scores and sample availability |
| `ContactDetection` | Keyboard eligibility and one dark → light → mid decision flow |
| `DarkShadow`, `LightShadow`, `MidShadow`, `ContactGeometry` | Internal contact rules and distal boundary geometry |
| `MarkerDetection` | Native reference-frame ArUco acquisition, outside the core library |
| `ShadowView`, `shadow_camera` | Class rendering and desktop capture/window lifecycle, outside the core library |

The library accepts matched RGBA analysis frames with at most 640 pixels per
side. It does not resize or rectify images. The viewer downsizes native BGR
frames with INTER_AREA, without enlarging, and converts them to RGBA. Native
capture requests 1280×720 at 30 fps with buffer size one; actual delivery depends
on the camera/backend. Capture is synchronous with no application frame queue.
The core performs bounded spatial processing but still allocates per frame;
physical latency has not been measured.

`setReference` owns a clone and caches projected regions. Failed replacement
leaves the previous reference intact. `reset` and frame-size invalidation clear
reference and geometry and advance a revision; unready results contain no
contacts. Frame-local fingertip IDs are not persistent finger/press identities.
Worker scheduling, musical transitions, chromatic pitch mapping, and audio remain
application responsibilities.

## Selected behavior

This implementation follows the preserved native **image-runner band rules**,
including integrated black-key processing. It deliberately gives the camera the
same decision rules. The former camera's absolute-luma gates, legacy mask
methods, trial selectors, report generators, and contour trial are absent.

1. Saturating encoded RGB drops seed fingers when channel spread is at least 30
   and fewer than two drops are below 15. Within projected black rectangles only,
   union the same predicate on reverse brightening.
2. Extract initial fingertip geometry, freeze seeds/candidates, and add one
   exterior 8-neighbor ring from tip-minus-8 when the **current**, sum-normalized
   linear RGB spread is at least 0.25. Original pixels stay; growth does not
   recurse. Re-extract final tips.
3. Measure reference-minus-current encoded luma. White regions require valid
   alpha and reference luma at least 40. Preserve the reference implementation's
   floating arithmetic. Black regions require reference luma at least 5, retain
   the raw drop, and use `100*clamp(drop/referenceLuma,0,1)` only when raw drop
   exceeds 5. A one-pixel horizontal inset suppresses black-edge shadow scores,
   never finger recovery. Regions come from homography, not dark-pixel guesses.
4. Gate proposals by keyboard area when geometry exists. Dark contact uses
   strict score >60, paired upward support/downward veto, support width at least
   two, and same-seed cancellation. Light fallback requires two clear front
   rows across at least two columns plus substantial shadow on both sides.
   Mid fallback evaluates >40 and >20 side floors with the same thin front,
   relative widening, connected-mass and forward-veto rules. Either can accept.
   Failed fallbacks preserve the dark rejection/unknown decision.

Black rectangles follow the printed 13.7×90 mm layout at white boundaries
1/2/4/5/6 per octave, with one to three octaves. Processing remains in camera
coordinates. The black-region pixel-center transform and native-tip mapping
preserve the reference conventions. Keyboard eligibility uses the white-strip
paper footprint; it does not assign chromatic MIDI pitches.

Shadow classes use upper-inclusive score bounds 5, 20, 40, 60, 70, 85, 95:
white, faint blue, cyan, green, yellow, orange, red, dark red. Final fingers take
precedence in dark blue; unavailable samples are black. White scores use luma
units and black scores use percent loss. Rendering never changes decisions.

## Verification and next step

See the [execution record](../tests/README.md#clean-native-cv-pipeline-2026-11-15)
and [inventory](../tests/verification_test_inventory.md#clean-native-cv-pipeline).
Synthetic tests and matched development inputs establish implementation behavior,
not physical contact truth. Camera review, held-out accuracy, and physical
press-to-sound latency remain pending. Under 3% errors and under 50 ms remain
targets, not claims.

After live native review, build WebAssembly from the same core and verify
native/WASM parity before browser-worker integration. Reusing one algorithm
implementation is the reason for the planned WASM build. Preserve bounded fresh
frames, calibration/session invalidation, and independent musical-event dispatch
as described in [the architecture](architecture.md).
