# Labeled CV image replay

Use the saved stills in `images_test_cases/` to inspect synchronous shadow
decisions with MediaPipe's real fingertip landmarks. The replay is diagnostic:
it runs the same three-ray profile and sparse background comparison as the
live detector, but it does not dispatch notes or emulate temporal press/release
state.

## Prepare the background image

Capture one empty-sheet frame with the camera and printed piano sheet in the
same position as the labeled examples. Save it as
`images_test_cases/background.png`. Keep all four ArUco markers visible in this
image. This frame supplies the marker homography, projected key geometry, and
the coordinate-matched background used for difference measurements. Case
images should have the same dimensions and camera position. Hand occlusion in
the labeled examples is fine; the marker scan is done on the separate
background image.

Case names encode the expected state and fingers, for example:

```text
hover_right-ring_frame_000169_5633ms.png
press_right-ring_frame_000184_6133ms.png
```

The image replay also accepts `approach_...` and `release_...` prefixes. These
labels identify static samples for later comparison; they are not scored as
press/hover because one image cannot establish motion or event direction. For
example, `approach_right-index_frame_000180_6000ms.png` and
`release_right-index_frame_000210_7000ms.png` are valid descriptive cases.

The selected hand and finger are resolved from MediaPipe's output. Each result
records the requested and detected handedness so a left/right convention
mismatch is visible. If only one hand is detected, its fingertip is still
measured and the hand mismatch is flagged.

## Run

From the repository root:

```sh
cd frontend
npm run test:cv-images:auto
```

The runner builds and starts the local production app, loads the MediaPipe and
OpenCV.js runtimes, analyzes every labeled image in the case folder, and writes
`frontend/test-results/cv-image-cases/synchronous-shadow-image-report.json`.
Set `CV_IMAGE_CASE_DIR=/path/to/folder` to use another directory. Set
`CV_IMAGE_RESULT_FILE=/path/to/report.json` to change the output path. The
default browser on Apple Silicon is installed Chrome; override it with
`CV_BROWSER_CHANNEL=chromium` when needed.

To inspect the ray graphs interactively, start `npm run dev` from `frontend/`,
open `http://localhost:3000/cv-image-test`, select `background.png` and all
labeled files, then choose **Run image analysis**. The background picker sets
the reference image used for marker detection, homography, and luma subtraction
for every case. The labeled case picker sets which files get analyzed. If
`background.png` is selected in both pickers, it is automatically removed from
the case list. The page displays the reference filename in the setup panel and
beside each case result. This uses the same browser analysis as the batch
runner.

The interactive page shows two experimental refinements beside the MediaPipe
result. The subtraction candidate uses absolute luma difference from the empty
sheet, selects a bounded changed-pixel run near the landmark, then searches a
5-pixel-wide vertical profile for a sustained drop. The nail-color candidate
searches within 36 pixels of the landmark for pixels within ±30 independently
in each RGB channel of the provisional target (138, 98, 88), selects the nearest
connected component, and marks its pixel centroid. It additionally requires
red to be at least 30 greater than green. The original RGB crop marks MediaPipe
in red,
the subtraction candidate in green, nail-color matches with translucent yellow,
the component boundary in yellow, and its center in blue. Purple guides start
at MediaPipe's point: one extends left and right along that row while pixels
match the nail-color rule, and another extends down from the horizontal span's
midpoint until the next pixel falls outside the rule. A yellow dot is placed
25 pixels above the vertical guide endpoint; this offset is provisional. The
reported confidence is a component-area heuristic, not a calibrated
probability. These candidates and guides are diagnostic only and do not affect
live note decisions. The color method can fail when lighting shifts the nail
color, similar colors occur nearby, or the nail is occluded; inspect the
overlay for those cases.

Each target also has a 640 × 480 source-pixel original crop and a subtraction
crop matching the live debugger's framing: 140 × 140 source pixels centered on
the rounded MediaPipe point and enlarged 2× with nearest-neighbor scaling. The
crop displays raw absolute difference without amplification. This magnitude
view does not distinguish whether a pixel got lighter or darker, so hands and
shadows can both appear as changed pixels. The 12-luma binary threshold is used
internally for edge selection; it is not the displayed subtraction image. A
graph shows luma difference along the vertical scan. In the subtraction crop,
red marks MediaPipe, yellow marks the horizontal changed region, blue marks the
vertical scan and selected edge, and green marks the subtraction point. The
yellow nail-color dot from the original RGB crop is also drawn here with three
45-pixel rays: straight down and at ±20 degrees. The rays use blue, purple, and
green, respectively. The original RGB crop uses the colors described above
for the nail-color component. The existing three graphs remain centered at
MediaPipe; an additional center/left/right graph set is sampled from the yellow
dot.
If the horizontal run exceeds the width limit, the page still plots the
vertical profile at the MediaPipe x and explains that no subtraction point was
placed.

