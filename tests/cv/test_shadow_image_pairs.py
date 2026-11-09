"""Reference selection for the native image runner, without camera hardware."""

import contextlib
import io
import json
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

RUNNER = runpy.run_path(str(
    Path(__file__).resolve().parents[2] / "backend/run_shadow_images.py"
))
discover_cases = RUNNER["discover_cases"]


class ImagePairTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name).resolve()

    def files(self, *names):
        for name in names:
            (self.root / name).touch()

    def test_legacy_background_retains_self_check_and_order(self):
        self.files("background.png", "hover.png", "press.png")
        pairs = discover_cases(self.root)
        self.assertEqual(
            [p.name for p, _ in pairs],
            ["background.png", "hover.png", "press.png"],
        )
        self.assertTrue(all(
            ref == self.root / "background.png" for _, ref in pairs
        ))

    def test_paired_reference_wins_and_is_not_a_case(self):
        self.files("background.png", "hover.png", "hover-reference.png")
        pairs = dict(discover_cases(self.root))
        self.assertEqual(
            pairs[self.root / "hover.png"],
            self.root / "hover-reference.png",
        )
        self.assertNotIn(self.root / "hover-reference.png", pairs)

    def test_camera_filter_ignores_older_unpaired_images(self):
        self.files("old.png", "camera-001.png", "camera-001-reference.png")
        self.assertEqual(discover_cases(self.root, "camera-*.png"), [
            (self.root / "camera-001.png",
             self.root / "camera-001-reference.png"),
        ])
        with self.assertRaisesRegex(ValueError, "old.png"):
            discover_cases(self.root)

    def test_missing_camera_reference_does_not_use_shared_background(self):
        self.files("background.png", "camera-001.png")
        with self.assertRaisesRegex(ValueError, "camera-001.png"):
            discover_cases(self.root)

    def test_missing_directory_and_empty_selection(self):
        with self.assertRaisesRegex(ValueError, "does not exist"):
            discover_cases(self.root / "missing")
        with self.assertRaisesRegex(ValueError, "No input images"):
            discover_cases(self.root)

    def test_cli_passes_each_reference_and_records_pairing(self):
        self.files(
            "camera-001.png", "camera-001-reference.png",
            "camera-002.png", "camera-002-reference.png",
        )
        build = self.root / "build"
        output = self.root / "results"
        build.mkdir()
        output.mkdir()
        (build / "shadow_images").touch()
        calls = []

        def fake_native(command, **kwargs):
            calls.append(command)
            options = dict(v[2:].split("=", 1) for v in command[1:])
            folder = output / options["case"]
            folder.mkdir(exist_ok=True)
            (folder / "results.json").write_text(json.dumps({
                "source": options["image"],
                "reference": options["reference"],
                "maximumResidual": 0.125,
                "darkShadowsOnly": True,
                "algorithm": options.get("algorithm", "combined"),
                "lightShadowTest": options.get("algorithm") == "light"
                or options.get("light-shadow-test") == "true",
                "midShadowTest": options.get("algorithm") == "mid"
                or options.get("mid-shadow-test") == "true",
                "fingerMethod": options["finger-method"],
                "shadowMethod": "cr-mask-darkening",
                "otsuRadius": int(options.get("otsu-radius", 2)),
                "minimumAbsoluteCrChange": float(
                    options.get("cr-threshold", 17)
                ),
                "visualization": {"shadowClassMaximumCurrentLuma": 110},
                "candidates": [],
            }))

        arguments = [
            "runner", "--input", str(self.root),
            "--pattern", "camera-*.png", "--output", str(output),
            "--build-dir", str(build), "--dark-shadows-only",
        ]
        with patch("sys.argv", arguments), \
                patch("subprocess.run", side_effect=fake_native), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(RUNNER["main"](), 0)
        self.assertEqual(len(calls), 2)
        for index, command in enumerate(calls, 1):
            self.assertNotIn("--mid-shadow-test=true", command)
            self.assertIn("--finger-method=cr-otsu", command)
            self.assertFalse(any(
                value.startswith("--cr-threshold=") for value in command
            ))
            self.assertFalse(any(
                value.startswith("--otsu-radius=") for value in command
            ))
            reference = self.root / f"camera-{index:03}-reference.png"
            self.assertIn(
                f"--reference={reference}",
                command,
            )
        summary = json.loads((output / "baseline-summary.json").read_text())
        self.assertEqual(len(summary["cases"]), 2)
        self.assertEqual(summary["cases"][0]["minimumAbsoluteCrChange"], 17)
        self.assertEqual(
            summary["cases"][1]["reference"],
            str(self.root / "camera-002-reference.png"),
        )
        calls.clear()
        with patch("sys.argv", arguments + [
            "--cr-threshold", "23", "--otsu-radius", "1",
        ]), \
                patch("subprocess.run", side_effect=fake_native), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(RUNNER["main"](), 0)
        self.assertTrue(all("--cr-threshold=23.0" in c for c in calls))
        self.assertTrue(all("--otsu-radius=1" in c for c in calls))
        summary = json.loads((output / "baseline-summary.json").read_text())
        self.assertEqual(summary["cases"][0]["minimumAbsoluteCrChange"], 23)
        calls.clear()
        with patch("sys.argv", arguments + [
            "--light-shadow-test", "--mid-shadow-test",
        ]), \
                patch("subprocess.run", side_effect=fake_native), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(RUNNER["main"](), 0)
        self.assertTrue(all("--mid-shadow-test=true" in c for c in calls))
        summary = json.loads((output / "baseline-summary.json").read_text())
        self.assertTrue(all(c["midShadowTest"] for c in summary["cases"]))
        self.assertTrue((output / "dark-plus-light-plus-mid-results.csv").is_file())
        page = (output / "index.html").read_text()
        self.assertIn("000/comparison.png", page)
        self.assertNotIn("mid-shadow.png", page)
        self.assertNotIn("light-shadow.png", page)
        # Each selector works without legacy flags and retains a distinct CSV.
        independent_args = [v for v in arguments if v != "--dark-shadows-only"]
        for algorithm in ("dark", "light", "mid"):
            calls.clear()
            with patch("sys.argv", independent_args + ["--algorithm", algorithm]), \
                    patch("subprocess.run", side_effect=fake_native), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(RUNNER["main"](), 0)
            self.assertTrue(all(f"--algorithm={algorithm}" in c for c in calls))
            self.assertTrue(all("--dark-shadows-only=true" in c for c in calls))
            self.assertTrue(all("--light-shadow-test=true" not in c for c in calls))
            self.assertTrue(all("--mid-shadow-test=true" not in c for c in calls))
            summary = json.loads((output / "baseline-summary.json").read_text())
            self.assertTrue(all(c["algorithm"] == algorithm for c in summary["cases"]))
            self.assertTrue((output / f"{algorithm}-only-results.csv").is_file())
            self.assertIn(f"Algorithm: {algorithm}", (output / "index.html").read_text())
        # A partial run with different per-case algorithms cannot overwrite
        # an earlier uniform algorithm snapshot.
        snapshot = output / "light-only-results.csv"
        snapshot.write_text("preserve uniform snapshot")
        with patch("sys.argv", independent_args + ["--algorithm", "light", "--case", "000"]), \
                patch("subprocess.run", side_effect=fake_native), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(RUNNER["main"](), 0)
        self.assertEqual(snapshot.read_text(), "preserve uniform snapshot")

    def test_independent_selector_rejects_ambiguous_flags(self):
        for arguments in (["--algorithm", "mid", "--light-shadow-test"],
                          ["--algorithm", "dark", "--mid-shadow-test"],
                          ["--algorithm", "invalid"]):
            with self.subTest(arguments=arguments), \
                    patch("sys.argv", ["runner", *arguments]), \
                    patch("subprocess.run") as native, \
                    contextlib.redirect_stderr(io.StringIO()), \
                    self.assertRaises(SystemExit) as error:
                RUNNER["main"]()
            self.assertEqual(error.exception.code, 2)
            native.assert_not_called()

    def test_mid_requires_dark_only_before_running_native(self):
        with patch("sys.argv", ["runner", "--mid-shadow-test"]), \
                patch("subprocess.run") as native, \
                contextlib.redirect_stderr(io.StringIO()), \
                self.assertRaises(SystemExit) as error:
            RUNNER["main"]()
        self.assertEqual(error.exception.code, 2)
        native.assert_not_called()


if __name__ == "__main__":
    unittest.main()
