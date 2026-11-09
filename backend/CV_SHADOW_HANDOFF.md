# CV shadow handoff — native dark, light, mid and live camera

Updated November 9, 2026. **Start here for the current native experiment.**
The [older handoff](../docs/cv_shadow_detection_status_and_next_steps.md) is
historical background; its earlier stopping points do not override this one.

## Resume here


### Session stopping point — resume from here (November 9)

**This is the current resume summary. Detailed sections below record earlier
implementation/verification and may describe superseded behavior or galleries.**
User is stopping and plans to return later. Live visual integration is finished;
physical-camera review is the next step. No sound was requested. Keep this a
local native-C++ experiment; preserve all working changes, source captures,
paired references, ignored reports, user notes and user-edited `_help.txt`.
Do not create issues/commits/pushes/PRs or regenerate a full gallery automatically.
User handles real-image generation and review. Broader docs remain deferred.

#### What works now

- Separate dark, light and mid detectors, with image and camera selectors for
  independent testing. Combined evaluation is dark -> light -> mid, stopping
  fallback computation on an earlier success. Independent light/mid evaluate
  every eligible candidate and report their own decisions even when dark passes.
- Native camera defaults to all three algorithms and uses the final decision
  for candidate colors and calibrated white-key highlights. Labels identify the
  accepting detector. Per-key acceptance is unioned across candidates each
  frame; rejection/UNKNOWN/missing candidates clear highlights. Off-keyboard
  proposals are gated once calibrated. No audio, temporal tracking/hysteresis,
  browser integration or validated physical contact performance was added.
- Current segmentation/search defaults: Cr13, `cr-otsu` radius2, DFS c4/d2/e4,
  margin9, upward width2, dark current-luma cap110, dark drop>20. Light retains
  its two-column/two-row clear-front test with substantial supporting side blobs.
  Keep these stable while reviewing independent algorithm errors.
- Mid front requires two consecutive near-tip columns with four available,
  outside-mask pixels downward per column: <=1 brown and <=1 gray, faint ignored,
  dark/finger/unavailable rejected. Clear front pixels are allowed; shadow is
  not required. Side scans start at the finger-mask edge on the tip row and
  repeat for six rows upward, following contiguous mid+dark pixels directly
  adjacent to the edge. Normally opening width>=2 starts within3 rows, net
  growth>=3 and fitted slope>=0.5; one side suffices. Observed component area
  and forward-extension limits still apply. Finger-blocked rows can supply
  assumed opening support, including a subsequent mask merge; flags preserve
  actual visible widths, with no invented shadow length or hidden area.

#### Commands to use next time (repository root)

```sh
# Live visual testing: all three by default; physical webcam on this Mac.
sh backend/run_shadow_camera.sh --camera=1

# Individual live detector; replace mid with dark or light as needed.
sh backend/run_shadow_camera.sh --camera=1 --algorithm=mid

# Separate image runs: choose ONE algorithm at a time.
python3 backend/run_shadow_images.py --rebuild --algorithm dark
python3 backend/run_shadow_images.py --rebuild --algorithm light
python3 backend/run_shadow_images.py --rebuild --algorithm mid

# Combined image run; retains the existing flag-based workflow.
python3 backend/run_shadow_images.py --rebuild --dark-shadows-only --light-shadow-test --mid-shadow-test

# Gather EXISTING output images; no detection rerun.
node backend/gather_shadow_classes.cjs
node backend/gather_candidates.cjs
```

Camera controls: with a fixed camera/sheet and fingers pointing down, remove
hands, show marker IDs0/1/2/3 and press **B** for reference+key calibration.
**S** saves native source/reference PNG pairs under `experiment/`; **R** resets;
**Q/Esc** quits. Camera0 is OBS Virtual Camera; camera1 is FaceTime HD Camera.
Recapture after camera/sheet/lighting changes. Hand absence and movement guards
are manual in this native viewer. `--octaves=1|2|3` selects assembled paper span.

Image runs replace numbered reports and `backend/test-results/index.html`.
Uniform independent runs retain `dark-only-results.csv`, `light-only-results.csv`
and `mid-only-results.csv`; the general `results.csv` reflects the current run.
Do not mix individual `--algorithm` selection with fallback-test flags.
**Image `--algorithm combined` alone retains legacy defaults; use the full
combined image command above to enable dark-only plus both fallbacks. Camera
`--algorithm=combined` enables all three directly.**
Normal per-case PNGs are ONLY `source.png`, `shadow-classes.png`,
`shadow-compatible.png`, `candidates.png`, `comparison.png`; JSON/HTML/CSV reports
remain. Raw measurement dumps and standalone extra diagnostics are retired;
successful case regeneration removes only known obsolete generated filenames,
protecting inputs/unrelated files. Overview outputs are `all-shadow-classes.png`
and `all-candidates.png`; both support `--scale 0.5`, `--columns`, `--input` and
`--output`. They gather current numbered images, so regenerate them after a run
when you want the overview to reflect the new detector mode or captures.

#### User observations to carry forward

Read and preserve the user's ignored note file:
[`test-results/shadow_algos_observations.md`](test-results/shadow_algos_observations.md).
User reports good combined separation on the examples reviewed and is comparing
individual algorithms to identify their own false negatives/positives. This is
qualitative development review, not a scored or held-out accuracy result.
User wants more tests with neighboring-finger occlusion, especially like009/1.

Earlier mid-only review traced the following saved spatial candidates. All
listed candidates passed the front strip; their side checks explain rejection.
IDs belong to those saved frames/configurations and must be matched to source
paths/coordinates before reusing labels after a dataset or segmentation change.

