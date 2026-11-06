# CV shadow handoff — native baseline, MOG2 and KNN

Updated November 6, 2026. **Start here for the current native experiment.**
The [older handoff](../docs/cv_shadow_detection_status_and_next_steps.md) is
historical background; its earlier stopping points do not override this one.

## Resume here

### Verified user run: forward dark distance d=2

All25 current reports now record Cr13/d2/light enabled. Against the saved
Cr13/d4 baseline and recorded light additions, all137 candidate IDs, positions
and widths are unchanged. The only combined-decision change is002/candidate4:
dark MATCH becomes NO_MATCH, with downward target y151 and6 non-ignored
successful downward searches (11 reach,5 ignored). Upward support remains,
but downward veto correctly wins. The light fallback rejects with
`no-clear-strip`, so final result is NO_MATCH, matching the hovering label.
Every other combined decision is unchanged, including all known pressing
fingertips and older on-paper results.001/candidate6 (above paper) changes
its internal dark result UNKNOWN→NO_MATCH but still passes light. This is
comparison on the same development images, not held-out accuracy evidence.


User will run the image generator to compare d=2 against d=4, keeping Cr13,
Otsu radius2, dark-only DFS and the light fallback enabled. Do not change the
settings or regenerate while the user runs it. The saved pre-run full reports
are `test-results/before-d2-results.json` (Cr13/d4), if present; verify the
actual metadata before comparison. Match candidates spatially if IDs change.

Focus:002/candidate4, a user-labeled hovering finger, falsely passes dark.
Tip y149, old forward target y153 (tipY+d4). All14 downward searches fail;
upward support succeeds. With d2, target becomes y151. Check whether a
non-ignored downward path now vetoes it: seeds reaching both upward and
downward targets are ignored, so lowering d does not guarantee rejection.
Also check whether a dark rejection is subsequently accepted by light.
Compare all25 cases, especially known pressing fingertips001/003/004/005 and
older on-paper fingers; ignore candidates above the paper for current review.
The latest Cr13 rerun exactly reproduced the original137 candidate geometries,
dark traces and combined decisions. At Cr14,014/022 candidate2 gained dark
matches; both disappear again at Cr13. Preserve this comparison context.


### Light-shadow fallback trial (November 6)

The current native image trial is opt-in:

```sh
python3 backend/run_shadow_images.py --rebuild --dark-shadows-only --light-shadow-test
```

It preserves Cr/Otsu segmentation and all original dark DFS `levels`. After a
cutoff20 dark result other than MATCH, the light test checks all valid darkening
strictly above5, without a residual or current-luma filter. It takes the lowest
point per column of the existing distal arc and searches for a contiguous clear
front strip of at least max(3,ceil(0.15*fingerWidth)) columns. Both outside rows
immediately below every strip column must be valid, non-finger and clear.
Minimum shadow blob area is max(6,ceil(0.04*fingerWidth^2)), with8-connectivity.
Shadow directly adjacent to the finger must exist to each side of the strip,
within half a finger width horizontally and one finger width upward; it may
connect to the same larger blob. Components are bounded to the distal arc plus
half-width horizontal margins and y=[tipY-width,tipY+max(4,width/2)]. No new
finger refinement, tracking, note events, or browser changes.

`finalDecision` is dark OR light, preserving the original dark unknown/failure
when light fails. `decisionSource` identifies dark/light/neither. Each candidate
exports `lightShadow` evaluation state, reason, minimums, front, clear strip,
clear band and supporting blobs in `results.json`. `light-shadow.png` shows
white strip, green clear band, yellow front and cyan/magenta supporting shadows.
Summary images/CSV use final decisions; DFS images and JSON `levels` still show
original dark decisions. The flag is off by default; it requires dark-only mode.

User labels for this trial:000 all hovering;001 candidates3/5/7/10 press;
002 no fingertip press;003 candidate5 press;004 candidates5/7 press,3 hovering
because even its small front shadow leaves no clear strip;005 candidates4/5
press, with5 already passing dark. These labels refer to this gallery/config.
User explicitly excludes candidates above the paper from present assessment;
future paper homography will gate those candidates. Do not add new proposal
filtering or change the labels to hide their current output.

Local Release build and CTest `cv_baseline`1/1 passed, including synthetic
coverage for clear paper alone, one side only, specks, a thin front shadow,
insufficient band depth, unavailable pixels, strip-length boundary, a shared
supporting blob, incomplete geometry, invalid mask, skipping light after dark
success, and retaining dark failure alongside a successful fallback. Opt-out
export001 preserved the original decisions/traces; native and Python CLIs reject
light fallback without dark-only mode. Python syntax compilation passed.
clang-format20.1.7 passed for changed C++ files; required17 is unavailable.
System Python lacks ruff/mypy; no full Python lint/typecheck claim.

All25 cases regenerated with compiled Cr13, Otsu radius2, dark-only DFS and
light fallback enabled. Compared against pre-trial reports: all137 original
candidate positions/widths and complete four-cutoff dark traces are identical;
all15 dark matches remain accepted. There are18 additional light matches,
including above-paper candidates. Older006–024 add only012/candidate1 and
018/candidate1, both visually above the paper; their on-paper results are
unchanged. Reviewed light overlays001–005,012,018; no held-out accuracy claim.

On-paper review, excluding the above-paper candidates as the user requested:

| Case | Accepted on-paper candidates | Interpretation |
| :--- | :--- | :--- |
| 000 | None | Remains hovering |
| 001 | 3,5,7,10 (light) | Matches user positives |
| 002 | 4 (dark) | Existing dark false positive relative to user's hovering label; light fallback is skipped for4. Other on-paper fingers fail light |
| 003 | 5 (light) | Matches user positive |
| 004 | 5,7 (light) | Matches user positives;3 rejects with `no-clear-strip` |
| 005 | 4 (light),5 (dark) | Matches user positives; light is skipped for5 |

