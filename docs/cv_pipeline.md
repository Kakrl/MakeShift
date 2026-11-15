# Native finger and shadow pipeline

The clean implementation on `feature/184-finger-shadow-impl` provides one native
contact pipeline and a side-by-side live camera viewer. Start at
[`Vision::processFrame`](../backend/src/CV/Vision.cpp) for native-frame/reference
ownership, then [`Pipeline::processFrame`](../backend/src/CV/Pipeline.cpp) for
detection stage order; algorithm settings
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
the right panel shows the shadow classes from the same pipeline result. Each
active press anchor has a magenta cross and a magenta range outline in both
panels. The outline is a circle on the paper projected through the homography,
so it can appear elliptical/perspective-distorted on screen. Its **radius** is
25% of a white-key width: 5.875 mm (11.75 mm diameter). The center stays fixed
while an associated current fingertip moves; green tip circles still mark the
current fingertip. The range setting is `pressMatchKeyFraction` in `Constants.hpp`.

- **B:** request one reference check on the next frame. Before the first capture,
  clear hands and show all four markers; this confirms empty paper. Later forced
  checks obey automatic occupancy guards. Blocked checks keep the old reference
  and report the reason.
- **R:** clear reference and geometry together.
- **Q / Escape / close window:** exit and release the camera.

Keep the camera, paper, and lighting fixed. Recapture after changes. B does not
prove that the frame is empty; marker motion is not automatically monitored.
Camera dimensions or octave changes clear reference/geometry/anchors; request
capture again after the change. Automatic checks run every 10 seconds after first
capture. The viewer shows the piano key outlines and last reference-check status.
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
| `Vision` | Own native RGBA preprocessing, markers and manual/timed reference policy |
| `Pipeline` | Own accepted reference/geometry revision, anchors and detection stages |
| `Constants` | Algorithm thresholds, physical dimensions, analysis and capture settings |
| `Homography`, `KeyboardGeometry` | Sheet projection, keyboard eligibility and cached geometric black-key regions |
| `FingerSegmentation` | Positive RGB seeds, localized reverse seeds, frozen exterior-ring refinement |
| `Fingertips` | Connected components, supported lower envelope, plateau/lobe geometry |
| `ShadowMeasurements` | Raw luma drops, effective scores and sample availability |
| `ContactDetection` | Keyboard eligibility and one dark → light → mid decision flow |
| `DarkShadow`, `LightShadow`, `MidShadow`, `ContactGeometry` | Internal contact rules and distal boundary geometry |
| `MarkerDetection` | ArUco acquisition within Vision, without camera/window dependencies |
| `ShadowView`, `shadow_camera` | Class rendering and desktop capture/window lifecycle, outside the core library |

`Vision::processFrame(nativeRgba, octaves)` accepts a native RGBA camera image
and owns INTER_AREA analysis resizing (longest side at most 640, no enlargement).
The viewer only captures BGR and converts it to RGBA. The inner `Pipeline` takes
matched analysis images and remains available for synthetic/parity tests.
Capture requests 1280×720 at 30 fps with buffer size one; delivery depends on the
camera/backend. There is no application frame queue. The core still allocates
per frame; physical latency is unmeasured. The camera-free Vision build requires
OpenCV objdetect/core/imgproc; highgui/videoio remain viewer-only. Versions unchanged.

### Reference policy

`Vision::setReference()` requests one attempt on the next supplied frame. There
is no automatic first capture. First capture requires four valid ArUco markers
and trusts the user's empty-paper confirmation: fingertip detection needs an
existing reference. A blocked request is consumed; request again to retry now.

After capture, check every 10 seconds using a monotonic clock. Process current
tips/retained anchors against the old reference first. Refresh requires all four
markers, no active presses and no detected fingertip within the newly scanned
piano homography. The guard uses `withinHomography`, matching the playable piano
bounds used by detection. Fingertips outside those bounds, including printed
margins or clothing, do not block capture. Previous paper footprints are not used
as extra occupancy regions. This detected-tip guard is not proof of an empty scene.

Blocked automatic checks preserve accepted reference/geometry and normal
detection, retrying after another 10 seconds. Failed forced checks do not postpone
the automatic deadline. Success accepts reference/geometry from the same frame,
clears anchors and restarts the interval. The capture frame has
`referenceReady=true` but no old-reference detections; detection resumes next
frame. Size/layout changes and reset clear geometry, pending requests, timer
and anchors, so request B again after the change.

