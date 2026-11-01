# Finger-independent shadow heatmap

Open `/cv-shadow-test` from either existing image or video diagnostic page.
The viewer compares local source pixels with an empty-sheet reference without
loading MediaPipe, OpenCV, marker geometry or the live contact pipeline. There
is no grouping, skin classifier, finger association or note dispatch.

## Images

Choose a current image and an empty-sheet reference from the same camera
position at the same native resolution. The maps update after loading and
whenever display controls change. Images need no labeling convention.
The whole frame is analyzed, including anything outside the paper; this tool
does not segment the paper. Use the camera framing to inspect the sheet.

## Video

Choose a video. Pause on a frame with an empty sheet, then select **Capture
empty reference**, or upload a reference image with matching native dimensions.
Native video controls handle playback and seeking. Maps are cleared during
playback and update after pausing or seeking, avoiding a queue of expensive
frame work. **Previous frame** and **Next frame** seek by `1/FPS`; set FPS to
match the recording. Stepping uses integer target indices to avoid accumulated floating-point drift. Analysis waits for presentation or a bounded paint fallback after seeking; the browser check compares captured source pixels with the decoded video (up to two levels of canvas rounding). Frame numbers are approximate decoder positions, not a
verified encoded-frame counter. No sidecar, calibration or tracked hand is
required. A reference captured from a video is cleared when the source changes;
an explicitly uploaded reference can be reused across same-camera images.

## Read the maps

**Darkening** is `reference luma − current luma`, retaining its sign for pixel
inspection. Only positive darkening contributes to the map and statistics.
Black means no displayed positive darkening, blue low, yellow intermediate,
and red strongest. Brighter pixels do not become shadows through absolute
subtraction. The noise floor hides small changes; the full-scale control sets
where the palette saturates. This is continuous visualization, not the four
bounds used in the older strict dark-pixel detector. Scales remain fixed as
frames change. Gray indicates reference pixels excluded by the reference-luma
cutoff or transparent pixels.

**Color change / ambiguity** measures the largest absolute change in normalized
RGB channel proportions (`channel / (R+G+B)`), scaled by 255. Uniform channel
attenuation preserves those proportions. A finger can change them, but colored
lighting/shadows, skin and objects overlap; low color shift does not establish
shadow, and high shift does not establish skin. Current RGB sums below 15 have
unknown chromaticity and appear gray. Use the exclusion experiment below to inspect darkening after high color-shift pixels are excluded.

Hover over either map to see coordinate-matched source/reference RGB, signed
luma difference and color shift. Coordinates and statistics describe the
resampled analysis image: the longest edge is capped at 640 pixels with no
upscaling. Both inputs use the same resize; native resolution mismatches
clear the maps. Fine contact shadows may be lost during downsampling. Existing
printed ink should cancel if registration/exposure match; very dark reference
pixels are ignored by default because their color/darkening is poorly observed.
Camera movement, auto-exposure and illumination changes remain confounds.

## Verification

From `frontend/`, build/start the app, then run:

```sh
MAKE_SHIFT_URL=http://127.0.0.1:3107 npm run test:shadow-heatmap-browser
```

Use `CV_BROWSER_CHANNEL=chrome` (default) or an installed browser channel.
The local browser runner uses `images_test_cases/` and clip 1, saving reports
and screenshots under ignored `frontend/test-results/shadow-heatmap/`.
Synthetic cases live in `tests/frontend/shadowHeatmap.test.ts`. See the
[verification inventory](../tests/verification_test_inventory.md) for execution
status. These checks verify the diagnostic tool, not semantic shadow detection
or physical contact accuracy.

Local execution on 2026-10-27 passed five synthetic cases and the browser
checks on 19 labeled images plus reference self-comparison, video reference
capture and stepping, source-pixel agreement, settings, mismatch handling,
pixel readout and mobile layout. Desktop/mobile screenshots were inspected.
This does not establish correct shadow/finger classification.

## Inside labeled video replay

