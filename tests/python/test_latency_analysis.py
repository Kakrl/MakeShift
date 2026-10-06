"""Generated PCM fixtures are analyzer evidence, never physical evidence."""

import json
import math
import struct
import subprocess
import sys
import wave
from pathlib import Path

import pytest
from latency_analysis import METADATA, analyze, onsets


def fixture(tmp_path, delays=(20, 49, 50, 80), rate=48000):
    path = tmp_path / "synthetic.wav"
    count = rate * (len(delays) + 1)
    reference = [0] * count
    audio = [0] * count
    for i, delay in enumerate(delays):
        start = round((i + 0.1) * rate)
        for j in range(round(rate * 0.01)):
            reference[start + j] = 16000
            if delay is not None:
                audio[start + round(delay * rate / 1000) + j] = 16000
    with wave.open(str(path), "wb") as output:
        output.setparams((2, 2, rate, count, "NONE", "not compressed"))
        output.writeframes(b"".join(struct.pack("<hh", a, b)
                                    for a, b in zip(reference, audio)))
    config = {
        "schema_version": 1,
        "metadata": dict.fromkeys(METADATA, "synthetic fixture"),
        "phase": "warm", "correction_ms": 0, "uncertainty_ms": 0,
        "response_window_ms": 300,
        "reference_detector": {
            "threshold": 0.1, "sustain_ms": 1, "quiet_ms": 20},
        "audio_detector": {
            "threshold": 0.1, "sustain_ms": 1, "quiet_ms": 20},
        "trials": [{"start_ms": i * 1000, "end_ms": (i + 1) * 1000}
                   for i in range(len(delays))],
    }
    config["metadata"]["output_route"] = "wired"
    return path, config


@pytest.mark.parametrize("rate", [44100, 48000, 96000])
def test_known_delays_and_strict_threshold(tmp_path, rate):
    path, config = fixture(tmp_path, rate=rate)
    result = analyze(path, config)
    assert [r["latency_ms"] for r in result["trials"]] == pytest.approx(
        [20, 49, 50, 80], abs=1000 / rate)
    assert result["p50_ms"] == pytest.approx(49, abs=1000 / rate)
    assert result["p95_ms"] == 80
    assert result["maximum_ms"] == 80
    assert result["proportion_at_or_over_50_ms"] == 0.5
    assert result["result"] == "FAIL"
    assert result["trials"][2]["status"] != "pass"


def test_missing_audio_retained_in_denominator(tmp_path):
    path, config = fixture(tmp_path, (20, None))
    result = analyze(path, config)
    assert result["attempt_count"] == 2
    assert result["measured_count"] == 1
    assert result["nonpassing_attempt_fraction"] == 0.5
    assert result["trials"][1]["status"] == "missing-audio"
    assert result["result"] == "FAIL"


def test_uncertainty_and_calibration(tmp_path):
    path, config = fixture(tmp_path, (52,))
    config.update(correction_ms=5, uncertainty_ms=4)
    result = analyze(path, config)
    assert result["trials"][0]["latency_ms"] == 47
    assert result["result"] == "INCONCLUSIVE"
    config["uncertainty_ms"] = 1
    assert analyze(path, config)["result"] == "PASS"
    config["correction_ms"] = 60
    assert analyze(path, config)["trials"][0]["status"] == "invalid-timing"


def test_absent_reference_is_not_pass(tmp_path):
    path, config = fixture(tmp_path, (20,))
    config["trials"] = [{"start_ms": 500, "end_ms": 900}]
    result = analyze(path, config)
    assert result["measured_count"] == 0
    assert result["p50_ms"] is None
    assert result["unmatched_reference_onsets"] == 1
    assert result["unmatched_audio_onsets"] == 1
    assert result["result"] != "PASS"


def test_transients_rearming_and_ambiguous_audio(tmp_path):
    assert onsets([0] * 100 + [1] + [0] * 100, 1000, 0.5, 4, 20) == []
    signal = [0] * 100 + [0.5] * 10 + [0] * 40 + [0.5] * 10
    assert len(onsets(signal, 1000, 0.1, 1, 20)) == 2
    path, config = fixture(tmp_path, (20, 80))
    config["trials"] = [{"start_ms": 0, "end_ms": 2000}]
    # Two references in a trial cannot silently select the first.
    assert analyze(path, config)["trials"][0]["status"] == "invalid-reference"
    config["trials"] = [{"start_ms": 0, "end_ms": 1000}]
    config["response_window_ms"] = 1500
    with pytest.raises(ValueError, match="full response"):
        analyze(path, config)


