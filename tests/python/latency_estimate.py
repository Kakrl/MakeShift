"""Software timing estimates and reproducible latency simulation scenarios."""

import argparse
import hashlib
import json
import math
from pathlib import Path

ALLOWANCES = ("camera_capture", "contact_gating", "audio_output")
STAGES = ("inference", "detection", "eventDelivery", "transfer")


def numeric(value):
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or value < 0):
        raise ValueError("Expected finite nonnegative number")
    return value


def text(value):
    if (not isinstance(value, str) or not value.strip()
            or value.strip().upper().startswith("TODO")):
        raise ValueError("Expected nonempty explanation/metadata")


def stats(values):
    ordered = sorted(values)
    n = len(values)
    return {
        "count": n, "mean_ms": sum(values) / n if n else None,
        "p50_ms": ordered[math.ceil(n * 0.5) - 1] if n else None,
        "p95_ms": ordered[math.ceil(n * 0.95) - 1] if n else None,
        "sample_max_ms": max(values) if n else None,
        "fraction_at_or_over_50_ms": (
            sum(v >= 50 for v in values) / n if n else None),
    }


def estimate(source, config):
    if type(config.get("schema_version")) is not int:
        raise ValueError("Invalid config schema")
    if config["schema_version"] != 1:
        raise ValueError("Unsupported config schema")
    if config["phase"] not in ("startup", "warm"):
        raise ValueError("Separate startup and warm profiles")
    for key in ("commit", "browser", "hardware", "camera_resolution",
                "output_device", "settings", "accuracy_evidence"):
        text(config["metadata"][key])
    if config["metadata"]["output_route"] not in (
            "wired", "built-in", "bluetooth"):
        raise ValueError("Invalid output route")
    for key in ("nonoverlap_rationale", "software_coverage",
                "frame_wait_rationale"):
        text(config[key])
    if config["frame_wait_model"] != "uniform-random-phase":
        raise ValueError("Unsupported frame wait model")
    fps_values = config["fps_sensitivity"]
    if not isinstance(fps_values, list) or not fps_values:
        raise ValueError("FPS sensitivity must be a nonempty list")
    fps = numeric(config["camera_fps"])
    if not fps or any(not numeric(f) for f in fps_values):
        raise ValueError("FPS must be positive")
    unknown = []
    low = average = high = 0
    for name in ALLOWANCES:
        item = config["allowances"][name]
        text(item["rationale"])
        if item["mean_ms"] is None:
            unknown.append(name)
            continue
        a, b, c = [numeric(item[k]) for k in
                   ("low_ms", "mean_ms", "high_ms")]
        if not a <= b <= c:
            raise ValueError("Allowance requires low <= mean <= high")
        low += a
        average += b
        high += c
    stages = config["diagnostic_stages"]
    if (not isinstance(stages, list) or not stages
            or len(set(stages)) != len(stages)
            or any(s not in STAGES for s in stages)):
        raise ValueError("Select unique nonoverlapping software stages")
    samples = None
    failures = []
    invalid = []
    if source.get("schemaVersion") == 1 and "metrics" in source:
        text(source["clock"])
        means = []
        for name in stages:
            metric = source["metrics"].get(name)
            if metric is not None and (
                    type(metric.get("count")) is not int
                    or metric["count"] < 0):
                raise ValueError("Stage count must be a nonnegative integer")
            if not metric or not metric.get("count"):
                unknown.append(name)
            elif metric.get("unit") != "ms":
                raise ValueError("Software durations must be milliseconds")
            elif metric.get("mean") is None:
                unknown.append(name)
            else:
                means.append(numeric(metric["mean"]))
        for key in ("commit", "browser", "hardware"):
            if source["metadata"][key] != config["metadata"][key]:
                raise ValueError(f"Profile/config mismatch: {key}")
        software_mean = sum(means) if len(means) == len(stages) else None
        mode = "aggregate-only"
        attempts = None
    elif source.get("schema_version") == 1 and "attempts" in source:
        text(source["clock_convention"])
        if not isinstance(source["attempts"], list):
            raise ValueError("Attempts must be a list")
        samples = []
        for index, trial in enumerate(source["attempts"]):
            if not isinstance(trial, dict):
                invalid.append({"index": index, "attempt": trial})
                continue
            if trial.get("status") != "ok":
                failures.append({"index": index, "attempt": trial})
                continue
            try:
                samples.append(sum(numeric(trial["durations_ms"][name])
                                   for name in stages))
            except (KeyError, ValueError, TypeError):
                invalid.append({"index": index, "attempt": trial})
        attempts = len(source["attempts"])
        software_mean = stats(samples)["mean_ms"]
        mode = "paired-durations"
    else:
        raise ValueError("Expected #38 report or paired duration input")
    complete = not unknown and software_mean is not None
    scenarios = []
    for rate in dict.fromkeys([fps, *fps_values]):
        for label, allowance in (("low", low), ("central", average),
                                 ("high", high)):
            distribution = stats([])
            if complete and samples:
                # Deterministic integration grid, not confidence intervals.
                modeled = [s + allowance + (i + 0.5) / 100 * 1000 / rate
                           for s in samples for i in range(100)]
                distribution = stats(modeled)
            mean = (software_mean + allowance + 500 / rate
                    if complete else None)
            scenarios.append({
                "camera_fps": rate, "allowance_scenario": label,
                "modeled_frame_wait_mean_ms": 500 / rate,
                "assumed_allowance_total_ms": allowance if not unknown
                else None,
                "mean_ms": mean, "modeled_distribution": distribution,
                "mean_at_or_over_50_ms": mean >= 50 if mean is not None
                else None,
            })
    return {
        "schema_version": 2, "kind": "latency-estimate",
        "scope": "Software/model estimate under supplied assumptions",
        "estimate_status": "ESTIMATED" if complete else "INCOMPLETE",
        "mode": mode, "config": config, "input_source": source,
        "component_classification": {
            "selected_software_stages": "input durations; provenance retained",
            "frame_alignment_wait": "modeled uniform random phase",
            "allowances": "assumed or explicitly unknown",
        },
        "unknown_components": unknown, "software_mean_ms": software_mean,
        "input_paired_distribution": stats(samples or []),
        "attempt_count": attempts, "failures": failures,
        "invalid_attempts": invalid, "scenarios": scenarios,
        "limitations": [
            "Results describe the supplied software/simulation scenario.",
            "Allowances are assumptions; scenarios are not confidence bounds.",
            "Uniform frame phase assumes random independent arrival.",
            "Modeled sample maximum is not a physical worst-case bound.",
            "Aggregate stage quantiles are retained but never added.",
            "Paired distributions exclude listed failed/invalid attempts.",
            "Software coverage and nonoverlap require justification.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("profile", "config", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    try:
        report = estimate(json.loads(args.profile.read_text()),
                          json.loads(args.config.read_text()))
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(2, f"Invalid profile/config: {error}\n")
    report["source_sha256"] = hashlib.sha256(
        args.profile.read_bytes()).hexdigest()
    args.output.write_text(
        json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(f"{report['estimate_status']}: software/model latency scenario")
    return 0 if report["estimate_status"] == "ESTIMATED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
