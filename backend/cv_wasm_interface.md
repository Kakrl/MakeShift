# Proposed Vision WebAssembly JavaScript interface

Status: **design contract; bindings and WASM build are not implemented yet**.
Native Vision now owns resizing, marker detection, homography, reference capture
and fingertip/contact processing. Printed chromatic-key lookup and the compact
JavaScript output remain proposed. JavaScript supplies camera
frames and the printed octave count, then draws the results and handles music.
The [native Vision owner](../docs/cv_pipeline.md) takes a native RGBA `cv::Mat`
and octaves. Its inner Pipeline retains an explicit reference setter for tests;
current key lookup remains white-strip only.

## Calls and input

```ts
const vision = await loadVision(); // Proposed asynchronous module loader.
const model = vision.createVision();
model.setReference();              // User requests the first reference capture.
const result = model.processFrame(frameInput);
model.reset();
model.destroy();

type FrameInput = {
  rgba: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  octaves: 1 | 2 | 3;
};
```

| Call | Effect |
| :--- | :--- |
| `createVision()` | New independent instance, initially waiting for user-requested reference capture |
| `processFrame(frameInput)` | Synchronously process one camera frame; perform a requested/due reference check; return the complete current result |
| `setReference()` | Request one reference/marker scan on the **next supplied frame**, without waiting for the 10-second interval; no external image or homography arguments |
| `reset()` | Clear reference, homography, press anchors, pending requests and refresh timer; require `setReference()` again |
| `destroy()` | Free instance/buffers; repeat destruction is harmless; other calls after destruction throw |

Each instance processes calls sequentially. Pixels are tightly packed, row-major,
unmirrored RGBA8, exactly `4*width*height` bytes, with positive integer dimensions.
Use the actual camera-frame resolution. Vision detects markers on that input,
then internally creates coordinate-matched analysis/reference images with the
existing INTER_AREA resize, aspect ratio preserved, longest side at most 640,
and no enlargement. JavaScript does not supply analysis dimensions, homography,
reference pixels, press state, or detector thresholds. No input crop/rotation
is inferred; callers must keep the camera coordinate convention consistent.

## Reference capture rule

**First capture is explicit.** Before a reference exists, the user clears the
paper and calls `setReference()`. Vision scans the next frame for all four valid
markers (exactly one each of IDs 0/1/2/3). If valid geometry is found, it captures
that same frame as the empty reference and starts the refresh timer. Otherwise,
the request is reported blocked; the user can request another attempt.

The first capture relies on the user's empty-paper confirmation: the current
reference-relative fingertip detector cannot establish absence of fingers before
it has a reference. Vision must not interpret “detector unavailable” as “zero
fingertips.” No independent hand model is required by this proposal.

**After the first successful capture**, attempt a refresh every 10 seconds,
on the next available frame. Capture only when all three conditions hold:

1. No active presses remain for the current frame, including retained anchors.
2. No fingertips are detected within the piano sheet homography.
3. All four required markers are visible and form valid geometry in that frame.

Evaluate current fingertips/presses with the existing reference before replacing
it. Check fingertip points against `withinHomography` on the newly scanned piano
geometry, using the same playable-key bounds as detection. Outside points,
including paper margins or clothing detections, do not block refresh. Marker
and occupancy checks use the candidate capture frame. Replace reference and
homography together; a successful capture clears anchors and advances the
reference revision. Never combine a new homography with an old reference.

If a refresh is blocked, keep the previous valid reference/geometry. The next
automatic attempt is 10 seconds after that check; no catch-up frame queue is
created. Use an internal monotonic clock, starting at the first successful
capture. A successful capture restarts the interval. Calling `setReference()`
after startup requests an extra attempt on the next frame, subject to the same
three conditions; a failed forced attempt leaves the automatic schedule intact.
It forces the check, not capture of an occupied frame.

A frame-size or octave-count change invalidates reference/geometry/anchors and
returns to first-capture behavior. The user must request a fresh capture. Camera
replacement, sheet movement and other configuration invalidation must likewise
reset the instance; marker-motion monitoring between checks is not specified yet.

## Output

All returned drawing coordinates use **input camera pixels**: origin top-left,
X rightward, Y downward, before any mirrored/CSS display transform. Vision scales
internal analysis fingertips back into this coordinate system.

