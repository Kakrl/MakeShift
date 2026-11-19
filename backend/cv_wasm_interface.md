# Vision WebAssembly JavaScript interface

The WASM export wraps the current native Vision implementation. Chromatic lookup
lives in `src/CV/ChromaticLookup.cpp`, using the existing frontend physical key
regions and black-key priority. `pressedKeys` contains chromatic offsets from the
leftmost C; the caller adds its starting MIDI pitch. No audio/MIDI events are
emitted. Build instructions and verification are in
[the WASM handoff](../docs/cv_wasm.md); the authoritative declarations are
[`makeshift-vision.d.mts`](src/CV/wasm/makeshift-vision.d.mts).

## Calls and input

```js
import loadVision from './makeshift-vision.mjs';
const api = await loadVision();
const model = api.createVision();
model.setReference(); // Clear piano and show all four markers before next frame.
const result = model.processFrame({ rgba, width, height, octaves: 1 });
const diagnostics = model.getDiagnostics(); // Optional; not needed for normal playing.
model.reset();
model.destroy();
```

| Call | Input | Output / effect |
| :--- | :--- | :--- |
| `loadVision(options?)` | Optional `wasmURL` or `wasmBinary` | Asynchronously loads a runtime exposing `createVision()` |
| `createVision()` | None | New independent reference/anchor state |
| `setReference()` | None | One reference/marker check on the next frame, regardless of automatic deadline |
| `processFrame(frameInput)` | RGBA bytes, width, height, octaves | Synchronous complete result below; advances one frame |
| `getDiagnostics()` | None | Copied last-frame analysis planes, or null when last frame was unready/captured |
| `reset()` | None | Clears reference, homography, anchors, pending checks, timer and diagnostics |
| `destroy()` | None | Frees this instance; repeated destruction is harmless; later calls throw |

`frameInput.rgba` is a tightly packed, row-major, unmirrored RGBA8 `Uint8Array` or
`Uint8ClampedArray`, exactly `4*width*height` bytes. Offset views are supported.
Width/height are integers 1..4096, octaves is 1/2/3. Feed the actual camera frame;
Vision owns marker detection and coordinate-matched INTER_AREA downsampling to
at most 640 pixels on the longest analysis side, without enlargement. Alpha zero
is unavailable shadow evidence; RGB seed rules remain independent of alpha.
There are no external homography, reference image, timestamp or press-state inputs.

Calls on an instance must be serialized. Load once per worker/runtime, then
reuse instances and input storage. Calling `processFrame` twice advances two
frames even when pixels are identical. The wrapper copies input into reusable
WASM memory and returns JavaScript-owned snapshots; callers may reuse input
arrays after return and keep old outputs after subsequent calls or destruction.
No input is detached and no raw heap pointers/views escape. Malformed input
throws a JavaScript error before state changes; processing failures require
reset before continuing. Separate worker messaging may transfer buffers.

## Reference and retention behavior

First capture is manual: clear the piano and call `setReference()`. The next
frame must contain four valid markers, IDs 0/1/2/3. Capture relies on the user's
empty-piano confirmation because reference-relative detection cannot establish
absence of fingers before a reference exists. A blocked request is consumed;
request again to retry now. No independent hand model is introduced.

After first capture, check every 10 seconds on a monotonic clock. Evaluate current
tips/retained presses with the old reference first. Refresh requires all four
valid markers, no active presses and no detected tip inside the newly scanned
piano homography. Outside/clothing/paper-margin detections do not block refresh.
Successful capture replaces reference/homography together, clears anchors and
restarts the interval. The capture frame has no old-reference detections.
Blocked automatic checks keep the old values and retry 10 seconds later; blocked
forced checks leave the automatic deadline intact. No overdue frame backlog is
created. Size/octave changes or reset invalidate the reference/geometry/anchors
and require another manual capture request after the change.

A previous press anchor can match one eligible current fingertip within 25% of
white-key width (5.875 mm), in physical sheet distance. Matches retain the original
anchor and report the current tip Pressed without a new shadow check. Unmatched
old anchors disappear. New detections become anchors for the next frame only.
This is spatial press retention, not anatomical finger tracking.

## Output

All ordinary output points use **input camera pixels**, origin top-left, X right
and Y down, before CSS scaling/mirroring. Apply the same display transform to all
geometry, fingertips and range outlines. Internal analysis coordinates do not
leak into normal drawing output.

