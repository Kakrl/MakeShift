# Manual Test Report: #210 sampled piano and +6 dB register balance

## Summary

| Field | Value |
| :--- | :--- |
| Test Case ID | SP-01, SP-02, SP-03; 2.2.15, 2.2.16; related PT-03 |
| Requirements | 2.2; related 2.4 |
| Level | Unit and browser integration; qualitative prototype listening |
| Tester | Codex (software); Carl Xu (user-reported prototype listening) |
| Date run | 2026-10-19 |
| Commit / branch | ddb6d72 plus changes on fix/210-register-balance; final PR identifies committed revision |
| Overall result | Sampled software checks passed; +6 dB prototype preference accepted; structured production hardware checks pending |
| Linked defects | #210 (D24) |

## Objective

Use the sampled piano chosen by the user in live playing and recording playback,
with the preferred bass balance, fixed polyphony headroom and unchanged musical
identity/velocity contracts.

## Environment

Windows 10.0.26200 workspace, Node 22.20.0, Vitest 4.1.11, Next.js 16.2.3.
Production browser verification used headless Edge 155.0.4283.62, fake media,
http://127.0.0.1:3214 and a 48 kHz AudioContext. User listening occurred in the
local prototype; physical browser/version, headphones/speaker model, volume,
CPU/RAM, room, camera and layout conditions were not captured. Headless graph
verification is separate from the user's acoustic observations.

## Listening history and selection

The initial +4 dB modal/procedural experiment passed digital checks, but Carl
reported that higher notes still sounded more present. That experiment was
rejected and its gain change is not shipped. It did not establish perceptual
balance or a confirmed device-independent root cause.

A local prototype then used 19 stereo Salamander Yamaha C5 recordings, first-
500-ms RMS normalization, a fixed safety scale and an adjustable 0–16 dB bass
curve. Carl selected +6 dB as the sweetspot and said the sampled piano sounded
much more realistic and made bass easier to handle. Every phrase note uses
exactly the same selected normalized velocity, including bass chords and melody;
the default Medium setting is 0.6. The user's exact selector value was not
independently captured. Default changed to +6 dB.

Production now uses that same subset, normalization and fixed scale in the
AudioWorklet. It adds a bounded 3 ms voice-steal crossfade and retains the
2 ms onset / 200 ms note-off release. This is qualitative prototype preference,
not a completed production hardware listening or distortion trial.

## Preconditions and test data

Nineteen unchanged MP3s, Alexander Holm, CC BY 3.0, pinned Tonejs/audio commit
efd8296360f9526e379bfbe5c1698ff54d6a1d34. Source hashes and sizes are in
frontend/public/audio/piano-samples/manifest.json; credits and playback changes
are in NOTICE.md. Compressed total: 1,377,637 bytes.

Per-root gain uses min(0.003274555342244959 * bassLift / rms, 0.085 / peak),
with bassLift +6 dB at C2 and below, tapering to zero at A4. Intermediate pitches
use the nearest recorded root. Velocity multiplies by velocity^1.5. This subset
has one recorded dynamic layer, not the complete Salamander instrument.
Synthetic unit cases use six rates (8/44.1/48/96/192/384 kHz); production decoding
and real PCM output were checked at 48 kHz.

## Steps and results

| Action | Expected | Actual / result |
| :--- | :--- | :--- |
| Prototype low/mid/high and phrase listening | More realistic sound; balanced bass at identical velocities | User preferred +6 dB; qualitative acceptance only |
| Normalize, shape bass, preserve stereo and cap pathological crest factors | +6 dB curve, finite copied PCM and peak bound | Focused regressions passed |
| Six-rate synthetic all-MIDI and ten coherent/mixed voices | Finite bounded output; above-band fundamentals silent | Focused regressions passed |
| Velocity, transposed pitch, release, stealing and stale/invalid sessions | Existing musical behavior retained | Focused regressions passed |
| Asset hashes; bounded loader; HTTP/decode/abort/rate errors | Exact pinned assets; at most four load tasks; explicit failure | Focused regressions passed |
| Owner pending load, reuse, cancellation, failure/retry and ready handshake | Readiness waits; no partial/stale playing | Focused regressions passed |
| Production MP3 decoding, all-pitch coherent ten-note render | All 19 recordings valid; finite headroom | PASS; 48 kHz peak 0.28647268 over first 500 ms per pitch |
| Production bass/mid/treble with browser offline | Notes continue without network | PASS |
| Velocity, Stop, suspend/re-enable and navigation | Nonzero ordered output, immediate silence, no replay, context closes | PASS |
| Deployment and keyboard-layout browser workflows | Static assets, fake camera recovery, zero per-note requests, persisted valid layouts | PASS; eight asset/type checks, three enable/play/stop rounds |
| Physical production listening, headphones/speakers and ten-note distortion | Confirm chosen balance in actual live use | PENDING |

