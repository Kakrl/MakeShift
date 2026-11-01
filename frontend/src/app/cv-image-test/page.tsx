"use client";

import Link from "next/link";

import { useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { checkKeyOverlap } from "../../cv/contactPipeline";
import { SHADOW_CROP_RADIUS } from "../../cv/liveContactPipeline";
import type { Fingertip, HandObservation } from "../../cv/collision";
import { MarkerDetector } from "../../cv/markerDetector";
import { PAGE_CORNERS } from "../../cv/calibration";
import { computeHomography, projectPoint } from "../../cv/homography";
import { getWhiteKeyPolygons } from "../../cv/keyboardGeometry";
import { DEFAULT_LAYOUT } from "../../cv/keyboardLayout";
import {
  analyzeDarkShadowRegion,
  darkShadowRuns,
  measureShadowEvidence,
  compareShadowEvidence,
  type ShadowEvidence,
  DEFAULT_DARK_SHADOW_FILTER,
  type DarkShadowFilter,
  findDarkShadowSize,
  SHADOW_PROBE_ANGLES_DEGREES,
  SHADOW_PROBE_LENGTH_PX,
  type DarkShadowSize,
} from "../../cv/darkShadowRegion";
import {
  compareShadowPress,
  isComparableFrameGap,
  LARGE_SHADOW_AREA_PX,
  MAX_COMPARISON_FRAME_GAP,
  SMALL_SHADOW_AREA_PX,
  type ShadowSizeTransition,
} from "../../cv/shadowPressHysteresis";
import {
  analyzeSynchronousShadow,
  SYNCHRONOUS_SHADOW_CROP,
  type SynchronousShadowMeasurement,
} from "../../cv/synchronousShadowDetector";
import type { Point } from "../../cv/types";
import { WASM_PATH } from "../useHandLandmarker";

import ShadowFilterControls from "../ShadowFilterControls";

const MODEL_PATH = "/models/hand_landmarker.task";
const TIP_INSET_PX = 4;
const HORIZONTAL_SEARCH_PX = 40;
const MAX_FINGER_HALF_WIDTH_PX = 120;
const DOWNWARD_SEARCH_PX = 80;
const BACKGROUND_DIFFERENCE_THRESHOLD = 12;
const MIN_BOUNDARY_DROP = 8;
const COLOR_SEARCH_RADIUS = 36;
const VERTICAL_SCAN_DOT_OFFSET_PX = 25;
const SHADOW_RAY_LENGTH_PX = 45;
const SHADOW_RAY_SIDE_ANGLE = (20 * Math.PI) / 180;
const NAIL_RGB = [138, 98, 88] as const;
const NAIL_RGB_TOLERANCE = 30;
const SHADOW_LUMA_MIN_DROP = 18;
const DARK_SHADOW_LUMA_DROP = 40;
const FINGER_LANDMARKS = {
  thumb: 4,
  index: 8,
  middle: 12,
  ring: 16,
  pinky: 20,
} as const;
type FingerName = keyof typeof FINGER_LANDMARKS;

interface TargetLabel {
  hand: "left" | "right";
  finger: FingerName;
}

type ProfileColorClass = "nail" | "paper" | "darkShadow" | "lightShadow" | "other";
interface RgbRayProfile {
  label: "center" | "left 20°" | "right 20°";
  classes: ProfileColorClass[];
  steps: number[];
}

interface ImageCaseResult {
  fileName: string;
  label: "hover" | "press" | "approach" | "release" | "unknown";
  dimensions: string | null;
  backgroundDimensionsMatch: boolean | null;
  detectedFingertips: Array<{
    hand: string;
    finger: FingerName;
    point: Point;
  }>;
  targets: Array<{
    requestedHand: string;
    finger: string;
    detectedHand: string | null;
    handednessMatched: boolean | null;
    landmark: Point | null;
    yellowPoint: Point | null;
    keyIndexes: number[];
    measurement: SynchronousShadowMeasurement | null;
    yellowMeasurement: SynchronousShadowMeasurement | null;
    refinedPoint: Point | null;
    colorPoint: Point | null;
    rgbProfiles: RgbRayProfile[];
    yellowRgbProfiles: RgbRayProfile[] | null;
    colorRefinement: {
      area: number;
      confidence: number;
      contour: Point[];
      scan: { left: Point; right: Point; middle: Point; bottom: Point } | null;
      failureReason: string | null;
    } | null;
    refinement: {
      leftEdge: Point | null;
      rightEdge: Point | null;
      paperBoundary: Point | null;
      lineProfile: number[];
      edgeStrength: number | null;
      failureReason: string | null;
    } | null;
    refinedMeasurement: SynchronousShadowMeasurement | null;
    darkShadowArea: number | null;
    darkShadowMeanDrop: number | null;
    shadowEvidence?: ShadowEvidence | null;
    shadowEvidenceChange?: ReturnType<typeof compareShadowEvidence> | null;
    shadowEllipse: {
      areaPx: number;
      majorDiameterPx: number;
      minorDiameterPx: number;
    } | null;
    comparisonFrameGap: number | null;
    yDecreased: boolean | null;
    shadowTransition: ShadowSizeTransition;
    pressCandidate: boolean | null;
    error?: string;
  }>;
  error?: string;
}

function parseLabel(fileName: string): { label: ImageCaseResult["label"]; targets: TargetLabel[] } {
  const match = /^(hover|press|approach|release)_(.+?)_frame_/i.exec(fileName);
  if (!match) return { label: "unknown", targets: [] };
  const targets = match[2].split("+").flatMap((part) => {
    const target = /^(left|right)-(thumb|index|middle|ring|pinky)$/i.exec(part);
    return target
      ? [{ hand: target[1].toLowerCase() as TargetLabel["hand"],
          finger: target[2].toLowerCase() as FingerName }]
      : [];
  });
  return { label: match[1].toLowerCase() as ImageCaseResult["label"], targets };
}

function imageFrameNumber(fileName: string): number | null {
  const match = /_frame_(\d+)_/i.exec(fileName);
  return match ? Number(match[1]) : null;
}

type CaseVerdict = "PASS" | "FAIL" | "NOT SCORED";

function detectorLabel(state: SynchronousShadowMeasurement["state"] | undefined) {
  if (state === "press candidate") return "PRESS";
  if (state === "hover") return "HOVER";
  return "UNKNOWN";
}

function targetVerdict(
  expected: ImageCaseResult["label"],
  measurement: SynchronousShadowMeasurement | null,
): CaseVerdict {
  if ((expected !== "hover" && expected !== "press") || !measurement || measurement.state === "unknown") {
    return "NOT SCORED";
  }
  return (expected === "press") === (measurement.state === "press candidate")
    ? "PASS"
    : "FAIL";
}

function verdictStyle(verdict: CaseVerdict | "PARTIAL"): React.CSSProperties {
  const color = verdict === "PASS"
    ? "var(--color-success-strong)"
    : verdict === "FAIL"
      ? "var(--color-danger)"
      : "var(--color-ink-muted)";
  return { color, borderColor: color };
}

function imageVerdict(result: ImageCaseResult): CaseVerdict | "PARTIAL" {
  const verdicts = result.targets.map((target) => targetVerdict(result.label, target.measurement));
  if (!verdicts.length || verdicts.every((verdict) => verdict === "NOT SCORED")) {
    return "NOT SCORED";
  }
  if (verdicts.every((verdict) => verdict === "PASS")) return "PASS";
  if (verdicts.every((verdict) => verdict === "FAIL")) return "FAIL";
  return "PARTIAL";
}

function VerdictBadge({ verdict }: { verdict: CaseVerdict | "PARTIAL" }) {
  return <span className="ml-2 inline-block rounded border px-2 py-0.5 text-sm font-bold" style={verdictStyle(verdict)}>{verdict}</span>;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Unable to decode ${file.name}`));
    };
    image.src = url;
  });
}

function canvasFor(image: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Unable to create image canvas");
  context.drawImage(image, 0, 0, width, height);
  return { canvas, context };
}

function makeRgbRayProfiles(
  image: ImageData,
  background: ImageData | null,
  center: Point,
): RgbRayProfile[] {
  const rays = [
    { label: "center", angle: 0 },
    { label: "left 20°", angle: -SHADOW_RAY_SIDE_ANGLE },
    { label: "right 20°", angle: SHADOW_RAY_SIDE_ANGLE },
  ] as const;
  return rays.map(({ label, angle }) => {
    const classes: ProfileColorClass[] = [];
    const steps: number[] = [];
    for (let step = 0; step <= SHADOW_RAY_LENGTH_PX; step += 1) {
      const x = Math.round(center.x + Math.sin(angle) * step);
      const y = Math.round(center.y + Math.cos(angle) * step);
      if (x < 0 || x >= image.width || y < 0 || y >= image.height) continue;
      const offset = (y * image.width + x) * 4;
      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      const nailMatch = NAIL_RGB.every(
        (channel, index) =>
          Math.abs([red, green, blue][index] - channel) <= NAIL_RGB_TOLERANCE,
      ) && red >= green + 30;
      if (nailMatch) {
        classes.push("nail");
        steps.push(step);
        continue;
      }
      let paperMatch = Boolean(background);
      if (background) {
        paperMatch = [red, green, blue].every((channel, index) =>
          Math.abs(channel - background.data[offset + index]) <= 18,
        );
      }
      if (paperMatch) {
        classes.push("paper");
      } else if (background) {
        const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        const paperLuma = 0.2126 * background.data[offset] +
          0.7152 * background.data[offset + 1] +
          0.0722 * background.data[offset + 2];
        const delta = luma - paperLuma;
        classes.push(
          delta <= -DARK_SHADOW_LUMA_DROP
            ? "darkShadow"
            : delta <= -SHADOW_LUMA_MIN_DROP
              ? "lightShadow"
              : "other",
        );
      } else {
        classes.push("other");
      }
      steps.push(step);
    }
    return { label, classes, steps };
  });
}

function RgbClassRayProfiles({
  profiles,
  title,
}: {
  profiles: RgbRayProfile[];
  title: string;
}) {
  const names: Record<ProfileColorClass, string> = {
    nail: "N",
    paper: "P",
    darkShadow: "D",
    lightShadow: "L",
    other: "O",
  };
  const colors: Record<ProfileColorClass, string> = {
    nail: "var(--color-yellow-strong)",
    paper: "var(--color-white)",
    darkShadow: "var(--color-blue)",
    lightShadow: "var(--color-purple)",
    other: "var(--color-danger)",
  };
  return <div className="space-y-2">
    <p className="text-sm font-medium">{title} · RGB classes along each ray</p>
    {profiles.map((profile) => {
      const runs: Array<{ value: ProfileColorClass; count: number }> = [];
      for (const value of profile.classes) {
        const last = runs[runs.length - 1];
        if (last?.value === value) last.count += 1;
        else runs.push({ value, count: 1 });
      }
      return <div key={profile.label} className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-2">
        <span className="text-xs">{profile.label}</span>
        <div className="space-y-1">
          <div className="flex h-4 overflow-hidden rounded border" aria-label={`${profile.label} RGB class samples`}>
            {profile.classes.map((value, index) => <span
              key={`${profile.label}-${index}`}
              title={`${names[value]} · sample ${index + 1}`}
              style={{ backgroundColor: colors[value], flex: "1 0 0" }}
            />)}
          </div>
          <p className="break-words text-xs">{runs.map((run) => `${names[run.value]}${run.count}`).join(" · ") || "no in-bounds samples"}</p>
        </div>
      </div>;
    })}
    <p className="text-xs">N = existing nail-color RGB rule · P = within ±18 RGB per channel of the empty-sheet pixel · O = other. These are diagnostic classes, not contact decisions.</p>
  </div>;
}

interface LumaDifferenceImage {
  width: number;
  height: number;
  pixels: Uint8Array;
  differences: Float32Array;
}

function createLumaDifferenceImage(image: HTMLImageElement, background: HTMLImageElement): LumaDifferenceImage {
  if (image.naturalWidth !== background.naturalWidth ||
    image.naturalHeight !== background.naturalHeight) {
    throw new Error("Case image must match the background dimensions for subtraction");
  }
  const { canvas, context } = canvasFor(image, image.naturalWidth, image.naturalHeight);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const reference = canvasFor(background, background.naturalWidth, background.naturalHeight)
    .context.getImageData(0, 0, canvas.width, canvas.height);
  const mask = context.createImageData(canvas.width, canvas.height);
  const pixels = new Uint8Array(canvas.width * canvas.height);
  const differences = new Float32Array(pixels.length);
  for (let pixel = 0; pixel < pixels.length; pixel += 1) {
    const offset = pixel * 4;
    const currentLuma = 0.2126 * imageData.data[offset] +
      0.7152 * imageData.data[offset + 1] + 0.0722 * imageData.data[offset + 2];
    const backgroundLuma = 0.2126 * reference.data[offset] +
      0.7152 * reference.data[offset + 1] + 0.0722 * reference.data[offset + 2];
    const difference = Math.abs(currentLuma - backgroundLuma);
    differences[pixel] = difference;
    const changed = difference >= BACKGROUND_DIFFERENCE_THRESHOLD;
    pixels[pixel] = changed ? 1 : 0;
    const value = changed ? 255 : 0;
    mask.data[offset] = value;
    mask.data[offset + 1] = value;
    mask.data[offset + 2] = value;
    mask.data[offset + 3] = 255;
  }
  context.putImageData(mask, 0, 0);
  return { width: canvas.width, height: canvas.height, pixels, differences };
}

function refineFingertip(mask: LumaDifferenceImage, point: Point) {
  const row = Math.max(0, Math.min(mask.height - 1, Math.round(point.y)));
  const x = Math.round(point.x);
  let nearestX: number | null = null;
  for (let distance = 0; distance <= HORIZONTAL_SEARCH_PX; distance += 1) {
    const candidates = distance === 0 ? [x] : [x - distance, x + distance];
    nearestX = candidates.find((candidate) => candidate >= 0 && candidate < mask.width &&
      mask.pixels[row * mask.width + candidate] === 1) ?? null;
    if (nearestX !== null) break;
  }
  if (nearestX === null) return {
    point: null,
    leftEdge: null,
    rightEdge: null,
    paperBoundary: null,
    lineProfile: [] as number[],
    edgeStrength: null,
    failureReason: "No changed pixels near the MediaPipe row",
  };

  const leftLimit = Math.max(0, nearestX - MAX_FINGER_HALF_WIDTH_PX);
  const rightLimit = Math.min(mask.width - 1, nearestX + MAX_FINGER_HALF_WIDTH_PX);
  let left = nearestX;
  let right = nearestX;
  while (left > leftLimit && mask.pixels[row * mask.width + left - 1] === 1) left -= 1;
  while (right < rightLimit && mask.pixels[row * mask.width + right + 1] === 1) right += 1;
  const runTooWide =
    (left === leftLimit && mask.pixels[row * mask.width + left] === 1) ||
    (right === rightLimit && mask.pixels[row * mask.width + right] === 1);
  // If subtraction merged the finger with a neighboring shadow, preserve a
  // vertical profile at the MediaPipe x so the ambiguous edge is inspectable.
  const centerX = runTooWide ? nearestX : Math.round((left + right) / 2);
  const maxY = Math.min(mask.height - 1, row + DOWNWARD_SEARCH_PX);
  const lineProfile = Array.from({ length: maxY - row + 1 }, (_, index) => {
    let total = 0;
    let count = 0;
    for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
      const sampleX = centerX + offsetX;
      if (sampleX < 0 || sampleX >= mask.width) continue;
      total += mask.differences[(row + index) * mask.width + sampleX];
      count += 1;
    }
    return count ? total / count : 0;
  });
  const smoothProfile = lineProfile.map((_, index) => {
    const first = Math.max(0, index - 1);
    const last = Math.min(lineProfile.length - 1, index + 1);
    let total = 0;
    for (let sample = first; sample <= last; sample += 1) total += lineProfile[sample];
    return total / (last - first + 1);
  });
  let boundaryIndex: number | null = null;
  let edgeStrength: number | null = null;
  for (let index = 4; index <= smoothProfile.length - 4; index += 1) {
    const before = smoothProfile.slice(index - 4, index).reduce((sum, value) => sum + value, 0) / 4;
    const after = smoothProfile.slice(index, index + 4).reduce((sum, value) => sum + value, 0) / 4;
    const drop = before - after;
    if (before >= BACKGROUND_DIFFERENCE_THRESHOLD && drop >= MIN_BOUNDARY_DROP &&
      (edgeStrength === null || drop > edgeStrength)) {
      boundaryIndex = index;
      edgeStrength = drop;
    }
  }
  const boundaryY = boundaryIndex === null ? null : row + boundaryIndex;
  const failureReason = runTooWide
    ? "Changed-pixel run exceeds the local finger-width limit; showing the scan at the MediaPipe x"
    : boundaryY === null
      ? "No sustained luma-difference drop found on the vertical scan"
    : boundaryY - TIP_INSET_PX < row
      ? "Detected edge is too close to the starting point"
      : null;
  const placedPoint = boundaryY === null || failureReason
    ? null
    : { x: centerX, y: boundaryY - TIP_INSET_PX };
  return {
    point: placedPoint,
    leftEdge: runTooWide ? null : { x: left, y: row },
    rightEdge: runTooWide ? null : { x: right, y: row },
    paperBoundary: boundaryY === null ? null : { x: centerX, y: boundaryY },
    lineProfile,
    edgeStrength,
    failureReason,
  };
}

/**
 * Find the connected RGB region matching the sampled nail color near the
 * MediaPipe fingertip. The candidate is the center of that component.
 */
function refineFingertipByColor(
  image: HTMLImageElement,
  landmarks: HandObservation["landmarks"],
  finger: FingerName,
) {
  const tipIndex = FINGER_LANDMARKS[finger];
  const tipLandmark = landmarks[tipIndex];
  if (!tipLandmark) return null;
  const tip = { x: tipLandmark.x * image.naturalWidth, y: tipLandmark.y * image.naturalHeight };

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { point: null, area: 0, confidence: 0, contour: [], matchedPixels: [], scan: null, failureReason: "Unable to read RGB image" };
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const matchesColorAt = (x: number, y: number) => {
    if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) return false;
    const offset = (y * canvas.width + x) * 4;
    return Math.abs(pixels[offset] - NAIL_RGB[0]) <= NAIL_RGB_TOLERANCE &&
      Math.abs(pixels[offset + 1] - NAIL_RGB[1]) <= NAIL_RGB_TOLERANCE &&
      Math.abs(pixels[offset + 2] - NAIL_RGB[2]) <= NAIL_RGB_TOLERANCE &&
      pixels[offset] >= pixels[offset + 1] + 30;
  };
  const scanY = Math.round(tip.y);
  const scanX = Math.round(tip.x);
  let leftX = scanX;
  while (leftX > 0 && matchesColorAt(leftX - 1, scanY)) leftX -= 1;
  let rightX = scanX;
  while (rightX < canvas.width - 1 && matchesColorAt(rightX + 1, scanY)) rightX += 1;
  const middleX = Math.round((leftX + rightX) / 2);
  let bottomY = scanY;
  while (bottomY < canvas.height - 1 && matchesColorAt(middleX, bottomY + 1)) bottomY += 1;
  const scan = {
    left: { x: leftX, y: scanY },
    right: { x: rightX, y: scanY },
    middle: { x: middleX, y: scanY },
    bottom: { x: middleX, y: bottomY },
  };
  const left = Math.max(0, Math.floor(tip.x - COLOR_SEARCH_RADIUS));
  const top = Math.max(0, Math.floor(tip.y - COLOR_SEARCH_RADIUS));
  const right = Math.min(canvas.width - 1, Math.ceil(tip.x + COLOR_SEARCH_RADIUS));
  const bottom = Math.min(canvas.height - 1, Math.ceil(tip.y + COLOR_SEARCH_RADIUS));
  const width = right - left + 1;
  const height = bottom - top + 1;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (matchesColorAt(left + x, top + y)) mask[y * width + x] = 1;
    }
  }
  const localTipX = Math.round(tip.x) - left;
  const localTipY = Math.round(tip.y) - top;
  let seed = -1;
  let seedDistance = Infinity;
  const seedRadiusSquared = COLOR_SEARCH_RADIUS ** 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const distance = (x - localTipX) ** 2 + (y - localTipY) ** 2;
      if (mask[index] && distance <= seedRadiusSquared && distance < seedDistance) {
        seed = index;
        seedDistance = distance;
      }
    }
  }
  if (seed < 0) return { point: null, area: 0, confidence: 0, contour: [], matchedPixels: [], scan, failureReason: "No matching nail-color region near MediaPipe point" };

  const component = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = seed;
  component[seed] = 1;
  const pixelsInComponent: Point[] = [];
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    pixelsInComponent.push({ x: left + x, y: top + y });
    const neighbors = [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y > 0 ? index - width : -1, y + 1 < height ? index + width : -1];
    for (const neighbor of neighbors) {
      if (neighbor >= 0 && mask[neighbor] && !component[neighbor]) {
        component[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
  }
  const area = pixelsInComponent.length;
  const candidate = area
    ? {
        x: pixelsInComponent.reduce((sum, point) => sum + point.x, 0) / area,
        y: pixelsInComponent.reduce((sum, point) => sum + point.y, 0) / area,
      }
    : null;
  const confidence = Math.max(0, Math.min(1, area / 120));
  const contour = pixelsInComponent.filter((point) => {
    const x = Math.round(point.x) - left;
    const y = Math.round(point.y) - top;
    return x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
      !component[y * width + x - 1] || !component[y * width + x + 1] ||
      !component[(y - 1) * width + x] || !component[(y + 1) * width + x];
  });
  return {
    point: candidate,
    area,
    confidence,
    contour,
    matchedPixels: pixelsInComponent,
    scan,
    failureReason: area < 20 ? "Nail-color component is too small" : null,
  };
}

function createDifferencePreview(
  differenceImage: LumaDifferenceImage,
  point: Point,
  refinement: ReturnType<typeof refineFingertip>,
  colorRefinement: ReturnType<typeof refineFingertipByColor>,
  rgbProfiles: RgbRayProfile[],
  yellowPoint: Point | null,
  yellowRgbProfiles: RgbRayProfile[] | null,
) {
  const sourceSize = SHADOW_CROP_RADIUS * 2;
  const previewScale = 2;
  const left = Math.round(point.x) - SHADOW_CROP_RADIUS;
  const top = Math.round(point.y) - SHADOW_CROP_RADIUS;
  const canvas = document.createElement("canvas");
  canvas.width = sourceSize * previewScale;
  canvas.height = sourceSize * previewScale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create fingertip mask preview");
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = sourceSize;
  sourceCanvas.height = sourceSize;
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) throw new Error("Unable to create subtraction crop");
  const data = sourceContext.createImageData(sourceSize, sourceSize);
  for (let y = 0; y < sourceSize; y += 1) {
    for (let x = 0; x < sourceSize; x += 1) {
      const imageX = left + x;
      const imageY = top + y;
      const difference = imageX >= 0 && imageX < differenceImage.width &&
        imageY >= 0 && imageY < differenceImage.height
        ? differenceImage.differences[imageY * differenceImage.width + imageX]
        : 0;
      // Show the raw absolute luma difference without display amplification.
      const value = difference;
      const offset = (y * sourceSize + x) * 4;
      data.data[offset] = value;
      data.data[offset + 1] = value;
      data.data[offset + 2] = value;
      data.data[offset + 3] = 255;
    }
  }
  sourceContext.putImageData(data, 0, 0);
  context.imageSmoothingEnabled = false;
  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  const rootStyle = getComputedStyle(document.documentElement);
  const red = rootStyle.getPropertyValue("--color-danger").trim();
  const green = rootStyle.getPropertyValue("--color-success-strong").trim();
  const yellow = rootStyle.getPropertyValue("--color-yellow-strong").trim();
  const blue = rootStyle.getPropertyValue("--color-blue").trim();
  const local = (candidate: Point) => ({
    x: (candidate.x - left) * previewScale,
    y: (candidate.y - top) * previewScale,
  });
  const drawDot = (candidate: Point, color: string, radius: number) => {
    const location = local(candidate);
    context.beginPath();
    context.arc(location.x, location.y, radius, 0, 2 * Math.PI);
    context.fillStyle = color;
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = "white";
    context.stroke();
  };
  const drawLine = (start: Point, end: Point, color: string) => {
    const from = local(start);
    const to = local(end);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.lineWidth = 2;
    context.strokeStyle = color;
    context.stroke();
  };
  drawDot(point, red, 6);
  if (refinement?.leftEdge && refinement.rightEdge) {
    drawLine(refinement.leftEdge, refinement.rightEdge, yellow);
  }
  if (refinement?.paperBoundary) {
    drawLine(
      { x: refinement.paperBoundary.x, y: point.y },
      refinement.paperBoundary,
      blue,
    );
    drawDot(refinement.paperBoundary, blue, 4);
  }
  if (refinement?.point) drawDot(refinement.point, green, 7);
  if (colorRefinement?.scan) {
    const origin = {
      x: colorRefinement.scan.middle.x,
      y: colorRefinement.scan.bottom.y - VERTICAL_SCAN_DOT_OFFSET_PX,
    };
    drawDot(origin, yellow, 6);
  }
  const classColors: Record<ProfileColorClass, string> = {
    nail: rootStyle.getPropertyValue("--color-yellow-strong").trim(),
    paper: rootStyle.getPropertyValue("--color-white").trim(),
    darkShadow: rootStyle.getPropertyValue("--color-blue").trim(),
    lightShadow: rootStyle.getPropertyValue("--color-purple").trim(),
    other: rootStyle.getPropertyValue("--color-danger").trim(),
  };
  const drawClassRays = (
    origin: Point,
    profiles: RgbRayProfile[],
    originColor: string,
    originLabel: string,
  ) => {
    const angleFor = {
      center: 0,
      "left 20°": -SHADOW_RAY_SIDE_ANGLE,
      "right 20°": SHADOW_RAY_SIDE_ANGLE,
    } as const;
    for (const ray of profiles) {
      const angle = angleFor[ray.label];
      for (let index = 1; index < ray.classes.length; index += 1) {
        const from = local({
          x: origin.x + Math.sin(angle) * ray.steps[index - 1],
          y: origin.y + Math.cos(angle) * ray.steps[index - 1],
        });
        const to = local({
          x: origin.x + Math.sin(angle) * ray.steps[index],
          y: origin.y + Math.cos(angle) * ray.steps[index],
        });
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.lineWidth = 6;
        context.strokeStyle = rootStyle.getPropertyValue("--color-ink").trim();
        context.stroke();
        context.lineWidth = 4;
        context.strokeStyle = classColors[ray.classes[index]];
        context.stroke();
      }
    }
    drawDot(origin, originColor, 7);
    const location = local(origin);
    context.font = "bold 14px sans-serif";
    context.lineWidth = 4;
    context.strokeStyle = rootStyle.getPropertyValue("--color-ink").trim();
    context.strokeText(originLabel, location.x + 7, location.y - 7);
    context.fillStyle = rootStyle.getPropertyValue("--color-white").trim();
    context.fillText(originLabel, location.x + 7, location.y - 7);
  };
  drawClassRays(point, rgbProfiles, red, "M");
  if (yellowPoint && yellowRgbProfiles) {
    drawClassRays(yellowPoint, yellowRgbProfiles, yellow, "Y");
  }
  return canvas.toDataURL();
}

function createSourcePreview(
  image: HTMLImageElement,
  imagePixels: ImageData,
  backgroundPixels: ImageData | null,
  point: Point,
  refinement: ReturnType<typeof refineFingertip>,
  colorRefinement: ReturnType<typeof refineFingertipByColor>,
  filter: Readonly<DarkShadowFilter>,
) {
  const cropWidth = 640;
  const cropHeight = 480;
  const left = Math.max(0, Math.min(image.naturalWidth - cropWidth, Math.round(point.x - cropWidth / 2)));
  const top = Math.max(0, Math.min(image.naturalHeight - cropHeight, Math.round(point.y - cropHeight / 3)));
  const width = Math.min(cropWidth, image.naturalWidth - left);
  const height = Math.min(cropHeight, image.naturalHeight - top);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create original image crop");
  context.drawImage(image, left, top, width, height, 0, 0, width, height);
  const rootStyle = getComputedStyle(document.documentElement);
  const local = (candidate: Point) => ({ x: candidate.x - left, y: candidate.y - top });
  context.save();
  context.fillStyle = rootStyle.getPropertyValue("--color-blue").trim();
  context.globalAlpha = 0.5;
  for (const [x, y, length] of darkShadowRuns(analyzeDarkShadowRegion(imagePixels, backgroundPixels, point, filter))) {
    context.fillRect(x - left, y - top, length, 1);
  }
  context.restore();
  const shadowEllipse = drawLinesToShadow(
    context,
    imagePixels,
    backgroundPixels,
    point,
    local,
    rootStyle.getPropertyValue("--color-blue").trim(),
    rootStyle.getPropertyValue("--color-ink-muted").trim(),
    filter,
  );
  const drawDot = (candidate: Point, color: string, radius: number) => {
    const location = local(candidate);
    context.beginPath();
    context.arc(location.x, location.y, radius, 0, 2 * Math.PI);
    context.fillStyle = color;
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = "white";
    context.stroke();
  };
  drawDot(point, rootStyle.getPropertyValue("--color-danger").trim(), 6);
  if (colorRefinement?.scan) {
    const purple = rootStyle.getPropertyValue("--color-purple").trim();
    const drawScan = (start: Point, end: Point) => {
      const from = local(start);
      const to = local(end);
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.strokeStyle = purple;
      context.lineWidth = 3;
      context.stroke();
    };
    drawScan(colorRefinement.scan.left, colorRefinement.scan.right);
    drawScan(colorRefinement.scan.middle, colorRefinement.scan.bottom);
    drawDot({
      x: colorRefinement.scan.middle.x,
      y: colorRefinement.scan.bottom.y - VERTICAL_SCAN_DOT_OFFSET_PX,
    }, rootStyle.getPropertyValue("--color-yellow-strong").trim(), 6);
  }
  if (refinement?.point) {
    drawDot(refinement.point, rootStyle.getPropertyValue("--color-success-strong").trim(), 7);
  }
  if (colorRefinement?.point) drawDot(colorRefinement.point, rootStyle.getPropertyValue("--color-blue").trim(), 7);
  return {
    dataUrl: canvas.toDataURL(),
    shadowEllipse,
  };
}

function drawLinesToShadow(
  context: CanvasRenderingContext2D,
  image: ImageData,
  background: ImageData | null,
  tip: Point,
  toLocal: (point: Point) => Point,
  shadowColor: string,
  guideColor: string,
  filter: Readonly<DarkShadowFilter>,
): DarkShadowSize | null {
  const shadowSize = findDarkShadowSize(image, background, tip, { x: 0, y: 0 }, filter);
  context.save();
  context.lineWidth = 1;
  context.setLineDash([3, 3]);
  context.strokeStyle = guideColor;
  for (const degrees of SHADOW_PROBE_ANGLES_DEGREES) {
    const radians = (degrees * Math.PI) / 180;
    const end = {
      x: tip.x + Math.sin(radians) * SHADOW_RAY_LENGTH_PX,
      y: tip.y + Math.cos(radians) * SHADOW_PROBE_LENGTH_PX,
    };
    const startLocal = toLocal(tip);
    const endLocal = toLocal(end);
    context.beginPath();
    context.moveTo(startLocal.x, startLocal.y);
    context.lineTo(endLocal.x, endLocal.y);
    context.stroke();

    const run = shadowSize?.runs.find((item) => item.angleDegrees === degrees)?.points ?? [];
    if (run.length) {
      context.setLineDash([]);
      context.strokeStyle = shadowColor;
      context.lineWidth = 4;
      context.lineCap = "round";
      context.beginPath();
      const first = toLocal(run[0]);
      context.moveTo(first.x, first.y);
      for (const sample of run.slice(1)) {
        const location = toLocal(sample);
        context.lineTo(location.x, location.y);
      }
      context.stroke();
      context.setLineDash([3, 3]);
      context.lineWidth = 1;
      context.strokeStyle = guideColor;
    }
  }

  const ellipse = shadowSize;
  if (ellipse) {
    const center = toLocal(ellipse.center);
    context.setLineDash([]);
    context.strokeStyle = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-purple").trim();
    context.lineWidth = 2;
    context.beginPath();
    context.ellipse(
      center.x,
      center.y,
      ellipse.majorRadius,
      ellipse.minorRadius,
      ellipse.rotation,
      0,
      Math.PI * 2,
    );
    context.stroke();

    const label = `${Math.round(ellipse.majorRadius * 2)} × ${Math.round(ellipse.minorRadius * 2)} px`;
    context.font = "12px sans-serif";
    context.lineWidth = 3;
    context.strokeStyle = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-ink").trim();
    context.strokeText(label, center.x + 4, center.y - 4);
    context.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-purple").trim();
    context.fillText(label, center.x + 4, center.y - 4);
  }
  context.restore();
  return ellipse;
}

function BoundaryProfile({
  values,
  boundaryIndex,
}: {
  values: number[];
  boundaryIndex: number | null;
}) {
  if (!values.length) return null;
  const maxValue = Math.max(24, ...values);
  const xAt = (index: number) => 8 + index * (304 / Math.max(1, values.length - 1));
  const yAt = (value: number) => 76 - value * (64 / maxValue);
  const points = values.map((value, index) => `${xAt(index)},${yAt(value)}`).join(" ");
  return <div className="space-y-1">
    <p className="text-sm">Absolute luma difference along the vertical scan · boundary {boundaryIndex === null ? "not found" : `${boundaryIndex} px below MediaPipe`}</p>
    <svg className="h-24 w-full max-w-sm rounded border" viewBox="0 0 320 88" role="img" aria-label="Background subtraction profile along fingertip scan line">
      <line x1="8" y1="76" x2="312" y2="76" stroke="currentColor" opacity="0.25" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
      {boundaryIndex !== null && <line x1={xAt(boundaryIndex)} y1="8" x2={xAt(boundaryIndex)} y2="76" stroke="var(--color-danger)" strokeWidth="2" />}
    </svg>
  </div>;
}

function RayProfile({ ray }: { ray: SynchronousShadowMeasurement["rays"][number] }) {
  const dipRiseCandidate = ray.dipDepth !== null &&
    ray.dipDepth >= 8 && ray.dipDepth <= 50 &&
    ray.steepestRise !== null && ray.steepestRise >= 20 &&
    ray.reboundWidth !== null && ray.reboundWidth <= 6;
  const xAt = (index: number) =>
    10 + index * (340 / Math.max(1, ray.smoothedValues.length - 1));
  const yAt = (index: number) => 82 - (ray.smoothedValues[index] ?? 0) * 0.28;
  const points = ray.smoothedValues.map((value, index) =>
    `${xAt(index)},${82 - value * 0.28}`,
  ).join(" ");
  const marker = (index: number | null, color: string) => index === null ? null : (
    <circle cx={xAt(index)} cy={yAt(index)} r="4" fill={color} />
  );
  const pairColor = dipRiseCandidate
    ? "var(--color-success-strong)"
    : "var(--color-ink-muted)";
  return <div className="space-y-1">
    <p className="text-sm">
      {ray.label} · {dipRiseCandidate ? "SHORT DIP + RISE" : "no short pair"}
      {" · dip "}{ray.dipDepth?.toFixed(1) ?? "—"}
      {" · rise "}{ray.steepestRise?.toFixed(1) ?? "—"}/px
      {" · rebound "}{ray.reboundWidth ?? "—"} px
    </p>
    <svg className="h-24 w-full max-w-xl rounded border" viewBox="0 0 360 96" role="img" aria-label={`${ray.label} luma profile`}>
      <line x1="10" y1="82" x2="350" y2="82" stroke="currentColor" opacity="0.25" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
      {ray.minimumIndex !== null && ray.reboundIndex !== null && <line
        x1={xAt(ray.minimumIndex)} y1={yAt(ray.minimumIndex)}
        x2={xAt(ray.reboundIndex)} y2={yAt(ray.reboundIndex)}
        stroke={pairColor} strokeWidth="3" strokeDasharray="4 3"
      />}
      {marker(ray.minimumIndex, "var(--color-danger)")}
      {marker(ray.reboundIndex, "var(--color-yellow-strong)")}
    </svg>
    <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
      Red: dip · yellow: rebound · green connector: provisional pair.
      A pair needs an 8–50 luma dip, rise ≥20 luma/px, and rebound within 6 px.
    </p>
  </div>;
}

function RaySetSummary({
  label,
  measurement,
}: {
  label: string;
  measurement: SynchronousShadowMeasurement;
}) {
  const hits = measurement.rays.filter((ray) =>
    ray.dipDepth !== null && ray.dipDepth >= 8 && ray.dipDepth <= 50 &&
    ray.steepestRise !== null && ray.steepestRise >= 20 &&
    ray.reboundWidth !== null && ray.reboundWidth <= 6,
  ).length;
  const candidate = hits > 0;
  return <p className="text-sm font-medium">
    {label} three-ray OR: {hits}/3 qualify · {candidate ? "CANDIDATE" : "no candidate"}
    {" (recall-first exploration; candidate if any ray qualifies)"}
  </p>;
}

function makeMeasurement(
  image: HTMLImageElement,
  background: HTMLImageElement,
  point: Point,
) {
  const tipX = Math.round(point.x);
  const tipY = Math.round(point.y);
  const left = Math.max(0, tipX - SYNCHRONOUS_SHADOW_CROP.halfWidth);
  const top = Math.max(0, tipY - SYNCHRONOUS_SHADOW_CROP.aboveTip);
  const right = Math.min(
    image.naturalWidth,
    tipX + SYNCHRONOUS_SHADOW_CROP.halfWidth,
  );
  const bottom = Math.min(
    image.naturalHeight,
    tipY + SYNCHRONOUS_SHADOW_CROP.belowTip,
  );
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (!width || !height) throw new Error("Fingertip is outside the image");

  const crop = document.createElement("canvas");
  crop.width = width;
  crop.height = height;
  const cropContext = crop.getContext("2d", { willReadFrequently: true });
  if (!cropContext) throw new Error("Unable to create fingertip crop");
  cropContext.drawImage(image, left, top, width, height, 0, 0, width, height);

  let backgroundData: ImageData | null = null;
  if (background.naturalWidth === image.naturalWidth &&
    background.naturalHeight === image.naturalHeight) {
    const reference = canvasFor(background, background.naturalWidth, background.naturalHeight);
    backgroundData = reference.context.getImageData(left, top, width, height);
  }

  return analyzeSynchronousShadow(
    cropContext.getImageData(0, 0, width, height),
    { x: point.x - left, y: point.y - top },
    backgroundData,
  );
}

export default function CvImageTestPage() {
  const [filter, setFilter] = useState<Readonly<DarkShadowFilter>>(DEFAULT_DARK_SHADOW_FILTER);
  const [status, setStatus] = useState("Choose background.png and labeled case images.");
  const [results, setResults] = useState<ImageCaseResult[]>([]);
  const [setup, setSetup] = useState<Record<string, unknown> | null>(null);
  const [running, setRunning] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [sourceCropPreviews, setSourceCropPreviews] = useState<Record<string, string>>({});
  const [differencePreviews, setDifferencePreviews] = useState<Record<string, string>>({});
  const previewUrls = useRef<string[]>([]);

  useEffect(() => () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
  }, []);

  async function runAnalysis() {
    const backgroundFile = (document.querySelector("#background") as HTMLInputElement).files?.[0];
    const selectedCaseFiles = [...((document.querySelector("#cases") as HTMLInputElement).files ?? [])];
    if (!backgroundFile) throw new Error("Select the empty-sheet background frame");
    if (!selectedCaseFiles.length) throw new Error("Select at least one labeled PNG case");
    const caseFiles = selectedCaseFiles.filter((file) => file.name !== backgroundFile.name);
    if (!caseFiles.length) throw new Error("Select at least one labeled case image separate from the background reference");

    setRunning(true);
    setResults([]);
    setSetup(null);
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    previewUrls.current = [];
    setPreviews({});
    setSourceCropPreviews({});
    setDifferencePreviews({});
    setStatus("Loading image, marker, and hand detectors...");
    let handLandmarker: HandLandmarker | null = null;
    let markerDetector: MarkerDetector | null = null;
    try {
      const backgroundImage = await loadImage(backgroundFile);
      const backgroundFrame = canvasFor(
        backgroundImage,
        backgroundImage.naturalWidth,
        backgroundImage.naturalHeight,
      );
      const backgroundRgb = backgroundFrame.context.getImageData(
        0,
        0,
        backgroundImage.naturalWidth,
        backgroundImage.naturalHeight,
      );
      markerDetector = await MarkerDetector.create();
      const markerResult = markerDetector.detect(backgroundFrame.canvas);
      const markerCenters = [0, 1, 2, 3].map((id) =>
        markerResult.observations.find((observation) => observation.id === id)?.center,
      );
      const homography = markerCenters.every((center) => center !== undefined)
        ? computeHomography(PAGE_CORNERS, markerCenters as Point[])
        : null;
      const whiteKeys = homography
        ? getWhiteKeyPolygons(DEFAULT_LAYOUT).map((key) =>
            key.map((point) => projectPoint(homography, point)),
          ) as Point[][]
        : null;
      const geometryUsable = Boolean(
        whiteKeys?.every((key) => key.every((point) => point !== null)),
      );
      const finalKeys = geometryUsable ? whiteKeys : null;
      const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_PATH },
        runningMode: "IMAGE",
        numHands: 2,
      });

      setSetup({
        darkPixelFilter: { ...filter },
        backgroundFile: backgroundFile.name,
        excludedBackgroundFromCases: selectedCaseFiles.length !== caseFiles.length,
        dimensions: `${backgroundImage.naturalWidth}x${backgroundImage.naturalHeight}`,
        detectedMarkerIds: markerResult.observations.map((item) => item.id),
        missingMarkerIds: markerResult.missingIds,
        homographyValid: Boolean(homography),
        backgroundReady: Boolean(homography && geometryUsable),
        keyboardLayout: DEFAULT_LAYOUT,
          fingertipRefinement: `The subtraction candidate uses absolute luma difference against the empty-sheet reference. The nail-color candidate searches near the MediaPipe point for RGB pixels within ±${NAIL_RGB_TOLERANCE} independently in each channel of (${NAIL_RGB.join(", ")}), with red at least 30 above green. It selects the nearest connected component, outlines it, and marks its pixel centroid. The displayed confidence is a heuristic based on component area, not a calibrated probability. Both refinements are diagnostic only and do not trigger notes.`,
        note: "RGB ray strips are diagnostic only; note candidates still use the luma profile.",
      });

      const nextResults: ImageCaseResult[] = [];
      const previousShadowSamples = new Map<string, {
        frame: number;
        y: number;
        shadowAreaPx: number | null;
        evidence: ShadowEvidence | null;
      }>();
      for (const file of caseFiles.sort((a, b) =>
        (imageFrameNumber(a.name) ?? Number.MAX_SAFE_INTEGER) -
          (imageFrameNumber(b.name) ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name),
      )) {
        const currentFrame = imageFrameNumber(file.name);
        setStatus(`Analyzing ${file.name} (${nextResults.length + 1}/${caseFiles.length})...`);
        const parsed = parseLabel(file.name);
        const result: ImageCaseResult = {
          fileName: file.name,
          label: parsed.label,
          dimensions: null,
          backgroundDimensionsMatch: null,
          detectedFingertips: [],
          targets: [],
        };
        if (!parsed.targets.length) {
          result.error = "Expected filename like press_right-ring_frame_000184_6133ms.png";
          nextResults.push(result);
          continue;
        }
        try {
          const image = await loadImage(file);
          const differenceImage = createLumaDifferenceImage(image, backgroundImage);
          const imageRgb = canvasFor(
            image,
            image.naturalWidth,
            image.naturalHeight,
          ).context.getImageData(0, 0, image.naturalWidth, image.naturalHeight);
          const matchingBackground =
            image.naturalWidth === backgroundRgb.width &&
            image.naturalHeight === backgroundRgb.height
              ? backgroundRgb
              : null;
          result.dimensions = `${image.naturalWidth}x${image.naturalHeight}`;
          result.backgroundDimensionsMatch =
            image.naturalWidth === backgroundImage.naturalWidth &&
            image.naturalHeight === backgroundImage.naturalHeight;
          const prediction = handLandmarker.detect(image);
          const handObservations: HandObservation[] = prediction.landmarks.map((landmarks, index) => ({
            landmarks,
            handedness: prediction.handedness[index]?.[0]?.categoryName === "Left"
              ? "Left"
              : prediction.handedness[index]?.[0]?.categoryName === "Right"
                ? "Right"
                : "Unknown",
          }));
          const previewUrl = URL.createObjectURL(file);
          previewUrls.current.push(previewUrl);
          setPreviews((previous) => ({ ...previous, [file.name]: previewUrl }));
          result.detectedFingertips = handObservations.flatMap((hand) =>
            (Object.entries(FINGER_LANDMARKS) as Array<[FingerName, number]>).flatMap(([finger, landmarkIndex]) => {
              const point = hand.landmarks[landmarkIndex];
              return point ? [{
                hand: hand.handedness,
                finger,
                point: { x: point.x * image.naturalWidth, y: point.y * image.naturalHeight },
              }] : [];
            }),
          );
          for (const [targetIndex, target] of parsed.targets.entries()) {
            const expectedHand = target.hand === "right" ? "Right" : "Left";
            let handIndex = handObservations.findIndex((hand) => hand.handedness === expectedHand);
            let handednessMatched = handIndex >= 0;
            if (handIndex < 0 && handObservations.length === 1) {
              handIndex = 0;
              handednessMatched = false;
            }
            if (handIndex < 0) {
              result.targets.push({
                requestedHand: target.hand,
                finger: target.finger,
                detectedHand: null,
                handednessMatched: null,
                landmark: null,
                yellowPoint: null,
                keyIndexes: [],
                measurement: null,
                yellowMeasurement: null,
                refinedPoint: null,
                colorPoint: null,
                rgbProfiles: [],
                yellowRgbProfiles: null,
                colorRefinement: null,
                refinement: null,
                refinedMeasurement: null,
                darkShadowArea: null,
                darkShadowMeanDrop: null,
                shadowEllipse: null,
                comparisonFrameGap: null,
                yDecreased: null,
                shadowTransition: "unavailable",
                pressCandidate: null,
                error: `No ${expectedHand} hand found (${handObservations.map((hand) => hand.handedness).join(", ") || "no hands detected"})`,
              });
              continue;
            }
            const hand = handObservations[handIndex];
            const landmark = hand.landmarks[FINGER_LANDMARKS[target.finger]];
            if (!landmark) {
              result.targets.push({
                requestedHand: target.hand,
                finger: target.finger,
                detectedHand: hand.handedness,
                handednessMatched,
                landmark: null,
                yellowPoint: null,
                keyIndexes: [],
                measurement: null,
                yellowMeasurement: null,
                refinedPoint: null,
                colorPoint: null,
                rgbProfiles: [],
                yellowRgbProfiles: null,
                colorRefinement: null,
                refinement: null,
                refinedMeasurement: null,
                darkShadowArea: null,
                darkShadowMeanDrop: null,
                shadowEllipse: null,
                comparisonFrameGap: null,
                yDecreased: null,
                shadowTransition: "unavailable",
                pressCandidate: null,
                error: "MediaPipe did not return the target fingertip landmark",
              });
              continue;
            }
            const point = {
              x: landmark.x * image.naturalWidth,
              y: landmark.y * image.naturalHeight,
            };
            const fingertip: Fingertip = {
              id: `${handIndex}-${FINGER_LANDMARKS[target.finger]}`,
              handIndex,
              landmarkIndex: FINGER_LANDMARKS[target.finger],
              point,
            };
            const refinement = refineFingertip(differenceImage, point);
            const colorRefinement = refineFingertipByColor(image, hand.landmarks, target.finger);
            const yellowPoint = colorRefinement?.scan ? {
              x: colorRefinement.scan.middle.x,
              y: colorRefinement.scan.bottom.y - VERTICAL_SCAN_DOT_OFFSET_PX,
            } : null;
            const yellowMeasurement = yellowPoint
              ? makeMeasurement(image, backgroundImage, yellowPoint)
              : null;
            const rgbProfiles = makeRgbRayProfiles(
              imageRgb,
              matchingBackground,
              point,
            );
            const darkShadowRegion = analyzeDarkShadowRegion(
              imageRgb,
              matchingBackground,
              point,
              filter,
            );
            const evidence = measureShadowEvidence(imageRgb, matchingBackground, point, filter);
            const yellowRgbProfiles = yellowPoint
              ? makeRgbRayProfiles(imageRgb, matchingBackground, yellowPoint)
              : null;
            const differencePreviewKey = `${file.name}:${targetIndex}`;
            const sourcePreview = createSourcePreview(
              image,
              imageRgb,
              matchingBackground,
              point,
              refinement,
              colorRefinement,
              filter,
            );
            setSourceCropPreviews((previous) => ({
              ...previous,
              [differencePreviewKey]: sourcePreview.dataUrl,
            }));
            const targetKey = `${target.hand}-${target.finger}`;
            const previousShadow = previousShadowSamples.get(targetKey);
            const frameGap = previousShadow && currentFrame !== null
              ? currentFrame - previousShadow.frame
              : null;
            const comparison = previousShadow && frameGap !== null &&
              isComparableFrameGap(previousShadow.frame, currentFrame!)
              ? compareShadowPress(
                previousShadow.y,
                point.y,
                previousShadow.shadowAreaPx,
                sourcePreview.shadowEllipse?.areaPx ?? null,
              )
              : null;
            const evidenceChange = comparison && evidence && previousShadow?.evidence
              ? compareShadowEvidence(previousShadow.evidence, evidence) : null;
            if (currentFrame !== null) {
              previousShadowSamples.set(targetKey, {
                frame: currentFrame,
                evidence,
                y: point.y,
                shadowAreaPx: sourcePreview.shadowEllipse?.areaPx ?? null,
              });
            }
            setDifferencePreviews((previous) => ({
              ...previous,
              [differencePreviewKey]: createDifferencePreview(
                differenceImage,
                point,
                refinement,
                colorRefinement,
                rgbProfiles,
                yellowPoint,
                yellowRgbProfiles,
              ),
            }));
            result.targets.push({
              requestedHand: target.hand,
              finger: target.finger,
              detectedHand: hand.handedness,
              handednessMatched,
              landmark: point,
              yellowPoint,
              keyIndexes: checkKeyOverlap(fingertip, finalKeys),
              measurement: makeMeasurement(image, backgroundImage, point),
              yellowMeasurement,
              refinedPoint: refinement?.point ?? null,
              colorPoint: colorRefinement?.point ?? null,
              rgbProfiles,
              yellowRgbProfiles,
              colorRefinement: colorRefinement ? {
                area: colorRefinement.area,
                confidence: colorRefinement.confidence,
                contour: colorRefinement.contour,
                scan: colorRefinement.scan,
                failureReason: colorRefinement.failureReason,
              } : null,
              refinement: refinement ? {
                leftEdge: refinement.leftEdge,
                rightEdge: refinement.rightEdge,
                paperBoundary: refinement.paperBoundary,
                lineProfile: refinement.lineProfile,
                edgeStrength: refinement.edgeStrength,
                failureReason: refinement.failureReason,
              } : null,
              refinedMeasurement: refinement?.point
                ? makeMeasurement(image, backgroundImage, refinement.point)
                : null,
              shadowEvidence: evidence,
              shadowEvidenceChange: evidenceChange,
              darkShadowArea: darkShadowRegion?.area ?? null,
              darkShadowMeanDrop: darkShadowRegion?.meanLumaDrop ?? null,
              shadowEllipse: sourcePreview.shadowEllipse ? {
                areaPx: sourcePreview.shadowEllipse.areaPx,
                majorDiameterPx: sourcePreview.shadowEllipse.majorRadius * 2,
                minorDiameterPx: sourcePreview.shadowEllipse.minorRadius * 2,
              } : null,
              comparisonFrameGap: comparison ? frameGap : null,
              yDecreased: comparison?.yDecreased ?? null,
              shadowTransition: comparison?.shadowTransition ?? "unavailable",
              pressCandidate: comparison && comparison.shadowTransition !== "unavailable"
                ? comparison.pressCandidate
                : null,
            });
          }
        } catch (error) {
          result.error = error instanceof Error ? error.message : String(error);
        }
        nextResults.push(result);
        setResults([...nextResults]);
      }
      setStatus(`Analysis complete: ${nextResults.length} images.`);
    } finally {
      handLandmarker?.close();
      markerDetector?.dispose();
      setRunning(false);
    }
  }

  const report = setup ? { setup, images: results } : null;
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Synchronous shadow image test</h1>
      <p><Link href="/cv-shadow-test">Open shadow heatmap · images and video, without finger tracking</Link></p>
      <p>Use an empty-sheet frame with all four markers as the background. The labeled case images must share its camera position and resolution.</p>
      <label className="block space-y-1">
        <span>Background frame (save it as background.png)</span>
        <input id="background" type="file" accept="image/*" />
      </label>
      <label className="block space-y-1">
        <span>Labeled cases (for example, hover_right-ring_frame_....png)</span>
        <input id="cases" type="file" accept="image/*" multiple />
      </label>
      <ShadowFilterControls value={filter} onChange={setFilter} disabled={running} />
      <button className="rounded border px-4 py-2" disabled={running} onClick={() => void runAnalysis().catch((error) => setStatus(error instanceof Error ? error.message : String(error)))}>
        {running ? "Analyzing..." : "Run image analysis"}
      </button>
      <p role="status">{status}</p>
      {setup && <section className="space-y-2 rounded border p-4">
        <h2 className="text-lg font-medium">Background and marker setup</h2>
        <p><strong>Subtraction reference:</strong> {String(setup.backgroundFile)}. Each hand case is compared against this empty-sheet image.</p>
        {setup.excludedBackgroundFromCases === true && <p>The background file was also selected as a case, so it was excluded from case analysis.</p>}
        <pre className="overflow-auto text-sm">{JSON.stringify(setup, null, 2)}</pre>
      </section>}
      {results.length > 0 && <section className="space-y-3">
        <h2 className="text-lg font-medium">Per-image results</h2>
        {results.map((result) => <article className="space-y-2 rounded border p-4" key={result.fileName}>
          <h3 className="font-medium"><span>Label {result.label.toUpperCase()}</span><VerdictBadge verdict={imageVerdict(result)} /> · {result.fileName} · {result.dimensions ?? "dimensions unavailable"} · subtraction reference {setup ? String(setup.backgroundFile) : "unavailable"} · {result.backgroundDimensionsMatch === null ? "background size unknown" : result.backgroundDimensionsMatch ? "background size matches" : "background size does not match"}</h3>
          {result.error && <p>{result.error}</p>}
          <p className="text-sm">Approach/release labels are descriptive still-image groups and are not scored as press/hover. In the original RGB crop, gray dotted probes fan 45 pixels below the fingertip at 0°, ±18° and ±35°. Each probe traces its first contiguous dark run in blue, stopping at the first non-dark pixel after the run. The dark-pixel rule uses the four limits recorded in the setup panel for this run. A purple oval fits the probe samples when at least two lines find dark runs; its displayed dimensions are approximate. The nail-color contour is hidden. The broad-region pixel count remains a separate reference measurement. Sequential files are sorted by frame number and compared only for the same hand/finger within {MAX_COMPARISON_FRAME_GAP} frames. A decrease in fingertip Y plus an oval area transition from at least {LARGE_SHADOW_AREA_PX} px² to at most {SMALL_SHADOW_AREA_PX} px² is labeled an experimental press candidate. This is diagnostic only and does not affect contact decisions.</p>
          {previews[result.fileName] && result.dimensions && <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(180px,1fr)]">
            <div className="relative w-full max-w-xl">
            <img className="block h-auto w-full" src={previews[result.fileName]} alt={`${result.fileName} with MediaPipe and refined fingertip points`} />
            {result.detectedFingertips.map((tip, index) => {
              const [width, height] = result.dimensions!.split("x").map(Number);
              return <span key={`${tip.hand}-${tip.finger}-${index}`} title={`${tip.hand} ${tip.finger}: ${tip.point.x.toFixed(1)}, ${tip.point.y.toFixed(1)}`} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white px-1 text-xs font-bold text-white" style={{ left: `${100 * tip.point.x / width}%`, top: `${100 * tip.point.y / height}%`, backgroundColor: tip.hand === "Right" ? "var(--color-danger)" : "var(--color-blue)" }}>{tip.finger[0]}</span>;
            })}
            {result.targets.map((target, index) => {
              if (!target.landmark) return null;
              const [width, height] = result.dimensions!.split("x").map(Number);
              const pointStyle = (point: Point) => ({ left: `${100 * point.x / width}%`, top: `${100 * point.y / height}%` });
              return <span key={`refinement-${target.finger}-${index}`}>
                <span title="MediaPipe point" className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white" style={{ ...pointStyle(target.landmark!), backgroundColor: "var(--color-danger)" }} />
                {target.refinedPoint && <span title="Subtraction point" className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white" style={{ ...pointStyle(target.refinedPoint), backgroundColor: "var(--color-success-strong)" }} />}
                {target.colorPoint && <span title={`Nail-color component center; heuristic confidence ${target.colorRefinement?.confidence.toFixed(2)}`} className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white" style={{ ...pointStyle(target.colorPoint), backgroundColor: "var(--color-blue)" }} />}
              </span>;
            })}
            </div>
          </div>}
          {result.targets.map((target, index) => <div className="overflow-auto" key={`${target.finger}-${index}`}>
            <p>Shadow evidence (diagnostic): near 2–10 px: {target.shadowEvidence?.near ? `${target.shadowEvidence.near.darkPixels} dark px, darkness ${target.shadowEvidence.near.darknessPerPixel.toFixed(2)} luma/pixel` : "unavailable"}; forward 11–45 px: {target.shadowEvidence?.forward ? `${target.shadowEvidence.forward.darkPixels} dark px, darkness ${target.shadowEvidence.forward.darknessPerPixel.toFixed(2)} luma/pixel` : "unavailable"}; max row gradient {target.shadowEvidence?.maxSpatialGradient?.toFixed(2) ?? "unavailable"}. Adjacent-frame darkness change: near {target.shadowEvidenceChange?.nearDarknessDelta?.toFixed(2) ?? "unavailable"}, forward {target.shadowEvidenceChange?.forwardDarknessDelta?.toFixed(2) ?? "unavailable"}. Positive means darker; Y direction and old oval rule are reported separately below.</p>
            <p><strong>{target.requestedHand} {target.finger}:</strong> Label {result.label.toUpperCase()} · oval {target.shadowEllipse ? `${target.shadowEllipse.areaPx.toFixed(0)} px² (${target.shadowEllipse.majorDiameterPx.toFixed(0)} × ${target.shadowEllipse.minorDiameterPx.toFixed(0)} px)` : "unavailable"} · previous-frame gap {target.comparisonFrameGap ?? "—"} · Y decreased {target.yDecreased === null ? "unknown" : target.yDecreased ? "yes" : "no"} · shadow {target.shadowTransition} · experimental press {target.pressCandidate === null ? "unavailable" : target.pressCandidate ? "candidate" : "no"} · broad-region dark pixels {target.darkShadowArea ?? "unavailable"} px{target.darkShadowMeanDrop == null ? "" : ` · mean drop ${target.darkShadowMeanDrop.toFixed(1)} luma`} · MediaPipe says {detectorLabel(target.measurement?.state)} <VerdictBadge verdict={targetVerdict(result.label, target.measurement)} />; subtraction point {target.refinedPoint ? `(${target.refinedPoint.x.toFixed(1)}, ${target.refinedPoint.y.toFixed(1)})` : "not found"}; nail-color component center {target.colorPoint ? `(${target.colorPoint.x.toFixed(1)}, ${target.colorPoint.y.toFixed(1)})` : "not found"} · RGB target ({NAIL_RGB.join(", ")}) ± {NAIL_RGB_TOLERANCE} · heuristic confidence {target.colorRefinement?.confidence.toFixed(2) ?? "unavailable"} · component {target.colorRefinement?.area ?? "unavailable"} px{target.colorRefinement?.failureReason ? ` · ${target.colorRefinement.failureReason}` : ""}; subtraction detector says {detectorLabel(target.refinedMeasurement?.state)} <VerdictBadge verdict={targetVerdict(result.label, target.refinedMeasurement)} />; edges {target.refinement?.leftEdge && target.refinement.rightEdge ? `${target.refinement.leftEdge.x}–${target.refinement.rightEdge.x}` : "unavailable"}; paper boundary {target.refinement?.paperBoundary ? `y=${target.refinement.paperBoundary.y}` : "unavailable"}; key overlap {target.keyIndexes.join(", ") || "none"}; background available {target.refinedMeasurement?.backgroundAvailable ? "yes" : "no"}</p>
            {target.rgbProfiles.length > 0 && <RgbClassRayProfiles profiles={target.rgbProfiles} title="MediaPipe point" />}
            {target.yellowRgbProfiles && <RgbClassRayProfiles profiles={target.yellowRgbProfiles} title="Yellow-dot point" />}
            {!target.refinedPoint && <p className="font-medium">No refined point was placed: {target.refinement?.failureReason ?? "the subtraction scan did not return a result"}.</p>}
            {(sourceCropPreviews[`${result.fileName}:${index}`] || differencePreviews[`${result.fileName}:${index}`]) && <div className="grid max-w-5xl gap-4 md:grid-cols-2">
              {sourceCropPreviews[`${result.fileName}:${index}`] && <div className="space-y-1">
                <p className="text-sm font-medium">Original RGB crop · blue: traced dark runs · gray: probe lines · purple: approximate oval fit · red MediaPipe, green subtraction point</p>
                <img className="block h-auto w-full border" src={sourceCropPreviews[`${result.fileName}:${index}`]} alt={`Original RGB crop for ${target.requestedHand} ${target.finger} showing fingertip refinement overlays`} />
              </div>}
              {differencePreviews[`${result.fileName}:${index}`] && <div className="space-y-1">
                <p className="text-sm font-medium">Grayscale subtraction crop · {SHADOW_CROP_RADIUS * 2} × {SHADOW_CROP_RADIUS * 2} source pixels, enlarged 2×, with RGB-class ray segments</p>
                <img className="block h-auto w-full border" src={differencePreviews[`${result.fileName}:${index}`]} alt={`Grayscale subtraction crop for ${target.requestedHand} ${target.finger} with ray segments colored by nail-color, paper, and other RGB classes`} />
                <p className="text-sm">Raw difference scale: 0 = unchanged black; 255 = maximum difference white. Ray segments: <span style={{ color: "var(--color-yellow-strong)" }}>Yellow N: nail-color match</span> · <span style={{ color: "var(--color-white)" }}>White P: saved paper</span> · <span style={{ color: "var(--color-blue)" }}>Blue D: at least 40 luma levels darker than paper</span> · <span style={{ color: "var(--color-purple)" }}>Purple L: 18–39 levels darker than paper</span> · <span style={{ color: "var(--color-danger)" }}>Red O: other color change</span>.</p>
              </div>}
            </div>}
            {target.refinement && <BoundaryProfile values={target.refinement.lineProfile} boundaryIndex={target.refinement.paperBoundary && target.landmark ? Math.round(target.refinement.paperBoundary.y - target.landmark.y) : null} />}
            {target.measurement && <table className="w-full text-left text-sm">
              <thead><tr><th>Ray</th><th>Dip</th><th>Rise / px</th><th>Rebound width</th><th>Sharp rebound</th></tr></thead>
              <tbody>{target.measurement.rays.map((ray) => <tr key={ray.label}>
                <td>{ray.label}</td><td>{ray.dipDepth?.toFixed(1) ?? "—"}</td><td>{ray.steepestRise?.toFixed(1) ?? "—"}</td><td>{ray.reboundWidth ?? "—"}</td><td>{ray.sharpRebound ? "yes" : "no"}</td>
              </tr>)}</tbody>
            </table>}
            {target.measurement && <RaySetSummary label="MediaPipe" measurement={target.measurement} />}
            {target.measurement?.rays.map((ray) => <RayProfile key={ray.label} ray={ray} />)}
            {target.yellowMeasurement && <section className="mt-4 space-y-2 border-t pt-3">
              <h4 className="font-medium">Yellow-dot ray profiles · sampled from ({target.yellowPoint?.x.toFixed(1)}, {target.yellowPoint?.y.toFixed(1)})</h4>
              <p className="text-sm">These additional graphs use the yellow dot as their origin. The MediaPipe-origin graphs above remain unchanged.</p>
              <RaySetSummary label="Yellow dot" measurement={target.yellowMeasurement} />
              {(["right 20°", "left 20°", "center"] as const).map((label) => {
                const ray = target.yellowMeasurement!.rays.find((item) => item.label === label);
                return ray ? <RayProfile key={`yellow-${ray.label}`} ray={ray} /> : null;
              })}
            </section>}
            {target.error && <p>{target.error}</p>}
          </div>)}
        </article>)}
      </section>}
      {report && <details>
        <summary>Full JSON report</summary>
        <pre id="result-report" className="overflow-auto text-xs">{JSON.stringify(report, null, 2)}</pre>
      </details>}
    </main>
  );
}