`test-results/light-review.json` records the manually identified on-paper IDs,
expected/observed sets and the complete light-addition list. Gallery
`test-results/index.html` links each light overlay, and `dark-plus-light-results.csv`
contains combined decisions. Above-paper matches remain visible and are not
counted as new on-paper errors; no homography eligibility filter was added.
The002/candidate4 dark result needs separate review: this OR fallback cannot
veto an existing dark MATCH. Next review should use these overlays before any
change to the dark rule or additional threshold tuning.


### Tomorrow's starting point — consolidated November6 handoff

**This section is authoritative. Everything below it is chronological working
history and can describe superseded settings, colors, paths or defaults.**
Keep this as a local native-C++ experiment. User explicitly deferred broader
docs, test inventory, issues, commits, pushes and PRs. Update only this handoff.
Preserve unrelated working-tree changes and all ignored source/evidence files.

#### User observations and immediate direction

- Cr-based finger segmentation is good enough for the reviewed new camera
  pictures for now. Yesterday's lighting still loses some low-Cr finger edges.
- Local Otsu added little practical value according to the user. It remains
  implemented and is still the executable/Python default (`cr-otsu`); **we have
  not silently switched the default back to Cr-only**. `--finger-method cr`
  disables refinement for comparison. Do not spend more effort refining fingers
  without new direction; user is now observing shadow patterns.
- New lighting has less visually apparent dark shadow evidence. Yesterday's
  stronger dark shadows appeared more tolerant of small finger-boundary errors.
  This is qualitative user review, not a held-out accuracy result.
- Important open distinction: shadows may fail because their **current luma is
  above110**, their **reference-relative luma drop is not above20**, or their
  geometry/path fails. Inspect these separately before adjusting thresholds.
- User prefers to explain one finger at a time. **000: all fingers hovering.**
  Under the old projection mask, the rightmost fingertip/index (then candidate10)
  falsely matched after shadow merged into its finger mask. In the latest report
  that spatial fingertip is candidate8 at(332,147),NO_MATCH at20.
- **010: user labels ring finger candidate2 as hovering**, with its left edge
  missing in the Cr-only mask. Trust this label over anatomical words in the
  filename. Current candidate2 is at(206,170),NO_MATCH at20. Selected edge/shadow
  values overlap in Cr and projection residual; see the sampling notes below.
  Candidate IDs are frame/configuration-local and can change after refinement.

#### Actual current classification

| Stage | Current behavior |
| :--- | :--- |
| Cr finger seed | `abs(Cr_current - Cr_reference) > 13`, opaque matched analysis pixels; no separate Y/darkening/reference-luma gate |
| Cr units/default | Raw0..255-equivalent Cr, threshold from `defaultCrFingerThreshold` in `CrFingerDetection.hpp`; user edited it to13 |
| Optional Otsu | Default `cr-otsu`, radius2 Euclidean analysis pixels, confined to original distal fingertip edge; raw Cr histogram, frozen original seeds, no cumulative growth |
| Shadow source in Cr modes | Outside selected Cr/Cr-Otsu mask plus valid reference-relative darkening; **NO projection-residual/color-shift exclusion** |
| Availability | Alpha and reference-luma floor40 still apply; opaque black current pixels can be valid shadows even when projection color is undefined |
| Main reported decision | Luma drop strictly>20; with `--dark-shadows-only`, current luma<=110 |
| Directional DFS | Width3, c/d/e4, margin9, original paired both-target exclusion/downward-only veto; no new temporal smoothing |
| Legacy option | `--finger-method projection` uses original projection mask/shadow rules, residual0.125 |

`classifyShadowPixel` is shared by DFS and shadow diagnostics. Raw residual is
still computed from the current/reference RGB pair and exported as **context**;
it never depended on the finger mask. The recent correction removed its veto
from Cr-mode shadows rather than inventing a recalculated residual. Cr-mode
decisions may change from earlier runs because this restores dark pixels the
old projection threshold discarded. This is an experimental classification
change, not an established accuracy improvement.

CLI/Python defaults now inherit the compiled Cr constant unless an explicit
`--cr-threshold` is passed. An earlier bug forced10 despite the user's constant
edit; that is fixed and regression-covered. Raising Cr threshold tightens the
finger mask. Cr/Cb **display** changes are amplified4x and clipped at white;
this does not affect thresholds or measurements.

#### Diagnostics to open and interpret

Open `backend/test-results/index.html` or a case's `index.html`/`comparison.png`.
Main comparison contains:

- Cr change beside **Fingers + shadows used by DFS (cutoff20)**. This used-shadow
  panel applies the exact pixel gates selected for that run, before path/width
  qualification. Blue=fingers, pink=Otsu additions, heat=shadow darkening,
  black=clear/excluded, gray=unavailable.
- Row3: **original Cr shadow → new Otsu shadow → dark/light shadow classes**.
  The first2 show broader darkening>5 on a fixed5..100 heat scale, without the
  later cutoff20/current-luma110 restrictions. Fingers are blue and Otsu
  additions pink in the after view.
- The restored class panel uses the current selected mask/shadow classifier:
  **magenta RGB(180,0,180)=dark shadow luma<=110**, **gray(128,128,128)=lighter
  shadow**, **blue(0,0,100)=finger**, white=clear, black=unknown. This is
  darkening>5 context, not a claim that every magenta pixel qualifies at20.
- Otsu additions are **pink RGB(255,0,180)**; older green-addition notes are
  superseded. Some after panels therefore intentionally differ in how they
  color Otsu pixels: pink in the before/after overlay, blue in the class panel.
- RGB subtraction and R/G/B views remain;7 color-space grids provide RGB, HSV,
  Lab, YCrCb, normalized RGB, CMY and explicitly approximate RYB. Keep comparison
  grids only; the63 individual color-channel PNGs per case were removed.

Latest magenta/gray panel restoration was compiled/tested; it may require the
user's next real-image rerun to appear in existing comparisons. Report JSON
proves calculation settings, not the exact rendering revision of an existing PNG.

#### Data, commands and camera controls

