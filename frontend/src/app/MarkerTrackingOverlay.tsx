"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCamera } from "./CameraContext";
import {
  cameraSignature,
  loadCalibration,
  markerCorners,
} from "../cv/calibration";
import {
  getWhiteKeyPolygons,
  getPianoCorners,
  pressWhiteKey,
  releaseWhiteKey,
} from "../cv/keyboardGeometry";
import { getKeyCollisions, updateKeyTransitions } from "../cv/collision";
import type { Fingertip } from "../cv/collision";
import type { HandObservation } from "../cv/collision";
import type { KeyPress } from "../events/keyEventProducer";
import type { FingerContactState } from "../cv/combinedContact";
import {
  KNUCKLE_PLAYING_MARGIN_Y,
  KNUCKLE_ELIGIBILITY_HYSTERESIS_Y,
} from "../cv/contactPipeline";
import {
  CONTACT_TECHNIQUES,
  LiveContactPipeline,
  SHADOW_CROP_RADIUS,
} from "../cv/liveContactPipeline";
import {
  getKnuckleBoundaryY,
  getHandDepthCalibration,
  getKnuckleDistance,
  DEPTH_FINGERS,
} from "../cv/depthCalibration";
import type { PersistedDepthCalibration } from "../cv/depthCalibration";
import {
  SHADOW_CUTOFF_OFFSET_Y,
  SHADOW_PRESS_ABSOLUTE_AREA_PIXELS,
  SHADOW_PRESS_AREA_RATIO,
} from "../cv/shadowHeuristics";
import type { ShadowContactState, ShadowState } from "../cv/shadowHeuristics";
import type { SynchronousShadowMeasurement } from "../cv/synchronousShadowDetector";
import { MarkerDetector } from "../cv/markerDetector";
import { MarkerGeometryPolicy } from "../cv/markerGeometryPolicy";
import {
  computeHomography,
  invertHomography,
  projectPoint,
  type Homography,
} from "../cv/homography";
import type { MarkerDetectionResult } from "../cv/types";
import type { Point } from "../cv/types";
import { keyIndexToMidi } from "../cv/noteMap";
import { DEFAULT_LAYOUT, type KeyboardLayout } from "../cv/keyboardLayout";
import {
  recordMarkerDetection,
  pipelineMetrics,
} from "../diagnostics/performanceMetrics";

const PAGE_CORNERS: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const KNUCKLE_LANDMARK_INDICES = [5, 9, 13, 17] as const;
const SHADOW_PREVIEW_RADIUS = SHADOW_CROP_RADIUS;
const SHADOW_PREVIEW_SIZE = 280;
const SHOW_EXTRA_SHADOW_DEBUG_OVERLAYS = false;
const PROFILE_SIDE_ANGLE = (20 * Math.PI) / 180;
const PROFILE_NAIL_RGB = [138, 98, 88] as const;
const PROFILE_NAIL_RGB_TOLERANCE = 30;
const PROFILE_PAPER_RGB_TOLERANCE = 18;

type ProfileColorClass = "nail" | "paper" | "other";

function classifyProfileColor(
  red: number,
  green: number,
  blue: number,
  paperRgb: readonly number[] | null,
): ProfileColorClass {
  const nailMatch = PROFILE_NAIL_RGB.every(
    (channel, index) =>
      Math.abs([red, green, blue][index] - channel) <=
      PROFILE_NAIL_RGB_TOLERANCE,
  ) && red >= green + 30;
  if (nailMatch) return "nail";
  if (
    paperRgb &&
    [red, green, blue].every(
      (channel, index) =>
        Math.abs(channel - paperRgb[index]) <= PROFILE_PAPER_RGB_TOLERANCE,
    )
  ) return "paper";
  return "other";
}

function profileClassColor(element: HTMLElement, value: ProfileColorClass) {
  const style = getComputedStyle(element);
  const token = value === "nail"
    ? "--color-yellow-light"
    : value === "paper"
      ? "--color-white"
      : "--color-info";
  return style.getPropertyValue(token).trim();
}

function drawGrayShadowArc(
  context: CanvasRenderingContext2D,
  center: Point,
  scale = 1,
) {
  context.save();
  context.strokeStyle = getComputedStyle(context.canvas)
    .getPropertyValue("--color-ink-muted")
    .trim();
  context.lineWidth = 2 / scale;
  context.beginPath();
  context.ellipse(center.x, center.y + 20, 42, 25, 0, 0, Math.PI);
  context.stroke();
  context.restore();
}

function drawShadowSamplingGuides(
  context: CanvasRenderingContext2D,
  center: Point,
  scale = 1,
) {
  const style = getComputedStyle(context.canvas);
  const x = Math.round(center.x);
  const y = Math.round(center.y);
  context.save();
  context.lineWidth = 2 / scale;
  context.strokeStyle = style.getPropertyValue("--color-accent-light").trim();
  context.strokeRect(
    x - SHADOW_PREVIEW_RADIUS,
    y - SHADOW_PREVIEW_RADIUS,
    SHADOW_PREVIEW_RADIUS * 2,
    SHADOW_PREVIEW_RADIUS * 2,
  );
  context.setLineDash([6 / scale, 4 / scale]);
  context.beginPath();
  context.moveTo(x - SHADOW_PREVIEW_RADIUS, y + SHADOW_CUTOFF_OFFSET_Y);
  context.lineTo(x + SHADOW_PREVIEW_RADIUS, y + SHADOW_CUTOFF_OFFSET_Y);
  context.stroke();
  context.setLineDash([]);
  context.strokeStyle = style.getPropertyValue("--color-ink").trim();
  context.lineWidth = 4 / scale;
  context.beginPath();
  context.moveTo(center.x - 4 / scale, center.y);
  context.lineTo(center.x + 4 / scale, center.y);
  context.moveTo(center.x, center.y - 4 / scale);
  context.lineTo(center.x, center.y + 4 / scale);
  context.stroke();
  context.strokeStyle = style.getPropertyValue("--color-white").trim();
  context.lineWidth = 1.5 / scale;
  context.stroke();
  context.strokeStyle = style.getPropertyValue("--color-red-light").trim();
  context.lineWidth = 2 / scale;
  context.setLineDash([4 / scale, 3 / scale]);
  context.strokeRect(center.x - 22, center.y - 16, 44, 36);
  context.strokeStyle = style.getPropertyValue("--color-ink-muted").trim();
  context.beginPath();
  context.ellipse(center.x, center.y + 20, 42, 25, 0, 0, Math.PI);
  context.stroke();
  context.restore();
}

function drawShadowContourPreview(
  context: CanvasRenderingContext2D,
  boundary: Uint16Array | null,
  maskSize: number,
) {
  const { canvas } = context;
  const scaleX = canvas.width / maskSize;
  const scaleY = canvas.height / maskSize;
  const tip = { x: maskSize / 2, y: maskSize / 2 };
  const style = getComputedStyle(canvas);
  let closest: { x: number; y: number; distanceSquared: number } | null = null;
  context.save();
  context.fillStyle = style.getPropertyValue("--color-purple").trim();
  for (const index of boundary ?? []) {
    const x = index % maskSize;
    const y = Math.floor(index / maskSize);
    context.beginPath();
    context.arc((x + 0.5) * scaleX, (y + 0.5) * scaleY, 3, 0, Math.PI * 2);
    context.fill();
    if (y < tip.y) continue;
    const distanceSquared = (x - tip.x) ** 2 + (y - tip.y) ** 2;
    if (!closest || distanceSquared < closest.distanceSquared)
      closest = { x, y, distanceSquared };
  }
  if (closest) {
    context.beginPath();
    context.moveTo(tip.x * scaleX, tip.y * scaleY);
    context.lineTo(closest.x * scaleX, closest.y * scaleY);
    context.strokeStyle = style.getPropertyValue("--color-ink").trim();
    context.lineWidth = 7;
    context.stroke();
    context.strokeStyle = style.getPropertyValue("--color-green").trim();
    context.lineWidth = 4;
    context.stroke();
    context.fillStyle = style.getPropertyValue("--color-green").trim();
    context.beginPath();
    context.arc(closest.x * scaleX, closest.y * scaleY, 5, 0, Math.PI * 2);
    context.fill();
    const midpointX = ((tip.x + closest.x) / 2) * scaleX;
    const midpointY = ((tip.y + closest.y) / 2) * scaleY;
    const label = `${Math.sqrt(closest.distanceSquared).toFixed(1)} px`;
    context.font = "bold 12px sans-serif";
    const labelWidth = context.measureText(label).width + 8;
    context.fillStyle = style.getPropertyValue("--color-ink").trim();
    context.fillRect(midpointX + 4, midpointY - 15, labelWidth, 18);
    context.fillStyle = style.getPropertyValue("--color-green-light").trim();
    context.fillText(label, midpointX + 8, midpointY - 2);
  }
  context.restore();
  return closest ? Math.sqrt(closest.distanceSquared) : null;
}