| Reviewed case/candidate | Finding |
| :--- | :--- |
|001/7,001/10|Side opening starts4 and6 rows above tip; maximum3.|
|003/5|Only2 pixels net side growth and slope about0.393; requires3 and0.5.|
|004/3 (known hovering)|Right side growth2, slope about0.464; both fail. Its front does pass.|
|004/6,004/7|Opening starts5 rows above tip.|
|006/3|Initial supporting fragment is disconnected from the larger side mass; not merely a late opening.|
|006/4|Accepted via opening within3 rows and finger-blocked support.|
|017/2|Right widths5,4,5,7,7,7,7: net growth2 fails3; slope0.5 meets its limit.|
|018/3|Right widths7,5,6,6,8,10,9: net growth2 fails3; slope about0.643 passes.|
|021/4|Left supporting mass reaches tip+3, exceeding allowed tip+2; right side has insufficient widening.|

Allowing two brown front pixels would not recover these particular misses,
because their fronts already pass. User asked about that relaxation but it
has **not** been implemented or evaluated. Likewise, reducing net side-growth
minimum3 to2 is a possible experiment for017/018, not an agreed or applied
change. Dark front shadows are rejected before brown counting; they are not
silently treated as mid. No thresholds changed during the observation review.
Evaluate any future relaxation against known hovering cases and the complete
labeled set, not only recovered presses.

#### Evidence, current artifacts and next steps

Latest camera Release build and CTest **7/7 passed**; launcher `--help` passed.
Checks include baseline; synthetic markers, key mapping, snapshots and camera
algorithm dispatch using supplied masks; and help/invalid size/device/octave/
algorithm checks without opening hardware. Image work previously passed native
CTest1/1, Python runner8/8 and11-scene frontend parity plus export checks.
clang-format20.1.7 passed; exact17 unavailable. No new tests were run just for
this documentation update. The assistant has not opened the physical camera
or verified live movement, contact, delivered FPS or physical latency.

**Current read-only report inventory at session end:41 numbered reports,
225 candidates, all marked `combined`.** Earlier31-image/161-candidate native
comparisons are historical verification on that earlier set; do not describe
them as a fresh pass on the current41 cases. Case numbering can change when
captures are added or the input selection changes. Keep ignored images with
their reference pairs and results; a clean checkout cannot recover them.

Resume with the user's actual camera observations: combined first, then
individual modes as useful. Check key-highlight stability during approach,
close hover, held contact and release, and note the displayed analysis time
under those conditions. The displayed time excludes camera read/display and
is not physical latency or delivered frame rate. Save difficult examples with
S and review the source/reference pair before changing thresholds. Added
light/mid computation has not been profiled on real live frames. If the user
returns to still-image tuning, start from the notes above, preserve known hover
counterexamples, and keep segmentation fixed unless new evidence warrants it.


### Live camera now uses all three shadow algorithms (November 9)

Run from the repository root:

```sh
sh backend/run_shadow_camera.sh --camera=1
```

The camera default is now `--algorithm=combined`: dark -> light -> mid,
sharing the frame measurements, Cr/Otsu mask and distal arc. Existing dark
success skips fallback work, light success skips mid, and the final combined
result controls both candidate colors and calibrated white-key highlights.
No audio is connected. Camera1 remains the physical FaceTime device on this
Mac; camera0 is OBS Virtual Camera.

For individual live testing, use `--algorithm=dark`, `--algorithm=light` or
`--algorithm=mid`. Explicit `--algorithm=combined` also works. Independent
light/mid evaluate every eligible candidate regardless of dark's result, just
like the image selector. Mode selection is validated before opening hardware;
invalid values fail without acquiring a camera. The selected algorithm appears
in console/status; accepted candidates identify dark/light/mid as their source.
The right panel now uses the same mid/brown and faint/lavender brightness tiers
as still images, alongside magenta dark, gray light, blue fingers, white clear
and black unavailable.

Controls are unchanged: remove hands, keep camera/sheet fixed, show all four
markers and press B for reference+keys; S saves the clean native photo/reference
pair, R resets and Q/Esc quits. Marker failure still permits a reference but
leaves key calibration unavailable. Calibrated off-keyboard candidates are
excluded before expensive classification; per-key union is recomputed each
frame, with rejected/UNKNOWN/missing evidence clearing highlights. Reference/
calibration resets, snapshot handling and fixed 640-side analysis are unchanged.

`CameraShadow.hpp` is an in-memory camera dispatch helper with no capture/GUI
ownership. It calls the existing dark/light/mid implementations and shared
`finalShadowDecision`, and is exercised directly by synthetic camera tests.
Sequential capture/processing remains; added fallback work may change analysis
time and delivered responsiveness. No frame-rate/physical-latency or live-contact
accuracy claim follows from the build or synthetic checks.

Local macOS arm64 Release camera build passed. CTest7/7 passed: baseline,
synthetic marker/key/snapshot/algorithm group, help and invalid size/device/
octave/algorithm CLI checks. Added camera fixtures use supplied finger masks and cover clear paper,
isolated dark, light and mid patterns; combined fallback precedence, individual modes
evaluating despite earlier matches, mapping accepted tips to calibrated keys,
and UNKNOWN evidence not highlighting a key. Launcher `--help` and installed
clang-format20.1.7 passed; exact17 remains unavailable. No GUI or physical camera
was opened by the assistant, and real movement/hover/release/performance review
remains for the user's camera run. Ordinary still galleries/captures preserved.


### Independent algorithm selection (November 9)

Use the new selector to evaluate one algorithm on every candidate:

```sh
python3 backend/run_shadow_images.py --rebuild --algorithm dark
python3 backend/run_shadow_images.py --rebuild --algorithm light
python3 backend/run_shadow_images.py --rebuild --algorithm mid
```

These are separate runs; each replaces the ordinary gallery and numbered case
reports, as before. Uniform runs retain `dark-only-results.csv`,
`light-only-results.csv` or `mid-only-results.csv` alongside the current
`results.csv`. Existing gather scripts can assemble the selected run's
candidates/classes afterward. No ordinary gallery was regenerated during
implementation; verification used temporary outputs.

