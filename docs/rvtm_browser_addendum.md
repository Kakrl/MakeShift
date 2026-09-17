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
| 2.3 | Under 50 ms physical press to audible output; bounded frames and local events | 2.3.1–2.3.2; #30, #38, #37. Native 2.3.3–2.3.5 remain native only |
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

## Document maintenance

For this browser transition, use this addendum with the inventory as the
repository's RVTM update. External planning documents linked by sdp.md remain
historical sources; their remote contents are not changed by this PR.
Future edits to those documents should incorporate this addendum and retain
requirement IDs. Threshold or scope changes require SDP/RVTM updates and test
mappings under AGENTS.md.