function drawTipGradientCandidates(
  context: CanvasRenderingContext2D,
  crop: HTMLCanvasElement,
  center: Point,
) {
  const source = crop.getContext("2d", { willReadFrequently: true });
  if (!source || crop.width < 3 || crop.height < 3)
    return { nearby: 0, belowTip: 0, points: [] as Point[] };
  const pixels = source.getImageData(0, 0, crop.width, crop.height).data;
  const lumaAt = (x: number, y: number) => {
    const offset = (y * crop.width + x) * 4;
    return (
      0.2126 * pixels[offset] +
      0.7152 * pixels[offset + 1] +
      0.0722 * pixels[offset + 2]
    );
  };
  const style = getComputedStyle(context.canvas);
  context.save();
  context.strokeStyle = style.getPropertyValue("--color-accent").trim();
  context.lineWidth = 1;
  context.setLineDash([3, 2]);
  context.strokeRect(center.x - 16, center.y + 4, 32, 16);
  context.restore();
  context.fillStyle = style.getPropertyValue("--color-red").trim();
  let nearby = 0;
  let belowTip = 0;
  const points: Point[] = [];
  for (
    let y = Math.max(1, Math.floor(center.y) - 14);
    y < Math.min(crop.height - 1, Math.ceil(center.y) + 28);
    y += 1
  ) {
    for (
      let x = Math.max(1, Math.floor(center.x) - 22);
      x < Math.min(crop.width - 1, Math.ceil(center.x) + 22);
      x += 1
    ) {
      const gx =
        -lumaAt(x - 1, y - 1) +
        lumaAt(x + 1, y - 1) -
        2 * lumaAt(x - 1, y) +
        2 * lumaAt(x + 1, y) -
        lumaAt(x - 1, y + 1) +
        lumaAt(x + 1, y + 1);
      const gy =
        -lumaAt(x - 1, y - 1) -
        2 * lumaAt(x, y - 1) -
        lumaAt(x + 1, y - 1) +
        lumaAt(x - 1, y + 1) +
        2 * lumaAt(x, y + 1) +
        lumaAt(x + 1, y + 1);
      const magnitude = Math.abs(gx) + Math.abs(gy);
      const nearTip = (x - center.x) ** 2 + (y - center.y) ** 2 <= 24 ** 2;
      if (nearTip && magnitude >= 260) {
        nearby += 1;
        points.push({ x, y });
        if (
          x >= center.x - 16 &&
          x <= center.x + 16 &&
          y >= center.y + 4 &&
          y <= center.y + 20
        )
          belowTip += 1;
        context.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
      }
    }
  }
  return { nearby, belowTip, points };
}

function drawGradientContourOverlap(
  context: CanvasRenderingContext2D,
  gradientPoints: Point[],
  boundary: Uint16Array | null,
  maskSize: number,
) {
  if (!boundary?.length || gradientPoints.length === 0) return false;
  const boundaryPixels = new Set(boundary);
  let overlap: Point | null = null;
  for (const point of gradientPoints) {
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    for (let dy = -2; dy <= 2 && !overlap; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (dx * dx + dy * dy > 4) continue;
        const bx = x + dx;
        const by = y + dy;
        if (
          bx >= 0 &&
          bx < maskSize &&
          by >= 0 &&
          by < maskSize &&
          boundaryPixels.has(by * maskSize + bx)
        ) {
          overlap = { x: point.x + dx / 2, y: point.y + dy / 2 };
          break;
        }
      }
    }
    if (overlap) break;
  }
  if (!overlap) return false;
  const scaleX = context.canvas.width / maskSize;
  const scaleY = context.canvas.height / maskSize;
  context.save();
  context.beginPath();
  context.arc(overlap.x * scaleX, overlap.y * scaleY, 10, 0, Math.PI * 2);
  context.fillStyle = getComputedStyle(context.canvas)
    .getPropertyValue("--color-pink")
    .trim();
  context.strokeStyle = getComputedStyle(context.canvas)
    .getPropertyValue("--color-ink")
    .trim();
  context.lineWidth = 3;
  context.fill();
  context.stroke();
  context.restore();
  return true;
}

