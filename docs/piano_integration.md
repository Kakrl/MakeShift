# One-octave browser piano integration

Part of [#28](https://github.com/Kakrl/MakeShift/issues/28), built on #24.
The supported sheet has eight white keys, MIDI 48, 50, 52, 53, 55, 57, 59, 60
(C3–C4 in standard MIDI notation). Calibration must match the existing fixed
layout. Black keys, transposition and expanded layouts remain #25/#36.

## Playing the current preview

Calibrate with the printed sheet, keep all four markers visible, and return to
the home page. Enable audio with Play and wait for the count-in. Playing also
records a take. Pause releases notes and excludes the pause/count-in from the
take; Resume treats held keys as fresh presses. Stop closes the take for MIDI
export. Restore tracking and select Play after an interruption.

Highlighted keys now represent accepted musical events. A fingertip over a key
while stopped does not highlight it as sounding. The preview detector still
uses polygon overlap, which can trigger on hovering; it is not intentional
contact recognition. Live preview velocity is fixed at 0.8. Calibrated contact,
finger-speed velocity and jitter tuning remain #34/#29. Do not treat this
preview as completed physical piano detection.

## Shared lifecycle

`createKeyEventProducer` maps supported key indexes into #86 events, preserves
input velocity, suppresses held duplicates and allocates fresh press identities
on repress. Each producer captures its session ID so an old callback cannot
adopt a restarted session. Invalid velocity fails closed through the contract.

`LiveSession.receive` gates and validates events, then sends audio synchronously.
`connectPianoConsumers` subscribes to accepted history on a deferred task:

- MIDI records the event observation timestamp, not observer delivery time.
  Normalized velocity is multiplied by 100 for midi-writer-js. Session/press
  identity pairs keep simultaneous instances of the same pitch independent.
- Feedback derives active pitches from those same press identities. Releasing
  one of two same-pitch presses keeps that pitch highlighted.
- Terminal release-all clears both consumers. Pause, Stop, interruption and
  unmount drain bounded accepted history before recorder snapshots/state changes,
  so a same-turn press is not lost. Draining never resends audio.

No React render or MIDI observer runs inside audio dispatch. The inherited
camera/overlap producer itself still uses React effects and main-thread CV;
worker ownership and fresh-frame scheduling remain #37. There is no new network
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

The branch starts at #138/#24 head `5d5f0b8`, which includes #136 head `71d44b2`.
Merge `b37db8d` adds #137 head `7c2f77c` and resolves the adjacent inventory
rows by keeping #138's 2.2.15 and #137's 2.2.16. Dependency PRs are unchanged.
This is also the boundary for transplanting only #28 commits after squash
merges: `git rebase --onto origin/main b37db8d feature/28-browser-piano-integration`.
Fetch first and inspect the resulting diff; the dependency merge must retain
both inventory rows. Compatibility checks apply to these exact dependency
heads and resolutions. Later PR edits require another check.