Current read-only inventory: **25 valid pairs in `experiment/`**,6 new camera
captures and19 older hand images,50 PNGs total. The former background self-check
pair is no longer present there. `images_test_cases/` was moved into this folder;
old paths/count26 in historical notes are superseded. User removed the11
incompatible screenshot pairs discussed earlier. Each `PHOTO.png` uses its own
`PHOTO-reference.png`; references are excluded from test-case discovery.

From repo root:

```sh
# Current default mask: Cr + fingertip Otsu; user runs real-image generation.
python3 backend/run_shadow_images.py --rebuild --dark-shadows-only

# Cr-only comparison, with identical shadow policy:
python3 backend/run_shadow_images.py --finger-method cr --dark-shadows-only

# Optional tuning overrides (keep experiments controlled):
python3 backend/run_shadow_images.py --dark-shadows-only --cr-threshold 13 --otsu-radius 1

# Physical webcam on this Mac (index0 is OBS Virtual Camera):
sh backend/run_shadow_camera.sh --camera=1
```

Python defaults to `experiment/`, existing `backend/test-results/` outputs and
`build/mog2/`. Sorted selected inputs define case IDs; partial/input-filter
changes can renumber them. Standard numbered outputs are overwritten on rerun;
do not create dated/versioned result folders. `--pattern 'camera-*.png'` selects
only camera captures. Do not rerun full data automatically: user has elected to
generate images and review them personally.

Camera: fixed camera/sheet, fingers pointing down in image; remove hands and
press **B** for empty reference + four-marker key calibration. **S** saves raw
native image and matching reference PNGs to repo-root `experiment/`, **no JSON**.
**R** resets, **Q/Esc** quits. Keys highlight accepted shadow patterns; no audio.
User confirmed FaceTime index1 preview works. Automatic hand absence/movement
validation, anatomical tracking and verified contact accuracy remain absent.

#### What was verified, and what is still pending

- Current source constants/defaults inspected. Existing000/010 reports both
  record `cr-otsu`,Cr13,radius2,`cr-mask-darkening`,residual-applied0,dark-only,
  luma110,width3. Their local modification times are November6 around01:05;
  the user has regenerated them since the initial implementation. No new
  image-processing run was performed while writing this consolidated handoff.
- Latest available local evidence: Release image/camera builds; CTest1/1 and
  camera6/6;11-scene legacy projection parity plus image-CLI/diagnostic checks;
  6 Python runner tests. Installed clang-format20 passed; required17 unavailable.
  Python Ruff/mypy unavailable in the selected Python environment.
- Regression checks cover Cr-only threshold behavior, bounded/connected Otsu
  expansion, original-mask preservation, raw-Cr Otsu agreement with OpenCV,
  shared Cr-shadow/DFS pixel gates, restoration of high-residual non-finger
  shadows, dark/light colors and threshold/configuration provenance.
- Core tests: `ctest --test-dir build/mog2 --output-on-failure`.
  Optional camera tests: `ctest --test-dir build/shadow-camera --output-on-failure`.
  Python: `python3 -m unittest discover -s tests/cv -p test_shadow_image_pairs.py`.
  Parity helper: `node tests/cv/frontend_baseline_parity.cjs backend/test-results`
  **overwrites unnumbered synthetic diagnostic files/root case gallery**; use
  knowingly and let user regenerate the real root gallery afterward as needed.
- No held-out accuracy, lighting robustness, physical latency or new browser
  integration is established. Today's mask/shadow observations are still
  development evidence. No commits/issues/PRs were created for this work.

**Resume with the user's shadow-pattern observations on the current lighting,
one labeled fingertip at a time. Keep the finger classifier stable for now;
inspect brightness, darkening and directional traces before retuning.**

### Chronological working history (superseded where the summary above differs)

### Restored magenta/gray shadow contrast panel (November 6)

User wants the earlier categorical dark/light contrast. Restored that panel
to comparison row3/column3, replacing the duplicate overlay: fingers blue,
dark shadows magenta RGB(180,0,180) for current luma<=110, lighter shadows gray
RGB(128,128,128), clear white and unknown black. This uses the CURRENT selected
finger mask and shared shadow classifier (no residual exclusion in Cr modes).
Classes show darkening>5 context, not only cutoff20-qualified DFS pixels; the
dedicated used-shadow panel above remains available. Original/Otsu shadow
views stay beside the class panel, with Otsu additions pink in the after view.
No new files or detector changes. Release build,11-scene parity/image CLI
checks and installed clang-format20 passed. Composite checks cover magenta110,
gray111, blue fingers, and Cr dark pixels that the old residual gate rejected.
User handles real-image regeneration. Only this handoff updated.

### Cr-derived shadow evidence replaces projection veto in Cr modes (November 6)

User requested Cr change beside the dark shadows actually used and pointed out
black holes in the prior shadow heatmap after switching finger segmentation.
The raw projection residual never depended on the finger mask; however, its
old exclusion gate was still active for Cr-based shadows. Corrected the Cr
pipeline to derive shadows from **outside the selected Cr/Cr-Otsu finger mask**
and valid reference-relative darkening, with no residual/color-shift exclusion.
Reference-luma floor40 and alpha availability remain. With dark-only enabled,
DFS still requires current luma<=110; primary cutoff20 remains strictly >20.
Opaque black current pixels can now be valid Cr-mode shadow evidence even if
projection chromaticity is undefined. Unchanged/background pixels stay clear.

New shared `classifyShadowPixel` is used by DFS, native raw shadow mask, camera
classification and diagnostic heatmaps. `FilterMethod::FingerMask` selects the
new Cr shadow behavior; projection mode preserves the old residual behavior.
The directional search, width3, c/d/e4, geometry and paired-target rules remain,
but **Cr-mode contact decisions can change** because available shadow pixels
have changed. Residual measurements are still exported untouched for context;
they are not recalculated from a different set of fingers or relabeled as Cr.

Main comparison now puts Cr change (existing4x display gain) next to
"Fingers + shadows used by DFS (cutoff20)". This heatmap uses the exact shared
pixel gates and selected dark-only brightness limit: blue fingers, pink Otsu
additions, cool-to-warm valid shadow darkening, black clear/excluded, gray
unknown. These are eligible pixels before path/geometry qualification. Lower
original/Otsu comparisons remain broader darkening>5 views without the later
cutoff20/luma110 restrictions, now derived from their respective Cr masks with
no residual veto. No new individual PNGs. `heatmap-shadow.png` and
`shadow-compatible.png` now also reflect the selected mask/shadow method.
Raw residual heatmap remains available as a context diagnostic.

