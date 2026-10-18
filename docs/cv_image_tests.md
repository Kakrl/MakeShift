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
