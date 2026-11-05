# CV shadow handoff — native baseline, MOG2 and KNN

Updated November 4, 2026. **Start here for the current native experiment.**
The [older handoff](../docs/cv_shadow_detection_status_and_next_steps.md) is
historical background; its earlier stopping points do not override this one.

## Resume here

### Fixed: report settings now come from the actual search configuration

User requested fixing the stale width metadata. `shadow_images.cpp` now writes
`minimumUpwardShadowWidth`, c/d/e and corridor radius directly from the same
`pathSettings` passed to DFS, replacing literal5/4/4/4/9 values. No algorithm or
working-baseline settings changed. Rebuilt and regenerated all20 current reports
in existing numbered folders at residual0.125/dark-only/width3.

Regression: `baseline_tests --report-settings FILE.json` compares exported
settings with compiled defaults. It rejects the old001 report (literal width5)
and accepts new reports (width3). The existing image-runner helper invokes this
check. Synthetic width3 tests explicitly check two-pixel rejection/three-pixel
acceptance. Historical five-pixel unit/TypeScript parity scenarios now request5
explicitly so they remain meaningful when working defaults change.
Release build, CTest1/1,11-scene frontend parity/image CLI checks and installed
clang-format20 passed. The report-field limitation below is historical and fixed.
All20 regenerated reports passed the settings check with width3; complete
candidate geometry, decisions and search traces matched their pre-fix versions.

### Working baseline: width3; user reports correct touch/hover separation

After changing minimum upward shadow width from5 to3 and rerunning, the user
reported that the detector **correctly distinguishes all touching and hovering
examples they reviewed**. They explicitly clarified this was correct separation,
not every candidate simply becoming MATCH. Treat this as qualitative user review
of the existing development images, not held-out accuracy or an automated
ground-truth score. The assistant did not independently relabel the examples or
rerun this width3 experiment. Do not infer correctness for unrelated clothing/
off-keyboard proposals from this review.

Keep this configuration fixed as the strongest working native baseline so far:

| Setting | Value |
| :--- | :--- |
| Projection residual tolerance | 0.125 |
| Shadow search input | Dark shadows only (`--dark-shadows-only`) |
| Maximum current-image luma for dark shadow | 110/255 |
| Minimum contiguous upward shadow width | 3 analysis pixels |
| Reported decision cutoff | 20 reference-relative luma drop |
| Other geometry/search settings | Unchanged: c/d/e4, horizontal margin9, per-seed width window, paired both-target exclusion and downward-only veto |

Source inspection confirms `CandidateFilter.maximumResidual=0.125`,
`ShadowPathSettings.minimumUpwardShadowWidth=3`, and
`consideredShadowMaximumLuma=110`. The user changed the width; retain that edit.
The dark-only restriction remains optional/off by default, so include its flag:

```sh
python3 backend/run_shadow_images.py --rebuild --dark-shadows-only --residual 0.125
```

The interpretation motivating this baseline is that a concentrated dark region
attached to a fingertip, with upward support and limited forward extension, can
provide useful contact evidence. Width5 excluded thin dark regions even where
upward paths existed; width3 recovered the reviewed misses while retaining the
reviewed hover rejections, according to the user. This supports continuing the
candidate-umbra hypothesis on this dataset; it does not establish that every
detected dark region is a physical umbra or uniquely proves contact.

Next verification: new footage without retuning, especially close hovering,
slow approach/contact, held contact and release, followed by varied lighting
and hand positions. Keep current examples as development evidence. No browser
integration, video/live performance or physical latency result is established.

Reporting limitation discovered while recording this result: the image runner
still writes a literal `minimumUpwardShadowWidth:5` into JSON even though the
algorithm reads3 from `ShadowPathSettings`. Sampled reports001/010/019 retain
that field. Correct the exporter to report actual settings before using it as
configuration provenance; do not interpret that hardcoded field as disproving
the user's width3 run. Current CSV files contain decisions only, not the width
used, and are overwritten on rerun. This update changes handoff notes only.

### User review: misses009–015 and017; trace010 rightmost fingertip