`/cv-video-replay?manual=1` also offers **Diagnostic view → Shadow heatmaps**
(default). It uses the replay's own marker-captured empty-sheet reference and
Previous/Next controls. Pause to render and adjust heatmap scales. See
[replay setup and reference behavior](cv_video_tests.md#heatmaps-inside-the-replay).
The standalone viewer remains independent of hand/marker inference; the
integrated view shares the existing replay's source and evaluation workflow.


## Brightness–chromaticity experiment (2026-10-27)

Both this page and the paused replay now show four additional maps computed
from the same current/reference pair:

- Brightness multiplier `a = (I·B)/(B·B)` (display range 0–1.5).
- Attenuation `1−a` (display range 0–1).
- Reference-relative mismatch `e_B = ||I−aB||/||B||`.
- Current-relative mismatch `e_I = ||I−aB||/||I||`.

Raw values retain brightening (`a > 1`, negative attenuation) and values above
map saturation. Residual display full scale defaults to 0.3 and can be edited;
it changes the palette, not the measurements or exclusion thresholds. RGB
values are camera-encoded, without linearization. No color-space or illumination
model is assumed to be physically validated.

Projection maps display gray for excluded references, transparent inputs, zero
references, or current/reference RGB sums below 15. Mathematically available
low-signal raw values remain inspectable. Zero current brightness has an
unknown `e_I`; it is never confidently retained by either exclusion method.

**Darkening after color exclusion** starts with the existing positive luma
map. **Exclusion method** switches between normalized RGB color shift and
projection `e_I`. Pixels above **Maximum retained color shift** (initially 10)
or **Maximum retained e_I** (initially 0.15) are displayed black. Unknown color
remains gray. Threshold equality is retained; the existing darkening floor
and full-scale settings apply after filtering. The two thresholds are independent;
only the selected method's threshold affects exclusion. Defaults are exploratory,
not tuned shadow/skin classifier settings.

Hover over any new map for analysis coordinates, `a`, `1−a`, `e_B`, `e_I`, and
color shift. On the standalone page, the original two maps additionally show
current/reference RGB with the projection values. For a useful experimental
record, save the source filename or video time, reference filename/capture time
(or replay reference ID), analysis coordinate, RGB pair, measurements, selected
method and threshold, and a human category: paper, shadow, skin, nail, ink,
boundary or ambiguous. The browser runner records an unlabelled central projection
sample for each saved image; these are tool checks, not ground truth labels.

Start with visible skin and surrounding shadows, compare the two methods on
the same frame, and inspect which shadows disappear as exclusion gets stricter.
Neutral occluders can survive either filter. No clustering, live contact changes,
LAB/HSV experiment or press threshold is introduced.


## Save labeled pixels and patches

The **Labeled pixel / patch samples** section is available below the projection
maps on both diagnostic pages. Its source image is unfiltered so labels need
not depend on either method's output.

1. Choose **Sample label**: paper, shadow, skin, nail, ink, boundary or ambiguous.
   Use ambiguous whenever the source does not establish a clear category.
2. Set **Contact phase** to hover, approach, touch, hold or release only when
   you can identify it visually; otherwise leave unspecified. This is a human
   annotation, not an inferred contact state.
3. Choose a 1×1, 3×3, 5×5 or 9×9 patch and optionally add a note (finger,
   lighting, uncertainty). Click the source image to save immediately. The
   outline marks the selected patch. Edge patches are clipped, not padded.
4. Alternatively set **Sample X/Y**, then **Save selected sample**. Coordinates
   stay selected across frames (clamped for a smaller image), making it easier
   to revisit the same paper location through a transition. This does not
   track a moving finger; choose new coordinates when the finger moves.
5. Review the saved table. Color/projection retention counts describe the
   captured thresholds, with unknown counts reported separately. **Remove**
   deletes an individual sample. **Export samples JSON** downloads all samples.

There is a 200-sample in-memory limit per open collector. Samples survive
frame, source, reference and filter changes within the view. Export before
refreshing, navigating away or switching the replay's diagnostic view: those
unmount the collector and clear its memory. Nothing is uploaded or persisted to
localStorage; JSON import is not implemented.

The version-1 export records a sample UUID and save time, source/reference IDs
and names, native and analysis dimensions, selected coordinate/patch bounds,
human label/phase/note, filter and display settings, and each patch pixel's
source/reference RGB and alpha, signed luma drop, color shift, multiplier,
attenuation and both residuals. Invalid/unknown measurements use `null`, with
explicit validity flags. Both exclusion methods are evaluated independently at
capture settings; unknown classification remains `null`. Retention also requires
luma drop strictly above the selected darkening noise floor.

Image samples have no frame/time. Standalone video exports the selected FPS,
media time and an **approximate** frame index. Replay exports its processing
index/media time and versioned captured-reference ID; a capture time for that
reference is unavailable and remains null. Source IDs identify individual loads
or replay runs. For held-out evaluation, group repeated loads/exports of the
same original recording together using the recording identity/name, rather
than treating each generated load ID as a separate clip.

Suggested first collection: sample clear paper, skin and soft/thin shadow at
hover, approach, touch, hold and release, using fixed thresholds and a stable
reference. Repeat with other fingers and lighting before tuning. Mixed patches
should be boundary/ambiguous; no semantic ground-truth claims are made by the
browser fixture's deliberately assigned test labels.


## Measure the fingertip shadow band

Both heatmap views include **Fingertip shadow-band measurement**. This is a
paused diagnostic with manually placed source anchors; it does not detect a
finger or dispatch a press/release.

1. Pause on a frame with a matching empty reference. Keep the exclusion method,
   mismatch threshold and darkening noise floor fixed through a sequence.
2. Choose **Mark fingertip** and click the distal boundary in the source image,
   where the fingertip ends and visible paper begins.
3. Click an outward point on the paper in the direction you want to inspect.
   The second point defines direction, not scan length. The first click alone
   does not confirm a measurement. Use the source image rather than the black
   region of the filtered map to place the boundary.
4. Alternatively edit **Tip X/Y** and **Outward X/Y**, then **Confirm anchors for
   this frame**. All coordinates are analysis pixels. Source/frame/reference
   changes invalidate confirmation. Coordinates remain as suggestions only;
   move them to follow the actual source tip on each frame.
5. Set **Band scan length** (1–64, initially 24) and **Band half-width** (0–4,
   initially 2). A half-width of 2 gives five parallel rays at offsets −2…2
   perpendicular to the chosen outward direction. Flat parallel origins only
   approximate a curved fingertip. Save the finger/phase and measurement using
   **Save band measurement**, then **Export band JSON** before leaving the view.

Each ray samples at one-analysis-pixel distance steps, with nearest-pixel RGB
measurements. It measures the first contiguous shadow-compatible run only if
that run begins within the first three steps. One or two below-floor steps may
precede the run; a later separate shadow is not attached to the fingertip.
The run must end at a valid pixel at/below the darkening floor. Width is the
number of sampled one-pixel steps in that run, not the distance from the tip
and not a calibrated physical length. Raw profiles retain distance, coordinates,
signed darkening, color shift, `e_I` and per-sample evidence state.

A color-mismatched or unknown boundary is **ambiguous-boundary**, not a measured
end. A run reaching the image or scan edge is **censored**, with a lower bound
where available. No nearby retained run is **insufficient-evidence**. A median
width is reported only when at least half (rounded up) of the rays have complete
measurements. Missing bands never become a confident zero-width/contact result.
The table reports all per-ray statuses, including unavailable rays.

The source overlay uses yellow for retained shadow-compatible samples, blue for
valid at/below-floor samples, and gray for unknown/color-mismatched samples.
An independent source fingertip boundary still needs human judgment. Thin bands
can be lost at 640-pixel analysis resolution; a one-pixel anchor error can be
material. Compare ±1–2-pixel anchor shifts before interpreting changes. Reference
misregistration, printed ink, exposure, neighboring fingers and color-filter
changes can also alter a measured band. There is no validated width threshold.

Band exports use schema version 1, preserve source/reference context, anchors,
filter/display/scan settings, human finger/phase, each ray's raw profile and
width/status, and the aggregate result. Unknown widths remain null. Records
are bounded to 200 in memory, survive frame/settings changes, and can be removed
last-first with **Remove last band record**. A source/reference switch invalidates
the current anchors but preserves saved records. Reloading or switching diagnostic
views clears memory. This export is separate from `shadow-samples.json`.

Run the synthetic browser check against a production server:

```sh
cd frontend
MAKE_SHIFT_URL=http://127.0.0.1:3107 npm run test:shadow-band-browser
```

It verifies a known five-pixel band, absent-band/invalid-anchor states,
two-click and keyboard anchors, frame confirmation, frozen exported records,
record removal, no inference requests and mobile overflow. It does not validate
physical contact, skin boundaries or actual video shadow ownership.
