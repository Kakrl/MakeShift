# Physical press-to-audio benchmark (#30)

Requirement 2.3 remains **under 50 ms**, with no average or p95 substitute.
This procedure implements analysis for inventory 2.3.1; physical execution is
pending. Synthetic signals validate analysis, never product latency. Pair
latency runs with labeled accuracy evaluation (#39); faster settings that miss
presses do not satisfy the product goals.

## Equipment and reference

Use the production integrated piano page, printed sheet, webcam, calibrated
contact detection and browser audio enabled by a user gesture. Capture two
channels through one stereo audio interface/ADC at 48 kHz or higher, PCM16,
with no AGC, noise suppression, echo cancellation, compression or resampling.
Channel 0 records a contact sensor at the paper surface; channel 1 records a
microphone at the listener position capturing actual speakers/headphones.
A safe interface-compatible sensor/conditioner is required: never connect a
powered switch directly to a microphone input. Record models, gain and wiring.
Electrical loopback alone excludes the output transducer and is not physical
audible-output evidence. Two independently started recordings are insufficient.

Define press time as the first validated sensor contact with the printed key
surface. A thin force/contact sensor must not materially alter finger motion,
paper geometry or shadows. Verify its trigger against close-up high-speed video
or another characterized physical contact reference. Record frame quantization,
sensor response/bounce, alignment error and any change to playing conditions.
A tap sound in the output microphone can resemble a note: isolate the sensor
mechanically and check silent taps with browser audio disabled. If taps trigger
the audio detector, this setup is invalid until discrimination is established.
The harness cannot identify pitch or distinguish a tap from a synthesized note.

## Synchronization and onset calibration

Both WAV channels share sample indices; no browser clock is subtracted from
them. Before and after each session, measure channel skew using the same split
test signal into both acquisition paths where feasible. Characterize sensor
response and microphone/onset delay separately using known physical references.
Document calibration recordings and drift; if bounds cannot be established,
leave the run BLOCKED. Include sample-clock accuracy over the measurement window.

Detection uses absolute PCM amplitude averaged over a causal window, then a
threshold crossing. Timestamp is the **end** of that window. Rearming requires
the envelope below threshold for `quiet_ms`; ringing can otherwise duplicate
onsets. Inspect waveforms and detected timestamps for every trial. Specify the
noise floor, both normalized thresholds, averaging and quiet windows in JSON.
Repeat analysis at nearby justified thresholds; include onset sensitivity and
missed quiet notes in uncertainty. Do not tune thresholds to hide late trials.

`correction_ms` is measured audio-path detection delay minus measured reference
path detection delay. Corrected latency is audio onset minus reference onset
minus this signed correction. Do not subtract device buffering, Bluetooth delay,
camera delay or acoustic travel to the listener: these belong to end-to-end
latency. `uncertainty_ms` is a conservative sum of calibration, drift, reference
and onset bounds, including threshold sensitivity. The analyzer adds one sample
period for relative two-channel quantization. Record each budget term; the
example values are placeholders, not validated defaults.

## Reproducible capture

1. Record commit, OS/browser versions, CPU/RAM, camera model/resolution/rate,
   output model/route/volume, microphone distance, capture settings, lighting,
   layout, calibration, model/delegate, envelope and velocity settings.
2. Capture startup/model loading separately. For warm playback, wait until
   models, calibration and audio are ready, play for 30 seconds, then begin a
   fresh recording. Record readiness and warm-up duration. Never pool phases.
3. Plan at least 100 isolated presses, covering keys and slow/fast intentional
   presses in repeatable order. Record key/velocity/scenario labels in the manual
   report. Hold/release fully, leaving at least one second of silence between
   trials. Define disjoint trial windows before analysis; each contains exactly
   one reference and a full response interval (recommend 500 ms). Include every
   attempt. Longer timeouts may be necessary for Bluetooth; do not drop failures.
4. Repeat built-in/wired baseline and Bluetooth in separate files/configurations.
   Record ambient noise and silent-tap controls. Reject clipping or acquisition
   dropouts; retain rejected recordings and their reasons as failed/invalid
   attempts in the manual record, rather than selecting only clean fast notes.
5. Copy `tests/python/latency_config.example.json`, replace every TODO, set
   detector/calibration values and trial windows from capture records. WAV is
   relative to the CLI working directory; config windows use WAV milliseconds.
   Preserve original WAV, JSON, calibration captures and software exports.

```powershell
python tests/python/latency_analysis.py capture.wav run.json report.json
python -m pytest tests/python/test_latency_analysis.py
```

Exit 0 means all analyzed attempts passed with their uncertainty upper bound
strictly below 50 ms and no unmatched onsets. Exit 1 writes a FAIL or INCONCLUSIVE
report; exit 2 rejects invalid input. This automated classification remains
subject to physical setup validation and manual review. A miss fails the run;
multiple references/responses or a bound straddling 50 ms are inconclusive.
Exactly 50 ms never passes. Unmatched audio fails, unmatched references prevent
a pass. Onsets after the response timeout are retained as unmatched, not paired
with later presses. Windows cannot overlap and must include the full timeout.

Reports include every attempt, detected timestamps, corrected latency, result,
uncertainty, capture hash, metadata and complete analysis configuration. p50/p95
use nearest rank over valid measured latencies; maximum and proportions above
and at/above 50 ms use the same denominator. Missing/invalid attempts stay in the
attempt count and nonpassing fraction. Distributions may be null when no audio
is measured. Report all counts/statuses alongside quantiles. PASS applies only
to tested conditions and attempts; it does not establish population compliance.

## Software stages and reporting

Export #38 diagnostics for the same conditions as a separate artifact. Follow
[performance clock conventions](performance.md#metrics-and-clock-assumptions):
main monotonic milliseconds; worker origins translated before subtraction;
AudioContext/media clocks are distinct. Report inference, marker/contact work,
event delivery and unavailable stages, with sample counts and their boundaries.
Do not sum overlapping stage quantiles or present them as physical latency.
Diagnostics p50/p95 describe only the latest 256 samples per stage. Separate
cold and warm software profiles; they cannot locate a physical onset without
additional synchronization. Record diagnostic enablement and paired overhead.

Copy the [manual report template](../tests/manual/manual_test_template.md) for
each physical run. Include equipment/calibration, all trials/failures, uncertainty,
distributions, accuracy evidence or its unexecuted status, threshold sensitivity,
startup versus warm and baseline versus Bluetooth. Link raw evidence and JSON
using stable storage URLs or `tests/manual/evidence/<report>/`; link the report
from inventory 2.3.1. Missing equipment means BLOCKED/unexecuted, never PASS.
Confirmed core latency defects follow tests/README.md severity/RCA rules.

Generated WAV fixtures exercise known 20/49/50/80 ms delays at 44.1/48/96 kHz,
misses, ambiguous/unmatched responses, invalid references, correction and
uncertainty, strict threshold behavior, noisy ramped sine bursts, CLI reports
and exit codes, and invalid inputs. They test the
analyzer and carry no physical end-to-end evidence.
