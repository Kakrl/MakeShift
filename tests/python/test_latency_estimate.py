"""Estimator regression evidence uses synthetic data only."""

import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest
from latency_estimate import estimate

ROOT = Path(__file__).parent


def inputs(known=True):
    source = json.loads((ROOT / "latency_profile.fixture.json").read_text())
    config = json.loads((ROOT / "latency_estimate.example.json").read_text())
    if known:
        for item in config["allowances"].values():
            item.update(low_ms=1, mean_ms=2, high_ms=3,
                        rationale="Synthetic assumed delay, not measured")
    return source, config


def central(report, fps=30):
    return next(s for s in report["scenarios"]
                if s["camera_fps"] == fps
                and s["allowance_scenario"] == "central")


def test_known_aggregate_and_no_fabricated_quantiles():
    source, config = inputs()
    report = estimate(source, config)
    assert report["software_mean_ms"] == 12
    assert central(report)["mean_ms"] == pytest.approx(12 + 6 + 500 / 30)
    assert central(report)["modeled_distribution"]["p95_ms"] is None
    assert central(report)["modeled_distribution"]["sample_max_ms"] is None
    assert report["observed_source"] == source
    assert report["physical_requirement_status"] == "UNVERIFIED"


def test_fps_and_allowance_sensitivity():
    source, config = inputs()
    report = estimate(source, config)
    assert central(report, 15)["mean_ms"] > 50
    assert central(report, 60)["mean_ms"] < central(report)["mean_ms"]
    same_fps = [s["mean_ms"] for s in report["scenarios"]
                if s["camera_fps"] == 30]
    assert same_fps[2] - same_fps[0] == pytest.approx(6)


def test_unknown_is_not_zero():
    source, config = inputs(False)
    report = estimate(source, config)
    assert report["estimate_status"] == "INCOMPLETE"
    assert len(report["unknown_components"]) == 3
    assert all(s["mean_ms"] is None for s in report["scenarios"])


def test_unavailable_stage_and_retained_diagnostics():
    source, config = inputs()
    config["diagnostic_stages"].append("transfer")
    report = estimate(source, config)
    assert report["unknown_components"] == ["transfer"]
    assert report["software_mean_ms"] is None
    assert report["observed_source"]["droppedFrames"] == 2


def test_paired_distribution_retains_failures_and_invalid_samples():
    _, config = inputs()
    source = {
        "schema_version": 1, "clock_convention": "main monotonic ms",
        "attempts": [
            {"status": "ok", "durations_ms": {"inference": 10,
                                               "detection": 2}},
            {"status": "missed", "reason": "no contact event"},
            {"status": "ok", "durations_ms": {"inference": -1}},
        ],
    }
    report = estimate(source, config)
    assert report["attempt_count"] == 3
    assert len(report["failures"]) == len(report["invalid_attempts"]) == 1
    assert report["observed_paired_distribution"]["count"] == 1
    distribution = central(report)["modeled_distribution"]
    assert distribution["count"] == 100
    assert distribution["mean_ms"] == pytest.approx(18 + 500 / 30)
    assert distribution["p50_ms"] == pytest.approx(18 + 0.495 * 1000 / 30)
    assert distribution["p95_ms"] == pytest.approx(18 + 0.945 * 1000 / 30)
    assert distribution["sample_max_ms"] == pytest.approx(
        18 + 0.995 * 1000 / 30)
    assert distribution["fraction_at_or_over_50_ms"] == 0.04


@pytest.mark.parametrize("value", [0, -1, True, float("nan"), "30"])
def test_invalid_fps(value):
    source, config = inputs()
    config["camera_fps"] = value
    with pytest.raises(ValueError):
        estimate(source, config)


@pytest.mark.parametrize("change", [
    {"phase": "mixed"}, {"schema_version": True},
    {"diagnostic_stages": ["inference", "inference"]},
    {"diagnostic_stages": ["frameAge"]}, {"nonoverlap_rationale": ""},
    {"frame_wait_model": "measured"}, {"fps_sensitivity": []},
])
def test_invalid_assumptions(change):
    source, config = inputs()
    config.update(change)
    with pytest.raises(ValueError):
        estimate(source, config)


def test_invalid_bounds_units_metadata_and_no_mutation():
    source, config = inputs()
    original = copy.deepcopy((source, config))
    estimate(source, config)
    assert (source, config) == original
    config["allowances"]["audio_output"]["low_ms"] = 4
    with pytest.raises(ValueError, match="low"):
        estimate(source, config)
    source, config = inputs()
    source["metrics"]["inference"]["unit"] = "seconds"
    with pytest.raises(ValueError, match="milliseconds"):
        estimate(source, config)
    source, config = inputs()
    config["metadata"]["commit"] = "other"
    with pytest.raises(ValueError, match="mismatch"):
        estimate(source, config)


def test_all_failed_has_null_statistics():
    _, config = inputs()
    report = estimate({"schema_version": 1, "clock_convention": "ms",
                       "attempts": [{"status": "missed"}]}, config)
    assert report["estimate_status"] == "INCOMPLETE"
    assert report["observed_paired_distribution"]["p95_ms"] is None


def test_invalid_count_and_placeholder_rationale():
    source, config = inputs()
    source["metrics"]["inference"]["count"] = -1
    with pytest.raises(ValueError, match="count"):
        estimate(source, config)
    source, config = inputs()
    config["allowances"]["audio_output"]["rationale"] = "TODO measure"
    with pytest.raises(ValueError, match="explanation"):
        estimate(source, config)


def test_exact_50_remains_estimate_only():
    source, config = inputs()
    config["camera_fps"] = 100
    for item in config["allowances"].values():
        item.update(low_ms=11, mean_ms=11, high_ms=11)
    report = estimate(source, config)
    scenario = central(report, 100)
    assert scenario["mean_ms"] == 50
    assert scenario["mean_at_or_over_50_ms"] is True
    assert report["estimate_status"] == "CONDITIONAL"
    assert report["physical_requirement_status"] == "UNVERIFIED"


@pytest.mark.parametrize("known,expected", [(True, 0), (False, 1)])
def test_cli_exit_and_serialized_report(tmp_path, known, expected):
    source, config = inputs(known)
    paths = [tmp_path / name for name in ("profile.json", "config.json",
                                         "report.json")]
    paths[0].write_text(json.dumps(source))
    paths[1].write_text(json.dumps(config))
    result = subprocess.run([sys.executable, str(ROOT / "latency_estimate.py"),
                             *map(str, paths)], capture_output=True,
                            text=True, check=False)
    assert result.returncode == expected, result.stderr
    report = json.loads(paths[2].read_text())
    assert len(report["source_sha256"]) == 64
    assert report["physical_requirement_status"] == "UNVERIFIED"
