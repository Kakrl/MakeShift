# Browser piano integration

Part of [#28](https://github.com/Kakrl/MakeShift/issues/28), built on #24.
The default sheet has eight white keys, MIDI 48–60 (C3–C4). Issue #36 adds
one/two/three-octave white-key layouts, with 8/15/22 keys and a configurable
starting C. The [printed-sheet contract](piano_sheet.md) defines physical
dimensions, overlap, starting-note bounds and paper-fit override. Calibration
must match all selected settings. Black-key contact/pitch mapping remains #25.

## Playing the current preview

Calibrate with the printed sheet, keep all four markers visible, and return to
the home page. Select Enable audio for free play, or Record to enable audio
and begin a count-in. Live playback and highlights continue during count-in,
Pause and recording Stop. Pause closes captured notes and excludes paused and
resume count-in time. Start/resume captures currently held accepted presses
with their identities and velocities, without retriggering audio. Stop closes
the take for MIDI export. Restore tracking and select Enable audio after an
interruption.

Highlighted keys now represent accepted musical events. A fingertip over a key
while stopped does not highlight it as sounding. The preview detector still
uses polygon overlap, which can trigger on hovering; it is not intentional
contact recognition. Live velocity now comes from recent fingertip motion;
calibrated contact and camera-specific tuning remain #34/#29. Do not treat this
preview as completed physical piano detection.

## Finger-speed velocity

`FingerVelocity` measures fingertip displacement relative to the wrist using
landmark x/y and optional z. It converts y to the image-width scale, then
normalizes displacement by the projected wrist-to-middle-knuckle distance.
This makes speed independent of image resolution, uniform hand translation
and hand scale. Units are palm lengths per second; timestamps are monotonic
inference-observation times, not measured sensor exposure times. MediaPipe's
relative z is a motion cue, not calibrated paper distance or physical force
([landmark coordinates](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/ios)).

At contact onset the pipeline consumes the largest speed observed in the past
100 ms. Speeds up to 0.5 palm lengths/s map to soft velocity 0.2; speed increases
linearly to velocity 1 at 8 palm lengths/s, with saturation beyond that. The
history has 24 fixed slots; samples less than 5 ms apart are ignored. Missing
or invalid landmarks, degenerate palm scale, backward time, a gap over 150 ms,
source changes, finger disappearance and session reset discard old history.
Missing usable speed gives a soft 0.2 note rather than a spurious loud attack.
Without z, estimation uses x/y; depth appearing/disappearing starts fresh history.

Velocity is latched for the accepted press, including asynchronous shadow
confirmation, and stays constant through holds and release grace. Each finger
has independent history. For simultaneous contacts on the same key, the onset
uses the strongest contacting finger. A second finger joining a held key does
not retrigger it or change its velocity. Audio receives the normalized value;
MIDI retains the existing integer 1–100 conversion and held-note capture policy.

The mapping is a tunable motion heuristic. Hand rotation, landmark noise,
perspective and lateral movement can affect it. It neither changes contact
classification nor adds a waiting period before audio. Physical dynamics tuning
and a user master-volume control remain separate work.

## Shared lifecycle

`createKeyEventProducer` calls the named `LiveSession.noteOn`/`noteOff` methods
with observation timestamps; LiveSession owns envelopes and sequencing. It preserves
input velocity, maps supported key indexes, suppresses held duplicates and allocates fresh press identities
on repress. Each producer captures its session ID and layout so an old callback cannot
adopt a restarted session. Invalid velocity fails closed through the contract.

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

Hand inference calls the contact-frame handler synchronously before updating
React's landmark snapshot. Contact transitions reach the captured session
producer and audio without waiting for a render; repeated observations within
one React batch retain release/repress transitions. React consumes snapshots
for drawing. The handler is detached on overlay cleanup, and the session still
rejects stale producer identities. Standalone overlays without the handler ref
retain their prop-driven contact effect.

No React render or MIDI observer runs inside audio dispatch. CV remains on the
main thread except for shadow segmentation; worker ownership and fresh-frame
scheduling remain #37. There is no new network
dependency in note delivery: the existing local AudioWorklet renders sound.

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
