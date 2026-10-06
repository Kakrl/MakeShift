# Calibration result and recovery (#87)

Calibration saves `makeshift.calibration.v1` only after detecting all four sheet
markers and capturing complete hand landmarks in both guided phases. A timer
schedules a capture; it cannot complete a phase. Failed detection offers retry.
The legacy `isCalibrated` flag is ignored, and unloading preserves valid data.

Use the [actual-size starter PDF](piano_sheet.md) for the current one-octave
layout; add extension copies for two or three octaves. Recalibrate when replacing
the print. Select the playable octave count, starting C and actual assembled
paper count in step 1. See the [layout contract](piano_sheet.md#marker-and-application-compatibility).

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
- Layout: 1–3 octaves, leftmost C MIDI integer, and 7 * octaves + 1 white keys.
  C roots are multiples of 12 with the final C at or below MIDI 127: C-1–C8
  for one octave, C-1–C7 for two, C-1–C6 for three. Optional `paperOctaves`
  (1–3) and `paperFitOverride` record paper coverage and explicit override.
  Legacy records without paper fields imply paper matching the selected range.
  The shared `keyboardLayout.ts` contract drives validation, geometry and mapping;
  `makeshift:keyboard-layout:v1` stores the selected configuration. A range
  exceeding declared paper is usable only with an explicit override, which
  extends geometry beyond the paper at the same physical key pitch.
- Contact input revision `landmark-reference-v1`, with one or two complete
  21-landmark hover and rest samples. x/y are normalized frame coordinates;
  z is MediaPipe relative depth, not millimeters or distance from the paper.
  Finite/in-range validation is required. These are captured reference inputs,
  not a trained contact classifier. Identical poses are possible and are not
  proof of contact; intentional-contact inference and thresholds remain #34.

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
The completion action checks the live sheet and camera again before saving.
The fifth depth-position capture now creates the primary calibration result
using that capture's complete rest-hand landmarks plus the earlier hover capture.
It retains the fitted depth model through the completion screen. Start Playing
saves the depth model and validated primary record before navigating, with depth
rollback if the primary write fails. It does not write a legacy completion flag.
Local/other-tab configuration changes cancel pending captures, clear both saved
records and retire playing sessions synchronously; old producers cannot adopt a
new layout or session. A missed marker scan may retain geometry only while its
saved configuration still matches.
No silent in-memory fallback claims that a result was saved.

## Verification limits

See the [inventory](../tests/verification_test_inventory.md) and
[execution record](../tests/README.md#calibration-verification-issue-87).
Simulated DOM/camera tests cover workflow and lifecycle. Carl Xu reported successful completion of the manual webcam/printed-sheet
checklist on 2026-09-28; see the [manual report](../tests/manual/2026-09-27_6.2.2.md)
for the tested scenarios and evidence limits. Browser/device details and the
exact tested commit were not supplied.
The existing marker detector still runs on the main thread; worker migration
belongs to #37. The ten-second marker cadence is not a physical note-latency result.
