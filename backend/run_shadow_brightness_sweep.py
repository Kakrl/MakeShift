"""Compare dark-shadow brightness caps using the existing numbered reports.

Run after generating the normal dark-plus-light gallery:
    python3 backend/run_shadow_brightness_sweep.py --rebuild

Writes compact reports and candidate overlays in test-results/brightness-sweep,
preserving the normal gallery. Every case uses its saved source, reference and
Cr/Otsu settings. Other compiled settings must match the saved baseline.
"""

import argparse
import csv
import html
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAPS = (110, 120, 130, 140)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rebuild", action="store_true")
    parser.add_argument(
        "--reports", type=Path, default=ROOT / "backend/test-results",
    )
    parser.add_argument("--build-dir", type=Path, default=ROOT / "build/mog2")
    args = parser.parse_args()
    base = args.reports.resolve()
    snapshots = {
        p.parent.name: json.loads(p.read_text())
        for p in sorted(base.glob("[0-9][0-9][0-9]/results.json"))
    }
    if not snapshots:
        parser.error("Generate the numbered baseline reports first")
    for case, report in snapshots.items():
        if (not report.get("darkShadowsOnly")
                or not report.get("lightShadowTest")
                or report.get("maximumSearchCurrentLuma") != 110):
            parser.error(f"{case}: expected dark-plus-light baseline at110")
    if args.rebuild:
        subprocess.run(
            ["cmake", "--build", str(args.build_dir), "--parallel", "4"],
            cwd=ROOT, check=True,
        )
    output = base / "brightness-sweep"
    output.mkdir(exist_ok=True)
    (output / "baseline.json").write_text(json.dumps(snapshots))
    rows = []
    cards = []
    summaries = []
    for case, baseline in snapshots.items():
        runs = {}
        for cap in CAPS:
            folder = output / str(cap)
            folder.mkdir(exist_ok=True)
            command = [
                str(args.build_dir.resolve() / "shadow_images"),
                f"--image={baseline['source']}",
                f"--reference={baseline['reference']}",
                f"--output={folder}", f"--case={case}",
                f"--finger-method={baseline['fingerMethod']}",
                f"--cr-threshold={baseline['minimumAbsoluteCrChange']}",
                "--dark-shadows-only=true", "--light-shadow-test=true",
                f"--maximum-shadow-luma={cap}", "--compact-report=true",
            ]
            if baseline["fingerMethod"] == "cr-otsu":
                command.append(f"--otsu-radius={baseline['otsuRadius']}")
            subprocess.run(command, cwd=ROOT, check=True)
            report = json.loads((folder / case / "results.json").read_text())
            for key in (
                "c", "d", "e", "minimumUpwardShadowWidth", "corridorRadius",
                "lightShadowMinimumStrip", "lightShadowBandDepth",
                "lightShadowStripWidthFraction", "lightShadowBlobAreaFraction",
                "lightShadowSideReachWidthFraction", "width", "height",
            ):
                if baseline.get(key) != report.get(key):
                    raise ValueError(
                        f"{case}: compiled setting changed: {key}"
                    )
            original = baseline["candidates"]
            current = report["candidates"]
            def geometry(candidate):
                return tuple(candidate[k] for k in ("id", "x", "y", "width"))
            if list(map(geometry, original)) != list(map(geometry, current)):
                raise ValueError(f"{case}: candidate geometry changed")
            if cap == 110:
                for before, after in zip(original, current):
                    if (before["levels"] != after["levels"]
                            or before["finalDecision"]
                            != after["finalDecision"]):
                        raise ValueError(
                            f"{case}: cap110 differs from baseline"
                        )
            runs[cap] = report
        case_rows = []
        for index, candidate in enumerate(baseline["candidates"]):
            decisions = []
            traces = []
            for cap in CAPS:
                current = runs[cap]["candidates"][index]
                final = current["finalDecision"]
                text = (current["decisionSource"] + " MATCH" if final == 1
                        else "NO_MATCH" if final == 0 else "UNKNOWN")
                decisions.append(text)
                level = current["levels"][1]
                traces.append({
                    "cap": cap, "finalDecision": final,
                    "darkDecision": level["decision"],
                    "downwardVeto": level["downwardVeto"],
                    "upwardReached": level["upwardReached"],
                    "lightReason": current["lightShadow"]["reason"],
                })
            row = [case, candidate["id"], candidate["x"], candidate["y"],
                   *decisions]
            rows.append(row)
            case_rows.append(row)
            summaries.append({
                "case": case, "id": candidate["id"],
                "x": candidate["x"], "y": candidate["y"], "runs": traces,
            })
        cards.append(
            f'<article id="case-{case}"><h2>{case} — '
            f'{html.escape(Path(baseline["source"]).name)}</h2>'
            '<div class="grid">'
            + ''.join(
                f'<figure><figcaption>Maximum brightness {cap}</figcaption>'
                f'<a href="{cap}/{case}/results.json">JSON trace</a>'
                f'<img loading="lazy" src="{cap}/{case}/candidates.png">'
                '</figure>' for cap in CAPS
            ) + '</div><table><tr><th>Candidate</th>'
            + ''.join(f'<th>{cap}</th>' for cap in CAPS) + '</tr>'
            + ''.join(
                '<tr><td>' + str(row[1]) + '</td>'
                + ''.join(f'<td>{v}</td>' for v in row[4:]) + '</tr>'
                for row in case_rows
            ) + '</table></article>'
        )
        print(f"Completed {case}", flush=True)
    with (output / "results.csv").open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["case", "candidate", "x", "y", *CAPS])
        writer.writerows(rows)
    (output / "summary.json").write_text(json.dumps(summaries, indent=2))
    (output / "index.html").write_text(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" '
        'content="width=device-width,initial-scale=1">'
        '<title>Dark-shadow brightness sweep</title><style>'
        'body{font-family:system-ui;margin:24px;background:#181818;color:#eee}'
        'a{color:#8dcaff}.grid{display:grid;grid-template-columns:'
        'repeat(auto-fit,minmax(300px,1fr))}figure{margin:8px}img{width:100%}'
        'td,th{border:1px solid #777;padding:6px}article{margin-bottom:40px}'
        '</style><h1>Dark-shadow brightness sweep</h1>'
        '<p>Caps110/120/130/140; brightness scale0 black to255 white. '
        'Drop&gt;20 remains required for dark DFS. Green match, red no match, '
        'gray unknown. Light fallback unchanged. '
        'Contact interpretation is manual.</p>'
        '<p><a href="results.csv">CSV</a> · '
        '<a href="summary.json">Decision summary</a></p>'
        + '\n'.join(cards)
    )
    print(f"Gallery: {output / 'index.html'}")


if __name__ == "__main__":
    main()