Independent selection implies dark-class DFS context, so no extra
`--dark-shadows-only`, `--light-shadow-test` or `--mid-shadow-test` flags are
needed. Mixing a single-algorithm selector with fallback-test flags is rejected.
`--algorithm combined` is the default and preserves the earlier flags/behavior;
the previous combined command still works:

```sh
python3 backend/run_shadow_images.py --rebuild --dark-shadows-only --light-shadow-test --mid-shadow-test
```

Light/mid's independent calls bypass earlier-success skip gates. Dark/light/mid
results, candidate colors and comparison results use only the selected
algorithm; earlier matches cannot override a selected rejection or UNKNOWN.
Shared Cr/Otsu segmentation and existing arc geometry are unchanged. Dark DFS
traces remain in JSON as context/geometry for standalone light/mid runs; those
decisions do not control the standalone result. Incomplete light/mid front
geometry remains UNKNOWN; light's unavailable-strip result is also UNKNOWN.
Other evaluated light/mid nonmatches are reported as their own NO_MATCH rather
than borrowing dark's result.

JSON and per-case/root HTML identify `algorithm`; JSON also records
`independentAlgorithm`. A match's `decisionSource` is the selected algorithm.
Mixed partial runs label algorithms per case and do not overwrite uniform
algorithm CSV snapshots. Five PNGs per normal case remain unchanged; compact
exports still save JSON plus candidates only. No threshold/contact rule changed.

Local Release build, CTest `cv_baseline`1/1, Python runner8/8, and11-scene
frontend parity plus image-export checks passed. Added synthetic independence
coverage for light evaluating after dark acceptance, mid evaluating after both
earlier acceptances, selected failures ignoring other successes, independent
successes, dark UNKNOWN, incomplete mid UNKNOWN and preserved combined behavior.
Python coverage exercises all three selectors without old flags, summaries,
mode-specific CSVs, gallery labels, mixed partial snapshot preservation and
invalid/ambiguous modes. Native invalid selectors/conflicting flags were also
checked before input/output access. clang-format20.1.7 passed;17 unavailable.

Temporary comparison ran combined + all three individual modes on31 images,
161 candidates each. All combined candidate records exactly reproduce the saved
ordinary reports; geometry/arcs are unchanged throughout. Independent light and
mid each evaluated all161 candidates, including all18 accepted by dark.
Light rejects17 of those18; mid rejects13, demonstrating that dark successes
cannot hide their independent rejections. Overall acceptance counts18/25/12
(dark/light/mid) are algorithm outcomes, not accuracy or false-positive rates;
several proposals are above the paper and labels remain manual. Results and
summary are in
`/var/folders/kq/8n8k7x6x4c160nx6p6f9hp0c0000gn/T/makeshift-independent-37y152i9/`.
Actual Python single-case008 runs for each selector also verified the report
labels, all-five PNGs, evidence evaluation and CSV snapshots in
`/var/folders/kq/8n8k7x6x4c160nx6p6f9hp0c0000gn/T/makeshift-selector-gallery-9n_db0ov/`.
No CI/hardware, held-out contact accuracy or physical latency claim.


### Gather all candidate overlays (November 9)

Run from the repository root:

```sh
node backend/gather_candidates.cjs
```

This combines existing `NNN/candidates.png` in numeric order into
`backend/test-results/all-candidates.png`, labeled by testcase with8 columns.
It matches the shadow-class gathering script's options: `--scale 0.5`,
`--columns 4`, `--input PATH` and `--output PATH`. Defaults are anchored to the
script; explicit paths resolve from the current directory. No detection or
case-report regeneration. Only three-digit testcase folders are included;
missing candidate images are skipped. The previous overview is replaced only
after encoding completes. Input/output directories must already exist.
Requires Node and sharp from the installed frontend dependencies.

Local syntax check and normal generation passed:31 candidate overlays combined
into5300x1997 pixels, approximately11.5MB at full size. Individual reports and
the shadow-class overview were preserved. No new detector/accuracy/latency or
CI result is claimed.


### Five-PNG image exports (November 9)

User requested reducing generated image files to exactly:
`source.png`, `shadow-classes.png`, `shadow-compatible.png`, `candidates.png`
and `comparison.png`. Normal native/Python image generation now saves only
these five PNGs, plus the existing `results.json` and HTML/CSV summaries needed
by the scripts. The raw `measurements.yml.gz` dump is no longer generated.
The brightness sweep retains its existing compact mode (JSON + candidates PNG).
No detector, segmentation, threshold or decision logic changed.

The combined comparison retains its layout and channel-change/heatmap panels.
Standalone native-resolution copies, DFS/heatmap/subtraction/color grids and
light/mid overlay images are retired. Their construction is skipped where not
needed by the comparison; color diagnostics compute only the channel changes
for this export. `results.json` retains complete dark/light/mid evidence and
occlusion rows, but its visualization metadata no longer advertises removed
files. The HTML galleries link only to retained files.

After a successful full case export, the runner removes an explicit list of
obsolete generated filenames in that output folder (including older individual
color-channel PNGs and the raw dump). It preserves unrelated files, symlinks,
current/reference inputs and all other cases. No broad PNG wildcard deletion.
Existing ordinary reports remain untouched until the user regenerates those
cases. The ordinary31-case gallery was not regenerated for this change.
The generation command and flags remain unchanged.

Local verification: Release build, CTest `cv_baseline`1/1 and Python runner7/7
passed. The parity/export helper passed11 synthetic frontend parity scenes and
native CLI checks for the exact five-file PNG set, retired-file cleanup,
unrelated/input preservation, valid HTML links, homography/decisions/settings,
overwrite/invalid inputs, retained comparison pixel semantics and dimensions.
Historical frontend parity explicitly freezes d4/width5; native experiment
defaults remain d2/width2. Standalone current/reference color grids and native
original exports are retired, so their old artifact checks were removed; retained
channel-change/heatmap/mask assertions now inspect the comparison panels.
The checker also uses current brown class expectations instead of old gray
expectations at drop>=40. Installed clang-format20.1.7 passed;17 unavailable.

