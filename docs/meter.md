# Configurable meter (#207)

Meter is structured `{ numerator, denominator }`. Product limits are integer
numerator 1-32 and denominator 1, 2, 4, 8, 16 or 32, defined once in
`frontend/src/lib/meter.ts`. These are supported product limits, not musical
validity limits. Defaults and missing legacy metadata use 4/4.

The numerator permits empty/intermediate drafts. Enter or blur commits a valid
pair; invalid input restores the last committed numerator and explains the
restoration in an accessible alert. Escape discards the draft. The denominator
has its own labeled selector. Only committed meters reach persistence or audio.
Playback settings lock during audio startup, count-in, recording and pause;
Stop unlocks them. The beat dots wrap within 240 px, including 32-beat meters.

BPM always means quarter notes per minute. Each displayed/clicked count-in beat
is one denominator note: `(60000 / bpm) * (4 / denominator)` milliseconds.
One measure has exactly numerator intervals; the first click is accented.
Muted metronomes retain the same visual timing. At 120 BPM, 4/4 is 4 x 500 ms,
3/4 is 3 x 500 ms, 6/8 is 6 x 250 ms, 7/8 is 7 x 250 ms and 2/2 is 2 x 1000 ms.
There is no automatic compound/asymmetric grouping or dotted-quarter tempo mode.
The new 6/8 count-in is intentionally half its previous duration.

New takes copy the validated meter. Resume retains that snapshot and excludes
paused/count-in time. Physical note timestamps and the existing quarter-note
128-PPQ tick conversion do not change. MIDI writes the time signature at tick
zero alongside tempo. Local library reload validates meter, rejects malformed
stored libraries and normalizes legacy takes to 4/4; copies isolate take metadata.
The existing version-1 playback-settings key remains compatible: meter is an
additive field, restored independently so bad/missing meter preserves valid
legacy tempo/metronome choices. Blocked storage uses defaults without throwing.

Uploads validate optional meter (legacy omission becomes 4/4); mock and real
API summaries/full recordings preserve it. The shared player shows meter and
quarter-note BPM, and local previews/shared MIDI downloads retain it.
Apply `20261027000000_recording_meter.sql` before deploying the new routes:
they select and insert the new JSONB column. The migration defaults old rows to
4/4 and checks the same numeric bounds. Database application/live round trips
remain pending until verified in a configured environment. No per-note network
work is introduced.

Verification is tracked in the [inventory](../tests/verification_test_inventory.md)
and the [manual workflow report](../tests/manual/2026-10-27_METER-04.md).
Software timer and MIDI-byte tests do not establish physical latency or audible
click timing on hardware.

## Equal click scheduling correction (#232)

`app/audio/countIn.ts` schedules the entire bounded measure at one audio-clock
origin. React display updates and CV callbacks do not trigger individual clicks.
The page independently updates the beat display and completion timer against
absolute monotonic deadlines, skipping stale displays after delays. A late final
callback can still delay recording startup; it never backdates physical notes.
Stop/interruption/pagehide/unmount cleanup stops and disconnects every queued
oscillator. Audio-context resume completes before scheduling; cancellation also
invalidates a pending resume. Digital offline rendering confirms equal intervals;
real camera/audio listening under load remains pending. See the #232 report in
`tests/README.md` and METER-06/METER-07 in the inventory.
