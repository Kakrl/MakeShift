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
The legacy comparison mode uses a sine wave with peak amplitude `0.095 * velocity ** 1.5`; velocity
must be finite and in (0, 1]. Invalid notes/velocities are rejected rather than
clamped. A threefold velocity gives 5.196-fold amplitude (about 14.31 dB). The curve is applied once at onset; estimator and MIDI values remain unchanged.
Ten full-velocity in-phase voices are bounded by 0.95 even at sustain 1; the final mix also clamps to
[-1, 1]. Frequencies at or above Nyquist are silent rather than aliased.

### ADSR contract (#27)

`new Synth(sampleRate, options)` accepts an optional construction-time envelope.
Explicit ADSR options or `{mode: "legacy"}` select the previous sine renderer.
The production AudioWorklet uses the piano defaults below; there is no live parameter UI or
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
bounded by 0.095. It is tested as a hard transition, not a seamless crossfade.
Reset and terminal release-all retain their immediate-silence safety semantics.

The envelope scales the sine oscillator; envelopes alone do not provide realistic
piano timbre. Steady amplitude is now `0.095 * velocity ** 1.5 * 0.7` by default.

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
in explicit legacy mode offline at 44.1, 48 and 96 kHz. Interpolated positive zero crossings estimate
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

## Piano default (#175)

`new Synth(rate)` now uses ten fixed modal voices. Each voice has sixteen
partials, independent amplitude/cutoff state, and a topology-preserving
state-variable low-pass with damping `1/Q`. There are no additional detuned
oscillators or hammer noise: the total oscillator budget is 160. Presets for
all 128 MIDI pitches, a 4096-entry interpolated sine table and a 1024-interval
filter coefficient table are generated before readiness. Rendering and note
dispatch allocate no partial storage and require no decoding, network,
look-ahead or additional audio buffers.

Register is `r = MIDI/127`. Amplitude uses a cubic smoothstep attack of
`1 + 3*(1-r)` ms, then a `50 + 100*(1-r)` ms cubic decay from 1 to 0.35,
followed by exponential decay with time constant `0.5 + 3.5*(1-r)` seconds.
Release captures the instantaneous amplitude and quadratically damps it over
`40 + 110*(1-r)` ms. Levels below 0.00001 retire after attack; maximum lifetime
is 30 seconds. These are design tuning choices, not measured piano parameters.
Explicit legacy ADSR retains all previous zero/sub-sample-duration semantics.
`mode: "piano"` with ADSR options throws to prevent ambiguous migration.