User reports fewer false positives with dark-only but misses009–015/017.
Most specific target:010 rightmost actual fingertip, candidate7 at(431,195),
width23. At cutoff20 its nine upward searches include six reaching support
row187, but none has the required contiguous five-dark-pixel width on its path.
There is **no downward veto**, no unknown measurements and no reported X-limit
hit for this target. Thus the opposite-side shadow is not causing this miss.
All-shadow baseline passes it, using a width5 span x427–431 at y196; the
dark-only search excludes its lighter pixels. Similar target-row-but-no-width
behavior appears010/7,011/6,012/4,013/4,014/6,015/5,009/2 and017/1.
Other proposals can have different failures (no attachments, both-target ignored,
or actual downward veto), so do not assign one cause to every candidate.

Current paired fix discards an attachment reaching both targets; a different
downward-only attachment still vetoes the whole candidate. It does not implement
unconditional "one good side wins." For010/7 that distinction is not the cause.
Recommended next controlled experiment: dark-only width2/3 versus current5,
with brightness110/residual0.125/geometry unchanged, comparing false positives
and user-identified misses. No algorithm/threshold edits made during this review.

### Current experiment: searches restricted to purple dark shadows

User proposed running the existing algorithm on dark shadows only and changed
`CandidateFilter.maximumResidual` to0.125. That edit is retained. Removed CLI/
Python hardcoded0.12 overrides: absent `--residual`, both now inherit the C++
filter default0.125. Caption formatting also preserves all digits (0.125 was
previously truncated to0.12 in diagnostic text). Frontend code is unchanged.

Native/Python flag `--dark-shadows-only` restricts DFS seeds, traversal and width
witnesses to current luma<=`consideredShadowMaximumLuma` (currently110), matching
the purple class. Existing darkening cutoffs, color filter, paired exclusion,
finger proposals and geometry remain. Mode is optional/off by default. Light
shadow is excluded, while unavailable measurements remain UNKNOWN. Added raw
`currentLuma` Float32 measurements and mode/cutoff metadata. Diagnostic result
and DFS panel titles identify all-shadow versus dark-only mode.

Python now emits `results.csv`: rows000–019, columnscandidate_01–candidate_20,
valuesMATCH/NO_MATCH/UNKNOWN at cutoff20; "-" means no candidate. It also emits
`candidate-positions.csv` so spatial ID changes can be distinguished from
decision changes. Root gallery includes the same table. Uniform-mode runs save
`all-shadows-results.csv` or `dark-shadows-results.csv` alongside the current
table; partial runs with mixed modes do not overwrite a mode-specific snapshot.
Use `diff -u backend/test-results/all-shadows-results.csv
backend/test-results/dark-shadows-results.csv`. Arbitrary same-mode reruns replace
that mode's file; copy the CSV to a chosen filename before the next run when
preserving a particular parameter setting is needed. Settings stay in reports/
baseline-summary, not the candidate table columns. IDs remain frame-local.

Both20-case modes are exported at0.125 with fixed filenames in existing numbered
folders. `search-comparison.html` compares them; per-case files
`all-shadows-comparison.png`/`dark-shadows-comparison.png` preserve both views.
Standard case reports and root results.csv show the latest dark-only run.
No accuracy or physical-contact improvement claim; labels are still deferred.
Completed40 exports (20 per mode) at0.125 with exact same candidate geometry.
At cutoff20,36 candidate cells changed:33 MATCH→NO_MATCH and3 NO_MATCH→MATCH.
The latter are006/candidate2 and018/019 candidate2; this is consistent with the
known risk of removing light downward vetoes, not adjudicated false presses.
Verified both CSVs have20 case rows/20 candidate columns and36 differing cells;
every current report records residual0.125 and dark-only enabled.

Local synthetic tests cover light seed/width exclusion, inclusive110 cutoff,
light bridge rejection, width from dark pixels only, unavailable brightness,
and the important counterexample: removing a light downward veto can turn a
rejection into a match. Release build/CTest1/1 and11-scene frontend parity passed.
Parity explicitly retains the frontend's0.12 filter; it does not assert parity
for the experimental0.125/dark-only configuration. CLI restriction/default-mode
tests passed. Ruff/mypy and installed clang-format20 passed. No browser changes.

### Python image runner

