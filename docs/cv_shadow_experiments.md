# CV shadow contact experiments

This plan records shadow-based contact ideas to evaluate in small steps. It is
an experiment plan, not an implementation or an accuracy claim. Keep candidate
measurements visible in the visual debugger before allowing them to trigger
notes.

## Current baseline

The shadow worker receives a crop centered on each fingertip. It clusters RGB
pixels, selects a dark region near the fingertip, and measures its area. The
current contact candidate rule uses the region's recent peak: the area is a
candidate when it falls to 30% of that peak or below 300 pixels. This is useful
as a baseline, but it does not directly measure the gap between the finger and
its shadow.

## Candidate idea: measure the finger-shadow gap

As a fingertip approaches the paper, the visible gap between the fingertip edge
and its shadow may shrink. Test whether this gap is a more reliable contact
signal than dark-region area alone.

For each fingertip:

1. Analyze a small region just below the fingertip, oriented toward the paper.
2. Estimate the fingertip edge and the nearest relevant shadow edge.
3. Measure the distance between those edges over time.
4. Look for a consistently shrinking gap that reaches a small threshold.
5. Add hysteresis or a short confirmation period so noisy edge changes do not
   flicker between contact and hover.

A one-dimensional brightness profile along a line below the fingertip may be a
quick first probe. A small two-dimensional region is likely more tolerant of
tilted fingers and shadows that fall to one side. Morphological gradients can
highlight image boundaries, but they do not by themselves identify which edge
belongs to the finger or shadow. This is local edge/shape analysis; optical
flow is a separate technique for estimating image motion between frames.

## Possible clue: thin compression shadow

During a press, a thin, dark band may appear immediately below the fingertip
where little light reaches the paper. Track this as a separate candidate cue:
its location relative to the fingertip, thickness, darkness relative to nearby
paper, and persistence across frames. It may complement a shrinking gap.

Do not treat darkness alone as contact. Lighting, exposure changes, printed
marks, and shadows from other fingers can all produce dark pixels. The band
should be checked against labeled hover, approach, contact, and release footage.

## Possible clue: little shadow ahead of a contacting finger

Another hypothesis is that a hovering fingertip casts a soft shadow in front
of itself, while that forward shadow becomes very small or disappears when the
finger reaches the paper. Measure a region just ahead of the fingertip, in the
observed shadow direction, and track its shadow strength and area over time.
Treat this as distinct from the thin compression band immediately beside the
fingertip: one may disappear while the other becomes more visible.

Lighting and camera angle determine where the shadow falls, so “ahead” should
be determined from the observed finger-shadow geometry rather than assumed to
be straight down in the image. Compare the cue across hover, approach, contact,
and release frames, and check whether it remains useful when another finger's
shadow enters the region.

## Resume this experiment

1. From `frontend/`, run `npm run dev` and open `http://localhost:3000`.
   Allow camera access and use the normal piano sheet/camera setup so
   MediaPipe can locate the index fingertip over a key.
2. Visual debugging is currently enabled by
   `DEBUG_FLAGS.visualDebug` in `frontend/src/debugFlags.ts`. In the Finger
   debug panel, leave the legacy **shadows** technique off and check
   **Synchronous shadow analysis only**. For calibrated knuckle gating, set
   `CONTACT_TECHNIQUES.knuckles` on and use a valid calibration. The diagnostic
   toggle keeps this experiment from triggering notes.
3. Choose **Camera** in Shadow analysis preview to see the three sampled rays
   colored by RGB class and their class-run strips. N means a match to the
   existing nail-color rule, P means the current pixel is within 18 RGB values
   per channel of the captured empty-sheet pixel, and O means other. The
   overlay is diagnostic only; it does not classify contact or drive notes.
   If there is no captured empty-sheet frame, paper classification is
   unavailable and unmatched pixels are shown as other.
4. Capture labeled examples of hover, press, and release. Keep lighting and
   camera placement fixed. Record the per-ray class order and run lengths. Do
   not tune thresholds from a single frame; compare multiple examples.

The still-image set is `experiment/0_hover_middle.png` through
`experiment/10_hover_middle.png`: 0–1 and 8–10 are labeled hover; 2–7 are
labeled press. A later hover counterexample is
`experiment/Screenshot 2026-10-17 at 1.41.55 AM.png`. The offline tip estimate
used for the stills differs from the live MediaPipe-centered profile, so those
measurements are useful context but are not directly comparable.