Reports/root galleries identify `shadowMethod=cr-mask-darkening` and
`shadowResidualApplied=0` for Cr modes, or projection/1 in legacy mode. Mixed
partial-run CSV snapshots check shadow method too. Finger classifier, threshold13,
Otsu settings and Cr/Cb display gain are unchanged. Camera uses the same shadow
classifier in its existing class view/DFS; its class view remains threshold5
context, while the image report's dedicated used-shadow panel is cutoff20.

Release builds for image/camera passed; CTest1/1 and6/6 passed,11-scene legacy
parity/image CLI checks passed,6 Python runner tests passed, and installed
clang-format20 passed (17 unavailable). New tests demonstrate high-residual
low-Cr dark pixels restoring DFS support, removal of the residual gate in Cr
heatmaps, exact display/DFS luma110 and strict20 behavior, opaque black validity,
alpha/reference-floor unknown handling, finger exclusion, main Cr-panel
agreement with the color grid and shadow-method provenance. No numbered real
reports regenerated; user will rerun and judge changed decisions. Only this
handoff updated per user instruction; no accuracy/latency improvement claimed.

### Otsu additions now bright pink (November 6)

User requested pink/brown to distinguish additions from shadow heatmap colors.
Changed Otsu additions to bright pink RGB(255,0,180) in both after/overlay
panels and updated image/gallery legends. Original fingers remain blue;
shadow colors and all detection settings are unchanged. Release build,
11-scene parity/image CLI checks (including exact pink pixels) and installed
clang-format20 passed. User handles real-image regeneration. Only this handoff
updated; earlier green-addition descriptions below are historical.

### Colored fingers in both before/after shadow views (November 6)

User requested visible finger colors in the original-Cr and Otsu shadow panels.
Both panels now show original finger pixels dark blue (RGB0,0,100); the Otsu
panel shows added finger pixels green (RGB0,220,0). Filtered shadow heatmap
colors remain unchanged outside the masks. Legends identify the colors.
This is rendering only, with no extra standalone files or numbered report
regeneration. Release build,11-scene parity/image CLI checks and installed
clang-format20 passed; composite assertions verify blue original fingers in
both views, green Otsu additions, and unchanged outside-radius shadow colors.
Only this handoff updated.

### Fingertip-only local Otsu refinement with before/after shadows (November 6)

User approved local Otsu expansion near the fingertip only, max1–2 analysis
pixels, and requested **original shadow then new Otsu shadow** in diagnostics.
`refineCrFingertipsWithOtsu` is separate from unchanged Cr-only identification.
Image/camera/Python runners now default to `--finger-method=cr-otsu`;
`--finger-method=cr` selects the original Cr mask, and `projection` remains
available. The user's compiled Cr seed threshold13 is preserved. Optional
`--otsu-radius=1` selects1 pixel; unset inherits compiled default2. No Python
or CLI duplicate default thresholds/radii override the shared native constants.

Algorithm: start from original Cr mask/proposals. For each original tip,
sample a bounded patch around its width, from tipY-c-e through tipY+radius,
including finger interior and nearby background. Compute ordinary256-bin Otsu
on absolute Cr changes in unamplified0..255-equivalent units, rounded to bytes;
alpha-invalid samples are omitted. No split for a constant/empty histogram.
Accept above-threshold pixels only if8-connected to original finger pixels
and within the chosen **Euclidean** radius of the ORIGINAL mask's distal
c-row fingertip strip. The strip is tipY-c..tipY (currently c4), so growth can
extend at most radius around that strip, not along the whole finger shaft.
All candidates use the frozen original mask; union additions then recompute
proposal geometry once. No deletion, repeated dilation, cross-candidate growth
or frame-to-frame accumulation. Tip IDs/geometry may change after refinement.
Bounds constrain mask growth, not a guarantee of physically correct ownership.

Comparison row3 now shows original Cr-based filtered shadows, refined
Otsu-based filtered shadows, then mask/shadow overlay. Blue=original fingers;
green=Otsu additions. Both shadow panels use identical residual filtering and
fixed darkening5..100 scale, without applying later DFS cutoff20/luma110 gates.
This preserves the user's clarified heatmap semantics. No new standalone
diagnostic PNGs beyond the existing comparisons. Reports include otsuEnabled,
radius and per-original-tip ROI, threshold (-1 for no split), and addition count.
Shadow measurement/DFS logic is unchanged; it receives the refined mask/tips.
Cr/Cb4x visualization remains display-only.

Run `python3 backend/run_shadow_images.py --rebuild --dark-shadows-only` to
regenerate from `experiment/`; user still handles real-image reruns. No numbered
reports regenerated during implementation. Native camera will use the same
temporary mask default on its next launch.

Release builds for still/camera passed; CTest1/1 and6/6 passed,11-scene legacy
parity/CLI checks passed,6 Python forwarding/pairing tests passed, and installed
clang-format20 passed (17 unavailable). New native regressions verify connected
weak-edge recovery,1/2-pixel Euclidean caps, no finger-shaft growth, alpha gaps,
disconnected islands, preserved original pixels/input, repeatability, empty
seeds, invalid radii and agreement with OpenCV Otsu on the same raw Cr samples.
CLI/composite tests verify default/provenance, invalid radii, original-shadow
pixels versus refined exclusion, green addition overlay, and unchanged pixels
beyond the expansion bound. Python tests verify inherited radius and explicit
overrides. No held-out/live accuracy or latency claim; user review of000/010
is still needed. Only this handoff updated; broader docs/inventory deferred.

### November6 review:010 ring finger candidate2, hovering, left edge missing