Added `backend/run_shadow_images.py` (standard library only). From repo root:
`python3 backend/run_shadow_images.py` reruns all sorted inputs at residual0.12.
Use `--residual 0.16` for another tolerance, `--rebuild` after editing C++
constants, and `--case 001 002` to rerun selected existing IDs. Optional
`--input`, `--output`, `--build-dir` override defaults. Default paths resolve
relative to repository location, not process working directory. Existing output
root is required; the native runner reuses numbered case folders and replaces
their outputs. Root index and baseline-summary regenerate using each report's
actual residual/brightness cutoff, including unchanged reports in partial runs.
Stale reports with mismatched source paths are excluded from the root gallery.
No dated/versioned folders. This Python script orchestrates the C++ processor;
it does not implement image processing. Working notes only, per user preference.

### Latest palette adjustment

User requested considered dark shadows purple and ignored lighter shadows gray.
`shadow-classes.png`/ninth panel now use purple RGB(180,0,180) for compatible
shadow luma<=110; gray RGB(128,128,128) for compatible shadow above110. Finger
proposals remain dark blue; clear/excluded pixels white; unavailable black.
No threshold/detector changes. All20 numbered reports are regenerated at0.12;
old tolerance snapshots retain their historical rendering. New color assertions
in the existing image-runner parity helper passed, along with11 synthetic cases.

### Latest diagnostic: darker-shadow classes in ninth panel

User requested replacing the3x3 DFS panel with finger/dark/light shadow classes.
`shadow-classes.png` is generated separately and occupies bottom-right of
`comparison.png`. Dark blue RGB(0,0,100) is the existing filtered finger-proposal
mask; gray RGB(128,128,128) is valid projection-compatible darkening>5 with
**current-image luma<=110/255**; white is lighter candidate shadow or clear/
excluded pixels; black is unavailable evidence. "Darker" is provisionally
interpreted as low current brightness, not large reference-relative luma drop.
This distinction was stated to the user. It is not proof of umbra or contact.
The threshold is `consideredShadowMaximumLuma` in `ShadowDiagnostics.hpp`.

Rendering/JSON visualization metadata only; detector/DFS unchanged at residual
0.12. Separate DFS images still generated. All20 numbered-case standard reports
are rerun with this panel, with root gallery updated. Only001 classification
PNG visually reviewed; it includes off-keyboard/ink artifacts and inherits
finger-mask leakage. No connected-to-finger or forward-extent filter added.

Local Release build/CTest1/1 and installed clang-format20 checks passed.
Existing-root parity helper passed11 synthetic scenes and image CLI checks,
including new class-file presence, blue finger pixels, white light shadows,
gray shadow at brightness110 vs white111, and black unavailable pixels.
Keep notes here; broader docs/inventory remain deferred by user.

### Current baseline: residual0.12, observation before labeling

User requested all images rerun at0.12 and wants to observe before labeling.
Native CLI/core defaults already remain0.12. Reuse numbered000–019 folders,
overwrite their standard outputs/indexes with0.12, and show baseline reports
from root`backend/test-results/index.html`. Root`baseline-summary.json` records
the rerun. Earlier tolerance snapshots are exploratory files, not active defaults.
Do not start labeling or change the detector without further user direction.

### Current requested comparison: residual0.14/0.16/0.18 for every image

User clarified that "014016018" meant residual tolerances, not case IDs. Run
all20 existing cases at0.14/0.16/0.18 using their existing000–019 folders. Stable
`residual-014/016/018-*` files contain combined diagnostics, boundary, candidate,
filtered-shadow and DFS comparison PNGs plus per-tolerance JSON. Each case's
`index.html` shows all three settings; root index lists case comparisons. These
files replace prior exports on rerun. Generic filenames hold the last0.18 run;
the native/frontend default remains0.12. No new folders or algorithm changes.

### Current output preference: numbered case folders, reused on rerun

User explicitly revised the previous no-new-directory preference: use001/002
case folders again. Reorganized existing20 case reports to stable
`backend/test-results/000/` through`019/`; root`index.html` lists them. Moved the
fixed tolerance-comparison PNG/JSON files into001/002 and updated root
`residual-comparison.html` links. No dated/versioned run folders should be added.
Historical `native-heatmaps-2026-11-04/NNN/` paths below have moved to`NNN/`.

Runner now supports `--case=001`: creates/reuses that numbered child within
existing `--output` (default`backend/test-results`), overwrites generated files
on rerun and retains unrelated files. IDs must be exactly three digits. Use
explicit stable case IDs for image exports. Omitting `--case` retains direct
output behavior for helper/tests. Frontend/default detector settings unchanged.

