# Browser Architecture RVTM Addendum

This version-controlled addendum reconciles [issue #85](https://github.com/Kakrl/MakeShift/issues/85)
with the existing requirement IDs in the
[verification inventory](../tests/verification_test_inventory.md).
Read alongside the [SDP](sdp.md), archived V&V/design PDFs and linked planning
documents. It records the browser-runtime interpretation; it does not claim to
edit the external documents or replace unrelated requirements.

## Scope interpretation and traceability

Requirement IDs and numerical targets are preserved. Server-to-browser audio
transport is replaced by local browser event delivery and AudioWorklet playback.
Native tests remain native evidence and cannot prove browser integration.

| Requirement | Browser interpretation | Existing test IDs / delivery |
| :--- | :--- | :--- |
| 1.1, 6.2 | Validated versioned calibration with compatibility/invalidation and guided recovery | 1.1.1–1.1.4, 6.2.1–6.2.2; #87, #8, #24 |
| 1.2, 1.3 | Consistent octave/layout configuration and browser MIDI pitch mapping | 1.2.1–1.2.2, 1.3.1; #36, #25, #76 |
| 2.1 | Intentional press/release detection routed through shared browser events | 2.1.1–2.1.2; #34, #29, #39, #86, #28 |
| 2.2 | Local synthesis, volume and velocity, up to ten voices and release behavior | 2.2.1–2.2.3; #35, #27, #28. Native 2.2.4–2.2.12 retain separate evidence |
| 2.3 | Under 50 ms physical press to audible output; bounded frames and local events | 2.3.1 physical verification remains planned; #30 delivers estimation only (2.3.7); #38 software stages (2.3.2), #37 bounded frames. Native 2.3.3–2.3.5 remain native only |
| 2.4 | Timestamp-aware velocity estimation and browser amplitude response | 2.4.1–2.4.2; #34, #35 |
| 3.2 | Feedback consumes the same press/session state as audio and recording | 3.2.1–3.2.2; #28, #24, #88 |
| 4.1, 4.2 | Browser MIDI recording lifecycle and actual export | 4.1.1–4.1.7, 4.2.2–4.2.3; #88, #65. Persistence test 4.2.1 remains separately planned |
| 5.1, 5.2 | Browser-only playing, HTTPS assets and permissions; no per-note network dependency | 5.1.1, 5.2.1–5.2.3; #89 |
| 5.3 | Application/model readiness measured separately from warm note latency | 5.3.1; #89, #38 |

This addendum is planning, not execution evidence. Existing owners, test IDs,
implementation status, CI status and historical run links stay distinct.
Implementation PRs must extend appropriate rows and add newly numbered tests
where coverage is missing, including session resets, worklet voices, event clocks
and worker overload. Do not claim those tests already exist.

## Measurement rules

Issue #30's revised scope requires reproducible software estimation, explicit
unknowns/assumptions and sensitivity analysis, with no physical manual test as
a completion prerequisite. Its published baseline simulation yields a 47.67 ms
mean and 63.83 ms p95 at 30 FPS under specified timing assumptions; regression
checks preserve both results and threshold exceedances. [Estimator verification](latency_estimation.md)
maps separately to 2.3.7. Physical verification rules below still apply to
requirement 2.3 and test 2.3.1; estimates cannot substitute for that evidence.

- Preserve the under-3% combined false-positive/false-negative target for 2.1.1.
  #39 must define the denominator, ground-truth matching and tolerances before
  tuning. Report scenario-level wrong notes, duplicates, missed releases, stuck
  notes and chords in addition to the aggregate. Keep held-out data separate.
- Preserve the under-50 ms physical latency target for 2.3.1. Report distributions
  and fraction over the target; do not redefine compliance as an average or p95
  without an explicit requirements change.
- Capture a physical reference and output audio on a shared/calibrated timeline,
  document onset detection and uncertainty, and distinguish software estimates.
  A manual stopwatch is not adequate evidence at this scale.
- Record browser, device, frame rate/resolution, output device, sample count,
  p50/p95 and maximum. Separate startup/warm playback and Bluetooth/baseline.
- Keep the existing dynamics criterion in 2.4.2 (fast presses more than 5 dB
  louder than slow presses over ten trials). Velocity implementation does not
  silently weaken it.
- Supported configurations and inability to meet targets must be explicit.
  No test is marked passed based on an architectural choice.

## Octave layouts (#36)

Requirements 1.2/1.3 retain the one-to-three-octave scope. Starting-note semantics
for the printed C-root white-key pipeline are explicit: the leftmost C maps to
the selected C octave, with the shared final C included once. Black-key contact
mapping remains #25. Available starts are bounded so all emitted notes are
MIDI 0–127. The selected range and declared paper coverage are distinct;
override preserves physical key pitch and extends beyond the paper.

Inventory 1.2.1 and 1.3.1 now cover every supported white-key/start combination
through production DSP offline rendering, audio dispatch, recorder and feedback.
Geometry fixtures check actual-size assembly proportions and matching hit regions.
The physical 1.2.2 workflow remains partially verified: jsdom and production
Chromium checks cover warning/override, persistence and invalidation, while
printer/camera/audible checks remain pending in the manual report. Calibration
6.2.3 follows the real five-position depth capture and validates save-before-
navigation, replacing #162's expected failures. Software results establish
neither physical contact accuracy nor sensor-to-sound latency.

## Recording playback extension (#130)

PB-1: play an existing recording at 0.25x–4x speed with pause, seek, stop, and
cleanup on audio interruption. Audio dispatch is independent of React rendering.
The timeline supplies position to future piano-tiles views; their visuals/scoring
remain #131/#132. Existing live-CV accuracy/latency requirements are unchanged.

Inventory PB-1.1–PB-1.5 maps timing, lifecycle, input validation, delayed callbacks,
and production audio-owner integration. Deterministic timer/device fixtures do
not establish audible browser performance or physical latency. Browser timing
measurements and listening evidence remain pending.

## Document maintenance

For this browser transition, use this addendum with the inventory as the
repository's RVTM update. External planning documents linked by sdp.md remain
historical sources; their remote contents are not changed by this PR.
Future edits to those documents should incorporate this addendum and retain
requirement IDs. Threshold or scope changes require SDP/RVTM updates and test
mappings under AGENTS.md.