The existing synchronous note detector still uses its provisional luma bounds:
left-shoulder-to-bottom depth 8–50 luma, steepest rise at least 20 luma/pixel,
and no more than 6 pixels from bottom to rise. The RGB class preview is
separate and diagnostic-only. Near-sheet hovers may be treated as presses for
this use case. The reported 30 fps is an informal observation, not a
measurement. RGB classification currently runs synchronously in the preview
callback, while full crop segmentation and mask generation remain in the
asynchronous worker. Treat a smaller finger-and-rays crop as a follow-up
optimization; measure frame timing and dropped frames before changing that
worker boundary.

The camera preview now uses RGB classes instead of a grayscale profile. The
nail class uses the existing RGB (138, 98, 88) rule with ±30 tolerance per
channel and red at least 30 greater than green. Paper is a pixelwise match to
the captured empty-sheet frame with ±18 tolerance per channel. Everything else
is “other”; this class can include shadows, printed ink, skin outside the nail
range, and noise. This is an initial visualization rule, not a skin detector
or note decision. Inspect the three-ray class runs on labeled press and hover
examples before tuning the RGB ranges or using them in contact state.

The still-image tool at `/cv-image-test` also displays RGB class strips for
each analyzed target after **Run image analysis**. It shows both MediaPipe and
yellow-dot origins when the latter is available, using the selected empty-sheet
image as the pixelwise paper reference. The strips preserve sample order along
each ray and show consecutive class run lengths; the existing luma detector
tables remain separate diagnostic output. The enlarged grayscale subtraction
crop has those same class-colored ray segments overlaid on it: yellow for
nail-color match, white for paper, purple for a slight darkening of 18–39 luma
levels, blue for a stronger darkening of at least 40 luma levels, and red for
other color changes. M and Y label the MediaPipe and yellow-dot origins. The
darkening is measured against the empty-sheet pixel at the same image
coordinate; these are visual classes, not proof that a pixel is a shadow.

## Visual debugger requirements

Show the measurements before enabling note events:

- Outline the analyzed region for the selected fingertip.
- Draw the estimated fingertip edge in one distinct color and the estimated
  shadow edge in another.
- Draw a line between the edge points used for the gap measurement and display
  the gap value.
- Show any detected compression-shadow band and its measured thickness or
  contrast as a separate overlay.
- Show the forward-shadow measurement region and its strength/area separately
  from the contact-band measurement.
- Make unavailable or uncertain measurements visibly different from confident
  detections; do not draw uncertain edges as if they were exact.

The preview should make it possible to see when the algorithm chose the wrong
edge, followed the finger instead of its shadow, or lost the feature.

### Current visual debugger

The legacy **Shadow image analysis only** checkbox runs the old worker path
without using its results for note decisions. **Synchronous shadow analysis
only** inspects the new same-frame profile without passing it to contact state.
MediaPipe selects the fingertip, and either diagnostic crop is sampled only
while that fingertip overlaps a key and passes the eligibility gate.

The camera and background-delta previews show a gray guide arc and three sample
paths from the crop-center guide to the arc: one straight down and two at 20
degrees to either side. The current experiment colors each path segment by its
luma group and shows a luma profile in Camera mode. Background delta shows the
same grouped paths over the saved-frame difference image. Earlier gradient
dots, contours, gap line, crosshair, and other overlays remain disabled.

### Paper-inspired background-delta preview

MediaPipe remains responsible for locating fingers. The optional **Background
delta** view compares the selected fingertip crop with a captured empty-sheet
frame at the same camera coordinates. The app now captures the camera frame
used for each complete marker detection after its homography is validated; the
assumption for this experiment is that hands are out of view when all markers
can be found. Failed or partial scans retain the last captured background.
Move the finger over the key after capture. The preview shows amplified
absolute luma difference: the printed sheet should largely cancel, while the
hand, its shadow, camera movement, and exposure changes remain visible. The
changed-pixel count is only a display statistic; it does not classify shadow
pixels or affect notes.

This is a first visual check of the paper's background-removal idea, not a full
reproduction of its calibrated three-class segmentation. It depends on the
camera staying still and on comparable exposure between the captured frame and
the live frame. If the sheet cancels cleanly, the next experiment can separate
the brighter hand from the darker shadow within the MediaPipe-selected region
and display the estimated shadow tip. Keep that output diagnostic until
labeled clips establish useful precision and recall.

