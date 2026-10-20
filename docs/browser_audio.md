# Browser AudioWorklet Piano

Issue [#35](https://github.com/Kakrl/MakeShift/issues/35). The native
[voice allocator](audio.md) and [hit queue](audio_events.md) remain unchanged.

The live default is the [sampled stereo piano with +6 dB bass balance](#sampled-production-piano-and-register-balance-210)
(#210), used by both live CV and recording playback. The procedural modal and
sine sections below document retained reference APIs, not the live default.

## Playback and ownership

The browser owner is in `frontend/src/app/audio/audioEngine.ts`. Call
`initialize()` from a user gesture and await it before delivering notes.
It requests an interactive AudioContext, resumes before awaiting module loading,
and loads `/audio/piano-worklet.js`. Both the worklet and its relative
`sampled-piano.js` and `synth.js` imports are static public assets, without a bundler worker transform.

The Audio check link opens `/audio`: Enable audio, Soft A4, Loud A4,
Ten-note chord, matched-velocity Bass C2 / Middle C4 / High C6, and Stop sound. Each test sends note-off after one second, followed by its release tail. Starting another test releases the previous tones; Stop sound is an immediate emergency silence. This page
owns and closes its context on navigation. The existing home-page Play handler
awaits the shared owner's initialization and displays failures with a retry.
Detected notes never initialize or resume audio themselves.

Initialization is shared across simultaneous callers. Loading/resume failures
close resources and reject; a later gesture can retry. Processor failures
disconnect the failed node and permit recreation. Suspension invalidates active
presses, clears voices, and rejects notes until explicit initialization resumes
the context. Resume never replays notes from the previous session. The owner
can be closed even while its module is loading.

## Procedural reference DSP

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
The procedural Synth class uses the modal defaults below; there is no live parameter UI or
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
checks. `tests/frontend/browserAudio.test.ts` renders the retained procedural DSP
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

## Procedural piano reference (#175)

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

`pianoTimbre.test.ts` retains the procedural reference; `browserAudio.test.ts`
retains the explicitly selected legacy oracle for baseline/migration.
The procedural reference remains available to offline/migration tests; the live
worklet now uses SampledPiano. Its sampled graph checks and provenance are
described below. Historical modal benchmarks do not measure the new renderer.

## Velocity tuning (#209)

The previous peak was 0.08 times velocity. The new power curve uses more headroom for strong strikes and widens soft-to-loud contrast without render-loop allocations. Maximum excitation gain increases 1.49 dB. The legacy sine mix retains 0.45 dB headroom; piano output additionally includes its filter and steal correction and is verified separately. The user confirmed velocity audibility before the piano merge; listening to the combined piano/velocity implementation remains pending. Register balancing and estimator thresholds are unchanged.

See the [dated verification/listening report](../tests/manual/2026-10-14_209-velocity.md) for before/after digital levels and the pending hardware procedure. Digital RMS does not establish acoustic SPL or physical latency.

## Sampled production piano and register balance (#210)

`piano-worklet.js` uses `SampledPiano` from `sampled-piano.js` for live notes,
recording playback and the Audio check page. This supersedes the modal default;
`Synth`/`LegacySynth` remain explicit procedural references for older tests.
The rejected +4 dB modal experiment is not shipped. No new npm dependency,
WebAssembly port, native backend, CDN or per-note network request is involved.

Nineteen stereo MP3 recordings of Alexander Holm's Salamander Yamaha C5 are
committed under `public/audio/piano-samples/` (1,377,637 compressed bytes).
[Credits, CC BY 3.0 license and source](../frontend/public/audio/piano-samples/NOTICE.md)
and a SHA-256 manifest accompany the files. This is the same subset heard in
the accepted listening prototype. Roots are C1, C2 through A5 in minor thirds,
C6 and C7. All MIDI 0–127 events remain accepted; notes select the nearest
recording and linearly interpolate at `2 ** ((note-root)/12)`. Roots C1–C7 are
recorded; pitches outside that range are transpositions, with large stretches
at the extreme ends. Linear interpolation does not promise alias-free extreme
transposition or concert-instrument tuning accuracy.
Fundamentals at or above 0.45 times the context rate are silent, matching the
reference renderer's safe-band policy rather than playing an aliased pitch.

Each owner loads/decode-prepares the bank once before readiness, with four
outstanding fetch/decode tasks at most. Decoding uses the actual AudioContext
rate; stereo PCM is copied to the worklet. The owner retains one bank for
processor recovery and suspension/resume, and releases it on close or failed
initialization. AbortController cancels pending fetches on close/failure;
in-progress browser decoding cannot be interrupted but its stale result is
rejected. A ten-second worklet-ready timeout reports failure with retry.
No samples are fetched, decoded or copied per note or per render block. Startup
cost and decoded memory are distinct from note dispatch latency.

For each recording, RMS is measured over the first 500 ms across both channels.
Playback gain is
`min(0.003274555342244959 * 10 ** (6 * clamp((69-root)/33,0,1) / 20) / rms, 0.085 / peak)`.
The common fixed level preserves the prototype's headroom scale. Bass lift is
+6 dB at C2 and below, +3.82 dB at C3, +1.64 dB at C4, and zero at A4 and above;
intermediate notes use their selected recording's curve. This equalizes digital
levels before bass shaping, not universal perceived loudness. It never adjusts
one held note's gain in response to other active voices. Near-silent leading
frames are skipped at 0.2% of recording peak with a 1 ms margin.

Velocity multiplies gain by `velocity ** 1.5`. The live motion mapping now reaches
velocity 1 at 4 palm lengths/s (formerly 8), making loud notes easier to reach
without increasing maximum output. Its 0.5 palm lengths/s noise floor and soft
velocity 0.2 remain. Shared events pass that normalized onset velocity unchanged;
new recordings capture it through the existing MIDI conversion, while saved
recordings retain their original velocities. There is one recorded dynamic
layer: velocity changes amplitude, not recorded hammer timbre. Multi-layer
samples, pedal resonance, release-noise samples and reverb remain future work.

The sampler preallocates ten voices. A 2 ms linear onset and 200 ms release
from current level shape the recording; natural sample end or a 30-second
maximum retires it. Oldest-press stealing blends the last stereo sample into
the replacement for 3 ms using a convex crossfade. Repeated pitches are
independent; duplicate/stale releases cannot stop their replacement. Stop,
release-all, reset, overload and suspension keep the existing identity and
immediate-silence behavior. Linear sample interpolation, envelopes and convex
stealing keep each channel of each valid voice at or below 0.085, bounding a
ten-voice mix to 0.85 (about 1.41 dB sample-peak headroom). No limiter or
render-loop allocations are needed. This is not an acoustic distortion or
intersample-peak guarantee. The native engine and count-in metronome are unchanged.

`sampledPiano.test.ts` covers normalization/bass curve, stereo, PCM validation,
trimming, all MIDI pitches and chord bounds at six rates, velocity, transposed
pitch, block continuity, stealing/release/session safety, file hashes and
bounded loading/failure paths. Audio-owner tests cover pending load, cancellation,
retry and bank reuse. The production browser runner checks actual decoded
assets, all-pitch coherent chord bounds, offline bass/mid/treble graph output,
velocity, Stop, suspension/re-enable and navigation cleanup.

Carl Xu preferred +6 dB in the real-piano prototype after rejecting the modal
balance. All phrase notes had the same selected velocity (Medium default 0.6).
[Listening and verification record](../tests/manual/2026-10-19_210-register-balance.md)
separates that qualitative report from production graph tests and pending
camera/device/physical-latency measurements. The older velocity and timbre
reports remain historical evidence for their respective renderers.
