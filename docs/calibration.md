# Calibration result and recovery (#87)

Calibration has three guided steps: keyboard settings, lighting and paper
alignment. Start Playing rechecks all four markers, camera and layout, saves
the validated sheet-only result, then navigates home. Home acquires fresh
reference pixels; no MediaPipe hand or depth capture is required. The legacy
`isCalibrated` flag is ignored.

Use the [actual-size starter PDF](piano_sheet.md) for the current one-octave
layout; add extension copies for two or three octaves. Recalibrate when replacing
the print. Select the playable octave count, starting C and actual assembled
paper count in step 1. See the [layout contract](piano_sheet.md#marker-and-application-compatibility).

## Sheet-only version 2 and legacy version 1 contracts

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
- Layout: 1–3 octaves, leftmost C MIDI integer, and 7 * octaves + 1 white keys.
  C roots are multiples of 12 with the final C at or below MIDI 127: C-1–C8
  for one octave, C-1–C7 for two, C-1–C6 for three. Optional `paperOctaves`
  (1–3) and `paperFitOverride` record paper coverage and explicit override.
  Legacy records without paper fields imply paper matching the selected range.
  The shared `keyboardLayout.ts` contract drives validation, geometry and mapping;
  `makeshift:keyboard-layout:v1` stores the selected configuration. A range
  exceeding declared paper is usable only with an explicit override, which
  extends geometry beyond the paper at the same physical key pitch.
- Version2 uses contact model `filtered-directional-shadow-v1` and requires no
  hand landmarks. The storage slot keeps its existing `makeshift.calibration.v1`
  name; the record's own version selects validation. Version1 records with
  `landmark-reference-v1` and valid rest samples remain readable for camera,
  layout and marker compatibility. The current home detector ignores their
  landmark/depth data.

The calibration completion screen reports sheet readiness; the result is only
saved when Start Playing succeeds. Its final marker scan rejects sheet movement
beyond the existing tolerance. Camera/keyboard changes require returning to
paper alignment. No reference pixels are persisted: the home loop uses the
same captured frame for complete marker detection and its analysis reference,
including each successful periodic10-second detection. Complete marker visibility
is deliberately assumed to mean no hands; this remains an experimental
assumption. Missed scans keep the previous reference and geometry.

## Compatibility and interruption

At the start of a camera session, marker detection searches every 250 ms until it
produces a complete, usable geometry. After that first geometry, checks run every
ten seconds, including after a missed check. A miss retains the last good
projection and retries at the next ten-second interval. A later complete,
usable result replaces the cached projection. Camera/source changes or frame
loss reset the cache and begin fast acquisition again. Sheet movement or
removal can remain undetected until a periodic check (up to ten seconds).

Missing or failed marker observations do not invalidate the last compatible
calibration, regardless of how many periodic scans miss. The saved projection
remains usable until a complete observation shows incompatible marker positions,
or the camera/frame session is lost. Each corner may move by at most 1% of the
frame diagonal to allow marker jitter. This is a provisional geometric
tolerance, not an accuracy claim. Geometry rendering and collision use the
same retained live projection; session readiness still gates note dispatch.

Invalidation releases active keys, stops the recording and cancels pending
count-in/audio initialization. Restoring compatible observations permits a new
user-started recording; it never resumes the old one. Changing device, decoded
resolution, facing mode, sheet revision or layout requires new calibration.
Moving the camera or sheet beyond tolerance requires restoring the original
pose or recalibrating. A physically different but visually identical sheet with
the same marker IDs cannot be distinguished by this camera-only contract.

## Playing and recording

After live calibration validation, select **Enable audio** to unlock browser
sound without starting a MIDI recording. Live notes continue during count-in,
recording pauses and after Stop. **Record**, **Pause**, **Resume** and **Stop**
control only MIDI capture. Notes held at the end of a start/resume count-in are
captured from that recording boundary without retriggering their sound.
Calibration invalidation and leaving the page still release live sound.

## Persistence failures

Reads, parsing and storage acquisition can fail without crashing the page.
Invalid/unsupported data is never migrated from a boolean or used as readiness.
The home page links to calibration for recovery. A successful new capture
replaces corrupt data. Write failure keeps the completion page open, reports
that browser storage must be enabled, and offers retry through Start Playing.
The completion action revalidates camera/keyboard settings against the
paper-step snapshot, scans the sheet again, validates the version2 result and
saves it before navigation. Missing markers, moved geometry and blocked storage
leave Start Playing available for retry. No companion depth model is written.
Local/other-tab configuration changes clear saved calibration and retire playing
sessions synchronously; old producers cannot adopt a new layout or session.
No silent in-memory fallback claims that a result was saved.

## Verification limits

See the [inventory](../tests/verification_test_inventory.md) and
[current execution record](../tests/README.md#live-shadow-baseline-integration-2026-11-01).
Simulated DOM/camera tests cover the new workflow and lifecycle. The earlier
hand-calibration flow had this historical report: Carl Xu reported successful completion of the manual webcam/printed-sheet
checklist on 2026-09-28; see the [manual report](../tests/manual/2026-09-27_6.2.2.md)
for the tested scenarios and evidence limits. Browser/device details and the
exact tested commit were not supplied.
The existing marker detector still runs on the main thread; worker migration
belongs to #37. The ten-second marker cadence is not a physical note-latency result.
