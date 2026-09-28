# Calibration result and recovery (#87)

Calibration saves `makeshift.calibration.v1` only after detecting all four sheet
markers and capturing complete hand landmarks in both guided phases. A timer
schedules a capture; it cannot complete a phase. Failed detection offers retry.
The legacy `isCalibrated` flag is ignored, and unloading preserves valid data.

## Version 1 contract

`frontend/src/cv/calibration.ts` owns validation, storage and compatibility.
The result contains:

- Version and coordinate convention: unmirrored decoded-frame pixels, origin at
  top left, x right, y down. Canonical sheet coordinates are the unit square at
  marker centers 0, 1, 2, 3 (top left, top right, bottom right, bottom left).
- Sheet revision `aruco-0-3-white-keys-v1` and four ordered marker centers.
  Homographies are derived from validated corners rather than trusting a stored
  matrix. Quadrilaterals must be convex, positively wound, in frame and exceed
  the minimum cross-product threshold of 0.001 times frame area at each corner.
- Camera device ID, decoded width/height and facing mode. Missing device identity
  fails closed; a camera/browser that does not expose it cannot reuse calibration.
- Layout: octave count, lowest MIDI integer, white-key count. The schema accepts
  one to three octaves and bounded MIDI ranges; the current consumer accepts only
  its implemented eight-white-key layout, MIDI 48–60 (C3–C4). Earlier UI options
  were disconnected from geometry and pitch. #36 owns additional layouts and
  paper-fit behavior; #25 owns pitch mapping. Requirements are not reduced.
- Contact input revision `landmark-reference-v1`, with one or two complete
  21-landmark hover and rest samples. x/y are normalized frame coordinates;
  z is MediaPipe relative depth, not millimeters or distance from the paper.
  Finite/in-range validation is required. These are captured reference inputs,
  not a trained contact classifier. Identical poses are possible and are not
  proof of contact; intentional-contact inference and thresholds remain #34.

## Compatibility and interruption

Every live marker check validates stored data and checks the current camera,
sheet revision, layout and marker positions. Checks run at most every 100 ms
on the existing marker loop. No live frame, missing/invalid markers, a detector
exception, unavailable camera, corrupt storage or incompatible data prevents
playing. Each corner may move by at most 1% of the frame diagonal to allow
marker jitter. This is a provisional geometric tolerance, not an accuracy claim.
Geometry rendering and collision use the same accepted live projection.

Invalidation releases active keys, stops the recording and cancels pending
count-in/audio initialization. Restoring compatible observations permits a new
user-started recording; it never resumes the old one. Changing device, decoded
resolution, facing mode, sheet revision or layout requires new calibration.
Moving the camera or sheet beyond tolerance requires restoring the original
pose or recalibrating. A physically different but visually identical sheet with
the same marker IDs cannot be distinguished by this camera-only contract.

## Persistence failures

Reads, parsing and storage acquisition can fail without crashing the page.
Invalid/unsupported data is never migrated from a boolean or used as readiness.
The home page links to calibration for recovery. A successful new capture
replaces corrupt data. Write failure keeps the completion page open, reports
that browser storage must be enabled, and offers retry through Start Playing.
The completion action checks the live sheet and camera again before saving.
No silent in-memory fallback claims that a result was saved.

## Verification limits

See the [inventory](../tests/verification_test_inventory.md) and
[execution record](../tests/README.md#calibration-verification-issue-87).
Simulated DOM/camera tests cover workflow and lifecycle. Carl Xu reported successful completion of the manual webcam/printed-sheet
checklist on 2026-09-28; see the [manual report](../tests/manual/2026-09-27_6.2.2.md)
for the tested scenarios and evidence limits. Browser/device details and the
exact tested commit were not supplied.
The existing marker detector still runs on the main thread; worker migration
belongs to #37. The 100 ms validation cadence is not a physical latency result.