## Read the report

The page shows marker IDs and whether homography/background setup succeeded,
then lists each requested fingertip's MediaPipe pixel coordinate, key overlap,
candidate state, per-ray dip depth, steepest rise, rebound width, and changed
background sample count. The JSON contains the full 46-sample profiles for all
three rays, allowing the exact rule inputs to be inspected. A mismatched image
resolution disables background comparison and can invalidate the projected
key overlap; keep the reference and cases at the same resolution.

The live note-candidate decision uses only the center ray. In the image replay,
each ray graph marks its own dip and rebound and labels whether that ray
matches the provisional short dip-rise shape: an 8–50 luma dip, a rise of at
least 20 luma/pixel, and rebound within 6 pixels. The preview also shows a
recall-first three-ray OR: the fingertip is a visual candidate if any ray
qualifies. It does not affect contact state. Background differences also
remain diagnostic. A still-image run cannot evaluate frame-to-frame jitter,
confirmation, or release timing. Do not treat its counts as live accuracy
evidence.

The user reports that the yellow point visually aligns with the fingertip
better than the red MediaPipe point in the inspected image. This is qualitative
feedback from image inspection, not a measured localization-accuracy result.
Compare both graph sets on labeled hover and press images before treating the
yellow point as a better estimator.

### Per-ray short dip-rise visualization (2026-10-17)

Each of the three ray graphs marks its own dip and rebound and reports whether
that ray meets the provisional short-pair bounds: dip depth 8–50 luma, rise at
least 20 luma/pixel, and rebound within 6 pixels. The preview's recall-first
OR labels a fingertip candidate when any one ray qualifies; it does not
trigger notes. In the replay of 19 available images (11 hover and 11 press
targets), the MediaPipe-origin center, left, and right rays met the bounds on
3, 2, and 2 press targets, and 0, 0, and 3 hover targets, respectively. The
OR qualified on 4/11 presses and 3/11 hovers. For the yellow-dot profiles,
counts were 4, 3, and 3 press targets and 1, 0, and 3 hover targets; the OR
qualified on 8/11 presses and 4/11 hovers. These counts show the intended
tradeoff for this exploration: more press examples appear, with false
candidates accepted for now. Future knuckle or Z-line evidence can help reject
those candidates. Still images do not establish contact accuracy or temporal
behavior.

The per-target results also show a second set of center/left/right luma graphs
sampled from the yellow-dot location. They are additional to, and do not
replace, the MediaPipe-origin graphs. Both sets use the same ray length,
directions, smoothing, and profile measurements; neither changes note
decisions.

### Static dark-shadow candidate (approach/release exploration)

Each target's original RGB crop overlays in blue pixels in a region 40 pixels
to each side of the MediaPipe fingertip and 2–45 pixels below it. A pixel is
shown when it is at least 60 luma darker than the empty-sheet reference, has
absolute luma at most 100, every RGB channel at most 120, and R−G at most
20. The outline and nail-color contour are hidden; the fingertip marker and
other guides remain.
The JSON records candidate area and mean luma drop. These stricter bounds show
dark, black-ish pixels, not a semantic shadow classifier: finger occlusion,
other fingers, exposure changes and camera movement can still be colored.

The crop also draws five 45-pixel dotted probes from the fingertip at 0°, ±18°
and ±35° toward the lower image direction. Gray shows each full probe; blue
shows the first contiguous dark run on each path. A probe stops its blue trace
at the first non-dark sample after entering a dark run. When at least two
probes find runs, a purple, rotated oval encloses the probe samples using their
principal axes; the displayed diameters are a rough fit to sparse samples, not
a segmented shadow boundary. `drawLinesToShadow()` owns this visualization.
The rectangular region count remains a separate numeric reference and is not
used to color the probe overlay. No shape result affects note decisions.

Use the same reference frame and camera placement for labeled hover, press,
approach and release stills. Compare the overlay and candidate area across
examples before deciding whether the feature is useful. Approach and release
cases remain NOT SCORED by the press/hover profile rule. This experiment is
static and diagnostic only; it does not implement motion, press/release state,
or note dispatch. The threshold and region size are initial visualization
choices, not tuned decision bounds.