### Three-ray luma groups (current visual experiment)

The camera preview samples luma along three paths from the crop-center guide:
straight down and at 20 degrees to either side. Each path's one-dimensional
samples are clustered into up to three luma levels. Levels separated by less
than 12 luma are merged. Red marks the darkest level, blue the middle level,
and green the brightest. The graph colors each segment by its luma level; each
ray label reports the number of distinct levels and contiguous run lengths in
samples (approximately pixels).

This is a visualization aid, not a semantic classifier. Clustering will find
levels even when lighting creates a gradual gradient, so a red region is not
proven to be shadow, nor is green proven to be fingertip or paper. A level can
also split into multiple runs along a ray. The experiment asks whether hover
and press frames show a useful, repeatable arrangement: for example, whether a
distinct middle/dark run beneath the fingertip is longer during hover and
shrinks or disappears during press. The current cue does not control notes.

The immediate review is the supplied `experiment/0_hover_middle.png` through
`experiment/10_hover_middle.png` sequence, using the center ray first. Compare
the number/order of levels and the length/location of runs in the labeled hover
and press frames. Keep angled rays visible for context, but defer conclusions
about off-axis fingers. Record whether the simple center-line pattern separates
these labels before adding temporal logic or event decisions. These are still
images, so this review cannot establish persistence over time or live accuracy.

#### Initial sharp-rebound check (2026-10-17)

The `1.29.39 AM` graph screenshot in `experiment/` shows the moderate-dip
profile shape: fingertip luma, a brief darker notch, then a fast rise to
brighter paper. To see whether that shape appears in the labeled source screenshots, an
exploratory straight-down profile was sampled at the lowest visible skin row
near the middle finger. Skin was located with a simple RGB mask in the central
part of each image; this is an approximate image-derived tip, not MediaPipe's
landmark. Profiles were smoothed with a three-sample moving average. For each,
the minimum was searched from 2 pixels above to 5 pixels below the estimated
tip. The metric below is the steepest positive luma change per pixel within the
near-tip profile. `80% rise` is the distance from that minimum to the first
sample reaching 80% of the rise to the nearby paper level.

| Frame | Label | Steepest rise (luma/pixel) | Distance to 80% rise |
| :--- | :--- | ---: | ---: |
| 0 | Hover | 3 | 8 px |
| 1 | Hover | 11 | 9 px |
| 2 | Press | 34 | 4 px |
| 3 | Press | 33 | 4 px |
| 4 | Press | 33 | 4 px |
| 5 | Press | 35 | 4 px |
| 6 | Press | 29 | 5 px |
| 7 | Press | 34 | 4 px |
| 8 | Hover | 14 | 8 px |
| 9 | Hover | 5 | 8 px |
| 10 | Hover | 4 | 8 px |

In this small set, the press profiles have a sharper rebound (29–35
luma/pixel, reaching 80% in 4–5 pixels) than the hover profiles (3–14
luma/pixel, 8–9 pixels). This is encouraging evidence for the *rebound shape*
on the straight-down path. The color-located profiles do not settle whether dip
depth is consistent: their approximate fingertip location differs from the
MediaPipe-centered live profile, so their dip measurements are not comparable.
Use both dip depth and rebound steepness/width in the live preview, then inspect
the labeled examples before choosing a usable range.

Limits: the tip location came from a color heuristic and may be offset from the
live MediaPipe landmark; the camera images have different sizes and framing;
there are only six press and five hover stills from one setup; and the frames do
not provide reliable elapsed time. The measurements describe spatial change
along a line, not how quickly the signal changes over time. Repeat with the
actual MediaPipe-centered profile and labeled video frames before treating the
separation as reliable. For video, also record the frame-to-frame time for the
rebound cue to appear and disappear.

The later `1.41.55 AM` graph screenshot is labeled hover but reports dip depth
63, steepest rise 49 luma/pixel, and an 80% rebound distance of 4 pixels. This
is a concrete false positive for a rise-only rule. The depth value is larger
than the moderate dip in the earlier press-shaped graph. The live candidate
now requires a bounded dip depth of 8–50 luma as well as the sharp rebound; the
new hover should read **DIP TOO DEEP**. The upper bound is provisional and
should be checked against positive press examples measured by the same live
MediaPipe profile. The hand-located still-image measurements above do not
provide a comparable dip-depth threshold.