### Latest experiment: projection residual0.12/0.18/0.20

Added image-runner `--residual=VALUE` (default0.12 unchanged). The supplied filter
is shared by fingertip geometry, DFS, binary shadow mask, filtered-shadow heatmap,
JSON metadata and captions. Invalid/nonfinite/negative tolerance is rejected.
Compared001/002 at all three tolerances in existing `backend/test-results/`;
fixed filenames `001/002-residual-012/018/020-*` are reused on rerun, no new
directories. Open [residual-comparison.html](test-results/residual-comparison.html)
for identical-coordinate enlarged mask crops, original images, filtered heatmaps,
candidate overlays and links to full combined diagnostic PNGs for all six runs.
Numeric summaries are in `test-results/residual-comparison.json`.

Visually,0.18/0.20 reopen much of the index/middle gap but remove actual fingertip
pixels too, with more missing geometry at0.20. Reviewed all three001 masks and
002 at0.20; not adjudicated pixel labels or measured accuracy. Full-frame
candidate counts001:9/8/7;002:7/6/7. Counts include clothing/off-keyboard artifacts
and candidate IDs shift, so these are not fingertip accuracy scores. No default
threshold chosen from this experiment;0.12 remains active in frontend/native.

Release build and CTest1/1 passed; installed clang-format20 check passed.
Parity helper reused existing results root:11 synthetic cases plus runner
checks passed, including tolerance override propagation into mask/report/caption,
restoration of default behavior, and negative-tolerance rejection. Core/default
frontend parity was retained. The earlier scratch directory was removed by user
cleanup; no replacement directory was created. Generic root index/report was
restored to001 at0.12 after testing; the fixed comparison files remain alongside.

### Latest observation: shadow pixels leaking into boundary001/002

User identifies gaps between index/middle and upper middle/ring as shadows
included in finger geometry. Inspected both source/residual/comparison images.
Heatmap red/green encodes scalar strength, not actual red/green RGB. Spot samples
on analysis-sized source/reference images: apparent gap(355,140) has projection
residual0.178 in001 and0.182 in002, exceeding current0.12; finger samples
(330,130)/(380,140)/(430,140) range0.231–0.269. These are manually selected
illustrative pixels, not adjudicated region labels or accuracy evidence.
Recommended next experiment: compare residual tolerance0.18/0.20 against0.12,
checking loss of actual finger edges as well as gap recovery. No settings or
detector code changed. Reuse existing results paths when testing.

### Output preference: reuse results, overwrite on rerun

The user explicitly instructed: **do not create new directories unless asked**.
Use an existing results directory and replace generated images/reports on rerun.
`shadow_images` now defaults to existing `backend/test-results/`, accepts an
existing `--output` directory even when nonempty, and never creates directories.
Only its generated filenames are overwritten; unrelated files are retained.
The parity helper also reuses one existing results directory and no longer
creates output/subdirectories. Earlier new/empty-output instructions below are
historical and superseded. Do not create dated/versioned report folders.
Broad documentation/inventory changes remain deferred; maintain handoff notes.

### Latest: combined image reports and underlying heatmaps

The user removed native KNN/MOG2 source files and older report folders during
cleanup. CMake now builds the filtered baseline, its rendering library and
`shadow_images` only; the active CTest suite is baseline1/1. Historical paths
and evidence mentioned below may no longer exist. Do not restore old source
or assume ignored reports survived cleanup. The build folder still has its
historical name `build/mog2/`; changing that is not required to run the baseline.

New rendering module: `ShadowDiagnostics.hpp/.cpp`, separate from detection
and I/O, in target `makeshift_cv_diagnostics` (OpenCV imgproc). The runner saves:

- `original.png` and `original-results.png` at native resolution, with candidate
  coordinates scaled back from analysis pixels for the result overlay.
- `comparison.png`: nine labeled panels together: source, result overlay,
  reference, raw darkening, projection residual, filtered shadow darkening,
  raw boundary mask, color shift context, and cutoff20 DFS witness paths.
- Four heatmaps: `heatmap-darkening.png`, `heatmap-residual.png`,
  `heatmap-shadow.png`, `heatmap-color-shift.png`. Fixed display scales across
  inputs: darkening5..100, residual0..0.30, color shift0..30. TURBO cool→warm,
  black at display zero or filter exclusion, gray unavailable. Display saturation
  does not change raw measurements or detector settings. Color shift is context;
  projection residual<=0.12 remains the active filter.