A temporary full009 export preserves every candidate record and all five image
contents except the updated source-caption text. It saves5 PNGs/7,879,131 bytes
versus33 PNGs/34,509,117 bytes for the previous009 export (PNG sizes only, not
RAM profiling or a whole-gallery measurement). Evidence:
`/var/folders/kq/8n8k7x6x4c160nx6p6f9hp0c0000gn/T/makeshift-five-png-image-dnoz5_nd/`;
synthetic parity/export evidence:
`/var/folders/kq/8n8k7x6x4c160nx6p6f9hp0c0000gn/T/makeshift-five-png-tests-668h49sq/`.
No new contact accuracy, latency, CI or hardware result is claimed. Prior notes
below describing additional exported artifacts are historical.


### Mid-or-darker sides and finger-blocked support (November 9)

This supersedes the initial brown-only mid implementation below. User clarified
that side measurements must include both brown/mid and magenta/dark shadows.
User also requested an experimental occlusion rule: a side-shadow run ending at
another finger supplies sufficient opening support, and a subsequently merged
finger row can continue that support. Do not assign arbitrary numeric lengths
or add hidden/finger pixels to observed shadow area. Front checks are unchanged.

`MidShadow.cpp` now follows valid, outside-mask pixels with drop>5 and either
current luma<=selected dark cap OR drop>=40. Gray and lavender are excluded from
side scans unless they satisfy the selected dark cap's magenta class. The front
still allows one brown plus one gray pixel per scan, ignores faint thickness,
and rejects dark, unavailable or finger samples. A two-column thin front remains
required; it does not independently establish physical contact.

A side row is `fingerOccluded` only when a contiguous observed mid/dark run
ends directly at valid finger-mask pixels. Clear, gray/faint or unavailable gaps
do not bridge to a finger. Once a previous row actually met a finger, a sudden
outward mask-edge jump greater than max(2,ceil(0.15*tip.width)) with mask at the
previous edge's outward neighbor is recorded as `maskMerged`. That row anchors
to the last target edge and supplies blocked support with zero visible width.
This is a local mask/occlusion hypothesis, not anatomical tracking or a claim
that the hidden shadow actually widens. It addresses009's connected masks.

If the final upward row is finger-blocked, the experimental occlusion rule
satisfies the growth/slope qualification. A later fully visible endpoint uses
its actual width and trend; earlier occlusion does not automatically pass it.
Occluded rows are excluded from the numeric fit. Early opening, connected
visible shadow, minimum observed area and maximum visible forward extension
remain required. Merged rows are exempt only from the visible-shadow-row
connectivity check; they never increase shadow area.

JSON exports `sideRows` with actual `visibleWidth`, `fingerOccluded`,
`maskMerged`, `scanLimit`, edge and endpoint coordinates; `usedOcclusion` and
`shapeAcceptedByOcclusion` distinguish the assumption from measured growth.
When endpoint occlusion supplies shape support, `growthMeasured` and
`slopeMeasured` are0, and numeric0 fields are placeholders, not shadow lengths.
`maximumEdgeStep` records the merge threshold. Orange overlay pixels mark the
blocked endpoints; cyan mass contains only observed mid/dark pixels.

The command remains:

```sh
python3 backend/run_shadow_images.py --rebuild --dark-shadows-only --light-shadow-test --mid-shadow-test
```

Local Release build and CTest `cv_baseline`1/1 passed; Python runner7/7 passed.
Synthetic coverage now checks dark pixels joining mid regions, selected dark
cap inclusion, finger-blocked shrinking widths and merged masks, zero measured
width at merge, exclusion of finger pixels from area, later visible narrow
endpoints, front invalidation, absent visible mass and clear/gray/unavailable
gaps before a neighboring finger. Existing front/late-opening/angled-finger,
forward-extension and dark/light preservation cases remain in the suite.
Installed clang-format20.1.7 passed; required17 remains unavailable.

Temporary31-case/161-candidate comparison preserves all geometry, complete dark
traces and complete light records. Only007/candidate2 and009/candidate1 change
from the previous mid implementation. Together with existing008/2 and010/3,
all four user-labeled misses now match. Known hovering004/3 and002/4 remain
rejected;021 gains no matches.007/2 passes observed mid/dark geometry (widths
2,3,7,8,9,9,9; last three scans are capped).009/1 is3 followed by five
finger-blocked runs and one merged row: actual visible widths3,5,4,3,3,2,0,
with blocked flags0,1,1,1,1,1,1. Its20 observed mass pixels exceed minimum12;
hidden area is not counted. These are development-set results, not held-out
accuracy or physical latency measurements.

Evidence lives in
`/var/folders/kq/8n8k7x6x4c160nx6p6f9hp0c0000gn/T/makeshift-mid-occlusion-saqnuahs/`
with `comparison-summary.json` and temporary reports. Ordinary gallery and all
captures are preserved; no full gallery regeneration. The earlier temporary
brown-only reports remain separately available. Keep dark/light algorithms and
finger segmentation stable. Issues, commits, pushes, PRs and broader docs remain
deferred.


### Initial mid-shadow algorithm implemented (November 9)

The thin-front/sideways-opening rule is now a separate native algorithm in
`src/CV/MidShadow.cpp`, with its public entry point in `MidShadow.hpp` and
separate `MidShadowEvidence` in the shared result types. `LightShadow.cpp`
and dark DFS behavior are preserved. The optional `--mid-shadow-test` flag
runs mid after dark and any enabled light test fail; a success is reported as
`decisionSource: "mid"`. Failed mid evidence retains the original dark/light
outcome, including UNKNOWN. No browser or camera integration is added.

