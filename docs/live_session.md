# Live playing readiness (#24)

`frontend/src/events/liveSession.ts` owns readiness independently of React.
The home page prepares audio from Enable audio (or Record) and immediately opens
a fresh #86 `NoteSession`. Recording count-in does not delay live playback.
The CV coordinator calls `session.noteOn` / `session.noteOff` with the captured
session identity, press identity and note values. These methods construct the
versioned envelope and sequence internally, then use the same validated
`receive` boundary as external events. Use one producer API per session;
do not mix local methods with an independently sequenced external producer. Gate checks and audio dispatch are
synchronous; no render or MIDI callback authorizes audio. Recording callbacks
run only after accepted dispatch. Full event-time MIDI migration remains #88.

## State transitions

| From | Input / condition | To / action |
| :--- | :--- | :--- |
| stopped, interrupted, error | Enable audio or Record with fresh compatible calibration and tracking | starting; initialize/resume audio |
| starting | initialization succeeds, same request, readiness still valid | ready; activate live playback |
| starting | initialization rejects | error; show Enable audio retry action |
| ready | activation requested, audio ready and observations fresh | playing; new UUID, reset sequence and press identities |
| starting, ready, playing | invalid calibration, detector failure, expired observations, background | interrupted; cancel startup, retire identity, release notes, close recording |
| ready, playing | audio suspension, close, processor failure or overload | interrupted; release and offer Enable audio retry |
| playing | malformed/out-of-order current input or audio rejection | interrupted; shared #86 fail-closed policy |
| playing | recording Pause / Stop | playing; pause / close MIDI take, keep sound active |
| starting | Stop recording | stopped; cancel pending startup |
| any | navigation/unmount or explicit session stop | stopped; cancel startup and release notes |
| interrupted/error | compatible observations recover | stays interrupted/error; Enable audio or Record required |

Repeated Play while starting/playing and play-before-ready are rejected.
Stop is idempotent. Pending startup completions cannot revive stopped sessions.
Old-session events are rejected even after restart. Pause preserves live audio
and the paused MIDI take; Resume uses a MIDI count-in without reinitializing audio.
Held notes are captured at start/resume boundaries without retriggering sound. Interruption closes the take instead of resuming it automatically.

## Calibration and tracking policy

The controller validates the complete #87 result against the current camera,
marker corners and implemented layout. A boolean never authorizes playback.
Changes to a valid calibration result also retire the old session. Camera,
sheet or layout incompatibility needs restoration of the original configuration
or recalibration; see [calibration recovery](calibration.md).

A successful hand inference on a newly decoded frame refreshes tracking. An
empty successful result means no hands and releases keys through normal
transitions; it is not a detector failure. Explicit inference failure interrupts
immediately and offers reload. Successful hand inference must be younger than 500 ms.
Compatible marker observations expire after 10.5 seconds, allowing the merged
#136 ten-second marker cadence plus 500 ms scheduling slack. If either stops arriving, a watchdog
interrupts; receive and observation-refresh paths also check the deadline, so
a delayed timer cannot keep or resurrect a session. Returning observations
permit a new user-started session, never automatic resumption.

The 500 ms watchdog is a provisional stale-input safety bound, not contact
debounce or a measured physical latency claim. Browser scheduling can delay the
watchdog. Sheet incompatibility interrupts at the existing marker check cadence
(up to ten seconds plus scheduling). Expensive CV still runs on the main thread
pending #37. The existing overlap detector remains a prototype; this gate does
not establish intentional contact (#34), accuracy (#39) or latency (#30).

## Browser recovery

Visibility loss and pagehide retire the session and invalidate observations.
Return requires fresh observations and Enable audio or Record. Route unmount releases sound and
closes the recorder and count-in context. The shared browser synthesizer remains
reusable for the Audio check route. Audio startup failure offers Enable audio retry;
audio interruption closes the active take and requires reactivation through Enable audio or Record.
The UI's status text describes the recovery action, with a calibration link in
the camera panel. Stop is available while audio initialization is pending.

## Verification and stacked delivery

See the [inventory](../tests/verification_test_inventory.md#live-session-readiness-24)
and [local execution](../tests/README.md#session-readiness-verification-issue-24).
Unit and simulated page tests use mocked audio. Carl Xu reported all manual
session-readiness checks passing on 2026-09-28, including physical calibration
loss and audio interruption/recovery; see the
[manual report](../tests/manual/2026-09-28_2.1.6.md). Browser/device details and
the exact tested commit were not supplied. Results are user-reported; independent
review and quantitative latency/accuracy verification remain separate.

PR #136 merged with its ancestry retained. PR #138 incorporates that main
branch, preserving independent playback and the ten-second marker cadence.
The 2026-09-28 manual report predates this reconciliation; physical/manual
verification of the updated behavior remains pending.