#### MediaPipe-centered live diagnostic

The shadow preview now applies the same shape check to the three luma paths
from the MediaPipe-selected fingertip. It smooths each profile with a three
sample moving average and searches for a dark minimum after the first two
samples, leaving the final six samples to estimate the paper level. It marks
the center path's minimum in orange and the first point reaching 80% of the
minimum-to-paper rebound in yellow. The chart reports the dip from the preceding
shoulder, steepest positive rise per pixel, and distance to that 80% point.

An orange **SHARP REBOUND CANDIDATE** label appears when the preceding shoulder
is brighter than the minimum by 8–50 luma, the steepest rise is at least 20
luma/pixel, and the rebound reaches 80% within 6 pixels. A sharp rebound with a
deeper dip is labeled **DIP TOO DEEP**; one with a shallower dip is labeled
**DIP TOO SHALLOW**. The 1.41.55 AM hover screenshot demonstrates why dip depth
must constrain the rise cue. These provisional values are for visual inspection
only. This signal does not change the contact state or dispatch notes. It is
not temporal filtering; observe when the marker appears and disappears during
labeled live hover, press, and release footage, then compare MediaPipe-centered
profiles against the offline, color-located profiles above.

#### Synchronous detector implementation (2026-10-17)

The experimental profile/contact calculation is isolated in
`frontend/src/cv/synchronousShadowDetector.ts`. The live contact pipeline has
an independent `synchronousShadows` switch and an analysis-only debug toggle.
When enabled, eligible fingertips are sampled synchronously after their key and
knuckle gates are evaluated. The profile result is passed to that same frame's
per-finger state check; it does not wait for a worker response. The legacy
asynchronous `shadowWorker.ts` remains independently switchable and is not used
to decide contact when synchronous shadows are enabled. Both switches remain
off in the default `CONTACT_TECHNIQUES` configuration pending labeled replay.

The marker scan stores the exact camera frame used for a complete four-marker
detection. Once the corresponding sheet homography is valid, that frame
replaces the saved background. Failed or partial scans retain the last saved
background. Camera/source changes clear it because the old pixels no longer
share the live frame's coordinate system. The detector reports changed-pixel
count and mean luma difference when a same-sized background is available;
these values are diagnostic only and do not affect the current rebound-based
candidate decision.

Three synthetic profile/background unit cases and two mocked pipeline cases
pass locally. A labeled replay now exercises the browser contact wiring. On
2026-10-17, all four checked-in videos were run with GPU MediaPipe on an Apple
M2, knuckle gating enabled, and the legacy shadow worker disabled:

| Clip | Frames | Eligible samples | Candidate samples | Press TP/FP/FN | Release TP/FP/FN | Sampled-frame contact ms p50/p95/max |
| :--- | ---: | ---: | ---: | :--- | :--- | :--- |
| 1 | 288 | 37 | 1 | 0/1/8 | 1/0/7 | 32.9/44.2/49.4 |
| 2 | 381 | 99 | 14 | 1/4/15 | 2/3/14 | 12.9/33.4/54.8 |
| 3 | 388 | 3 | 0 | 0/0/13 | 0/0/13 | 14.5/14.5/17.3 |
| 4 | 377 | 13 | 0 | 0/0/8 | 0/0/8 | 11.9/25.1/28.1 |

Across 1,434 frames, presses scored 1 TP / 5 FP / 44 FN (16.7% precision,
2.2% recall); releases scored 3 TP / 3 FP / 42 FN (50% precision, 6.7%
recall). The 152 eligible fingertip samples produced 15 candidate samples.
Contact processing on the 84 frames with at least one sample took 14.3 ms at
the median, 43.8 ms at p95, and 54.8 ms maximum. This includes per-frame
controller work and is not physical press-to-sound latency. The replay is
ordered and paused between source frames, so it does not measure live frame
drops. All four runs captured a background.