#### First dark-shadow replay (2026-10-27)

The first replay with the broad 40-luma-only mask used the existing 11 hover
and 11 press targets, a valid 1620 × 1080 background, and all four markers.
Candidate areas overlapped: hover ranged from 1907 to 3358 pixels (median
3055), and press ranged from 1295 to 3391 pixels (median 2881). This baseline
did not separate the labels. The set contains no approach or release labels,
so those groups remain to be collected and inspected. Existing profile results
in the same replay were 4/11 press candidates and 2/11 hover false positives;
neither metric is a claim of live contact accuracy.

#### Dark, black-ish filter update (2026-10-27)

The broad 40-luma-only mask included many pixels that were dark relative to
paper but not black-like. Requiring a 60-luma drop, luma at most 100, all RGB
channels at most 120, and R−G at most 20 reduced the broad-region candidate
area to a mean of 380 pixels for hover and 117 for press. The ranges still
overlap (hover 0–1686; press 0–324), so this area is not a static press/hover
separator. Dark warm skin RGB also occurs near the fingertip in these images;
the limits reduce some skin pixels but cannot guarantee semantic shadow
detection. They are exploratory for the current setup, not a portable RGB
model. The orange/yellow nail contour was removed from the original crop to
make the dark candidate overlay easier to inspect. The updated browser replay
rendered five probes and oval overlays on all 22 labeled hover/press targets
without browser errors. This checks the visualization path only; there are no
approach/release labels, and visual inspection is still needed to judge whether
the probes follow the intended shadow.

### Experimental adjacent-frame comparison (2026-10-27)

When multiple labeled images are selected, the replay sorts them by the
`_frame_NNNNNN_` number and retains the previous sample for each hand/finger.
It compares only forward frame gaps of 1–3 frames. A press candidate requires
both a strict decrease in MediaPipe fingertip Y (`currentY < previousY`) and
an absolute oval-area transition from at least 300 px² to at most 100 px².
The size bands leave a middle region that does not count as either large or
small; this avoids treating every small fluctuation as a threshold crossing.
The reverse small-to-large size transition is reported for inspection, but does
not produce a release decision. These are provisional constants and the
comparison is diagnostic only. The existing image set is sparse and contains
no labeled approach/release sequence, so its comparisons are not temporal
accuracy evidence.

On the 2026-10-27 replay, seven same-finger frame pairs fell within the
three-frame comparison window. None met both press conditions: most lacked an
oval in one of the two frames, and the one pair with two oval measurements did
not cross the large/small bands. This sparse set therefore verifies the
comparison display, not the press hypothesis.

### Live Y/shadow note detection (2026-10-27)

The experimental rule now feeds the live fingertip contact state machine. With
key overlap and valid camera geometry, a note press requires a strict decrease
in fingertip image Y and a fitted dark-shadow oval area transition from at
least 300 px² to at most 100 px². Once pressed, the detector remains latched
through the middle size band. It clears the latch when Y increases and area
transitions from at most 100 px² to at least 300 px²; the existing contact
release grace then sends note-off. Comparisons more than 120 ms apart cannot
combine into a press. These values are experimental and image-Y direction
follows the requested rule, not a calibrated physical velocity.

The live detector captures its full-frame reference on the first frame with
all four markers visible. Start with the printed sheet empty and fingers out of
view so the reference represents the sheet. A missing reference disables
contact detection. In the visual debugger, dotted blue lines are probe paths;
solid blue segments show detected runs when an oval can be fitted. The purple
oval is the fitted measurement, and the motion-rule line shows Y direction,
size transition, area and latch state. If the area is unavailable, the current
debug output does not distinguish zero detected runs from a single run that
was insufficient to fit an oval. Synthetic checks cover
tracker transitions; physical camera behavior and press/release accuracy still
need a hands-on run with the intended setup.

## Initial still-image run (2026-10-17)

The first run used the 19 labeled images in `images_test_cases/` and the
1620 × 1080 `background.png`. Marker detection found IDs 0–3 and produced a
valid homography. MediaPipe matched the requested hand labels in the inspected
right-ring cases, and their projected fingertips overlapped white keys.

