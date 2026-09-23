# Browser AudioWorklet Synthesis

Issue [#35](https://github.com/Kakrl/MakeShift/issues/35). The native
[voice allocator](audio.md) and [hit queue](audio_events.md) remain unchanged.

## Playback and ownership

The browser owner is in `frontend/src/app/audio/audioEngine.ts`. Call
`initialize()` from a user gesture and await it before delivering notes.
It requests an interactive AudioContext, resumes before awaiting module loading,
and loads `/audio/piano-worklet.js`. Both the worklet and its relative
`synth.js` import are static public assets, without a bundler worker transform.

The Audio check link opens `/audio`: Enable audio, Soft A4, Loud A4,
Ten-note chord, and Stop sound. Each test stops after one second. This page
owns and closes its context on navigation. The existing home-page Play handler
awaits the shared owner's initialization and displays failures with a retry.
Detected notes never initialize or resume audio themselves.

Initialization is shared across simultaneous callers. Loading/resume failures
close resources and reject; a later gesture can retry. Processor failures
disconnect the failed node and permit recreation. Suspension invalidates active
presses, clears voices, and rejects notes until explicit initialization resumes
the context. Resume never replays notes from the previous session. The owner
can be closed even while its module is loading.

## DSP

Ten voice records are preallocated. For MIDI note n, frequency is
`440 * 2 ** ((n - 69) / 12)` Hz at the actual worklet sample rate.
Each voice is a sine wave with peak amplitude `0.08 * velocity`; velocity
must be finite and in (0, 1]. Invalid notes/velocities are rejected rather than
clamped. A threefold velocity gives threefold amplitude (about 9.54 dB).
Ten full-velocity in-phase voices peak at 0.8; the final mix also clamps to
[-1, 1]. Frequencies at or above Nyquist are silent rather than aliased.

A linear 5 ms attack and up-to-40 ms release limit ordinary onset/release
discontinuities. Full ADSR and instrument timbre remain #27. A reset immediately
silences all voices; stealing immediately replaces the oldest active press and
starts a new attack. These emergency transitions can click. Free voices are
reused first. Repeated pitches with distinct press IDs occupy separate voices.
Rendering visits at most ten voices per sample, allocates no buffers or voice
objects, and performs no logging, waiting, network access, or React updates.

## Private worklet transport and shared events

New consumers use the [shared event contract](note_events.md) and
`createAudioSession` adapter (#86). It validates event ordering and timestamps,
retains each press's private audio token, and propagates audio invalidation to
shared consumers. The commands below remain internal immediate FIFO commands
from one owner, applied before the next available render quantum without future
scheduling. They are not a second public musical event schema.

| Command | Fields / behavior |
| :--- | :--- |
| reset | Increasing positive safe-integer session; clear voices and press high-water mark |
| note-on | Current session, increasing positive safe-integer press, integer MIDI note 0–127, normalized velocity |
| note-off | Current session and original press ID; release only that voice |
| release-all | Current session; immediately clear voices, retaining press high-water mark |

The DSP validates messages at the port boundary. Unknown, malformed,
old-session, duplicate or out-of-order note-ons are ignored. A note-off for an
unknown or stolen press is harmless. Owner-generated note tokens retain both
session and press, so delayed releases cannot end a replacement.

The owner admits at most 64 unacknowledged commands and one emergency reset.
Acknowledgements are aggregated once per render quantum. Overflow resets the
session and rejects input until all outstanding messages are acknowledged,
rather than dropping a release and leaving a held tone. No unbounded producer
queue is maintained. Control calls during recovery coalesce into the pending
reset. This bounds this owner's backlog; it is not a security boundary against
other code that deliberately writes directly to the private port.

The legacy pitch-only exports adapt current CV callers by retaining one token
per pitch. They cannot distinguish multiple fingers on one pitch. New consumers
should use `createAudioSession` and the shared schema; full live CV/readiness
wiring remains #24 and #28. Do not mix bridge-owned and legacy calls on one owner.

## Verification

From `frontend/`, run the standard lint, TypeScript, Vitest, contrast and build
checks. `tests/frontend/browserAudio.test.ts` renders the exact production DSP
offline at 44.1, 48 and 96 kHz. Interpolated positive zero crossings estimate
pitch within 0.1 Hz across eleven notes; steady-state RMS allows finite-window
error. Tests cover velocity ratios, attack/release, ten voices, stealing,
slot reuse, buffer continuity, invalid input and session resets.
`browserAudioLifecycle.test.ts` mocks browser ownership to test loading,
suspension, errors, retry, overflow and teardown.

For real browser graph verification, run `npm run build`, then
`npm start -- --hostname 127.0.0.1`, and in another terminal run
`npm run test:audio-browser`. Playwright is pinned in the frontend lockfile.
An installed Edge is the default; set `AUDIO_BROWSER_CHANNEL=chrome` for an
installed Chrome. `MAKE_SHIFT_URL` selects another production server.
The runner checks module loading, nonzero graph samples, soft/loud ratios,
ten-note output, stop, suspension/resume and navigation cleanup.

These tests do not measure speaker audibility, physical press-to-sound latency,
CV detection accuracy, user volume controls, or MIDI behavior. Browser tests
are local, not yet in CI. Record a listening check with the manual template:
enable audio, compare soft/loud A4, listen to the chord, stop, suspend/resume
and navigate away. Do not mark hardware audibility passed from graph samples.