Run from the repository root when ready to regenerate the ordinary gallery:

```sh
python3 backend/run_shadow_images.py --rebuild --dark-shadows-only --light-shadow-test --mid-shadow-test
```

Omit `--mid-shadow-test` to retain the previous behavior. Mid requires dark-only
mode, but can run without the light test. The runner records enabled algorithms
in its gallery and summary and uses distinct `*-plus-mid-results.csv` snapshots.
The ordinary gallery was not regenerated during implementation.

Initial algorithm measurements, chosen from the saved images:

- Front: use the existing distal arc's lowest pixel per column. Require at
  least two consecutive columns in the central half-width, no more than one
  row above the tip. Scan four pixels downward outside each column. Allow at
  most one brown and one gray pixel per scan; ignore faint/lavender thickness.
  Dark pixels, finger pixels and unavailable samples reject a scan.
- Sides: follow brown only (drop >=40, current luma above the selected dark
  cap), excluding gray, lavender and magenta. Starting from the finger mask
  edge on each row, measure contiguous outward brown width over the tip row
  and six rows upward. One side suffices. Width must first reach two pixels
  within three rows of the tip, gain at least three pixels across the window,
  and have a fitted width-versus-upward-distance slope >=0.5. The fit allows
  irregular widths rather than requiring monotonic growth at every pixel.
- The measured width is separation from the local finger edge. An angled finger
  with a parallel, constant-width shadow does not qualify. The brown component
  must connect all measured rows from opening onset, have area at least
  max(6,ceil(0.04*width^2)), and not extend more than two rows below the tip.
  Local bounds limit searches to the finger neighborhood. These are initial
  experimental thresholds, not measured physical distances or validated labels.

JSON has a separate `midShadow` record, front samples, qualifying side boundary,
finger edge, connected mass, thresholds and match reason. `mid-shadow.png`
shows white front strip, green front scans, yellow finger edge, magenta brown
boundary and cyan brown mass. Light retains its separate overlay and evidence.

Local verification: Release build and CTest `cv_baseline`1/1 passed. Synthetic
coverage includes either single side, front thickness/strip limits, ignored
faint pixels, unavailable front/side samples, dark front, late/constant-width
openings, angled fingers, excessive forward extension, gray-only sides,
selected dark-cap boundary, separate final decisions and dark/light skip rules.
Python pairing/runner tests7/7 passed, including opt-in forwarding, summary,
gallery link, distinct CSV snapshot and incompatible-mode rejection. Installed
clang-format20.1.7 passed; required17 is unavailable.

Temporary compact comparisons processed all31 saved images and161 candidates.
All candidate IDs/positions/widths/arcs, complete dark traces and complete light
evidence exactly match the saved ordinary reports. Only008/candidate2 and
010/candidate3 change NO_MATCH to mid MATCH, agreeing with their existing user
press labels. Known hovering004/candidate3 and002/candidate4 remain rejected;
021 gains no matches.007/candidate2 and009/candidate1 remain rejected. This
brown-only rule does not infer hidden evidence in009. These are development-set
results, not held-out accuracy or physical latency measurements.

Temporary evidence is in
`/var/folders/kq/8n8k7x6x4c160nx6p6f9hp0c0000gn/T/makeshift-mid-0p5esfh9/`
(`comparison-summary.json`, compact case reports and a full008 export). The full
008 export and native incompatible-mode rejection were checked separately.
Preserve existing captures, ignored reports and unrelated working changes.
Issues, commits, pushes, PRs and broader documentation remain deferred.

### Earlier proposal: thin front shadow with an early sideways opening (November9)

User is stopping for the night and wants to try this next session. This is a
proposed native diagnostic/detection experiment, NOT implemented or validated.
Keep the existing dark detector and finger segmentation stable. Preserve all
working-tree changes and ignored captures/reports. Do not regenerate the full
gallery automatically; the user has been handling real-image generation.
Continue the local experiment workflow; broader docs, issues, commits, pushes
and PRs remain deferred as previously requested.

**User's hypothesis:** after the dark detector fails, a pressing finger may have
a thin mid/light shadow at the front that opens sideways into a large shadow
mass close to the fingertip. A hovering finger may have its sideways opening
start too far up the finger. Shape and opening location matter, not just the
presence of a large adjacent blob.

Proposed checks:

- Permit at most1 brown (mid) pixel and1 gray (light) pixel at the front; ignore
  very light/lavender shadows for this thickness check. The assistant interpreted
  this as counts along each outward scan from the front edge, not total pixels
  over the entire fingertip. This counting interpretation and the required
  lateral extent of the qualifying front region are not yet settled.
- Going outward toward either side, require at least ONE side to slope/open into
  a substantial connected shadow mass. This differs from the existing fallback's
  requirement for supporting blobs on BOTH sides.
- Require the opening to begin close to the tip, without first traveling too far
  up the finger. Measure opening onset separately from eventual blob size.
- The mass should spread sideways without extending substantially farther
  downward beyond the tip. Exact allowed extension/start distance are undecided.
- User observes the shadow slope may be flatter than the finger's own slope.
  Assistant suggested measuring the shadow boundary's lateral separation from
  the local finger edge, so an angled finger alone does not satisfy the rule.
  Use an overall short-range trend with tolerance for pixel irregularities,
  rather than strict monotonicity at every pixel. This is a suggestion to inspect.
- User suggests following MID/brown shadows while ignoring light/gray shadows
  during the side-slope measurement. Assistant suggested brown PLUS existing
  magenta as the stronger-shadow region: a failed dark decision does not imply
  there are no useful dark pixels. Brown-only versus brown+magenta remains an
  experimental choice, not an agreed implemented rule. Keep these side-mass
  rules separate from the front's1-brown/1-gray allowance.

Specific cases and user observations:

-007/candidate2 and010/candidate3: user expects ignoring very light front shadows
  could let the light-style test pass; this has not been executed. Current saved
  reports reject with `no-clear-strip`; opening a strip alone does not prove
  that the later side checks will pass.
-008/candidate2: user sees only one clear/light-shadow-free pixel at the front,
  but a conspicuous sideways slope with a thin front band. This motivates the
  new geometry test rather than globally reducing minimum strip width to1.
-021: user's contrasting example where the sideways slope begins too late up
  the finger. No particular021 candidate or new per-finger truth label was
  specified; identify the intended spatial feature during review.
-009/candidate1: user says another finger covers the dark-shadow evidence.
  Additional brightness layers cannot reveal hidden pixels. Do not assume this
  proposed rule resolves009, or infer a press solely from unavailable evidence.

The assistant inspected008/021 `shadow-classes.png` and the saved failed
candidates' JSON. The existing `LightShadow.cpp` finds a clear front band and
adjacent connected side blobs; it does NOT explicitly measure slope or opening
onset. Do not mistake that blob-support code for an existing slope test.

**Start next session with diagnostic overlays on008 and021:** show the front
scan/thickness, where the sideways opening starts, and the boundary followed
into the supporting mass. Confirm these match the user's visible shape before
choosing numerical thresholds. Then compare against007/010 and all labeled
hovering cases, especially004/candidate3; preserve dark-detector behavior.
Recovering the missed presses alone is insufficient evidence of improved
accuracy. No detector changes, image regeneration or tests were performed for
this note; all geometry/threshold choices above remain hypotheses.

### Gather all testcase shadow classes (November8)

After regenerating image reports, run from the repository root:

```sh
node backend/gather_shadow_classes.cjs
```

This gathers existing `NNN/shadow-classes.png` files in numeric order into
`backend/test-results/all-shadow-classes.png`, with testcase labels and8 columns.
It preserves original image resolution and replaces the previous overview only
once encoding completes. It does not rerun detection or change case reports.
The default input is anchored to the script, so it also works from other working
directories. Requires Node and sharp from installed frontend dependencies.

For a smaller overview, use `--scale 0.5`; change the layout with `--columns 4`.
`--input PATH` selects another results root and `--output PATH` changes the
output PNG; explicit paths resolve from the current working directory. Input
and output parent directories must exist. No matching images or invalid options
produce an error. Only three-digit testcase directories are included; missing
shadow-class images are skipped, and the brightness-sweep gallery is not included.
Local execution gathered all31 current cases successfully into5300x1997 pixels
(approximately0.6MB); Node syntax validation passed. The earlier full-comparison
overview remains available separately.


### Faint-shadow display tier (November8)

User requested a separate display color for the lowest/purple end of the
fixed5..100 TURBO shadow heatmap. Added lavender RGB170,140,230 for valid
outside-finger shadows with reference-relative luma drop >5 and <=20, except
that the existing magenta current-luma dark class retains precedence. Brown
still covers other valid shadows with drop>=40; gray now covers20<drop<40.
Blue fingers, white clear and black unavailable are unchanged. These are
brightness classes, not measured distance from the paper or contact labels.

`faintShadowMaximumDrop=20` lives in `ShadowDiagnostics.hpp`. The standalone
`shadow-classes.png`, combined comparison, HTML legends and JSON visualization
metadata include the faint tier. Detection, light fallback and heatmaps are
unchanged. Only this handoff updated; broader process/docs remain deferred as
previously requested. No ordinary gallery or brightness-sweep files regenerated.
The user's next normal rebuild/generation will show the new tier:

```sh
python3 backend/run_shadow_images.py --rebuild --dark-shadows-only --light-shadow-test
```

Local Release build and CTest `cv_baseline`1/1 passed. A temporary synthetic
export checked clear/drop5 white, drop6/20 lavender, drop21/39 gray, drop40
brown, magenta precedence at current-luma110 and the new JSON metadata. A
single temporary case007 export was visually inspected; all4 complete candidate
records exactly match the saved ordinary report. Temporary verification outputs
are outside the gallery. clang-format20.1.7 passed; exact17 unavailable. No new
test files, CI, held-out accuracy or physical latency result claimed.

### Quick summary of the current state

- Native baseline: Cr13, `cr-otsu` radius2; DFS c4/d2/e4, upward width2,
  current brightness cap110 and luma drop>20. Dark fails → try light, requiring
  a two-column clear strip, two-pixel outward depth and supporting side blobs.
- d2 fixed the original002/candidate4 false press without changing any other
  final result in the then25-image set. Fresh captures subsequently exposed
  additional misses; that earlier result is not an all-conditions accuracy claim.
- Latest user-labeled misses:007/2,008/2,009/1,010/3 are presses. The brightness
  sweep recovers007/2 at120 and010/3 at140;008/2 and009/1 still reject at140.
  Cap140 also falsely accepts the known hovering004/3, so default stays110.
  Curved medium-shadow bands beside occluded fingers are a possible next
  hypothesis; no new detection rule has been implemented for them.