function drawFingerOutlineCandidate(
  context: CanvasRenderingContext2D,
  crop: HTMLCanvasElement,
  center: Point,
) {
  const source = crop.getContext("2d", { willReadFrequently: true });
  if (!source || crop.width < 3 || crop.height < 3) return null;
  const pixels = source.getImageData(0, 0, crop.width, crop.height).data;
  const lumaAt = (x: number, y: number) => {
    const offset = (y * crop.width + x) * 4;
    return (
      0.2126 * pixels[offset] +
      0.7152 * pixels[offset + 1] +
      0.0722 * pixels[offset + 2]
    );
  };
  const gradientAt = (x: number, y: number) => {
    if (x <= 0 || x >= crop.width - 1 || y <= 0 || y >= crop.height - 1)
      return 0;
    const gx =
      -lumaAt(x - 1, y - 1) +
      lumaAt(x + 1, y - 1) -
      2 * lumaAt(x - 1, y) +
      2 * lumaAt(x + 1, y) -
      lumaAt(x - 1, y + 1) +
      lumaAt(x + 1, y + 1);
    const gy =
      -lumaAt(x - 1, y - 1) -
      2 * lumaAt(x, y - 1) -
      lumaAt(x + 1, y - 1) +
      lumaAt(x - 1, y + 1) +
      2 * lumaAt(x, y + 1) +
      lumaAt(x + 1, y + 1);
    return Math.abs(gx) + Math.abs(gy);
  };

  const angleCount = 49;
  const minRadius = 5;
  const maxRadius = 36;
  const radiusCount = maxRadius - minRadius + 1;
  const scores = Array.from({ length: angleCount }, () =>
    new Float64Array(radiusCount),
  );
  for (let angleIndex = 0; angleIndex < angleCount; angleIndex += 1) {
    const angle = Math.PI - (Math.PI * angleIndex) / (angleCount - 1);
    for (let radiusIndex = 0; radiusIndex < radiusCount; radiusIndex += 1) {
      const radius = minRadius + radiusIndex;
      const x = Math.round(center.x + radius * Math.cos(angle));
      const y = Math.round(center.y + radius * Math.sin(angle));
      if (x <= 0 || x >= crop.width - 1 || y <= 0 || y >= crop.height - 1)
        continue;
      scores[angleIndex][radiusIndex] = gradientAt(x, y);
    }
  }

  // Pick the strongest edge path while penalizing sudden radius jumps.
  const smoothnessPenalty = 28;
  const paths = Array.from({ length: angleCount }, () =>
    new Int16Array(radiusCount),
  );
  let previous = scores[0].slice();
  for (let angleIndex = 1; angleIndex < angleCount; angleIndex += 1) {
    const current = new Float64Array(radiusCount);
    for (let radiusIndex = 0; radiusIndex < radiusCount; radiusIndex += 1) {
      let bestScore = -Infinity;
      let bestPrevious = 0;
      for (
        let previousIndex = 0;
        previousIndex < radiusCount;
        previousIndex += 1
      ) {
        const score =
          previous[previousIndex] -
          smoothnessPenalty * Math.abs(radiusIndex - previousIndex);
        if (score > bestScore) {
          bestScore = score;
          bestPrevious = previousIndex;
        }
      }
      current[radiusIndex] = scores[angleIndex][radiusIndex] + bestScore;
      paths[angleIndex][radiusIndex] = bestPrevious;
    }
    previous = current;
  }

  let radiusIndex = 0;
  for (let index = 1; index < radiusCount; index += 1)
    if (previous[index] > previous[radiusIndex]) radiusIndex = index;
  const selected = new Int16Array(angleCount);
  for (let angleIndex = angleCount - 1; angleIndex >= 0; angleIndex -= 1) {
    selected[angleIndex] = radiusIndex;
    if (angleIndex > 0) radiusIndex = paths[angleIndex][radiusIndex];
  }

  const points = Array.from({ length: angleCount }, (_, angleIndex) => {
    const angle = Math.PI - (Math.PI * angleIndex) / (angleCount - 1);
    const radius = minRadius + selected[angleIndex];
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
  const meanGradient = points.reduce((sum, point) => {
    return sum + gradientAt(Math.round(point.x), Math.round(point.y));
  }, 0) / points.length;

  context.save();
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1)
    context.lineTo(points[index].x, points[index].y);
  context.strokeStyle = getComputedStyle(context.canvas)
    .getPropertyValue("--color-ink")
    .trim();
  context.lineWidth = 4;
  context.stroke();
  context.strokeStyle = getComputedStyle(context.canvas)
    .getPropertyValue("--color-green-light")
    .trim();
  context.lineWidth = 2.5;
  context.stroke();
  context.restore();
  return meanGradient;
}

function drawBackgroundDeltaPreview(
  background: HTMLCanvasElement,
  differenceSource: HTMLCanvasElement,
  differencePreview: HTMLCanvasElement,
  crop: HTMLCanvasElement,
  origin: Point,
  center: Point,
) {
  const backgroundContext = background.getContext("2d", {
    willReadFrequently: true,
  });
  const currentContext = crop.getContext("2d", { willReadFrequently: true });
  const sourceContext = differenceSource.getContext("2d");
  const previewContext = differencePreview.getContext("2d");
  if (!backgroundContext || !currentContext || !sourceContext || !previewContext)
    return null;
  if (
    background.width === 0 ||
    background.height === 0 ||
    origin.x < 0 ||
    origin.y < 0 ||
    origin.x + crop.width > background.width ||
    origin.y + crop.height > background.height
  )
    return null;

  const baseline = backgroundContext.getImageData(
    origin.x,
    origin.y,
    crop.width,
    crop.height,
  ).data;
  const current = currentContext.getImageData(0, 0, crop.width, crop.height).data;
  if (differenceSource.width !== crop.width)
    differenceSource.width = crop.width;
  if (differenceSource.height !== crop.height)
    differenceSource.height = crop.height;
  const delta = sourceContext.createImageData(crop.width, crop.height);
  let changedPixels = 0;
  for (let offset = 0; offset < current.length; offset += 4) {
    const currentLuma =
      0.2126 * current[offset] +
      0.7152 * current[offset + 1] +
      0.0722 * current[offset + 2];
    const backgroundLuma =
      0.2126 * baseline[offset] +
      0.7152 * baseline[offset + 1] +
      0.0722 * baseline[offset + 2];
    const difference = Math.abs(currentLuma - backgroundLuma);
    const value = Math.max(0, Math.min(255, (difference - 6) * 3));
    if (difference >= 12) changedPixels += 1;
    delta.data[offset] = value;
    delta.data[offset + 1] = value;
    delta.data[offset + 2] = value;
    delta.data[offset + 3] = 255;
  }
  sourceContext.putImageData(delta, 0, 0);
  const cropLeft = Math.round(center.x) - SHADOW_CROP_RADIUS;
  const cropTop = Math.round(center.y) - SHADOW_CROP_RADIUS;
  const scale = differencePreview.width / (SHADOW_CROP_RADIUS * 2);
  previewContext.clearRect(
    0,
    0,
    differencePreview.width,
    differencePreview.height,
  );
  previewContext.imageSmoothingEnabled = false;
  previewContext.drawImage(
    differenceSource,
    -cropLeft * scale,
    -cropTop * scale,
    crop.width * scale,
    crop.height * scale,
  );
  previewContext.save();
  previewContext.scale(scale, scale);
  const arcAnchor = {
    x: SHADOW_PREVIEW_RADIUS,
    y: SHADOW_PREVIEW_RADIUS + SHADOW_CUTOFF_OFFSET_Y,
  };
  drawGrayShadowArc(previewContext, arcAnchor, scale);
  previewContext.restore();
  return { changedPixels, totalPixels: crop.width * crop.height };
}

interface ShadowProfileRay {
  label: string;
  target: Point;
  colorClasses: ProfileColorClass[];
}

function getRgbProfileTargets(center: Point) {
  const intersectArc = (angle: number) => {
    const ellipseValue = (distance: number) => {
      const x = Math.sin(angle) * distance;
      const y = Math.cos(angle) * distance;
      return (x / 42) ** 2 + ((y - 20) / 25) ** 2;
    };
    let low = 0;
    let high = 70;
    for (let iteration = 0; iteration < 16; iteration += 1) {
      const middle = (low + high) / 2;
      if (ellipseValue(middle) < 1) low = middle;
      else high = middle;
    }
    const distance = (low + high) / 2;
    return {
      x: center.x + Math.sin(angle) * distance,
      y: center.y + Math.cos(angle) * distance,
    };
  };
  return [
    { label: "center", target: intersectArc(0) },
    { label: "left 20°", target: intersectArc(-PROFILE_SIDE_ANGLE) },
    { label: "right 20°", target: intersectArc(PROFILE_SIDE_ANGLE) },
  ];
}

function drawShadowArcLines(
  cameraPreview: HTMLCanvasElement,
  rays: readonly ShadowProfileRay[],
) {
  const context = cameraPreview.getContext("2d");
  if (!context) return;
  const scale = cameraPreview.width / (SHADOW_PREVIEW_RADIUS * 2);
  const classColors: Record<ProfileColorClass, string> = {
    nail: profileClassColor(cameraPreview, "nail"),
    paper: profileClassColor(cameraPreview, "paper"),
    other: profileClassColor(cameraPreview, "other"),
  };
  const start = {
    x: SHADOW_PREVIEW_RADIUS * scale,
    y: (SHADOW_PREVIEW_RADIUS + SHADOW_CUTOFF_OFFSET_Y) * scale,
  };
  context.save();
  context.lineCap = "round";
  for (const ray of rays) {
    const dx = (ray.target.x - SHADOW_PREVIEW_RADIUS) * scale;
    const dy = (ray.target.y - SHADOW_PREVIEW_RADIUS) * scale;
    for (let index = 1; index < ray.colorClasses.length; index += 1) {
      const denominator = Math.max(1, ray.colorClasses.length - 1);
      context.lineWidth = 2.5 / scale;
      context.strokeStyle = classColors[ray.colorClasses[index] ?? "other"];
      context.beginPath();
      context.moveTo(
        start.x + (dx * (index - 1)) / denominator,
        start.y + (dy * (index - 1)) / denominator,
      );
      context.lineTo(
        start.x + (dx * index) / denominator,
        start.y + (dy * index) / denominator,
      );
      context.stroke();
    }
  }
  context.fillStyle = classColors.paper;
  context.beginPath();
  context.arc(start.x, start.y, 4 / scale, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawShadowLineProfile(
  profileCanvas: HTMLCanvasElement,
  crop: HTMLCanvasElement,
  center: Point,
  cropOffset: Point,
  backgroundCanvas: HTMLCanvasElement | null,
) {
  const chart = profileCanvas.getContext("2d");
  const currentContext = crop.getContext("2d", { willReadFrequently: true });
  if (!chart || !currentContext) return null;

  const current = currentContext.getImageData(0, 0, crop.width, crop.height).data;
  const backgroundContext = backgroundCanvas?.getContext("2d", {
    willReadFrequently: true,
  });
  const background = backgroundContext && backgroundCanvas &&
      cropOffset.x >= 0 && cropOffset.y >= 0 &&
      cropOffset.x + crop.width <= backgroundCanvas.width &&
      cropOffset.y + crop.height <= backgroundCanvas.height
    ? backgroundContext.getImageData(
        cropOffset.x,
        cropOffset.y,
        crop.width,
        crop.height,
      ).data
    : null;
  const rays: ShadowProfileRay[] = getRgbProfileTargets(center).map(
    ({ label, target }) => {
      const length = Math.hypot(target.x - center.x, target.y - center.y);
      const colorClasses: ProfileColorClass[] = [];
      const steps = Math.ceil(length);
      for (let step = 0; step <= steps; step += 1) {
        const ratio = step / steps;
        const x = Math.round(center.x + (target.x - center.x) * ratio);
        const y = Math.round(center.y + (target.y - center.y) * ratio);
        if (x < 0 || x >= crop.width || y < 0 || y >= crop.height) continue;
        const offset = (y * crop.width + x) * 4;
        const paperRgb = background
          ? [background[offset], background[offset + 1], background[offset + 2]]
          : null;
        colorClasses.push(
          classifyProfileColor(
            current[offset],
            current[offset + 1],
            current[offset + 2],
            paperRgb,
          ),
        );
      }
      return { label, target, colorClasses };
    },
  );

  const style = getComputedStyle(profileCanvas);
  const left = 24;
  const width = profileCanvas.width - 32;
  chart.clearRect(0, 0, profileCanvas.width, profileCanvas.height);
  chart.fillStyle = style.getPropertyValue("--color-surface-dark").trim();
  chart.fillRect(0, 0, profileCanvas.width, profileCanvas.height);
  const rayDisplayNames = ["C", "L20°", "R20°"];
  const code = { nail: "N", paper: "P", other: "O" } as const;
  const rowTop = 30;
  rays.forEach((ray, index) => {
    const runs: Array<{ colorClass: ProfileColorClass; count: number }> = [];
    for (const colorClass of ray.colorClasses) {
      const last = runs[runs.length - 1];
      if (last?.colorClass === colorClass) last.count += 1;
      else runs.push({ colorClass, count: 1 });
    }
    const shownRuns = runs.slice(0, 4)
      .map((run) => `${code[run.colorClass]}${run.count}`)
      .join(" ");
    const extraRuns = runs.length > 4 ? " +" : "";
    chart.font = "8px sans-serif";
    chart.fillStyle = style.getPropertyValue("--color-white").trim();
    chart.fillText(
      `${rayDisplayNames[index]} ${shownRuns}${extraRuns}`,
      2,
      rowTop + index * 34 + 9,
    );
    const denominator = Math.max(1, ray.colorClasses.length);
    ray.colorClasses.forEach((colorClass, sampleIndex) => {
      chart.fillStyle = profileClassColor(profileCanvas, colorClass);
      const x = left + (sampleIndex / denominator) * width;
      const nextX = left + ((sampleIndex + 1) / denominator) * width;
      chart.fillRect(
        x,
        rowTop + index * 34 + 16,
        Math.max(1, nextX - x),
        10,
      );
    });
  });
  chart.font = "9px sans-serif";
  chart.fillStyle = "rgba(255,255,255,0.7)";
  chart.fillText(
    background
      ? "N = nail-color match   P = saved paper   O = other"
      : "N = nail-color match   paper baseline unavailable   O = other",
    left,
    138,
  );
  return { rays };
}

interface FingerDebugState {
  id: string;
  handIndex: number;
  finger: string;
  state: FingerContactState;
  keyOverlap: boolean;
  knuckleEligible: boolean;
  fingertipVideo: Point;
  fingertipSheet: Point | null;
  fingertipZ: number | undefined;
  knuckleDistance: number | null;
  knuckles: Point[];
  shadow: ShadowState;
  shadowStrength: number | null;
  shadowLumaChange: number | null;
  shadowDarkArea: number | null;
  shadowContourArea: number | null;
  shadowContact: ShadowContactState;
  shadowPeakArea: number | null;
  shadowAreaRatio: number | null;
  synchronousShadow: SynchronousShadowMeasurement | null;
}

export type ContactFrameHandler = (
  fingertips: readonly Fingertip[], hands: readonly HandObservation[],
) => void;

export default function MarkerTrackingOverlay({
  contactFrameRef,
  videoRef,
  fingertips,
  hands = [],
  depthCalibration = null,
  onKeyTransitions,
  trackingEnabled = false,
  onCalibrationObservation,
  activePitches,
  showVisualDebug = false,
  debugShowZLines = false,
  debugShowSheetWithoutCalibration = false,
  layout = DEFAULT_LAYOUT,
}: {
  contactFrameRef?: React.RefObject<ContactFrameHandler | null>;
  layout?: KeyboardLayout;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  fingertips: readonly Fingertip[];
  hands?: readonly HandObservation[];
  depthCalibration?: PersistedDepthCalibration | null;
  activePitches: ReadonlySet<number>;
  onKeyTransitions?: (pressed: readonly KeyPress[], released: readonly number[]) => void;
  trackingEnabled?: boolean;
  showVisualDebug?: boolean;
  debugShowZLines?: boolean;
  debugShowSheetWithoutCalibration?: boolean;
  onCalibrationObservation: (saved: unknown, camera: ReturnType<typeof cameraSignature>, corners: Point[] | null) => boolean;
}) {
  const { stream, cameraReady } = useCamera();
  const [markerDetection, setMarkerDetection] =
    useState<MarkerDetectionResult | null>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement>(null);
  const markerBackgroundFrameRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const shadowBackgroundRef = useRef<HTMLCanvasElement>(null);
  const shadowDifferenceSourceRef = useRef<HTMLCanvasElement>(null);
  const shadowDifferencePreviewRef = useRef<HTMLCanvasElement>(null);
  const shadowLineProfileRef = useRef<HTMLCanvasElement>(null);
  const shadowPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const shadowMaskCanvasRef = useRef<HTMLCanvasElement>(null);
  const shadowMaskSourceRef = useRef<HTMLCanvasElement>(null);
  const shadowBoundaryRef = useRef<Uint16Array | null>(null);
  const shadowGradientPointsRef = useRef<Point[]>([]);
  const pipelineRef = useRef<LiveContactPipeline | null>(null);
  const [shadowWorkerError, setShadowWorkerError] = useState<string | null>(
    null,
  );
  const [shadowMaskCount, setShadowMaskCount] = useState(0);
  const [capturedBackground, setCapturedBackground] = useState<{
    stream: MediaStream | null;
    cameraReady: boolean;
  } | null>(null);
  const [shadowDifferenceStats, setShadowDifferenceStats] = useState<{
    changedPixels: number;
    totalPixels: number;
  } | null>(null);
  const [shadowDiagnosticsOnly, setShadowDiagnosticsOnly] = useState(false);
  const [synchronousShadowDiagnosticsOnly, setSynchronousShadowDiagnosticsOnly] = useState(false);
  const [shadowGapPixels, setShadowGapPixels] = useState<number | null>(null);
  const [shadowGradientCounts, setShadowGradientCounts] = useState({
    nearby: 0,
    belowTip: 0,
  });
  const [shadowOutlineGradientScore, setShadowOutlineGradientScore] =
    useState<number | null>(null);
  const [shadowPreviewMode, setShadowPreviewMode] = useState<
    "mask" | "camera" | "difference"
  >("camera");
  const shadowBackgroundCaptured =
    capturedBackground?.stream === stream &&
    capturedBackground.cameraReady === cameraReady;
  const homographyRef = useRef<Homography | null>(null);
  const projectedPianoCornersRef = useRef<Point[] | null>(null);
  const projectedWhiteKeysRef = useRef<Point[][] | null>(null);
  const markerGeometryPolicyRef = useRef(
    new MarkerGeometryPolicy<{
      homography: Homography;
      pianoCorners: Point[];
      whiteKeys: Point[][];
    }>(),
  );
  const displayPianoCornersRef = useRef<Point[] | null>(null);
  const displayWhiteKeysRef = useRef<Point[][] | null>(null);
  const markerDetectionRef = useRef<MarkerDetectionResult | null>(null);
  const previousKeysRef = useRef<Set<number>>(new Set());
  const previousHighlightedKeysRef = useRef<Set<number>>(new Set());
  const trackingEnabledRef = useRef(false);
  const onKeyTransitionsRef = useRef(onKeyTransitions);
  const showVisualDebugRef = useRef(showVisualDebug);
  const [highlightedKeyIndexes, setHighlightedKeyIndexes] = useState<number[]>(
    [],
  );
  const [fingerDebug, setFingerDebug] = useState<FingerDebugState[]>([]);
  const shadowPreviewFinger =
    !showVisualDebug ||
    !(CONTACT_TECHNIQUES.shadows || CONTACT_TECHNIQUES.synchronousShadows || shadowDiagnosticsOnly || synchronousShadowDiagnosticsOnly)
      ? undefined
      : (fingertips.find(
          (finger) =>
            finger.landmarkIndex === 8 &&
            hands[finger.handIndex]?.handedness === "Right",
        ) ?? fingertips.find((finger) => finger.landmarkIndex === 8));
  const shadowPreviewDebug = fingerDebug.find(
    (finger) => finger.id === shadowPreviewFinger?.id,
  );

  const syncContactKeys = useCallback(() => {
    const detectedKeys = new Set<number>();
    const velocities = new Map<number, number>();
    for (const [id, contact] of pipelineRef.current?.contacts ?? []) {
      if (!contact.active) continue;
      for (const key of pipelineRef.current?.gates.get(id)?.keyIndexes ?? []) {
        detectedKeys.add(key);
        const velocity = pipelineRef.current!.pressVelocities.get(id)!;
        velocities.set(key, Math.max(velocities.get(key) ?? 0, velocity));
      }
    }
    const currentKeys = trackingEnabledRef.current
      ? detectedKeys
      : new Set<number>();
    const transitions = updateKeyTransitions(
      previousKeysRef.current,
      currentKeys,
    );
    previousKeysRef.current = currentKeys;
    if (transitions.pressed.length || transitions.released.length) {
      onKeyTransitionsRef.current?.(transitions.pressed.map(keyIndex => ({
        keyIndex, velocity: velocities.get(keyIndex)!,
      })), transitions.released);
    }
    // Camera feedback is useful even before recording starts or while paused.
    const highlights = updateKeyTransitions(
      previousHighlightedKeysRef.current,
      detectedKeys,
    );
    previousHighlightedKeysRef.current = detectedKeys;
    if (highlights.pressed.length || highlights.released.length) {
      queueMicrotask(() => setHighlightedKeyIndexes([...detectedKeys]));
    }
  }, []);

  useEffect(() => {
    if (!trackingEnabled && previousKeysRef.current.size > 0) {
      onKeyTransitions?.([], [...previousKeysRef.current]);
      // A new playback session treats held keys as fresh presses.
      previousKeysRef.current = new Set();
    }
  }, [onKeyTransitions, trackingEnabled]);

  useEffect(() => {
    showVisualDebugRef.current = showVisualDebug;
  }, [showVisualDebug]);

  useEffect(() => {
    const background = shadowBackgroundRef.current;
    if (background) {
      background.width = 0;
      background.height = 0;
    }
    markerBackgroundFrameRef.current = null;
    queueMicrotask(() => setCapturedBackground(null));
  }, [stream, cameraReady]);

  useEffect(() => {
    pipelineRef.current?.setShadowDiagnosticsOnly(
      showVisualDebug && shadowDiagnosticsOnly,
    );
  }, [showVisualDebug, shadowDiagnosticsOnly]);

  useEffect(() => {
    pipelineRef.current?.setSynchronousShadowDiagnosticsOnly(
      showVisualDebug && synchronousShadowDiagnosticsOnly,
    );
  }, [showVisualDebug, synchronousShadowDiagnosticsOnly]);

  useEffect(() => {
    onKeyTransitionsRef.current = onKeyTransitions;
  }, [onKeyTransitions]);

  useEffect(() => {
    trackingEnabledRef.current = trackingEnabled;
    pipelineRef.current?.reset();
  }, [depthCalibration, trackingEnabled]);

  useEffect(() => {
    const pipeline = new LiveContactPipeline({
      onContactsChanged: (refreshDebug) => {
        syncContactKeys();
        if (!refreshDebug || !showVisualDebugRef.current) return;
        setFingerDebug((current) =>
          current.map((finger) => {
            const observation = pipeline.observations.get(finger.id);
            const contact = pipeline.shadowContacts.get(finger.id);
            const synchronousShadow = pipeline.synchronousMeasurements.get(finger.id);
            return {
              ...finger,
              state: pipeline.contacts.get(finger.id)?.state ?? "unavailable",
              ...(observation
                ? {
                    shadow: observation.state,
                    shadowStrength: observation.measurement.shadowStrength,
                    shadowLumaChange: observation.lumaChange,
                    shadowDarkArea: observation.measurement.darkArea,
                    shadowContourArea: observation.contour?.areaPixels ?? null,
                    shadowContact: contact?.state ?? "unknown",
                    shadowPeakArea: contact?.peakArea ?? null,
                    shadowAreaRatio: contact?.areaRatio ?? null,
                  }
                : {}),
              synchronousShadow: synchronousShadow ?? null,
            };
          }),
        );
      },
      onShadowCameraPreview: (crop, center, origin) => {
        if (!showVisualDebugRef.current) return;
        const previewCanvas = shadowPreviewCanvasRef.current;
        const previewContext = previewCanvas?.getContext("2d");
        if (!previewCanvas || !previewContext) return;
        previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        if (!crop || crop.width === 0 || crop.height === 0) return;
        const cropLeft = Math.round(center.x) - SHADOW_CROP_RADIUS;
        const cropTop = Math.round(center.y) - SHADOW_CROP_RADIUS;
        const scale = previewCanvas.width / (SHADOW_CROP_RADIUS * 2);
        previewContext.imageSmoothingEnabled = false;
        previewContext.drawImage(
          crop,
          -cropLeft * scale,
          -cropTop * scale,
          crop.width * scale,
          crop.height * scale,
        );
        previewContext.save();
        previewContext.scale(scale, scale);
        const arcAnchor = {
          x: SHADOW_PREVIEW_RADIUS,
          y: SHADOW_PREVIEW_RADIUS + SHADOW_CUTOFF_OFFSET_Y,
        };
        drawGrayShadowArc(previewContext, arcAnchor, scale);
        if (SHOW_EXTRA_SHADOW_DEBUG_OVERLAYS) {
          drawShadowSamplingGuides(previewContext, arcAnchor, scale);
          const gradientCounts = drawTipGradientCandidates(
            previewContext,
            crop,
            arcAnchor,
          );
          shadowGradientPointsRef.current = gradientCounts.points;
          const outlineGradientScore = drawFingerOutlineCandidate(
            previewContext,
            crop,
            arcAnchor,
          );
          setShadowOutlineGradientScore((current) =>
            current === outlineGradientScore ? current : outlineGradientScore,
          );
          setShadowGradientCounts((current) =>
            current.nearby === gradientCounts.nearby &&
            current.belowTip === gradientCounts.belowTip
              ? current
              : gradientCounts,
          );
        }
        previewContext.restore();
        if (SHOW_EXTRA_SHADOW_DEBUG_OVERLAYS && shadowBoundaryRef.current) {
          const gap = drawShadowContourPreview(
            previewContext,
            shadowBoundaryRef.current,
            SHADOW_PREVIEW_RADIUS * 2,
          );
          setShadowGapPixels((current) => (current === gap ? current : gap));
        }
        if (SHOW_EXTRA_SHADOW_DEBUG_OVERLAYS)
          drawGradientContourOverlap(
            previewContext,
            shadowGradientPointsRef.current,
            shadowBoundaryRef.current,
            SHADOW_PREVIEW_RADIUS * 2,
          );
        const lineProfile = shadowLineProfileRef.current;
        const profile =
          lineProfile && crop
            ? drawShadowLineProfile(
                lineProfile,
                crop,
                arcAnchor,
                { x: cropLeft, y: cropTop },
                shadowBackgroundRef.current,
              )
            : null;
        const rays = profile?.rays ?? [];
        drawShadowArcLines(
          previewCanvas,
          rays,
        );
        const background = shadowBackgroundRef.current;
        const differenceSource = shadowDifferenceSourceRef.current;
        const differencePreview = shadowDifferencePreviewRef.current;
        if (background && differenceSource && differencePreview && crop) {
          const stats = drawBackgroundDeltaPreview(
            background,
            differenceSource,
            differencePreview,
            crop,
            origin,
            center,
          );
          setShadowDifferenceStats((current) =>
            current?.changedPixels === stats?.changedPixels &&
            current?.totalPixels === stats?.totalPixels
              ? current
              : stats,
          );
          if (!stats) {
            differencePreview
              .getContext("2d")
              ?.clearRect(0, 0, differencePreview.width, differencePreview.height);
          } else {
            drawShadowArcLines(
              differencePreview,
              rays,
            );
          }
        }
      },
      onShadowPreview: (observation, contact) => {
        if (!showVisualDebugRef.current || !observation.mask) return;
        const maskCanvas = shadowMaskCanvasRef.current;
        const source = shadowMaskSourceRef.current;
        const maskContext = maskCanvas?.getContext("2d");
        if (!maskCanvas || !source || !maskContext) return;
        const mask = observation.mask;
        shadowBoundaryRef.current = observation.contour?.boundary ?? null;
        if (source.width !== mask.width) source.width = mask.width;
        if (source.height !== mask.height) source.height = mask.height;
        const sourceContext = source.getContext("2d");
        if (!sourceContext) return;
        sourceContext.putImageData(mask, 0, 0);
        maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        maskContext.imageSmoothingEnabled = false;
        maskContext.drawImage(
          source,
          0,
          0,
          maskCanvas.width,
          maskCanvas.height,
        );
        const style = getComputedStyle(maskCanvas);
        const scaleX = maskCanvas.width / mask.width;
        const scaleY = maskCanvas.height / mask.height;
        maskContext.save();
        maskContext.fillStyle = style
          .getPropertyValue(
            contact?.state === "press candidate"
              ? "--color-success"
              : "--color-purple",
          )
          .trim();
        for (const index of observation.contour?.boundary ?? []) {
          maskContext.fillRect(
            (index % mask.width) * scaleX,
            Math.floor(index / mask.width) * scaleY,
            scaleX,
            scaleY,
          );
        }
        maskContext.strokeStyle = style
          .getPropertyValue("--color-accent-light")
          .trim();
        maskContext.lineWidth = 2;
        maskContext.setLineDash([6, 4]);
        const cutoffY = (mask.height / 2 + SHADOW_CUTOFF_OFFSET_Y) * scaleY;
        maskContext.beginPath();
        maskContext.moveTo(0, cutoffY);
        maskContext.lineTo(maskCanvas.width, cutoffY);
        maskContext.stroke();
        maskContext.restore();
        const cameraPreview = shadowPreviewCanvasRef.current;
        const cameraContext = cameraPreview?.getContext("2d");
        if (SHOW_EXTRA_SHADOW_DEBUG_OVERLAYS && cameraContext)
          setShadowGapPixels(
            drawShadowContourPreview(
              cameraContext,
              shadowBoundaryRef.current,
              mask.width,
            ),
          );
        if (SHOW_EXTRA_SHADOW_DEBUG_OVERLAYS && cameraContext)
          drawGradientContourOverlap(
            cameraContext,
            shadowGradientPointsRef.current,
            shadowBoundaryRef.current,
            mask.width,
          );
        setShadowMaskCount((count) => count + 1);
      },
      onError: (message) => {
        setShadowWorkerError(message);
        if (showVisualDebugRef.current)
          setFingerDebug((current) =>
            current.map((finger) => ({
              ...finger,
              state: "unavailable",
              shadowContact: "unknown",
            })),
          );
      },
    });
    pipelineRef.current = pipeline;
    pipeline.start();
    return () => {
      pipeline.dispose();
      pipelineRef.current = null;
    };
  }, [syncContactKeys]);

  useEffect(() => {
    let cancelled = false;
    let animationFrame = 0;
    let detector: MarkerDetector | null = null;
    let lastDetectionTime = -Infinity;
    let videoWasUnavailable = false;

    // Camera/source changes begin a new acquisition session.
    markerGeometryPolicyRef.current.reset();
    markerDetectionRef.current = null;
    homographyRef.current = null;
    projectedPianoCornersRef.current = null;
    projectedWhiteKeysRef.current = null;
    displayPianoCornersRef.current = null;
    displayWhiteKeysRef.current = null;
    queueMicrotask(() => {
      if (!cancelled) setMarkerDetection(null);
    });

    const detect = (time: number) => {
      const video = videoRef.current;
      const processingCanvas = processingCanvasRef.current;

      if (!cancelled) {
        if (video && processingCanvas && video.readyState >= 2) {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            videoWasUnavailable = false;
            if (
              processingCanvas.width !== video.videoWidth ||
              processingCanvas.height !== video.videoHeight
            ) {
              processingCanvas.width = video.videoWidth;
              processingCanvas.height = video.videoHeight;
            }

            const overlayCanvas = overlayCanvasRef.current;
            if (overlayCanvas) {
              if (
                overlayCanvas.width !== video.videoWidth ||
                overlayCanvas.height !== video.videoHeight
              ) {
                overlayCanvas.width = video.videoWidth;
                overlayCanvas.height = video.videoHeight;
              }
            }

            const markerInterval =
              markerGeometryPolicyRef.current.checkIntervalMs;
            if (time - lastDetectionTime >= markerInterval) {
              const context = processingCanvas.getContext("2d");
              if (context && detector) {
                context.drawImage(
                  video,
                  0,
                  0,
                  processingCanvas.width,
                  processingCanvas.height,
                );
                const detectionStartedAt = pipelineMetrics.enabled ? performance.now() : null;
                try {
                  const detection = detector.detect(processingCanvas);
                  if (detectionStartedAt !== null) recordMarkerDetection(
                    performance.now() - detectionStartedAt,
                  );
                  markerDetectionRef.current = detection;
                  if (detection.missingIds.length === 0) {
                    const snapshot = markerBackgroundFrameRef.current ??
                      document.createElement("canvas");
                    markerBackgroundFrameRef.current = snapshot;
                    if (snapshot.width !== processingCanvas.width)
                      snapshot.width = processingCanvas.width;
                    if (snapshot.height !== processingCanvas.height)
                      snapshot.height = processingCanvas.height;
                    snapshot.getContext("2d")?.drawImage(processingCanvas, 0, 0);
                  }
                  setMarkerDetection(detection);
                } catch {
                  markerDetectionRef.current = null;
                  setMarkerDetection(null);
                }
                lastDetectionTime = time;
              }
            }
          }
        }
        if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
          markerDetectionRef.current = null;
          setMarkerDetection(null);
          if (!videoWasUnavailable) {
            // A camera/frame interruption starts acquisition over. A marker
            // miss while frames are flowing does not enter this path.
            markerGeometryPolicyRef.current.reset();
            homographyRef.current = null;
            projectedPianoCornersRef.current = null;
            projectedWhiteKeysRef.current = null;
            displayPianoCornersRef.current = null;
            displayWhiteKeysRef.current = null;
            lastDetectionTime = -Infinity;
            videoWasUnavailable = true;
          }
        }
        animationFrame = requestAnimationFrame(detect);
      }
    };

    MarkerDetector.create()
      .then((createdDetector) => {
        if (cancelled) {
          createdDetector.dispose();
          return;
        }
        detector = createdDetector;
        animationFrame = requestAnimationFrame(detect);
      })
      .catch((error: unknown) => {
        console.error("Unable to initialize ArUco marker detector", error);
        setMarkerDetection(null);
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      detector?.dispose();
    };
  }, [videoRef, stream, cameraReady]);

  useEffect(() => {
    // Effects can observe the previous render's marker result immediately after
    // a camera source changes. Do not project that result into the new source.
    if (markerDetection !== markerDetectionRef.current) return;

    const camera = cameraReady ? cameraSignature(stream, videoRef.current) : null;
    const corners = camera && markerDetection ? markerCorners(markerDetection, camera) : null;
    const saved = loadCalibration();

    // A failed marker scan must leave the last successful marker projection
    // and key state untouched. Only a complete marker result can update the
    // calibration observation below.
    if (!corners) return;

    let homography: Homography | null = null;
    let projectedPianoCorners: Point[] | null = null;
    let projectedWhiteKeys: Point[][] | null = null;
    if (markerDetection?.missingIds.length === 0) {
      const markerCenters = new Map(
        markerDetection.observations.map((observation) => [
          observation.id,
          observation.center,
        ]),
      );
      const markerPoints = [0, 1, 2, 3].map((id) => markerCenters.get(id));
      if (markerPoints.every((point): point is Point => point !== undefined)) {
        homography = computeHomography(PAGE_CORNERS, markerPoints);
      }
      if (homography) {
        const piano = getPianoCorners(layout).map((corner) =>
          projectPoint(homography!, corner),
        );
        const keys = getWhiteKeyPolygons(layout).map((key) =>
          key.map((corner) => projectPoint(homography!, corner)),
        );
        if (
          piano.every((corner): corner is Point => corner !== null) &&
          keys.every((key) => key.every((corner) => corner !== null))
        ) {
          projectedPianoCorners = piano;
          projectedWhiteKeys = keys as Point[][];
        } else {
          homography = null;
        }
      }
    }

    if (homography && projectedPianoCorners && projectedWhiteKeys) {
      const backgroundFrame = markerBackgroundFrameRef.current;
      const backgroundCanvas = shadowBackgroundRef.current;
      if (backgroundFrame && backgroundCanvas) {
        if (backgroundCanvas.width !== backgroundFrame.width)
          backgroundCanvas.width = backgroundFrame.width;
        if (backgroundCanvas.height !== backgroundFrame.height)
          backgroundCanvas.height = backgroundFrame.height;
        backgroundCanvas.getContext("2d")?.drawImage(backgroundFrame, 0, 0);
        queueMicrotask(() => setCapturedBackground({ stream, cameraReady }));
      }
    }

    const valid = onCalibrationObservation(saved, camera, corners);
    if (!valid && !debugShowSheetWithoutCalibration) return;
    if (
      (valid || debugShowSheetWithoutCalibration) &&
      projectedPianoCorners &&
      projectedWhiteKeys
    ) {
      displayPianoCornersRef.current = projectedPianoCorners;
      displayWhiteKeysRef.current = projectedWhiteKeys;
    }
    if (!homography || !projectedPianoCorners || !projectedWhiteKeys) return;

    const geometry = markerGeometryPolicyRef.current.observe({
      homography,
      pianoCorners: projectedPianoCorners,
      whiteKeys: projectedWhiteKeys,
    })!;
    homographyRef.current = geometry.homography;
    projectedPianoCornersRef.current = geometry.pianoCorners;
    projectedWhiteKeysRef.current = geometry.whiteKeys;
  }, [markerDetection, stream, cameraReady, videoRef, onCalibrationObservation, onKeyTransitions, debugShowSheetWithoutCalibration, layout]);

  const processContactFrame = useCallback((
    fingertips: readonly Fingertip[], hands: readonly HandObservation[],
  ) => {
    const inverseHomography = homographyRef.current
      ? invertHomography(homographyRef.current)
      : null;
    const pipeline = pipelineRef.current;
    if (!pipeline) return;
    const video = videoRef.current;
    // Inference invokes this directly; rendering is only a diagnostic consumer.
    const detectionStartedAt = pipelineMetrics.enabled ? performance.now() : null;
    const capturedShadowFrame = pipeline.processFrame({
      video,
      background: shadowBackgroundRef.current,
      fingertips,
      hands,
      whiteKeys: projectedWhiteKeysRef.current,
      calibration: depthCalibration,
      previewFingerId: shadowPreviewFinger?.id ?? null,
    });
    if (detectionStartedAt !== null) {
      pipelineMetrics.record("detection", performance.now() - detectionStartedAt);
    }

    const nextDebug: FingerDebugState[] = [];
    if (showVisualDebug)
      for (const fingertip of fingertips) {
        const hand = hands[fingertip.handIndex];
        const fingerIndex = [4, 8, 12, 16, 20].indexOf(fingertip.landmarkIndex);
        const gate = pipeline.gates.get(fingertip.id);
        if (!hand || fingerIndex < 0 || !gate) continue;
        const shadowObservation = pipeline.observations.get(fingertip.id);
        const shadowContact = pipeline.shadowContacts.get(fingertip.id);
        const synchronousShadow = pipeline.synchronousMeasurements.get(fingertip.id);
        nextDebug.push({
          id: fingertip.id,
          handIndex: fingertip.handIndex,
          finger: DEPTH_FINGERS[fingerIndex],
          state: pipeline.contacts.get(fingertip.id)?.state ?? "unavailable",
          keyOverlap: gate.keyIndexes.length > 0,
          knuckleEligible: gate.knuckleEligible,
          fingertipVideo: fingertip.point,
          fingertipSheet: inverseHomography
            ? projectPoint(inverseHomography, fingertip.point)
            : null,
          fingertipZ: hand.landmarks[fingertip.landmarkIndex]?.z,
          knuckleDistance: CONTACT_TECHNIQUES.knuckles
            ? getKnuckleDistance(hand.landmarks)
            : null,
          knuckles: KNUCKLE_LANDMARK_INDICES.map((index) => ({
            x: hand.landmarks[index]?.x ?? 0,
            y: hand.landmarks[index]?.y ?? 0,
          })),
          shadow: shadowObservation?.state ?? "unknown",
          shadowStrength: shadowObservation?.measurement.shadowStrength ?? null,
          shadowLumaChange: shadowObservation?.lumaChange ?? null,
          shadowDarkArea: shadowObservation?.measurement.darkArea ?? null,
          shadowContourArea: shadowObservation?.contour?.areaPixels ?? null,
          shadowContact: shadowContact?.state ?? "unknown",
          shadowPeakArea: shadowContact?.peakArea ?? null,
          shadowAreaRatio: shadowContact?.areaRatio ?? null,
          synchronousShadow: synchronousShadow ?? null,
        });
      }

    const preview = shadowPreviewCanvasRef.current;
    const previewContext = preview?.getContext("2d");
    if (preview && previewContext && !shadowPreviewFinger)
      previewContext.clearRect(0, 0, preview.width, preview.height);
    const maskCanvas = shadowMaskCanvasRef.current;
    const maskContext = maskCanvas?.getContext("2d");
    if (
      maskCanvas &&
      maskContext &&
      (capturedShadowFrame || !shadowPreviewFinger)
    ) {
      maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    }
    // This state is the intentionally derived data shown in the prototype debug panel.
    if (showVisualDebug) queueMicrotask(() => setFingerDebug(nextDebug));

    // Console logging is intentionally disabled while tuning the visual prototype.
  }, [
    depthCalibration,
    shadowPreviewFinger,
    showVisualDebug,
    videoRef,
  ]);

  useEffect(() => {
    if (!contactFrameRef) return;
    contactFrameRef.current = processContactFrame;
    return () => { contactFrameRef.current = null; };
  }, [contactFrameRef, processContactFrame]);

  useEffect(() => {
    // Preserve standalone overlay use; the live coordinator uses direct input.
    if (!contactFrameRef) processContactFrame(fingertips, hands);
  }, [contactFrameRef, processContactFrame, fingertips, hands]);

  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const video = videoRef.current;
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      if (overlay.width !== video.videoWidth) overlay.width = video.videoWidth;
      if (overlay.height !== video.videoHeight)
        overlay.height = video.videoHeight;
    }

    const context = overlay.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, overlay.width, overlay.height);

    const colors = getComputedStyle(document.documentElement);
    const accent = colors.getPropertyValue("--color-accent").trim();
    const ink = colors.getPropertyValue("--color-ink").trim();
    const danger = colors.getPropertyValue("--color-danger").trim();
    const white = colors.getPropertyValue("--color-white").trim();

    context.lineWidth = 4;
    context.font = "bold 24px Arial";
    context.textBaseline = "bottom";

    if (showVisualDebug)
      markerDetection?.observations.forEach((observation) => {
        context.strokeStyle = "#00ff88";
        context.fillStyle = "#00ff88";
        context.beginPath();
        observation.corners.forEach((corner, index) => {
          if (index === 0) context.moveTo(corner.x, corner.y);
          else context.lineTo(corner.x, corner.y);
        });
        context.closePath();
        context.stroke();
        context.fillText(
          `ID ${observation.id}`,
          observation.center.x + 8,
          observation.center.y,
        );
      });

    const projectedPianoCorners = displayPianoCornersRef.current;
    const projectedWhiteKeys = displayWhiteKeysRef.current;

    if (projectedPianoCorners && projectedWhiteKeys) {
      context.beginPath();
      projectedPianoCorners.forEach((corner, index) => {
        if (index === 0) context.moveTo(corner.x, corner.y);
        else context.lineTo(corner.x, corner.y);
      });
      context.closePath();
      context.fillStyle = white;
      context.globalAlpha = 0.12;
      context.fill();
      context.globalAlpha = 1;
      context.strokeStyle = accent;
      context.lineWidth = 4;
      context.stroke();

      context.lineWidth = 3;
      const collidedKeys = new Set(highlightedKeyIndexes);

      projectedWhiteKeys.forEach((key, index) => {
        const pitch = keyIndexToMidi(index, layout);
        const isPlaying = pitch !== null && activePitches.has(pitch);
        const isPressed = collidedKeys.has(index) || isPlaying;
        context.strokeStyle = isPressed ? danger : ink;
        if (isPressed) pressWhiteKey(context, key, danger);
        else releaseWhiteKey(context, key, white);
      });

      if (
        showVisualDebug &&
        CONTACT_TECHNIQUES.knuckles &&
        depthCalibration &&
        videoRef.current?.videoHeight
      ) {
        fingertips
          .filter(({ landmarkIndex }) =>
            [4, 8, 12, 16, 20].includes(landmarkIndex),
          )
          .forEach((fingertip) => {
            const hand = hands[fingertip.handIndex];
            if (!hand || (hand.handedness !== "Right" && hand.handedness !== "Left"))
              return;
            const handCalibration = getHandDepthCalibration(
              depthCalibration,
              hand.handedness,
            );
            if (!handCalibration) return;
            const keyOverlap =
              getKeyCollisions([fingertip], projectedWhiteKeys, 8).length > 0;
            if (!keyOverlap) return;
            const landmark = hand?.landmarks[fingertip.landmarkIndex];
            const knuckleDistance = hand
              ? getKnuckleDistance(hand.landmarks)
              : null;
            if (!landmark || knuckleDistance === null) return;
            const fingerIndex = [4, 8, 12, 16, 20].indexOf(
              fingertip.landmarkIndex,
            );
            if (fingerIndex < 0) return;
            const finger = DEPTH_FINGERS[fingerIndex];
            const boundaryY = getKnuckleBoundaryY(
              handCalibration,
              finger,
              knuckleDistance,
              true,
            );
            if (boundaryY === null) return;

            const eligibilityY =
              boundaryY -
              KNUCKLE_PLAYING_MARGIN_Y -
              (pipelineRef.current?.gates.get(fingertip.id)?.knuckleEligible
                ? KNUCKLE_ELIGIBILITY_HYSTERESIS_Y
                : 0);
            const screenY = eligibilityY * videoRef.current!.videoHeight;
            const calibrationDistances = Object.values(
              handCalibration.knuckleDistances,
            );
            const outsideRange =
              knuckleDistance < Math.min(...calibrationDistances) ||
              knuckleDistance > Math.max(...calibrationDistances);
            context.save();
            const colors = [
              "#ff9f0a",
              "#ff375f",
              "#bf5af2",
              "#64d2ff",
              "#30d158",
            ];
            const color = colors[fingerIndex];
            context.strokeStyle = color;
            context.fillStyle = color;
            context.lineWidth = 3;
            context.setLineDash([16, 10]);
            context.beginPath();
            context.moveTo(0, screenY);
            context.lineTo(overlay.width, screenY);
            context.stroke();
            context.setLineDash([]);
            context.font = "bold 18px Arial";
            context.fillText(
              `${finger} knuckle eligibility${outsideRange ? " (outside range)" : ""}`,
              12,
              screenY - 8,
            );
            context.restore();
          });
      }

      if (
        showVisualDebug &&
        debugShowZLines &&
        depthCalibration &&
        videoRef.current?.videoHeight
      ) {
        const zLineColors = ["#00aaff", "#ff3b30", "#00c853"];
        fingertips.forEach((fingertip) => {
          const fingerIndex = [4, 8, 12, 16, 20].indexOf(
            fingertip.landmarkIndex,
          );
          if (fingerIndex < 0) return;
          const hand = hands[fingertip.handIndex];
          if (!hand || (hand.handedness !== "Right" && hand.handedness !== "Left"))
            return;
          const handCalibration = getHandDepthCalibration(
            depthCalibration,
            hand.handedness,
          );
          if (!handCalibration) return;
          const landmark = hand.landmarks[fingertip.landmarkIndex];
          const z = landmark?.z;
          if (z === undefined || !Number.isFinite(z)) return;

          const finger = DEPTH_FINGERS[fingerIndex];
          const line = handCalibration.zLines[finger];
          const predictedSheetY = line.slope * z + line.intercept;
          if (!Number.isFinite(predictedSheetY)) return;

          const screenY = predictedSheetY * videoRef.current!.videoHeight;
          context.save();
          const zLineColor = zLineColors[fingerIndex % zLineColors.length];
          context.strokeStyle = zLineColor;
          context.fillStyle = zLineColor;
          context.lineWidth = 2;
          context.setLineDash([6, 6]);
          context.beginPath();
          context.moveTo(0, screenY);
          context.lineTo(overlay.width, screenY);
          context.stroke();
          context.setLineDash([]);
          context.font = "bold 16px Arial";
          context.fillText(
            `${finger} zLine · z=${z.toFixed(4)} · predicted Y=${predictedSheetY.toFixed(4)}`,
            12,
            screenY - 8 - fingerIndex * 18,
          );
          context.restore();
        });
      }
    }
    if (shadowPreviewFinger) {
      drawShadowSamplingGuides(context, shadowPreviewFinger.point);
    }
  }, [
    highlightedKeyIndexes,
    showVisualDebug,
    debugShowZLines,
    depthCalibration,
    fingerDebug,
    fingertips,
    hands,
    markerDetection,
    shadowPreviewFinger,
    videoRef,
    cameraReady,
    stream,
    trackingEnabled,
    activePitches,
    layout
  ]);

  return (
    <>
      <canvas
        ref={overlayCanvasRef}
        width={1920}
        height={1080}
        className="absolute inset-0 z-10 h-full w-full object-cover scale-x-[-1] pointer-events-none"
      />
      <canvas ref={processingCanvasRef} className="hidden" />
      {showVisualDebug && (
        <>
          <canvas
            ref={shadowBackgroundRef}
            width={0}
            height={0}
            className="hidden"
          />
          <canvas ref={shadowDifferenceSourceRef} className="hidden" />
          <canvas ref={shadowMaskSourceRef} className="hidden" />
          <div className="absolute left-4 top-4 rounded bg-black/70 px-3 py-2 text-sm text-white">
            {markerDetection === null
              ? "Loading ArUco detector…"
              : markerDetection.missingIds.length === 0
                ? "All four ArUco boards detected"
                : `Missing IDs: ${markerDetection.missingIds.join(", ")}`}
          </div>
          <div className="absolute right-4 top-4 z-20 max-h-[70vh] max-w-[430px] overflow-auto rounded bg-black/80 px-3 py-2 font-mono text-xs text-white">
            <div className="mb-1 font-bold">Finger debug</div>
            <div className="mb-2">
              Techniques: knuckles {CONTACT_TECHNIQUES.knuckles ? "on" : "off"}{" "}
              · shadows {CONTACT_TECHNIQUES.shadows ? "on" : "off"}{" "}
              · sync shadows {CONTACT_TECHNIQUES.synchronousShadows ? "on" : "off"}{" "}
              · z motion {CONTACT_TECHNIQUES.zMotion ? "on" : "off"}
            </div>
            {!CONTACT_TECHNIQUES.shadows && (
              <label className="mb-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={shadowDiagnosticsOnly}
                  onChange={(event) => {
                    const enabled = event.currentTarget.checked;
                    setShadowDiagnosticsOnly(enabled);
                    if (!enabled) setShadowGapPixels(null);
                  }}
                />
                Shadow image analysis only (does not use shadow to trigger notes)
              </label>
            )}
            {!CONTACT_TECHNIQUES.synchronousShadows && (
              <label className="mb-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={synchronousShadowDiagnosticsOnly}
                  onChange={(event) =>
                    setSynchronousShadowDiagnosticsOnly(event.currentTarget.checked)
                  }
                />
                Synchronous shadow analysis only (same frame, no note events)
              </label>
            )}
            {(CONTACT_TECHNIQUES.shadows || CONTACT_TECHNIQUES.synchronousShadows || shadowDiagnosticsOnly || synchronousShadowDiagnosticsOnly) && (
              <div className="mb-3 border-b border-white/20 pb-2">
                <div className="mb-1 font-bold">
                  Shadow analysis preview
                  {shadowPreviewFinger
                    ? ` (H${shadowPreviewFinger.handIndex})`
                    : ""}
                </div>
                <div className="mb-2" role="status">
                  {shadowWorkerError
                    ? `Mask unavailable: ${shadowWorkerError}`
                    : !shadowPreviewFinger
                      ? "Show your index finger to start the mask."
                      : synchronousShadowDiagnosticsOnly || CONTACT_TECHNIQUES.synchronousShadows
                        ? `Synchronous profile active · ${shadowBackgroundCaptured ? "sheet background ready" : "waiting for a valid marker capture"}`
                        : shadowMaskCount === 0
                        ? "Waiting for the first mask…"
                        : `Mask active · ${shadowMaskCount} frames received`}
                </div>
                <div className="mb-2 flex items-center gap-2">
                  <span>
                    {shadowBackgroundCaptured
                      ? "Background captured with valid marker geometry"
                      : "Waiting for complete markers and a valid homography"}
                  </span>
                </div>
                <div className="mb-2 flex gap-2">
                  <button
                    type="button"
                    aria-pressed={shadowPreviewMode === "mask"}
                    onClick={() => setShadowPreviewMode("mask")}
                    className={`rounded px-2 py-1 ${shadowPreviewMode === "mask" ? "bg-white text-ink" : "bg-surface-dark text-white"}`}
                  >
                    Black / white
                  </button>
                  <button
                    type="button"
                    aria-pressed={shadowPreviewMode === "camera"}
                    onClick={() => setShadowPreviewMode("camera")}
                    className={`rounded px-2 py-1 ${shadowPreviewMode === "camera" ? "bg-white text-ink" : "bg-surface-dark text-white"}`}
                  >
                    Camera
                  </button>
                  <button
                    type="button"
                    aria-pressed={shadowPreviewMode === "difference"}
                    onClick={() => setShadowPreviewMode("difference")}
                    className={`rounded px-2 py-1 ${shadowPreviewMode === "difference" ? "bg-white text-ink" : "bg-surface-dark text-white"}`}
                  >
                    Background delta
                  </button>
                </div>
                <canvas
                  ref={shadowMaskCanvasRef}
                  width={SHADOW_PREVIEW_SIZE}
                  height={SHADOW_PREVIEW_SIZE}
                  aria-label="Black and white mask of the darkest color cluster in the index fingertip crop"
                  className={`${shadowPreviewMode === "mask" ? "block" : "hidden"} h-auto max-w-full bg-surface-dark`}
                />
                <canvas
                  ref={shadowPreviewCanvasRef}
                  width={SHADOW_PREVIEW_SIZE}
                  height={SHADOW_PREVIEW_SIZE}
                  aria-label="Magnified camera view of the index fingertip crop used for k-means"
                  className={`${shadowPreviewMode === "camera" ? "block" : "hidden"} h-auto max-w-full bg-surface-dark`}
                />
                <canvas
                  ref={shadowDifferencePreviewRef}
                  width={SHADOW_PREVIEW_SIZE}
                  height={SHADOW_PREVIEW_SIZE}
                  aria-label="Grayscale pixel difference between the current fingertip crop and the captured empty-sheet background"
                  className={`${shadowPreviewMode === "difference" ? "block" : "hidden"} h-auto max-w-full bg-surface-dark`}
                />
                <canvas
                  ref={shadowLineProfileRef}
                  width={280}
                  height={168}
                  aria-label="RGB class sequences along three fingertip rays: nail-color match, saved paper, and other"
                  className={`${shadowPreviewMode === "camera" ? "block" : "hidden"} mt-1 h-auto max-w-full`}
                />
                <div className="mt-1">
                  {shadowPreviewMode === "mask"
                    ? "Black: darkest color group. White: other groups."
                    : shadowPreviewMode === "difference"
                      ? "Black: little changed from the saved sheet. White: pixels that changed (hand or shadow)."
                      : "Camera crop with RGB ray classes: nail-color match, saved paper, or other."}
                </div>
                {shadowPreviewMode === "difference" && (
                  <div>
                    {shadowBackgroundCaptured
                      ? `Changed pixels: ${shadowDifferenceStats?.changedPixels ?? "waiting"} / ${shadowDifferenceStats?.totalPixels ?? "—"} (difference ≥ 12 luma).`
                      : "Capture an empty-sheet background to enable the difference view."}
                  </div>
                )}
                {shadowPreviewMode === "difference" && (
                  <div>
                    The piano print should mostly disappear. Hand movement,
                    shadow, camera movement, and exposure changes can all appear
                    as differences. The gray arc and colored segments show the
                    same three grouped sample paths as the camera view.
                  </div>
                )}
                {SHOW_EXTRA_SHADOW_DEBUG_OVERLAYS && shadowPreviewMode !== "difference" && <div>
                  Above purple dashed line: ignored. Mask contour: purple when
                  hovering, green when a candidate.
                </div>}
                {SHOW_EXTRA_SHADOW_DEBUG_OVERLAYS && shadowPreviewMode === "camera" && <div>
                  The cross stays centered because the crop follows the tip.
                </div>}
                {SHOW_EXTRA_SHADOW_DEBUG_OVERLAYS && shadowPreviewMode === "camera" && <div>
                  Red gradients: {shadowGradientCounts.nearby} nearby ·{" "}
                  {shadowGradientCounts.belowTip} inside the blue band.
                </div>}
                {SHOW_EXTRA_SHADOW_DEBUG_OVERLAYS && shadowPreviewMode === "camera" && <div>
                  Large pink dot: a red gradient candidate lies within 2 pixels
                  of the purple contour. This marks visual overlap only.
                </div>}
                {SHOW_EXTRA_SHADOW_DEBUG_OVERLAYS && shadowPreviewMode === "camera" && <div>
                  Green arc: smooth path through strong gradients below the blue
                  line · mean edge strength {shadowOutlineGradientScore?.toFixed(0) ?? "n/a"}.
                </div>}
                {SHOW_EXTRA_SHADOW_DEBUG_OVERLAYS && shadowPreviewMode === "camera" && <div>
                  Shadow gap proxy: {shadowGapPixels?.toFixed(1) ?? "n/a"} px.
                </div>}
                {shadowPreviewMode !== "mask" && <div>
                  Each line samples luma and groups it into up to three levels.
                  Red is darkest, blue is middle, and green is brightest. The
                  labels show distinct levels and run lengths in pixels. The
                  gray curve is raw luma; the colored curve is smoothed. Orange
                  marks the valley's left edge in blue, bottom in orange, and
                  sharp-rise point in yellow
                  point. Candidate means an 8–50 luma drop from the local
                  shoulder to the minimum, followed by a rise of at least 20
                  luma/pixel within 6 pixels of the valley bottom. A deeper dip is
                  labeled too deep. This is diagnostic only and does not
                  trigger notes.
                </div>}
                <div className="mt-1 font-bold">
                  Contour area: {shadowPreviewDebug?.shadowContourArea ?? "n/a"}{" "}
                  pixels
                </div>
                <div className="font-bold">
                  Shadow:{" "}
                  {shadowPreviewDebug && !shadowPreviewDebug.keyOverlap
                    ? "outside key"
                    : (shadowPreviewDebug?.shadowContact ?? "unknown")}
                </div>
                <div className="font-bold">
                  Contact:{" "}
                  {shadowPreviewDebug && !shadowPreviewDebug.keyOverlap
                    ? "outside key"
                    : (shadowPreviewDebug?.state ?? "unavailable")}
                </div>
                <div>
                  Peak: {shadowPreviewDebug?.shadowPeakArea ?? "n/a"} pixels ·
                  Ratio:{" "}
                  {shadowPreviewDebug?.shadowAreaRatio == null
                    ? "n/a"
                    : `${(shadowPreviewDebug.shadowAreaRatio * 100).toFixed(1)}%`}
                </div>
                <div>
                  Candidate: ratio ≤{SHADOW_PRESS_AREA_RATIO * 100}% or area
                  &lt;
                  {SHADOW_PRESS_ABSOLUTE_AREA_PIXELS} pixels.
                </div>
                <div>Ink and remaining skin may still appear black.</div>
                <div>
                  Camera view: purple box marks the crop; cross marks the
                  fingertip.
                </div>
              </div>
            )}
            <div className="mb-2 border-b border-white/20 pb-1">
              calibration={depthCalibration ? "ready" : "missing"} mapping=
              {markerDetection?.missingIds.length === 0 ? "ready" : "waiting"}
              <br />
              knuckle TL=
              {depthCalibration?.hands.Right
                ? depthCalibration.hands.Right.knuckleDistances["top-left"].toFixed(5)
                : "n/a"}{" "}
              TR=
              {depthCalibration?.hands.Right
                ? depthCalibration.hands.Right.knuckleDistances["top-right"].toFixed(5)
                : "n/a"}{" "}
              BL=
              {depthCalibration?.hands.Right
                ? depthCalibration.hands.Right.knuckleDistances["bottom-left"].toFixed(5)
                : "n/a"}{" "}
              BR=
              {depthCalibration?.hands.Right
                ? depthCalibration.hands.Right.knuckleDistances["bottom-right"].toFixed(5)
                : "n/a"}{" "}
              C=
              {depthCalibration?.hands.Right
                ? depthCalibration.hands.Right.knuckleDistances.center.toFixed(5)
                : "n/a"}{" "}
              current={fingerDebug[0]?.knuckleDistance?.toFixed(5) ?? "n/a"}
            </div>
            {fingerDebug.length === 0 ? (
              <div>No hand data</div>
            ) : (
              fingerDebug.map((finger) => (
                <div key={finger.id} className="mb-1">
                  H{finger.handIndex} {finger.finger}: state={finger.state}
                  <div>
                    overlap={finger.keyOverlap ? "yes" : "no"} · knuckles=
                    {CONTACT_TECHNIQUES.knuckles
                      ? finger.knuckleEligible
                        ? "yes"
                        : "no"
                      : "disabled"}{" "}
                    · shadow=
                    {CONTACT_TECHNIQUES.shadows
                      ? finger.shadowContact
                      : "disabled"}
                    {" "}· sync shadow={finger.synchronousShadow?.state ?? "unavailable"}
                  </div>
                  {finger.synchronousShadow && (
                    <div>
                      dip={finger.synchronousShadow.rays[0]?.dipDepth?.toFixed(0) ?? "n/a"}
                      · rise={finger.synchronousShadow.rays[0]?.steepestRise?.toFixed(0) ?? "n/a"}/px
                      · bottom→rise={finger.synchronousShadow.rays[0]?.reboundWidth ?? "n/a"}px
                      · background={finger.synchronousShadow.backgroundAvailable
                        ? `${finger.synchronousShadow.changedPixels ?? 0} changed`
                        : "unavailable"}
                    </div>
                  )}
                  {finger.shadowStrength === null
                    ? ""
                    : ` (area ${finger.shadowContourArea ?? "n/a"} px, dark ${((finger.shadowDarkArea ?? 0) * 100).toFixed(0)}%, Δ${
                        finger.shadowLumaChange?.toFixed(1) ?? "n/a"
                      })`}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </>
  );
}
