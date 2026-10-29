# Live playing readiness (#24)

`frontend/src/events/liveSession.ts` owns readiness independently of React.
The home page prepares audio from Enable audio (or Record) and immediately opens
a fresh #86 `NoteSession`. Start/resume count-ins synchronously gate live input (#205), including audio startup. Camera, calibration and contact tracking continue.
The CV coordinator calls `session.noteOn` / `session.noteOff` with the captured
session identity, press identity and note values. These methods construct the
versioned envelope and sequence internally, then use the same validated
`receive` boundary as external events. Use one producer API per session;
do not mix local methods with an independently sequenced external producer. Gate checks and audio dispatch are
synchronous; no render or MIDI callback authorizes audio. Deferred MIDI and feedback consumers
run only after accepted dispatch, retaining observation times and press identities.
Broader recording verification remains #88.

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
Stop is idempotent. Readiness loss only interrupts starting, ready or playing
sessions; idle observations preserve stopped/interrupted/error states. Fresh
tracking after readiness loss refreshes stopped/interrupted guidance without
automatic playback. Audio-start errors retain their retry guidance. Pending startup completions cannot revive stopped sessions.
Old-session events are rejected even after restart. Pause preserves live audio
and the paused MIDI take; Resume uses a MIDI count-in without reinitializing audio.
Held notes are retired at count-in entry and require release plus a fresh press after completion. Interruption closes the take instead of resuming it automatically.

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
Once a compatible marker observation is received, calibration remains valid
through any number of missed periodic scans while the last good projection is
retained. A complete incompatible marker observation or camera/frame loss still
invalidates it. Hand tracking remains subject to its independent 500 ms
deadline; if tracking expires, a watchdog interrupts. Receive and observation-
refresh paths also check that deadline, so a delayed timer cannot keep or
resurrect a session. Returning observations permit a new user-started session,
never automatic resumption.

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
The UI's single primary status describes the recovery action, with a calibration
link beside that status only when calibration is relevant. Stop is available
while audio initialization is pending.

## Recovery explanations and alignment (#220)

`LiveStatus.reason` and `action` are structured independently of lifecycle state.
The displayed message comes from that reason, including while stopped or already
interrupted. Precedence is backgrounding, calibration validity, camera identity,
decoded dimensions, facing mode, layout, missing markers/geometry disagreement,
tracking failure/freshness, audio recovery, then ready/playing/Enable audio.
An audio startup in progress takes precedence over a previous audio error.
Unavailable camera data never establishes sheet movement. Detector failure
offers Reload tracker; a temporary tracking pause asks the user to keep the
view clear. Recovered tracking or alignment requires explicit Enable audio;
no old session or held notes are replayed. Audio and count-in audio failures
retain their own retry reasons. The generic camera-panel recalibration banner
is removed, avoiding contradictory calibration advice and duplicate status
announcements. The ordinary legend is outside the live announcement region.
Its visible text tells users to allow about ten seconds after realigning and
to select Enable audio once ready; the wait is not limited to screen-reader copy.

The camera overlay compares saved and last complete scan sheet-reference
outlines, with solid/dashed strokes and a text legend. These are marker-center
quadrilaterals, not paper edges or a piano footprint. Both use unmirrored frame
pixels, the same cover crop and the same display mirroring as the video.
The saved outline is never replaced by a disagreement. The current outline is
hidden after a missed scan or ten seconds, and is explicitly labelled as the
last complete scan while shown. A disagreement message describes the last
complete scan, rather than asserting ongoing movement; corners cannot identify
whether the sheet or camera moved. Camera device/dimensions/facing mismatches
hide the comparison and retained key drawing. Missed scans still retain usable
contact geometry and do not themselves interrupt playing. Original 1% diagonal
tolerance, 250 ms acquisition, ten-second marker cadence and 500 ms tracking
deadline are unchanged.

See [#220 verification](../tests/README.md#playing-recovery-and-alignment-issue-220)
and the [dated manual procedure](../tests/manual/2026-10-29_REC-04.md).

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

The session owns calibration compatibility and UI readiness. The marker overlay
uses the compatibility result returned by the session for geometry, and the page
uses `status.canStart`. Audio token mapping is shared with `createAudioSession`;
`LiveSession.attach()` retains ownership of its invalidation subscription.
