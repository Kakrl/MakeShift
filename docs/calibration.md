# Vision setup calibration (#87, #297)

Calibration has three guided steps: keyboard setup, lighting, and an explicit
empty-keyboard reference capture. The page uses `VisionCameraPipeline` and the
same module worker as Home. MediaPipe, OpenCV.js, hand poses and hand-depth
calibration are no longer part of the frontend.

## Guided flow

1. Select 1–3 playable octaves, the starting C, and assembled paper coverage.
   Named profiles can save, load, rename and delete these settings. Profile
   corners are reference information and never bypass a new capture.
2. Check lighting against the existing mean-luminance guidance. This is image
   brightness, not a lux measurement or a guarantee of detector accuracy.
3. Show all four markers, remove hands and other objects, and select **Capture
   reference**. Advance only after Vision accepts the capture and the frontend
   validates its camera, layout and ordered marker geometry. A blocked request
   offers retry; a worker failure offers **Reload tracker**.

The first reference relies on the user's empty-keyboard confirmation. Vision
cannot independently prove that its first reference contains no fingers.
Capture, reference updates and processing follow the [WASM contract](../backend/cv_wasm_interface.md).
Vision currently accepts one octave parameter, so paper and playable octave
counts must match. An overridden paper mismatch can still be represented in
layout preferences, but Vision rejects capture for that configuration.

Select **Next Step** to review, then **Start Playing** to save and return Home.
The review screen says setup is validated, not that it has already been saved.

## Saved setup versus live reference

`frontend/src/cv/calibration.ts` validates `CalibrationResult` version 2, stored
under `makeshift.calibration.v2`:

- Coordinate convention: `unmirrored-frame-pixels/marker-unit-square`.
- Sheet revision `aruco-0-3-white-keys-v1` and marker centers ordered 0/1/2/3
  (top-left, top-right, bottom-right, bottom-left).
- Camera device ID, decoded frame dimensions and facing mode.
- Keyboard layout, starting MIDI note and paper configuration.
- Detector revision `vision-reference-v1`.

The record contains no hand landmarks, depth models or reference-image bytes.
Validation checks finite in-frame corners, positive convex winding, minimum
area, a usable transform, camera identity and supported layout. Only recognized
fields are retained. Storage and parse failures return an unavailable result.

A reference image and press anchors belong to one Vision instance. Leaving
calibration destroys that worker. **Home must capture its own reference:** clear
the keyboard, select **Set reference**, then **Enable audio**. Reload, camera
loss/change, reset and layout changes also require a new live reference.
Persisted setup alone never makes tracking or audio ready.

## Compatibility and recovery

Home compares the saved camera/layout and marker geometry against the accepted
Vision geometry. The existing 1% frame-diagonal corner tolerance remains a
provisional jitter allowance, not a physical accuracy claim. Vision retains
its old reference/geometry on a blocked periodic refresh; returned geometry is
the accepted reference geometry, not a fresh independent marker observation.
Automatic checks run on Vision's monotonic clock every ten seconds. Sheet
movement may therefore remain undetected between successful checks.

A successful reference revision clears the producer's old key snapshot.
Camera/source loss, stale results, worker errors and configuration invalidation
release held notes and reject old-session input. Audio activation remains a
separate user action. MIDI and feedback consume the accepted events after audio.

Returning to an earlier calibration step drops the captured setup. Camera and
layout are revalidated before saving; backgrounding clears the pending result.
Keyboard-setting notifications discard pending captures and restart setup.
Storage failure keeps the review screen open with retry and restart actions.

## Older browser data

Version 1 landmark records and `depthCalibrationLines` cannot seed Vision and
are not migrated into a ready state. Users calibrate again. Layout changes
remove both old keys and the current setup record; no global storage clear is
performed. Named profiles and recordings retain their existing formats.

## Verification

The workflow tests cover explicit capture/retry, invalid geometry, persistence
failure, camera/configuration changes, stale callbacks, background invalidation,
worker reload and profiles. Geometry/storage and live-session tests retain
compatibility and note-release coverage. See the [inventory](../tests/verification_test_inventory.md)
and [current execution record](../tests/README.md#frontend-cv-cleanup-297).
Synthetic tests do not establish physical contact accuracy or acoustic latency.