## Measurements

| Observation | Result | Limit |
| :--- | :--- | :--- |
| Soft A4 / loud A4 graph RMS | 0.00031513 / 0.00163748 | Velocities 0.25/0.75; sampled at about 150 ms; scheduling/window varies |
| Nineteen stereo PCM recordings at 48 kHz | 111,179,616 bytes per bank | Owner + worklet copies about 212 MiB combined; transient decode buffers extra; scales with rate |
| Enable through worklet readiness | 976 / 1119 / 1052 ms across verification runs | Three local startup observation, not a distribution or note-latency measurement |
| Actual-PCM coherent ten-voice peak | 0.28647268 | First 500 ms at each MIDI pitch, 48 kHz, velocity 1 |
| All-time per-channel digital bound | <=0.085 per voice, <=0.85 for ten | Validated PCM peaks, bounded envelope/interpolation and convex stealing; not intersample/acoustic distortion |

## Verification evidence and limits

Final frontend lint, TypeScript, 552 Vitest cases (one existing skip), all 37 contrast
pairs and production build passed, including the handshake/Nyquist additions. Edge production
browser tests passed as described
above. All three Chromium runners failed at process launch (spawn UNKNOWN),
before test execution; new Actions execution remains pending. Database was
unconfigured.

Sources: tests/frontend/sampledPiano.test.ts, browserAudioLifecycle.test.ts,
browserAudio.browser.mjs and deployment.browser.mjs. The procedural modal/sine
suites remain historical/reference verification; their timbre/CPU evidence is
not reassigned to the sampled renderer. No render-loop allocation or per-note
fetch/decode was added, but actual worklet deadlines under live CV stress,
physical latency, extreme-transposition fidelity and acoustic distortion remain
unverified. Root recording pitches span C1–C7; extremes of MIDI 0–127 transpose
beyond the recorded range. One recorded layer changes gain with velocity;
pedal/resonance/release noises and multilayer timbre are not included.

## Remaining production listening procedure

Record exact revision, browser/OS, interface/device models, fixed app/system
volume, room and tester. At the production /audio page compare C2/C4/C6 (each
velocity 0.6), soft/loud A4 and the chord. Repeat with headphones and speakers
where available, marking missing devices explicitly. In the live app compare
selected 1–3 octave layouts at controlled velocities 0.2/0.5/1, 200 ms taps and
two-second holds. Listen for bass/treble masking, distortion at maximum-velocity
ten-note chords, repeated notes, release and Stop/restart behavior. Record
individual outcomes; do not infer physical acceptance from graph output.

## Easier live velocity follow-up

The user requested less motion to reach louder notes after the sampled-piano
integration. The live estimator now reaches velocity 1 at 4 rather than
8 palm lengths/s; the 0.5 palm lengths/s noise floor and soft/fallback 0.2
velocity are unchanged. At 2 palm lengths/s velocity rises from 0.36 to about
0.542857; velocity 0.75 is reached at 2.90625 instead of 5.65625 palm lengths/s.
No change is made to the +6 dB bass curve, sample normalization, maximum voice
gain, velocity exponent, detection thresholds or press/session timing.

The updated landmark-motion fixture checks the stronger onset through the
production sampler using synthetic PCM: the same moderate movement produces
about 5.35 dB more digital output than its prior velocity. Slow/fast ordering
and a >5 dB separation remain. Overlay integration records 54 rather than 36
for that moderate strike while preserving the simultaneous strong strike at
100, held-note durations and no hold retriggers. Existing takes are unchanged.
New boundary/sweep regression checks soft control, strict monotonicity,
velocity 0.75 at the lower speed and saturation at 4. User hardware/listening
acceptance of this threshold remains pending.

Follow-up verification on 2026-10-19: lint, TypeScript, 553 Vitest cases (one
existing skip), all 37 contrast pairs and production build passed. Deployment,
keyboard-layout and audio browser runners passed in Edge 155.0.4283.62 against
the rebuilt app at port 3214. Actual PCM peak and decoded memory stayed at
0.28647268 and 111,179,616 bytes; one enable took 1082 ms. These fixed-velocity
browser graph checks do not establish attainable real-camera motion or human
acceptance of the new sensitivity. Chromium remains unavailable as above;
new Actions execution is pending.

## Defects and sign-off

No separate defect raised; #210 tracks the sound change. Carl Xu selected the
prototype's +6 dB balance on 2026-10-19. Production hardware tester/reviewer
sign-off and physical measurements remain pending.
