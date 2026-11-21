# Browser piano integration

Live CV and recording playback now share the sampled stereo piano owner (#210),
using 19 preloaded local Salamander recordings and the selected +6 dB bass
curve. Readiness waits for decoding and worklet preparation. Pitch, velocity,
press/session identities and MIDI capture remain on the existing event path;
playing notes never loads recordings. See [the audio contract and limits](browser_audio.md#sampled-production-piano-and-register-balance-210).

Part of [#28](https://github.com/Kakrl/MakeShift/issues/28), built on #24.
The default sheet has eight white keys, MIDI 48–60 (C3–C4). Issue #36 adds
one/two/three-octave white-key layouts, with 8/15/22 keys and a configurable
starting C. The [printed-sheet contract](piano_sheet.md) defines physical
dimensions, overlap, starting-note bounds and paper-fit override. Calibration
must match all selected settings. Black-key regions now participate in contact
selection and map to chromatic MIDI pitches through the existing audio/MIDI
event interface. Automated and physical verification remain pending; see the
[black-key plan](black_keys_plan.md).

## Playing the current preview

Calibrate with the printed sheet, keep all four markers visible, and return to
the home page. Clear the keyboard, show all four markers, and select Set reference.
After capture, select Enable audio for free play, or Record to enable audio
and begin a count-in. Start/resume count-ins pause piano audio, pedals, MIDI capture
and sounding-key feedback. Contact tracking continues, but held keys require release
and a fresh press after completion. Free play continues during Pause and after Stop.
Pause closes captured notes and excludes paused and resume count-in time. Stop closes
the take for MIDI export. Restore tracking and select Enable audio after an
interruption.

White keys highlight red and black keys highlight blue while their MIDI pitches
are active in the accepted event stream. Highlights clear on release or
interruption and remain off for count-in-suppressed contacts. Black caps are
masked out of the white fill, using the accepted Vision transform for drawing.
Sounding-note labels represent the same accepted musical events. Vision geometry and
press-anchor outlines provide camera feedback separately from accepted pitches.
Count-in suppression still requires release and a fresh press after completion.

Home now uses the native Vision WASM worker, with complete chromatic key
snapshots feeding the existing sessions. Pitch is starting MIDI plus key offset.
Velocity is fixed at 0.2 (MIDI 20); Vision has no motion/force estimate yet.
Matching paper/playable octave counts are required. Version 2 setup calibration is validated separately; Home also requires a
fresh empty-keyboard reference. See [worker integration](cv_wasm.md#frontend-worker-integration).
Physical contact accuracy and end-to-end latency remain unverified.

## Velocity

Vision currently has no physical motion/force estimate. The chromatic producer
uses fixed onset velocity 0.2 (MIDI 20). The former landmark-motion estimator
and its frontend contact pipeline were removed in #297. Shared note events,
recording playback and audio still support variable velocities independently.

## Shared lifecycle

`createChromaticKeyProducer` compares complete `pressedKeys` snapshots and calls
`LiveSession.noteOn`/`noteOff`. Releases precede new presses; held keys do not
retrigger. Pitch is starting MIDI plus chromatic offset. Submission captures the
session ID and timestamp so old worker results cannot adopt a new session.

`LiveSession.receive` gates and validates events, then sends audio synchronously.
`connectPianoConsumers` subscribes to accepted history on a deferred task:

- MIDI records the event observation timestamp, not observer delivery time.
  Normalized velocity is multiplied by 100, rounded to an integer and
  bounded below by 1 for midi-writer-js, including held-note capture. Session/press
  identity pairs keep simultaneous instances of the same pitch independent.
- Feedback derives active pitches from those same press identities. Releasing
  one of two same-pitch presses keeps that pitch highlighted.
- Terminal release-all clears both consumers. Pause, Stop, interruption and
  unmount drain bounded accepted history before recorder snapshots/state changes,
  so a same-turn press is not lost. Draining never resends audio.

Vision results reach the producer and synchronous audio dispatch before React
updates the drawing snapshot. CV runs in the worker; main-thread frame capture
submits only when no frame is pending. No MIDI observer or React render runs
inside audio dispatch. Playing has no per-note network dependency.

## Verification and remaining acceptance criteria

See [local evidence](../tests/README.md#one-octave-integration-verification-issue-28)
and inventory rows 2.1.2 and 3.2.1. Deterministic tests exercise the production
DSP with a simulated audio transport, plus the real page/geometry with mocked
hardware. They do not establish physical contact, hardware audibility or latency.

The [manual checklist](../tests/manual/2026-09-29_2.1.2.md) passed, as reported
by Carl Xu on 2026-09-29. Export initially exposed #140 and passed retest after
the separate [#141 fix](https://github.com/Kakrl/MakeShift/pull/141); PR #139
alone does not contain that fix. Browser/device details, exact tested commit
and individual artifacts were not supplied. Independent review remains pending.
#30/#39 must still supply measured latency and accuracy evidence. Keep #28 open:
manual preview success does not complete intentional-contact or measurement work.

## Dependency merge handling

PR #139 incorporates #138 head `0fecdb5`, including main `4dc41ab` and
PR #136's independent playback and ten-second marker cadence. It retains
#137's navigation cleanup and inventory row 2.2.16. Merge reconciliation keeps
#139's accepted-event consumers and captured producer identity while adopting
#138's named note methods and independent recording lifetime.

#138 remains a dependency until merged. The old `b37db8d` transplant command
is obsolete after this reconciliation. Fetch the actual base after dependency
merges and inspect any new differences before updating the branch again.
The earlier manual report predates this reconciliation; hardware verification
of the combined behavior remains pending.