@pytest.mark.parametrize("field,value", [
    ("uncertainty_ms", -1), ("correction_ms", float("nan")),
    ("phase", "mixed"), ("response_window_ms", True),
    ("schema_version", 2),
])
def test_reject_invalid_configuration(tmp_path, field, value):
    path, config = fixture(tmp_path, (20,))
    config[field] = value
    with pytest.raises(ValueError):
        analyze(path, config)


def test_metadata_and_overlapping_windows(tmp_path):
    path, config = fixture(tmp_path, (20, 20))
    config["trials"][1]["start_ms"] = 900
    with pytest.raises(ValueError, match="ordered"):
        analyze(path, config)
    del config["metadata"]["camera_fps"]
    with pytest.raises(ValueError, match="camera_fps"):
        analyze(path, config)


def test_reject_wrong_wav_format(tmp_path):
    path = tmp_path / "mono.wav"
    with wave.open(str(path), "wb") as output:
        output.setparams((1, 2, 48000, 1, "NONE", "not compressed"))
        output.writeframes(b"\0\0")
    _, config = fixture(tmp_path, (20,))
    with pytest.raises(ValueError, match="stereo"):
        analyze(path, config)


def test_extra_audio_and_ambiguous_response(tmp_path):
    path, config = fixture(tmp_path, (20,))
    with wave.open(str(path), "rb") as source:
        params = source.getparams()
        frames = bytearray(source.readframes(source.getnframes()))
    # Add a second separated acoustic burst inside the response interval.
    for i in range(48000 // 5, 48000 // 5 + 480):
        struct.pack_into("<h", frames, i * 4 + 2, 16000)
    with wave.open(str(path), "wb") as output:
        output.setparams(params)
        output.writeframes(frames)
    result = analyze(path, config)
    assert result["trials"][0]["status"] == "ambiguous-audio"
    assert result["result"] == "INCONCLUSIVE"
    config["response_window_ms"] = 50
    result = analyze(path, config)
    assert result["trials"][0]["status"] == "pass"
    assert result["unmatched_audio_onsets"] == 1
    assert result["result"] == "FAIL"


def test_all_missing_has_no_distribution(tmp_path):
    path, config = fixture(tmp_path, (None, None))
    result = analyze(path, config)
    assert result["result"] == "FAIL"
    assert result["measured_count"] == 0
    assert result["maximum_ms"] is None
    assert result["proportion_over_50_ms"] is None
    assert result["nonpassing_attempt_fraction"] == 1


def test_sine_bursts_with_noise_have_known_relative_delay(tmp_path):
    path, config = fixture(tmp_path, (25,))
    rate = 48000
    frames = []
    for i in range(rate * 2):
        pair = []
        for offset in (4800, 6000):
            t = i - offset
            # Shared deterministic noise and ramped sine shape shifted 25 ms.
            value = 50 * math.sin(t * 0.7)
            if 0 <= t < 2400:
                ramp = min(1, t / 240)
                value += 12000 * ramp * math.sin(2 * math.pi * 440 * t / rate)
            pair.append(round(value))
        frames.append(struct.pack("<hh", *pair))
    with wave.open(str(path), "wb") as output:
        output.setparams((2, 2, rate, rate * 2, "NONE", "not compressed"))
        output.writeframes(b"".join(frames))
    result = analyze(path, config)
    assert result["measured_count"] == 1
    assert result["trials"][0]["latency_ms"] == pytest.approx(25)
    assert result["result"] == "PASS"


@pytest.mark.parametrize("delay,exit_code", [(20, 0), (80, 1)])
def test_cli_report_and_failure_exit(tmp_path, delay, exit_code):
    path, config = fixture(tmp_path, (delay,))
    config_path = tmp_path / "config.json"
    report_path = tmp_path / "report.json"
    config_path.write_text(json.dumps(config))
    script = Path(__file__).with_name("latency_analysis.py")
    result = subprocess.run(
        [sys.executable, str(script), str(path), str(config_path),
         str(report_path)], capture_output=True, text=True, check=False,
    )
    assert result.returncode == exit_code, result.stderr
    report = json.loads(report_path.read_text())
    assert report["maximum_ms"] == delay
    assert len(report["capture_sha256"]) == 64
    assert report["analysis_config"] == config