User identifies current010/candidate2 as the **ring finger, hovering**, with
missing mask pixels on its left side. Trust the user label rather than the
source filename's anatomical wording. Current report source is
`experiment/hover_right-middle_frame_000160_5333ms.png`, analysis640x427,
candidate2 at(206,170),width21,NO_MATCH at20. Reports000/010 both record Cr
threshold13, residual0.125 and dark-only. Current000's rightmost fingertip is
candidate8 at(332,147),NO_MATCH; historical candidate10 refers to the older
projection result, not a persistent identity.

Inspected source and binary masks for000/010 without rerunning or tuning.
Read-only RGB samples from analysis-sized source/reference PNGs give absolute
Cr changes using the native formula and projection residuals:

| Case / analysis pixel | Cr change | Projection residual | Cr13 mask |
| :--- | :--- | :--- | :--- |
|010 left-edge vicinity(194,145)|12.16|0.147|excluded|
|010 left-edge vicinity(191,135)|9.66|0.112|excluded|
|010 left-edge vicinity(188,120)|7.58|0.085|excluded|
|000 forward-shadow vicinity(333,149)|9.25|0.167|excluded|
|000 forward-shadow vicinity(333,153)|10.75|0.156|excluded|

These are manually/visually selected illustrative pixels, not adjudicated
pixel ownership or accuracy measurements. The12.16 example is below Cr13
despite exceeding the old residual0.125. Lower Cr could recover it; however,
other selected edge values overlap the new shadow values. A simple OR with
projection residual would also admit the listed000 shadow examples. This
suggests measuring labeled edge/shadow regions before picking a global
threshold or combining masks. Cr may handle new lighting better while losing
low-chroma edge pixels under prior lighting. No classifier edits, parameter
changes or generated images/reports during this review. Notes only here.

### Fixed CLI overrides of the user-edited Cr default12 (November 5)

User changed `defaultCrFingerThreshold` to12, but reports still showed10.
The reports were accurate: Python and both C++ CLI parsers hardcoded10 and
overrode the shared constant. Removed those active literal defaults. C++ image/
camera CLIs and diagnostics now inherit `defaultCrFingerThreshold` unless
`--cr-threshold` is explicitly provided. Python omits that flag when unset,
allowing the native compiled default through. Preserved the user's12 edit.
Mixed-threshold CSV checks compare actual recorded settings rather than a
Python-assumed default. Historical report fallback10 is provenance only.

Higher threshold means fewer finger-mask pixels. Edit the constant and rebuild,
or pass `--cr-threshold 12` to Python for an explicit override. To regenerate:
`python3 backend/run_shadow_images.py --rebuild --dark-shadows-only`.
Old numbered images remain at their prior settings until the user reruns them;
no real-image reports regenerated for this fix.

Release builds for image/camera passed; CTest1/1 and6/6 passed,11-scene legacy
parity/CLI checks passed,6 Python pairing/forwarding tests passed, and installed
clang-format20 passed. Regression compares the no-override native Cr report
against the compiled constant, checks Python omits its override by default and
records an arbitrary simulated native default, and verifies explicit overrides
still pass through. Only this handoff updated per user instruction.

### Clarified view: filtered shadow heatmap using Cr-detected fingers (November 5)

User clarified they want the **existing filtered shadow heatmap with the Cr
finger mask applied**, not the extra cutoff20/brightness110-gated visualization.
Replaced that new active-pixel view with the same projection-compatible
darkening heatmap (floor5, full-scale100, residual<=configured tolerance),
excluding the selected finger mask. The mask panel overlays those fingers
in dark blue on this heatmap; adjacent panel shows filtered shadows alone.
Unmasked valid pixels have exactly the same colors as `heatmap-shadow.png`.
The later DFS darkening20 and optional luma110 gates do not restrict these
visualizations. Raw filtered context file remains available; no new standalone
images were added. This supersedes the cutoff20 heatmap description below.

Cr/Cb4x display gain remains. Finger detection, shadow measurements, DFS and
contact decisions are unchanged. Release build, CTest1/1 and11-scene parity/CLI
checks passed, with updated composite assertions for mask exclusion, exact
color agreement with original filtered heatmap, visible luma111 and darkening
6/20, exclusion at floor5, retained residual filtering, and unknown gray.
Installed clang-format20 passed. Real-image regeneration stays with the user;
only this handoff updated.

### Cr mask with active shadow heatmap; brighter Cr/Cb displays (November 5)

User requested seeing the shadows actually used alongside/in the Cr finger
mask. In `comparison.png`, the former boundary-mask panel now overlays the
finger mask in dark blue on an active shadow heatmap. Its neighboring panel
(previously color-shift context) shows that active shadow heatmap without
fingers. Color-shift context remains individually available as before.
Raw `boundary.png` remains the binary mask. No new standalone heatmap files.

Active heatmap matches the DFS projection-mode pixel rules at cutoff20:
finger-mask pixels black, unavailable evidence gray, remaining pixels colored
only for darkening>20 and residual<=configured tolerance, with current-luma<=110
when dark-only is selected. Color encodes luma drop on the same fixed5..100
scale, with saturation above100. These are eligible pixels before per-candidate
geometry/path/width checks, not accepted contacts or only successful DFS paths.
Original `heatmap-shadow.png` remains the broader projection-compatible context.

User also requested brighter Cr change, then Cb change. Both YCrCb absolute
change channels now use4x display gain (gray=clip(4*raw byte-equivalent change,
0,255)). This applies in color grids and their main-comparison change panels.
Current/reference channels, Y change, raw measurements, Cr mask threshold and
all detector/DFS logic are unchanged. Captions, gallery text and report
visualization metadata identify the gain and clipping.

Release build, CTest1/1 and11-scene parity/image CLI checks passed. New composite
pixel assertions cover blue Cr fingers, exclusion of fingers from active
shadows, inclusive luma110/excluded111, strict darkening20 and unknown gray.
Additional color-grid assertions verify Cr/Cb4x values and saturation at white;
existing CLI tests still verify the actual Cr mask threshold remains10.
Installed clang-format20 passed;17 unavailable. Real-image regeneration remains
with the user; no numbered reports regenerated. Only this handoff updated.