- Dark/mid/light/faint visualization uses lavender for other valid shadows with
  5<drop<=20 (November8 addition). Magenta retains precedence. The earlier
  November6 display uses magenta for dark, brown for other valid
  shadows with drop>=40 (approximately the heatmap's green onset), and gray
  for weaker shadows. Brown is display only. All31 ordinary cases regenerated;
  all161 complete candidate records/traces are unchanged by this display edit.
- View `test-results/index.html`; sweep comparison is separate at
  `test-results/brightness-sweep/index.html`. Normal generation:
  `python3 backend/run_shadow_images.py --rebuild --dark-shadows-only --light-shadow-test`.
  Build and CTest1/1 passed. Above-paper candidates remain outside the current
  contact assessment; homography eligibility is deferred. No held-out accuracy
  or physical-latency claim.


### Brown middle-shadow display tier (November6)

User requested a visual middle tier in the dark/light classification panel to
make the approximately neon-green-to-darker heatmap evidence easier to inspect.
`middleShadowMinimumDrop=40` in `ShadowDiagnostics.hpp` sets the start of this
display tier, approximately the green onset of the fixed5..100 TURBO scale.
This is a brightness-drop threshold, distinct from the absolute current-luma
cap used for magenta dark shadows. Among valid outside-finger shadows:

1. Current luma <= selected dark cap: magenta (takes precedence).
2. Otherwise reference-relative luma drop >=40: brown (RGB145,85,42).
3. Otherwise: gray light shadow.

Blue fingers, white clear and black unavailable retain their meanings.
`shadow-classes.png`, the combined comparison panel, legends and JSON
visualization metadata describe the three tiers. The brown tier does not
participate in dark DFS, light fallback, candidate extraction or final decisions.
The ordinary gallery is regenerated at the unchanged default dark cap110;
the previous sweep remains separate. Baseline full reports were saved at
`test-results/before-mid-shadow.json` for candidate/trace equivalence checks.
Local Release build, CTest `cv_baseline`1/1, Python syntax and clang-format20
passed. All31 cases regenerated; all161 complete candidate records (including
all dark traces and light evidence) exactly match the saved pre-display reports.
The007/009 class images were visually inspected for brown side bands and
retained magenta/gray classes. This establishes unchanged detector output on
these inputs, not new contact-accuracy evidence.


### Brightness-cap sweep on31 images (November6)

User labels the latest007/candidate2,008/candidate2,009/candidate1 and
010/candidate3 as pressing. Their baseline dark search lacks upward support;
all four light fallbacks reject with `no-clear-strip`. At drop>20 there are
21/25/24/25 eligible edge samples respectively, but only0/1/3/0 satisfy the
current-brightness cap110. Thus changing the brightness-drop cutoff alone
would not restore007/010's missing seeds. User also notes curved medium-shadow
bands beside occluded fingers; a separate local contrast/shape test remains
only a hypothesis, not implemented.

**Brightness meaning:** current-frame luma is a weighted RGB brightness proxy
on0..255 (black..white), not a distance or a change threshold. Dark DFS requires
both reference-relative drop>20 and current luma<=the selected cap. Raising
110 to120/130/140 admits progressively brighter shadows. The light fallback
continues to use drop>5 without this brightness cap. Cr13, Otsu radius2,
c4/d2/e4, upward width2, strip2 and the other settings are fixed during sweep.
The ordinary/default cap remains110; no new cap has been selected.

```sh
# Compact JSON + candidate overlays, preserving the ordinary gallery:
python3 backend/run_shadow_brightness_sweep.py --rebuild

# To generate a full ordinary gallery at a chosen cap (overwrites that gallery):
python3 backend/run_shadow_images.py --rebuild --dark-shadows-only --light-shadow-test --maximum-shadow-luma 120
```

The sweep uses saved numbered baseline reports and pins their image/reference,
Cr and Otsu settings. It rejects a mismatching compiled configuration or
candidate geometry; cap110 must reproduce the saved dark traces and final
results. Inputs/outputs remain local. All31 cases completed at all four caps
(124 compact runs,161 candidate identities). Every cap110 dark trace and
combined result matches the original, and candidate geometry matches at all
caps. [Sweep gallery](test-results/brightness-sweep/index.html),
[CSV](test-results/brightness-sweep/results.csv),
[summary](test-results/brightness-sweep/summary.json), and saved full baseline
`test-results/brightness-sweep/baseline.json` provide the current evidence.

| User-labeled press | 110 | 120 | 130 | 140 |
| :--- | :--- | :--- | :--- | :--- |
| 007/candidate2 | NO_MATCH | dark MATCH | dark MATCH | dark MATCH |
| 008/candidate2 | NO_MATCH | NO_MATCH | NO_MATCH | NO_MATCH |
| 009/candidate1 | NO_MATCH | NO_MATCH | NO_MATCH | NO_MATCH |
| 010/candidate3 | NO_MATCH | NO_MATCH | NO_MATCH | dark MATCH |

Relative to110 there are4/16/30 final-decision changes at120/130/140,
including candidates outside the paper and changes to NO_MATCH/UNKNOWN; these
counts are not contact error rates.002/candidate4 stays NO_MATCH throughout.
**004/candidate3, previously labeled hovering, becomes a dark MATCH at140.**
Therefore140 recovers010's press but introduces a known false press. Other
changed candidates require label review; do not call a cap universally better.
008/009 still have no successful upward evidence by140, so this sweep does
not resolve their visibility/geometry limitations.

Local Release build and CTest `cv_baseline`1/1 passed. Native invalid caps
-1/256/NaN/infinity rejected. A full cap120 export for007 matches its compact
candidate report; full metadata and captions follow120. Python syntax checks
and clang-format20 pass; exact17 and full Python ruff/mypy are unavailable.
No new automated test file, CI execution, held-out contact accuracy or physical
latency claim. The ordinary31-case gallery is preserved at110.


### Verified two-pixel clear-strip user run

All26 regenerated reports use Cr13, c4/d2/e4, upward width2 and the fixed
minimum clear strip2. Compared with `test-results/before-two-pixel-strip.json`,
candidate geometry is unchanged throughout. Exactly three final results change
NO_MATCH→light MATCH:004/candidate1 at(122,123),006/candidate3 at(342,124), and
008/candidate1 at(297,131).006/candidate3 now has a two-column clear strip,
four clear band pixels and side blobs of146/175 pixels, matching the user's
press label. The other two additions are thumb candidates near/outside the
paper boundary in the reviewed overlays; no new contact truth assigned.
002/candidate4 remains NO_MATCH, and004/candidate3 remains NO_MATCH.

The saved baseline is mixed:006 already used upward width2, but the other25
reports used3. The latest run uses2 throughout, so not every dark trace is
identical. Nevertheless, every cutoff20 dark decision is unchanged; all three
final changes are light matches using two-column strips. Original thresholds
and below discussion describe the initial trial setup, not pending work.

### Two-pixel clear-strip trial setup

The user is testing fresh camera captures at Cr13, c4/d2/e4 and upward shadow
width2. New006/candidate3 at(342,124),width22 is labeled pressing but rejects
light: its only clear columns are x341–342. Both outside rows are clear in
those columns, but the previous max(3,ceil(0.15*width)) rule required4 columns.
The current trial uses a **fixed minimum of2 consecutive clear columns**, set
by `defaultLightShadowMinimumStrip`, with no finger-width scaling. Clear-band
depth remains2; both side-shadow support and blob area rules remain required.
The dark test and the user's upward-width2 setting are preserved.

Pre-change full image reports are saved locally in
`test-results/before-two-pixel-strip.json`. User will regenerate using the
usual rebuild/dark-only/light-test command. Do not overwrite this baseline or
regenerate images before the user does. Compare actual metadata and spatial
candidates: new captures have changed gallery numbering, so earlier006 refers
to a different image. This change permits006/candidate3 to reach the side
checks; acceptance and false-positive effects await the user's image run.
Synthetic strip-boundary coverage now checks one column rejects and two pass.


### Verified user run: forward dark distance d=2

**Current local native settings:** Cr13, `cr-otsu` with radius2, c=4/d=2/e=4,
upward width3, corridor margin9, dark-only DFS (luma drop strictly>20 and
current luma<=110), followed by the light-shadow fallback when dark does not
match. Cr shadows use the selected finger mask and darkening, without a
projection-residual filter. These are experiment settings, not browser changes.

Rebuild and regenerate the current gallery from the repository root:

```sh
python3 backend/run_shadow_images.py --rebuild --dark-shadows-only --light-shadow-test
```

Cr and d inherit the compiled defaults in [CrFingerDetection.hpp](src/CV/CrFingerDetection.hpp)
and [ShadowDetection.hpp](src/CV/ShadowDetection.hpp). Verify `results.json`
metadata when comparing runs; candidate IDs are local to a frame/configuration.

#### Why d changed

User labels002/candidate4 as hovering. With d4 it falsely passed dark because
its forward shadow was shorter than the required target distance. The target
is **tip.y+d in analysis pixels**, not d pixels from each shadow seed or each
point on the curved edge. Reducing d makes a shorter forward shadow sufficient
to veto the dark match. Both-target seed exclusion is retained.

| Measurement for002/candidate4 | Cr13/d4 | Cr13/d2 |
| :--- | :--- | :--- |
| Tip coordinate | (291,149) | (291,149) |
| Forward target row | 153 | 151 |
| Downward searches reaching target | 0 of14 | 11 of14 |
| Reached downward searches ignored by paired-target rule | 0 | 5 |
| Non-ignored successful downward searches | 0 | 6 |
| Upward support | Present | Present |
| Downward veto | Absent | Present |
| Dark result | MATCH | NO_MATCH |
| Light fallback | Skipped after dark match | NO_MATCH: `no-clear-strip` |
| Final result | MATCH (false press against user label) | NO_MATCH (matches hovering label) |

#### Comparison across the complete gallery

All25 current reports were checked at Cr13/d2 with dark-only DFS and light
fallback enabled. Compared with saved Cr13/d4 dark reports and the recorded
initial light-addition list, all137 candidate IDs, positions and widths are
unchanged. **002/candidate4 is the only final press/no-press decision change.**
001/candidate6, above the paper, changes its internal dark result from UNKNOWN
to NO_MATCH but remains a light MATCH, so its final result is unchanged. Every
other cutoff20 dark result is unchanged. Known pressing fingertips and older
on-paper decisions remain accepted/rejected as before.

| Case | Accepted on-paper candidates at Cr13/d2 |
| :--- | :--- |
| 000 | None |
| 001 | 3,5,7,10 (light) |
| 002 | None |
| 003 | 5 (light) |
| 004 | 5,7 (light); hovering candidate3 remains NO_MATCH |
| 005 | 4 (light),5 (dark) |

Above-paper proposals remain visible but are excluded from the user's current
contact assessment; future paper homography will gate them. Do not introduce
proposal filtering to hide their output. Raising Cr to14 was also compared:
014/candidate2 and022/candidate2 gained dark matches, and candidate IDs changed
in some new images. Returning to Cr13 exactly reproduced the initial137
candidate geometries, dark traces and combined decisions before the d2 trial.

Evidence is the local [gallery](test-results/index.html), per-case JSON traces,
[002 dark DFS](test-results/002/dfs-20.png),
[002 light fallback](test-results/002/light-shadow.png), and
[combined CSV](test-results/dark-plus-light-results.csv). Inputs and generated
reports are ignored local artifacts and must be preserved separately for
reproduction. The pre-d4 dark reports were saved in this session at
`/tmp/makeshift-before-light.json`; `test-results/light-review.json` records
the original d4 light additions. Do not use that initial review file as the
current d2 result table. No complete `before-d2-results.json` snapshot was
created: the user's run had already started when snapshotting was attempted.

Comparison executed locally November6,2026 using existing still images and
user contact labels. This is development-set evidence, with no new camera or
audio hardware measurement, held-out accuracy, physical latency, or Actions
claim. Existing native synthetic build/test evidence is recorded below;
this documentation update does not claim a fresh CTest run.

### Light-shadow fallback trial (November 6)

**Initial d4 trial (historical evidence):** the light fallback is opt-in.
The d2 comparison above supersedes this trial's002 false-positive outcome.
Run the command below with the current compiled defaults:

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
| Directional DFS | Width3, c=4/d=2/e=4, margin9, original paired both-target exclusion/downward-only veto; no new temporal smoothing |
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