```ts
type Point = { x: number; y: number };
type Quad = [Point, Point, Point, Point];
type Homography = [number, number, number, number, number,
                   number, number, number, number]; // Row-major 3x3.
type KeyId = number; // Chromatic index, leftmost printed C = 0.

type VisionResult = {
  width: number;
  height: number;
  referenceReady: boolean;
  referenceRevision: number;
  homographyReady: boolean;
  referenceScan: {
    status: "idle" | "captured" | "blocked";
    reason: null | "markers-missing-or-invalid" | "active-presses"
                 | "fingertips-in-piano";
  };
  fingertips: Array<{
    id: number;              // Frame-local candidate ID, not anatomical identity.
    point: Point;            // Current fingertip, not the fixed press anchor.
    pressed: boolean;
    key: KeyId | null;        // Pressed key; null when not pressed.
  }>;
  geometry: null | {
    frameToSheet: Homography;
    sheetToFrame: Homography;
    markerCenters: [Point, Point, Point, Point]; // IDs 0,1,2,3 in order.
    keyboardOutline: Quad;
    keys: Array<{ id: KeyId; kind: "white" | "black"; polygon: Quad }>;
  };
  pressRanges: Array<{ anchor: Point; outline: Point[] }>;
};
```

- `fingertips` contains **all final fingertip candidates**, including outside
  points with `pressed=false, key=null`. This is the existing candidate detector,
  not a full 21-landmark hand model. Without a reference, it cannot produce these
  candidates: return an empty list and `referenceReady=false`.
- A retained press still follows the agreed one-to-one, fixed-anchor rule. The
  current tip is reported Pressed without a new shadow check; key identity is
  determined from the **retained anchor**. A new press uses its newly accepted
  point. Missing anchors disappear. Unknown contact evidence maps to
  `pressed=false` unless a valid anchor match already retained the press.
- Key IDs run from 0 through `12*octaves`, including the last C. At overlapping
  white/black regions, black keys take priority. The same geometry must drive
  lookup and drawing. The frontend maps key ID to its configured starting MIDI
  pitch; Vision does not need a starting pitch or emit audio/MIDI events.
- `homographyReady` means valid geometry is available for this coordinate frame;
  `geometry` is null otherwise. Native Vision scans only on requested/due checks;
  before first accepted capture geometry is unavailable. During normal playing,
  expose accepted geometry, not a different unaccepted proposal alongside
  old-reference contact results.
- On a successful capture, return the new geometry/revision with empty
  fingertips/press ranges for that capture frame; detection resumes next frame.
  The frontend can draw the homography using marker centers and key
  outlines without reconstructing printed geometry itself. See
  [sheet coordinates](../docs/piano_sheet.md) for the normalized convention.
- `pressRanges` preserves the native viewer's anchor crosses/rings: each outline
  projects the 25%-white-key-width radius (5.875 mm) through the homography.
  The arrays are not index-aligned with fingertips and provide no stable IDs.

## Ownership and lifecycle

Input bytes are copied into reusable WASM buffers during each call; callers can
reuse arrays after return. Vision owns its captured reference. Returned data is
JavaScript-owned snapshots, valid after later calls or destruction. No WASM heap
views or C++ pointers escape. Large mask/score diagnostic planes are not part of
this small production output; a browser shadow-class debug interface can be
specified separately.

Outputs are complete snapshots, not deltas. Before capture or after invalidation,
no presses are reported; callers must not preserve old notes from an empty result.
A blocked refresh preserves normal detections from the old reference; it does not
mean every key released. The reason field reports the first failed capture gate.

Malformed inputs throw a JavaScript error before processing and leave state
unchanged. Processing failures require reset and a new capture. Revisions are
instance-local safe integer numbers. The future worker envelope supplies
session/calibration/frame identities for rejecting stale results; frame-local
fingertip IDs and key IDs do not replace musical press identities.

## Work before export

Native Vision-owned marker scanning/resizing/reference scheduling and the
piano-homography fingertip guard are implemented in `Vision.cpp`. Synthetic
markers and a controlled clock exercise them in `tests/cv/test_reference_policy.cpp`.
Only fingertips inside the newly scanned piano block refresh; outside/margin
points are ignored. Black/white chromatic lookup,
per-contact retained-anchor key assignment, compact drawing output and
JavaScript bindings/WASM remain pending. Complete the interface features before
claiming full contract parity. Include first manual capture, each blocked refresh condition,
10-second timing, forced checks, atomic replacement, layout/dimension invalidation,
key overlap priority, anchor retention/release, coordinate scaling and snapshot
ownership. A successful build alone is not parity or physical accuracy evidence.