### Temporary default: Cr-only finger mask, original shadow/DFS rules (November 5)

User observes Y/Cr change panels look promising, then explicitly requested
**Cr alone for identifying fingers; everything after stays the same**. New
separate `CrFingerDetection.hpp/.cpp` exports `crChangeFingerMask` and
`identifyCrChangeFingertips`. For matched opaque analysis pixels it classifies
`abs(Cr_current - Cr_reference) > minimumChange`, initially10 in0..255-equivalent
units. This is a provisional threshold, not tuned or verified contact accuracy.
Cr uses OpenCV YCrCb coefficients: `Y=.299R+.587G+.114B`,
`Cr=.713*(R-Y)+offset`; the offset cancels. Y participates only in Cr's
definition, with **no separate Y/darkening/reference-brightness gate** on the
finger mask. Alpha0 excludes unavailable pixels. Both signs of Cr change count.

The old projection mask function remains unchanged. Both routes feed the same
extracted `identifyFingertipsFromMask` component/plateau/lobe geometry. Original
measurement and DFS code remain unchanged: shadow candidates still require
reference-relative Rec709 luma darkening and projection compatibility, with
optional dark-only current-luma110, cutoff20, width3 and paired directional
rules. This is a finger-mask substitution, not a YCr shadow classifier.

Native image/camera executables and the Python image runner now default to
`--finger-method=cr`. `--cr-threshold=10` adjusts the provisional mask threshold;
`--finger-method=projection` restores the previous mask. Camera example:
`sh backend/run_shadow_camera.sh --camera=1`. Image rerun:
`python3 backend/run_shadow_images.py --rebuild --dark-shadows-only --residual 0.125`.
Reports/root galleries identify actual finger method and Cr threshold; the
boundary panel labels Cr-only masks accurately. Mixed-method/threshold partial
runs do not overwrite mode-specific CSV snapshots. Current numbered reports
have not been regenerated; user wants to run their own tests.

Release builds passed for existing still-image and optional camera targets.
CTest1/1 and camera CTest6/6 passed, plus11-scene frontend parity/CLI checks
(explicit projection mode preserves the original oracle) and6 Python runner
tests including forwarding Cr settings. New synthetic checks cover both Cr
signs, brighter finger pixels, neutral darkening/unchanged regions, low Cr,
alpha, dark reference without a brightness gate, threshold overrides, immutable
and noncontiguous inputs, invalid settings/masks, shared tip geometry, temporary
CLI default/provenance and legacy selection. Installed clang-format20 passed;
17 remains unavailable. Python Ruff/mypy still unavailable in selected Python.
No new live/held-out accuracy or latency claims. Only this handoff updated per
user instruction; broader docs/inventory remain deferred.

### Color output simplified to comparisons only (November 5)

User chose to reduce clutter. Stopped exporting the63 individual current/
reference/change color-channel PNGs per report; retain7 color-space comparison
grids plus the main comparison containing channel changes. Removed the HTML
individual-channel section. Channels remain available in memory for composing
the same grids, with identical conversions/scales and no detector changes.

Removed1638 generated files matching exactly
`color-{rgb,hsv,lab,ycrcb,normalized-rgb,cmy,ryb}-{current,reference,change}-[123].png`
from the results root and existing three-digit case folders. Removed obsolete
individual-channel sections from25 existing galleries. Preserved comparisons,
raw diagnostic inputs and all original capture/reference photos. No real-image
regeneration or detector rerun for this cleanup.

Release build, CTest1/1 and11-scene parity/image CLI checks passed. Channel-value
assertions now read the comparison tiles instead of standalone files; exporter
checks verify all7 color grids exist and none of the63 individual files is
created. Installed clang-format20 passed;17 remains unavailable. User continues
to handle real-image generation. Only this handoff updated.

### Added all requested color-channel views for observation (November 5)

User requested RGB/HSV/Lab/YCrCb/normalized-RGB/CMY/RYB views and wants to
observe without tuning. `ColorDiagnostics.hpp/.cpp` now renders7 color-space
grids into every newly generated native image report. Each
`color-SPACE-comparison.png` has3 rows (current, reference, absolute change)
and4 columns (RGB context followed by the3 grayscale channels). Individual
channel PNGs use `color-SPACE-current/reference/change-1/2/3.png` with descriptive
titles in the gallery. HTML groups the7 grids under "Color spaces" and keeps
the63 individual channel PNGs in an expandable section. Main `comparison.png`
also appends all21 absolute channel-change panels, grouped into3-column rows;
overall12 rows with2 spacer cells after the original13 panels. All inputs stay
at the same analysis resolution.

Conversions apply to current/reference separately, never to RGB subtraction.
RGB and CMY use normalized0..1; normalized RGB divides by channel sum;
HSV uses floating H0..360deg,S/V0..1; Lab uses L0..100,a/b displayed-128..127
(neutral near midgray); YCrCb floats use0..1. Every channel is displayed as
grayscale with a fixed declared range, no automatic contrast. Changes show
absolute differences over each channel's full range. Hue change uses shortest
circular distance0..180deg, with undefined achromatic hue gray128. Undefined
normalized RGB on pure black is also gray128. These views are raw, without the
detector's validity/residual/brightness gates. Existing tinted RGB subtraction
continues to show one-sided darkening, distinct from absolute color changes.

RYB is explicitly labeled a nonstandard artist-style approximation: remove the
minimum RGB as white, extract shared red/green as yellow, redistribute remaining
green into yellow/blue (halve green/blue first if both present), rescale the
maximum to the original post-white maximum, then restore white. It is a visual
heuristic, not a physical pigment model or added detection evidence. CMY is
simply1-R/G/B and its absolute changes are redundant with RGB.

Release build, CTest1/1,11-scene parity/image CLI checks and installed
clang-format20 passed. New checks cover RGB/CMY channel order/values, normalized
neutral/pure-red/undefined-black values, HSV S/V and undefined hue, circular
hue wraparound, Lab/YCrCb neutral channels, RYB examples, grid and expanded
comparison dimensions. No detector changes or accuracy claims. Real-image
reports were not regenerated: user previously elected to generate them. Run
`python3 backend/run_shadow_images.py --dark-shadows-only --residual 0.125`
to generate from `experiment/`; it will renumber by sorted current inputs and
overwrite standard numbered reports as usual. Only this handoff updated;
broader docs/inventory remain deferred per user instruction.

