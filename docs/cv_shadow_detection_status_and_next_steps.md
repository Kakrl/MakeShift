# Shadow detection: current status and next steps

Updated: 2026-11-01 (includes strict plateau/local-lobe corrections and replacement images). This document summarizes the local shadow experiments
and the local brightness–chromaticity experiment. Implemented tools,
observations and unimplemented ideas are identified separately. There is no
claim of reliable semantic shadow detection or physical contact accuracy.

## Start here: user-reviewed handoff (2026-11-01)

The user reviewed the corrected fingertip images and said **"looks good"**, then
requested this handoff. This is qualitative visual feedback, not measured
fingertip precision/recall or contact accuracy. The basic gallery review is
complete; do not restart the earlier manual anchoring, color-cluster pilot,
D80 experiment or explanation of the reviewed examples. Sections below retain
the detailed execution history; this section is the current resume point.

### What exists now

There are two distinct offline experiments:

| Experiment | Current behavior | Evidence and limitation |
| :--- | :--- | :--- |
| Automatic fingertip proposals | Derives anonymous positions and widths from filtered geometry, then runs DFS on every proposal. No saved anchors, per-finger gates or anatomical labels enter detection. | [Current 50-image gallery](../frontend/test-results/fingertip-filtered/index.html), [old/new comparison](../frontend/test-results/fingertip-filtered/changes.html). Localization improved in the reported examples; extra proposals and merged-mask contact uncertainty remain. |
| Fixed-anchor DFS comparison | Uses saved positions/widths to isolate shadow-rule changes; locality limits sideways travel while preserving forward reach. | [Current 30-image gallery](../frontend/test-results/shadow-dfs/index.html), [original/D80/locality comparison](../frontend/test-results/shadow-dfs/changes.html). At shared cutoffs20/40,29 valid selected frames agree with approximate phases; one wrong-target frame is excluded. This result does not transfer to the automatic mode or held-out footage. |

**Current automatic path:** coordinate-matched empty reference/current image →
reference-relative measurements → filtered geometry → connected regions and
lower-outline lobes → anonymous fingertip proposals → per-proposal DFS.
There is no anatomical finger classifier, stable tracking identity, live note
integration or automatic paper/keyboard eligibility in this new path.

### Settings to preserve

- Analysis is 640×427 on these inputs. The geometry mask uses valid darkening
  **>5** and projection residual **>0.12**: pixels rejected by the shadow color
  filter, not an inversion of every displayed black pixel. It can include
  non-finger objects. The secondary color-filter alternative uses shift>10.
- Components require area ≥80 and vertical span ≥16. The lower outline requires
  three vertically supported mask pixels and has five-column median smoothing.
  Fingers are assumed to point downward in image coordinates.
- Group each full equal-height plateau before checking both outer neighbors;
  only strict maxima qualify. Filtered mode uses raw-outline prominence ≥2 and
  raw valley bounds within 22 pixels on either side. Its width is measured eight
  rows above the tip, bounded by those valleys, and must be 5–44 pixels. These
  bounds do not crop or split the mask. Legacy color-cluster prominence stays 4.
- Duplicate suppression is unchanged: same-component horizontal distance below
  `max(12, 0.85 × narrower width)`. At most 20 spatially numbered proposals per
  image. These numbers can change between frames and are not press identities.
- DFS retains **c=d=e=4**, a per-seed estimated-width window, and a four-pixel
  exterior Chebyshev band around the selected lower/side arc. The lowest arc
  pixels have a straight-down extension to the saved/candidate veto row within
  the same lateral margin. Do not reintroduce the artificial vertical cutoff.
- Any downward witness vetoes; upward support matters only without that veto.
  Downward/upward darkening cutoffs match at 5/20/40/60: **D80 is removed**.
  Lateral caps stop normally; actual missing measurements/incomplete geometry
  stay unknown. No production cutoff has been selected. Motion remains excluded.

### Reviewed improvements and remaining problems

The latest change fixed whole-plateau detection and made filtered-mode
prominence/width local to each lobe. In middle-first111–116, the previously
missing index now has one proposal in every frame. In
`hover_right-index_frame_000189_6300ms.png`, the pinky changes from two shoulder
proposals to one distal proposal at(194,138). The same settings apply to all 50
inputs; anatomical names and the seven review rectangles are only for reporting.

All 50 candidate PNGs were replaced at the user's request. Total proposals changed
364→351 (still139→140; sequence225→211); background self-comparison remains zero.
These are counts, not accuracy scores. Ten final cards were individually
inspected: the seven reported examples plus index148, pinky199 and ring184.
The other 40 were exported without individual final source review.

**Do not lose these limitations:** clothing and inter-finger gaps still produce
extra proposals. Middle112/113 have an inner-gap proposal; pinky199 has an extra
upper-side proposal. The newly located index in112–116 can still have UNKNOWN
DFS contact because its full mask merges into its neighbor. A local width is
not an independently established contact boundary. Do not force a PRESS result
by cropping the mask at a synthetic valley boundary without testing that change.
No held-out clip, physical contact accuracy or physical latency was established.

### Reproduce and preserve

From `frontend/`, with installed dependencies and Chrome:

```sh
npm run experiment:fingertips-filtered
npm run experiment:shadow-dfs
```

Neither command needs an app server. `CV_BROWSER_CHANNEL` can override Chrome.
The automatic command uses `--filtered-boundary --sequence`; the fixed-anchor
command uses `--dfs --local-corridor`. Both reuse native sources, not a new video
seek. Required inputs include `images_test_cases/*.png`,
`frontend/test-results/shadow-hypothesis/results.json`, its saved
`middle-first-*.native.png` files, and
`frontend/test-results/shadow-sequence/fingers/sequence.json`. Source/reference
hashes are checked. Hash agreement does not establish bit-identical browser
resampling; earlier one-pixel reconstruction variation is documented below.

Preserve ignored `frontend/test-results/`, especially:

- `fingertip-filtered/`: current 50 PNGs, overview, tables, result/comparison JSON,
  logs and **`pre-lobe-results.json`**, the old 364-proposal baseline. Repeated
  exports reuse it; deleting it loses the genuine before/after comparison.
- `shadow-dfs/`: current 30 PNGs/results, original **`previous-results.json`**,
  D80 **`d80-results.json`**, comparison reports and logs.
- `shadow-hypothesis/` and `shadow-sequence/`: native source caches needed for
  regeneration. Other older galleries remain useful history.
- `fingertip-trace/`: historical diagnostic outlines/findings for the seven
  reported failures, not current algorithm output or a verification suite.

Implementation, documentation and root measurement JSONs remain local worktree
changes, including untracked files. No commits, pushes, issues or PRs were
created for this experiment. Preserve unrelated existing changes as well.

### Verification and recommended next work

