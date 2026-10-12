# Knuckle eligibility boundary

This is a working note for reviewing the current knuckle calibration. It
describes the implementation and questions to resolve; it does not claim that
the signal estimates metric depth or physical contact.

## What the code currently does

The implementation does not project knuckles onto a geometric keyboard plane.
Keyboard projection is handled separately by marker-derived homography. The
knuckle experiment measures normalized image-space spacing between four MCP
landmarks, then uses that value to look up a per-finger fingertip image-Y
eligibility boundary.

Calibration captures five hand poses named top-left, top-right, bottom-left,
bottom-right, and center. For each capture it stores the median MCP spacing,
each fingertip's normalized image Y, and fingertip MediaPipe Z. The model
summarizes repeated button captures by median. Runtime knuckle eligibility
interpolates the stored fingertip-Y boundary across the sorted MCP-spacing
samples. The live check allows a playing margin and retention hysteresis.

The principal code is:

- [`depthCalibration.ts`](../frontend/src/cv/depthCalibration.ts): MCP spacing,
  capture samples, model construction, persistence, and
  `getKnuckleBoundaryY` interpolation.
- [`calibration/page.tsx`](../frontend/src/app/calibration/page.tsx): button
  capture flow and construction of observations from normalized fingertip
  image Y values.
- [`contactPipeline.ts`](../frontend/src/cv/contactPipeline.ts): runtime
  eligibility threshold, playing margin, and hysteresis.
- [`liveContactPipeline.ts`](../frontend/src/cv/liveContactPipeline.ts):
  applies knuckle eligibility when the technique is enabled.
- [`MarkerTrackingOverlay.tsx`](../frontend/src/app/MarkerTrackingOverlay.tsx):
  draws the per-finger eligibility guides in visual-debug mode.

`knuckleLines` are fitted and persisted, but the runtime boundary lookup uses
the five captured samples and piecewise interpolation rather than those fitted
lines. The current live configuration also has knuckles disabled by default in
`liveContactPipeline.ts`.

## Why the result may look off

MCP spacing is a hand-scale proxy, not a direct measurement of fingertip
distance to the keyboard. It can change with camera distance, hand rotation,
finger posture, hand shape, and landmark noise. The target boundary is
normalized image Y, which also changes with hand placement and camera view.
Thus the learned relationship can reflect a particular pose and setup without
representing the distance from a fingertip to the paper.

The five labels describe where the hand is placed, but the capture code does
not use known keyboard-plane coordinates for those locations or record a
ground-truth contact/hover label. It fits an empirical eligibility curve, not a
physical plane. The corner and center samples are not used as a two-dimensional
surface over sheet coordinates.

These observations make the current name and intended role worth revisiting.
The implementation can still be evaluated as a heuristic, but it should not
be interpreted as geometric plane projection or contact evidence on its own.

## Questions for the redesign

- What should the calibration boundary represent: a geometric height, an
  eligibility region, or a user-specific transition signal?
- What observable measurement should vary reliably with that quantity across
  hand rotation and posture?
- Should each calibration sample include known sheet coordinates and an
  explicit contact/hover label?
- How should model fit and unsupported ranges be shown to the user?
- Which held-out recordings should be used to compare the current heuristic
  against alternatives?

Potential replacements include a labeled empirical model over sheet position
and normalized features, a local calibrated depth residual, or metric plane
distance if camera intrinsics and a validated 3D hand point are available.
These are options to evaluate; none is established by the current code.