- `dfs-5/20/40/60.png` and `dfs-comparison.png`: successful cyan upward/red
  downward witness paths; ignored both-target paths gray, width witnesses green,
  selected arc yellow, X/local row bounds outlined. Failed explorations remain
  in JSON flags; these PNGs show successful paths, not every visited pixel.
- Existing seven analysis PNGs and raw `measurements.yml.gz` remain. JSON schema2
  adds visualization metadata; candidate decisions and measurements are unchanged.
  `index.html` leads with the combined image, then native originals/results,
  heatmaps/DFS and expandable raw masks. No changes to frontend code.

All20 existing inputs (19 cases + reference) were exported to the
[combined gallery](test-results/native-heatmaps-2026-11-04/index.html), with
per-case folders000–019. Native001 is at
[001/index.html](test-results/native-heatmaps-2026-11-04/001/index.html).
Report-file presence was checked for all20. Only the001 combined image was
visually reviewed; spurious/merged proposals remain. No accuracy claim.

Local Release build passed, CTest1/1 passed, clang-format20.1.7 check passed
(17 still unavailable). `node tests/cv/frontend_baseline_parity.cjs
backend/test-results/native-heatmaps-verified-2026-11-04` passed11 synthetic
parity scenes and image-runner checks: prior input/overwrite/homography checks,
new heatmap pixel semantics, unavailable gray, original native pixel equality,
native/analysis/composite dimensions, native result annotations and gallery
ordering. The earlier31-case parity result below is historical; its ignored
artifacts were removed in cleanup. No frontend/physical/video/CI pass claimed.
Keep notes here; broader docs and inventory updates remain deferred by user.

### Current direction: native copy of the built-in detector

After reviewing `001`, the user chose to keep the built-in filtered-tip/DFS
detector as the working baseline and pause MOG2/KNN tuning. Its computational
core is now copied into modular C++: `Homography`, `ShadowDetection`,
`Fingertips`, and `ShadowPaths`, with a separate `shadow_images` executable.
The frontend implementation is retained. Per user direction, keep working notes
here; defer broader documentation/inventory updates until the code settles.
A future video runner can reuse the in-memory modules; video is not added here.
No browser replacement, key eligibility or note-event dispatch is added.

Local parity matched 11 synthetic scenes and all 20 existing still inputs on
identical prepared RGBA pixels, including masks, tip geometry and DFS witness
paths. This is implementation parity, not accuracy evidence.

Files under `backend/src/CV/`:

- `Homography.hpp/.cpp`: ordered four-point solve, inverse and projection;
  optional result on singular/nonfinite geometry. No image warping or I/O.
- `ShadowDetection.hpp/.cpp`: reference-relative luma/color/projection fields,
  availability and raw filtered boundary mask. Input is matched CV_8UC4 RGBA,
  alpha zero means unavailable, bounded to 640*640 analysis pixels.
- `Fingertips.hpp/.cpp`: current filtered-mask plateau/local-lobe proposals,
  downward-facing assumption, max20 candidates, spatial IDs only.
- `ShadowPaths.cpp`: paired directional DFS, same c/d/e4, X-margin9,
  upward-width5 and cutoffs5/20/40/60 as the live frontend.
- `shadow_images.cpp`: file decoding/resizing, optional supplied-corner
  homography and report output. Build target `shadow_images`; library target
  `makeshift_cv_baseline` links OpenCV core only.

The image runner writes `index.html`, seven PNGs (source/reference, raw boundary,
shadow-compatible darkening>5, clipped darkening, validity, candidate overlay),
`results.json` (settings/geometry/four decisions/search paths/width witnesses)
and `measurements.yml.gz` (six raw Float32 fields, NaNs and availability masks).
Overlay green/red/gray means shadow-pattern match/no-match/unknown at cutoff20,
before any keyboard eligibility. No anatomical IDs or validated contact claim.
Legacy reddish clustering, ray/band summaries, keyboard layout, transitions and
browser session/audio ownership are not copied into the native core.

Build with the existing Conan/CMake commands below, then run from repo root:

```sh
./build/mog2/shadow_images \
  --image=images_test_cases/hover_right-index+right-ring_frame_000095_3167ms.png \
  --reference=images_test_cases/background.png \
  --output=backend/test-results/native-shadow-next
```