This initial end-to-end result is poor, and sampled work can exceed 50 ms on
some frames. Keep the technique off by default and inspect profile and knuckle
gate behavior before tuning. Near-sheet hovers remain deferred. Full per-clip
reports were written to the ignored local `frontend/test-results/cv-video/`
directory; the summary and conditions are recorded in
[`tests/README.md`](../tests/README.md#synchronous-shadow-detector-experiment-2026-10-17).

#### Synchronous shadows without knuckle gating (2026-10-17)

Ran all four clips with `CV_TECHNIQUE=synchronous-shadow-no-knuckles`, keeping
the legacy worker off. The run used the compact 48 × 68 crop and ray-only
background comparison. MediaPipe GPU ran on the Apple M2; all four clips
captured a background. This is an ordered replay, not a live frame-rate test.

| Clip | Eligible samples | Candidate samples | Press TP/FP/FN | Release TP/FP/FN |
| :--- | ---: | ---: | :--- | :--- |
| 1 | 390 | 25 | 1/13/7 | 2/12/6 |
| 2 | 773 | 49 | 3/17/13 | 2/18/14 |
| 3 | 194 | 30 | 4/8/9 | 4/8/9 |
| 4 | 390 | 12 | 2/5/6 | 2/5/6 |

Across 1,434 frames, presses scored 10 TP / 43 FP / 35 FN (18.9% precision,
22.2% recall); releases scored the same. The 1,747 eligible samples produced
116 candidate samples. On the 634 frames with samples, contact processing had
a median of 30.0 ms, p95 of 49.5 ms, and maximum of 70.0 ms. Ordered replay
throughput was 19.5 FPS, which does not represent live camera FPS.

Removing the knuckle gate increased recall relative to the prior gated replay,
but generated many more false transitions and substantially more candidates.
This was not a strict one-variable performance comparison: this run also
includes the compact-crop implementation. The raw reports are in the ignored
local `frontend/test-results/cv-video/no-knuckles-2026-10-17/` directory.

#### Live review notes (2026-10-17)

The current shape preview is reported to be working pretty nicely in live use.
Hovering very close to the sheet remains difficult to distinguish; it is not
yet clear whether those near-contact hovers produce a reliably different line
profile from a press. Keep these examples in the evaluation set rather than
counting them as solved or as confirmed failures.

At the time of this observation, the profile preview appeared to keep up at
30 fps on the current setup. This is informal, not a frame-time measurement.
The synchronous detector does not need to repeat the legacy worker's crop
segmentation or masking. Its note decision uses three short luma profiles. The
background difference is diagnostic only and is not required for note state.
The first implementation nevertheless copied and compared a 140 × 140 crop
for every eligible fingertip on every frame, which could add avoidable main
thread work. The synchronous path now uses a compact fingertip-and-rays crop;
the legacy worker retains its independent larger crop.

#### Compact fingertip-and-rays region

The three paths extend about 45 pixels from the landmark, with roughly 15
pixels of horizontal spread at the angled endpoints. The synchronous path now
copies a 48 × 68 region (up to 3,264 pixels) around the fingertip instead of
the legacy 140 × 140 region (19,600 pixels), an 83% reduction in crop pixels.
The ROI keeps 18 pixels above the landmark and 50 below it for the fingertip
boundary and full rays. The profile decision reads only about 45 luma samples
per ray (about 135 total). Background-delta diagnostics compare the saved
background at those same ray sample positions only; this measurement is not
used for note decisions. The compact ROI is still copied for the profile
preview, but the detector does not scan the full crop or run legacy
segmentation/masking.

The compact view should be checked on hover, press, and release so it retains
the relevant dip and rebound. Measure main-thread frame cost and dropped
frames on a live camera before claiming a 30 fps result; the pixel reduction
does not itself establish the recovered frame rate.

## Evaluation steps

1. **Inspect raw examples.** Select labeled clips containing hover, approach,
   contact, release, varied press speeds, and different fingers. Confirm that
   the chosen region contains both the fingertip boundary and its shadow.
2. **Visualize only.** Inspect the luma levels, contiguous runs, and run lengths
   on all three paths. Start with the straight-down path for the supplied
   middle-finger sequence. Keep the cue out of note dispatch.
3. **Record measurements.** For labeled frames, record each path's ordered
   levels and run lengths, frame label, and whether a distinct dark/middle run
   appears directly below the fingertip. Review confusing examples by label.
4. **Compare signals.** On the same clips, compare the existing area rule, gap
   trend, compression-band cue, and simple combinations. Tune on development
   clips and reserve separate people or sessions for held-out evaluation.
5. **Try event decisions.** Only after the visual measurements look meaningful,
   evaluate candidate thresholds and temporal confirmation against labeled
   press and release events. Report precision, recall, false triggers, missed
   events, and timing errors separately.
6. **Consider live use.** Check normal-speed replay and physical camera behavior
   after the offline comparison. Do not infer live accuracy or latency from
   paused-frame inspection.

## Initial visual review

Reviewed the 11 screenshots supplied in `experiment/` on 2026-10-15. This is a
visual feasibility check only; the screenshots do not establish exact labeled
contact times.

- The fingertips and their shadows are visible, so a local per-finger region
  appears feasible.
- Most visible shadows look soft and spread out. In these screenshots, a thin
  compression band is not consistently distinct from the broader shadow.
- Shadows from neighboring fingers can approach or overlap, and printed key
  borders/text create strong edges near the fingers. The debugger should show
  which edge the method selects and whether it belongs to the fingertip or its
  shadow.
- A fixed vertical line below the fingertip may miss the shadow. Begin with a
  small two-dimensional region and measure the nearest plausible shadow edge
  around the fingertip.

Follow-up observation from the labeled middle-finger sequence: the working
hypothesis is that hover has a visible shadow immediately below the fingertip,
while during press that nearby shadow becomes very small or disappears. Test
this first with the straight-down ray's grouped luma runs; do not assume a
particular group is shadow until its position and behavior match the images.

## Risks to check

- Fingertip landmark jitter moves the crop and can make a stationary shadow
  appear to move. Measure edges relative to the fingertip and inspect the
  overlay for crop-induced jumps.
- A finger and shadow may look connected before physical contact; thresholding
  can also split one region into several contours. Contour merging should be
  supporting evidence rather than the only contact rule.
- Shadows can extend sideways or overlap printed keys and shadows from other
  fingers. Check multiple camera angles, lighting conditions, and chords.
- A feature that works on the development clips may depend on one hand, setup,
  or lighting condition. Keep held-out clips separate from tuning.

## Decision record

For each experiment, record the clips and conditions, the exact signal and
thresholds, event counts and metrics, examples of failure, and whether the
signal should be kept, revised, or dropped. Change one main idea at a time so
the results explain which signal helped.

## Image-case review: dip selection and fingertip placement (2026-10-17)

Reviewing the labeled still-image results suggests two independent sources of
misses. First, a profile can contain a useful sharp rise while the selected
minimum is not the dip that leads into that rise. The minimum search can also
choose a small fluctuation on an otherwise flat profile. The detector found a
press candidate for only 3 of 11 labeled press images in the current set; the
per-ray plots show cases where rise evidence is present but the dip measurement
does not support the candidate. This is an initial observation from one small
image set, not an accuracy estimate.

Next, test associating a dip with a detected rise: search for a credible dip
within a bounded distance before the rise, rather than selecting the profile's
unrelated global minimum. A candidate dip should have sufficient depth and a
clear recovery toward the rise. Compare this with the current minimum search on
both labeled press and hover images, especially flat profiles and the known
hover false positive. The closest minimum alone may be noise, so retain a
minimum depth and rebound-quality check. Keep the result diagnostic until the
comparison shows fewer missed presses without adding hover false positives.

Second, the MediaPipe fingertip landmark is not always located at the visible
tip. When it lands farther up the finger, the sampled rays may not reach the
shadow underneath the fingertip, leaving the detector with an uninformative
profile even if the shadow cue itself is usable. Treat the landmark as an
initial position estimate, not a pixel-precise tip location.

For diagnosis, overlay the MediaPipe landmark and all sampled rays on the
source image, then inspect nearby sample positions along the finger axis. Test
how the measured dip and rise change over a small positional sweep around the
landmark. This will show whether the feature is present but missed due to
landmark offset, and how large or consistent that offset is. Do not silently
move the production fingertip or tune the shadow thresholds from this sweep;
first compare the landmark and candidate positions on labeled hover and press
images. If the cue is consistently recovered nearby, evaluate a bounded
image-based fingertip refinement as a separate experiment.

#### Nail-color yellow point (2026-10-17)

The still-image debugger now has a nail-color localization experiment. The
user-selected reference color is RGB (138, 98, 88). A pixel matches when each
channel is within ±30 of that reference and red is at least 30 greater than
green. The debugger keeps the orange/yellow matched-pixel cluster visible as a
reference.

The yellow point is constructed from MediaPipe's point as follows:

1. On the MediaPipe y row, scan left and right from its x coordinate while
   neighboring pixels satisfy the nail-color rule. Stop each scan at the first
   pixel outside the rule.
2. Take the midpoint between the two horizontal endpoints.
3. From that midpoint, scan down the image while pixels satisfy the same RGB
   rule. Stop at the first pixel outside the rule.
4. Place the yellow point 25 pixels above that vertical endpoint. This 25-pixel
   offset is an arbitrary experiment setting, not a calibrated geometric
   correction.

The subtraction-image preview overlays three 45-pixel rays from the yellow
point: straight down and at ±20 degrees. It shows a second set of right, left,
and center luma graphs from that point while retaining the original
MediaPipe-centered graphs. The user reports that the yellow point looks much
better aligned with the fingertip than the red MediaPipe point in the inspected
image. This is qualitative visual feedback only; no labeled localization
error or accuracy improvement has been measured. Keep the point, rays, and
graphs diagnostic-only until both hover and press examples have been compared.

#### Yellow-point graph review and next parser issue (2026-10-17)

The automatic still-image replay found a yellow point in all 22 target samples
(11 labeled hover and 11 labeled press). The point being present is distinct
from its luma graph meeting the current press-candidate rule. For the yellow
point's center ray, 4/11 press samples and 1/11 hover samples met that rule;
the corresponding MediaPipe-centered center ray met it for 3/11 press samples
and 0/11 hover samples. These counts come from a small, selected image set and
are diagnostic observations, not performance estimates. In particular, the
yellow point itself was not missing in the hover sample that looked
press-shaped to the parser.

The previous parser smoothed each ray with a three-sample mean, chose the
global minimum between sample 2 and the last six samples, estimated dip depth
from the preceding six-sample shoulder, and searched forward for recovery to
80% of the rise toward the average of the final six samples. That could pair a
rise with an unrelated global minimum, or select a small fluctuation on an
otherwise flat profile.

The parser now finds the steepest positive rise in the profile first, then
traces backward to the lowest point before that rise. That bottom is the
selected dip. It also marks the left shoulder (the highest point between the
profile start and bottom) and the right point at the start of the steep rise.
Dip depth is the left-shoulder-to-bottom difference; the bottom-to-rise span
must be at most 6 pixels, and the steepest rise must be at least 20
luma/pixel. The minimum dip remains 8 luma. These provisional bounds have not
been validated. This valley selection is implemented in both the live
diagnostic and synchronous detector. Updated profiles and labeled-image
counts have not yet been reviewed; this is not an accuracy claim and does not
enable the detector by default.

Compare the revised parser with the earlier global-minimum results on the same
labeled press and hover images. Inspect the dip and rebound markers, including
the hover false positive and press misses, and report per-image selected
locations and counts. Do not treat yellow-point localization as failing when a
graph is misparsed—the localization and luma-profile interpretation are
separate stages.

#### Recall-first three-ray dip-rise review (2026-10-17)

The next visual experiment treats the three rays as three independent
measurements. The intent is one short dip-rise pair per ray, not up to three
sequential pairs on a single ray. Each graph should show its own selected dip,
rebound, and whether that ray qualifies. For the initial recall-first view, a
target is called a diagnostic candidate when **any one** of its three rays
qualifies (an OR across rays). Preserve the per-ray results so later work can
compare 1/3, 2/3, and 3/3 ray votes.

The user also outlined a broader future parser with up to three short dip-rise
pairs, two medium plateaus, or one long medium plateau. Only the short
dip-rise case is in scope now, with one independent short pair sought on each
of the three rays. Medium and long patterns are deferred.

The image replay implements this as a visual-only overlay. It shows the
three-ray OR for both MediaPipe-origin and yellow-dot-origin profiles, without
affecting live note decisions. The current parser anchors on the steepest
positive rise, traces backward to the lowest point before it, and marks three
points: the highest left shoulder before the bottom, the bottom, and the start
of the sharp rise on the right. The provisional bounds are a dip depth of
8–50 luma, a rise of at least 20 luma/pixel, and no more than 6 pixels from
bottom to sharp-rise point. It seeks one valley per ray; multiple pairs and
plateaus remain deferred.

The user accepts extra false positives for now in order to recover more press
examples. The working plan is to add knuckle or Z-line evidence later to help
reject false candidates, especially when a raised finger's shadow does not
reach the expected area. Keep those cues separate while inspecting this
experiment; do not tune them from the still-image counts.

The labeled still replay below was run on 2026-10-17 with the 19 available images
(11 hover and 11 press target samples). The expected screenshot
`Screenshot 2026-10-17 at 8.52.44 PM.png` was listed by the directory scan but
missing on disk, so the rerun used a temporary copy of the available images.
Using the then-current global-minimum parser and bounds independently on each
ray (these counts predate the valley-parser change):

| Profile origin | Center press / hover | Left press / hover | Right press / hover | Any-ray press / hover |
| :--- | :---: | :---: | :---: | :---: |
| MediaPipe | 3/11 · 0/11 | 2/11 · 0/11 | 2/11 · 3/11 | 4/11 · 3/11 |
| Yellow dot | 4/11 · 1/11 | 3/11 · 0/11 | 3/11 · 3/11 | 8/11 · 4/11 |

These are per-target shape counts on selected stills, not live contact
precision/recall. They show the intended tradeoff: the yellow-dot OR marks
more labeled presses than the center ray alone, while also marking four hover
targets. The images cannot show whether those hover cues are brief, persistent,
or rejected by knuckle/Z-line context. The complete local replay output is
`/private/tmp/makeshift-cv-image-report-recall-first.json`.

Next session:

1. Inspect the candidate markers on the 8 yellow-dot press targets and 4 hover
   targets, noting which ray qualifies and whether its dip/rebound tracks a
   shadow edge, printed mark, or unrelated profile feature.
2. Review the eight press misses and four hover candidates separately. Decide
   whether the issue is ray placement, first qualifying dip selection, dip
   depth, rise strength, or the 6-pixel pairing distance.
3. Compare the revised first-dip parser with saved global-minimum results on
   the same images before changing bounds. Do not assume multiple short pairs
   are needed: the current parser seeks one pair per ray.
4. Use labeled video to assess temporal stability and release behavior. Only
   after the still profiles are understandable should the OR or a later
   knuckle/Z-line combination be evaluated as a note-contact rule.

## Press and release shadow experiments (2026-10-18)

Two candidate approaches are being considered for using the three shadow rays
to detect contact. Both remain experiments; neither should change note state
until evaluated on labeled footage.

### A. Shadow press onset, separate release cue

Treat the observed fingernail → small shadow → piano paper pattern as a press
cue. A separate signal, such as MediaPipe z or another release detector,
provides the release transition. The working assumption is that this pattern
is characteristic of a pressed finger; near-sheet hovers may be treated as
presses because they are close enough to count as contact for this use case.
Test whether the shadow cue appears consistently at press onset, then measure
release misses, false releases, and timing for the separate release cue.

### B. Shadow extent with hysteresis

Track how far shadow evidence extends along each of the three rays. The
hypothesis is that a press makes the shadow retreat from the paper end toward
the finger joint, reducing detected shadow extent; release restores shadow in
the opposite direction. Add separate press and release thresholds
(hysteresis) so small frame-to-frame changes do not toggle contact. Record
per-ray extent, direction of change, and transitions over time. A missing
shadow measurement alone is not a release: distinguish a measured decrease
from unavailable or uncertain evidence.

### Interpreting slight shadow (L)

For the initial shadow press detector, treat L (18–39 luma levels darker than
the saved paper pixel) as paper. Count only D (at least 40 luma levels darker)
as shadow evidence. Keep L as its own diagnostic class rather than merging it
into the stored RGB measurements; it may represent a weak finger shadow, but
that has not been established yet. When evaluating shadow-extent hysteresis or
the combined finger-plus-Z experiment, compare D-only evidence with D+L evidence
on the same labeled clips. Report whether including L improves transitions or
instead adds noise and false presses. This keeps the initial detector
conservative while preserving the data needed to revisit the threshold.

Compare both approaches on the same labeled press, hold, and release clips.
Report press/release TP, FP, and FN, transition delay, lighting/camera setup,
and cases where the cue is absent or ambiguous. Keep onset and release signals
separately visible in the debugger while evaluating them.
