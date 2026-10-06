# Software latency estimation (#30)

Issue #30 delivers estimates without a contact sensor, physical recording or
manual test. Requirement 2.3 remains under 50 ms physical press to audible
output; this estimator always reports that requirement as **UNVERIFIED**.
Inventory 2.3.7 verifies the estimator; physical test 2.3.1 remains planned.

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
(or explicitly unexecuted accuracy). Set nominal camera FPS and FPS sensitivity
values. The profile's delivered/processed FPS and presentation drops are retained
as observations; none is silently treated as sensor FPS.

```powershell
python tests/python/latency_estimate.py profile.json config.json estimate.json
python -m pytest tests/python/test_latency_estimate.py
```

No new packages are needed beyond the repository's test dependencies.
For a synthetic smoke run, use `tests/python/latency_profile.fixture.json` and
`tests/python/latency_estimate.example.json` as the two inputs. The example has
unknown allowances, so it intentionally writes an INCOMPLETE report and exits 1.
It is not a measured product profile.

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

Exit 0 means a CONDITIONAL estimate was produced under the documented
assumptions, even if estimates exceed 50 ms. Exit 1 means INCOMPLETE inputs with
unknown components or no valid software data; exit 2 means invalid inputs.
Physical requirement status is always UNVERIFIED. The report flags each modeled
mean at/above 50 ms but never emits a physical PASS or FAIL. Review all scenarios,
observed distributions and failures. Pair tuning with #39 accuracy evaluation.

Synthetic tests check known arithmetic and distributions, FPS/allowance
sensitivity, missing/invalid data, population metadata mismatch, retained
diagnostics/failures, nonoverlap assertions and CLI serialization/exit behavior.
No hardware or physical capture is required to complete estimator verification.
Actual physical compliance remains outside this estimation deliverable.