Default max-side640 uses INTER_AREA (1620x1080→640x427); max-side0 only accepts
native images within the analysis pixel bound. Existing output is refused.
Optional `--corners=FILE.json` takes `{"source":[{"x":0,"y":0},...]}` with four
native unmirrored image points ordered TL/TR/BR/BL, mapped to unit-square
corners. These are supplied correspondences, not automatic ArUco acquisition.
The report adds sheet positions after scaling tips back to native coordinates.

Verification helpers are `tests/cv/test_baseline.cpp` (CTest synthetic checks
plus parity comparator) and `tests/cv/frontend_baseline_parity.cjs` (reads
unchanged frontend TypeScript, prepares identical RGBA inputs and invokes the
comparator/image CLI). Run:

```sh
node tests/cv/frontend_baseline_parity.cjs NEW_OUTPUT_DIR images_test_cases
```

Requires installed frontend TypeScript/sharp and native build. This helper lives
under tests/cv because it verifies the native port. It compares every validity/
mask pixel, six measured fields (1e-5 absolute tolerance, matching NaNs), exact
candidate geometry, arc/edge order, four decisions/unknown flags, ignored seeds,
individual search flags and exact paths/width witnesses. Source hashes and
prepared inputs remain with output. Sharp prepares shared parity inputs; this
does not establish browser/OpenCV resize/decode equivalence. Native OpenCV001
has9 proposals versus8 in sharp-prepared parity001. Off-keyboard/clothing
proposals are retained because native key eligibility is not part of this port.

Local macOS arm64/AppleClang15/OpenCV4.12 Release build passed; CTest3/3 passed
(new baseline plus preserved MOG2/KNN). Baseline covers perspective round trips,
singular/nonfinite homographies, neutral/color/black/alpha/low-reference
measurements, input mutation/noncontiguous matrices, clear/thin/four/five-wide
support, downward veto, strict cutoffs, both-target exclusion and invalid inputs.
Full parity evidence: ignored `test-results/native-baseline-parity-final-2026-11-04/`
(11 synthetic +20 existing stills, source hashes, runner smoke).
Final gallery/trace export was separately smoke-checked with11 synthetic scenes
in `test-results/native-baseline-runner-final-2026-11-04/`. Image CLI checks
passed for all artifacts, supplied-corner projection, decisions, empty-reference
zero candidates, overwrite preservation, missing image/corners, invalid max-side
and dimension mismatch. Open the [native001 gallery](test-results/native-baseline-001-gallery-2026-11-04/index.html).
Only its candidate overlay was visually reviewed; it still includes spurious
proposals and does not prove reliable finger/contact detection.
Formatting passed installed clang-format20.1.7; required17 unavailable. No
frontend source edits or frontend tests, audio build, CI, video, physical latency,
held-out accuracy or WASM pass is claimed. Implementation remains uncommitted.

### Follow-up: darker-shadow tolerance (November 4)

The user identified white foreground bridging the index/middle gap in `001`,
where they expect shadow. Both executables were rerun at shadow thresholds
0.3 and 0.2, with all other settings unchanged and the 0.5 baselines preserved.
Open the [paired 001 comparison](test-results/shadow-threshold-comparison-2026-11-04.html)
for enlarged label views and links to all four new galleries, stored under
`test-results/{mog2,knn}-tau{0.3,0.2}-2026-11-04/`.

All four runs completed with zero errors: 20 inputs and 80 PNGs each. Source
pairing, category totals, output existence and clean background self-checks
were checked against each method's baseline. Only the four new `001` cards
were visually reviewed; the other 76 cards have not been individually reviewed.
KNN at 0.3/0.2 visually recovers part of the gap as possible shadow, with white
bridging still present; MOG2 retains much of the white gap even at 0.2. Lower
thresholds also relabel other dark regions, so this is not evidence of improved
finger segmentation or contact accuracy. Resume with the user's comparison
review. No source/default changes, rebuild or CTest rerun were needed.

MOG2 and KNN are implemented in C++, built with Conan/CMake, and have run on
the existing still images. The next step is reviewing their masks with the
user. No algorithm has been selected as a reliable contact detector.

