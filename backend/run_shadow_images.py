"""Run the native shadow image reports in reusable numbered case folders.

Examples (from the repository root):
    python3 backend/run_shadow_images.py
    python3 backend/run_shadow_images.py --residual 0.16
    python3 backend/run_shadow_images.py --rebuild --case 001 002
"""

import argparse
import csv
import html
import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def discover_cases(
    source_dir: Path, pattern: str = "*",
) -> list[tuple[Path, Path]]:
    """Pair camera captures first; retain legacy shared-background cases."""
    if not source_dir.is_dir():
        raise ValueError(f"Input directory does not exist: {source_dir}")
    images = sorted(
        p for p in source_dir.iterdir()
        if p.is_file() and p.suffix.lower() in EXTENSIONS
        and not p.stem.lower().endswith("-reference") and p.match(pattern)
    )
    if not images:
        raise ValueError(f"No input images match {pattern!r} in {source_dir}")
    if len(images) > 1000:
        raise ValueError("At most 1000 numbered cases are supported")
    pairs = []
    missing = []
    for image in images:
        reference = image.with_name(f"{image.stem}-reference.png")
        if not reference.is_file():
            # Camera snapshots taken before B have no valid reference. Never
            # silently substitute a shared background for such a capture.
            if image.stem.startswith("camera-"):
                missing.append(image.name)
                continue
            reference = source_dir / "background.png"
        if not reference.is_file():
            missing.append(image.name)
            continue
        pairs.append((image, reference))
    if missing:
        raise ValueError(
            "Missing reference for: " + ", ".join(missing)
            + ". Supply <photo-stem>-reference.png (camera captures need B "
            "before S), or background.png for legacy images. Use --pattern "
            "to select only the intended cases."
        )
    return pairs


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--residual", type=float,
        help="Override the C++ CandidateFilter default (currently 0.125).",
    )
    parser.add_argument(
        "--finger-method", choices=("cr-otsu", "cr", "projection"),
        default="cr-otsu",
        help="Cr modes use mask + darkening shadows; projection is legacy.",
    )
    parser.add_argument(
        "--cr-threshold", type=float,
        help="Override the compiled Cr threshold, in 0..255 units.",
    )
    parser.add_argument(
        "--otsu-radius", type=int, choices=(1, 2),
        help="Maximum fingertip expansion: analysis pixels (native default2).",
    )
    parser.add_argument(
        "--dark-shadows-only", action="store_true",
        help="Run DFS only on the purple dark-shadow class.",
    )
    parser.add_argument(
        "--light-shadow-test", action="store_true",
        help="Try clear-front/side-shadow fallback after dark failure.",
    )
    parser.add_argument(
        "--rebuild", action="store_true",
        help="Rebuild C++ after editing its constants.",
    )
    parser.add_argument(
        "--case", nargs="+", dest="cases", metavar="NNN",
        help="Only rerun these case IDs; default: all images.",
    )
    parser.add_argument(
        "--input", type=Path, default=ROOT / "experiment",
    )
    parser.add_argument(
        "--pattern", default="*",
        help="Input filename glob, e.g. 'camera-*.png'; excludes references.",
    )
    parser.add_argument(
        "--output", type=Path, default=ROOT / "backend/test-results",
        help="Existing results directory; numbered cases are overwritten.",
    )
    parser.add_argument("--build-dir", type=Path, default=ROOT / "build/mog2")
    args = parser.parse_args()
    if args.cr_threshold is not None and (
        not math.isfinite(args.cr_threshold)
        or not 0 <= args.cr_threshold <= 255
    ):
        parser.error("--cr-threshold must be finite and within 0..255")
    if args.residual is not None and (
        not math.isfinite(args.residual) or args.residual < 0
    ):
        parser.error("--residual must be finite and nonnegative")
    if args.light_shadow_test and not args.dark_shadows_only:
        parser.error("--light-shadow-test requires --dark-shadows-only")
    source_dir = args.input.resolve()
    output = args.output.resolve()
    build = args.build_dir.resolve()
    if not output.is_dir():
        parser.error(f"Results directory must already exist: {output}")
    try:
        pairs = discover_cases(source_dir, args.pattern)
    except ValueError as error:
        parser.error(str(error))
    cases = {f"{index:03d}": pair for index, pair in enumerate(pairs)}
    selected = set(args.cases) if args.cases else set(cases)
    if selected - cases.keys():
        parser.error(f"Unknown case IDs: {sorted(selected - cases.keys())}")

    try:
        if args.rebuild:
            subprocess.run(
                ["cmake", "--build", str(build), "--parallel", "4"],
                cwd=ROOT, check=True,
            )
        executable = build / "shadow_images"
        if not executable.is_file():
            parser.error(f"Native runner not built: {executable}")
        for case, (image, reference) in cases.items():
            if case not in selected:
                continue
            residual_label = (
                f"{args.residual:g}" if args.residual is not None
                else "native default"
            )
            cr_label = (
                f"{args.cr_threshold:g}" if args.cr_threshold is not None
                else "native default"
            )
            print(
                f"Case {case}, finger mask {args.finger_method}, "
                f"Cr threshold {cr_label}, "
                f"projection residual {residual_label} "
                "(context only in Cr modes)", flush=True,
            )
            subprocess.run(
                [
                    str(executable), f"--image={image}",
                    f"--reference={reference}", f"--output={output}",
                    f"--case={case}",
                    f"--finger-method={args.finger_method}",
                    *([f"--otsu-radius={args.otsu_radius}"]
                      if args.otsu_radius is not None else []),
                    *([f"--cr-threshold={args.cr_threshold}"]
                      if args.cr_threshold is not None else []),
                    *([f"--residual={args.residual}"]
                      if args.residual is not None else []),
                    *(["--light-shadow-test=true"]
                      if args.light_shadow_test else []),
                    *(["--dark-shadows-only=true"]
                      if args.dark_shadows_only else []),
                ],
                cwd=ROOT, check=True,
            )
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"Image export failed: {error}", file=sys.stderr)
        return 1

    page = [
        '<!doctype html><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<title>Shadow image reports</title>',
        '<style>body{font-family:system-ui;background:#181818;color:#eee;'
        'margin:24px}a{color:#8dcaff}img{width:100%;height:auto}'
        'article{margin-bottom:40px}table{border-collapse:collapse}'
        'td,th{border:1px solid #555;padding:5px}</style>',
        '<h1>Shadow image reports</h1>',
        '<p>Dark blue: finger proposals; purple: considered dark shadows; '
        'gray: lighter shadows; white: clear; black: unavailable. '
        'Light fallback uses both light and dark shadows. '
        'Each case records its own settings.</p>',
        '<p><a href="#candidate-results">Candidate result table</a> · '
        '<a href="results.csv">CSV for diffing</a></p>',
    ]
    reports = []
    if (output / "search-comparison.html").is_file():
        page.append(
            '<p><a href="search-comparison.html">'
            'Compare all-shadow and dark-only exports</a></p>'
        )
    table = []
    positions = []
    decisions = {-1: "UNKNOWN", 0: "NO_MATCH", 1: "MATCH"}
    for case, (image, reference) in cases.items():
        report_path = output / case / "results.json"
        if not report_path.is_file():
            continue
        report = json.loads(report_path.read_text())
        # Exclude a stale folder if the sorted input list has changed.
        if (Path(report["source"]).resolve() != image.resolve()
                or Path(report["reference"]).resolve() != reference.resolve()):
            continue
        residual = report["maximumResidual"]
        cutoff = report["visualization"]["shadowClassMaximumCurrentLuma"]
        dark_only = bool(report.get("darkShadowsOnly", False))
        finger_method = report.get("fingerMethod", "projection")
        cr_threshold = report.get("minimumAbsoluteCrChange", 10)
        otsu_radius = report.get("otsuRadius", 0)
        shadow_method = report.get("shadowMethod", "projection")
        mode = "dark only" if dark_only else "all shadows"
        cells = ["-"] * 20
        coordinates = ["-"] * 20
        for candidate in report["candidates"]:
            column = candidate["id"] - 1
            level = next(
                v for v in candidate["levels"] if v["threshold"] == 20
            )
            cells[column] = decisions[candidate.get("finalDecision", level["decision"])]
            coordinates[column] = (
                f"x={candidate['x']} y={candidate['y']} "
                f"width={candidate['width']}"
            )
        table.append([case, *cells])
        positions.append([case, *coordinates])
        reports.append({
            "id": case, "source": str(image), "reference": str(reference),
            "residual": residual,
            "shadowClassMaximumCurrentLuma": cutoff,
            "candidates": len(report["candidates"]),
            "darkShadowsOnly": dark_only,
            "fingerMethod": finger_method,
            "minimumAbsoluteCrChange": cr_threshold,
            "otsuRadius": otsu_radius,
            "shadowMethod": shadow_method,
            "lightShadowTest": bool(report.get("lightShadowTest", False)),
        })
        light_link = (
            f'<a href="{case}/light-shadow.png">Light-test overlay</a>'
            if report.get("lightShadowTest") else ""
        )
        page.append(
            f'<article><h2><a href="{case}/index.html">'
            f'{case} — {html.escape(image.name)}</a></h2>'
            f'<p>Background: {html.escape(reference.name)}</p>'
            f'<p>Finger mask: {finger_method}; Cr threshold: {cr_threshold:g}'
            f'; Otsu radius: {otsu_radius}.</p>'
            f'<p>Shadow method: {shadow_method}; light fallback: '
            f'{bool(report.get("lightShadowTest", False))}. '
            f'{light_link}</p>'
            f'<p>Projection-only residual setting {residual:g}; brightness '
            f'cutoff {cutoff:g}/255; searches: {mode}.</p>'
            f'<a href="{case}/index.html"><img loading="lazy" '
            f'src="{case}/comparison.png"></a></article>'
        )
    page.append(
        '<h2 id="candidate-results">Dark cutoff 20 plus optional light fallback</h2>'
        '<p><a href="results.csv">Download CSV</a> · '
        '<a href="candidate-positions.csv">Candidate positions</a>. '
        'MATCH is a shadow-pattern result, not confirmed contact; '
        '- means no candidate.</p><div style="overflow:auto"><table>'
    )
    header = ["case", *(f"candidate_{i:02d}" for i in range(1, 21))]
    page.append(
        '<tr>' + ''.join(f'<th>{v}</th>' for v in header) + '</tr>'
    )
    for row in table:
        page.append(
            '<tr>' + ''.join(f'<td>{v}</td>' for v in row) + '</tr>'
        )
    page.append('</table></div>')
    (output / "index.html").write_text("\n".join(page))
    (output / "baseline-summary.json").write_text(
        json.dumps({"cases": reports}, indent=2)
    )
    mode_name = ("dark-plus-light" if args.light_shadow_test else
                 "dark-shadows" if args.dark_shadows_only else "all-shadows")
    exports = [
        ("results.csv", table),
        ("candidate-positions.csv", positions),
    ]
    if all(
        r["lightShadowTest"] == args.light_shadow_test
        and r["darkShadowsOnly"] == args.dark_shadows_only
        and r["fingerMethod"] == args.finger_method
        and r["shadowMethod"] == (
            "projection" if args.finger_method == "projection"
            else "cr-mask-darkening"
        )
        and (args.finger_method == "projection"
             or r["minimumAbsoluteCrChange"] == (
                 args.cr_threshold if args.cr_threshold is not None
                 else reports[0]["minimumAbsoluteCrChange"]
             ))
        and (args.finger_method != "cr-otsu" or r["otsuRadius"] == (
            args.otsu_radius if args.otsu_radius is not None
            else reports[0]["otsuRadius"]
        ))
        for r in reports
    ):
        exports.append((f"{mode_name}-results.csv", table))
    for filename, rows in exports:
        with (output / filename).open("w", newline="") as stream:
            writer = csv.writer(stream, lineterminator="\n")
            writer.writerow(header)
            writer.writerows(rows)
    print(f"Decision table (cutoff 20): {output / 'results.csv'}")
    print(f"Finished {len(selected)} cases. Gallery: {output / 'index.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