Latest implementation checks: **19** candidate cases / **80** focused cases
passed; full Vitest **621 passed / 25 known failures / one skipped**. The failures
are the documented recording/velocity/synchronous-contact fixture groups. Lint
passed with three existing image warnings; TypeScript, 39 contrast checks and
the network-enabled production build passed. Local execution details and limits
are in the [test record](../tests/README.md#plateau-and-local-lobe-correction-2026-11-01).
No live camera/audio browser smoke or new CI execution is claimed. This final
review/handoff update changes documentation only and runs no new tests.

Resume with false inner-gap proposals and merged-mask contact uncertainty as
separate questions. Keep the reviewed seven examples and all 50-input comparison
fixed when refining further. Broader validation should then use an optional
pipeline technique and all four existing video clips with automatic proposals,
keyboard eligibility, contact continuity and timing measurements. The older
sidecars disagree with newer user annotations in places; review those disputes
before interpreting scored failures. That integration is recommended next work,
not already implemented or a request to enable the detector by default. Tracking
needs continuity for hold/release, but does not need anatomical finger names.

## Resume here: plateau/lobe correction and replacement images (2026-11-01)

The user authorized correcting the missing close index and double-counted pinky,
and replacing old candidate images. Completed in the same
[50-image gallery](../frontend/test-results/fingertip-filtered/index.html),with
[old/new comparison](../frontend/test-results/fingertip-filtered/changes.html)
and [full comparison JSON](../frontend/test-results/fingertip-filtered/changes.json).
Old PNGs were overwritten; `pre-lobe-results.json` retains the previous50 input
records and364 proposals,with its SHA-256 recorded in both new JSON reports.
Repeat exports reuse that snapshot. Run from frontend:
`npm run experiment:fingertips-filtered`. Canonical fixed-anchor `shadow-dfs`
images and original/D80 snapshots remain intact.

**Exact changes:** group a complete equal-height plateau before checking BOTH
outside neighbors; accept only strict local maxima. Rejected plateaus are
skipped completely,so rising/descending shoulder interiors cannot reappear as
peaks. This bug correction applies to the shared shape routine,including the
legacy color-cluster entry point (its eight original tests still pass).

For the filtered-mask mode only,use the raw supported lower outline to measure
peak prominence and find left/right valleys within the existing22px search
radius (half maximum width44). Pick a lowest supported point within the smoothed
peak plateau. Clamp the tip-minus8 width scan to that lobe's valley bounds,
instead of crossing into a neighbor. Fixed minimum prominence is now2 raw pixels
for ALL filtered inputs (previously4 smoothed pixels). This global exploratory
setting allows the two-pixel index valley in112–114;it is not a per-frame
threshold or a validated operating point. Legacy color-cluster prominence stays4.
Other component/width/separation settings,filtered mask predicate,DFS and its
cutoffs/locality are unchanged. Raw masks are NOT cropped at lobe boundaries.

**Reported examples:** each middle-first111–116 now has one index proposal:
111=(412,172),width23,prominence6;112–114=(409,176),width19,prominence2;
115–116=(409,176),width19,prominence3. Each previously had none in that review
region. Pinky189 now has one proposal(194,138),width16,prominence29 instead of
two shoulders(184,122)/(198,136). Fixed rectangles in the comparison report
summarize these seven user-reported examples only AFTER detection;they never
enter identification/DFS and do not constitute general ground truth.

Across all50 inputs,total proposals364→351:still139→140,sequence225→211.
Background still produces zero. These are counts,not improved precision/recall.
Allseven reported cases and three controls were visually reviewed:index148,
pinky199,ring184 (ten final cards;40 not individually reviewed). Extra clothing
and inter-finger-gap proposals remain,including an extra inner-gap proposal in
middle112/113 and an upper-side proposal in pinky199. Do not hide them by
retuning those frames or claim all candidates are true fingertips.

**Localization is separate from DFS contact:** index111 now has a proposal and
rejects at all cutoffs;index112–116 proposals can remain UNKNOWN because their
uncropped masks still merge with the neighboring finger. Local width estimation
does not establish an independent physical boundary for contact. No live notes,
tracking,anatomical identity or new motion rule was added. The earlier fixed-
anchor29/29 result is not a result for this automatic mode.

Verification:19 candidate cases /80 focused cases passed;four new regressions
cover plateau shoulders,a shorter touching lobe with two-pixel valley and local
width,sub-threshold shoulder rejection,and two genuine narrow tips14px apart.
Full Vitest621 passed/25 known failures/one skipped. Lint/build final results
are in the [execution record](../tests/README.md#plateau-and-local-lobe-correction-2026-11-01).
No held-out,physical accuracy/latency or new CI execution claim.

**User review complete:** the user said the replacement gallery looks good and
requested a handoff. Next investigate false inner-gap proposals and merged-mask
contact uncertainty separately. Preserve these seven
examples and all50-input comparisons when refining further. No further sweep or
pinky-specific tuning was performed.

## Current investigation: missing close index and duplicate pinky (2026-11-01)

Historical diagnosis,now superseded by the plateau/lobe correction above.

User review identified missing index in first-middle111–116 and duplicate pinky
in `hover_right-index_frame_000189_6300ms.png`. Diagnostic-only tracing completed
on all seven inputs; no classifier/DFS code,settings or canonical images changed.
Instrumented source retains the exact current mask/component/peak decisions.
All seven source hashes and final proposal positions,widths,prominence and
component numbers match the existing filtered gallery.

Ignored evidence: `frontend/test-results/fingertip-trace/results.json` (raw and
smoothed per-component outlines plus accepted/rejected peak measurements),
`findings.md`,seven cards and a temporary instrumented exporter. These are debug
artifacts,not a new verification test or physical accuracy result.

Index is present in the mask but fails shape checks. Representative peak
measurements (x,y / prominence / width):111=(412,172)/3/24;
112–113=(409,176)/1/51;114=(408,176)/1/50;115–116=(409,176)/2/51.
All are below required prominence4. In112–116,the row eight pixels above the
tip spans the neighboring middle finger,so width50–51 also exceeds maximum44.
Smoothing shallows the narrow inter-finger valley. Lowering prominence alone
would still leave width rejection in five frames. No new threshold was chosen.

Pinky duplication exposes a structural peak bug: immediate-neighbor tests run
BEFORE the equal-height plateau is grouped. A shoulder182–185 at smoothedY122
is accepted even though column186 continues down toY125. The descending plateau
197–198 similarly leaves x198 accepted. Shoulder(184,122),prominence31 wins
suppression over the real distal plateau proposal(194,138),prominence28. Final
(198,136),prominence19 is14px away from184,just outside suppression distance
max(12,0.85*16)=13.6,so the same pinky gets two final candidates.

**Next correction to investigate:** require strict maxima against both outside
neighbors of the complete plateau; then address local lobe prominence/width for
close unequal-length fingertips. A larger generic duplicate radius can suppress
real neighbors. Preserve all seven examples and compare against all50 inputs;
no anatomical gates,frame-specific thresholds or DFS changes. The automatic
identifier remains the current implementation described below,with these known
localization failures unresolved. This diagnostic update ran no new unit/build
checks and makes no new pass/CI claim.

## Resume here: automatic filtered-boundary fingertip proposals (2026-11-01)

The user asked to create the fingertip identifier and correctly remembered an
existing pilot. `estimateFingertips` already supplied automatic distal proposals
from reddish color clusters. The fixed-anchor DFS experiment froze its original
positions/widths, then substituted filtered geometry for tracing. It did not
rerun automatic localization with that filtered mask.

Implemented `identifyFilteredFingertips` in
[fingertipCandidates.ts](../frontend/src/cv/fingertipCandidates.ts). It takes
reference-relative measurements only: no current raw RGB clustering, saved tips,
per-finger gates, anatomical names or phase labels. It uses the exact raw
filtered-darkening boundary mask used by DFS (valid darkening >5, projection
residual >0.12; color-filter alternative supported), then the existing bounded
component/lower-silhouette shape extraction to return spatial positions, widths,
component numbers, prominence and frame-local candidate numbers. The pure mask
helper now lives in `shadowHeatmap.ts` and is re-exported from
`shadowTipEvidence.ts` for existing callers. The original color-cluster entry
point remains available, sharing the extracted shape routine; its eight legacy
synthetic tests still pass.

Existing fixed defaults: component area>=80 and vertical span>=16, five-column
median silhouette, three-pixel vertical boundary support, prominence>=4,
separation>=12, width5–44 measured eight rows above the tip, max20 candidates.
Assumes fingers point downward in image coordinates. No new parameter sweep,
mask morphology, anatomical identities, tracking or live note wiring. Exact raw
filtered geometry is returned for DFS even when small components are excluded
from proposals. A filter-rejected changed object is not automatically skin.

Run `cd frontend && npm run experiment:fingertips-filtered`.
[Review gallery](../frontend/test-results/fingertip-filtered/index.html):20 still
inputs (including background self-comparison) plus30 saved native sequence
frames,50 PNGs,overview and full JSON. Each card shows source,geometry and
projection maps with numbered proposals; tables show locality4 DFS results for
EVERY proposal at5/20/40/60. No saved anchor/gate selects candidates or enters
DFS. Cached source group/frame/phase and old review flags are metadata only;
old wrong-target120 describes its historical frozen anchor, not exclusion of
this full-frame identification run. Source/reference hashes are verified.

Final export:background zero proposals;139 proposals across20 stills,225 across
30 sequence frames (364 total,6–10 on non-background inputs). These are candidate
counts, not recall/precision or correct identities. Four final cards inspected:
index148,first-middle119,second-middle164,pinky199. Other46 were exported without
individual final source review. Visible distal points are proposed, but clothing/
changed background outside the keyboard also supplies spurious candidates, and
curled/merged outlines can supply extra or missed tips. Do not tune them away
with the old per-finger gates. The existing keyboard eligibility check is needed
when integrating contacts; it is not implemented by this offline identifier.

Example automatic positions:index148 returns(318,194),width26 instead of saved
width44;index151 returns(319,193),width24 instead of saved(318,193). Middle119
returns a nearby(376,199) rather than saved(380,201). These are localization
differences, not ground-truth errors or guaranteed improvements. The prior29/29
fixed-anchor phase agreement must NOT be attributed to this new automatic mode.
All inputs remain from the same recorded setup; there is no held-out evidence.

**Next:** user review of the candidate gallery, then opt-in pipeline integration
with automatic keyboard eligibility/contact continuity and full video replay.
Anonymous spatial IDs suffice for DFS but are not stable tracking identities.
Keep the canonical fixed-anchor DFS gallery/snapshots intact as comparison history.
No live behavior, detector default, motion or pinky-specific refinement changed.
See [execution evidence](../tests/README.md#automatic-filtered-boundary-fingertips-2026-11-01).

## Resume here: lateral locality with forward reach, D80 removed (2026-11-01)

The user requested locality, removal of D80, replacement of canonical DFS images,
and comparison with previous runs. They then correctly challenged an artificial
vertical cutoff in the first implementation. The corrected experiment is now in
[30 replacement cards](../frontend/test-results/shadow-dfs/index.html),
[original / D80 / new report](../frontend/test-results/shadow-dfs/changes.html),
[CSV](../frontend/test-results/shadow-dfs/changes.csv) and
[JSON](../frontend/test-results/shadow-dfs/changes.json).
Run `cd frontend && npm run experiment:shadow-dfs` (`--dfs --local-corridor`).

**Exact locality rule:** exterior Chebyshev/eight-neighbor distance <=4 analysis
pixels around the selected lower/side fingertip arc, PLUS a straight-down
extension from its lowest arc pixels to the saved `tipY+d` row, within the same
four-pixel lateral margin around those distal pixels. The wider upper side arc
is not extruded downward. Finger-mask interiors are excluded. Both monotone
searches use this corridor plus the old per-seed width cap; leaving it laterally
stops normally, not UNKNOWN. The full corridor is in JSON and its boundary is
purple on PNGs. Radius4 is an initial exploratory setting, not a validated
physical distance or a per-frame tuned value.

Downward seeds/traversal and upward seeds/traversal use matching darkening
cutoffs5/20/40/60: **no D80 override**. Filtered fingertip geometry, saved anchors/
estimated widths, c=d=e=4, 640×427 sampling, original source/reference hashes,
projection/color filters and phase labels remain fixed. No new frames, motion,
identities, sidecar edits, live detector/audio integration or pinky refinement.

**Correction made in this session:** the first radius4 band limited forward
depth too. Index146 has savedY172 and filtered arc maximum171, so the old band
ended at175 before its saved veto row176. Index147 similarly stopped at190
before191. The first export falsely accepted them; a subsequent guard reported
UNKNOWN. The user correctly pointed out that DFS should still be able to travel
downward. Both intermediate behaviors were superseded: forward extension now
permits actual shadow traversal to the unchanged veto row. No unknown guard
replaces that traversal, and the saved anchors remain fixed. At40,146 has an
actual rejection witness at(312,176),147 at(315,191). Both now reject at every
cutoff. `corridorReachesDownwardRow` is exported as geometry metadata only.

Original decisions/paths remain in `previous-results.json`; D80 decisions/paths
in `d80-results.json`. Both snapshots are reused on repeats and their SHA-256s
are recorded/asserted. All30 canonical PNGs were overwritten as requested; other
galleries and native caches stay intact. The report retains all120 original/
D80/new comparisons with raw decisions, per-phase agreement and unknown counts.

Pass/fail means agreement with approximate user phases in this one clip:
17 touch/touch-interval rows expect PRESS,12 other valid rows expect NO PRESS.
Wrong-target first-middle120 is excluded, and UNKNOWN never counts as pass.

| Shared cutoff | Original pass/fail/unknown | D80 pass/fail/unknown | Locality pass/fail/unknown |
| :--- | :--- | :--- | :--- |
| 5 | 12/17/0 | 24/5/0 | 12/17/0 |
| 20 | 24/5/0 | 24/5/0 | 29/0/0 |
| 40 | 23/6/0 | 24/5/0 | 29/0/0 |
| 60 | 22/7/0 | 24/5/0 | 26/3/0 |

At20/40 all17 labeled touches pass (including index148–152) and all12 valid
non-touch phases reject (including index146/147). Middle111/119/164 reject,
but reasons matter: at40,111 has both downward veto and missing upward support;
119 rejects for missing upward support, not a new downward witness;164 has a
downward veto with upward support retained. At60 second-middle166–168 lose
upward support and reject. At5 all17 touches reject. No cutoff has been selected
as a production rule. Agreement on these selected same-clip frames is not
held-out or verified physical accuracy/latency evidence.

Four corrected final cards inspected: index146/147/151, first-middle119.
Other26 final cards were exported without individual source review after this
last correction; earlier locality exports had more reviews, which remain
historical. Source hashes and saved anchors are unchanged. No new held-out clip.

**Next:** review the corrected gallery with the user before further tuning.
Keep forward depth reachable while restricting lateral travel, and distinguish
missing positive evidence from a downward veto when discussing middle cases.
See [execution evidence](../tests/README.md#curved-boundary-dfs-comparison-2026-11-01).

## Historical: stronger downward DFS (2026-11-01)

Superseded by the boundary-band run above. Canonical images and reports now
show that run; D80 raw results are preserved in `shadow-dfs/d80-results.json`.

The user requested stronger-shadow-only downward DFS, replacement of the old
`shadow-dfs` images, and old/new pass/fail tracking. Current canonical gallery:
[30 new cards](../frontend/test-results/shadow-dfs/index.html),
[old/new report](../frontend/test-results/shadow-dfs/changes.html),
[CSV](../frontend/test-results/shadow-dfs/changes.csv) and
[comparison JSON](../frontend/test-results/shadow-dfs/changes.json).
All 30 canonical PNGs were overwritten at the user's request. Old decisions and
paths survive in `shadow-dfs/previous-results.json`; repeated runs reuse that
snapshot instead of comparing the new run against itself. Native caches and
other galleries remain intact. The older boundary-control comparison now links
the current canonical cards, not deleted original PNGs.

Run `cd frontend && npm run experiment:shadow-dfs` (now `--dfs --strong-downward`).
This uses the filtered fingertip boundary, fixed **darkening >80 for downward
seeds AND every downward traversal pixel**, and unchanged upward cutoffs
5/20/40/60. 80 is an initial exploratory setting chosen for this requested test,
not validated or swept. Upward seeding/traversal and positive support remain
unchanged; no downward seed below the stronger cutoff is allowed. c=d=e=4,
saved tip/estimated width, per-seed windows, both color filters, reference and
source hashes are unchanged. No motion, new labels, live integration or pinky work.

Pass/fail below means agreement with approximate user phases in this one clip:
`touch`/`touch-interval` expect PRESS; all other target-valid phases expect
NO PRESS. Unknown stays separate; wrong-target first-middle120 is excluded.
These are exploratory frame counts, not verified physical-contact accuracy.

| Upward cutoff | Old pass / fail | New pass / fail | New rejected touches / accepted non-touches |
| :--- | :--- | :--- | :--- |
| 5 | 12 / 17 | 24 / 5 | 2 / 3 |
| 20 | 24 / 5 | 24 / 5 | 2 / 3 |
| 40 | 23 / 6 | 24 / 5 | 2 / 3 |
| 60 | 22 / 7 | 24 / 5 | 2 / 3 |

Zero unknowns at every cutoff, one excluded row. Old baseline used the original
color-cluster mask; the previous filtered-boundary run had identical primary
decisions on all120 comparisons, so the changed classifications are relative to
both baselines. Old/new outputs, phases and pass/fail are recorded per frame
and cutoff in the report, not inferred from gallery colors.

Index148–150 now pass at all upward cutoffs;151/152 still reject via side-shadow
paths. Index146/147 and153/154 remain rejected. All middle touches pass. Three
non-touch phases pass: first-middle111 (near-touch),119 (separation), and
second-middle164 (before labeled touch). At upward40,111 and164 are new false
presses;119 was already a false press. No cutoff was selected as the detector.
All new settings give18 PRESS/11 NO PRESS among29 target-valid frames.
Nine final cards inspected: index147–152, first-middle111/119 and
second-middle164. The other21 were exported without individual source review.

Next: review remaining index151/152 side vetoes and middle111/164 false presses
before adjusting strength or locality again. Inspecting these static frames does
not establish a temporal detector. Preserve the global downward-veto semantics.
Verification is recorded in the [test log](../tests/README.md#stronger-downward-dfs-comparison-2026-11-01).

## Filtered fingertip boundary comparison (2026-11-01)

The user asked to investigate index touch148–152 first: the color-cluster
finger mask extends into a side shadow, whereas the fingertip excluded by the
filtered darkening map looks closer to the visible boundary. Added a separate
`--dfs --filtered-boundary` export. Historical results below predate the stronger
downward run above; original PNGs were subsequently replaced at user request,
while original decisions/paths remain in `shadow-dfs/previous-results.json`.

Run from the repository root:

```sh
node tests/frontend/shadowDirectional.experiment.mjs --dfs --filtered-boundary
```

Review the [five-frame before/after comparison](../frontend/test-results/shadow-dfs-filtered-boundary/comparison.html)
or [all 30 frames](../frontend/test-results/shadow-dfs-filtered-boundary/index.html).
The boundary proposal uses raw valid darkening >5 and projection residual >0.12;
the secondary color comparison uses shift >10 instead. These are pixels rejected
by the corresponding shadow color filter, not an inversion of all displayed
black pixels. Clear paper, unavailable measurements and invalid dark reference
pixels are excluded. There is no clustering or morphology in this new mask.
The unchanged DFS selects the connected local cross-section at a and traces its
lower/side envelopes. This remains an experimental boundary, not validated skin.

Saved anchors, saved estimated widths, c=d=e=4, per-seed search windows, shadow
cutoffs and global downward veto are unchanged. The primary mask is fixed across
all four shadow cutoffs. Same native source/reference hashes and 640×427 analysis;
no new video seeking, labels, motion, live integration or parameter sweep.

At index148/149, the cross-section at a changes from x300–327 to x308–326,
removing the left flare. At150 it stays x307–326; at151/152 x306–326. All five
still reject at every cutoff. At148/40, the veto seed moves from (299,190) to
(307,190), but its new path reaches the same (304,198) downward witness. The
corrected boundary still connects directly to the side shadow. Boundary change
alone therefore does not resolve the rejection; the current search/arc locality
still permits side-shadow vetoes. No search width or c was adjusted to force a pass.

All 120 primary per-cutoff decisions match the original export. Among the 29
target-valid frames, PRESS/NO PRESS/UNKNOWN counts remain 0/29/0 at5, 12/17/0
at20, 13/16/0 at40, 14/15/0 at60. Middle111/119 false positives remain, and
second-middle171 stays rejected. Wrong-target first-middle120 remains excluded.
Five index cards and middle119/171 were reviewed; the other 23 cards were not
individually reviewed. Same-clip approximate phase labels remain a limitation.

Next: review the corrected index boundary and the remaining side paths with the
user before changing horizontal bounds or the selected distal arc. Keep this
mode as a comparison, preserve all old galleries, and keep motion and pinky/
overlap refinement deferred. Execution details are in the
[local test record](../tests/README.md#filtered-fingertip-boundary-comparison-2026-11-01).

## Resume here: bounded directional DFS (2026-10-31)

### End-of-session handoff — user review (2026-10-31)

The user reviewed the DFS output and said it appears to work well with a
**significantly lower amount of false positives**, then requested documentation
and a handoff before leaving. Record this as **the user's qualitative visual
assessment**, not a measured reduction in false-positive rate or a validated
comparison against the prior algorithms. Keep the bounded DFS as the current
experimental direction; do not restart the earlier clustering/component/ray
approaches or collect the same anchors again.

**Start next session here:**

- Open the [current DFS gallery](../frontend/test-results/shadow-dfs/index.html).
  Every PNG already includes its per-cutoff decision and paths. The user has
  reviewed the output; do not repeat the basic explanation unless requested.
- Current constants are c=d=e=4 analysis pixels; per-seed search width is one
  saved estimated finger width. **Any downward-limit witness vetoes the finger;
  one upward path supports only when that veto is absent.** Width caps stop
  traversal normally. These are the user's clarified semantics.
- Preserve the encouraging middle results and the remaining mismatches:
  middle touch intervals pass at 20/40/60; released second-middle171 is rejected;
  index touch148–152 is rejected from side paths; first-middle119 (separation)
  passes at40/60 and111 (near-touch) passes at60. No cutoff has been selected.
- First investigation if refinement resumes: examine index148's marked left
  veto path and middle111/119. c and the horizontal width budget are the intended
  locality controls. Any comparison should keep settings fixed across the same
  sequences and retain both false positives and rejected touches; no parameter
  sweep was performed this session. Motion remains excluded; pinky/overlap
  refinement remains deferred. No live detector integration is requested yet.

To regenerate (no app server needed):

```sh
cd frontend
npm run experiment:shadow-dfs
```

Installed Chrome is the default (`CV_BROWSER_CHANNEL` override). Input files
must already exist: `images_test_cases/background.png`, the baseline
`frontend/test-results/shadow-hypothesis/results.json`, its saved
`middle-first-*.native.png` files, and
`frontend/test-results/shadow-sequence/fingers/sequence.json`. The exporter
verifies the original native source/reference hashes, reuses saved fingertip
anchors and recomputes masks. It does not re-seek the video or use phase labels
in its decisions. Earlier mask/resampling variation is documented below.

**Preserve local work:** implementation, documentation and root measurement
JSONs remain uncommitted local work, including untracked files. All galleries
and source caches under ignored `frontend/test-results/` must survive cleanup;
the current DFS directory contains 30 PNGs plus HTML, CSV and full JSON paths.
Older `shadow-hypothesis`, `shadow-directional`, `shadow-edge-regions`,
`shadow-sequence`, fingertip and image-map artifacts remain useful comparison
history. Nothing was committed, pushed or opened as a GitHub issue/PR.

Verification is complete for this implementation: 28 tip-evidence cases and
58 focused cases passed; lint (three existing image warnings), TypeScript,
39 contrast checks and the network-enabled production build passed. Full suite:
598 passed /26 failed /one skipped, comprising 25 known fixture failures plus
one audio timeout; isolated browserAudio rerun passed all72. See the linked
execution record below. This handoff-only update runs no new tests and adds no
physical accuracy, latency, cross-clip or CI execution claim.


The user replaced the earlier connected-region rule with the algorithm at the
bottom of [thoughts.txt](../thoughts.txt), then clarified its meaning:
**any shadow reaching the downward limit rejects the entire finger**, while
at least one upward path from an actual attached shadow supplies supporting
evidence. Directional searches must not wander arbitrarily sideways; hitting
the horizontal cap stops a search without making the result unknown. This
supersedes the earlier at-least-one-component rule and full-component endpoint
requirements. Keep the older galleries as history.

Implemented [measureMonotoneShadowPaths](../frontend/src/cv/shadowTipEvidence.ts)
and exporter `--dfs`. Run `cd frontend && npm run experiment:shadow-dfs`.
Ignored output: `frontend/test-results/shadow-dfs/index.html`, `summary.csv`,
`results.json` and 30 PNGs. Same local-only scope, saved native sources/tips,
reference hashes and approximate user phase labels. No motion, pinky/overlap
refinement, live notes/audio, sidecar change or GitHub issue/PR/commit/push.

### Exact DFS rule

- Initial fixed settings: **c=d=e=4 analysis pixels**. Image Y increases downward:
  `aY=tipY−c`, downward rejection row `tipY+d`, upward support row `aY−e`.
  Reaching the downward row (including equality) rejects; reaching the upward
  row (including equality) supports.
- Find the contiguous finger-mask cross-section containing the tip X at row a.
  Follow its connected lower portion to form a lower silhouette plus both side
  envelopes below a. Internal mask holes do not become new silhouette seeds.
  A synthetic regression caught a first draft that omitted the short side edges;
  this was corrected before the final export. The contour still inherits the
  exploratory color-cluster mask's placement/errors and is not ground truth.
- Collect compatible shadow pixels directly adjacent to that arc, with seed
  rows at/below a. For each fixed darkening cutoff 5/20/40/60, use the same
  projection residual ≤0.12 primary, normalized RGB shift ≤10 secondary,
  reference cutoff 40 and 640×427 analysis as before. No new clustering model.
- Each attachment has an independent horizontal window of **one saved estimated
  finger width**, centered on that attachment (rounded to integer pixels; even
  widths have the extra pixel on the left). The same window applies to both
  directions from that seed. The width is an initial implementation choice,
  not a validated threshold; index's estimated width is 44 in frame 148.
- Downward DFS allows sideways and downward eight-neighbor steps (dy=0 or +1),
  never upward. All attachments must survive this veto: stop at the first path
  reaching `tipY+d`, which rejects the finger regardless of upward support.
- Upward DFS allows sideways and upward steps (dy=0 or −1), never downward.
  At least one attachment must reach `aY−e`. Both searches start from actual
  attached shadow, not unrelated upward context. Upward paths are also exported
  after a veto for diagnostic explanation; they cannot override rejection.
- Traversal stops at the horizontal budget or known pixels that fail the shadow
  predicate (including a known color-filter mismatch). These are **not unknown
  endpoints** and do not require a whole-component boundary. Actual unavailable
  measurements, image bounds and incomplete mask geometry can still prevent a
  decision. A downward witness always rejects; otherwise upward support with no
  unresolved downward evidence passes. Clear paper with no attached shadow fails.
  A thin single-pixel path may support; the prior ≥2px/≥3-row requirement is removed.

### PNGs and findings

PNGs retain separate PRESS / NO PRESS / UNKNOWN banners at all four cutoffs.
Wrong-target first-middle 120 shows INVALID TARGET and is excluded from the
counts below. Blue is the traced arc, purple attachments/a row, red downward
visited pixels/rejection path/endpoint and d row, green upward visited pixels/
support path/endpoint and e row. Dashed purple bounds mark the rejection witness,
otherwise the supporting/first search's horizontal window. The illustrated cutoff
is explicitly labeled: first matching cutoff, otherwise 40, for display only.
All raw visited pixels, per-seed bounds, witness paths and uncertainty flags are
in JSON; paths show reachability, not a shortest-path or physical shadow claim.

Final counts among 29 target-valid rows:

| Darkening cutoff | PRESS | NO PRESS | UNKNOWN |
| :--- | ---: | ---: | ---: |
| 5 | 0 | 29 | 0 |
| 20 | 12 | 17 | 0 |
| 40 | 13 | 16 | 0 |
| 60 | 14 | 15 | 0 |

- Both middle touch intervals (first 112–117 and second 165–170) pass at 20/40/60.
  Second-middle approach 163/164 and release/hover 171/172 are rejected. The
  earlier released-frame 171 false positive is rejected by the new global veto.
- **Index touch 148–152 is rejected at every cutoff.** At index 148, the 40-luma
  rejection path starts at (299,190) on the left arc and reaches (304,198), the
  `tipY+4` row. This is a side-shadow interference/arc-selection counterexample,
  not a reason to change labels. Saved tip is (318,194), width44; it differs from
  the earlier manually supplied anchor and should not be conflated with it.
- First-middle **separation 119 passes at 40/60**; first-middle **near-touch 111
  passes at 60**. These remain false-positive/counterexample observations under
  the approximate user phases. Do not choose a cutoff or tune per-frame constants
  to hide them. All 29 target-valid rows have upward support at 20/40/60, so that
  condition alone supplies no phase distinction here.
- Native source/reference hashes match. Masks are recomputed; first-middle 116's
  recomputed tip differs one X pixel (saved384 versus recomputed383), recorded in
  JSON while the saved anchor remains fixed. Earlier reconstruction variation
  remains a limitation; native hashes do not prove bit-identical sampled masks.

Six final cards inspected: index 148, first-middle 112/119, second-middle
164/165/171. The other 24 are exported without individual source review in this
continuation; previous review flags are explicitly historical. All evidence is
from one clip/lighting setup, with approximate viewer-frame/contact labels.

**Next:** review index 148's left-side veto path and the middle 111/119 passes
with the user. c and the horizontal budget are the intended locality controls;
no sweep/tuning was performed. Preserve the global downward-veto interpretation
and monotonic paths. This is a static candidate experiment, not validated contact,
held-out accuracy, physical latency or live note behavior. See the
[execution record](../tests/README.md#bounded-directional-dfs-experiment-2026-10-31).

## Resume here: at least one qualifying edge-shadow region (2026-10-31)

**Historical experiment, superseded by the bounded DFS handoff above.**

The user clarified that **all rays must not be required**. Look for strong shadow
immediately outside the estimated fingertip edge; at least one such local shadow
must have a short downward extension (no more than eight analysis pixels) and
an upward extension with some width. Other side shadows must not veto that
region. Implemented this as a separate offline mode; the old strict-fan result
and original static comparison remain preserved.

Run `cd frontend && npm run experiment:shadow-edge-regions`. This calls
[the existing exporter](../tests/frontend/shadowDirectional.experiment.mjs)
with `--edge-regions`, using
[measureEdgeShadowRegions](../frontend/src/cv/shadowTipEvidence.ts).
No live detection, audio or sidecar changes; no motion, pinky/overlap refinement,
new dependency or GitHub issue/branch/PR/commit/push.

### Exact rule now tested

1. Reuse the same saved fingertips and source hashes on all 30 index/middle
   frames. Recompute the existing color-cluster mask. Find its local component
   containing the saved tip interior (searching up to eight rows above it).
   Pixels directly outside that component's distal edge seed candidate shadows:
   eight-neighbor adjacency, boundary rows −8 through +6 from the saved tip,
   within one estimated half-width of its X. A black filtered pixel is not itself
   a validated finger mask; unchanged dark pixels/ink/unknowns can also be black.
2. For each predeclared darkening cutoff 5/20/40/60, flood-fill eight-connected
   compatible shadow pixels from those seeds. Bounds are saved tip Y ±24 rows
   and X ±(ceil(finger width/2)+8). This is bounded local shape measurement,
   not global connected-component area and not a shadow-cluster k-means change.
3. A region's **downward extent** is `max(0, lowest region Y − saved tip Y)`.
   It must be ≤8 analysis pixels (vertical image-Y distance, not ray steps or
   physical units). A known extension >8 rejects that region. A short component
   touching the lateral/bottom scan limit or unknown/color-excluded downstream
   pixels cannot establish a complete endpoint and stays unknown. Top clipping
   is permitted upward context.
4. The **same component** must contain contiguous exposed width ≥2 pixels on
   at least three distinct rows behind the tip (excluding the nearest two rows),
   in the existing six-pixel side strips extending up to 24 rows back. Width=2
   and rows=3 are explicit initial defaults for the user's "some width", not
   validated/tuned contact thresholds. Unavailable upward boundaries can leave
   this condition unknown. A separate upward shadow cannot satisfy another
   disconnected component's shape condition.
5. **Any one qualifying region yields PRESS at that cutoff.** Long/unknown
   other regions do not veto it. Without a qualifying region, any unresolved
   possible candidate gives UNKNOWN; otherwise NO PRESS. Clear paper alone
   cannot produce PRESS. The user phase label never enters these calculations.

All settings stay fixed across frames. Analysis remains 640×427, reference
cutoff 40, projection residual ≤0.12 primary, color shift ≤10 secondary in JSON.
Both filters are exported at all four darkening cutoffs; none is selected as a
classifier. Saved native sources/reference must match prior hashes. Current
recomputed proposals match the saved tips on all 30 frames, but masks were not
saved in the original experiment and earlier exports exposed reconstruction
variation; do not infer bit-identical analysis pixels from native hashes alone.

### Results and visible evidence

Ignored outputs: `frontend/test-results/shadow-edge-regions/index.html`,
`summary.csv`, `results.json`, 30 PNGs. Each PNG keeps PRESS / NO PRESS / UNKNOWN
banners at every cutoff. Wrong-target first-middle 120 shows INVALID TARGET and
is excluded from target interpretation. Purple marks qualifying connected
regions, red other seeded regions, blue edge/seed pixels, green upward strips,
and yellow the estimated finger. The displayed component cutoff is explicitly
labeled: first matching cutoff if present, otherwise 40, **for visualization
only**. The four classification columns remain independent of this choice.

Final export counts among 29 target-valid frames:

| Luma cutoff | PRESS | NO PRESS | UNKNOWN |
| :--- | ---: | ---: | ---: |
| 5 | 0 | 7 | 22 |
| 20 | 0 | 5 | 24 |
| 40 | 0 | 2 | 27 |
| 60 | 3 | 2 | 24 |

The three 60-luma matches are index 148/149 (touch/touch interval) and
second-middle 171 (**user-labeled released**). The latter is a counterexample:
a short side component with sufficient upward width qualifies while another
component extends farther downward. The any-region rule intentionally does
not let that other component veto it. Therefore this rule alone does not yet
establish contact, even though it now implements the requested positive-evidence
logic. Do not tune away the released-frame result or pick 60 based on these
same-clip outcomes.

Many results are UNKNOWN because side/back components cross the bounded
lateral window, or excluded/unknown pixels interrupt their exposed boundaries.
For example first-middle 112 has a short one-pixel distal region with upward
width, but that connected region reaches a lateral scan limit. At index 148,
one region at 60 has zero downward extension and adequate upward width, while
other longer regions are rejected independently. The component can still mix
persistent lateral/neighbor evidence; connectivity does not establish ownership.
Five final cards inspected: index 147/148, first-middle 112, second-middle
164/171. Other 25 cards exported without individual source review in this step.

**Next:** review those marked components with the user, especially the released
frame 171 and the lateral-window unknowns. Decide whether the qualifying evidence
must include a specific distal arc or local band relation beyond side-only
adjacency. Preserve the user's at-least-one requirement; do not restore an
all-rays-clear veto. No held-out accuracy, physical contact/latency or live note
claim. See [execution evidence](../tests/README.md#at-least-one-edge-shadow-region-experiment-2026-10-31).

## Latest continuation: upward shadow + thin rim + clear forward region (2026-10-31)

The user proposed contact when a thin fingertip shadow rim remains, shadow
extends upward/back beside the finger, and no shadow extends downward.
Implemented an **offline diagnostic pattern**, not a live press detector, in
[shadowTipEvidence.ts](../frontend/src/cv/shadowTipEvidence.ts) and
[exporter](../tests/frontend/shadowDirectional.experiment.mjs).
Run `cd frontend && npm run experiment:shadow-directional`. No app server needed.
This continuation follows the existing local-only experiment scope; no issue,
branch, PR, commit or push was created. Motion stays excluded and pinky/overlap
refinement stays deferred.

Ignored output: `frontend/test-results/shadow-directional/index.html`,
`summary.csv`, `results.json` and 30 four-panel cards. Prior galleries remain
preserved. Each card shows native source, explicit sampled regions, raw darkening
and projection-filtered darkening. Yellow marks the estimated finger, green the
upward context, blue the forward samples, purple the two-pixel allowed rim,
and red the saved estimated tip. Thin blue lines on heatmaps mark scan directions;
region-overlay colors are annotations, not measured shadow intensity.
Each PNG also has prominent PRESS / NO PRESS / UNKNOWN banners at all four
cutoffs, reflecting the experimental pattern result separately from the user
phase in the header. Wrong-target rows show INVALID TARGET.

### Definition and controls

- Reuses all 30 original index/middle sources; each native source and the
  reference must match the prior export's SHA-256. First-middle uses its saved
  native PNGs rather than another video seek. Original approximate phase/time
  labels and wrong-target flags remain. First-middle 120 remains excluded from
  target interpretation. The prior `directional-limit` flag refers to the old
  central strip, not a new review result.
- Saved fingertip coordinates/widths are held fixed. Finger masks are recomputed
  with unchanged color-clustering defaults; they were not saved in the baseline.
  Initial-run recomputed tips differed by one analysis pixel in first-middle
  116 (x384→383) and second-middle 170 (x277→276). The PNG-label rerun reproduces
  the saved tips on all 30 frames, but some intermediate ray profiles differ
  (index 149 and first-middle 116); per-cutoff pattern decisions/counts remain
  unchanged. Current recomputation differences are exported, while the saved
  coordinates remain the measurement anchors. Identical native bytes do not
  prove identical browser-resampled pixels/masks. The cause of these small
  reconstruction differences is not established.
- Same 640×427 analysis, reference cutoff 40, projection residual ≤0.12 primary,
  normalized-RGB shift ≤10 secondary, raw display floor/full scale 5/120.
  Reports all fixed luma cutoffs 5, 20, 40, 60; no per-frame selection.
- Seven rays at −60, −40, −20, 0, 20, 40, 60 degrees relative to image-down.
  Origins spread across the distal silhouette at `0.4 × finger width × sin(angle)`
  from the saved X. Every origin requires a local three-pixel mask run within
  −8/+6 rows of the saved tip. Missing origins stay unavailable. This local
  bound prevents distant upper mask regions from becoming distal anchors.
- Each ray samples 24 pixel-distance steps. **Thin band** requires a known
  complete attached extent ≤2 steps on every ray, with the existing three-step
  attachment window. **Downward clear** requires all compatible samples beyond
  the allowed two-step rim to be below/equal to that cutoff. Any strong sample,
  including a detached one, rejects clear; otherwise missing/occluding/unknown
  samples prevent an absence claim. Oblique distances are ray steps, not vertical
  thickness or physical millimeters; rounding can repeat an oblique pixel.
- **Upward present** means strong compatible exposed side-strip samples on at
  least three distinct rows behind the tip, excluding the first two rows.
  Strips are six pixels wide and extend up to 24 rows back. Insufficient
  compatible coverage (<50%) or fewer than three known rows stays unknown
  unless positive evidence is present. This is visible side/back context,
  not a measurement through the finger or verified caster ownership.
- Pattern match requires all three conditions. A known failed condition rejects
  the pattern; otherwise any unknown condition keeps the result unknown. Seven
  sparse rays do not establish absence throughout the whole forward region.

### Findings

No target-valid frame matches this strict full-fan pattern at any of the four
cutoffs. Excluding wrong-target first-middle 120, the 29 rows are:

| Luma cutoff | Pattern rejected | Pattern unknown | Pattern matched |
| :--- | ---: | ---: | ---: |
| 5 | 29 | 0 | 0 |
| 20 | 29 | 0 | 0 |
| 40 | 26 | 3 | 0 |
| 60 | 20 | 9 | 0 |

At 40 luma, upward evidence is present in all 29 target-valid rows, including
hover and touch: it supplies context but does not distinguish these phases here.
The new directions capture second-middle's diagonal lobe: frame 163's +20° ray
has extent 18 steps while its center is clear; frame 164 has 19 above-cutoff
samples beyond the rim on +40°, despite a one-step attached extent. The detached
lobe therefore cannot be silently treated as absent after the first clear gap.

But broad fan clearance is too strict in these examples. At index touch 148,
central −20/0/+20° extents are 0/1/1 while the −40° ray extends 20 steps into a
persistent side region. At first-middle touch 112, the center is one step but
+60° is four; at second-middle touch 165, the center is one but +40/+60° are
three/four. These may include side context, mask placement/antialiasing and
remaining exposed rim; this experiment does not establish physical ownership
or thickness. Five final cards were directly inspected: index 148, first-middle
111/112 and second-middle 164/165. The other 25 new cards are exported but not
individually reviewed in this continuation.

**Next:** review the marked scan regions with the user, especially index 148
and second-middle 164/165. Define which distal arc counts as downward versus
persistent lateral/upward context before changing the rule or allowance. The
current strict implementation does not validate the contact hypothesis; its
failures also do not disprove a better specified local-band version. Do not
increase thresholds or rim width per frame to force a match. No k-means shadow
cluster, temporal rule, live note change, held-out accuracy or latency evaluation
was introduced. See the [execution record](../tests/README.md#directional-shadow-pattern-experiment-2026-10-31).

## Previous handoff (2026-10-29)

The projection maps, color-exclusion comparison, labeled pixel/patch collector,
and manually source-anchored shadow-band panel are implemented locally in both
`/cv-shadow-test` and the paused video replay. The user has now asked to set
motion aside, keep connected front/back shadow context, and use color clustering
to estimate fingertips automatically before measuring nearby shadow. A local
offline pilot is implemented. The user reviewed the still-image estimates as
generally accurate, deferred pinky/overlap work, and authorized the static shadow
comparison. **That comparison is now exported for 30 index/middle frames.**
Resume with its findings below, especially the diagonal-lobe counterexample;
do not restart manual anchoring or fingertip tuning before this investigation.
The current question is
whether local shadow changes distinguish **almost touching from actually
touching**, rather than merely high hover from touch. The band endpoint problem
remains open as earlier diagnostic work. There is no automatic
finger ownership, validated skin boundary, or live note decision from these tools.

### Evidence already collected — do not start over

- [User pixel/patch samples](../shadow-samples.json): 20 user-labeled 3×3 patches
  (180 pixels), five categories across hover/approach/touch/release, same clip.
  At a fixed 5-luma floor, color shift ≤10 retains 24/36 shadow pixels;
  projection `e_I ≤0.12` retains 33/36. Both reject all 36 sampled skin pixels
  and all 36 nail pixels, but also retain 27/36 paper pixels and 36/36 ink pixels.
  At `e_I ≤0.15`, all 36 shadow pixels survive but two skin pixels leak through.
  These small, selected patches are exploratory, not held-out accuracy evidence.
- User-provided video timing is recorded under **User-labeled contact sequences
  inspected** below. Use those newer approximate viewer annotations for this
  investigation, not the older sidecar as authoritative contact truth. Sidecars
  have not been modified. Ring onset/release remains explicitly uncertain.
- The 39-frame automatic source-anchor pilot below exposed misplaced anchors,
  one/two-pixel sensitivity and censored runs. Its proposals are not ground truth.
- The user subsequently supplied **three manually placed index-finger anchors**:
  [original band export](../shadow-band-measurements.json) and
  [corrected phase labels](../shadow-band-measurements.corrected.json).
  The original is preserved. The corrected copy changes only frame 148's
  `phase` from `hover` to `touch`; every coordinate, profile, measurement,
  setting, ID and timestamp is unchanged. Frame 146 was correctly `hover`;
  frame 153 was correctly `release`. Do not ask the user to repeat these three
  placements before examining the existing data.

### Latest manual band results

Clip: `tests/automation/CV Test Videos/cv_automation_test_1.mov`;
reference: `images_test_cases/background.png`; 640×427 analysis, 1620×1080 native.
Frames are approximate 30-FPS viewer indices, not verified encoded-frame IDs.

| Frame / time | Correct phase | Source tip (x,y) | Outward point | Result |
| :--- | :--- | :--- | :--- | :--- |
| 146 / 4.866666 s | hover | (315,173) | (316,194) | All five rays censored, each retained through 24 sampled steps; no complete width |
| 148 / 4.933333 s | touch | (318,195) | (318,207) | All five rays censored; first below-floor step followed by a 23-step retained run to the scan limit; no complete width |
| 153 / 5.1 s | release | (319,186) | (320,201) | Three ambiguous-boundary rays, two censored; no complete width |

**These manual records used `method: "color"` (normalized RGB shift ≤10), not
projection.** The stored maximum residual 0.12 was inactive for exclusion.
Other settings were darkening floor 5, display full scale 120, residual display
scale 0.3, reference-luma cutoff 40, scan length 24 and half-width 2 (five rays).
All aggregate widths are null / insufficient-evidence, not zero or a press.

The center touch ray starts at −0.92 luma (below floor), then about 6.29, 6.29,
8.65, 8.57, 10.57, 11.29 and 12.29 luma. Thus weak reference-relative darkening
farther along the ray stays above the 5-luma floor and prevents an endpoint.
The release center ray begins with a color-rejected pixel, so the tool marks
that boundary ambiguous rather than silently skipping it. These are the current
blocking measurement observations, not evidence that the phase labels are wrong.

### Concrete next work

1. **Static comparison completed locally.** Read the 30-frame results below.
   Index supports the short strong-forward-shadow cue; first-middle supports
   the intensity change with ambiguous near-touch extent; second-middle is a
   counterexample to the narrow central downward strip.
2. Investigate a wider distal-edge or directional region on these same frames,
   without choosing per-frame thresholds. Check source boundaries and separate
   side/back context from forward evidence. The unresolved question remains
   **almost touching versus touching**, not high hover versus touch alone.
3. Keep separate notes for **index, middle, ring and pinky; exclude thumb**.
   Existing review: index and both middle examples show distal contraction and
   re-expansion; ring has neighboring-shadow/blur ambiguity; pinky has weak
   shadow even during hover. Missing shadow alone is not a contact rule. The
   detailed **Per-finger local appearance review** below is already complete;
   do not restart it or treat its observations as verified detection accuracy.
4. Keep motion excluded and pinky/overlap refinement deferred as the user
   requested. No press threshold is established. Boundary placement, ambiguous
   endpoints and possible neighboring evidence must stay visible.

### Static shadow-hypothesis comparison (2026-10-29)

Implemented [static local evidence](../frontend/src/cv/shadowTipEvidence.ts)
and [offline comparison exporter](../tests/frontend/shadowHypothesis.experiment.mjs).
Run `cd frontend && npm run experiment:shadow-hypothesis`. No app server is
needed. It reuses the original clip/reference and existing cache annotations,
without changing sidecars, manual anchors, masks in prior exports or live notes.

Ignored output: `frontend/test-results/shadow-hypothesis/index.html`,
`summary.csv`, `results.json`, 30 four-panel frame cards, three five-frame
comparison sheets, and recovered first-middle native PNGs. Cards show native
source, estimated finger/edge, raw darkening and projection-filtered darkening.
Sheets stack those four views per frame. The original galleries are preserved.

Conditions and definitions:

- Index 146–154, first-middle 110–120 and second-middle 163–172: 30 frames,
  one clip/lighting setup, approximate user viewer annotations. Ring and pinky
  are not part of this comparison. The user judged localization useful in most
  stills; this is qualitative feedback, not a measured accuracy result.
- Same 640×427 analysis, native 1620×1080 source, `background.png`, reference
  cutoff 40, unchanged k-means fingertip defaults. Fixed spatial gates from the
  earlier review crops select index x≈318, first-middle x≈385 and second-middle
  x≈277, within 18 analysis pixels. No phase, previous frame or motion enters
  localization or shadow math. This gate associates an experiment target; it
  does not implement automatic anatomical identities.
- Primary projection filter `e_I ≤0.12`; secondary normalized-RGB shift ≤10 is
  exported separately for every frame. No method is selected per frame. Raw
  darkening display floor 5/full scale 120 stays fixed.
- Downward parallel rays use the estimated mask's lower boundary independently
  per column, searching −8 through +6 pixels from the candidate's Y. Half-width
  is one quarter of estimated finger width, bounded to 2–8 pixels. This measures
  a central distal strip, not the entire forward-facing fingertip arc.
- Four predeclared intensity cutoffs (5, 20, 40, 60 luma) are reported together;
  they are diagnostics, not selected contact thresholds. Runs must start within
  three pixels of the estimated boundary, stop at known below-cutoff evidence,
  and have a 24-pixel scan limit. Median extent requires a majority of complete
  rays. Unknown/color-mismatched/occluding endpoints remain ambiguous; runs
  reaching the scan/image limit remain censored.
- Zero specifically means the first three samples are known clear **at that
  intensity cutoff**, not no shadow anywhere or proof of a press. Stronger
  evidence beyond this attachment window is flagged separately in raw profiles.
  This differs from the older manual band's null-only absence interpretation.
- First-six-pixel compatible mean darkening and fractions above each cutoff
  are recorded independently of complete-run availability. Side/back context
  samples six pixels outside each visible side boundary over 24 rows behind
  the tip. Coverage, unknown samples and scan-limit evidence are recorded;
  this is not whole-component area or validated shadow ownership.
- First-middle's old cache contains enlarged crops, so full frames were
  recovered by paused browser video seek using the same requested times.
  Source hashes, clip/cache hashes and requested versus decoded media times
  are exported. Decoded offsets reach about one 30-FPS frame; exact encoded
  identities and onset timing are not established. Later sequences use their
  original cached full frames. Native source views are the qualitative check.

Findings, with **40 luma as one reported column, not a selected classifier**:

| Sequence | Near-touch / before labeled touch | Labeled touch | Interpretation |
| :--- | :--- | :--- | :--- |
| Index, 147 → 148 | Median forward extent 9 px; near mean drop 86.85 | Extent 1 px; near mean 16.17 | Supports short, weaker exposed forward shadow at touch in this example. Hover 146 is 19 px; hover-again 154 is 14 px; release 153 extent is ambiguous. |
| First-middle, 111 → 112 | Extent unknown (4/11 complete rays); near mean 55.54 | Extent 1 px; near mean 19.82 | Supports the intensity change; no complete near-touch width comparison. Hover 110 is 8.5 px. |
| Second-middle, 164 → 165 | Extent 1 px; near mean 23.09 | Extent 1 px; near mean 27.80 | Does not separate these phases. Hover 163 also measures 1 px. Source/maps show a broad lobe diagonally right of the tip that the central downward strip misses. |

The index touch interval 148–152 remains at 1 px in the 40-luma column.
First-middle 112–117 and second-middle 165–170 also remain at 1 px; the
second-middle hover counterexample prevents interpreting that value as contact.
Large side/back darkening persists at touch (for example index 148 mean 83.21),
supporting keeping it separate from forward evidence. Hot-tip raw darkening
is present across states (index 147/148 means 96.15/94.17), so it alone supplies
no contact distinction here. One-pixel rims can include antialiased finger
edges or boundary-placement error; no physical shadow thickness is claimed.

Source review of all three key-frame comparison sheets found one target
association failure: first-middle 120 selects the neighboring upper fingertip
(398,154). It is retained with `wrong-target`, not counted as a successful target
measurement. Second-middle 163/164 carry `directional-limit`. Twelve other
key frames are marked `comparison-inspected`; the 15 intermediate frames are
exported but not individually source-reviewed. Automatic gates selected one
candidate on all 30 frames; that is availability, not 30 correct identities.
Twenty-six frames have a complete 40-luma median, before review exclusions.

**Next:** inspect a wider front arc or fixed directional scans on the same
frames to capture the diagonal lobe, with side/back evidence still separate.
Retain the index result and first-middle ambiguity; do not tune away the
second-middle counterexample or introduce a press rule yet. Neither low shadow
alone nor hot-tip appearance alone is established as sufficient. No independent
clip, held-out accuracy, physical latency or motion classifier was evaluated.
Execution evidence: [tests record](../tests/README.md#static-shadow-hypothesis-comparison-2026-10-29).

### Local color-cluster fingertip pilot (2026-10-29)

User direction: local work only, no GitHub issue/PR; exclude motion for now.
The shadow at the tip can connect to a larger region behind it, so whole-component
area is not the proposed contact feature. The user requested automatic finger
estimates from the existing shadow/color evidence to speed up the experiment.

Implemented [estimator](../frontend/src/cv/fingertipCandidates.ts) and
[offline exporter](../tests/frontend/fingertipCandidates.experiment.mjs).
Run `cd frontend && npm run experiment:fingertips`; no running app, model,
MediaPipe, manual fingertip selection or new dependency is required. Installed
Chrome is the default (`CV_BROWSER_CHANNEL` can override it). Outputs are ignored
under `frontend/test-results/fingertip-candidates/`:

- `index.html`: one source/mask/projection comparison per image.
- `overview.png`: all 20 source overlays (19 labeled images and background).
- `results.json`: source/reference SHA-256, browser/Node versions, settings,
  clusters, region bounds, spatial candidate coordinates, forward ray profiles
  and separate local forward/back shadow summaries. Original images and previous
  galleries are preserved.

Algorithm: downsample to the existing 640×427 analysis resolution; reuse signed
luma drop, normalized RGB shift and projection measurements. Deterministic
four-center normalized-RGB k-means uses at most 8192 training pixels and ten
iterations. Reddish changed clusters plus color shift >10 propose finger-like
regions. Components need at least 80 pixels and 16 pixels of vertical span.
The smoothed lower silhouette supplies distal peaks, with prominence, width and
duplicate suppression. A blob centroid is deliberately not used as a fingertip.
Defaults assume fingers point down in these images; they are exploratory and
were adjusted while inspecting this same image set, not held-out thresholds.

For each candidate, the existing five-ray forward-band measurement runs with
projection `e_I ≤0.12`, floor 5 and 24-pixel scan length. A separate box extending
24 pixels forward and backward, with finger half-width plus six pixels laterally,
reports compatible exposed shadow after excluding estimated finger pixels.
Forward/back extents are image-Y offsets, not measured physical distances or
automatic shadow-caster ownership. Missing extents remain null; scan-limit
evidence is censored. The box can contain side or neighboring shadow and is
not restricted to the tip's connected component. The forward band retains its
existing ambiguous-boundary/unknown handling.

Final export: 20 images processed, background produced zero candidates, and
the labeled images produced three to five candidates each (77 total). The
overview was inspected across all images; detailed source/mask/projection
comparisons were inspected for index touch 148, pinky touch 199 and ring hover
169. Many points sit near visible distal ends, but merged regions, nail edges,
missing/shifted tips and mask contamination remain. Dark/ignored reference
pixels cannot supply a finger mask in this pilot. In particular, pinky touch
199 is not a successful all-fingertip localization result. Candidate numbering
is left-to-right per image, not anatomical identity; thumb-like regions may
appear, and occluded tips are not reconstructed. There is no fingertip ground
truth or measured recall/precision. Of 77 proposals, 42 yielded complete forward
band aggregates; this is measurement availability, not correctness. Sixty local
boxes reached their forward scan limit and 68 their backward limit, so box
extents often remain lower-bound observations rather than complete widths.

After reviewing this gallery, the user judged localization generally useful,
deferred pinky/overlap refinement and requested the static shadow comparison
above. Do not make perfect fingertip detection a prerequisite for that work.
This pilot does not automatically recognize presses,
assign shadow ownership, use motion, change live notes or integrate into the
interactive viewers. Verification: eight new synthetic cases and 30 focused
cases passed; full Vitest 571 passed, 25 known failures, one skip. See the
[execution record](../tests/README.md#color-cluster-fingertip-pilot-2026-10-29).

### User's explicit hypothesis and initial check (2026-10-29)

Source: the bottom of [thoughts.txt](../thoughts.txt), read at the user's request.
The user reports that a fingertip with bright/red heat and only a short connected
shadow extension looked like a press in the available images. They suggest a
longer extension may belong to another finger, and identify carrying a finger
over the paper as a possible failure case. This is a user-reported observation,
not a measured classification result. The specific heatmap mode is not stated
in the notes; a clarification was requested and remains pending.

Their temporal proposal is to observe a dark shadow during descent, remember
its size, then detect substantial contraction while the fingertip continues
downward. Release would combine upward movement with shadow reappearance/growth.
In image coordinates downward movement normally increases Y. Camera-space Y
alone does not establish movement toward the paper.

Initial inspection reused the saved nine-panel images for index touch 148,
index/ring hover 96 and pinky touch 199, plus index 146–150, first-middle
110–114 and pinky 197–200 source/projection sheets and the saved index/pinky
near-touch comparisons. No new frames or labels were collected.

- Index 147 versus 148 visibly supports inspecting the short distal extension:
  the forward lobe contracts to a thin rim at labeled touch.
- First-middle 111 already shows contraction before the user's touch label at
  112. This challenges contraction alone; it does not decide whether the new
  combined hot-tip/short-extension cue separates those frames.
- Pinky 197 has little retained forward shadow while labeled hover. Weak
  filtered shadow must remain an unresolved case, rather than count as contact.
- The raw darkening maps retain hot finger regions, while both exclusion maps
  remove much of them. A hot fingertip and a filtered shadow rim are different
  observations. Red in raw darkening means a large reference-relative luma
  drop; the code does not interpret it as contact or physical temperature.
- A connected region can mix target, side and neighboring evidence. A long
  extension alone cannot establish another finger's ownership.

Next comparison: once the map is identified, inspect fingertip intensity and
distal extension separately on the existing near-touch/touch/release sequences,
checking the source boundary independently. Keep index, both middle examples,
ring's uncertain onset and pinky's weak evidence separate. A possible
diagnostic would report tip darkening, local forward extent and their temporal
changes together, retaining unknown/censored results. No intensity, extent or
motion threshold has been selected, and no new detector or live behavior was
implemented. This documentation-only continuation adds no test execution,
physical accuracy, latency or held-out evidence.

### Image heatmaps prepared for the next session

- [Per-image heatmap gallery](../frontend/test-results/image-heatmaps/index.html):
  **one PNG per source image**, with source plus eight maps arranged together.
  There are 19 labeled cases and one background self-comparison. This is the
  user's requested format; the single combined atlas was a misunderstanding.
- Each PNG contains raw darkening, color change, multiplier, attenuation, both
  residuals, and darkening filtered separately by normalized RGB shift ≤10 and
  projection `e_I ≤0.12`. Reference `images_test_cases/background.png`; analysis
  640×427; floor 5; darkening full scale 120; reference cutoff 40; residual
  display full scale 0.3. Filenames/labels are preserved, not corrected.
- Original individual maps, four-panel comparisons and settings manifest are
  under ignored `frontend/test-results/image-case-heatmaps-2026-10-28/`.
  These exports are diagnostic artifacts, not a new accuracy test. Protect both
  export folders from cleanup if they are needed next session.

### Earlier band investigation — only if revisited

1. Inspect the existing manual-anchor ray profiles against source crops. Check
   whether the long retained tails are diffuse/neighboring shadow, local paper
   baseline shifts, printed ink, or reference misregistration/exposure. Do not
   assume increasing scan length will solve an unclear endpoint.
2. Replay those same three frames with their saved manual anchors and compare
   **both exclusion methods** with explicit, recorded settings. Preserve the
   original measurements. If a baseline/floor adjustment is explored, hold it
   fixed across all three frames and distinguish exploratory tuning from
   evaluation. A higher floor could discard weak real shadows as well as noise.
3. Inspect anchor perturbations and native-versus-640-pixel sampling before
   adding a geometric threshold. A one-analysis-pixel contact band is already
   highly sensitive to boundary placement. Curvature and scan direction matter.
4. Request more manual labels or another clip only after identifying what new
   observation would resolve. No press/hold/release classifier or threshold is
   established; no live contact/audio code should be changed from these results.

### Restart and preservation

The latest production build was served at `http://localhost:3107/cv-shadow-test`.
If the server has stopped, run from the repo root:

```sh
cd frontend
npm start -- --port 3107
```

If build output is missing/outdated, run `npm run build` first (existing Google
Fonts require network access). Reopen the same video and upload `background.png`
for comparisons with the collected data. Saved JSON can be inspected offline;
the viewers do not yet import JSON records. If manually restoring an anchor,
use its saved numeric coordinates and confirm it for the current frame.

Viewer collections are in memory: export before reload or diagnostic-view
switching. The root JSON data files (pixel samples, original band export and corrected
band copy) are saved on disk. The implementation, documentation and data are local worktree
changes, including untracked files; nothing was committed, pushed or opened as
a GitHub issue/PR during this experiment. Preserve these local files when cleaning
up. Reproducible/generated screenshots and pilot reports live in ignored
`frontend/test-results/` and may disappear if that directory is cleaned.

Latest implementation verification: 28 focused tests passed; 563 full-suite
passes, 25 previously documented recording/contact failures and one skip.
Band browser checks, standalone heatmap/sample regression, integrated clip-1
replay (288 frames), keyboard-layout smoke, lint/types/39 contrast checks and
production build passed. Deployment smoke timed out on the existing home-page
MediaPipe status; bundled Chromium audio could not launch. No physical detection
accuracy/latency or GitHub Actions pass is claimed. Details:
[band execution record](../tests/README.md#fingertip-shadow-band-measurement-2026-10-28).
No new code/tests were changed for the manual-label correction or this handoff.

## Current objective

Separate useful shadow evidence from finger occlusion, then test whether a
source-anchored local shadow profile changes reliably with contact. Pixel
filtering and manual band measurements are diagnostics; weak/missing evidence
must remain unknown. The latest review steps back from endpoint measurement to
compare local appearance for each non-thumb finger. Index/middle contraction
is promising visually; ring is less isolated and pinky onset remains unresolved.
Reference/baseline and endpoint behavior in the saved manual measurements remain
open if width measurements resume. Whole-image heatmaps do not segment the paper
itself.

## What has been done

| Item | Status | Result / limit |
| :--- | :--- | :--- |
| Strict dark-pixel experiments | Implemented | Adjustable background-relative darkening, absolute luma, RGB-channel and R−G bounds; pixel/probe overlays. Bounds are exploratory. |
| Finger-relative evidence | Implemented | Separate near/forward dark area, darkness strength, spatial sharpness, temporal changes and image-Y motion. Rectangles and landmark jitter can mix different surfaces. |
| Video finger inspector | Implemented | Selected-finger outline, magnified crop, metric cards and four charts aligned over the last 60 frames. |
| Standalone shadow heatmap | Implemented | `/cv-shadow-test` supports local images and paused video without MediaPipe, marker detection or a sidecar. |
| Heatmaps inside video replay | Implemented | `/cv-video-replay?manual=1` defaults to **Diagnostic view → Shadow heatmaps**, alongside the source video and existing frame controls. |
| Brightness multiplier and projection residual | Implemented locally | Four diagnostic maps, raw pixel readouts and adjustable color-shift versus `e_I` exclusion. Semantic separation remains unverified. |
| Labeled pixel / patch collection | Implemented locally | Source-image click or coordinate capture, human category/phase, raw patch pixels and both filter results, versioned JSON export. Actual study labels remain pending. |
| Source-anchored shadow-band measurement | Implemented locally | Manual tip/direction, bounded parallel ray profiles, per-ray width/unknown/censoring, confirmation per frame, JSON export. Numerical clip pilot is anchor-sensitive and not a press rule. |
| Color-cluster fingertip proposals | Implemented locally, offline pilot | Raw color clustering, distal silhouette peaks and automatic local shadow exports for 19 images plus background; merged/missed tips remain, no anatomical identities or contact decisions. |
| Static local shadow comparison | Implemented locally, offline pilot | 30 index/middle frames, curved mask-edge rays, four fixed intensity cutoffs, forward intensity and separate side/back context; mixed findings and retrospective source-review flags, no contact rule. |
| LAB / HSV comparison | Proposed | Not part of the current heatmap calculation. |
| Shadow grouping and finger association | Deferred | Establish useful pixel evidence first. |
| Press/release decisions from these heatmaps | Deferred | The heatmaps are diagnostic and do not dispatch notes. Existing experimental contact rules are documented separately in the image/video guides. |

### Current heatmap measurements

Let `B` be the empty reference pixel and `I` the current pixel at the same image
coordinate. Current luma is computed as:

```text
Y = 0.2126 R + 0.7152 G + 0.0722 B
signed darkening = Y_reference − Y_current
```

Only positive darkening contributes to the darkness map and summary. Brightening
is retained as a signed value in the standalone pixel inspector but is excluded
from displayed darkness. This differs from absolute subtraction, which makes
both brighter and darker changes look like positive differences.

The current color-change map compares normalized RGB channel proportions:

```text
p_c(I) = I_c / (I_R + I_G + I_B)
color shift = 255 × max_c |p_c(I) − p_c(B)|
```

This already tests whether brightness changes approximately preserve color.
Projection outputs are now shown separately alongside this baseline.
Current pixels with an RGB sum below 15 have unknown chromaticity. A reference
luma cutoff, default 40, excludes poorly observed dark reference pixels.

The palette runs from black through blue and yellow to red as the displayed
value increases. Gray means unavailable/ignored. Black means the value is below
the display floor, not proof of no shadow. Hot colors can represent finger
occlusion as well as shadow.

Display settings update immediately. Defaults are a 5-luma darkening noise
floor, 120-luma darkening full scale and 40-unit color-shift full scale. These
are visualization settings, not validated classifier thresholds. Scales stay
fixed across frames rather than normalizing each frame to its own maximum.

### Reference handling and video review

Both inputs must have the same native resolution and camera/paper position.
Analysis is downsampled with the longest edge capped at 640 pixels. Thin
contact shadows can be lost through this reduction.

The standalone viewer accepts an uploaded empty reference or an explicit
capture from a paused, empty video frame. It offers Previous/Next stepping,
FPS selection and pixel inspection. Steps use integer target indices; displayed
frame numbers are approximate decoder positions, not verified encoded-frame
identities. Maps clear during playback and update after pausing/seeking.

The integrated replay uses its existing complete-marker background capture.
Start the clip with hands out of view and all markers visible. Cached frames
record reference IDs; downsampled reference snapshots are shared separately so
revisiting a frame uses its original reference. The map calculation does not
use fingertips, although the replay still runs its existing CV evaluation.
Maps render while paused, outside contact-pipeline timing. Source overlays are
hidden in heatmap mode; **Finger measurements** restores the earlier inspector.

Implementation:

- [Shared heatmap math and palette](../frontend/src/cv/shadowHeatmap.ts).
- [Standalone viewer](../frontend/src/app/cv-shadow-test/page.tsx).
- [Integrated replay panel](../frontend/src/app/cv-video-replay/ReplayHeatmapPanel.tsx).
- [Earlier strict dark-pixel / band measurements](../frontend/src/cv/darkShadowRegion.ts).

## What the existing evidence says

The earlier strict-mask still-image measurements do not support a single static
press threshold. In 11 hover and 11 press targets:

| Measurement | Hover median | Press median | Limit |
| :--- | ---: | ---: | :--- |
| Near-band darkness strength | 0.00 | 0.20 | Often zero in both states. |
| Forward-band darkness strength | 4.26 | 1.63 | Lower press median, but overlapping ranges. |

These are per-band background-relative darkness values, not probabilities.
The samples are not paired continuous transitions. They do not establish that
an individual press causes darkness to fall. See the
[initial comparison](cv_image_tests.md#comparing-darkness-hypotheses-locally-2026-10-27).

Video inspection also exposed handedness changes, missing detections and
landmark jumps. Those undermine finger-relative temporal measurements, which
motivated the current independent pixel-level investigation.

The heatmaps qualitatively show that fingers can produce strong darkening and
substantial color change, while some surrounding darkened areas change color
less. This motivates a brightness–chromaticity comparison; it is not a measured
shadow-versus-skin classification result. There are no pixel-level ground-truth
shadow/skin labels yet. Existing hover/press labels cannot substitute for them.

### Verification completed locally

Projection follow-up (2026-10-27): 13 numerical cases passed, standalone browser
checks passed on the 19 saved images plus reference/video, and integrated clip 1
completed all 288 frames with projection readouts, exclusion controls and resume
clearing. Lint (three existing warnings), types, 39 contrast checks and production
build passed. Full Vitest: 548 passed, 25 failed, one skipped in the same documented
recording/contact groups. Keyboard-layout browser smoke passed; deployment
still timed out and bundled Chromium audio could not launch. Unlabelled central
image samples were saved; semantic separation remains unmeasured. See the
[projection execution record](../tests/README.md#brightnesschromaticity-projection-2026-10-27).

Earlier baseline verification:

- Five synthetic heatmap cases passed: signed subtraction and positive-only
  summaries; proportional dimming versus color change; ignored/transparent
  pixels and unknown near-black color; dimension mismatch/all-ignored input;
  fixed display scaling, noise floor and saturation.
- The standalone browser check passed on 19 labeled images plus reference
  self-comparison, video reference capture, stepping/return, decoded-source
  agreement, scale changes, mismatch clearing, pixel inspection and 390 px
  overflow checks. No hand/marker inference requests or page errors occurred.
- The integrated clip-1 replay completed 288 frames, covering inspector/view
  switching, heatmap rendering, scale adjustment, cached frame navigation,
  pause/resume behavior and mobile overflow. Screenshots were inspected.
- Lint, types, contrast and production build passed. Lint retains three existing
  image-element warnings. Full Vitest reported 540 passed, 25 failed and one
  skipped; the failures remain in existing recording/contact fixtures.
- Broader browser smoke results are mixed: keyboard-layout passed; deployment
  and Chrome audio checks timed out. Bundled Chromium was unavailable locally.
  No physical audio latency or live detection accuracy was verified.

Execution records and scope limits:
[standalone heatmap](../tests/README.md#finger-independent-shadow-heatmap-2026-10-27),
[integrated replay](../tests/README.md#integrated-replay-heatmaps-2026-10-27), and
[verification inventory](../tests/verification_test_inventory.md).
GitHub Actions evidence for the local changes remains pending.

## Brightness–chromaticity projection experiment

A plausible shadow may approximately multiply the reference RGB vector by a
single factor. A colored occluder may instead change the proportions between
channels. Proportional attenuation is the hypothesis; equal absolute decreases
are not required when the reference channels differ.

For background vector `B` and current vector `I`, compute:

\[
a = \frac{I \cdot B}{B \cdot B},
\qquad
r = I-aB,
\qquad
e_B = \frac{\|r\|}{\|B\|}.
\]

`a` is the least-squares scalar that best explains the current color as a scaled
background color. Values near 1 suggest little brightness change; values between
0 and 1 suggest attenuation. `e_B` is the unexplained color difference relative
to background strength. A small residual makes the pixel compatible with the
model; it does not establish that it is a shadow.

For the supplied example `B = (240, 240, 240)`:

| Current RGB | Multiplier `a` | Residual `e_B` | Model interpretation |
| :--- | ---: | ---: | :--- |
| (140, 140, 140) | 0.5833 | 0.0000 | Exact proportional darkening. |
| (180, 125, 100) | 0.5625 | 0.1392 | Similar attenuation, appreciable color mismatch. |

The general brightness/chromaticity separation has research precedent in
[Horprasert, Harwood and Davis](https://vast.uccs.edu/~tboult/frame/Horprasert/).
These equations are a simplified experiment, not a reproduction of that
paper's complete statistical background/noise model. The user-supplied Springer
quote has no specific source URL in the experiment record; its exact attribution
has not been independently verified.

### Also inspect residual relative to current brightness

As a colored pixel becomes very dark, `e_B` can shrink simply because its
absolute signal shrinks. Alongside it, inspect:

\[
e_I = \frac{\|I-aB\|}{\max(\|I\|,\epsilon)}.
\]

This reports mismatch relative to the current pixel. The denominator guard
prevents division by zero; it does not make near-black color measurements
reliable. Very dark references/current pixels should remain visibly unknown
when there is insufficient signal, rather than becoming confident shadow.

A provisional candidate could require sufficient darkening, small color
mismatch and adequate signal. No attenuation range, residual threshold or
confidence mapping has been selected or validated. A neutral dark object can
fit the model too. Mixed/colored illumination, exposure or white-balance changes
can make a real shadow violate it.

## LAB / HSV and the OpenCV article

The supplied [OpenCV shadow-correction article](https://opencv.org/shadow-correction-using-opencv/)
uses low LAB lightness and low HSV saturation to make a mask. It then smooths
that mask and applies Retinex-based correction/blending. Its mask does not use
our coordinate-matched reference. For this experiment, retain that reference
and inspect uncorrected measurements first.

Possible comparisons, not implemented:

- **LAB:** compare lightness loss and changes in the two color channels against
  the reference. Keep the names distinct from the RGB multiplier `a`.
- **HSV:** compare value reduction and saturation change. Hue is uninformative
  for neutral paper: the [OpenCV conversion equations](https://docs.opencv.org/4.12.0/de/d25/imgproc_color_conversions.html)
  define its neutral-color branch specially because the RGB channel spread is
  zero. Do not rely on hue alone in that region.

RGB projection is the first experimental baseline because it directly exploits the
saved background. Changing color spaces does not by itself solve occlusion.
Defer Retinex correction, large mask blurs, dilation and morphology while
inspecting thin shadow boundaries: they change the evidence being measured.
The camera RGB projection remains an empirical approximation; a later controlled
comparison can test encoded camera RGB against linearized sRGB. Camera processing
and illumination still limit the physical attenuation interpretation.

## User-labeled contact sequences inspected (2026-10-28)

Source: `tests/automation/CV Test Videos/cv_automation_test_1.mov`.
The following are the user's newer annotations in the standalone viewer's
approximate 30-FPS frame coordinates. They are not verified encoded-frame
identities. The older sidecar was not used as contact truth or modified.

| Finger / example | Hover / approach | Touch | Separation / hover again |
| :--- | :--- | :--- | :--- |
| Middle, first example | 110 / 111 | User marks 112; older sidecar says 114 | 118 / 120 |
| Index | 146 (4.867 s) / 147 | 148 | Already looks hovering at 153; more hover 154 |
| Middle, second example | 163 (5.433 s); no separate approach label | 165 | 171 / 172 |
| Ring | 179 (5.967 s); near touch 181 | Clearer, less blurred contact at 183; onset remains uncertain around 181–183 | Near release 186; fully released 187; hover 189 |
| Pinky | 197 (6.567 s) / 198 | 199 | 204 / clear release-hover 205 |

Local visual inspection covered every requested frame: 110–120 and an
additional 39 frames in 146–154, 163–172, 179–189 and 197–205. Fixed settings:
reference `images_test_cases/background.png`, reference-luma cutoff 40,
projection `e_I <= 0.12`, darkening floor 5 and full scale 120. Map resolution
was 640×427; source crops were extracted from native 1620×1080 video pixels.
No live contact code, thresholds or sidecar annotations were changed.

Qualitative observations, not measured classifier results:

- Index and both middle examples show a broader shadow beyond the tip before
  contact, a thin edge during labeled contact, and widening again on release.
- Ring shows a similar narrowing/widening tendency, but onset is blurred and
  nearby finger shadows overlap. Retain the user's timing uncertainty.
- Pinky has much weaker retained shadow, including in the initial hover.
  Thin retained edges during contact and change around release are visible,
  but little displayed shadow cannot by itself indicate contact.
- The relevant feature appears local to the distal fingertip boundary rather
  than the whole hand's retained dark area. Filtered black regions are not
  validated skin boundaries. A changing exclusion mask could affect apparent
  thickness, so compare measurements with the source boundary and raw pixels.

This motivates measuring local shadow-band extent relative to an independently
identified source fingertip boundary, with explicit unavailable/weak-evidence
states. It does not select a press threshold or establish reliable separation
from near-touch hovering, cross-clip accuracy, or event latency. All examples
come from one recording and illumination setup.

Ignored comparison artifacts are under `frontend/test-results/shadow-sequence/`:
first-example `contact.png`, `held.png`, `release.png`; additional examples in
`fingers/`, with `overview.png`, per-finger `*-contact.png` / `*-release.png`,
and `sequence.json` containing user annotations, settings and frame images.

## Per-finger local appearance review (2026-10-28)

User-requested exploratory review of index, middle, ring and pinky; thumb is
excluded. This reuses the saved source/projection comparison sheets rather than
collecting new labels, rerunning inference or changing a filter. Inspected all
50 displayed frames: middle 110–120 and the 39 frames in the four later sequences.
The user annotations above remain the phase reference, including uncertain ring
onset. Contact/release filenames split the comparison sheets for display; they
do not label every frame in each sheet as contact or release.

Conditions: same clip/reference as above, projection exclusion `e_I <= 0.12`,
5-luma floor, reference cutoff 40 and fixed darkening full scale 120 for the
later four sequences. Source crops retain native video detail; the projection
maps originate at 640×427 and enlargement adds no detail. These are projection
comparisons, distinct from the three manually anchored **color** band records.
Black in a filtered map is not a validated finger outline or proof of no shadow.

### Index — frames 146–154

- **Hover/approach (146–147):** a substantial retained lobe lies beyond the
  source fingertip, toward the bottom/right of the image. It becomes smaller
  as the tip descends. There is no clearly isolated bright-paper gap to track.
- **Touch interval (148–152):** the forward lobe reduces to a thin retained
  rim near the distal tip. Strong retained regions remain alongside the finger;
  the surrounding shadow does not disappear as a whole. The source crop also
  shows less exposed shadow immediately beyond the tip.
- **Release (153–154):** the forward lobe is visible again and expands while
  the source tip lifts. This reverses the approach change in this example.
- **Interpretation:** local contraction/re-expansion is a better visual
  description than complete disappearance. The thin rim looks more concentrated,
  but edge sharpness was not measured. Side regions would contaminate a large
  circular neighborhood or whole-component area measurement.

Evidence: ignored `frontend/test-results/shadow-sequence/fingers/`
`index-contact.png` and `index-release.png`.

### Middle — two examples, frames 110–120 and 163–172

- **First hover/approach (110–111):** a broad retained forward lobe becomes
  much thinner during approach, already by 111. Some contraction therefore
  precedes the user's touch label at 112; contraction alone cannot specify onset.
- **First touch/held interval (112–117):** a thin distal rim persists, with
  substantial retained darkening along the side. The visible forward region
  stays small rather than the complete local shadow vanishing.
- **First release (118–120):** the forward region begins broadening and is
  clearly larger at 120 as the source tip lifts.
- **Second example:** a broad forward/right lobe at 163–164 becomes a thin
  distal rim at 165–170, then broadens at 171–172. Side shadow remains strong
  through touch, so total nearby darkness would mix different behaviors.
- **Interpretation:** both examples support inspecting directional local
  contraction/re-expansion. They do not show an unambiguous disappearance or
  a measured sharpening cue, nor distinguish all near-touch hover from touch.

Evidence: ignored `frontend/test-results/shadow-sequence/` `contact.png`,
`held.png`, `release.png`; `fingers/middle-contact.png` and `middle-release.png`.

### Ring — frames 179–189

- **Hover (179–180):** retained evidence beyond the target tip is weaker and
  less isolated than in the index/middle examples. A neighboring finger's
  broad shadow occupies the adjacent area.
- **Uncertain onset (181–182):** source motion blur and a retained crescent
  around the distal/right edge make the transition difficult to localize.
  Do not relabel these frames as definite contact from the map.
- **Clearer touch (183–185):** the distal retained rim is thinner, while the
  side/inter-finger retained region remains. The local pattern changes without
  all surrounding shadow disappearing.
- **Release (186–189):** the rim becomes broader around 186–187; a broader
  forward/side region is clear by 189. This is consistent with reopening, but
  neighboring shadow prevents clean ownership claims.
- **Interpretation:** contraction/re-expansion is plausible but less clean.
  This example cautions against measuring all connected shadow or assuming a
  fixed downward scan follows the relevant boundary. Sharpness and precise
  onset remain unresolved.

Evidence: ignored `frontend/test-results/shadow-sequence/fingers/`
`ring-contact.png` and `ring-release.png`.

### Pinky — frames 197–205

- **Hover (197):** little retained forward shadow is visible near the target
  tip already. A rule equating absent shadow with contact would have little
  basis for rejecting this labeled hover frame.
- **Approach (198):** the source tip is motion-blurred and a small blue/yellow
  retained region appears near the tip/inter-finger space. This does not form
  the same clean broad-to-thin progression seen for index/middle.
- **Touch interval (199–203):** a narrow, weak distal rim remains, including
  blue evidence and small yellow portions. The adjacent finger and stronger
  shadow farther right must not be counted as the pinky's independent signal.
- **Release (204–205):** the local region broadens at 204, but its appearance
  changes again at 205 as multiple fingers move. The nearby broader blue region
  is not a clean, independently isolated pinky lobe.
- **Interpretation:** evidence is weakest here. Some change around release is
  visible, but neither disappearance nor the index/middle contraction pattern
  is established as a usable pinky onset cue. Keep weak hover evidence unknown;
  this clip cannot establish that a different pinky rule is inherently required.

Evidence: ignored `frontend/test-results/shadow-sequence/fingers/`
`pinky-contact.png` and `pinky-release.png`.

### What this comparison supports next

| Hypothesis | Observation | Remaining question |
| :--- | :--- | :--- |
| Local contraction/re-expansion | Clearest for index and both middle examples; ring is mixed; pinky onset is weak. | Does a source-boundary-relative measurement distinguish near-touch hover, rather than merely high hover? |
| Complete disappearance/reappearance | Thin retained rims and side shadows persist at touch; pinky has little forward evidence even during hover. | Not supported here as a universal binary rule. |
| Sharpening | A thinner, more concentrated rim is visually apparent in several examples. | No edge-slope/blur measurement separates physical sharpening from filtering, occlusion and downsampling. |
| Touching any shadow in the image | Nearby/side shadow can remain during both hover and touch. | Overlap alone supplies no contact evidence. Explicit caster ownership may be avoidable, but local interference still matters. |

The most useful candidate is the **change in exposed shadow immediately beyond
the source fingertip**, with the side regions considered separately. Before
implementing a detector, investigate whether that change can be measured through
near-touch approach and release with a source boundary independent of the
filtered mask. A whole-shadow centroid, whole connected component or total local
darkness would mix persistent side/neighbor evidence with the shrinking distal
region. Neither a fixed direction nor a universal per-finger threshold follows
from this review.

Pinky remains an explicit unresolved case rather than a pass inferred from the
other fingers. No new frames, labels, test implementation, live contact/audio
behavior or physical accuracy/latency result were produced. This is a visual
comparison from one clip/lighting setup, not held-out verification. Saved maps
cannot determine whether a disappearing region was hidden by the finger,
fell below the floor, or failed exclusion. Existing band censoring/baseline and
native-resolution concerns remain relevant to any later quantitative work.

## Shadow-band measurement pilot (2026-10-28)

A paused measurement panel is now available in both heatmap views; see
[placement, width definition and unavailable states](cv_shadow_heatmap.md#measure-the-fingertip-shadow-band).
A majority of complete rays is required for a median; missing shadows do not
become zero-width contact evidence. All ray profiles and status/lower bounds
can be saved separately from pixel/patch samples.

An exploratory run covered the 39 newer sequence frames with fixed projection
`e_I <= 0.12`, darkening floor 5, scan length 24, five downward parallel rays
(offsets −2…2), and the saved background. This numerical pilot used **provisional
source-luma gradient anchor proposals** in constrained per-finger columns/ranges,
not manually confirmed tip locations and not the filtered black mask. Overlay
inspection found that some proposals follow a shadow or side edge rather than
the distal source tip, especially during release. Their widths cannot validate
contact behavior. A ±2-analysis-pixel vertical anchor perturbation was recorded.

| Finger | Frames inspected | Frames with a complete aggregate width under provisional anchors |
| :--- | ---: | ---: |
| Index | 9 | 5 |
| Middle (second example) | 10 | 0 |
| Ring | 11 | 4 |
| Pinky | 9 | 2 |

These are **measurement availability counts, not detection scores**. Index
148–152 gave one-analysis-pixel widths at the proposed anchor, often becoming
unavailable after a one-pixel shift. Middle rays commonly reached the scan limit:
reference-relative darkening on the sampled visible paper remained above the
5-luma floor. This can reflect diffuse/neighboring shadow, illumination/reference
changes, or geometry, and is not proof of a thick contact shadow. Ring/pinky
measurements were incomplete and sensitive to origin placement. A global width
threshold is not supported by this run.

Follow-up: the user has now supplied manual index anchors at 146/148/153;
see the current handoff at the top. Inspect those raw profiles and the local
unshadowed-paper baseline, then compare anchor perturbations and resolution effects. Any floor/reference adjustment is
an experimental setting to hold fixed through a repeat sequence, not an inferred
press threshold. Preserve unavailable states and evaluate new clips separately.

Ignored evidence: `frontend/test-results/shadow-band/sequence-measurements.json`,
`sequence-summary.csv`, `source-anchors.png`. The source-anchor overlay is a
review aid and exposes the provisional-anchor errors; it is not ground truth.
The earlier first-middle example remains a visual comparison, not part of this
39-frame numerical pilot. Sidecars and live contact behavior remain unchanged.

## Next steps, in order

**Latest session priority:** review the bounded directional DFS at the top.
The user now explicitly requires any downward-limit witness to veto the finger;
one upward path supports only when that global veto is absent. Review index
148 side interference and middle 111/119 passes before tuning c or width.
Keep motion excluded and pinky/overlap work deferred per the user.
See **Concrete next work** and the per-image gallery above. The list below
retains the broader experiment roadmap, not an instruction to repeat completed
work or bypass the user's hypothesis.

1. **Diagnostic projection outputs added locally.** Implemented `a`, `1-a`, `e_B` and `e_I`
   beside the existing maps, using the same reference and frame, with raw
   values and unknown states preserved. Synthetic tests cover proportional dimming,
   colored occluders, unchanged/brighter pixels, black/low-signal pixels,
   invalid references and both exclusion methods. See the updated inventory.
2. **Inspect before classifying.** Use the pixel inspector on visible paper,
   soft shadow, darkest shadow, skin, nail, printed ink and boundaries. Record
   the exact frame, reference, sampled coordinate and measurements. Compare
   with the existing normalized-RGB map to determine whether projection adds
   useful separation.
3. **Label pixel/patch examples.** The viewer now supports source-image click
   capture and JSON export with an ambiguous category. Collect human-reviewed
   examples rather than
   forcing every dark patch into shadow or skin. Sample multiple fingers,
   positions, shadow strengths and lighting setups. Keep frames from a clip
   together when separating tuning and evaluation sets.
4. **Tune on one set and evaluate on held-out clips.** Plot attenuation against
   residual, record candidate thresholds and compare shadow retention, skin
   leakage, false shadow on paper/ink and the unknown fraction. Include weak
   shadows and neutral/dark occluders. Do not tune from the two RGB examples.
5. **Compare LAB/HSV only if the RGB baseline leaves a clear failure.** Run
   alternatives on the same labeled pixels and frames. Measure both their
   separation and computational cost; retain the simpler method if extra work
   does not improve held-out results.
6. **Check temporal stability and cost.** Record exposure changes, reference
   replacement, camera movement, flicker and behavior at native versus sampled
   resolution. Measure processing distributions and frame behavior before
   moving paused diagnostics into a live path. Keep pending work bounded.
7. **Revisit geometry and contact later.** Once pixel evidence is useful, assess
   whether grouping or a curved fingertip-relative band adds value. Only then
   return to press/hold/release inference, with stable identities, labeled
   transitions and separate accuracy/latency measurements.

The maps, sample collection and band diagnostic are implemented. The latest
per-finger review above favors examining local distal contraction through
near-touch hover and release, with pinky kept unresolved. The saved manual-band
endpoint/baseline investigation remains open. Reliable finger removal, region
ownership, press thresholds and live note decisions remain unestablished.

## Resume the experiment

For standalone images/video, start the frontend and open `/cv-shadow-test`.
For the integrated frame-by-frame replay:

```sh
cd frontend
CV_HEADFUL=1 CV_MANUAL_STEP=1 npm run test:cv-video:auto -- --clip 1
```

Select **Shadow heatmaps**, pause, and use Previous/Next. Start with an empty
sheet so the replay can capture a useful reference. The projection maps and adjustable color-exclusion comparison are now available
below the existing luma darkening and normalized RGB color-change maps.
Resume with the saved user measurements and the handoff at the top of this
document. Do not restart pixel/patch collection or choose a press threshold yet.

Related guides: [heatmap usage](cv_shadow_heatmap.md),
[image cases](cv_image_tests.md), [video replay](cv_video_tests.md), and
[earlier hypotheses/history](cv_shadow_experiments.md).