The user noticed speckling in MOG2 and requested KNN for comparison. In four
visually reviewed pairs (`004`, `008`, `009`, `012`), KNN shows less speckling
over the paper at the current defaults. Noise elsewhere and fingertip/shadow
ambiguity remain. The other 16 KNN cards were exported but not individually
visually reviewed. This is qualitative evidence, not measured accuracy.

**Otsu is deferred.** The user wants to circle back to it on the OpenCV results
and our own reference-relative implementation later. No smoothing, morphology,
contact classifier, live integration or WebAssembly port was added.

## Open these results

| Output | Contents |
| :--- | :--- |
| [MOG2 gallery](test-results/mog2/index.html) | Original preserved run |
| [KNN gallery](test-results/knn/index.html) | Current comparison run |
| [MOG2 summary](test-results/mog2/summary.json) | Schema 1, original settings and counts |
| [KNN summary](test-results/knn/summary.json) | Schema 2, method, settings, preparation and classification timings |
| [MOG2 regression run](test-results/mog2-knn-regression-2026-11-04/index.html) | Shared-exporter rerun; all 60 raw masks match the original byte-for-byte |

Each method processed 19 existing cases plus the background self-check:
**20 inputs, zero errors, 80 PNGs**. Each card contains source, categorical
labels, possible-shadow mask and original pixels labeled shadow. Separate
`NNN-labels.png`, `NNN-shadows.png` and `NNN-foreground.png` preserve raw masks.

Labels mean **0 background, 127 possible shadow, 255 foreground**. These are
categories, not darkness measurements or contact decisions. Very dark shadow
can be foreground, so keep that mask too. Skin can still be labeled shadow.
Future Otsu should use actual intensity/darkening values, not these label values.

Inputs are in ignored `../images_test_cases/`, with `background.png` as the empty
reference. Native dimensions are 1620×1080; analysis is 640×427 using OpenCV
`INTER_AREA`. This matches the browser analysis dimensions, not necessarily its
exact decoded/resized pixels. File numbers identify report images, not tracked
fingers. Use each summary's source path when matching cases between tools.

## Current implementation

| File | Role |
| :--- | :--- |
| [Mog2Reference.hpp](src/CV/Mog2Reference.hpp), [implementation](src/CV/Mog2Reference.cpp) | In-memory MOG2 processor |
| [KnnReference.hpp](src/CV/KnnReference.hpp), [implementation](src/CV/KnnReference.cpp) | Independent-case KNN processor |
| [mog2_images.cpp](src/CV/mog2_images.cpp) | Shared native image/report runner; builds both executables |
| [CMakeLists.txt](src/CV/CMakeLists.txt) | Standalone CV build, independent of audio/nanobind |
| [conanfile.py](src/CV/conanfile.py), [lockfile](src/CV/conan.lock) | OpenCV 4.12.0 and locked dependency recipe revisions |
| [MOG2 tests](../tests/cv/test_mog2.cpp), [KNN tests](../tests/cv/test_knn.cpp) | Four MOG2 and five KNN regression groups |

All image processing is C++. The Python file is Conan configuration only.
The reusable processors own no file I/O, GUI or browser interfaces. The
separate native runner handles decoding, resizing and reports. WebAssembly is
a possible future direction; compilation, bindings and performance are untested.

| Setting | MOG2 | KNN |
| :--- | :--- | :--- |
| History | 500 | 500 |
| Matching threshold | Variance threshold 16 | Squared color-distance threshold 400 |
| Shadow threshold | 0.5 | 0.5 |
| Initialization | Empty reference once, learning rate 1 | Fresh model per case, 120 repeats of the empty reference, requested rate 0.1, seed 1 |
| Evaluation | Learning rate 0 | One frame at rate 0.1, then discard the model |
| Sample settings | OpenCV defaults | Seven samples per time scale, two required matches |

The matching thresholds have different meanings. This is a comparison of the
current defaults, not equivalent sensitivity or optimized settings.

KNN deliberately avoids zero learning rate: OpenCV 4.12's update-period formula
divides by `log(1-learningRate)`. The CPU implementation classifies each pixel
before updating its samples. Discarding the model afterward prevents that
image from contaminating another case. The wrapper clones the reference,
checks warmup convergence and restores the caller's RNG state. OpenCV internally
uses its own initialization rate for the first call.