### Added subtraction and isolated RGB comparison panels (November 5)

Native diagnostics now append4 panels to the existing9: raw RGB subtraction
and R-only/G-only/B-only subtraction. Formula is per-channel
`max(reference - current, 0)` on analysis-sized BGR inputs; display0..255,
no normalization, residual/luma filtering or candidate annotations. Isolated
channels retain their original red/green/blue tint and zero the other channels.
Files: `subtraction.png`, `subtraction-r.png`, `subtraction-g.png`,
`subtraction-b.png`; also shown individually in the case gallery. The combined
comparison retains3 columns and now has5 rows (13 panels,2 unused cells).
This is display-only; detector settings/measurements/decisions are unchanged.

Release build and CTest1/1 passed. Existing parity helper passed11 synthetic
scenes and image CLI checks, including new channel-order/value assertions,
unchanged black pixels, clamping brighter channels instead of wrapping or
absolute differencing, artifact presence and expanded composite dimensions.
Installed clang-format20 checks passed;17 remains unavailable. Regenerated
current camera cases000–005 in place with their exact prior settings and IDs;
complete candidate geometry/decisions/search traces matched before/after for
all6. Visually inspected000 composite. No other numbered reports regenerated.
User then said they will handle generation; no further report runs initiated.
Only this handoff updated; broader docs/inventory deferred per user instruction.

### New-lighting review: focus000, all fingers hovering (November 5)

User wants to review one finger/case at a time. In current000, user explicitly
labels **no fingers touching**. Rightmost actual fingertip/index is candidate10
at analysis(335,154), a false MATCH at cutoff20. Report has upward support and
no downward veto/UNKNOWN;7 upward searches qualify,0 downward searches reach.
Residual0.125/dark-only/luma110/width3 remain active.

User's causal explanation: the dark shadow directly beyond this fingertip is
being included in the finger mask. That extends the estimated finger boundary
into shadow, so the forward/downward shadow extent is measured from the wrong
starting boundary and a hovering finger can pass. This is a concrete segmentation
hypothesis consistent with the false MATCH, not independently established pixel
ownership. Next inspection should compare the true fingertip edge with the
mask/arc and swallowed forward-shadow region for000/candidate10. Do not conflate
this with the missing-dark-seed rejections in other new frames or change the
DFS width based on them. No detector edits, threshold tuning or image reruns
during this review. Yesterday's correct separation was user-reviewed development
evidence; the new lighting reveals that it does not establish robustness.

### Image runner now supports camera reference pairs (November 5)

Dataset consolidation: user removed the11 incompatible older screenshots and
their references from `experiment/`, then requested moving the original test
dataset there. Moved all40 PNGs from `images_test_cases/` into `experiment/`
(19 hand images plus background, each with its reference). No name conflicts;
SHA256 verified every moved file. The6 camera pairs were preserved. Read-only
runner discovery now finds26 valid pairs, including the background self-check.
`images_test_cases/` remains empty; historical paths below describe prior runs.
No detection reports were regenerated during the move.

User changed the Python image runner's default input to repo-root `experiment/`.
`--input images_test_cases` remains available for the older dataset. This does
not resolve the11 mismatched reference copies described below or change the
optional dark-only flag; no image processing run was performed for this edit.

User requested consistent per-image filenames. Copied the existing
`images_test_cases/background.png` to20 matching `*-reference.png` files in
that folder (19 hand images plus the background self-check). Each copy's
SHA256 matched the original background; existing references were preserved.
No detection reports rerun. The6 current camera pairs in `experiment/` already
follow this naming. Its11 older hover/press screenshots use different native
dimensions/framing from the shared background (visually checked0_hover_middle),
so no incompatible reference was assigned; asked user for their matching source.

Location correction: user clarified the named copies belong in `experiment/`.
Added11 missing `<photo-stem>-reference.png` copies there from
`images_test_cases/background.png`, preserving all6 existing camera references.
Verified copied bytes via SHA256. These11 are filename-consistency copies,
not verified scene-matched references: the known framing/resolution mismatch
still applies, and native subtraction cannot use mismatched image dimensions.
No resizing, alignment, image relabeling or report rerun performed.

Run only the new camera captures from the mixed experiment folder with:

```sh
python3 backend/run_shadow_images.py --input experiment \
  --pattern 'camera-*.png' --dark-shadows-only --residual 0.125
```

Each `PHOTO.png` uses `PHOTO-reference.png` when present. Reference-suffix
PNGs never become cases. Legacy images can still use shared `background.png`,
including its historical self-check to preserve existing case numbering.
Camera-prefixed captures must have their paired reference even if a shared
background exists; missing references are reported before processing or output
replacement. B then S in the camera viewer already saves the correct pair.
Reference PNGs may duplicate the same B capture across shots; retain pairing
because it stays correct when B changes. If renaming a photo, rename its
reference to the same stem plus `-reference.png`.

`--pattern` filters filenames before numbering, so the selected input set
defines000..NNN IDs. Default output remains existing `backend/test-results/`;
running replaces the numbered reports and root gallery as before. No real
reports were rerun during this change. Root summaries/gallery now identify each
case's reference; partial-run galleries exclude reports whose source or reference
path no longer matches. These generated report JSONs remain distinct from the
user's PNG-only camera-capture preference.

Read-only discovery found6 valid camera pairs in the current experiment folder;
its11 older hover/press images have no pair/shared background there and are
excluded by the camera pattern. Do not assign those images a new camera reference
without verifying it belongs to their original scene.

`python3 -m unittest discover -s tests/cv -p test_shadow_image_pairs.py -v`
passed6 tests: legacy ordering/self-check, paired preference/reference exclusion,
mixed-folder filtering, missing camera reference rejection despite shared
background, nonexistent/empty inputs, and mocked native CLI per-case reference
arguments plus generated pairing summary. No native image-processing or physical
camera accuracy claim from these orchestration tests. Ruff/mypy unavailable in
the selected Python3.14 environment; those checks did not run. Only this handoff
is updated; broader docs/inventory remain deferred by user.