| Field | Meaning |
| :--- | :--- |
| `width`, `height` | Original input dimensions |
| `referenceReady` | Compatible reference exists |
| `referenceRevision` | Instance-local safe integer; advances on accepted capture, reset or size/layout invalidation |
| `homographyReady` | Accepted keyboard geometry exists; false before capture/after invalidation |
| `referenceScan` | `{ status: 'idle' \| 'captured' \| 'blocked', reason }`; reason is null, `markers-missing-or-invalid`, `active-presses` or `fingertips-in-piano` |
| `pressedKeys` | Sorted unique integer semitone offsets 0..12*octaves, including final C. C=0, C#=1, D=2. Fixed press anchors determine pitch; multiple anchors on a key collapse to one. This is a complete held-key snapshot, not events or MIDI pitches. |
| `fingertips` | All final candidates, at most 20, each `{ id, point: {x,y}, pressed, state }`; state is `unknown`/`released`/`pressed`; IDs are frame-local |
| `geometry` | Null without accepted homography; otherwise matrices, marker centers, keyboard outline and white-key polygons below |
| `pressRanges` | `{ anchor: {x,y}, outline: Point[] }[]`; fixed anchors and their projected matching-radius rings |

`geometry.frameToSheet` and `sheetToFrame` are row-major 3×3 arrays of nine
numbers. Frame-to-sheet projection is `u=(h0*x+h1*y+h2)/(h6*x+h7*y+h8)`, likewise
for v with h3/h4/h5. `markerCenters` is ordered IDs 0,1,2,3 (top-left, top-right,
bottom-right, bottom-left). `keyboardOutline` and each `whiteKeyPolygons` entry
contain four camera-space vertices in that same corner order. Polygon indices
are white-strip indices only, not chromatic keys. The normalized coordinates
follow [the printed-sheet geometry](../docs/piano_sheet.md).

Before capture, `pressedKeys` and fingertips/ranges are empty and geometry is
null. On capture, return new geometry/revision with empty keys/fingertips/ranges;
detection resumes next
frame. Outside tips are included with `pressed=false`. Unknown maps to false
unless a previous anchor retained the press. During playing, geometry is the
accepted transform, not an unrelated new proposal. Fingertips and press ranges
are not index-aligned and provide no persistent musical-event identities.

Results are complete snapshots, not deltas: absent old anchors are no longer
retained. Callers must release old notes after reset/invalidation or an empty
press result. A blocked refresh still reports normal old-reference detections;
it does not force every key to release. Compare consecutive `pressedKeys` sets
for note-on/off transitions; held keys do not retrigger. Starting MIDI pitch,
velocity, audio/MIDI dispatch, session/frame IDs and worker scheduling remain
frontend work. Lookup uses exact physical regions (23.5 mm white pitch, 13.7 mm
black width, 90/150 black length), with black priority and left-white selection
at shared edges. It does not carry over the old frontend 8-pixel collision
tolerance or landmark contact/velocity logic. Fingertip IDs are unnecessary for
key consumers. Calibration UI is unchanged; saved landmarks cannot seed Vision
and an explicit empty-piano reference is still required.

## Optional diagnostic output

`getDiagnostics()` returns `{ width, height, fingerMask, valid, rawDrop, score }`
for the last ready detection frame. These use **analysis pixels**, index
`y*width+x`. Mask/valid are copied `Uint8Array` planes of 0/1; raw/score are copied
`Float32Array` planes. Raw drop is reference-minus-current encoded luma; effective
score is luma drop on white and percentage loss inside black regions after the
existing inset/noise rules. Invalid samples are not clear-paper evidence.
These large arrays are allocated/copied only when requested, supporting parity
and an optional future browser shadow-class display.

## Verification boundary

Run the same reference/pipeline unit suites natively and under WASM, then compare
identical RGBA frame sequences through the actual public interface in Node and a
browser module worker. Cover homography, masks/scores, contacts/anchors, timers,
blocked refreshes, reset, resizing, independence, input validation and output
ownership. Tolerances and execution evidence are in
[the WASM handoff](../docs/cv_wasm.md) and
[testing guide](../tests/README.md#vision-wasm-export). A successful build or
synthetic parity does not establish physical contact accuracy or end-to-end latency.