Repeating one still initializes KNN but **does not learn real camera noise**.
A short empty-scene video would be needed to evaluate that benefit. Rebuilding
for each case is an offline comparison strategy, not a proposed live pipeline.
KNN preparation totaled about 10.1 seconds across 20 inputs; `prepareMs` and
`classifyMs` are separate. Neither measures physical press-to-sound latency.

## Build and rerun

Run from the **repository root**, not `backend/`:

```sh
# Only if a Conan default profile does not already exist:
conan profile detect

conan install backend/src/CV --output-folder=build/mog2 --build=missing \
  -s build_type=Release -s compiler.cppstd=17 -c tools.build:jobs=4
cmake -S backend/src/CV -B build/mog2 \
  -DCMAKE_TOOLCHAIN_FILE=conan_toolchain.cmake -DCMAKE_BUILD_TYPE=Release
cmake --build build/mog2 --parallel 4
ctest --test-dir build/mog2 --output-on-failure

# Pick unused output folders; existing nonempty folders are refused.
./build/mog2/mog2_images --output=backend/test-results/mog2-next
./build/mog2/knn_images --output=backend/test-results/knn-next
```

The existing executables are already in `build/mog2/`. Both accept `--help`,
`--input=...`, `--output=...`, `--max-side=0` for native resolution, and
`--method=mog2|knn`. Shadow threshold defaults to 0.5; `--var-threshold=16`
affects MOG2, `--dist2-threshold=400` affects KNN. Record any changed settings;
do not silently replace the baseline. See the [usage guide](../docs/cv_mog2_experiment.md)
for output schema and error handling.

## Verification and limits

Completed locally on macOS arm64, AppleClang 15, Conan 2.25.2 and OpenCV 4.12.0:

- Release build and CTest **2/2 passed**, comprising all nine regression groups.
  Tests cover labels, reference initialization, independent cases, mutation
  safety, KNN RNG restoration/distance tolerance and invalid-input recovery.
- All 20 KNN reports were checked for paired source paths, pixel totals, output
  existence and a clean background self-check. Output preservation, invalid
  settings, unreadable images and dimension mismatches were checked locally.
- The MOG2 rerun matched all 20 original category totals and all 60 raw mask
  PNGs byte-for-byte. Its original gallery was not overwritten.
- Earlier MOG2 work passed Ruff/mypy and Python tests (25 passed, one skipped).
  Changed C++ formatting passed with installed clang-format 20.1.7; the required
  version 17 was unavailable. The separate audio configure stopped on missing
  nanobind, so its build/CTest did not run.

Execution details: [KNN record](../tests/README.md#native-c-knn-comparison-2026-11-04),
[MOG2 record](../tests/README.md#native-c-mog2-experiment-2026-11-04),
[inventory](../tests/verification_test_inventory.md) (`MOG2-01/02`, `KNN-01/02`).
No new CI, held-out contact accuracy, real-video noise robustness or physical
latency result is claimed. This handoff update changes documentation only;
it does not rerun those tests.

## Carry forward

The user's key observation is a concentrated dark region near physical contact.
Any eventual measurement must tolerate about **±1–2 analysis pixels of fingertip
boundary error**. In the existing browser `shadow-images/009.png`, the user
labels candidate **#2 touching and #3 hovering**. Those are saved candidate IDs,
not anatomical identities. Skin-edge leakage is suspected in `004`/`008` and
original clip 1 frame 94; pixel ownership has not been established. The current
browser detector still uses the existing filtered-tip/directional-DFS rules.

Resume with the user's mask observations. Check whether reduced speckling also
preserves faint shadows and the relevant fingertip band before declaring an
improvement. Otsu on either OpenCV output and the custom subtraction is a later
experiment. Motion, tracking/hysteresis, worker optimization and browser
integration remain separately deferred.

Preserve all ignored evidence: `backend/test-results/`, original case images,
`frontend/test-results/shadow-images/`, `frontend/test-results/cv-video/`, the
contact-darkness inspection and `_archive/legacy-image-results-2026-11-03.tar.gz`.
Reports record source paths, not input hashes; keep inputs with the outputs.
Ignored artifacts and binaries are not recoverable from a clean checkout.
Do not clean these folders or unrelated staged/unstaged work. Implementation
files remain uncommitted; issue tracking was deferred to the user. No commits,
pushes, issues or PRs were created for these experiments or this handoff.