### Camera key overlay and test-photo capture (November 5)

Run `sh backend/run_shadow_camera.sh --camera=1` on the current Mac.
**S** saves a full-resolution, unannotated camera PNG directly to repo-root
`experiment/`, creating that requested folder if needed. After **B**, each shot
also saves its matching full-resolution empty-reference PNG. Unique timestamp/
suffix filenames preserve previous captures. Per user request, snapshots now
save PNG files only, with no JSON sidecars. Previously saved JSON files are
left untouched. Saving before B works, with no invented reference; the viewer
reports that no reference was saved. S saves only
on demand, never continuously; save failures show a message and keep the viewer
running. PNG encoding temporarily pauses the sequential camera loop.
`--snapshot-dir=PATH` overrides the folder. The launcher changes to repository
root before running, so `experiment/` stays anchored when invoked elsewhere.

**B** now also detects DICT_4X4_50 marker IDs0/1/2/3 in the same native frame,
using their diagonal intersections for centers. Four distinct IDs in convex,
nondegenerate order are required. Homography and empty reference stay frozen
together until B/R or a camera dimension change. If markers are missing, B still
captures a reference for image/shadow experiments but clears key calibration;
show all four markers and press B again to enable the key overlay. There is no
automatic hand-absence or camera/sheet-movement guard. Keep everything fixed.

Calibrated white-key outlines and C3..C4 labels follow the browser's marker
inset,23.5mm pitch and y0.1..0.9 strip. Keys turn green and appear in the
"Pressed" list for accepted cutoff20 patterns, then clear on rejection,
UNKNOWN or no candidate on the next frame. Multiple accepted tips on the same
key share one highlight. Off-keyboard proposals skip DFS once calibrated.
`--octaves=1/2/3` declares the assembled paper span and draws8/15/22 keys.
Black-key contact mapping, audio, tracking and hysteresis are not added.
Geometry/key eligibility is new to this viewer; the working native shadow
settings and core remain unchanged.

The local camera build now also enables OpenCV objdetect (ArUco) and its
calib3d/features2d/flann dependencies. A setup stamp forces an existing camera
build to upgrade once; the separate still-image build remains unchanged.
`tests/cv/test_camera.cpp` exercises synthetic four-marker acquisition,
perspective key hit testing, off-sheet rejection, missing/duplicate markers,
octave counts, native PNG pixel equality, matched-reference preservation,
unique captures, PNG-only output and missing/mismatched reference handling.
Local macOS arm64/AppleClang15 Release build passed with locked OpenCV4.12.0.
CTest6/6 passed: baseline, marker/key/snapshot checks, help and invalid
size/device/octave arguments. Launcher help/shell syntax and installed
clang-format20 checks passed. Physical key-overlay/S-key workflow review remains
pending; synthetic tests do not establish live contact accuracy or latency.
Only this handoff is updated per user instruction; no broader docs/inventory
changes, issue, commit, push or PR.

### Initial live native camera viewer (November 5; additions above supersede)

Run `sh backend/run_shadow_camera.sh` from the repository root. First launch
builds the locked OpenCV4.12 dependency with optional highgui/videoio enabled
in `build/shadow-camera/`; later launches rebuild only changed C++ files.
Conan and CMake must be installed. The existing `build/mog2/` stays independent.
Use `sh backend/run_shadow_camera.sh --camera=1` for another camera index.

On the current Mac, index0 shows OBS Virtual Camera; index1 opens FaceTime HD
Camera. The user confirmed the physical camera feed works with
`sh backend/run_shadow_camera.sh --camera=1`. Use that command on this machine.
This confirms camera preview only; reference capture and live classification
accuracy have not been verified. During troubleshooting the window-close check
was changed to ignore unsupported property value-1; the user clarified they
had manually closed the earlier window, so that exit was not evidence of a
window-backend defect. Rebuild and CTest4/4 passed after the change.

Aim a fixed camera at the sheet, with fingers pointing down in the image.
Let exposure settle, remove hands, focus the viewer and press **B** to capture
the empty reference. Left panel shows candidates and cutoff20 decisions;
right shows blue finger proposals, purple dark shadows, gray light shadows,
white clear pixels and black unavailable evidence. **B** replaces the reference;
**R** clears it; **Q/Esc** or closing the window exits. Recapture after moving
the camera/sheet or changing lighting. Camera dimension changes clear the
reference automatically. No automatic marker calibration or keyboard eligibility
is applied, so off-sheet proposals can appear. No audio or note tracking.

The viewer reuses the existing C++ measurement, proposal and DFS functions
without detector edits: residual0.125, dark-only luma<=110, upward width3,
cutoff20. Analysis is at most640 pixels on its longest side. Capture, analysis
and display run sequentially with no application frame queue. Buffer-size1,
1280x720 and30fps requests are best effort; driver buffering is not measured.
The displayed analysis duration excludes camera read and display, and is not
physical latency or delivered FPS. Development-image accuracy does not establish
live correctness. Keep the reference empty manually; there is no hand guard.

macOS may require camera access for the terminal under System Settings >
Privacy & Security > Camera. Close other camera apps if opening fails.
Headless CLI tests check help and reject invalid camera/analysis settings before
hardware access. User confirmed the physical camera preview above; reference
capture and touch/hover review still require a user-operated run.

Local macOS arm64/AppleClang15 Release build with locked OpenCV4.12.0
(AVFoundation camera backend and Cocoa windows) passed. CTest4/4 passed:
existing baseline plus help, invalid analysis size and negative device checks.
Launcher shell syntax and installed clang-format20 checks passed; required
clang-format17 remains unavailable. Assistant did not perform a physical-camera
or window test; the user's preview confirmation is recorded above.
Per the user's November5 instruction, keep this local and document only here;
broader docs/inventory updates are deferred. No issue, commit or PR created.

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
