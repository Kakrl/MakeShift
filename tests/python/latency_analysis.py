"""Offline physical latency analysis; see docs/latency_benchmark.md."""

import argparse
import hashlib
import json
import math
import struct
import wave
from pathlib import Path

METADATA = (
    "commit", "tester", "date", "browser", "os", "hardware", "camera",
    "camera_fps", "camera_resolution", "output_device", "output_route",
    "settings", "physical_reference", "capture_device", "synchronization",
    "onset_validation", "accuracy_evidence",
)


def number(value, name, minimum=0):
    """Reject booleans and nonfinite or out-of-range measurement values."""
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or value < minimum):
        raise ValueError(f"Invalid {name}")
    return value


def read_capture(path):
    """Read uncompressed stereo PCM16, keeping both channels on one clock."""
    with wave.open(str(path), "rb") as capture:
        if (capture.getnchannels() != 2 or capture.getsampwidth() != 2
                or capture.getcomptype() != "NONE"):
            raise ValueError("Capture must be stereo uncompressed PCM16 WAV")
        rate = capture.getframerate()
        count = capture.getnframes()
        raw = capture.readframes(count)
    if not count or len(raw) != count * 4:
        raise ValueError("Empty or truncated capture")
    pairs = list(struct.iter_unpack("<hh", raw))
    channels = [[pair[c] / 32768 for pair in pairs] for c in (0, 1)]
    return rate, channels


def onsets(samples, rate, threshold, sustain_ms, quiet_ms):
    """Rectified moving-average crossings, rearmed after sustained quiet.

    Timestamp is the end of the causal averaging window. Calibration must
    include its delay; a single-sample impulse cannot trigger a full window.
    """
    number(threshold, "threshold", 1 / 32768)
    if threshold >= 1:
        raise ValueError("Threshold must be below full scale")
    width = max(1, math.ceil(number(sustain_ms, "sustain_ms") * rate / 1000))
    quiet = max(1, math.ceil(number(quiet_ms, "quiet_ms") * rate / 1000))
    total = 0.0
    armed = True
    below = 0
    result = []
    for i, sample in enumerate(samples):
        total += abs(sample)
        if i >= width:
            total -= abs(samples[i - width])
        active = i >= width - 1 and total / width >= threshold
        if active:
            if armed:
                result.append(i * 1000 / rate)
                armed = False
            below = 0
        else:
            below += 1
            if below >= quiet:
                armed = True
    return result


def percentile(values, fraction):
    if not values:
        return None
    return sorted(values)[math.ceil(len(values) * fraction) - 1]


def analyze(path, config):
    """Keep missing/ambiguous trials in the denominator; never infer a pass."""
    if (type(config.get("schema_version")) is not int
            or config["schema_version"] != 1):
        raise ValueError("Expected schema_version 1")
    metadata = config.get("metadata", {})
    for key in METADATA:
        value = str(metadata.get(key, "")).strip()
        if not value or value.upper().startswith("TODO"):
            raise ValueError(f"Missing metadata: {key}")
    if metadata["output_route"] not in ("wired", "built-in", "bluetooth"):
        raise ValueError("Invalid output_route")
    if config.get("phase") not in ("startup", "warm"):
        raise ValueError("Separate startup and warm captures")
    correction = number(config["correction_ms"], "correction_ms", -math.inf)
    uncertainty = number(config["uncertainty_ms"], "uncertainty_ms")
    deadline = number(config["response_window_ms"], "response_window_ms", 50)
    rate, channels = read_capture(path)
    uncertainty += 1000 / rate  # conservative two-channel quantization bound
    detected = []
    for channel, key in enumerate(("reference_detector", "audio_detector")):
        settings = config[key]
        detected.append(onsets(channels[channel], rate, **settings))
    references, audio = detected
    windows = config["trials"]
    if not isinstance(windows, list) or not windows:
        raise ValueError("Expected nonempty trial windows")
    previous_end = -1
    used_reference = set()
    used_audio = set()
    rows = []
    for index, window in enumerate(windows):
        start = number(window["start_ms"], "start_ms")
        end = number(window["end_ms"], "end_ms")
        if (end <= start or start < previous_end
                or end > len(channels[0]) * 1000 / rate):
            raise ValueError("Trial windows must be ordered and disjoint")
        previous_end = end
        refs = [i for i, t in enumerate(references) if start <= t < end]
        used_reference.update(refs)
        row = {"trial": index + 1, "reference_ms": None,
               "audio_ms": None, "latency_ms": None,
               "status": "invalid-reference"}
        if len(refs) == 1:
            ref = references[refs[0]]
            row["reference_ms"] = ref
            if ref + deadline > end:
                raise ValueError("Trial must include full response window")
            hits = [i for i, t in enumerate(audio)
                    if ref <= t <= ref + deadline]
            used_audio.update(hits)
            row["status"] = "missing-audio" if not hits else "ambiguous-audio"
            if len(hits) == 1:
                sound = audio[hits[0]]
                latency = sound - ref - correction
                row.update(audio_ms=sound, latency_ms=latency)
                if latency < 0:
                    row["status"] = "invalid-timing"
                elif latency - uncertainty >= 50:
                    row["status"] = "fail"
                elif latency + uncertainty < 50:
                    row["status"] = "pass"
                else:
                    row["status"] = "inconclusive"
        rows.append(row)
    values = [r["latency_ms"] for r in rows
              if r["latency_ms"] is not None and r["latency_ms"] >= 0]
    extra_reference = len(references) - len(used_reference)
    extra_audio = len(audio) - len(used_audio)
    statuses = [r["status"] for r in rows]
    overall = "INCONCLUSIVE"
    if "fail" in statuses or "missing-audio" in statuses or extra_audio:
        overall = "FAIL"
    elif all(s == "pass" for s in statuses) and not extra_reference:
        overall = "PASS"
    return {
        "schema_version": 1, "kind": "physical-capture-analysis",
        "metadata": metadata, "phase": config["phase"],
        "capture_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "sample_rate": rate, "analysis_config": config,
        "uncertainty_ms": uncertainty, "trials": rows,
        "attempt_count": len(rows), "measured_count": len(values),
        "p50_ms": percentile(values, 0.5),
        "p95_ms": percentile(values, 0.95),
        "maximum_ms": max(values) if values else None,
        "proportion_over_50_ms": (
            sum(v > 50 for v in values) / len(values) if values else None),
        "proportion_at_or_over_50_ms": (
            sum(v >= 50 for v in values) / len(values) if values else None),
        "nonpassing_attempt_fraction": 1 - statuses.count("pass") / len(rows),
        "unmatched_reference_onsets": extra_reference,
        "unmatched_audio_onsets": extra_audio, "result": overall,
        "limitations": "Threshold onset is an acoustic proxy, not a hearing "
        "test. Distributions exclude missing/invalid trials; see all rows. "
        "Software stage timings are separate; no clock subtraction or sum.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument("config", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        report = analyze(args.capture, json.loads(args.config.read_text()))
    except (ValueError, KeyError, TypeError, wave.Error) as error:
        parser.exit(2, f"Invalid capture/configuration: {error}\n")
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"{report['result']}: {report['measured_count']}/"
          f"{report['attempt_count']} trials measured")
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
