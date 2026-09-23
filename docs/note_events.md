# Shared note events and sessions

Issue [#86](https://github.com/Kakrl/MakeShift/issues/86). The contract lives in
[noteEvents.ts](../frontend/src/events/noteEvents.ts);
[NoteSession](../frontend/src/events/noteSession.ts) validates and dispatches it.
Detection, audio, recording and visual feedback share these events. Coordinates,
calibration models, synthesis and MIDI file generation are outside this module.

## Wire schema

Every event has `version: 1`, a nonempty `sessionId` (at most 128 characters),
positive safe-integer `sequence`, and finite nonnegative `timestampMs`.
`NoteSession.start()` generates a fresh UUID; consumers must not invent or reuse
session IDs. The worker receives that identity in the session setup message.

| type | Additional fields | Meaning |
| :--- | :--- | :--- |
| note-on | `pressId`, `pitch`, `velocity` | Begin a distinct physical press |
| note-off | `pressId`, `pitch` | End exactly that press, with its original pitch |
| release-all | none | Immediately clear every press and retire the session |

`pressId` is a positive safe integer, strictly increasing for each new note-on
within a session. It is never reused, including after release or voice stealing.
`pitch` is an integer MIDI note in 0–127. `velocity` is finite and in (0, 1];
zero is invalid, not an implicit note-off. Sequence numbers start at 1 and
increase by exactly one for every event, including releases. One producer owns
ordering. Multiple detection sources must be combined before assigning sequence
numbers. Events with an equal timestamp are allowed, for example a chord.

`parseNoteEvent(unknown)` copies validated fields into a frozen value. Additional
fields are ignored, unsupported versions and malformed values are rejected.
The TypeScript type alone is not validation: pass message data through `receive`.
Boundary inputs are ordinary structured-clone data, not arbitrary objects with
accessors. Release-all carries no pitch or press identity.

## Ordering, state and recovery

- Inactive or old-session events are ignored. A valid event with an already
  consumed sequence is ignored as a duplicate/late delivery.
- A sequence gap, decreasing timestamp, future timestamp, reused press ID,
  mismatched/unknown release or capacity overflow interrupts the session.
  A malformed message on the dedicated input channel also interrupts it.
  This deliberately fails closed: silently losing a release could hold a note.
- A new press on the same pitch has its own identity. Releasing one finger does
  not release another. Audio may steal a voice, but retains press-specific
  releases; a stolen press's late release cannot affect its replacement.
- Audio synthesis has ten voices; the session tracks at most 128 physical
  presses. Its bound protects state even if a producer is faulty.
- Start creates a fresh identity and resets sequence/press high-water marks.
  Starting while active first stops the old session. Stop, reset, interruption,
  and incoming release-all clear active presses and retire the old identity.
  Reset then starts a fresh session. No old queued input is replayed.
- Call stop/interrupt on calibration/configuration change, tracking loss,
  camera stop, navigation or background interruption. Revalidate readiness
  before starting again (#24). A stopped session cannot be resumed by a note.
- Audio rejection or exception interrupts the shared session. All terminal
  notifications tell every consumer to clear its held state. Stop is idempotent.

Return values from `receive` distinguish accepted, stale, duplicate, invalid,
and interrupted input. Accepted denotes dispatch, not verified audible output.
The timestamp of a locally generated release-all is at least the last event time.

Visual feedback should retain a set of press IDs per pitch, highlighting until
the final press ends. Standard single-channel MIDI cannot represent independent
same-pitch voices reliably: #88 should retain each press but emit a pitch's first
note-on (using that press's velocity) and final note-off. This avoids ending the
remaining finger prematurely. Recording pause/resume, held-note policy and file
generation remain #88; this change does not retrofit the legacy pitch-only recorder.

## Clocks

`timestampMs` is observation/event time in milliseconds relative to the main
window's `performance.timeOrigin`, not wall-clock Date.now() and not delivery time.
Start rejects events observed before that session began. Producer timestamps
must be monotonic; frame timestamps are not measurements of physical contact or
sensor exposure.

A worker may send its local performance timestamp. Capture its `timeOrigin`
once during worker setup, then call `receive(data, { sourceOriginMs,
mainOriginMs })`. Conversion is `sourceTimestamp + sourceOrigin - mainOrigin`;
the normalized event is the only version delivered to consumers. Main-origin
events use `receive(data)` without conversion. Never normalize the same event
twice or trust an origin attached to every unvalidated event. The delivered
`receivedAtMs` comes from the main monotonic clock and remains separate. Queue
delay does not rewrite source time.

For audio, anchor a running context with a near-simultaneous pair of
`performance.now()` milliseconds and `context.currentTime` seconds.
`AudioClock.toSeconds` maps by `anchorAudio + (eventMs - anchorMain) / 1000`,
clamping late events to the current audio time. `suspend()` invalidates that
mapping; `resume()` takes a fresh pair after every context resume/recreation.
The pair has sampling uncertainty; it does not measure speaker/device latency.
The present BrowserAudio adapter dispatches immediately, so late events play at
the next available render quantum with no fixed look-ahead or future-event queue.
Future source timestamps are rejected.

For MIDI, `toRecordingMilliseconds(eventMs, startMs, excludedPausedMs)` returns
nonnegative recording-relative milliseconds. At 128 ticks per quarter note,
ticks are `round(milliseconds * 128 * BPM / 60000)`. The recording owner supplies
only paused duration preceding the event, ignores events during its paused
segments, and decides how held notes close/reopen (#88). Delayed delivery does
not move an event later in the recording. A new recording uses a new start anchor.
Tests cover known positive/negative worker offsets, delayed delivery, audio
suspend/reanchor, recording reset and explicit excluded pause time.

## Dispatch and integration

Audio runs synchronously before any observer and without a React state update.
MIDI/feedback subscribers run in a later task, receive frozen `Delivery` values,
and cannot prevent audio dispatch by throwing. Heavy MIDI serialization should
still run outside the main thread: a later task cannot preempt an observer that
blocks the JavaScript event loop. This is ordering isolation, not a hard real-time
guarantee.

The observer backlog is bounded at 256 deliveries. Overflow retires the session
and replaces pending events with release-all. Normal stop/restart preserves
already accepted observer history followed by release-all, then fresh session
events, so recording does not lose the final notes. This deferred history never
reenters audio dispatch. Extreme stop/start floods can also overflow the queue;
subscribers must clear all held state on any release-all, even if they never saw
that session. Overload can truncate recording history and requires a new session.
Subscribe before starting. Let the terminal notification reach recording consumers
before unsubscribing during teardown; dispose does not synchronously drain observers.
Consumer callbacks
must not synchronously produce another input event.

Use ordinary `postMessage`/`MessagePort`; there is no shared memory requirement.
The worker's frame scheduler must independently bound pending frames (#37);
the session bound cannot cancel messages already queued by an uncontrolled
producer. Sequence gaps are the recovery signal if a transport drops messages.

```ts
import { BrowserAudio } from "../app/audio/audioEngine";
import { createAudioSession } from "./audioSession";

const audio = new BrowserAudio();
await audio.initialize(); // invoked from the user's Enable/Play gesture
const bridge = createAudioSession(audio);
const unsubscribe = bridge.session.subscribe(({ event, receivedAtMs }) => {
  // MIDI and visual consumers receive the same press/session identities.
  // Use event.timestampMs for musical timing; receivedAtMs is diagnostic.
});
const sessionId = bridge.session.start();
// Send sessionId and main performance.timeOrigin to the detection worker.
// worker.onmessage = ({ data }) => bridge.session.receive(data, workerClock);
// On stop: bridge.session.stop(); let consumers receive the terminal event.
// After terminal delivery: bridge.dispose(); unsubscribe(); await audio.close();
```

One bridge owns one audio instance. Do not mix its notes with legacy direct audio
calls. The adapter maps shared press IDs to audio-private tokens and propagates
suspension, overload, close and processor failure back into shared interruption.
After an emergency reset, audio rejects notes until its existing bounded queue
is acknowledged; an early restart fails closed and requires a fresh session.
The private worklet command format is an implementation detail, not a second
public musical schema. Existing pitch-only CV calls and the Audio check page
remain compatible. Wiring live detection, readiness and recording to this shared
boundary belongs to #34/#24/#28/#88.

## Verification

`tests/frontend/noteEvents.test.ts` covers boundary validation, event ordering,
duplicates, repeated pitches, lifecycle, stale input, bounded recovery,
deferred observer isolation, clocks, and FIFO structured cloning through a real
Node MessageChannel. `browserAudioLifecycle.test.ts` adds shared-session tests
using the production BrowserAudio adapter with mocked browser device objects.
The Node port test is not a browser worker/frame scheduler test. Existing offline
DSP and production browser smoke tests remain separate. See the
[verification inventory](../tests/verification_test_inventory.md) for requirement
mapping and [execution record](../tests/README.md#shared-event-verification-issue-86).
No camera accuracy, physical latency, complete MIDI lifecycle or deployed
cross-browser result is claimed.
