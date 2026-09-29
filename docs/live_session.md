# Live playing readiness (#24)

`frontend/src/events/liveSession.ts` owns readiness independently of React.
The home page prepares audio from the Play gesture and opens a fresh #86
`NoteSession` after count-in. The CV coordinator submits versioned events with
session, sequence and press identities. Gate checks and audio dispatch are
synchronous; no render or MIDI callback authorizes audio. Recording callbacks
run only after accepted dispatch. Full event-time MIDI migration remains #88.

## State transitions

| From | Input / condition | To / action |
| :--- | :--- | :--- |
| stopped, interrupted, error | Play with fresh compatible calibration and tracking | starting; initialize/resume audio |
| starting | initialization succeeds, same request, readiness still valid | ready; count-in |
| starting | initialization rejects | error; show Play retry action |
| ready | count-in ends, audio ready and observations fresh | playing; new UUID, reset sequence and press identities |
| starting, ready, playing | invalid calibration, detector failure, expired observations, background | interrupted; cancel startup, retire identity, release notes, close recording |
| ready, playing | audio suspension, close, processor failure or overload | interrupted; release and offer Play retry |
| playing | malformed/out-of-order current input or audio rejection | interrupted; shared #86 fail-closed policy |
| any | Stop, Pause, navigation/unmount | stopped; cancel startup and release notes |
| interrupted/error | compatible observations recover | stays interrupted/error; Play required |

Repeated Play while starting/playing and play-before-ready are rejected.
Stop is idempotent. Pending startup completions cannot revive stopped sessions.
Old-session events are rejected even after restart. Pause retires the live audio
session but preserves the paused MIDI take; Resume uses a new live identity and
count-in. Interruption closes the take instead of resuming it automatically.

## Calibration and tracking policy

The controller validates the complete #87 result against the current camera,
marker corners and implemented layout. A boolean never authorizes playback.
Changes to a valid calibration result also retire the old session. Camera,
sheet or layout incompatibility needs restoration of the original configuration
or recalibration; see [calibration recovery](calibration.md).

A successful hand inference on a newly decoded frame refreshes tracking. An
empty successful result means no hands and releases keys through normal
transitions; it is not a detector failure. Explicit inference failure interrupts
immediately and offers reload. Both compatible marker observations and successful
hand inference must be younger than 500 ms. If either stops arriving, a watchdog
interrupts; receive and observation-refresh paths also check the deadline, so
a delayed timer cannot keep or resurrect a session. Returning observations
permit a new user-started session, never automatic resumption.

The 500 ms watchdog is a provisional stale-input safety bound, not contact
debounce or a measured physical latency claim. Browser scheduling can delay the
watchdog. Sheet incompatibility interrupts at the existing marker check cadence
(up to every 100 ms plus scheduling). Expensive CV still runs on the main thread
pending #37. The existing overlap detector remains a prototype; this gate does
not establish intentional contact (#34), accuracy (#39) or latency (#30).

## Browser recovery

Visibility loss and pagehide retire the session and invalidate observations.
Return requires fresh observations and Play. Route unmount releases sound and
closes the recorder and count-in context. The shared browser synthesizer remains
reusable for the Audio check route. Audio startup failure offers Play retry;
audio interruption closes the active take and requires reactivation through Play.
The UI's status text describes the recovery action, with a calibration link in
the camera panel. Stop is available while audio initialization is pending.

## Verification and stacked delivery

See the [inventory](../tests/verification_test_inventory.md#live-session-readiness-24)
and [local execution](../tests/README.md#session-readiness-verification-issue-24).
Unit and simulated page tests use mocked audio; physical calibration-loss and
audio-interruption checks are [pending](../tests/manual/2026-09-28_2.1.6.md).

`feature/24-session-gating` starts at #87 PR #136 commit
`71d44b2e36801df91210f92260bdb9cc616cd668`. Only #24 changes belong in commits after
that boundary. Calibration computation/schema and synthesizer code are unchanged.
After #136 merges, fetch origin and, from a clean #24 branch, transplant only
these commits if main used squash/rebase merge:

```sh
git rebase --onto origin/main 71d44b2e36801df91210f92260bdb9cc616cd668 feature/24-session-gating
```

For a normal merge retaining the #87 ancestry, ordinary rebase onto origin/main
also works. Review the resulting diff and rerun frontend checks before updating
the PR. This keeps #87 commits out of the final #24 review; it cannot guarantee
no conflicts if #87 receives further edits.
