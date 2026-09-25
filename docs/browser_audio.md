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
Ten-note chord, and Stop sound. Each test sends note-off after one second, followed by its release tail. Starting another test releases the previous tones; Stop sound is an immediate emergency silence. This page
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

### ADSR contract (#27)

`new Synth(sampleRate, options)` accepts an optional construction-time envelope.
The production AudioWorklet uses the defaults; there is no live parameter UI or
per-note configuration. Options are copied into sample counts at construction.

| Option | Unit | Default | Valid range |
| :--- | :--- | :--- | :--- |
| attack | seconds | 0.005 | finite 0–10 inclusive |
| decay | seconds | 0.08 | finite 0–10 inclusive |
| sustain | fraction of velocity-scaled peak | 0.7 | finite 0–1 inclusive |
| release | seconds | 0.04 | finite 0–10 inclusive |

Invalid parameters throw before rendering. Sample rates must be finite and in
8000–384000 Hz. A positive duration becomes `max(1, round(seconds * sampleRate))`
samples; zero skips that stage. Rounding error is at most half a sample, except
positive sub-sample durations are at least one sample.

Each new press starts at phase and envelope level zero. The first attack sample
has level `1/A`; sample A reaches exactly 1. The next D samples interpolate from
1 to sustain, reaching sustain on sample A+D. Sustain holds until note-off,
including at sustain zero (a silent held voice still owns its press). A zero
attack starts decay at level 1; a zero decay jumps to sustain on the sample after
the attack peak. If both are zero, the first sample uses sustain. These explicitly
instantaneous settings may click; positive defaults limit boundary jumps.

Note-off captures the current level L without changing it, then releases as
`L * (1 - k/R)` for k=1…R. Early attack/decay releases take the same configured
release time as sustain releases. The final sample is exactly zero and frees
the slot. Duplicate note-offs do not restart release. Zero release or note-off
at level zero frees the slot immediately, with no division by zero.

Repeated pitches with distinct press IDs use independent voices, including when
the previous press is releasing. Duplicate/out-of-order press IDs never retrigger.
Free slots are reused first; otherwise the oldest press is immediately replaced,
even during release. Stealing resets phase/level and starts a new attack without
changing other voices. A late note-off for the stolen press cannot release its
replacement. This hard cut can click: the removed single-voice contribution is
bounded by 0.08. It is tested as a hard transition, not a seamless crossfade.
Reset and terminal release-all retain their immediate-silence safety semantics.

The envelope scales the sine oscillator; envelopes alone do not provide realistic
piano timbre. Steady amplitude is now `0.08 * velocity * 0.7` by default.

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
slot reuse, buffer continuity, invalid input and session resets. ADSR cases additionally check every default stage sample at 8/44.1/48/96/192/384 kHz, early release in every stage, duplicate releases, independent retriggers, zero/sub-sample durations, parameter limits, and sample discontinuity bounds. See the [#27 listening report](../tests/manual/2026-09-24_2.2.18.md) for the user-reported audible pass and its environment/evidence limitations.
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
