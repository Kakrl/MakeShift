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
        "--dark-shadows-only", action="store_true",
        help="Run DFS only on the purple dark-shadow class.",
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
        "--input", type=Path, default=ROOT / "images_test_cases",
    )
    parser.add_argument(
        "--output", type=Path, default=ROOT / "backend/test-results",
        help="Existing results directory; numbered cases are overwritten.",
    )
    parser.add_argument("--build-dir", type=Path, default=ROOT / "build/mog2")
    args = parser.parse_args()
    if args.residual is not None and (
        not math.isfinite(args.residual) or args.residual < 0
    ):
        parser.error("--residual must be finite and nonnegative")
    source_dir = args.input.resolve()
    output = args.output.resolve()
    build = args.build_dir.resolve()
    reference = source_dir / "background.png"
    if not reference.is_file():
        parser.error(f"Missing empty reference: {reference}")
    if not output.is_dir():
        parser.error(f"Results directory must already exist: {output}")
    images = sorted(
        p for p in source_dir.iterdir()
        if p.is_file() and p.suffix.lower() in EXTENSIONS
    )
    if len(images) > 1000:
        parser.error("At most 1000 numbered cases are supported")
    cases = {f"{index:03d}": image for index, image in enumerate(images)}
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
        for case, image in cases.items():
            if case not in selected:
                continue
            residual_label = (
                f"{args.residual:g}" if args.residual is not None
                else "native default"
            )
            print(f"Case {case}, residual {residual_label}", flush=True)
            subprocess.run(
                [
                    str(executable), f"--image={image}",
                    f"--reference={reference}", f"--output={output}",
                    f"--case={case}",
                    *([f"--residual={args.residual}"]
                      if args.residual is not None else []),
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
        'gray: ignored lighter shadows; white: clear; black: unavailable. '
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
    for case, image in cases.items():
        report_path = output / case / "results.json"
        if not report_path.is_file():
            continue
        report = json.loads(report_path.read_text())
        # Exclude a stale folder if the sorted input list has changed.
        if Path(report["source"]).resolve() != image.resolve():
            continue
        residual = report["maximumResidual"]
        cutoff = report["visualization"]["shadowClassMaximumCurrentLuma"]
        dark_only = bool(report.get("darkShadowsOnly", False))
        mode = "dark only" if dark_only else "all shadows"
        cells = ["-"] * 20
        coordinates = ["-"] * 20
        for candidate in report["candidates"]:
            column = candidate["id"] - 1
            level = next(
                v for v in candidate["levels"] if v["threshold"] == 20
            )
            cells[column] = decisions[level["decision"]]
            coordinates[column] = (
                f"x={candidate['x']} y={candidate['y']} "
                f"width={candidate['width']}"
            )
        table.append([case, *cells])
        positions.append([case, *coordinates])
        reports.append({
            "id": case, "source": str(image), "residual": residual,
            "shadowClassMaximumCurrentLuma": cutoff,
            "candidates": len(report["candidates"]),
            "darkShadowsOnly": dark_only,
        })
        page.append(
            f'<article><h2><a href="{case}/index.html">'
            f'{case} — {html.escape(image.name)}</a></h2>'
            f'<p>Residual {residual:g}; dark-shadow brightness '
            f'cutoff {cutoff:g}/255; searches: {mode}.</p>'
            f'<a href="{case}/index.html"><img loading="lazy" '
            f'src="{case}/comparison.png"></a></article>'
        )
    page.append(
        '<h2 id="candidate-results">Candidate decisions at cutoff 20</h2>'
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
    mode_name = "dark-shadows" if args.dark_shadows_only else "all-shadows"
    exports = [
        ("results.csv", table),
        ("candidate-positions.csv", positions),
    ]
    if all(
        r["darkShadowsOnly"] == args.dark_shadows_only for r in reports
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
