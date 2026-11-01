# MakeShift Testing

## Plateau and local lobe correction (2026-11-01)

Final review: the user said the replacement images look good and requested a
handoff. This is qualitative feedback, not measured accuracy. Resume from the
[user-reviewed handoff](../docs/cv_shadow_detection_status_and_next_steps.md#start-here-user-reviewed-handoff-2026-11-01).
The review/handoff update changes documentation only and runs no new tests.

User-authorized correction and replacement of the50 candidate PNGs. Command:
`cd frontend && npm run experiment:fingertips-filtered`. Shared extraction now
checks both outer neighbors of a complete plateau and skips rejected plateaus.
Filtered mode additionally uses raw-valley prominence>=2 for every input and
valley-bounded width at tip-minus8;legacy prominence remains4. No mask cropping,
new suppression radius,per-finger gates or DFS changes. Raw mask remains the
same as the filtered-darkening boundary utility.

`fingertip-filtered/pre-lobe-results.json` retains old50 records/364 proposals;
new results and `changes.json` record its hash. `changes.html` reports all50
old/new counts and coordinates in seven post-detection review regions. These
rectangles never enter the detector. Source hashes are asserted. Total364→351
(still139→140,sequence225→211),background zero. Counts are not correctness.
Allsix middle111–116 missing index regions now contain one proposal;the189
pinky review region changes two→one. Ten cards visually reviewed:seven reported
examples plus index148,pinky199,ring184;40 others not individually reviewed.
Spurious clothing and inner-gap proposals remain. Merged mask contact can stay
UNKNOWN despite successful localization;no automatic29/29 contact claim.

Verification:19 candidate cases and80 focused cases passed,including four new
regressions:whole-plateau shoulders,a touching shorter lobe with two-pixel raw
valley/local width,less-than-two prominence rejection,and distinct14px-separated
tips preserved. Eight legacy candidate cases remain passing. Full Vitest:
621 passed,25 known recording/velocity/synchronous-contact fixture failures,
one skipped. Lint passed with three existing image warnings;TypeScript,39
contrast checks and the network-enabled production build passed.
Logs are retained with the ignored gallery. No live/browser camera-audio smoke
rerun for this offline change;CI unchanged and Actions evidence pending. See
[handoff](../docs/cv_shadow_detection_status_and_next_steps.md#resume-here-plateaulobe-correction-and-replacement-images-2026-11-01).

## Close-finger candidate trace (2026-11-01)

Diagnostic-only follow-up to user review;no source classifier/test change.
Traced middle-first111–116 plus hover_right-index000189-6300. Index pixels exist
but prominence1–3 fails minimum4;in112–116 width50–51 exceeds maximum44 because
the tip-minus8 row spans its neighbor. Pinky double count exposes plateau-edge
validation before complete plateau grouping: a shoulder suppresses the real
peak,and a second shoulder14px away survives the13.6px duplicate distance.
Seven source hashes and final proposal lists match the current gallery.
Ignored `fingertip-trace/results.json` contains raw/smoothed outlines and all
peak measurements;`findings.md` records exact coordinates/reasons. No thresholds,
DFS behavior or canonical gallery images changed. No new unit/build/CI or
physical accuracy claim. See the
[diagnostic handoff](../docs/cv_shadow_detection_status_and_next_steps.md#current-investigation-missing-close-index-and-duplicate-pinky-2026-11-01).

## Automatic filtered-boundary fingertips (2026-11-01)

User-requested automatic fingertip proposals, adapting the existing color-cluster
pilot to the filtered mask used by DFS. `identifyFilteredFingertips` consumes only
reference-relative measurements,with no saved anchor,width,anatomical identity,
per-finger gate or phase. Shared component/silhouette extraction preserves the
legacy color-cluster API. The pure filtered-mask helper moved to `shadowHeatmap`
with its existing `shadowTipEvidence` re-export preserved. Downward-facing fingers
remain assumed;no tracking or live detector changes.

Run from frontend:`npm run experiment:fingertips-filtered`.
The existing exporter now supports `--filtered-boundary --sequence`,writing a
separate ignored `fingertip-filtered` gallery:20 stills including background plus
30 saved native sequence frames,50 PNGs,overview,JSON and per-candidate tables.
Every proposal runs locality4 DFS at all cutoffs. Source/reference hashes are
verified;cached phase/group/review labels remain display metadata. No replay seek
or target selection is performed. Background produces zero candidates;139 still
and225 sequence proposals,364 total. Counts do not establish correctness.

Four final cards inspected:index148,first-middle119,second-middle164,pinky199;
46 others not individually reviewed. Fingers are proposed alongside spurious
clothing/background and curled/merged-region shapes. Keyboard eligibility and
contact tracking remain integration work. No held-out dataset,physical accuracy/
latency or transfer of the previous fixed-anchor29/29 result is claimed.

Verification:15 fingertip cases passed (eight preserved legacy cases plus seven
new filtered-mask cases);76 focused cases passed. New cases cover non-reddish
filter-rejected tips without anchors,three connected anonymous lobes,background/
neutral/speckle/broad/clipped rejection,exact DFS-mask equivalence with side
shadow excluded,invalid/low-signal exclusions,determinism/input preservation and
both filters,invalid arrays/bounded settings. Lint passed (three existing image
warnings),types,39 contrast checks and network-enabled production build passed.
Full Vitest:616 passed,26 failed,one skipped;25 documented recording/velocity/
synchronous-contact fixture failures plus a384kHz audio timeout during concurrent
export/checks. Isolated audio rerun passed all72. Production camera/audio browser
smoke not rerun for the offline helper/exporter. CI workflow unchanged;Actions
evidence pending. Logs are preserved with the ignored gallery. See
[handoff](../docs/cv_shadow_detection_status_and_next_steps.md#resume-here-automatic-filtered-boundary-fingertip-proposals-2026-11-01).

## Curved boundary DFS comparison (2026-11-01)

User-requested offline locality experiment, removal of D80, replacement of30
canonical PNGs and comparison with original/D80 results. Run from frontend:
`npm run experiment:shadow-dfs` (`--dfs --local-corridor`). Corridor: exterior
Chebyshev band4 around the selected lower/side arc, PLUS straight-down extension
from its lowest pixels to the saved d row within the same lateral margin. Both
searches use that corridor and the old per-seed width cap; lateral stops are
normal. Shared cutoffs5/20/40/60, fixed filtered geometry/tips/widths/c=d=e=4.
Native/reference hashes remain asserted. No motion, sweep or live integration.

The initial band wrongly capped forward depth, falsely accepting index146/147;
a temporary unreachable-row UNKNOWN guard still hid the intended traversal.
The user challenged it; both were superseded by actual forward extension with
unchanged saved anchors. Final index146/147 reject at all cutoffs and have
actual40-luma witnesses at(312,176)/(315,191). Geometry reachability metadata
is diagnostic only. UNKNOWN remains reserved for actual missing measurements/
incomplete geometry, not an artificial forward cap.

`previous-results.json` preserves original decisions/paths; `d80-results.json`
preserves D80. Both snapshots are hash-checked/reused on repeats. `changes.html`,
CSV and JSON compare all120 original/D80/new decisions and phase agreement.
Assertions verified30 PNGs,120 comparisons,matching cutoffs,no D80 and every
visited pixel within the exported corridor. New PNGs show its boundary in purple.

Against approximate user phases, new pass/fail/unknown counts at5/20/40/60:
12/17/0,29/0/0,29/0/0,26/3/0 (one wrong-target excluded at each setting).
At40,original23/6/0 and D80 24/5/0 become29/0/0. All17 labeled touches and12
valid non-touch phases agree at20/40. Middle119 rejects for missing upward
support rather than a downward veto. At60 second-middle166–168 lose support.
These are selected same-clip agreements, not validated physical accuracy or
held-out evidence. No cutoff chosen as a live detector.

Four corrected final cards reviewed:index146/147/151,first-middle119;26 other
final cards not individually reviewed. Earlier locality export reviews remain
historical. Verification:39 evidence cases /69 focused cases passed. Five
locality cases cover side-excursion stops without unknown,inclusive d-row
without D80,curved exterior geometry,in-band unknown/invalid radii,and a real
straight-down veto despite saved-tip/boundary offset. Lint passed with three
existing image warnings; TypeScript,39 contrast checks and the network-enabled
production build passed. Final full Vitest:610 passed,25 failed,one skipped;
failures remain in the documented recording/velocity/synchronous-contact groups. Production camera/audio browser smoke not rerun for this offline helper;
CI workflow unchanged and Actions evidence pending. Logs are retained with the
ignored gallery. See the
[handoff](../docs/cv_shadow_detection_status_and_next_steps.md#resume-here-lateral-locality-with-forward-reach-d80-removed-2026-11-01).

## Stronger downward DFS comparison (2026-11-01)

User-requested local rerun replacing all30 canonical `shadow-dfs` PNGs and
retaining old/new pass/fail. `cd frontend && npm run experiment:shadow-dfs` now
runs `--dfs --strong-downward`: filtered boundary, downward darkening strictly
>80 at seeds AND every traversal pixel; upward thresholds remain5/20/40/60.
Saved anchors, widths, c/d/e and color filters stay fixed. No sweep/live changes.
`previous-results.json` retains original DFS decisions/paths; repeated exports
reuse that baseline. `changes.html`, `changes.csv` and `changes.json` contain
per-frame old/new decisions, phase agreement and aggregate counts. Native source
and reference hashes are asserted before exporting. Other galleries/caches stay.

Against approximate user phases, old pass/fail counts at upward5/20/40/60 were
12/17,24/5,23/6,22/7; new counts are24/5 at every setting. Zero unknowns;
wrong-target first-middle120 is excluded. Index148–150 improve,151/152 still
reject. New false presses at upward40: first-middle111 and second-middle164;
first-middle119 remains a false press. Index hover/approach/release still rejects.
The earlier filtered-boundary run matched all original primary decisions.
These are same-clip exploratory agreements, not validated physical accuracy.

Verification:34 tip-evidence cases /64 focused cases passed. Three new cases
cover independent downward strength with unchanged upward paths, strong seeds/
strict per-step cutoff (including equality), retained unknowns and invalid
thresholds. Full Vitest:605 passed,25 failed,one skipped; same documented
recording/velocity/synchronous-contact fixture groups. Lint passed with three
existing image warnings; types,39 contrast checks and the network-enabled
production build passed. The initial npm-command rerun could not launch Chrome
inside the sandbox; an escalated rerun was used.
Production camera/audio smoke not rerun for this offline-only helper/exporter;
no Actions execution claim. Nine cards inspected: index147–152, first-middle
111/119, second-middle164;21 others not individually reviewed. Logs are retained
with the ignored gallery.

## Filtered fingertip boundary comparison (2026-11-01)

Local offline comparison authorized by the user; no live detector behavior or
GitHub workflow changes. Run from root:
`node tests/frontend/shadowDirectional.experiment.mjs --dfs --filtered-boundary`.
The original DFS gallery is preserved; output is ignored under
`frontend/test-results/shadow-dfs-filtered-boundary/`, including `comparison.html`
for paired index148–152 cards, all30 PNGs, HTML, CSV and full path JSON.

Geometry comes from valid darkening >5 rejected by the projection color filter
(residual >0.12), or shift >10 for the secondary color-filter comparison. This
excludes invalid/clear black pixels and uses no clustering/morphology. Saved
anchors/widths, c=d=e=4 and DFS semantics remain fixed. Native source/reference
hashes are verified. At148/149 the a-row cross-section loses its left flare
(x300–327 becomes308–326), but side paths still veto all five index touches.
All120 primary decisions are unchanged versus the original export; the known
middle counterexamples remain. Seven cards inspected: index148–152 and
middle119/171; 23 others exported without individual review. Same clip and
approximate phases; no held-out/physical accuracy or latency claim.

Verification: 31 tip-evidence cases /61 focused cases passed. Three new cases
cover clear/shadow/invalid black exclusions, raw filter predicates and strict
floor, and neutral side-flare removal with unchanged tip/settings. Full Vitest:
602 passed, 25 failed, one skipped; failures remain in the documented recording,
velocity and synchronous-contact fixture groups. Lint passed with three existing
image warnings; TypeScript, all39 contrast checks and the production build passed.
The sandbox build failed fetching Google Fonts; the network-enabled retry passed.
Full-suite and build logs are preserved with the ignored comparison gallery.
Production camera/audio browser smoke was not rerun: the helper is used only
by the offline exporter/tests. No Actions execution claim. See
[definitions and findings](../docs/cv_shadow_detection_status_and_next_steps.md#filtered-fingertip-boundary-comparison-2026-11-01).

## Bounded directional DFS experiment (2026-10-31)

End-of-session review: the user reported that the DFS images appear to work well
with significantly fewer false positives and requested a handoff. This is a
qualitative user assessment, not a measured comparative false-positive rate.
The known false-positive and rejected-touch examples below remain unresolved.
Resume from the [current handoff](../docs/cv_shadow_detection_status_and_next_steps.md#end-of-session-handoff--user-review-2026-10-31);
no new code or tests were changed for this review/handoff.

Local-only implementation of the user's algorithm at the bottom of `thoughts.txt`
and subsequent clarifications: any downward path reaching d below the fingertip
vetoes the finger, while at least one upward path from an actual attached shadow
supports it. Run from `frontend/`: `npm run experiment:shadow-dfs` (existing
exporter with `--dfs`). Previous experiment outputs are preserved.

Fixed settings: c=d=e=4 analysis pixels; a=tipY−c; downward rejection at y≥tipY+d;
upward support at y≤a−e. Arc includes the lower outline and both side envelopes
below a. Per-attachment horizontal budget is one saved estimated finger width,
centered on that seed, shared between its down/up searches. DFS allows sideways
steps, but down cannot climb and up cannot descend. A width-cap boundary or known
color-filter exclusion stops normally; actual unavailable measurements and
incomplete geometry remain unknown. No whole-component endpoint requirement,
prior upward-width minimum, motion or live notes. All four fixed darkening
cutoffs 5/20/40/60 and both exclusion methods are exported. Same 640×427 analysis,
reference cutoff40, projection residual≤0.12 / color shift≤10 as before.

Final macOS / Node24.2.0 / Chrome156.0.8078.75 export completed all 30 frames,
verifying native source/reference hashes and reusing saved anchors. Masks are
recomputed; first-middle116 recomputed X383 differs from saved384. Current JSON
records the difference, and earlier reconstruction variation remains a limit.
Wrong-target first-middle120 is retained/marked INVALID TARGET and excluded
from interpretation. Approximate user viewer labels are not verified physical
or encoded-frame truth; no held-out accuracy or latency claim.

Among 29 target-valid frames, PRESS/NO PRESS/UNKNOWN counts are 0/29/0 at5,
12/17/0 at20, 13/16/0 at40, 14/15/0 at60. Both middle touch intervals pass at
20/40/60, but index touch148–152 is rejected at every cutoff by side-shadow
paths. Middle separation119 passes at40/60; near-touch111 passes at60. These
counterexamples remain visible. Second-middle released171 is rejected by the
new global veto. No constant/threshold sweep or phase-dependent tuning.

Ignored gallery: `frontend/test-results/shadow-dfs/index.html`, CSV, JSON and
30 PNGs. Banners show per-cutoff PRESS/NO PRESS/UNKNOWN; paths show the labeled
first matching cutoff, otherwise40, for visualization only. Blue=arc,
purple=attachments/a row, red=down/rejection, green=up/support; dashed width
bounds show rejection witness, otherwise upward/first search. Visited pixels,
per-seed bounds, actual paths/endpoints and unknown flags are exported. Six final
cards inspected: index148, first-middle112/119, second-middle164/165/171; other
24 exported without individual review. See [definitions and findings](../docs/cv_shadow_detection_status_and_next_steps.md#resume-here-bounded-directional-dfs-2026-10-31).

Verification: **28** tip-evidence cases passed (eight new DFS cases); **58**
focused heatmap/band/fingertip/evidence cases passed. Coverage includes real
attached evidence versus clear paper; upward path support; later-attachment
global veto; exact d-row rejection; no backward vertical traversal; lateral
budget without UNKNOWN; c-based side-arc selection; unavailable versus known
filter exclusions; all cutoffs, invalid settings and missing geometry. A first
contour draft omitted side edges; its new synthetic c-case caught this, and the
arc was corrected before the final passing tests/export.

Full Vitest: **598 passed, 26 failed, one skipped**, retaining 25 documented
recording-canvas/velocity/synchronous-contact fixture failures plus one 384kHz
ADSR case timing out at five seconds during concurrent export/checks. Isolated
browserAudio rerun passed all **72**. Lint passed with three existing image
warnings; TypeScript, all 39 contrast checks and the network-enabled production
build passed (existing Google Fonts require network).
No live pages import the helper; camera/audio production browser smoke was not
rerun for this offline experiment. Actions evidence pending; exporter remains
local-only and CI workflow is unchanged.


## At-least-one edge-shadow region experiment (2026-10-31)

Local-only user-requested change: require **at least one** edge-attached shadow
with limited downward extent and upward width; do not require all rays or let
unrelated long shadows veto a candidate. Run from `frontend/`:
`npm run experiment:shadow-edge-regions` (existing exporter with `--edge-regions`).
Prior strict-fan export and static comparison remain preserved.

Final Chrome export completed all 30 saved index/middle frames on macOS / Node
24.2.0 / Chrome 156.0.8078.75, without an app server. Source/reference hashes
matched; saved anchors remain fixed. Masks are recomputed with unchanged defaults;
current recomputed tips match the saved tips. Earlier reconstruction variation
remains a reproducibility limit. No motion, live notes, sidecars, new dependency,
GitHub changes, held-out verification or physical accuracy/latency claim.

Eight-connected compatible shadow components must touch the distal estimated
mask edge, measured in a bounded tip neighborhood (±24 rows, half-width+8
laterally). Each qualifying component has downward Y extent ≤8 pixels and
contiguous upward width ≥2 pixels on ≥3 rows in the same component's visible
side strips. The width/row settings are initial defaults, not validated contact
thresholds. Unknown/excluded endpoints and cropped side/bottom components cannot
establish a short extent. Any qualifying region wins over other rejected/unknown
regions. All four darkening cutoffs 5/20/40/60 are exported; none chosen as a
classifier. Reference cutoff 40; projection residual ≤0.12 primary, color shift
≤10 secondary. Seed/candidate pixels, endpoints, width rows and unknown flags
are exported. Missing shadow cannot become a positive candidate.

Ignoring wrong-target first-middle 120, final PRESS/NO PRESS/UNKNOWN counts
are 0/7/22 at 5, 0/5/24 at 20, 0/2/27 at 40 and 3/2/24 at 60. The three matches
are index 148/149 and second-middle 171; the latter is user-labeled **released**,
so the rule does not validate contact. Many unknowns reach a lateral boundary
or meet excluded pixels. Preserve the counterexample and uncertainty.

Ignored gallery: `frontend/test-results/shadow-edge-regions/index.html`, CSV,
JSON and 30 PNGs with per-cutoff PRESS / NO PRESS / UNKNOWN banners; wrong-target
shows INVALID TARGET. Component overlay displays first matching cutoff if any,
otherwise 40, for visualization only. Purple qualifies, red is other seeded
shadow, blue is edge/seed evidence, green is upward strip. Five final cards
inspected: index 147/148, first-middle 112, second-middle 164/171. Other 25 cards
exported without individual review. See [full rule and findings](../docs/cv_shadow_detection_status_and_next_steps.md#resume-here-at-least-one-qualifying-edge-shadow-region-2026-10-31).

Verification: **20** tip-evidence synthetic cases passed, including seven new
connected-region cases; **50** focused heatmap/band/fingertip/evidence cases
passed. New cases cover unrelated long-shadow non-veto, attached evidence versus
clear paper, inclusive eight versus nine downward pixels, same-component upward
width, unknown endpoint versus another valid region, a shared long component
and censoring, all four intensity cutoffs, invalid inputs and missing boundaries.
Full Vitest: **591 passed, 25 failed, one skipped**, retaining the previously
documented 23 recording-canvas and single velocity/synchronous-contact fixture
failures. Lint passed with three existing image warnings; TypeScript and all 39
contrast checks passed. Network-enabled production build passed (existing
Google Fonts require network). No live page imports the new
helper; production camera/audio browser smoke was not rerun. New Vitest Actions
evidence pending; exploratory exporter is local only, no workflow change.


## Directional shadow-pattern experiment (2026-10-31)

Local-only continuation of the user hypothesis: upward shadow present, thin
fingertip rim, clear downward region. Run from `frontend/`:
`npm run experiment:shadow-directional`. Requires the prior ignored
`shadow-hypothesis/results.json`, saved first-middle native PNGs, original
reference and later full-frame sequence cache. Installed Chrome is the default;
no app server, model, new dependency or live-note change.

Export completed all 30 frames on macOS / Node 24.2.0 / Chrome 156.0.8078.75.
Native source/reference SHA-256 checks passed. Saved tips are fixed; masks are
recomputed, not frozen from the earlier export. Initial-run candidates shifted
one X pixel at first-middle 116 and second-middle 170. The PNG-label rerun
reproduces saved tips on all 30 frames, but intermediate profiles at index 149
and first-middle 116 differ; all pattern decisions/counts are unchanged. JSON
records current recomputed candidates. The cause is unestablished. The old wrong-target first-middle 120 remains visible
and excluded from target interpretation. Old directional-limit flags describe
the previous central strip.

Fixed settings: 640×427 analysis, reference cutoff 40, projection residual ≤0.12
primary, color-shift ≤10 secondary; seven directions −60..+60° at 20° intervals,
24-step scan, −8/+6 local boundary search, two-step rim allowance, three-step
attachment window; all four luma cutoffs 5/20/40/60 reported. Upward context uses
six-pixel visible side strips over up to 24 rows, excluding two tip rows;
positive evidence needs three distinct strong rows. Missing/occluded forward
samples cannot establish absence. Sparse rays, side interference, unvalidated
mask edges and approximate contact labels remain limits.

No strict full-fan matches: among 29 target-valid rows, rejects/unknowns are
29/0 at 5, 29/0 at 20, 26/3 at 40 and 20/9 at 60. At 40, upward evidence is
present in all 29. Diagonal scans recover second-middle's missed lobe, but outer
rays also include persistent side shadow at labeled touch. This does not
establish a contact rule. See [definitions, findings and next work](../docs/cv_shadow_detection_status_and_next_steps.md#latest-continuation-upward-shadow--thin-rim--clear-forward-region-2026-10-31).

Ignored output: `frontend/test-results/shadow-directional/index.html`, CSV,
JSON raw profiles and 30 four-panel cards with explicit sampled regions.
PNG presentation follow-up: each card now includes prominent PRESS / NO PRESS /
UNKNOWN banners for all four cutoffs, separate from the user phase label.
Wrong-target rows show INVALID TARGET. These labels expose the existing pattern
result without selecting a cutoff or changing measurement logic. All 30 PNGs
regenerated; syntax and exporter lint passed; labeled index 148 and invalid-target
first-middle 120 cards inspected for legibility.
Five final cards inspected: index 148, first-middle 111/112 and second-middle
164/165. Other 25 cards exported but not individually reviewed. Previous exports,
sidecars, manual anchors and live behavior remain preserved.

Verification: 13 tip-evidence cases passed (five new synthetic regressions),
43 focused heatmap/band/fingertip/evidence cases passed. New cases cover a thin
rim supported by upward shadow versus clear paper alone; diagonal evidence
missed by the central strip; unknown/occluded/image-censored forward evidence;
four-cutoff weak-shadow behavior; multi-row upward support and unknown coverage.
Full Vitest: **583 passed, 26 failed, one skipped** during concurrent build.
Failures include the same 25 documented recording/velocity/synchronous-contact
fixture failures plus one five-second browserAudio timeout. Isolated rerun of
browserAudio and final tip evidence passed **85 cases**. Lint passed with three
existing image warnings; TypeScript and 39 contrast checks passed. Sandboxed
production build failed fetching the existing Google Fonts; network-enabled
production build passed. This helper/export is not imported by live pages, so
production browser smokes were not rerun. No physical accuracy/latency, held-out
evaluation or GitHub Actions pass is claimed. Vitest is discovered by existing
CI; the exploratory runner is local only.


## Static shadow-hypothesis comparison (2026-10-29)

Local-only continuation authorized by the user after reviewing fingertip
proposals as generally useful; pinky/overlap refinement is deferred and motion
is excluded. From `frontend/`, run `npm run experiment:shadow-hypothesis`.
The runner needs the original clip/reference and the existing ignored sequence
cache files; missing input fails explicitly. Installed Chrome is the default
(`CV_BROWSER_CHANNEL` override). No app server or model download is needed.

Thirty frames were exported: index 146–154, first-middle 110–120 and
second-middle 163–172. First-middle's old cache contains only enlarged crops,
so full native frames are recovered from paused browser video seeks; later
sequences reuse their existing full frames. Input hashes, fixed association
gates, requested/decoded times, raw profiles and source-review flags are in
`frontend/test-results/shadow-hypothesis/results.json`. Approximate frame/time
labels are preserved; decoded offsets can reach about one 30-FPS frame.
There is no exact encoded-frame, physical-onset or latency claim.

The ignored `index.html` report links a CSV summary, 30 four-panel cards, three
five-frame comparison sheets and the full JSON. All three key-frame sheets
were inspected against native source. Eight additional detailed cards were
inspected (index 147/148, first-middle 111/120, second-middle 163/164/165/172).
The 15 intermediate frames are exported but not individually source-reviewed.
One fixed gate selects a neighboring fingertip at first-middle 120; that row
is retained with `wrong-target`. Second-middle 163/164 carry `directional-limit`.
Thirty automatic target selections and 26 complete 40-luma medians are
availability counts, not correctness results.

Settings stay fixed: 640×427 analysis, reference cutoff 40, unchanged fingertip
estimator, projection `e_I ≤0.12` primary and color shift ≤10 secondary, display
floor/full scale 5/120, 24-pixel scans, three-pixel attachment window, central
distal rays anchored independently to the estimated curved edge. All four
predeclared intensity cutoffs (5, 20, 40, 60) are reported. Zero means three
known clear initial samples at that cutoff; unavailable/ambiguous/censored
measurements stay null. Near-forward intensity, compatible coverage, raw tip
darkening and side/back evidence are separate. No per-frame tuning or press
classifier was added.

At the reported 40-luma column, index near-touch 147 → touch 148 contracts
9 → 1 analysis pixels; first-six-pixel mean darkening falls 86.85 → 16.17.
First-middle 111 → 112 shows mean 55.54 → 19.82, but the near-touch extent is
unavailable (4/11 complete rays). Second-middle 164 → 165 has 1 → 1 px and mean
23.09 → 27.80: this strip does not separate those phases. The source/map review
shows a broad diagonal-right lobe beyond the central strip. This is evidence
to improve the sampled front region, not justification for a universal 1-pixel
contact threshold. Boundary/antialiasing sensitivity and shadow ownership
remain unverified. See [full findings and next step](../docs/cv_shadow_detection_status_and_next_steps.md#static-shadow-hypothesis-comparison-2026-10-29).

Local macOS / Node 24.2.0 / Chrome 156.0.8078.73: the final browser export
completed all 30 frames. Eight synthetic `shadowTipEvidence.test.ts` cases
passed, and the focused heatmap/band/tip/evidence run passed **38 cases**.
Full Vitest: **579 passed, 25 failed, one skipped**, in the same documented
recording-canvas, velocity and synchronous-contact failure groups. Lint passed
with three existing image-element warnings; TypeScript, 39 contrast checks
and the network-enabled production build passed. Existing production browser
smoke results/limits from the fingertip pilot below remain the session evidence;
this addition is an offline helper/export and is not imported by live pages.
No new CI workflow or physical/held-out verification was added. New Vitest
Actions execution remains pending; the exploratory runner is not invoked by CI.

## Color-cluster fingertip pilot (2026-10-29)

Local-only diagnostic requested by the user; motion excluded. Run from
`frontend/`: `npm run experiment:fingertips`. Installed Chrome is used by
default (`CV_BROWSER_CHANNEL` override); no app server or inference model is
needed. This transpiles the actual TypeScript heatmap/band/estimator modules
into the browser and decodes the original PNGs with Canvas. No new dependency
or live detection behavior was added.

macOS, Node 24.2.0, Chrome 156.0.8078.73: 19 labeled images plus background
processed successfully. Background self-comparison asserts zero candidates.
Three to five spatial proposals per labeled image, 77 total, were exported
with input hashes, fixed settings, raw forward-band profiles, masks and local
forward/back shadow summaries. Forty-two proposals produced complete forward
band aggregates; 60 local boxes reached the forward limit and 68 the backward
limit. These are diagnostic availability counts, not accuracy results.

The all-image source overview and detailed index-148, pinky-199 and ring-169
source/mask/shadow comparisons were inspected. Tip misses/shifts and merged
regions remain, notably pinky 199. No all-fingertip, skin-segmentation,
shadow-ownership or contact pass is claimed. Candidate numbers are spatial,
not anatomical identities; downward-facing fingers and reddish changed regions
are explicit pilot assumptions. Thresholds were explored on this same set.

Ignored outputs: `frontend/test-results/fingertip-candidates/index.html`,
`overview.png`, per-image `*.candidates.png` and `results.json`.
See [algorithm, settings and limits](../docs/cv_shadow_detection_status_and_next_steps.md#local-color-cluster-fingertip-pilot-2026-10-29).

Eight new synthetic cases in `frontend/fingertipCandidates.test.ts` passed;
the focused heatmap/band/tip run passed 30 cases. Full Vitest: **571 passed,
25 failed, one skipped**, retaining the previously documented 23 recording
canvas-mock failures and single velocity and synchronous-contact failures.
Lint passed with the same three existing image-element warnings; TypeScript,
all 39 contrast checks and the production build passed. The sandboxed build
failed to fetch the existing Google Fonts; the network-enabled build passed.
Keyboard-layout browser smoke passed in installed Chrome. The required bundled
Chromium audio runner could not launch because its executable is not installed.
Deployment smoke in installed Chrome timed out after 60 seconds waiting for
the existing home-page `MediaPipe ready/unavailable` status, matching the prior
handoff's limitation. No deployment or bundled-Chromium audio pass is claimed.
No CI workflow changed; new Actions evidence and physical accuracy/latency
remain pending. The standalone experiment is not invoked by CI.

## Piano timbre verification (issue #175)

CI timeout follow-up 2026-10-14: the [frontend job at e6de2fa](https://github.com/Kakrl/MakeShift/actions/runs/38662133296/job/116185643600)
failed when the combined three-rate rapid-retrigger case took 5058 ms against
Vitest's default 5000 ms timeout; no assertion failure was reported. Each rate
now runs as a separate case with a 15000 ms offline-test timeout. The same
999 presses per rate, malformed-event checks and reset checks are retained;
this timeout is not a real-time DSP performance threshold. Local full-suite
verification after integrating the updated PR branch passed 510 cases across
26 files with one existing skip;
all fourteen piano-modal cases passed. New Actions execution is pending.

PR #202 review follow-up, local execution 2026-10-14 on the same Windows/Node
host: equal effective cutoff endpoints now use a fixed filter and zero pitch
tracking. The regression checks every pitch preset, constant filter coefficients,
finite nonzero held output, release and retirement at 8/48/96 kHz. All twelve
piano-modal cases passed; the full suite passed 500 cases across 25 files with
one existing skip. Lint, TypeScript, all 37 contrast pairs and the normal
Turbopack production build passed. Deployment, keyboard-layout and audio browser
checks passed in headless Edge 155.0.4283.45 with fake media; soft/loud graph RMS
was approximately 0.003739/0.010006. Audible hardware was not measured by these
runners. Chromium and new Actions execution evidence remain pending.

Local execution 2026-10-13 on Windows 10.0.26200, Node 22.20.0,
Vitest 4.1.11. The default production DSP now has decaying modal piano voices;
explicit legacy mode retains the sine/ADSR baseline. Existing pitch-only
zero-crossing oracles intentionally remain baseline regressions, while
pianoTimbre.test.ts covers the new default with spectral and state checks.
The velocity estimator DSP test now asserts stronger fast strikes rather
than the exact sine amplitude ratio because velocity also changes timbre.

Frontend lint, TypeScript, 37 contrast pairs and production build passed.
The final full suite passed **495 cases across 25 files**, including eleven
piano-modal cases. Production audio,
deployment and keyboard-layout checks passed against port 3175 in headless
Edge 155.0.4283.45 with fake media. Soft/loud piano graph RMS was approximately
0.003707/0.010006; Stop, suspension/re-enable and navigation cleanup passed.
Chromium could not launch (`spawn UNKNOWN`), so its local result remains pending.
Database was unconfigured. The browser threshold changes account for decaying,
normalized timbre; they establish output presence, not acoustic quality.

The paired synchronous browser DSP benchmark covered 44.1/48/96 kHz single
notes, chords and rapid stealing; see [the complete timing table and limits](../docs/performance.md#piano-paired-dsp-profile-175-2026-10-13).
Real AudioWorklet deadline/dropout stress with simultaneous live CV remains
pending. The provisional 16-sample control interval has no listening-quality
pass claim for that interval. Carl Xu reported on 2026-10-13 that the piano
sounds good and responds swiftly: a qualitative user-reported listening pass.
The [listening/reference report](manual/2026-10-13_PT-03.md) is PARTIAL;
individual structured steps, reference comparison and exact listening environment
remain pending. Physical latency/dynamics remain
unverified. Existing CI invokes Vitest and the three production browser runners;
new Actions execution evidence is pending. The paired profile runs manually.
## Piano-sheet verification (issue #187)

Local Windows execution on 2026-10-13, Python 3.12.14, reportlab 4.4.9,
OpenCV 5.0.0, pypdf 6.10.0, Pillow 12.3.0, NumPy 2.5.4 and pytest 9.1.1:
five rendered-PDF cases passed in `tests/python/test_piano_sheets.py`.
The full Python suite passed (30 cases), Ruff passed for `backend/src`,
`tests` and the generator, and mypy passed for the five backend source files.
They check deterministic committed assets, Letter dimensions, actual-size
key boundaries, zero-left-margin extension, 18 mm canonical marker payloads
and orientation, 3 mm quiet rings, and two-/three-sheet opaque overlaps.
OpenCV detects exactly IDs 0-3 on each assembly; interior marker footprints
are entirely white after overlap. Both final pages were rendered with Poppler
and visually inspected. Physical printing and webcam detection remain pending.

Install `tests/python/piano_sheet_requirements.txt` and Poppler on PATH to
run these optional checks. Missing tools skip explicitly. CI discovers the
test file through pytest but does not install the optional PDF toolchain;
no CI execution pass is claimed. See [printing/trim instructions](../docs/piano_sheet.md).
## Calibration workflow

Local macOS execution on 2026-10-11, Node 24.2.0, Vitest 4.1.11:

- All 481 tests across 23 files passed; all 15 calibration workflow tests passed.
- Frontend lint, TypeScript, all 37 contrast pairs and production build passed.
- The five-step wizard goes from paper alignment directly to five depth
  captures for each hand. Each position requires the corresponding detected
  hand, and the final capture supplies the required rest landmarks. Legacy hover samples remain
  accepted but are optional and are not written by new calibration captures.
- Real camera/printed-sheet verification remains unverified.

### Hand-detector recovery follow-up (2026-10-14)

Local macOS execution, Node 24.2.0, Vitest 4.1.11:

- `cd frontend && npx vitest run ../tests/frontend/calibrationWorkflow.test.tsx`:
  **16 tests passed**, including failed hand-detector initialization followed
  by Reload and successful readiness. The error and retry control are shown in
  depth step 4; capture stays disabled until the detector is ready.
- Targeted ESLint checks for `frontend/src/app/calibration/page.tsx` and
  `tests/frontend/calibrationWorkflow.test.tsx` passed. `git diff --check`
  passed.
- Full frontend suite, build, Actions execution and real camera verification
  were not run for this follow-up.

## Finger-speed velocity verification (issue #28)

Local Windows execution on 2026-10-07, Node 22.20.0, Vitest 4.1.11,
on `feature/28-browser-piano-integration-followup`:

- All 481 tests across 23 files passed, including 20 `fingerVelocity.test.ts`
  cases and 24 recording-control cases. Frontend lint, TypeScript, all 37
  contrast pairs and production build passed.
- Estimator fixtures cover stationary/noisy motion, monotonic mapping,
  timestamp/frame-rate and image-aspect correction, palm scale/translation,
  optional depth, finite fallback, peak expiry/consumption, bounded history,
  duplicate frames, source/time/gap/reset/invalid data, and pipeline latch/loss.
  A simulated shadow worker confirms a press 50 ms after the motion sample,
  retains the recent peak and rejects its result after reset.
- Real coordinator/overlay integration with synthetic landmarks sends
  velocities 0.36 and 1 to a chord's audio calls and records 36 and 100, with
  matching 40 ms durations. Two simultaneous fingers on one key use the
  stronger onset; held motion does not retrigger or rescale it. Missing palm
  data gives velocity 0.2 (20 in MIDI), replacing old fixed-0.8 expectations.
- The production DSP offline RMS ratio for estimated slow/fast input is 0.36
  (about 8.87 dB difference). This is software amplitude evidence, not the
  ten-trial physical dynamics test 2.4.2 or a user-volume-control check.
- Production audio, keyboard-layout and deployment checks passed in Edge
  154.0.4258.62 on port 3128 with fake media. Audio RMS/suspension/navigation,
  persisted layout controls, camera denial/retry/loss/recovery, five assets/pages
  and three local-play rounds with no note requests passed. Database was
  unconfigured. Chromium remains unavailable locally (`spawn UNKNOWN`).
- Existing CI invokes these Vitest tests; Actions execution for this change is
  pending. Physical dynamics tuning and audible hardware remain unverified.

## Direct contact delivery verification (issue #28)

Local Windows execution on 2026-10-07, Node 22.20.0, Vitest 4.1.11,
branch `feature/28-browser-piano-integration-followup`, based on `b46f342`:

- The new `recordingControls.test.tsx` case sends a chord, a hold, an empty
  frame and a repress within one React batch. Audio dispatch precedes commit;
  the completed take retains both pitches, velocities, 40 ms initial durations
  and 60 ms repress durations. Against the original coordinator it failed:
  expected two audio calls before commit, received zero.
- Frontend lint and TypeScript passed; all 459 Vitest tests across 22 files,
  all 37 contrast pairs and production build passed. All 22 recording-control
  cases passed. The existing frontend CI workflow invokes Vitest; new-regression
  Actions execution evidence is pending.
- Chromium runners could not launch (`spawn UNKNOWN`). Production audio,
  keyboard-layout and deployment checks passed in Edge 154.0.4258.62 with fake
  media on port 3128. Audio rendering/suspension/navigation, layout persistence,
  camera denial/retry/loss/recovery, five assets/pages and three local-play
  rounds with zero note requests passed. Database was unconfigured.
- Real-camera contact, velocity sensing, audible hardware and physical latency/
  accuracy remain unverified. Keep #28 open pending #30/#39 and
  [physical follow-up](manual/2026-10-07_2.1.2.md).

## PR #177 main reconciliation and PDF relocation

Local Windows execution on 2026-10-06 after merging main `5f26515` into
`feature/36-octave-layouts`: retained main's MIDI export fixes, recording-state
announcements, tests and RCA documentation alongside the octave/calibration work.
Both conflict-side recording-control cases remain active.

Frontend lint, TypeScript, all 454 Vitest tests across 22 files, all 18 contrast
pairs and production build passed. Production deployment, keyboard-layout,
audio and MIDI browser checks passed in Edge 154.0.4258.53 against port 3177
with fake media. Physical camera, printer and audible hardware remain unverified;
Actions execution for this merge remains pending.

Moved both piano-sheet PDFs into `docs/`, updated links and generator destination,
and removed `output/`. Regeneration produced byte-identical PDFs and did not
recreate `output/`. Python Ruff, mypy and pytest could not run because those
modules are absent in the available Python runtimes; no Python-suite pass is claimed.

## PR #177 final depth capture recovery

Jadden's [review](https://github.com/Kakrl/MakeShift/pull/177#discussion_r4201139161)
identified a Medium defect: a final sheet-check exception removed capture and
Next controls. Going back and repeating hover/depth was the workaround.
The catch now resets the collector/index while retaining hover. Inventory
6.2.3 includes a regression that hides a marker at final capture, checks retry
availability and blocked advancement, then recaptures all five positions and
verifies both saved models and navigation.

Local Windows execution on 2026-10-06: 15 calibration workflow cases and all
452 Vitest tests across 21 files passed. Lint, TypeScript, all 18 contrast
pairs and production build passed. Production deployment, keyboard-layout
and audio browser checks passed in Edge 154.0.4258.53 with fake camera
on port 3100; audible hardware was not measured. New-regression CI and physical camera
verification remain pending. The Medium defect is tracked in
[#178](https://github.com/Kakrl/MakeShift/issues/178), fixed by PR #177.

## Octave layout and calibration verification (issues #36 and #162)

Local Windows 11 Home 10.0.26200, Node 22.20.0, Vitest 4.1.11 execution on
2026-10-06, branch `feature/36-octave-layouts`, based on main `856eef9`:

- Full Vitest suite: **451 passed**, across 21 files, with no expected failures.
- Inventory 1.2.1/1.3.1: every white key in all 27 supported starting-C/octave
  combinations (391 pitch cases) reaches the real DSP, audio adapter, recorder
  and feedback. A two-second 48 kHz offline render checks frequency using
  positive zero crossings over its final second (error below 1.1 Hz).
  This verifies software pitch, not physical sound or black-key contact mapping.
- `keyboardLayout.test.ts`: physical 23.5 mm key pitch, 8/15/22 hit regions,
  overlap/marker proportions, all MIDI bounds, invalid inputs and unchanged
  full range under explicit paper-fit override. These are synthetic points.
- `calibrationWorkflow.test.tsx`: 15 passing cases cover the five-step wizard
  and its five depth buttons; complete rest landmarks and both records are
  saved before navigation. Missing hands/markers and storage failures block
  completion. There is no separate hover capture step.
  One/two/three-octave selection, starting-C bounds, override and invalidation
  are covered. The old five `it.fails` cases are restored as normal regressions.
- Live-session/real-overlay fixtures verify immediate held-note release,
  interrupted startup, stale producer rejection and recalibrated two/three-
  octave geometry/pitches. Contact techniques and hardware are mocked.
- Frontend lint, TypeScript, 18 contrast pairs and production build passed.
- PDF vector measurements, marker payload/quiet-zone pixels, deterministic
  regeneration and simulated sheet overlaps passed; both pages were rendered
  with Poppler and visually reviewed. Physical printer/camera checks are pending.

Production browser checks passed using Microsoft Edge 154.0.4258.53 with fake
media against `npm start -- -p 3100`: `test:keyboard-layout-browser` verified all
three persisted layouts, reload, warning/override, invalidation and MIDI bounds;
`test:deployment` verified five assets/pages, camera denial/retry/loss/recovery
and three local-play rounds with no per-note network; `test:audio-browser`
verified production DSP loading, output RMS, suspension recovery and navigation
cleanup. Set `MAKE_SHIFT_URL=http://127.0.0.1:3100`, `BROWSER_CHANNEL=msedge`
for layout/deployment and `AUDIO_BROWSER_CHANNEL=msedge` for audio.
Downloaded Chromium 151.0.7922.34 failed to launch locally (`spawn UNKNOWN`),
so its local checks are unverified; CI uses Chromium. Python 3.12.10 Ruff/mypy
and all 25 pytest cases passed; generator Ruff and 18 RCA automation cases passed.
CI at `2d7698a` passed on 2026-10-06: [Frontend job log](https://github.com/Kakrl/MakeShift/actions/runs/37531834854/job/112502867295)
records all 451 tests, lint/types/contrast/build and all three production browser
checks in Chromium 151.0.7922.34 on Ubuntu. [Python tests](https://github.com/Kakrl/MakeShift/actions/runs/37531834799/job/112502867677),
[lint](https://github.com/Kakrl/MakeShift/actions/runs/37531834858/job/112502867866),
[RCA automation](https://github.com/Kakrl/MakeShift/actions/runs/37531834865/job/112502867581)
and [RCA requirements](https://github.com/Kakrl/MakeShift/actions/runs/37531868674/job/112502989054)
also passed. These logs verify software execution, not physical hardware.
Manual system test 1.2.2 records physical limitations in
[the configuration workflow report](manual/2026-10-06_1.2.2.md).

The #162 root cause is replacing the reachable fifth-step countdown with depth
buttons without creating the validated primary result from those buttons,
combined with navigation/legacy writes before validation. Final depth capture
now creates the result, completion retains its model, and saving precedes
navigation. RCA publication is left to merge automation.

## Recording lifecycle and export verification (issue #88)

PR #173 review follow-up, local Windows execution on 2026-10-06,
Node 22.20.0, based on `852a10e`: removed the redundant constructor tick
argument while retaining the post-construction tick-zero workaround, and
documented the React recording-state snapshot with lazy initialization.
Lint, TypeScript, all 18 contrast pairs and production build passed;
Vitest reported 344 passed and the same 5 expected D21 failures.
Existing real-writer chord/timeline and recording-control regressions passed.
Production checks against `npm start -- -p 3173` passed in Edge
154.0.4258.53: MIDI exact bytes/downloads/reload/rename/delete,
deployment assets/camera recovery/local playing, and audio output,
suspension recovery/navigation cleanup. Chromium failed to launch locally
(`spawn UNKNOWN`); `test:keyboard-layout-browser` is absent on this PR branch.
Browser inputs were synthetic; physical hardware and Actions execution for
this follow-up remain unverified. No test implementations changed.

Local Windows execution on 2026-10-05, Node 22.20.0 and Vitest 4.1.11,
branch `fix/88-midi-recording-export`, based on `8c9d33d`:

- Full Vitest suite: 344 passed and 5 expected failures (existing D21),
  across 20 files. The real-writer regression failed before the fix: the second
  origin chord note started at tick 128 instead of tick 0.
- `recordingExport.test.ts` independently reads actual exported MIDI bytes:
  header/track lengths, resolution, tempo, pitches, velocities, absolute note
  times, chord alignment, release before rearticulation, split held notes,
  pause exclusion, stop closure, rejected stopped writes and independent takes.
  It uses a deterministic fixture and a fake download anchor, not a browser.
- `recordingControls.test.tsx` covers accessible announcements through initial
  count-in, capture, pause, resume count-in and completion with mocked hardware.
- These tests run through Vitest in `frontend-ci.yml`; Actions evidence is
  pending. Seeded random streams and physical recording remain unverified.
- Final frontend lint, TypeScript, 18 contrast pairs and production build
  passed. Playwright Chromium 151.0.7922.34 passed production MIDI downloads
  with exact bytes and library reload/rename/delete, deployment recovery/assets
  and audio suspension/navigation checks. Browser camera/audio are synthetic;
  audible hardware was not measured.

Issue #88's RCA is included in [PR #173](https://github.com/Kakrl/MakeShift/pull/173)
and the RCA log below. The PR targets main from the main repository's branch
at the user's explicit request; it does not use a personal fork.
The root cause of the newly exposed chord error is midi-writer-js's constructor
using a truthiness check for tick zero; prior writer mocks and a single-note
browser fixture could not expose it. Export now explicitly assigns every note's
absolute tick after construction and resolves the explicit-event merge before
serialization so the file contains a single end-of-track marker. The strict
reader rejects trailing events after that marker. Keep real-writer lifecycle
parsing in CI.
The original D2 came from UI controls changing React state without recorder or
download calls; the existing shared-event wiring and library download implement
that behavior. D11 came from retaining the writable track after Stop; the
instance recorder's stopped-state guards prevent later input from changing it.

This directory holds MakeShift's verification tests and their documentation:
the test inventory, manual test reports, known defects, and root cause
analyses (RCAs).

## Where Test Documentation Lives

| Document | Location |
| :--- | :--- |
| Verification Test Inventory | [`verification_test_inventory.md`](verification_test_inventory.md) |
| Manual test template | [`manual/manual_test_template.md`](manual/manual_test_template.md) |
| Manual test reports | `manual/YYYY-MM-DD_<test-case-id>.md` |
| Defect report template | [`.github/ISSUE_TEMPLATE/defect_report.yml`](../.github/ISSUE_TEMPLATE/defect_report.yml) |
| Defect reports and RCAs | GitHub issues labeled `bug`. RCAs are posted as comments on the defect issue |
| Known defects and RCA log | This file |
| V&V plan, SDP, design | [`docs/`](../docs) |

**Why here.** `tests/` already holds the test code (GoogleTest suites, the
contrast audit, pytest), so the inventory and reports sit next to the tests
they describe. A PR that adds a test can update its inventory row in the same
directory. `docs/` stays for planning documents (SDP, V&V plan, design) that
change once per milestone, and `tests/` holds records that change every
sprint. The defect template has to live in `.github/ISSUE_TEMPLATE/` because
GitHub only reads templates from there. RCAs stay on the defect issue so the
analysis, fix PR, and discussion are in one place, and the log below indexes
them.

## Layout

```text
tests/
├── README.md
├── verification_test_inventory.md
├── audio/
│   ├── test_audio.cpp                # PortAudio lifecycle
│   └── test_audio_events.cpp         # rendering, polyphony, SPSC queue
├── automation/
│   └── rca.test.cjs                  # repository-process regression tests
├── frontend/
│   ├── performanceMetrics.test.ts # aggregation, clocks, bounds and overhead
│   ├── performanceResources.test.tsx # CameraProvider lifecycle
│   ├── performanceMetrics.browser.mjs # profiles and paired overhead
│   ├── fingerState.test.ts           # per-finger contact state transitions
│   ├── fingerVelocity.test.ts        # normalized speed, onset latch and DSP response
│   ├── cvVideoEvaluation.test.ts     # sidecar, calibration, matching and replay core
│   ├── cvVideoReplay.browser.mjs     # Playwright clip replay through production CV
│   ├── browserAudio.test.ts      # production DSP offline rendering
│   ├── browserAudioLifecycle.test.ts # browser owner mocks
│   ├── browserAudio.browser.mjs  # production browser graph check
│   ├── cameraLayout.browser.mjs  # home camera feed 16:9 across viewports
│   ├── deployment.browser.mjs    # production assets, camera recovery, offline playing
│   ├── homePage.test.ts              # home page modals and overlays (jsdom)
│   ├── supabaseHealth.test.ts    # /api/health database check
│   ├── noteEvents.test.ts            # shared event validation, sessions and clocks
│   ├── playbackTimeline.test.ts      # recording playback clock and lifecycle
│   ├── midiUtils.test.ts             # MIDI unit tests
│   └── check-contrast.mjs            # theme token contrast audit
├── python/
│   ├── latency_estimate.py          # software latency estimator
│   ├── latency_estimate.example.json # metadata and explicit allowances
│   ├── test_latency_estimate.py     # synthetic estimator regression cases
│   ├── latency_profile.fixture.json # synthetic diagnostics export
│   ├── latency_simulation.fixture.json # modeled software durations
│   ├── latency_simulation.report.json # versioned scenario result
│   └── test_dummy.py                 # existing placeholder, no product coverage
└── manual/
    └── manual_test_template.md
```

Add future tests, helpers, and fixtures to the matching suite directory.
Frontend tests import application modules from `../../frontend/src/`.
`frontend/vitest.config.mts` selects `tests/frontend/` and resolves frontend
package dependencies. Bare imports used by tests, including any module passed
to `vi.mock`, need an alias there because `tests/` has no `node_modules`. Add a
`// @vitest-environment jsdom` comment to tests that render components. The frontend TypeScript and ESLint commands also include
that directory. Keep frontend dependencies and tool configuration in `frontend/`,
C++ build definitions in `backend/CMakeLists.txt`, and CI workflows in `.github/`.
Python's default recursive discovery finds `tests/python/` without extra config.
No test implementation requires an exception to this layout.

## Running the Tests

| Suite | Command | Needs |
| :--- | :--- | :--- |
| C++ (GoogleTest) | `cmake -B build -S backend && cmake --build build --config Release && ctest --test-dir build -C Release --output-on-failure` | CMake 3.15+, C++23 compiler, Python 3.12, `pip install -r requirements.txt` |
| Python | `python -m pytest --cov=backend --cov-report=term-missing` | `pip install -r requirements.txt` |
| Latency estimate | `python tests/python/latency_estimate.py profile.json config.json estimate.json` | #38 JSON export and explicit assumptions; [procedure](../docs/latency_estimation.md); no physical equipment required |
| Frontend unit (Vitest) | `cd frontend && npx vitest run` | `npm ci` in `frontend/` |
| Browser audio smoke | `cd frontend && npm run test:audio-browser` | Production server on `MAKE_SHIFT_URL` (default `http://127.0.0.1:3000`); `AUDIO_BROWSER_CHANNEL=chromium` for Playwright Chromium (default `msedge`) |
| Deployment smoke | `cd frontend && npm run test:deployment` | Production server or Vercel URL in `MAKE_SHIFT_URL`; `npx playwright install chromium`; network for jsDelivr WASM; `EXPECT_DATABASE=ok` requires Supabase secrets (`infisical run`) |
| CV video replay | `cd frontend && npm run test:cv-video:auto` (all checked-in clips, sequentially) | Builds/starts production app once; Playwright Chromium installed once where supported (Apple Silicon Mac uses installed Chrome); optional `CV_TECHNIQUE=synchronous-shadow` for the experimental same-frame detector, `-- --clip N` or `-- --browser chrome`; per-clip and combined reports saved under `frontend/test-results/cv-video/` |
| CV labeled image cases | `cd frontend && npm run test:cv-images:auto` | Put an empty-sheet `background.png` and labeled PNG/JPG cases in `images_test_cases/`; builds/starts production app, runs MediaPipe, ArUco geometry, fingertip profile and sparse background comparison; writes JSON under `frontend/test-results/cv-image-cases/`; see [image replay](../docs/cv_image_tests.md) |
| Contrast audit | `cd frontend && npm run test:contrast` | Node 20. Writes `frontend/test-results/contrast-report.json` |
| MIDI production download | `cd frontend && npm run test:midi-browser` | Running production server; Playwright and Edge; optional MAKE_SHIFT_URL / MIDI_BROWSER_CHANNEL |
| Pipeline profiling | `cd frontend && npm run test:performance-browser` | Production server on port 3100, Playwright + Edge; synthetic camera; local only |
| Camera feed layout | `cd frontend && npm run test:layout-browser` | Running production server; Playwright bundled Chromium; optional MAKE_SHIFT_URL / LAYOUT_BROWSER_CHANNEL |
| RCA automation | `node --test tests/automation/rca.test.cjs` | Node 22; no package installation or GitHub credentials needed |

### CV video replay (#39)

See the [quick guide](../docs/cv_video_tests.md) for preparing a clip/sidecar
pair and running the browser replay.

The sidecar parser and evaluation helpers are covered by
`cd frontend && npx vitest run ../tests/frontend/cvVideoEvaluation.test.ts`.
They validate annotations, build knuckle/Z calibration models from raw
landmarks for both hands, derive press/release transitions, and match events
one-to-one by key. Run `cd frontend && npm run test:cv-video:auto` to replay all
checked-in clips sequentially; it starts/stops the production app and saves
per-clip reports plus a combined summary under
`frontend/test-results/cv-video/`. Pass `-- --clip 2` to run just one clip.
For custom clips, start the production app and run
`CV_VIDEO_FILE=/path/clip.mp4 CV_SIDECAR_FILE=/path/clip.json npm run test:cv-video`.
The Playwright harness at `/cv-video-replay` uses the browser's video decoder,
MediaPipe hand landmarker, ArUco marker detector and live contact pipeline.
It steps through the clip while paused, preserves frame order, scores
transitions, and reports every transition plus per-frame stage timings. It
requests MediaPipe's GPU delegate and falls back to CPU if unavailable. Marker
detection follows the live 250 ms acquisition / 10 s check cadence and keeps
the last usable geometry. Results go to stdout; set `CV_RESULT_FILE` to save
the complete JSON report. The sidecar's `framesPerSecond` must match the clip's
constant frame rate. Validate browser seeking against encoded frames before
using scores as an accuracy ceiling.

Local verification on 2026-10-15: all five CV evaluation Vitest cases passed,
the production build succeeded, and the first labeled MOV replay completed in
Google Chrome on Apple M2. MediaPipe selected GPU with the Metal WebGL renderer.
With overlap-only contact (`knuckles: false`, `shadows: false`), all 288 frames
processed at 29.3 FPS including the first frame, and 30.6 FPS after it; median
inference was 18.6 ms. The replay performed one ArUco scan (63.9 ms) during
the 9.6 s clip. Presses matched 5/8 labels (8.2% precision, 62.5% recall);
releases matched 2/8 (3.3% precision, 25% recall). The overlap-only run
produced 122 transitions, so false transitions were common. This is one fast
ordered run, not a live-performance or population accuracy result. The full
109 KB report, including all transitions and per-frame stage times, is
[`cv_automated_test_1.results.json`](automation/CV%20Test%20Videos/cv_automated_test_1.results.json).

With both `knuckles` and `shadows` enabled, the same clip completed at 26.5 FPS
(27.6 FPS after the first frame) and emitted 6 transitions. Press scoring was
1 TP / 2 FP / 7 FN (33.3% precision, 12.5% recall); release scoring was
0 TP / 3 FP / 8 FN (0% precision and recall). Fourteen shadow samples were
submitted to the worker. This run is also exploratory; the small labeled set
and asynchronous shadow sampling limit accuracy conclusions. Its complete
report is
[`cv_automated_test_1.knuckles-shadows.results.json`](automation/CV%20Test%20Videos/cv_automated_test_1.knuckles-shadows.results.json).

With knuckles enabled and shadows disabled, the replay completed at 28.3 FPS
(29.6 FPS after the first frame) and emitted 12 transitions. Press scoring was
1 TP / 5 FP / 7 FN (16.7% precision, 12.5% recall); release scoring was
0 TP / 6 FP / 8 FN (0% precision and recall). This did not recover more
labeled presses than the combined gates on this clip. The complete report is
[`cv_automated_test_1.knuckles-only.results.json`](automation/CV%20Test%20Videos/cv_automated_test_1.knuckles-only.results.json).

### Synchronous shadow detector experiment (2026-10-17)

Ran all four checked-in labeled MOV/sidecar pairs with
`CV_TECHNIQUE=synchronous-shadow npm run test:cv-video:auto`. The replay
enabled knuckle eligibility, disabled the legacy asynchronous shadow worker,
and captured the same-coordinate background on valid marker/homography
acquisition. All four runs used MediaPipe GPU on an Apple M2 and captured a
background. The fast ordered replay processed 1,434 frames; it does not measure
live frame drops or physical latency.

- Presses: **1 TP / 5 FP / 44 FN** (16.7% precision, 2.2% recall).
- Releases: **3 TP / 3 FP / 42 FN** (50% precision, 6.7% recall).
- The detector analyzed 152 eligible fingertip samples and marked 15 as
  candidates. Clips 3 and 4 had only 3 and 13 eligible samples, respectively,
  under the knuckle/key gates.
- Contact processing on the 84 frames with at least one sample had a median
  of 14.3 ms, p95 of 43.8 ms, and maximum of 54.8 ms. This includes controller
  work for the frame and is not an audio-latency measurement.

The combined end-to-end result is poor and the sampled-frame cost is high and
variable. Keep the feature off by default. Inspect the candidate profile and
gate behavior on labeled frames before adjusting thresholds; very near-sheet
hover remains deferred. The complete per-clip reports and summary are saved in
`frontend/test-results/cv-video/` locally; these ignored reports are not
committed. The Vitest detector/pipeline cases, lint, type check, contrast audit,
and production build passed locally. Actions evidence remains pending.

Then ran all four clips with knuckle gating disabled using
`CV_TECHNIQUE=synchronous-shadow-no-knuckles`, the legacy worker off, and the
current compact crop. MediaPipe GPU ran on an Apple M2; all clips captured a
background.

- Presses: **10 TP / 43 FP / 35 FN** (18.9% precision, 22.2% recall).
- Releases: **10 TP / 43 FP / 35 FN** (18.9% precision, 22.2% recall).
- The detector analyzed 1,747 eligible fingertip samples and marked 116 as
  candidates.
- Contact processing on 634 sampled frames had a 30.0 ms median, 49.5 ms p95,
  and 70.0 ms maximum. Ordered replay throughput was 19.5 FPS; this is not live
  camera frame rate.

Disabling knuckles increased recall against the earlier gated replay but also
created many more false transitions. This is not a strict one-variable timing
comparison because the no-knuckle run used the compact-crop implementation.
Per-clip reports are in the ignored local
`frontend/test-results/cv-video/no-knuckles-2026-10-17/` directory.

## Per-finger contact state verification

Local execution on macOS, 2026-10-04, Node 24.2.0 and Vitest 4.1.11:

- `cd frontend && npx vitest run`: **308 passed, 5 expected failures across 17
  files.** The expected failures are existing `it.fails` cases; no unexpected
  failures occurred.
- `cd frontend && npx vitest run ../tests/frontend/fingerState.test.ts`:
  **6 tests passed.** Cases cover unavailable recovery through ready, unknown
  and stale shadow results, press confirmation, eligibility loss, release
  grace/recovery, stale release, and shadow-free tracking timeout.
- `cd frontend && ./node_modules/.bin/eslint --config eslint.config.mjs src/cv/finger.ts`
  passed; from the repository root,
  `./frontend/node_modules/.bin/eslint --config frontend/eslint.config.mjs tests/frontend/fingerState.test.ts tests/frontend/recordingControls.test.tsx`
  also passed.
- `cd frontend && npx tsc --noEmit`: passed.
- The recording-controls fixture now sends the next stable observation after
  the initial unavailable-to-ready transition. Its timing remains synthetic
  and does not measure camera or physical latency.
- The normal Vitest configuration initially could not load because dependencies
  were missing from `node_modules`. `npm ci` restored the locked dependencies;
  no manifest or lockfile changes were made. Actions execution evidence is
  pending.

## Marker acquisition and geometry retention verification

Local execution on 2026-10-04, Node 24.2.0 and Vitest 4.1.11:

- `cd frontend && npx vitest run`: **313 passed, 5 expected failures across 18 files**. New policy and overlay cases verify 250 ms acquisition, latched 10-second checks after a missed marker scan, retaining/replacing last good geometry, and resetting for a new camera session. Live-session coverage verifies calibration remains valid across unlimited missed marker scans while hand tracking stays fresh. Overlay integration coverage retains geometry across three consecutive missed scans and checks the detector remains on its 10-second cadence.
- `cd frontend && npm run lint` and `cd frontend && npx tsc --noEmit` passed. `cd frontend && npm run test:contrast` passed all 18 pairs.
- `cd frontend && npm run build` passed after retrying with network access; the sandboxed attempt could not fetch the existing Geist and Geist Mono Google Fonts.
- The marker policy is unit-tested; a browser run with real marker misses and a physical sheet/camera remains unverified. Actions evidence is pending.

## Playback timeline verification (issue #130)

Sources: [timeline tests](frontend/playbackTimeline.test.ts) and the added
recording-timeline cases in [audio lifecycle tests](frontend/browserAudioLifecycle.test.ts).
Run from `frontend`: `npx vitest run playbackTimeline.test.ts browserAudioLifecycle.test.ts`.
The timeline tests use fake timers and an audio fixture; the integration cases
use the production BrowserAudio owner with mocked AudioContext/AudioWorkletNode.
They do not require hardware, and make no audible playback or physical latency claim.
Real-browser timing/listening verification remains pending. Vitest is not invoked
by frontend CI (D3), so Actions execution evidence remains pending.

Local execution on Windows, 2026-09-29, Node 22.17.0 and Vitest 4.1.11,
on `feature/130-playback-timeline` based on upstream `614203f`:

- Full Vitest suite: **186 tests passed across six files**, including 32 timeline
  cases and four new production-audio-owner integration cases (mocked devices).
- TypeScript passed with incremental checking disabled. Lint passed with eight
  pre-existing unused-variable warnings outside the changed files.
- All 18 contrast pairs passed. Production build passed with network access;
  the sandboxed attempt failed to fetch the existing Geist Google Fonts.
- No real browser timing/listening run was performed. PB-1.1–PB-1.5 map the
  actual coverage; CI does not run these Vitest cases and remains pending.

## Software latency estimator verification (issue #30)

Issue #30 delivers a completed simulation/software estimation workflow. Run
`python tests/python/latency_estimate.py tests/python/latency_simulation.fixture.json tests/python/latency_estimate.example.json simulation.json`
and see [the scenario procedure/results](../docs/latency_estimation.md).
The versioned `python/latency_simulation.report.json` records 500 modeled samples
from five synthetic software durations and uniform random frame phase.
At 30 FPS with a 19 ms central allowance, the estimate is mean 47.67 ms,
p50 47.50 ms, p95 63.83 ms, maximum modeled sample 69.17 ms and 43% at/above
50 ms. Allowance/FPS sensitivity is included. Inputs are scenario assumptions,
not a hardware measurement; physical and accuracy verification are outside #30.

Local Windows verification on 2026-10-05, Python 3.12.10 and pytest 8.2.2,
branch `test/30-end-to-end-latency`: 24 estimator cases passed
(25 total including the placeholder). Ruff and required backend mypy passed.
Cases include published numeric regression expectations, FPS/allowance
sensitivity, aggregate arithmetic without invented quantiles, paired model
distributions, retained misses/invalid data, invalid assumptions and CLI reports.
`testing.yml` invokes these tests on Python changes. Inventory 2.3.7 maps the
estimator/simulation; 2.3.1 retains the distinct physical test scope.

## Note-list recorder verification (issues #108 and #115)

Local execution on Windows, 2026-09-26, Node 22.17.0 and Vitest 4.1.11,
on `feature/115-note-list-recorder`, working tree based on `3506cb5`.

- `npx.cmd vitest run`: 111 tests passed across four files, including 20
  cases in `tests/frontend/midiUtils.test.ts` (replacing the seven old cases).
- Recorder cases cover metadata, BPM validation, millisecond note pairing,
  duplicate and unknown events, repeated pitches, overlapping notes, zero
  duration, stop/release-all, pause boundaries, excluded time, repeated pauses,
  ignored idle/stopped input, independent instances/takes and copied snapshots.
- Three export adapter cases mock MidiWriter and the DOM. They check tempo,
  tick rounding, note values, paused-time removal, input preservation, empty
  and repeated exports, filename and click. They do not parse an actual MIDI
  file or prove browser download behavior.
- TypeScript passed; lint passed with seven existing unused-variable warnings
  in `page.tsx`; all 18 contrast pairs passed. Production build passed after
  rerunning with network access for Google Fonts (sandboxed attempt failed
  fetching Geist fonts).
- Vitest is still not invoked by `frontend-ci.yml` (D3); no Actions evidence
  exists for this run. Inventory 4.1.1 is partial: seeded random streams and a
  real MIDI parser oracle are pending. UI count-in/Stop interactions, CV-held-key
  behavior, camera workflows and actual file export remain unverified.

### Recording controls integration verification (#108)

Local execution on Windows, 2026-09-26, Node 22.17.0, Vitest 4.1.11,
same working tree/branch as the note-list recorder record above.

- `npx.cmd vitest run`: **116 tests passed in five files**, including five new
  cases in [recordingControls.test.tsx](frontend/recordingControls.test.tsx).
- These mount the production Home page, CV coordinator, marker overlay,
  homography/collision/transition code and recorder. Marker detector observations,
  MediaPipe hand landmarks, camera readiness, audio initialization and canvas
  drawing are fixtures/mocks. Next dynamic imports are replaced with direct
  components; jsdom provides the DOM under the Node test environment. Test
  aliases in frontend Vitest/TypeScript configuration resolve package dependencies
  for specs located outside `frontend/`.
- Verified held keys (including keys pressed during Pause) become new recorded
  notes after the resume count-in; keys released before resumption are omitted;
  repeated pauses preserve prior notes and exclude elapsed pause/count-in time.
  Buttons show the expected recording/paused/stopped state. Stop cancels both
  initial and resume count-ins; resume cancellation retains the completed take.
- The delayed-audio-initialization case failed before the fix: after Stop, the
  stale Resume continuation started another count-in and the UI showed recording.
  `playRequestRef` now invalidates that continuation on Stop/unmount; the same
  regression passed afterward. This was found in the uncommitted #108 work.
- TypeScript, lint (seven existing unused-variable warnings), all 18 contrast
  pairs and production build passed. Build used network access for Google Fonts.
- No CI execution evidence: Vitest remains outside the frontend workflow (D3).
  No physical webcam, calibration procedure, actual browser download, audio
  listening, or MIDI parser result is claimed. A physical manual workflow/report
  remains pending. Inventory 4.1.1 remains partial for seeded/random-file coverage;
  4.1.2 and 3.2.2 now have partial simulated DOM coverage.

### Upstream integration verification (2026-09-27)

Prepared `feature/115-midi-recording-pause-resume` from upstream `019e2f0`,
applying only the #108/#115 work and excluding unrelated fork commits.
Upstream had removed the disabled-tracking reset in `MarkerTrackingOverlay`.
Two existing held-key integration tests failed; restoring that reset made both
pass without changing the chosen policy or audio behavior.

- Windows, Node 22.17.0, Vitest 4.1.11: all **150 tests passed in five files**,
  including the same 20 MIDI and five recording-control cases. Upstream added
  34 audio tests since the earlier run.
- TypeScript, lint (eight existing warnings), all 18 contrast pairs and production
  build passed. Physical webcam and real-file verification remain pending.
- This supersedes the earlier branch's results for PR delivery. Actions evidence
  remains pending; Vitest is still not in CI.

## Shared-event verification (issue #86)

Local Windows verification on 2026-09-22, branch
`feature/86-note-events`, stacked on #35 at `12d93f4`, with Node 22.20.0
and Vitest 4.1.11. This is local execution evidence, not an Actions result.

- All 98 Vitest tests passed: 43 shared event/clock/MessagePort cases,
  11 browser-owner/adapter lifecycle cases, 37 offline DSP and seven MIDI.
- Shared tests cover validation, immutable schema copies, ordered sequences,
  duplicates and gaps, same-pitch press identities, release matching,
  stop/reset/interruption/release-all, stale-session rejection, bounded
  recovery, audio-first deferred observers, and invalid/delayed clock inputs.
- The adapter tests use production BrowserAudio with mocked device objects.
  Suspension, overload, processor failure and close retire shared presses,
  deliver release-all to observers, and reject stale input after recovery.
- TypeScript, lint (zero errors; seven existing home-page warnings), all 18
  contrast pairs, and production build passed.
- Extra production Edge 153.0.4234.48 / Playwright 1.62.1 smoke check:
  the unchanged runner FAILED its final immediate navigation-cleanup
  assertion (context still running after the URL changed). A local diagnostic
  copy waiting for the unmount cleanup passed: asset HTTP 200, soft/loud RMS
  0.0140931503 / 0.0426029731, chord output, stop silence, suspension recovery
  and navigation closure. The diagnostic is not a passing result for the
  unchanged test. See D16 and [issue #105](https://github.com/Kakrl/MakeShift/issues/105)
  for the separate test-harness fix.
- Vitest and the browser smoke runner remain outside CI (D3). No physical
  latency, camera accuracy, hardware listening, full MIDI recording lifecycle,
  live detector wiring or deployed cross-browser result is claimed.

## Browser audio verification (issue #35)

Local Windows verification on 2026-09-22, branch
`feature/35-browser-audio`, based on `30706c4`, with Node 22.20.0 and
Vitest 4.1.11. This is local evidence, not a CI result.

- Offline DSP: 37 tests passed, covering eleven pitches at 44.1/48/96 kHz,
  linear velocity, attack/release, ten voices, deterministic stealing, slot
  reuse, phase continuity, validation and session resets.
- Browser ownership: six tests passed for user activation, concurrent
  initialization, module failure/retry, suspended startup, interruption,
  bounded backlog, processor failure and close during initialization.
- Existing MIDI suite: seven tests passed.
- Production Edge 153.0.4234.48, Playwright 1.62.1, headless:
  `npm run test:audio-browser` passed. Soft/loud A4 RMS was
  0.014200991 / 0.042602973 (3:1). The worklet asset returned HTTP 200;
  ten-note graph output, stop silence, suspension/restart and navigation
  cleanup passed. Graph samples do not establish hardware audibility.
- Lint: zero errors, seven existing home-page unused-variable warnings.
  TypeScript, 18 contrast pairs, and production build passed.
- User-reported speaker listening passed for soft/loud A4, ten-note chord
  and Stop sound; see [manual report](manual/2026-09-22_2.2.3.md).
  Output device and browser details were not supplied. Physical latency,
  full shared #86 event integration and deployed/cross-browser compatibility
  remain pending. No native files changed.

To repeat the production smoke test: install frontend dependencies, run
`npm run build` and `npm start -- --hostname 127.0.0.1`; in another terminal
run `npm run test:audio-browser`. It uses an installed Edge by default.
See [browser audio](../docs/browser_audio.md) for environment overrides.
The tests remain outside CI (D3); no Actions execution is claimed.

## Navigation cleanup verification (issue #105)

Local Windows verification on 2026-09-28, Node 22.20.0, Playwright 1.62.1,
headless Edge 154.0.4258.37, based on `614203f`.

- The production browser audio runner now waits up to 5 seconds for the
  AudioContext to close after client navigation, then retains its final
  closed-state assertion. URL completion alone does not prove React cleanup
  has run; missing cleanup still fails with a bounded timeout.
- `npm run test:audio-browser` passed against the production build at
  `http://127.0.0.1:3105`: worklet HTTP 200, soft/loud RMS
  0.009940531 / 0.029822081, chord output, stop silence, suspension recovery
  without replay, navigation closure and no page errors.
- All 150 Vitest tests, TypeScript, 18 contrast pairs and production build
  passed. Lint passed with eight existing unused-variable warnings.
- This verifies browser graph behavior only. Hardware audibility, physical
  latency and Actions execution remain unverified; the runner is outside CI.

## Test relocation verification (issue #83)

Local Windows verification on 2026-09-17, against baseline
`e34d73624c4d776cb2dd7c4e23a5f1d7d37ce33a`. Counts below are runner results,
not claims of CI execution. Node 22.20.0, Vitest 4.1.11, Python 3.12.10,
pytest 8.2.2, and the Release CMake build were used.

| Suite | Before relocation | After relocation | Source |
| :--- | :--- | :--- | :--- |
| MIDI | 7 passed | 7 passed | [MIDI unit tests](frontend/midiUtils.test.ts) |
| Audio and queue | 14 reported passed | 14 reported passed | [Lifecycle](audio/test_audio.cpp), [events and queue](audio/test_audio_events.cpp) |
| RCA | 18 passed | 18 passed | [RCA tests](automation/rca.test.cjs) |
| Python placeholder | 1 passed | 1 passed | [Placeholder](python/test_dummy.py) |
| Contrast audit | 18 pairs passed | 18 pairs passed | [Audit](frontend/check-contrast.mjs) |

Assertions and test cases are unchanged; only location-dependent imports changed.
The existing audio tests can report a pass without exercising stream operations
when no audio device is available (D5). The Python placeholder verifies no
product behavior (D14). Neither limitation is fixed by relocating files.
Frontend type checking and production build, Ruff, and mypy passed locally.
ESLint passed with the two existing application warnings. clang-format 17 was
not available locally; the C++ files were moved without content changes.
The frontend CI path filters now include `tests/frontend/**`; Vitest remains a
local suite pending the separate CI integration work tracked as D3 (since
fixed by #152).

## Vitest CI verification (issue #152)

Local macOS execution on 2026-09-30, Node 26.8.1 and Vitest 4.1.11, branch
`fix/152-vitest-in-frontend-ci` from upstream `main`.

- `.github/workflows/frontend-ci.yml` adds a `Unit tests` step
  (`npx vitest run`) after type checking, so a failing Vitest case fails the job.
- The workflow's own file is now in its path filters (and in the Frontend
  Bypass `paths-ignore`), so edits to `frontend-ci.yml` run the real job
  instead of the bypass.
- Frontend-configured `npx vitest run`: **174 tests passed across seven files**.
- CI on PR #158 (Node 20): the `Unit tests` step ran and **174 tests passed
  across seven files** ([job log](https://github.com/Kakrl/MakeShift/actions/runs/36744857972/job/109988354672)).

### After merging `main` at `47400c7` (2026-10-01)

PR #148 merged after the run above and changed key contact and calibration.
On `main`, 23 of 236 Vitest cases failed. Nothing caught it because Vitest was
not in CI yet.

- 18 needed test updates for #148, now in this PR. Both suites stub
  `getComputedStyle` and the canvas methods the new overlays call.
  `recordingControls.test.tsx` passes `HandObservation` objects and runs the
  real `LiveContactPipeline` in its overlap-only mode, since jsdom has no
  `Worker` and the fixture has no depth calibration. Contact now highlights
  keys before a session starts (intended in #148), so the highlight test
  expects that and still checks that an interrupted session records nothing.
- 5 cases in `calibrationWorkflow.test.tsx` (6.2.3) found a real defect, D21
  ([#162](https://github.com/Kakrl/MakeShift/issues/162)). They are marked
  `it.fails` and linked to the issue. The fix PR switches them back to `it()`.
- Local result: **231 passed and 5 expected failures across 11 files**. CI on
  PR #158 (Node 20) matched ([job log](https://github.com/Kakrl/MakeShift/actions/runs/36897106200/job/110486733691)).

## Documentation Expectations by Severity

Not every defect needs the same amount of documentation. Use this table to
decide what to record.

| Severity | Examples | Documentation Required |
| :--- | :--- | :--- |
| High | A core workflow is broken or a High priority requirement fails: no sound on a detected key press, latency over 50 ms, calibration can't be completed, a merged feature is missing from the app, wrong notes play | Defect issue from the template, a row in Known Defects, and a full RCA comment on the issue after the fix, logged in the RCA table. The fix PR must name its regression test |
| Medium | A requirement is degraded or verification has a gap, but a workaround exists: tests not running in CI, a test that passes without checking anything, a resource leak on repeated actions, debug logging in a hot loop | Defect issue from the template and a row in Known Defects. RCA only if the team or mentor asks. The fix PR links the issue |
| Low | Cosmetic issues, dead code, stale docs, lint warnings, or edge cases with no user impact | A row in Known Defects or a line in the fixing PR description. No issue required |

Aim for 2 to 3 postmortem RCAs per build checkpoint unless the team mentor
asks for more.

The defect selected for the assignment requires an RCA regardless of severity.
Select **Assignment example (required)** in its issue form. On older issues, or
when the team requests an additional RCA, apply the `rca-required` issue label
(create that label if it does not exist). High severity is read from the issue
form's **Severity** field. Defect targets must retain the `bug` label.

## High Severity Bug Workflow

Follow these steps from discovery through publication of the RCA. Automatic
checks and comments are available once the RCA workflow is merged into `main`
(see [initial rollout and recovery](#automated-checks-publication-and-recovery)).
The assignment example follows the same RCA steps even at a lower severity.

1. **Report the defect.** Create a GitHub issue with the
   [defect report template](../.github/ISSUE_TEMPLATE/defect_report.yml), select
   **High** severity, and keep the `bug` label. Include the affected requirement,
   reproduction steps, expected and actual results, environment, and evidence.
   Identify the test that exposed it, or explain if it was found another way.
2. **Track it here.** Add or update its row in [Known Defects](#known-defects),
   linking the issue and marking it Open. Reuse an existing row for the same bug.
3. **Fix and verify.** Create a `fix/<issue>-short-description` branch using the
   [repository workflow](../docs/dev_process.md). Reproduce the failure, make
   the fix, add or identify a regression test that catches it, and run the checks
   for the affected areas. Record actual results and evidence links.
4. **Open the fix PR and write the RCA.** Target upstream `main` and include
   `Closes #N`. Copy the [RCA PR template](#rca-pr-template) into the description,
   set its explicit issue number, and complete all seven sections. Use a separate
   block for each defect. Open as a draft if you still need its PR number to
   complete the documentation.
5. **Complete the records in the same PR.** Fill all eight cells of the
   [RCA log](#root-cause-analysis-log), including the defect issue URL, fix PR
   URL, and regression test. Update the
   [verification inventory](verification_test_inventory.md) for any new or
   changed tests. If manual testing validates a critical workflow or exposes
   the defect, copy the [manual template](manual/manual_test_template.md) to
   `manual/YYYY-MM-DD_<test-case-id>.md`, record the results, and link the report
   in the inventory. Prepare the Known Defects status change so it records the
   fix when the PR merges.
6. **Review before merging.** Obtain at least one reviewer approval and passing
   required checks. The `RCA requirements` check validates the RCA fields,
   evidence link, target issues, and log rows. The reviewer verifies that the
   analysis, test results, and regression coverage are accurate; the check does
   not establish those facts. Request another review of substantive RCA edits.
7. **Merge and confirm publication.** Automation posts the RCA to each explicit
   defect issue with the fix PR and merged commit links. You do not need to copy
   the comment manually. Confirm that `Publish RCA` succeeded and the comment
   is present. For a failure, follow the
   [recovery steps](#automated-checks-publication-and-recovery); rerunning the
   job reuses existing bot comments instead of creating duplicates.

## Known Defects

Found in the codebase audit for issue #79 (2026-09-16, upstream `main` at
`c4cc55b`). Status is updated when a fix merges. "Issue" is filled in once a
defect report is filed.

| ID | Severity | Area | Defect | Location | Issue | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| D1 | High | CV / UI | (Req 1.1, 3.2) The ArUco marker and virtual keyboard overlay from PR #63 never renders. `MarkerTrackingOverlay` is imported in `page.tsx` but no JSX uses it. The `<MarkerTrackingOverlay videoRef={videoRef} />` element was dropped while resolving conflicts in merge `1669079` ("Merge branch 'main' into feature/visual-keyboard"). ESLint flags it as an unused variable, but warnings don't fail CI | `frontend/src/app/page.tsx:10` | | Open |
| D2 | High | MIDI / UI | (Req 4.1, 4.2) Original audit found UI-only recording/export. Recording now calls the recorder through shared-event consumers (#139); production download is verified locally by 4.2.3 (#141, D18). Delete clears the completed take but lacks browser verification; Listen has no handler. Issue #88 adds recorder-owned UI state and accessible pause/count-in announcements. Real-file parsing exposed origin chords shifted by the writer treating tick zero as absent; explicit ticks fix that locally. Complete file-control coverage in 4.2.2 remains pending. | `frontend/src/app/page.tsx`, `frontend/src/events/pianoIntegration.ts` | [#28](https://github.com/Kakrl/MakeShift/issues/28), [#140](https://github.com/Kakrl/MakeShift/issues/140) | Recording/export fixes verified locally in [#139](https://github.com/Kakrl/MakeShift/pull/139) / [#141](https://github.com/Kakrl/MakeShift/pull/141); review/merge pending; Listen and full file-control verification open |
| D3 | Medium | CI | The Vitest suite (4.1.3-4.1.7, 4.2.3) is not run in CI. `frontend-ci.yml` runs lint, type check, contrast, and build, but not `vitest run`, so MIDI regressions merge undetected | `.github/workflows/frontend-ci.yml` | [#152](https://github.com/Kakrl/MakeShift/issues/152) | Fixed in [#158](https://github.com/Kakrl/MakeShift/pull/158) |
| D4 | Medium | CI | The C++ test path filter `'CMakeLists.txt'` only matches a root-level file. A PR that only changes `backend/CMakeLists.txt` skips the C++ build and tests. It should be `'**/CMakeLists.txt'` | `.github/workflows/testing.yml:29` | | Open |
| D5 | Medium | Tests | `AudioEngineTest.StreamStartsAndStops` and `MultipleStartStopCycles` `return` early when there is no audio device, so on CI they report PASS without testing anything. Use `GTEST_SKIP()` so the skip shows in results | `tests/audio/test_audio.cpp:24-27`, `:35-38` | | Open |
| D6 | Medium | Calibration | Versioned geometry/camera/layout and rest inputs replace the boolean; live compatibility gates reuse. Manual calibration checklist passed (Carl Xu, user-reported 2026-09-28). | `frontend/src/cv/calibration.ts`, `frontend/src/app/calibration/page.tsx` | [#87](https://github.com/Kakrl/MakeShift/issues/87) | Manual verification passed (user-reported); review/merge pending |
| D7 | Medium | CV / performance | Remaining automatic CV telemetry and detector debug logging at #140 base; older per-frame logs were already removed upstream. #38 replaces telemetry with opt-in bounded reports and removes debug logging. | `frontend/src/diagnostics/performanceMetrics.ts`, `frontend/src/cv/markerDetector.ts`; [diagnostics](../docs/performance.md) | [#149](https://github.com/Kakrl/MakeShift/issues/149) | Fixed on feature/38-pipeline-metrics; verified locally, merge pending |
| D8 | Medium | Audio | Calling `AudioEngine::startStream()` twice overwrites `stream` without closing it, which leaks the first PortAudio stream. `Pa_GetDeviceInfo` is dereferenced without a null check | `backend/src/audio/AudioEngine.cpp:89-119` | | Open |
| D9 | Medium | Audio / Python | Importing `backend.src.audio` builds an `AudioEngine` and calls `Pa_Initialize()` as a side effect. Any import (including from pytest) touches audio hardware and fails if the extension is not built. The example in `docs/audio_events.md` creates a second engine | `backend/src/audio/__init__.py:3-5` | | Open |
| D10 | Low | CV | `HandTrackingOverlay` loads MediaPipe WASM from `@latest`, the version mismatch that #12 fixed in `useHandLandmarker`. The component isn't used right now | `frontend/src/app/cv/HandTrackingOverlay.tsx:7-8` | | Fixed on `feature/116-89-supabase-vercel` (#89): WASM path reuses the pinned version |
| D11 | Low | MIDI | Original recorder kept a writable track after Stop. The instance-owned recorder now rejects paused/stopped input; real-writer lifecycle regression also verifies stopped input cannot leak into export or the next take. | `frontend/src/app/midi/midiUtils.ts` | [#88](https://github.com/Kakrl/MakeShift/issues/88) | Fixed locally; regression passed 2026-10-05; PR and review pending |
| D12 | Low | Backend | `backend/src/MIDI/noteMap.ts` is a TypeScript file inside the Python backend package and nothing imports it | `backend/src/MIDI/noteMap.ts` | | Open |
| D13 | Low | Tests | The contrast audit only checks `--color-*` token pairs. Hardcoded canvas colors drawn over live video (`#00ff88`, `#ffd60a`, `#ff3b30`) aren't checked | `frontend/src/app/MarkerTrackingOverlay.tsx:136-192`, `frontend/src/app/cv/handLandmarkDrawing.ts:33-34` | | Open |
| D14 | Low | Tests | The only Python test is `test_dummy.py`, so the pytest coverage report in CI measures nothing | `tests/python/test_dummy.py` | | Open |
| D15 | Low | Docs | The root README said Python 3.10+ for the C++ build, but `backend/CMakeLists.txt` requires Python 3.12 | `README.md` | | Fixed in #79 PR |
| D16 | Low | Tests | Browser audio smoke runner checks context closure immediately after URL navigation, before React's unmount effect may run. The unchanged runner failed; a bounded cleanup-wait diagnostic passed during #86 verification | `tests/frontend/browserAudio.browser.mjs` | [#105](https://github.com/Kakrl/MakeShift/issues/105) | Fix implemented for #105; bounded wait and final assertion verified locally ([evidence](#navigation-cleanup-verification-issue-105)); merge pending |
| D17 | Medium | UI | (Req 3.1, 3.4) The UI is not responsive. Home, calibration, and about use a fixed 267 px side column with no breakpoints, and `body` is `h-dvh overflow-hidden`, so at tablet or phone widths, short laptop screens, or 200% zoom the camera is squeezed and controls are clipped with no way to scroll to them | `frontend/src/app/layout.tsx:32`, `frontend/src/app/page.tsx:213-400`, `frontend/src/app/calibration/page.tsx:669-681`, `frontend/src/app/about/page.tsx:42-63` | [#109](https://github.com/Kakrl/MakeShift/issues/109) | Fixed in [#111](https://github.com/Kakrl/MakeShift/pull/111) |
| D18 | High | MIDI / UI | Runtime path alias points midi-writer-js at a declarations-only file, so final Export throws on undefined Track and produces no download (Req 4.2) | `frontend/tsconfig.json` | [#140](https://github.com/Kakrl/MakeShift/issues/140) | Fix verified locally in [#141](https://github.com/Kakrl/MakeShift/pull/141); review/merge pending |
| D19 | Medium | CI | The `Vercel preview` workflow fails on every fork PR: `actions/checkout` refuses fork code in `pull_request_target` unless the step sets `allow-unsafe-pr-checkout: true`, so labeling `preview-link` never deploys | `.github/workflows/preview.yml:33-39` | [#160](https://github.com/Kakrl/MakeShift/issues/160) | Open |
| D20 | High | UI | (Req 3.1, 3.2, 4.2, 6.2) Merge `30706c4` (PR #98) resolved `page.tsx` by keeping the branch's older JSX, dropping the welcome and Calibration intro modals, count-in overlay, Recording Complete banner, Delete confirmation, calibration prompt, `CameraStatusOverlay`, and the aria-live region. The home Calibration tab and Delete button did nothing. ESLint flagged the orphaned state only as warnings | `frontend/src/app/page.tsx` | [#112](https://github.com/Kakrl/MakeShift/issues/112) | Fixed in [#113](https://github.com/Kakrl/MakeShift/pull/113) |
| D22 | Medium | Calibration | Final depth sheet-check exception removed capture/Next controls. Reset collector/index on exception so all five depth positions can be retried. | `frontend/src/app/calibration/page.tsx` | [#178](https://github.com/Kakrl/MakeShift/issues/178) | Fixed in PR #177; local 6.2.3 regression passed; CI/merge pending |
| D21 | High | Calibration | (Req 6.2, 1.1, 2.1) #148 replaced the reachable result capture with depth buttons and navigated before validation/save. Final depth capture now creates the primary result; completion retains its model and saves both records before navigation. 6.2.3's expected failures are restored as passing regressions. | `frontend/src/app/calibration/page.tsx` | [#162](https://github.com/Kakrl/MakeShift/issues/162) | Fix verified locally 2026-10-06; review/merge and physical check pending |

| D23 | Medium | Audio | (Req 2.4, related 2.2) User reports high-velocity strikes are not loud enough and wants more apparent velocity dynamics. Listening report 2026-10-14; cause and hardware verification pending. | `frontend/src/cv/fingerVelocity.ts`, `frontend/public/audio/synth.js` | [#209](https://github.com/Kakrl/MakeShift/issues/209) | DSP tuning implemented locally; [verification and listening limits](manual/2026-10-14_209-velocity.md); user confirmed audible velocity changes locally 2026-10-14; measured trials/chord distortion checks pending |

## Root Cause Analysis Log

Every completed RCA is listed here. Add its row in the fix PR so it receives
review with the fix. The full analysis is automatically posted as an issue
comment after merge. Link the issue before the comment exists.

| Defect | Issue | Severity | Root Cause (one line) | Fix PR | Regression Test | RCA Date | Author |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Calibration can become stuck after depth validation fails | [#194](https://github.com/Kakrl/MakeShift/issues/194) | High | #177 added final calibration checks, but failure returns left the depth capture index outside the five-position list; backward navigation also discarded the primary result while retaining completed depth models. | [#195](https://github.com/Kakrl/MakeShift/pull/195) | 6.2.3 — `tests/frontend/calibrationWorkflow.test.tsx`; retry after final camera-settings validation failure and back/forward navigation after both hand captures; frontend CI | 2026-10-14 | Francis Ozua (Codex-assisted) |
| Calibration completion loses validated result | [#162](https://github.com/Kakrl/MakeShift/issues/162) | High | Replacing step five with depth buttons bypassed primary-result creation; completion cleared the model and navigated before validation/save. | [#177](https://github.com/Kakrl/MakeShift/pull/177) | 6.2.3 — `tests/frontend/calibrationWorkflow.test.tsx`, 14 normal workflow regressions run in `frontend-ci.yml`; local execution linked above | 2026-10-06 | Carl Xu (Codex-assisted) |

| MIDI recording lifecycle and origin-chord export | [#88](https://github.com/Kakrl/MakeShift/issues/88) | High | UI-only controls and retained writable tracks caused D2/D11; subsequent writer mocks missed falsy tick-zero handling and duplicate end markers, while UI booleans misreported paused capture. | [#173](https://github.com/Kakrl/MakeShift/pull/173) | 4.2.3 real-writer `recordingExport.test.ts` and production MIDI download; 3.2.2/4.1.2 `recordingControls.test.tsx`; Vitest runs in frontend-ci.yml | 2026-10-05 | Carl Xu (Codex-assisted) |
| MIDI note-off events missing required duration information | [#91](https://github.com/Kakrl/MakeShift/issues/91) | Medium | Custom MidiWriterJS TypeScript declarations hid the library's required note event fields, allowing invalid note-off event construction. | [#92](https://github.com/Kakrl/MakeShift/pull/92) | `tests/frontend/midiUtils.test.ts` — `creates a note event using the note start time and duration` (not currently run in CI) | 2026-09-20 | harrydeng104 |
| Home page modals and overlays dropped in merge 30706c4 | [#112](https://github.com/Kakrl/MakeShift/issues/112) | High | A conflict in `page.tsx` was resolved by keeping the older branch JSX, and ESLint reported the orphaned state only as warnings, so CI passed. | [#113](https://github.com/Kakrl/MakeShift/pull/113) | `tests/frontend/homePage.test.ts` (3.1.3, 3.2.3, 3.2.4, 6.2.4; not run in CI until D3) plus `no-unused-vars` as an ESLint error (runs in `frontend-ci.yml`) | 2026-09-23 | jaddenki |
| Production MIDI export fails | [#140](https://github.com/Kakrl/MakeShift/issues/140) | High | TypeScript path alias to a .d.ts file erased the runtime MIDI module in Turbopack; mocked tests bypassed it. | [#141](https://github.com/Kakrl/MakeShift/pull/141) | 4.2.3; `tests/frontend/midiExport.browser.mjs`, production download bytes and dialog closure; local only | 2026-09-29 | Carl Xu (Codex-assisted) |

### RCA PR Template

Copy this block into the fix PR description, replacing `123` with the target
defect issue number. Repeat the block for each defect and add `Closes #123`
outside the block for each target. Only same-repository bug issues that GitHub
recognizes as closed by the PR are eligible. Ordinary PRs need no RCA block.
Keep the exact headings and replace every placeholder with actual analysis.

```markdown
<!-- rca:start issue=123 -->
### Root cause
<The mechanism that caused the defect, not just its symptom.>

### Discovery
<How the defect was discovered.>

### Exposing test
<Test ID or report. If no test caught it, explain why.>

### Fix verification
<Actual test results and an HTTPS link to the CI run, report, or other evidence.>

### Regression test
<Test ID, file, and whether it runs in CI.>

### Remaining risk
<Where else the issue could occur, what was checked, and what remains.>

### Process improvement
<What changes to catch this earlier, or explain why no change is needed.>
<!-- rca:end -->
```

Complete all eight cells of the log row above; do not leave `TBD` or placeholder
values. Use Markdown links with full URLs in the Issue and Fix PR cells:
`[#123](https://github.com/Kakrl/MakeShift/issues/123)` and
`[#124](https://github.com/Kakrl/MakeShift/pull/124)`. Open a draft PR to get
its number, then commit the log row before requesting review. Avoid table pipes
inside cells. The regression test must be identified, not invented.

### Automated checks, publication, and recovery

The read-only `RCA requirements` job runs on PR opening, description edits,
new commits, reopening, and readiness for review. It requires an RCA for every
closing High severity or explicitly RCA-required issue. Changing issue fields
does not itself trigger a PR run; rerun the check or edit the PR description
after changing severity or assignment selection. Reviewers must ensure all
fixed defects are linked and verify the evidence before merge.

After merge, `Publish RCA` validates again using the merged README and posts
one comment per explicit RCA target. It includes the fix PR and merged commit.
A stable PR/issue marker identifies its own bot comment, so reruns update that
comment instead of duplicating it. All targets validate before posting begins;
an API failure may still leave some comments posted and others pending.

If publication fails:

1. Open **Actions → RCA**, select the run for the merged PR, and inspect the
   `Publish RCA` failure. API/permission failures appear as failed jobs.
2. Restore the required repository permissions or resolve the transient API
   problem, then choose **Re-run failed jobs** (or **Re-run all jobs**).
   Previously posted comments are reused, including after partial failure.
3. A rerun uses the original merge event's PR description and original merged
   README. Editing a merged PR does not repair that snapshot. If the RCA text
   or log was incomplete, submit a reviewed follow-up PR with corrected RCA
   blocks, closing references, and log rows pointing to the follow-up PR.
   That PR publishes its own attributable correction; do not fabricate evidence
   to make the old run pass.

The workflow executes scripts only from the trusted base commit. PR descriptions
and README files are fetched as data, never executed. Only the publication job
has `issues: write`; regression tests run separately with a read-only token.
There is no AI-generated analysis or automatic assertion that tests passed.

**Initial rollout:** the trusted workflow becomes active after this change
lands on `main`; its own regression suite runs in the introducing PR. Once the
`RCA requirements` check appears, a maintainer should make it required in the
branch protection/ruleset alongside existing checks. The workflow alone does
not change repository merge settings. A missing required check on the first
rollout is not evidence that an RCA was validated.

## Browser envelope verification (issue #27)

Local Windows verification on 2026-09-24, branch
`feature/27-browser-envelopes`, Node 22.20.0 and Vitest 4.1.11:

- All 132 Vitest tests passed (71 DSP, including 34 new ADSR cases; 43 shared
  events, 11 browser lifecycle, seven MIDI). Default sustain RMS expectation
  changed from full level to 0.7; pitch/velocity/session coverage still passes.
- ADSR cases cover sample timing at six rates (8–384 kHz), every active-stage
  note-off, duplicate release, independent repeated-pitch presses, hard stealing
  during attack/decay/sustain/release, zero/sub-sample durations, parameter
  validation, slot reuse, block continuity, and boundary discontinuity bounds.
- Lint passed with zero errors and eight existing warnings in the home page
  and marker overlay. TypeScript and all 18 contrast pairs passed.
- Production build passed (Next.js 16.2.3).
- The unchanged production browser runner passed locally in Edge 153.0.4234.48:
  worklet HTTP 200, soft/loud RMS 0.0099406937 / 0.0298220811, chord output,
  stop silence, suspension recovery and navigation closure. This run passed
  despite the previously recorded D16 timing race; D16 is not fixed here.
- [Listening report 2.2.18](manual/2026-09-24_2.2.18.md): user-reported PASS
  on 2026-09-24: intended behavior, no sudden stopping and no audible pops.
  Browser/device and exact tested commit were not supplied. No measured physical
  latency, universally seamless stealing, or realistic piano timbre is claimed.
- Vitest remains outside CI (D3); no GitHub Actions execution is claimed.

## Calibration verification (issue #87)

Windows, 2026-09-27, Node 22.20.0, Vitest 4.1.11, working tree based on
614203f on fix/87-calibration-result. `npm ci` restored locked dependencies.

- All 169 tests passed across seven files: 12 calibration contract/geometry
  cases, six simulated calibration workflow cases, and six recording controls
  cases including invalidation while holding a key. Other existing suites passed.
- TypeScript passed. ESLint passed with five pre-existing unused-variable
  warnings in the home page. All 18 contrast pairs and production build passed.
- Calibration cases cover copied validated data, legacy flags, versions,
  coordinate convention, missing/duplicate markers, degenerate geometry,
  finite complete hand samples, MIDI bounds, perspective/key round trips,
  corrupt/denied storage, and camera/sheet/layout/movement compatibility.
- Workflow cases cover missing markers with retry, hover/rest capture failures,
  validated save, denied writes without navigation, and rechecking before save.
- Vitest is still absent from frontend CI (D3). These are local results;
  Actions execution and reviewer approval remain separate from local results.
- Carl Xu reported successful completion of the seven-step manual calibration
  checklist on 2026-09-28: marker/hand rejection and retry, saved result, reload
  reuse, sheet-loss interruption, corrupt-data recovery and camera-permission
  recovery. See the [passing manual report](manual/2026-09-27_6.2.2.md).
  Browser/device details and exact tested commit were not supplied. This is
  user-reported evidence, not independently observed or measured contact/latency
  verification.


## Session readiness verification (issue #24)

Local Windows execution on 2026-09-28, Node 22.20.0, Vitest 4.1.11,
`feature/24-session-gating`, stacked on #87 commit `71d44b2`:

- 196 tests passed across eight files. New `liveSession.test.ts` has 22 cases:
  invalid/mismatched calibration, missing tracking, transition sequence, startup
  cancellation, fresh identities, stale events, release on interruption,
  watchdog expiry/delayed execution, independent detector freshness, audio
  rejection, malformed events, retry, changed calibration and teardown.
- `recordingControls.test.tsx` now has ten simulated page/coordinator/marker
  cases. Existing pause/resume and calibration tests still pass through the
  gate; new cases cover audio interruption/restart, initial pending-start Stop,
  pagehide and repeated Play during initialization.
- `browserAudioLifecycle.test.ts` now has twelve cases, adding the real
  BrowserAudio owner with mocked context/worklet: startup reset, suspension,
  reset command, explicit reactivation and obsolete-session rejection.
- TypeScript passed. ESLint passed with five pre-existing unused-variable
  warnings in the home page. All 18 contrast pairs and production build passed.
- Vitest is not invoked by CI (D3); Actions evidence remains pending. These
  mocks establish neither device audibility nor physical latency/accuracy.
- Carl Xu reported all manual session-readiness checks passing on 2026-09-28,
  including calibration loss/recovery, audio suspension/reactivation, background
  and navigation, camera loss, startup recovery, Stop/restart and Pause/resume.
  See the [passing manual report](manual/2026-09-28_2.1.6.md). Results are
  user-reported; browser/device details, exact tested commit and per-step
  artifacts were not supplied. No quantitative latency/accuracy claim follows.
  Required independent review remains pending.

## One-octave integration verification (issue #28)

Windows, 2026-09-29, branch feature/28-browser-piano-integration, based on
#24 at 5d5f0b8 plus #137 at 7c2f77c (combined base b37db8d).

- All 213 Vitest tests passed across nine files. The 15 new deterministic
  pianoIntegration cases exercise eight pitches through production DSP, accepted
  note feedback and recording, velocity conversion, observer timing, chords,
  repeated presses, immediate Stop, same-pitch identities, tracking interruption,
  stale producers, audio rejection, invalid keys and invalid velocity.
- recordingControls now has 12 cases: the original ten still pass; added canvas
  highlight gating and immediate-Stop recording assertions use the real page,
  coordinator and geometry with simulated camera/hand/audio inputs.
- TypeScript passed. Lint passed with five existing home-page unused-variable
  warnings. All 18 contrast pairs and the Next.js 16.2.3 production build passed. Vitest remains outside CI (D3); no Actions
  execution is claimed.
- MIDI uses event observation times, independent press identities and normalized
  velocity × 100 for the writer. Existing recorder default-time/pause/export
  tests passed unchanged. Accepted history drains before lifecycle snapshots.
- Carl Xu reported the [manual checklist](manual/2026-09-29_2.1.2.md) passed
  on 2026-09-29, including successful export retest after the separate #141 fix
  for #140. That export fix is not included in PR #139 alone. Browser/device
  details, exact tested commit and per-step artifacts were not supplied.
- This user-reported pass does not establish intentional contact, measured
  finger-speed velocity, deployed cross-browser behavior, under-50-ms latency
  or under-3% errors. Independent review remains pending. This update changes
  documentation only; prior automated results are retained without a rerun.

Merge compatibility at implementation commit fc8f4f6: normal merge against the
resolved dependency base b37db8d produced the identical implementation tree
3142af798b00f2cc5287dd7bcd1d8076c230e90e. A simulated squash of all dependency
contents onto main 614203f conflicts if merged naively (ancestry is lost).
Transplanting only #28, using b37db8d as the merge base, passed with the same
identical tree. The historical transplant check below has been superseded by PR #139
merge reconciliation; do not replay the dependency commits. These checks use the
current heads, not unknown future edits. No existing PR or main was modified.

## MIDI export runtime verification (issue #140)

Local Windows execution on 2026-09-29; fix implementation 45304f6, based on
#139 head 025588e. Edge 154.0.4258.37, Playwright 1.62.1, Next.js 16.2.3.

- Baseline production page: seed a C3 completed take, open export and click the
  final Export button. Browser raised "Cannot read properties of undefined
  (reading 'Track')" in client chunk 15z31avwcs4s~.js; no download occurred.
  The user independently reported the same visible failure; browser unspecified.
- Root cause is the midi-writer-js paths entry targeting build/types/main.d.ts.
  Turbopack compiled the runtime import to undefined. Removing it and adding
  a type-only bridge to the shipped declarations preserves actual runtime code.
- Fixed production build: npm run test:midi-browser passed. Two downloads named
  recording.mid had exact valid MIDI bytes: one track, 128 ticks/quarter,
  120 BPM, C3/MIDI 48, velocity 102 and note-off after 128 ticks (500 ms).
  Both final Export clicks closed the dialog; no browser page errors.
- All 213 Vitest tests, TypeScript, production build and all 18 contrast pairs
  passed. Lint passed with five existing unused-variable home-page warnings.
- Browser regression uses guarded private React state injection for a completed
  take and actual production UI/library/downloads. It intentionally excludes CV,
  physical recording, audible playback, other browsers and timing requirements.
  UI hook changes require updating the fixture; failures are never skipped.
- Source: [browser regression](frontend/midiExport.browser.mjs). CI does not run
  this browser test or Vitest (D3); Actions execution remains pending. No new
  requirement or scope change. Listen remains unfinished; on the reconciled
  branch Delete clears the completed take but lacks browser verification.

User baseline failure and automated fix are recorded separately in the
[manual report](manual/2026-09-29_4.2.3.md); Carl Xu reported the export fix retest passed on 2026-09-29.
## Pipeline diagnostics verification (issue #38)

Executed locally on 2026-09-29 against implementation commit
`a482a18d56fc3713b4725313054866f37b89abc2`, Windows / Node 22.20.0,
Next.js 16.2.3, Vitest 4.1.11 and Playwright 1.62.1.

- All **228 tests in 11 files passed**, including 13 metrics cases and two
  real CameraProvider/mocked-media lifecycle cases. Metrics cases cover
  disabled logging/collection, full-run aggregates versus bounded rolling
  quantiles, invalid and unavailable values, positive/negative clock offsets,
  fresh media-time polls versus actual presentation advances, dropped callback
  gaps, stream resets, stop/restart, copied/bounded snapshots and metadata,
  incompatible workload rejection, repeated resource release, async audio
  closure and isolated paired overhead measurement.
- TypeScript, production build, all 18 contrast pairs and whitespace checks
  passed. Lint passed with the same five pre-existing home-page warnings.
  Source scan found no debug log/info calls in CV/overlay paths.
- `npm run test:performance-browser` passed in headless Edge **154.0.4258.37**.
  Three audio enable/chord/stop + home CV + client navigation cycles completed,
  every created browser AudioContext closed, and there were no page errors.
  MediaPipe initialized with the GPU delegate in all three cycles. At the final
  snapshot, audio contexts/worklet nodes/hand models/marker detectors were zero,
  while the shared CameraProvider correctly retained one track. Worker count was
  unavailable (not implemented). Unit tests separately checked provider teardown
  stops tracks and does not double-decrement after an ended event.

Representative synthetic profile: Intel Core i9-14900K, 64 GiB RAM, 32 reported
logical cores, synthetic 1920x1080 camera reporting 20 FPS, headless audio.
The app requested its normal camera defaults; no keyboard sheet, hands or
calibration were supplied. Initial camera settings were unavailable because
acquisition was still pending; export recorded the actual settings above.
This is a **startup/navigation workload**, not steady intentional playing.
The 29,120.8 ms run observed 785 processing polls, 266 presentation callbacks,
20.028 delivered FPS, 38.809 processing polls/s and 57 missed callback
presentations. Processing can revisit decoded frames and is not camera FPS.

| Software metric | Samples | Whole-run mean ms | Recent p50 ms | Recent p95 ms | Whole-run max ms |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Hand inference | 785 | 12.724 | 8.000 | 12.500 | 2607.200 |
| Marker detection | 161 | 41.763 | 43.500 | 51.000 | 112.200 |
| Presentation-to-callback age | 219 | 18.233 | 14.900 | 46.400 | 59.400 |
| Video callback interval | 263 | 60.752 | 61.500 | 109.900 | 200.100 |

p50/p95 use the latest 256 valid samples at most; negative/nonfinite intervals
are rejected, so not every video callback supplies a valid frame-age sample.
The cold inference maximum must not be represented as warm inference latency.
Contact/collision, event delivery and worker transfer were unavailable in this
uncalibrated fixture; no zero-time claim is made. No physical output was timed.
JS heap snapshots ranged from 5,071,783 bytes at startup to 101,685,956 bytes at
stop. Loading models and uncontrolled GC make this unsuitable as a leak verdict.
Long sessions, native/GPU memory, other hardware and other browsers are unverified.

Instrumentation overhead: six alternating 20,000-call hook pairs after warm-up
reported an average increment of **0.00000917 ms/call**. This is close to timer
resolution and excludes callback registration, caller clocks, snapshots and
export. Matched warm-scene rAF trials (same synthetic input, four seconds each):

| Diagnostics | rAF intervals | Mean interval ms | p95 interval ms |
| :--- | ---: | ---: | ---: |
| Off, first pair | 238 | 16.831 | 66.700 |
| On, first pair | 187 | 21.628 | 77.200 |
| On, reversed pair | 224 | 18.057 | 72.200 |
| Off, reversed pair | 204 | 19.826 | 72.500 |

Pair differences were +4.798 and -1.769 ms in mean interval. These short,
variable trials do **not** establish negligible overhead or a physical latency
pass. Keep diagnostics off for normal playing. The software implementation,
profiling protocol, metric boundaries and reproduction commands are in
[performance documentation](../docs/performance.md). Raw local reports are in
ignored `frontend/test-results/performance/profile.json` and `overhead.json`.
Inventory 2.3.2 remains partial; physical stage/render and worker tests remain
pending. Neither Vitest nor this profiling runner runs in CI (D3); Actions and
reviewer evidence are not claimed.

Merge verification uses dependency base
`b5245ea31fc2c6c3e56608fe9cac4682ab771666` and main
`614203fe00af2db95001a1ce77105ba4dd9b7d52`. All current heads for #136-#141 are
ancestors of that base. Temporary Git merge objects with the resolved dependency
tree verified both a normal merge and a squash transplant of only #38 without
conflicts, with output identical to the feature tree. After real squash merges,
use the documented rebase boundary and rerun checks; later edits and unrelated
contributor PR #113 are not covered. No existing branch or PR was modified.

The required Medium D7 defect is tracked in
[#149](https://github.com/Kakrl/MakeShift/issues/149), with the bug label and
standard severity policy. Its fix is verified locally; issue closure follows
PR merge. No RCA is required under the standard Medium policy.
## Camera feed layout verification (issue #156)

Local execution on macOS, 2026-10-01, Node 26.8.1, Playwright bundled
Chromium 151.0.7922.34, production build served by `next start`.

- `npm run test:layout-browser` passed in 20 layouts: 1024x768, 1440x900,
  1920x1080, 2560x1080 and 390x844, each in the default state, after a
  recording finishes (Export and Delete visible), with the audio error alert,
  and with both. The feed stayed 16:9 within 1%, inside its wrapper and the
  viewport width; on `lg` it matched the calibration camera and about content
  box sizes within 1 px. The session status line stayed above the feed and the
  in-feed calibration message stayed inside the feed.
- Feed sizes, the same in every state: 681x383 (1024x768), 1066x600
  (1440x900), 1545x869 (1920x1080), 2185x1229 (2560x1080) and 358x201
  (390x844). At 2560x1080 the feed, like the calibration camera, extends below
  the viewport.
- Regression check: the earlier fit-to-height layout gave 963x542 at
  1920x1080, smaller than calibration's 1545x869, which this test rejects.
- The completed take is seeded through Home's React hooks and the error through
  Home's LiveSession, with guarded lookups like the MIDI export test. The test
  does not use a physical camera or printed sheet. CI does not run it.
- Source: [browser regression](frontend/cameraLayout.browser.mjs).

## PR #136 review verification

Local Windows execution on 2026-09-29, Node 22.20.0, Vitest 4.1.11,
branch `fix/87-calibration-result`, following review of issue #87 / PR #136.

- Frontend-configured `npx vitest run`: **174 tests passed across seven files**,
  including eleven recording-control integration cases. Five added cases cover
  immediate/ten-second marker cadence, free play across MIDI recording states,
  calibration loss, immediate frame-loss recovery, and stale audio initialization.
  Existing held-key resume and cancellation cases also pass. Audio dispatch is
  mocked; no hardware sound, FPS improvement or physical latency is measured.
- TypeScript, ESLint (five existing unused-variable warnings), all 18 contrast
  pairs and production build passed. Run commands from `frontend/`.
- An initial accidental repository-root Vitest invocation used an unconfigured
  runner and failed dependency/mock resolution; the configured frontend run above
  is the verification result. Its temporary root cache was removed.
- The ten-second cadence permits up to ten seconds before detecting sheet loss;
  frame loss still interrupts on the next animation frame. The earlier user
  manual report predates these edits; new physical/manual verification is pending.
- Vitest remains outside frontend CI (D3); Actions execution is pending.

## Deployment verification (issues #89 and #116)

Local macOS execution on 2026-09-30, Node 26.8.1, Playwright Chromium
151.0.7922.34, branch `feature/116-89-supabase-vercel`.

- `npx vitest run`: **178 tests passed across eight files**, including four
  `/api/health` database-check cases. TypeScript, ESLint (five existing
  warnings), 18 contrast pairs and production build passed.
- `npm run test:deployment` against `next start` passed: five runtime assets
  with expected types, five pages without uncaught errors, three
  enable/play/stop rounds with zero network requests, and camera denial,
  retry, track loss and recovery. With `infisical run --env=dev` and
  `EXPECT_DATABASE=ok`, `/api/health` returned `200 {"status":"ok"}`.
- Regression check: with the camera track-end handler removed, the test failed
  waiting for "Camera disconnected"; it passed again once restored.
- Review follow-up (PR #153): the test now requires the model as
  `application/octet-stream`, waits for MediaPipe (`/`) and both calibration
  detectors to report ready with no displayed alerts, checks fresh preview
  frames from the new stream after each camera retry, and accepts only
  `200 ok` or `503 unconfigured` from `/api/health`. It passed against
  `next start`; it failed with a broken model path (`data-hand-detection`
  reported `error`) and with the calibration preview kept on the old stream
  (timed out waiting for the new stream after the disconnect retry).
- `npm run test:audio-browser` passed with `AUDIO_BROWSER_CHANNEL=chromium`.
- After merging `main` (`0758dea`): 232 Vitest tests across ten files, lint,
  types, contrast, build and `npm run test:deployment` passed. The browser
  audio test, unchanged from `main`, passed 2 of 5 Chromium runs; failures hit
  the soft/loud RMS ratio check (`loud / soft` within 0.1 of 3).
- After merging `main` (`b81c86c`, which adds #148 and the Vitest step from
  #158): 235 Vitest tests passed and 5 expected failures (D21, #162) across 12
  files. Lint, types, contrast, build and `npm run test:deployment` passed on
  all five pages. The Vitest step and its D3 docs now come from #158; this PR
  no longer adds them.
- Vercel preview `make-shift-9t8g9p17h-jaddenkis-projects.vercel.app`
  (protected by Vercel Authentication, checked with `vercel curl`): pages,
  `/audio/*.js`, and the model returned 200 with expected types; the pinned
  jsDelivr WASM returned `application/wasm`; `/api/health` returned
  `200 {"status":"ok"}` using secrets synced from Infisical.
- After previews were made public, `MAKE_SHIFT_URL=https://make-shift-qmefia3is-jaddenkis-projects.vercel.app
  EXPECT_DATABASE=ok npm run test:deployment` passed against the deployed
  preview: all assets, pages, zero-request playing, camera recovery and
  `database: ok`.
- Not covered: real cameras, audible output, Firefox/Safari, backgrounding,
  and the home-page camera overlay (#112). These stay manual or pending.
- GitHub Actions (ubuntu-latest, Node 20, Chromium): [frontend job](https://github.com/Kakrl/MakeShift/actions/runs/36735042554/job/109954414324)
  passed Vitest, the deployment smoke test (without database secrets:
  `unconfigured`) and the browser audio smoke test on PR #153. The first run
  exposed a race in the audio test's navigation-cleanup check, fixed by
  waiting for the context to close.

## PR #138 review verification

Local Windows execution on 2026-09-30, Node 22.20.0, Vitest 4.1.11,
following merge of main at 4dc41ab (PR #136) into feature/24-session-gating.

- All 204 tests passed across eight files, including 25 readiness cases and
  15 page/coordinator/marker integration cases. Named note methods cover press
  pairing, obsolete identities, malformed values and readiness loss. Separate
  deadlines preserve ten-second marker checks and 500 ms hand-tracking expiry;
  continuing hand observations cannot conceal an expired marker observation.
- Combined page coverage preserves free play before recording, through count-in
  and Pause, and after Stop; held notes enter MIDI at capture boundaries without
  retriggering sound. Resume keeps the live session without reinitializing audio.
  Calibration/frame loss, startup cancellation and audio interruption still gate
  playback. Audio and camera hardware are mocked.
- TypeScript, ESLint (five existing unused-variable warnings), all 18 contrast
  pairs, production build and git diff --check passed.
- An accidental root-level Vitest run used an unconfigured runner and failed;
  only the frontend-configured run above is verification evidence. Its temporary
  cache was removed. The new deadline fixture initially advanced its fake clocks
  in the wrong order; corrected before the passing run.
- Inventory ID 2.1.7 preserves PR #136's playback regression coverage, which
  independently used the same 2.1.5 ID as this branch's readiness unit tests.
- The earlier manual pass predates these changes. Physical/manual verification
  of this merged behavior and Actions execution remain pending. Vitest remains
  outside frontend CI (D3); no FPS, detection accuracy or physical latency claim.

## PR #138 follow-up review verification

Local Windows execution on 2026-09-30, `feature/24-session-gating`, working
changes based on `0fecdb5` (Node 22, Vitest 4.1.11):

- All 205 Vitest tests passed across eight files, including 26 live-session
  cases and 15 simulated page/coordinator/marker integration cases.
- The new case preserves a playing session across an 11-second marker gap
  with fresh hand tracking, then verifies invalid calibration releases notes.
  Existing cases verify marker expiry, stale hands and token-paired releases.
- TypeScript and production build passed. Lint passed with five existing
  unused-variable warnings. All 18 contrast pairs passed.
- Readiness now comes from the session; marker geometry uses its returned
  compatibility decision. Both audio adapters share one press-token sink.
- Low-severity review cleanup: repaired UTF-8 mojibake in the inventory and
  removed unused pitch-based audio wrappers, which had no production callers.
- Two-second marker jitter slack is provisional. Hardware timing, physical
  camera/audio behavior and GitHub Actions execution remain unverified.

## PR 139 frontend CI merge repair

On 2026-09-30, restored the coordinator's accepted-event `activePitches`
prop and the missing `Delivery` type import on the PR branch based on
`e0a4a95`. Merge conflict resolution had retained obsolete note callback props
and removed an import still used by the MIDI observer subscription.

Local Windows verification: lint passed with four existing unused-variable
warnings in page.tsx; TypeScript passed; all 228 Vitest tests in nine files
passed; all 18 contrast pairs passed; production build passed.
No test cases changed. GitHub Actions execution for this repair is pending.

## Earlier PR 139 and PR 141 reconciliation evidence

- All 222 tests passed across nine files: 25 readiness cases, 17 page integration
  cases and 16 piano integration cases. Retained both branches' coverage and
  updated feedback expectations for independent recording Stop.
- Added a recording-boundary regression: deferred pre-capture history is drained,
  released notes are excluded, held same-pitch identities and velocities survive
  start/resume, and capture does not retrigger audio. Existing immediate Stop,
  pause/resume, tracking interruption and stale producer cases also pass.
- TypeScript, ESLint (five existing unused-variable warnings), all 18 contrast
  pairs and the Next.js 16.2.3 production build passed. `git diff --check` passed.
  An initial repository-root `npx tsc` invocation did not run the project compiler;
  the passing TypeScript check used the frontend working directory.
- Tests use simulated camera/audio inputs and production offline DSP. No new
  hardware/manual verification, physical latency or detection accuracy claim.
  Earlier manual passes predate this merge. Vitest remains outside CI (D3);
  Actions results are separate.
- Reconciliation keeps #138's named note methods, independent playback and
  marker cadence, #139's timestamped shared consumers, and #137's cleanup.
  The previous squash-transplant instruction is obsolete; #138 remains a
  dependency until merged.

## PR #141 merge reconciliation

Local Windows execution on 2026-09-30, Node 22.20.0, Vitest 4.1.11,
merging PR #139 head `b136e6a` into PR #141 head `b5245ea`.

- Preserved both branches' verification records and the MIDI runtime/type split.
- All 222 tests passed across nine files. TypeScript, all 18 contrast pairs,
  production build and whitespace checks passed. ESLint passed with five
  existing unused-variable warnings in Home.
- The production export regression initially rejected the changed Home hook
  layout. Updated its guarded fixture for the consumer ref added by #139;
  no production change was needed. Lint passed again after the fixture edit.
- `npm run test:midi-browser` passed in Edge 154.0.4258.37 against the new
  production build: two downloads, exact MIDI bytes, dialog closure and no
  page errors. Inventory 4.2.3 retains the seeded-take limitation; no new
  physical recording, camera, audio or latency verification is claimed.
- Vitest and the browser runner remain outside CI; Actions evidence is pending.
  PR #139 remains a dependency until merged. This reconciliation supersedes
  the old instruction to transplant only commits after `025588e`.

## PR #150 merge reconciliation

Local Windows execution on 2026-09-30, Node 22.20.0, Vitest 4.1.11,
merging PR #141 head `045255f` into PR #150 head `b0e8177`.

- Preserved both verification histories and the updated session/recording
  behavior from #141 together with #150's opt-in instrumentation.
- All 237 tests passed across eleven files. TypeScript, all 18 contrast pairs,
  production build and whitespace checks passed. ESLint passed with five
  existing unused-variable warnings in Home.
- Production Edge 154.0.4258.37: MIDI export passed with two downloads, exact
  MIDI bytes and dialog closure. Diagnostics passed three audio/CV/navigation
  cycles with GPU hand models, closed audio contexts and no page errors.
  Final model, detector, audio-context and worklet counts were zero; the shared
  camera provider retained one track. Worker count remains unavailable.
- The profiling fixture uses a synthetic camera without calibration. These
  checks do not establish physical latency, detection accuracy or a memory-leak
  verdict. Earlier manual reports predate this integration; no new hardware or
  Actions result is claimed. Vitest and browser runners remain outside CI (D3).
- This reconciliation supersedes the older squash-transplant instructions.
  PR #141 remains a dependency until merged; its updated branch includes main
  at `4dc41ab`. No test implementations or coverage were added by this resolution.

## PR 141 reconciliation with final PR 139 head

On 2026-09-30, merged PR #139 head `277491a` into the MIDI export fix.
Preserved both verification histories while resolving the README conflict;
retained the export runtime/type split and #139's corrected coordinator types.
Current `origin/main` (`46ed0c7`) is already an ancestor. Merge #139 first;
this branch includes its current contents and is compatible with that order.

Local Windows verification on merge commit `386b3e7`: all 228 Vitest tests
across nine files passed; TypeScript, 18 contrast pairs and production build
passed. Lint passed with four existing Home warnings. The production browser
regression passed in Edge 154.0.4258.37: two downloads with exact MIDI bytes,
dialog closure and no page errors. It uses a seeded take, not physical capture.
No tests changed. GitHub Actions execution for this reconciliation is pending.

## PR 150 reconciliation with updated PR 141

On 2026-09-30, merged PR #141 head `1642bdf` (including PR #139 head
`277491a`) into PR #150 at merge commit `a4de88b`. Preserved both verification
records in the README conflict. Current main `46ed0c7` is already an ancestor.
Merge #139, then #141, then #150; the branch includes these dependency heads.
This supersedes the original dependency transplant instructions.

Local Windows verification: all 243 Vitest cases in eleven files passed;
TypeScript, 18 contrast pairs, production build and whitespace checks passed.
Lint passed with four existing Home warnings. Edge 154.0.4258.37 production
regressions passed: two exact-byte MIDI downloads with dialog closure, profile
JSON export, three audio/CV navigation cycles with closed AudioContexts, and
paired diagnostics off/on trials. No page errors occurred. Final ownership
counts were one shared camera track, zero audio contexts/nodes/hand models/marker
detectors; worker count remained unavailable. Reports are generated under
frontend/test-results/performance/. The synthetic camera and seeded MIDI take
do not verify physical recording, contact accuracy or press-to-sound latency.
No test cases changed. GitHub Actions execution for this reconciliation is pending.

## PR #150 merge verification (2026-10-01)

Merged main at 47400c7 into the diagnostics branch. Preserved main's live
contact pipeline, handedness observations and optional visual debugging.
Detection timing now covers synchronous contact processing and shadow submission;
asynchronous shadow execution, transfer timing and worker counts remain unavailable.

Windows / Node 22.20.0: lint, TypeScript and all 18 contrast pairs passed.
Vitest: 228 passed and 23 failed in 13 files. An isolated checkout of main
47400c7 reproduced the same 23 failures: six calibration workflow cases lack
canvas clearRect in their mock, and 17 recording-control cases lack the
getComputedStyle global. These inherited test-harness failures are outside
this merge-resolution change; no complete suite pass is claimed.
Production build passed. Headless Edge 154 with a synthetic camera passed the
production diagnostics check: three navigation/audio/CV cleanup cycles, JSON
report export and paired off/on overhead trials, with no page errors.
The fixture now profiles a returning visit to accommodate main's onboarding.
Physical camera/audio checks were not run.

## PR #150 review and main reconciliation (2026-10-02)

Merged main `380bc80` into the PR head `6628e25`, preserving deployment/CI,
camera layout, disconnected-camera handling and the existing CV debug defaults.
Kept the profiling script, bounded metrics and idempotent resource accounting.
Shared instrumentation moved from CV to `frontend/src/diagnostics/`; developer
switches now live in `frontend/src/debugFlags.ts`. The panel is hidden unless
`NEXT_PUBLIC_PIPELINE_DIAGNOSTICS=1` is set at build time. Home/calibration
explicitly register their video; initial panel status is idle.

Windows / Node 22.20.0: lint, TypeScript, 18 contrast pairs and production builds
with diagnostics enabled and disabled passed. Vitest: 252 passed across 14 files,
plus main's five expected calibration failures (#162), not five fixed defects.
Two added tests cover explicit video selection/stale cleanup and idle/callback
cancellation; provider mocks now include getVideoTracks and browser userAgent.
The initial panel fixture lacked userAgent; corrected before the passing run.
Default-build browser checks found no panel on Home, Audio or Calibration.
Enabled-build profiling passed in Edge 154.0.4258.48: three audio/CV/navigation
cycles, real JSON export, paired off/on trials and no page errors. All owned
audio contexts/nodes/hand models/marker detectors ended at zero; one shared
camera track remained, workers unavailable. Synthetic camera, no calibrated
keyboard/contact; no physical accuracy, latency or memory-leak claim.
Vitest is now invoked by frontend CI; Actions evidence for this update is pending.
The browser profiling runner remains local-only. Older stacked rebase instructions
are obsolete; current main is integrated directly.


## Recordings library operations verification (issue #124)

Partial non-UI delivery on feature/124-local-recordings-library, Windows,
2026-10-03, Node 22.17.0, Vitest 4.1.11:

- Lint, TypeScript, production build and all 18 contrast pairs passed.
- Full Vitest: 279 passed and five existing expected failures in 16 files.
  Twelve library cases and one filename case were added. The library cases
  use injected in-memory storage, not a real browser restart.
- Chromium 151.0.7922.34: two production MIDI downloads passed, with named
  filenames, exact bytes and dialog closure. The export fixture now skips
  the unrelated first-visit welcome overlay, which blocked the initial run.
- Chromium audio smoke passed; audible hardware was not measured.
- Deployment smoke stalled and was stopped after 45 seconds; no pass claimed.
- Actions execution evidence is pending. Inventory 4.2.1/4.2.2 remain partial:
  home-page integration, library UI, visible quota errors and restart verification
  are not delivered by these operations. See docs/recordings_library.md.


## Recordings library UI verification (issue #124)

Supersedes the partial-delivery status above. Home now loads the library and
saves completed takes on Stop/session interruption. Bare-bones controls replace
export/delete dialogs and the placeholder path field.

- Windows, 2026-10-03: lint, TypeScript, build and all 18 contrast pairs passed.
- Vitest: 281 passed and five existing expected failures across 16 files. Home
  tests cover saved-list rename/delete/remount and Stop with quota failure/retry.
  Existing recording-controls expectations now target the library download action.
- Chromium 151.0.7922.34: seeded production takes survive reload, rename/delete
  persist, two named MIDI downloads have exact expected bytes. The fixture was
  corrected to seed only missing storage, rather than overwrite rename on reload.
- Browser audio smoke passed; physical audible output not measured.
- Full browser restart, Listen and cross-browser behavior remain unverified.
  Deployment check and visual inspection results follow. Actions evidence pending.

- Deployment smoke was stopped at the 45-second limit; no pass claimed.
- Desktop (1280x720) and mobile (390x844) screenshots inspected: plain list,
  rename/download/delete controls readable; no redesign introduced.

### Recordings library component extraction (2026-10-05)

PR #167 review follow-up: moved library UI/state into
`frontend/src/app/midi/RecordingsLibraryPanel.tsx`; the page forwards completed
takes and receives loaded/availability status. On Windows, lint, TypeScript,
Vitest (281 passed, five existing expected failures), all 18 contrast checks,
and production build passed. Production Chromium 151 library reload, rename,
delete, two named downloads/exact MIDI bytes, and audio smoke passed. The build
needed network access for existing Google Fonts. Deployment smoke was retried with network access but stalled in the camera
workflow and was stopped without a pass; no physical camera/audio verification
is claimed.

### Browser-only library initialization (2026-10-05)

PR #167: removed the library initialization effect and zero-delay timer. The
browser-only panel initializes its controller and list directly. Updated
`next/dynamic` test mocks to render the real panel. Lint, TypeScript, Vitest
(281 passed, five existing expected failures), 18 contrast checks, production
build, Chromium 151 library/download checks, and audio smoke passed. The wider
deployment camera smoke remains incomplete as recorded in the extraction
verification above. Physical camera/audio measurements remain unverified.
## Tempo and metronome verification (issue #123)

Local execution on Windows, 2026-10-02, Node 22.17.0, Vitest 4.1.11,
branch `feature/123-persist-tempo-metronome`:

- Frontend lint and TypeScript passed.
- Full Vitest suite: 280 passed and five existing expected failures across
  15 files. Fourteen new cases in `frontend/homePage.test.ts` cover defaults,
  restore-before-save, changes retained across remounts, invalid saved values,
  valid range boundaries and usable controls with blocked reads/quota errors.
- All 18 contrast pairs passed. Production build passed with network access
  for existing Google Fonts.
- Production Chromium 151.0.7922.34 check: changed to 175 BPM/metronome off,
  reloaded and observed both retained; seeded invalid 999 BPM, reloaded and
  observed 120 BPM/metronome on. This was a one-off scripted browser check,
  not a committed browser regression or full browser restart test.
- Production Chromium audio smoke passed (worklet load, rendered amplitude,
  suspension recovery and navigation cleanup). Audible hardware not measured.
- Deployment smoke did not complete: two runs stalled waiting for fresh fake-
  camera frames in `expectLivePreview` on `/calibration` and were stopped.
  The diagnostic run reached that wait after asset/page/offline audio/health
  checks. No deployment smoke pass is claimed; camera recovery remains unverified
  in this environment.
- Actions execution evidence for these changes is pending; existing frontend
  CI invokes the Vitest tests.

### PR #166 review follow-up

2026-10-03, Windows: settings restoration now shares the existing calibration/
welcome mount timeout, retaining the restore-before-save guard. Final newlines
added to this guide and the inventory. Lint, TypeScript, all 18 contrast pairs
and production build passed. Vitest: 280 passed and five existing expected
failures across 15 files. No new test cases; browser checks were not repeated
for this consolidation.

### Device profile verification (issue #125, 2026-10-10)

Windows, production Chromium 151.0.7922.34: new browser ID, trimmed saved
display name, reload persistence, and name changes preserving the ID passed
using the real home sidebar and localStorage. Vitest: 488 tests passed across
24 files, including seven profile cases. Lint, TypeScript, all 37 contrast
checks, production build, and browser audio smoke passed. Home/recording test
dynamic-import fixtures now render the real profile panel. Browser restart,
cross-browser profile behavior, and physical camera/audio remain unverified.
Initial deployment browser check stalled; diagnosed 2026-10-11 below.
Actions evidence pending.

### Local deployment camera diagnosis (2026-10-11)

On Windows with Chromium 151.0.7922.34, the default fake-camera preview did not
advance: video readiness was 4 but currentTime stayed zero. A standalone video
on /audio reproduced the failure without CV processing. Adding `--disable-gpu`
to a temporary copy of the deployment runner restored 60 frame callbacks over
three seconds. All original deployment assertions then passed on a fresh
production server at port 3001: five assets, five pages, three local audio rounds
with zero note requests, unconfigured database, and camera denial/retry/loss/
recovery. The temporary runner was removed; the committed default runner was
not changed. This verifies software capture with GPU disabled, not physical
camera behavior or hardware GPU correctness. A pre-existing server at port
3000 separately timed out during home MediaPipe initialization.

### Device profile review fixes (2026-10-14)

PR #189: profile saves reread storage, preserve an existing saved ID, return the
reconciled profile, and update panel state from that result. The empty-ID
fixture uses the actual direct storage shape and asserts a generated replacement.
Windows: lint, TypeScript, 489 Vitest tests in 24 files, 37 contrast checks and
production build passed. Chromium 151.0.7922.34 against production port 3189
passed the actual two-tab initial-quota-failure/retry sequence and reload,
keyboard layout and audio smoke. All deployment assertions passed with the
previously diagnosed local --disable-gpu workaround in a removed temporary
runner; the committed runner is unchanged. Physical hardware was not measured.
Actions execution for this follow-up is unverified.

## Local shadow evidence comparison (2026-10-27)

Diagnostic work only; no new contact threshold. Focused Vitest execution of
`darkShadowRegion`, `shadowPressHysteresis` and `liveShadowPressPipeline`:
20 passed, including four new cases checking opposite near/forward changes,
known darkness and spatial slope, missing references, invalid tips, zero masks,
clipping, unavailable-band comparisons, each independently adjustable pixel bound, consistent masks/metrics/probes and overlay-span pixel counts. Lint (three existing image-element
warnings), TypeScript, contrast and production build passed locally.

The image browser replay processed 19 images / 22 targets without page errors.
Clip 1 processed 288 frames with exported evidence. Automated frame navigation
asserted filter-control edit/reset and exact cached display restoration for empty and hand-visible frames;
the screenshot was inspected locally. Commands and limitations:
[image measurements](../docs/cv_image_tests.md#comparing-darkness-hypotheses-locally-2026-10-27),
[video review](../docs/cv_video_tests.md#shadow-evidence-frame-review).
Generated evidence is ignored under `frontend/test-results/`: image report in
`cv-image-cases/`, video report and `shadow-evidence-stepping.png` in `cv-video/`.
Actions evidence remains pending; this is not live accuracy or latency evidence.

The full current-worktree Vitest run reported 532 passed, 26 failed and one
skipped: 23 recording tests fail at the background canvas mock's missing
`getImageData`, velocity and synchronous-profile integration expectations each
fail once, and one high-rate audio envelope case timed out. The audio file
passed separately (72 cases). The remaining failures are outside the added
measurement cases; the full suite is not green.

Required browser smoke checks: bundled Chromium was unavailable locally.
Installed Chrome passed keyboard-layout and audio graph/lifecycle checks;
audio hardware was not measured. Deployment smoke timed out waiting for the
home page's `MediaPipe ready/unavailable` text, so that check did not pass.
The dedicated image/video replay pages completed with real MediaPipe.

## Video replay inspector UI (2026-10-27)

Local-only UI changes: video/finger inspector columns, selected-finger zoom,
four charts with a common last-60-frame window and independent labeled vertical
ranges, signed metric cards, responsive stacking, collapsible setup/table/report.
No contact or pixel-classification changes.

`CV_SHADOW_EVIDENCE=1 CV_SHADOW_STEP_CHECK=1 npm run test:cv-video:auto -- --clip 1`
passed on installed Chrome / Apple M2, 288 frames, no browser page errors.
The browser harness verifies control edit/reset, exact cached frame restoration,
finger selection, four accessible charts, initialized crop canvas and no
horizontal page overflow at 390 px. Desktop (1440 px) and mobile screenshots
were inspected under ignored `frontend/test-results/cv-video/`:
`shadow-evidence-stepping.png` and `shadow-evidence-mobile.png`.
Lint (three image-element warnings), TypeScript, contrast and production build
passed. Full Vitest: 535 passed, 25 failed, one skipped. Failures remain in
recordingControls (23 canvas mock failures), fingerVelocity (one) and
synchronousShadowPipeline (one), as documented above. Actions evidence pending.
This UI check does not verify physical contact accuracy, hardware latency,
or chart-assisted human judgment.

## Finger-independent shadow heatmap (2026-10-27)

The diagnostic at `/cv-shadow-test` compares an image or paused video frame to
an empty reference, independently of MediaPipe, markers and the contact state.
It shows positive luma drop and normalized RGB color shift separately; no
finger removal or semantic shadow classification is claimed. Setup, resolution,
scales, sampling limits and frame-seeking caveats are in the
[viewer guide](../docs/cv_shadow_heatmap.md).

`npx vitest run ../tests/frontend/shadowHeatmap.test.ts` from `frontend/` passed
five synthetic cases. Lint (three pre-existing image-element warnings), types,
contrast and production build passed locally. Full Vitest: 540 passed,
25 failed, one skipped. The 25 failures remain in recordingControls (23 canvas
mock failures), fingerVelocity (one) and synchronousShadowPipeline (one).

With the production app running on port 3107, execute
`npm run test:shadow-heatmap-browser` from `frontend/`. It uses installed Chrome
by default (`CV_BROWSER_CHANNEL` override), 19 saved labeled images plus the
reference self-comparison, and clip 1. Local browser execution passed on 2026-10-27: all 19 cases plus the reference self-comparison, scaling controls, resolution-mismatch clearing, video reference capture, step/return repeatability, decoded-source agreement (two-channel-level canvas rounding tolerance), pixel inspection and 390 px overflow check. No hand/marker inference requests or page errors occurred. Desktop and mobile screenshots were inspected.
Reports/screenshots are ignored artifacts under
`frontend/test-results/shadow-heatmap/`. Actions evidence is pending.

Browser smoke: keyboard-layout passed using Chrome; bundled Chromium was
unavailable. Deployment timed out on the home page's MediaPipe status text;
the Chrome audio check timed out waiting for `Audio enabled`, so neither is
claimed as passed for this run. These do not establish physical audio latency.

## Integrated replay heatmaps (2026-10-27)

`/cv-video-replay?manual=1` now defaults to **Diagnostic view → Shadow heatmaps**;
**Finger measurements** restores the inspector. The maps reuse the standalone
subtraction/color math and theme palette, with per-frame reference IDs and
shared downsampled reference snapshots. Map rendering is paused-only and
outside contact timing; it does not change contact decisions. Missing
references remain unavailable. Raw reference pixels are not duplicated into
each frame's JSON output. Headless runs without evidence skip reference reads.

`CV_SHADOW_EVIDENCE=1 CV_SHADOW_STEP_CHECK=1 npm run test:cv-video:auto -- --clip 1`
passed locally on installed Chrome / Apple M2: 288 frames, no page errors,
existing finger inspector checks, heatmap view switching, 640 px map rendering,
scale-change output, Previous/Next frame labels, pause/resume behavior and
390 px horizontal overflow check. Desktop and mobile screenshots were inspected:
ignored `frontend/test-results/cv-video/replay-shadow-heatmaps.png` and
`replay-shadow-heatmaps-mobile.png`. Reference-version boundary crossings and
semantic shadow separation are not established by this run.

Five numerical heatmap tests, lint (three existing image warnings), TypeScript,
contrast and production build passed. Full-suite results retain the existing
recording/contact failures; see the finger-independent heatmap record above.
Actions evidence pending. The standalone viewer remains available without the
replay's MediaPipe/marker/sidecar requirements.


## Brightness–chromaticity projection (2026-10-27)

Local macOS / Apple M2 / Node 24.2.0, diagnostic-only addition to both
`/cv-shadow-test` and the paused replay heatmap panel. Four raw projection
measurements/maps (`a`, `1−a`, `e_B`, `e_I`) supplement the existing maps.
Color-excluded darkening can use normalized RGB shift or `e_I`; initial
thresholds are exploratory, not verified classifiers. Low-signal/invalid
projection interpretations stay gray even when raw values can be computed.

- Focused Vitest: **13 passed** (five existing and eight added numerical cases).
  Coverage includes non-neutral attenuation, the supplied RGB examples,
  unchanged/brightened pixels, black/weak signal, zero/transparent references,
  reference-versus-current normalization, both exclusion filters and fractional
  residual display scaling.
- Full Vitest: **548 passed, 25 failed, one skipped**. The failures remain in
  recordingControls (23 missing canvas-mock `getImageData` failures),
  fingerVelocity (one), and synchronousShadowPipeline (one), matching the
  previously documented failure groups. No full-suite pass is claimed.
- Lint passed with three existing image-element warnings; TypeScript, all 39
  contrast checks, and production build passed. The sandboxed build could not
  fetch existing Google Fonts; the network-enabled build passed.
- `npm run test:shadow-heatmap-browser` passed against production port 3107 in
  installed Chrome: 19 images plus reference self-comparison, video capture and
  stepping, all five new maps, residual scaling, method/threshold editing,
  resolution-mismatch clearing, raw readouts and mobile overflow checks.
  Report includes an unlabelled central coordinate/RGB/projection sample per
  image with the reference name. Desktop screenshot and mobile map detail were
  inspected; artifacts are ignored under `frontend/test-results/shadow-heatmap/`.
- Integrated replay browser verification passed on clip 1: 288 frames,
  projection map rendering and raw readout, exclusion controls, cached frame
  navigation, mobile overflow and clearing on resume. The runner now waits for
  its existing required multiple-finger fixture before pausing, avoiding an
  earlier single-finger-frame failure. Initial selector accessibility failure
  was fixed before the passing build/run. Screenshots and `projection-result.json`
  are ignored under `frontend/test-results/cv-video/`.
- Keyboard-layout browser smoke passed in installed Chrome. Required bundled
  Chromium audio smoke could not launch because the browser is not installed.
  Deployment smoke in Chrome timed out on the existing home-page MediaPipe
  status text. No new physical audio latency or detection-accuracy evidence.

GitHub Actions evidence is pending. Pixel category labels, shadow retention,
skin leakage and held-out separation remain unmeasured; the sampled browser
readouts are reproducible tool evidence, not semantic ground truth.


## Labeled shadow samples (2026-10-27)

Local macOS / Apple M2 / Node 24.2.0. Added source-image click or keyboard
coordinate capture for labeled 1/3/5/9-pixel-square patches in both heatmap
views, independent human category/contact-phase fields, bounded in-memory
sample collection, individual removal, and schema-version-1 JSON download.
Each sample freezes frame/reference identity, raw patch RGB/projection values,
validity flags, settings and independent retention outcomes for both methods.
See [collection instructions and export fields](../docs/cv_shadow_heatmap.md#save-labeled-pixels-and-patches).

- Focused Vitest: **19 passed**, comprising 13 existing heatmap cases and six
  new sample cases: raw measurements/both filter outcomes, edge clipping,
  unknown serialization, snapshot isolation, non-darkening/noise-floor behavior,
  and invalid selections/sizes/dimensions. New source:
  `tests/frontend/shadowSamples.test.ts`.
- Lint passed with the same three pre-existing image warnings; TypeScript,
  all 39 contrast checks and production build passed. Existing Google Fonts
  required network-enabled build access.
- Full Vitest: **553 passed, 26 failed, one skipped**. This includes the 25
  previously documented recording/contact fixture failures and one existing
  384 kHz ADSR case timing out at five seconds while the build also ran.
  Isolated `browserAudio.test.ts` passed all 72 cases. No full-suite pass claimed.
- Standalone Chrome browser check passed on 19 saved images plus reference
  self-comparison and clip 1. Added assertions cover label/phase/note selection,
  clipped patch capture by coordinates, click capture, downloaded JSON structure
  and values, frozen image samples across source/reference replacement, video
  time/frame metadata, sample removal and capture disabled on mismatch. Existing
  map, decoded-frame, no-inference and mobile overflow checks still passed.
  Exports/screenshots are ignored under `frontend/test-results/shadow-heatmap/`:
  `image-samples.json`, `video-samples.json`, `labeled-samples.png`.
- Integrated replay Chrome check completed all **288 frames** of clip 1 with
  sample capture, stored frame metadata, navigation persistence and capture
  disabled during playback. Screenshot inspected under ignored
  `frontend/test-results/cv-video/replay-shadow-heatmaps.png`; replay record is
  `sample-result.json`. Existing inspector, projection and mobile checks passed.
- Keyboard-layout smoke passed in installed Chrome. Deployment smoke timed out
  on the existing home-page MediaPipe status text (60 seconds). Bundled Chromium
  audio smoke could not launch because the browser executable is not installed.

Browser test labels are assigned to exercise collection/export and are not
human-reviewed semantic ground truth. Actual labeled transition collection,
shadow/skin separation evaluation and physical contact/latency remain pending.
GitHub Actions execution evidence remains pending; no CI changes were made.


## Fingertip shadow-band measurement (2026-10-28)

Local macOS / Apple M2 / Node 24.2.0. Added paused source-anchored parallel-ray
measurement in standalone/replay heatmap views, raw profiles and per-ray complete,
ambiguous, censored or insufficient states, majority/median width, per-frame
anchor confirmation, bounded records and versioned band JSON export. No contact
rules or sidecar annotations changed. See the [guide](../docs/cv_shadow_heatmap.md#measure-the-fingertip-shadow-band).

- Focused Vitest: **28 passed**, including nine new cases in
  `tests/frontend/shadowBand.test.ts` plus 19 existing heatmap/sample cases.
  New cases cover known contiguous width/raw samples, missing/weak/brightened
  evidence, unknown and color-mismatched boundaries, occluder prefixes, nearby
  gaps versus distant/separate runs, scan/image censoring, majority/median,
  method/threshold equality, nonvertical geometry and bounded invalid inputs.
- Full Vitest: **563 passed, 25 failed, one skipped**. The failures remain in
  recordingControls (23 missing canvas mock failures), fingerVelocity (one),
  synchronousShadowPipeline (one). No full-suite pass claimed.
- Lint, types, 39 contrast checks and production build passed; lint retains
  three existing image warnings. The build used network access for existing fonts.
- `npm run test:shadow-band-browser` passed in installed Chrome against production
  port 3107: synthetic five-pixel width, unknown and invalid states, separate
  source-tip/direction clicks, keyboard anchors, confirmation after frame change,
  frozen exported measurements including null widths, last-record removal,
  no inference requests and 390 px overflow. Desktop/mobile screenshots inspected and saved
  under ignored `frontend/test-results/shadow-band/`; browser JSON/report passed.
- Existing standalone heatmap browser regression passed: 19 images plus
  reference/video and all prior sample/export checks. Integrated replay passed
  all 288 clip-1 frames, including band capture and frame/playback anchor guards;
  ignored record: `frontend/test-results/cv-video/band-result.json`.
- Keyboard-layout browser smoke passed in installed Chrome. Deployment smoke
  timed out on the existing home-page MediaPipe status text. Bundled Chromium
  audio smoke could not launch (executable unavailable).

A separate exploratory numerical pilot inspected 39 recorded frames using
provisional source-luma edge anchors and ±2 px perturbations. This is not an
automated contact verification test: some proposed anchors miss the distal
source boundary. Only 11/39 frames yielded complete aggregate widths at the
proposed anchors, and shifts changed availability materially. The diagnostic
correctly preserves unavailable/censored evidence rather than reporting zero
or a press. Results and conditions are in the
[status document](../docs/cv_shadow_detection_status_and_next_steps.md#shadow-band-measurement-pilot-2026-10-28).
Physical accuracy/latency and GitHub Actions evidence remain pending.