Across 11 labeled hover samples and 11 press samples, the current detector
produced no hover candidates and 3 press candidates (8 missed presses). The
two `press_right-ring` files have identical pixels and identical MediaPipe
landmarks. At the ring fingertip `(617.9, 459.2)`, the center ray measured a
dip of −0.4, rise of 1.6 luma/pixel, and a 31-pixel rebound, so it clearly
fails the candidate rule. The right-angled ray had an 8.6 dip and 12.8
luma/pixel rise, also below the rise threshold. This is a profile miss at the
landmark used for the labeled ring finger, not a marker or key-overlap failure.

One hover ring sample is close to the current threshold: its center-ray dip is
6.0 (minimum is 8), while rise and rebound width meet their limits. Small
per-frame landmark or image variation could move a similar hover across the
dip threshold. Lowering that threshold to recover the missed press would
therefore risk a false press; temporal confirmation and a better spatial cue
need evaluation together. In this still set, hover images themselves did not
produce candidates, so a live false press may also depend on temporal state or
another fingertip sharing the key.

The background-difference samples changed substantially for both hover and
press cases and remain diagnostic only. This run does not establish a
background-difference threshold that separates contact from hover. Its full
per-ray data and fingertip locations are in the ignored local report at
`frontend/test-results/cv-image-cases/synchronous-shadow-image-report.json`.

## Initial fingertip refinement replay (2026-10-17)

The current diagnostic refinement uses absolute luma subtraction at a 12-luma
changed-pixel threshold. The horizontal run is limited to 120 pixels on each
side. Its vertical profile averages five neighboring columns, smooths three
adjacent rows, and selects the strongest sustained drop of at least 8 luma
between four-sample windows. The candidate point is placed four pixels above
that drop. This version found a proposed point for 7 of 22 targets. Four
labeled hovers remained hover; none of the three labeled presses with a
proposed point produced a press candidate, and 15 targets had no proposed
point. The original MediaPipe points produced 3 of 11 press candidates and 11
of 11 hover negatives. The refinement has not improved classification. Inspect
the zoomed subtraction crops and line graphs to determine whether the horizontal
region, edge drop, or inset is responsible. The thresholds remain provisional
and do not affect live note detection.

### Comparing darkness hypotheses locally (2026-10-27)

The page and JSON now include `shadowEvidence` and (for the existing 1–3-frame
comparison window) `shadowEvidenceChange`. The same strict dark-pixel filter
is measured in two landmark-relative bands: 2–10 pixels below the tip (near)
and 11–45 pixels below it (forward), both ±40 pixels horizontally. These are
sampling regions, not localized contact edges or semantic shadow boundaries.
Each band reports actual sampled pixels, dark pixels, dark fraction, summed
background-relative darkening, and darkening divided by all sampled pixels.
A valid region with no qualifying pixels reports zero; missing background or
an absent band is unavailable. Frame-edge clipping changes the sampled area.

The 44-entry row profile reports strict darkening averaged across each row.
`maxSpatialGradient` is its largest absolute adjacent-row difference, not the
older ray rebound metric. Temporal deltas are current minus previous strength;
positive means darker. They are differences per sampled frame pair, not rates
per second, and do not classify contact or change live notes.

Local production replay passed on 19 images / 22 targets, with no browser
errors. Near-strength min/median/max: hover 0/0/32.21, press 0/0.20/11.86;
forward: hover 0/4.26/53.37, press 0/1.63/10.65. Spatial gradient:
hover 0/3.34/44.11, press 0/4.09/8.25. The overlap does not support a static
threshold. The lower forward median motivates temporal inspection but does
not establish that individual presses reduce darkness. Origin placement,
printed ink, finger occlusion and illumination remain confounds. There are
still no approach/release labels in this image set.

#### Adjustable dark-pixel limits

Both replay pages expose **Experimental dark-pixel filter** controls for minimum
paper-relative luma drop, maximum absolute luma, maximum RGB channel, and maximum
R−G. All four conditions must pass. Defaults remain 60/100/120/20; reset restores
these values. Lowering minimum drop or increasing the other limits admits more
pixels. This can recover shadow while also admitting skin or ink, so inspect
negative examples alongside presses. Values apply on the next run and are
recorded as `darkPixelFilter` in setup; old results keep their original settings.
The original image crop now overlays every matching region pixel in translucent
blue, alongside the probe/oval visualization, using exactly the same filter as
the metrics. Controls affect these diagnostics, not the live detector or the
older ray-profile classification. No new values have been established as better.

## Finger-independent heatmap

For the current shadow-only experiment, open `/cv-shadow-test` using the link
at the top of this page. It supports images and paused video without finger
tracking, marker detection or a sidecar. See [heatmap usage and limits](cv_shadow_heatmap.md).