Partial frequencies use `k*f0*sqrt((1+B*k*k)/(1+B))`, with
`B = 0.00002 + 0.00018*r*r`, preserving the fundamental. Frequencies at or
above 0.45 times the actual sample rate are culled before oscillation. The
fundamental weight is 1; higher partials start at
`(0.22 + 0.35*velocity)/k^1.6`. Weights are normalized by their sum. Partial k
decays additionally with time constant `(0.24 + 0.35*(1-r))/(k-1)` seconds;
the fundamental has no additional decay. Peak excitation gain is 0.095 times velocity to the power 1.5 (#209). Ten-note output is tested without mix clipping; stealing additionally
ramps the previous slot's last output to zero over 3 ms while the new voice
attacks. This bounded correction avoids a hard cut but is not a full waveform
crossfade. Filter states and partial phases reset on reuse. Emergency Stop,
reset and release-all erase all output/correction immediately.

Cutoff opens during attack, then closes with independent 90 ms and 800 ms
exponentials, weighted 0.7/0.3. Velocity brightness is `0.4+0.6*velocity`;
pitch tracking sets the lower envelope endpoint from twice the fundamental.
Release closes from the instantaneous log-frequency envelope. Frequency maps
as `min*(max/min)^e`; coefficient targets update every 16 samples and interpolate
over the next 16 samples. Positive TPT coefficients and bounded resonance avoid
arbitrary biquad interpolation. The 16-sample interval is provisional pending
listening and real-time CPU evidence; the paired microbenchmark is separate.

Construction accepts finite `cutoffMin` (20–20000 Hz, default 180),
`cutoffMax` (at least cutoffMin, at most 100000 Hz, default 18000),
`resonance` (Q 0.5–1, default 0.707), `cutoffFast` and `cutoffSlow`
(0.001–10 seconds), and `cutoffDepth` (0–1, default 0.85). Actual cutoff
endpoints clamp to 0.4/0.45 times sample rate. Equal effective endpoints
define a fixed cutoff with zero pitch tracking, avoiding division by zero.
Supported rates remain
8000–384000 Hz; automated stage/Nyquist checks sample six representative rates.

`pianoTimbre.test.ts` verifies the production default; `browserAudio.test.ts`
retains the explicitly selected legacy oracle for baseline/migration.
Browser graph thresholds now account for normalized harmonics and decaying
amplitude (soft RMS >0.001, chord RMS >0.01), and test velocity ordering rather
than an exact sine ratio. These thresholds establish nonzero output only.
No licensed reference recordings have been incorporated. Listening/reference
tuning and physical latency remain pending in the dated manual report.
The sample-pool proposal #22 is deferred: this bounded procedural approximation
needs no sample downloads; sampling, resonance and pedal modeling remain separate.

## Velocity tuning (#209)

The previous peak was 0.08 times velocity. The new power curve uses more headroom for strong strikes and widens soft-to-loud contrast without render-loop allocations. Maximum excitation gain increases 1.49 dB. The legacy sine mix retains 0.45 dB headroom; piano output additionally includes its filter and steal correction and is verified separately. The user confirmed velocity audibility before the piano merge; listening to the combined piano/velocity implementation remains pending. Register balancing and estimator thresholds are unchanged.

See the [dated verification/listening report](../tests/manual/2026-10-14_209-velocity.md) for before/after digital levels and the pending hardware procedure. Digital RMS does not establish acoustic SPL or physical latency.

## Live binary pedals (#176)

The default piano accepts version-1 session-scoped pedals commands on the same
MessagePort as note-on/off; port ordering is authoritative. Three booleans carry
the full effective state. Invalid versions, shapes and stale sessions are ignored.
The existing 64-unacknowledged-command limit includes controls; overflow sends
one emergency reset and rejects input until acknowledgement, including releases.
No context recreation, network request, look-ahead or render buffering is added.

Sustain retains released voices through natural decay. Sostenuto captures only
currently held voice/press identities on an effective rising edge; reused slots
clear capture. Damp a released voice only when neither pedal protects it. No
pedals clears sources/captures, without damping physically held keys. Reset and
invalidation retain emergency silence. Recording Stop clears pedal activation
while retaining the existing independent live-note lifecycle.

Ten voices remain preallocated. The first idle slot wins, otherwise the oldest
press is stolen, including physically held or captured notes; stealing never
inherits capture. This deliberately preserves the existing deterministic allocator.
Retained tails retire below 0.00001 amplitude or at 30 seconds. A pedal cannot
resurrect a damped/retired voice. Legacy ADSR mode retains its historical behavior;
pedals apply to the production piano mode.

Soft approximates una corda with 0.65 onset gain, 0.5 upper-partial excitation
before normalization, and 0.65 brightness. The velocity^1.5 gain curve remains;
recorded velocity is untouched. Each voice keeps its strike settings. This is an
approximation without half-pedaling, mechanical modeling or sympathetic resonance.

Bindings default unassigned and persist via version-1 shared localStorage.
Only unmodified letter, digit and numpad digit codes are supported, reserving
navigation/dialog/application shortcuts. Duplicate codes are rejected. Code means
physical location, not layout-dependent printed character. UI latches and held
keys compose by OR. Blur/hidden/navigation/session invalidation/rebinding clear
activation; held keys stay suppressed until keyup and a fresh press. Typing,
contenteditable, dialogs and IME do not activate pedals. Capture consumes input.

[Recording/export/replay follow-up](pedal_recording_followup.md) remains deferred.
[Verification record](../tests/manual/2026-10-23_PD-03.md) distinguishes synthetic
coverage, the automated browser launch failure, and Carl Xu's 2026-10-23 manual
functional pass for all pedals and programmable bindings. Specific device
configuration, detailed recovery scenarios, live-CV profiling and physical latency
evidence remain pending.
No physical latency or hardware compatibility pass is claimed.