The inner `Pipeline::setReference(image, nativeSize, geometry)` clones the
accepted snapshot and commits cached regions together. Failed replacement
preserves previous values. This remains an internal/test entry point, rather
than the proposed frontend capture API. Frame-local IDs are not anatomical
identities. Musical events, browser session identities, chromatic pitch mapping
and audio remain integration work.

## Selected behavior

This implementation follows the preserved native **image-runner band rules**,
including integrated black-key processing. It deliberately gives the camera the
same decision rules. The former camera's absolute-luma gates, legacy mask
methods, trial selectors, report generators, and contour trial are absent.

1. Saturating encoded RGB drops seed fingers when channel spread is at least 30
   and fewer than two drops are below 15. Within projected black rectangles only,
   union the same predicate on reverse brightening.
2. Extract initial fingertip geometry. Keep only tips passing
   `KeyboardGeometry::withinHomography(Point nativePoint)` as refinement inputs;
   without geometry none are eligible. Freeze seeds/candidates, and add one
   exterior 8-neighbor ring from tip-minus-8 when the **current**, sum-normalized
   linear RGB spread is at least 0.25. Original pixels stay; growth does not
   recurse. Keep the full seed mask, including outside fingers, as occlusion
   evidence. Re-extract final tips; the gate selects fingers, not a pixel crop.
3. Measure reference-minus-current encoded luma. White regions require valid
   alpha and reference luma at least 40. Preserve the reference implementation's
   floating arithmetic. Black regions require reference luma at least 5, retain
   the raw drop, and use `100*clamp(drop/referenceLuma,0,1)` only when raw drop
   exceeds 5. A one-pixel horizontal inset suppresses black-edge shadow scores,
   never finger recovery. Regions come from homography, not dark-pixel guesses.
4. Recheck each final tip with the same `withinHomography` helper before
   matching or contact searches. Outside tips, and all tips without valid
   geometry, return Released. For eligible tips, `alreadyPressed` loops over
   last frame's `prevPressed`: the first anchor in range is consumed once and
   copied unchanged to `nextPressed`. The current tip is reported Pressed and
   skips `detectContacts`. Only unmatched eligible tips run the shadow rules.
   New accepted presses add their own position to `nextPressed`; they cannot
   be inherited by another tip during this frame. Unmatched old anchors are
   discarded when `nextPressed` replaces `prevPressed`.
5. For unmatched tips, dark contact uses
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
paper footprint (inclusive edges), rather than just the marker-center unit
square. Analysis tips are scaled back to native coordinates before either gate.
This prevents missing edge keys beyond marker centers. The helper rejects invalid
transforms and nonfinite points. It does not assign chromatic MIDI pitches.
Full-frame RGB seeds, proposal extraction and shadow measurements remain available
for mask context and the side-by-side class view; the per-tip refinement and
contact searches alone are gated.

Matching is based on Euclidean paper distance with a radius of 0.25×23.5 mm.
Both native points are projected to sheet coordinates, then X and Y differences
are converted to millimeters separately (horizontal marker span depends on
printed octaves; vertical span is 150/(0.9−0.1)=187.5 mm). The display projects
that same physical-radius circle back into the current camera image. Matching
includes the radius boundary and uses fingertip/anchor array order, not anatomical
tracking or nearest-neighbor assignment. `FrameResult::contacts` remains ordered
by the current candidates; `pressedAnchors` contains the retained native points.

Retention is automatic: a nearby eligible fingertip keeps the original press
without rechecking shadows. Release occurs on a frame with no matching fingertip,
or on reference reset/replacement/frame-size invalidation. There is no timeout,
grace period, or shadow-based release check for a matched anchor. A new press
needs normal detection again after its old anchor disappears.

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

The [proposed JavaScript interface](../backend/cv_wasm_interface.md) documents the
frame/reference policy now implemented in native Vision. Chromatic key lookup,
compact JavaScript drawing outputs, bindings and WASM build remain pending.

After live native review, build WebAssembly from the same core and verify
native/WASM parity before browser-worker integration. Reusing one algorithm
implementation is the reason for the planned WASM build. Preserve bounded fresh
frames, calibration/session invalidation, and independent musical-event dispatch
as described in [the architecture](architecture.md).
