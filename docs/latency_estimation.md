# Software latency estimation (#30)

Issue #30 delivers reproducible simulation/software estimates. Its completion
criteria are implemented tooling, a published simulation result, regression
checks and documented assumptions. Physical measurement and accuracy evaluation
are separate product-verification activities, outside this deliverable.
Inventory 2.3.7 covers this estimator and simulation.

## Published simulation result

Run the supplied baseline without additional equipment:

```powershell
python tests/python/latency_estimate.py tests/python/latency_simulation.fixture.json tests/python/latency_estimate.example.json simulation.json
```

The versioned `tests/python/latency_simulation.report.json` records this run.
Five synthetic software durations (7, 10, 12, 14, 17 ms) are combined with 100
uniform frame-phase midpoints each. The 30 FPS baseline assumes 8 ms additional
camera delay, 5 ms contact/scheduling/dispatch and 6 ms wired audio output.
These values define an illustrative planning scenario, not a fitted hardware
model. The source records this provenance; no captured CV timings are substituted.

| Baseline result | Modeled value |
| :--- | :--- |
| Mean | 47.67 ms |
| p50 | 47.50 ms |
| p95 | 63.83 ms |
| Sample maximum | 69.17 ms |
| Fraction at/above 50 ms | 43% |
| Simulation sample count | 500 |

The baseline mean is 12 + 8 + 5 + 6 + 500/30 ms. At 30 FPS, allowance
sensitivity gives means 37.67–66.67 ms; central means at 15/60 FPS are
64.33/39.33 ms. The modeled distribution exceeds 50 ms in many samples;
regression tests preserve that outcome rather than asserting a latency pass.
`test_published_simulation_regression_values` checks the saved report and explicit
expected numeric values. These tests verify arithmetic and reproducibility.
A planning estimate is as representative as its assumptions; configure another
scenario to reflect a different camera, gate policy or audio route.

## Run with existing diagnostics

Enable `NEXT_PUBLIC_PIPELINE_DIAGNOSTICS=1` when building the frontend. Follow
[the profile procedure](performance.md#recording-a-profile), perform a repeatable
workload, stop diagnostics and export the JSON. A calibrated live playing run is
needed for contact/event stages; a synthetic camera may not produce these.
Keep startup and warm profiles separate. For warm profiles document readiness,
warm-up duration and duration/settings of the workload.

Copy `tests/python/latency_estimate.example.json` into a local config. Replace
the synthetic metadata with the exact profile commit/browser/hardware strings
and real camera resolution, output model/route, settings and accuracy evidence
(or state that accuracy is outside the scenario). Set nominal camera FPS and FPS sensitivity
values. The profile's delivered/processed FPS and presentation drops are retained
as observations; none is silently treated as sensor FPS.

```powershell
python tests/python/latency_estimate.py profile.json config.json estimate.json
python -m pytest tests/python/test_latency_estimate.py
```

No new packages are needed beyond the repository's test dependencies.
The aggregate fixture `tests/python/latency_profile.fixture.json` also works
with the example config; it produces the same baseline mean while leaving total
quantiles unavailable. Aggregate software means cannot establish a distribution.

## Components and assumptions

The central estimate is:

`selected software mean + 500 / camera_fps + assumed allowance means` (ms).

`500 / camera_fps` models the average of a uniform frame-alignment wait from
zero to one nominal frame period. At 30 FPS this is 16.67 ms. It assumes presses
arrive independently with random frame phase; it excludes exposure, buffering,
dropped frames and contact persistence. State whether this assumption fits the
workload. Do not infer it from processed FPS alone.

Select unique disjoint software stages from inference, detection, eventDelivery
and transfer. Use #38's actual boundaries and clock conventions: main monotonic
milliseconds, worker-origin translation before subtraction, no subtraction of
media seconds or AudioContext seconds from performance.now. Quantiles from
different stages are never added. Whole-run stage means are added only under
your written coverage/nonoverlap rationale. Counts and populations may differ;
the sum is an approximation under that rationale, not an observed per-press mean.
In particular, eventDelivery can overlap other work depending on its observation
timestamp; omit it if you cannot establish nonoverlap. Marker detection is not
automatically per-note work and cannot be selected as an additive stage.

Three explicit allowance categories cover unmeasured work:

| Category | What needs accounting |
| :--- | :--- |
| camera_capture | Exposure, buffering, delivery and dropped-frame effects beyond frame phase |
| contact_gating | Asynchronous CV/shadow work, temporal gating, queues and omitted software/event dispatch |
| audio_output | Worklet scheduling, envelope onset, output buffering and transducer/device delay |

For each, provide an assumed mean and low/high sensitivity values with a
rationale/source. A flat average is supported, but its sensitivity range must
also be specified. These are assumptions, not measured values or confidence
intervals. Browser audio latency APIs, if used as rationale, do not measure
physical end-to-end latency. Keep Bluetooth and wired/built-in configs separate.
Use `null` for unknown means: all total estimates stay unavailable. A measured
or otherwise justified zero can be entered explicitly; nothing defaults to zero.

The tool combines low/central/high allowance totals with each FPS scenario.
It retains original diagnostics, stage counts/quantiles, dropped frames,
unavailable fields, config and an input hash. #38 quantiles summarize only the
latest 256 samples per stage; means/maxima have whole-run scope. Missing stages
are retained as unknown, not hidden. Existing diagnostics do not count all
missed physical presses: do not invent an attempt denominator or accuracy result.

## Paired-duration input and modeled distributions

For recorded aligned durations or synthetic validation, an alternative JSON is:

```json
{
  "schema_version": 1,
  "clock_convention": "main monotonic durations in milliseconds",
  "attempts": [
    {"status": "ok", "durations_ms": {"inference": 10, "detection": 2}},
    {"status": "missed", "reason": "no contact event"}
  ]
}
```

Every successful attempt must include all configured disjoint stages. Failed
attempts and malformed/missing durations remain in the report with their indices
and are excluded from successful-duration statistics. All-failed or empty data
cannot yield an estimate. Document input provenance in config settings/coverage;
the current production #38 exporter does not supply paired durations.

For paired input only, each software sum is combined with 100 equally weighted
midpoints of the uniform frame-phase interval, assuming independent frame phase,
and each fixed allowance scenario. Reports provide modeled sample count, mean,
nearest-rank p50/p95, sample maximum and fraction at/above 50 ms. These are model
distributions with 1% frame-grid resolution, not additional observed trials.
There is no assumption that an allowance's low/high values define its probability
distribution. The sample maximum is not a physical worst-case bound.
Aggregate-only exports leave modeled quantiles/exceedance fractions null.

## Interpretation and verification

Exit 0 means an ESTIMATED scenario was produced under the documented
assumptions, even if estimates exceed 50 ms. Exit 1 means INCOMPLETE inputs with
unknown components or no valid software data; exit 2 means invalid inputs.
Reports identify their scope as software/model estimates. Each modeled mean
at/above 50 ms is flagged for comparison. Review all scenarios,
observed distributions and failures. Pair tuning with #39 accuracy evaluation.

Synthetic tests check known arithmetic and distributions, FPS/allowance
sensitivity, missing/invalid data, population metadata mismatch, retained
diagnostics/failures, nonoverlap assertions and CLI serialization/exit behavior.
No hardware or physical capture is required to complete estimator verification.
The numerical threshold is a model comparison, not a physical measurement.
