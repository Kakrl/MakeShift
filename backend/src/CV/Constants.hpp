#pragma once
#include <array>
#include <cstddef>

namespace makeshift::vision::constants {
// Analysis pixels unless a physical unit is included in the name.
inline constexpr int analysisSide = 640;
inline constexpr int maximumWasmFrameSide = 4096;
inline constexpr std::size_t maximumPixels = analysisSide * analysisSide;
inline constexpr int referenceRefreshSeconds = 10;
inline constexpr int cameraWidth = 1280, cameraHeight = 720, cameraFps = 30;
inline constexpr int minimumOctaves = 1, maximumOctaves = 3;
inline constexpr int whiteKeysPerOctave = 7;
inline constexpr double whitePitchMm = 23.5, blackWidthMm = 13.7;
inline constexpr double whiteLengthMm = 150;
inline constexpr double pressMatchKeyFraction = 0.25;
inline constexpr double pressMatchRadiusMm = whitePitchMm * pressMatchKeyFraction;
inline constexpr int pressRangeSegments = 48;
inline constexpr double markerInsetMm = 188.0 / 1.1 * 0.05;
inline constexpr double keyTop = 0.1, keyBottom = 0.9, blackBottom = 0.58;
inline constexpr std::array<int, 5> blackBoundaries{1, 2, 4, 5, 6};
inline constexpr double minimumMarkerArea = 400, numericalEpsilon = 1e-10;
inline constexpr double markerDiagonalEpsilon = 1e-6;
inline constexpr int rgbSpread = 30, rgbLowChannel = 15;
inline constexpr int refinementHeight = 8, distalExtension = 6;
inline constexpr double refinementGap = 0.25;
inline constexpr int minimumComponentArea = 80, minimumComponentHeight = 16;
inline constexpr int minimumTipSeparation = 12, maximumFingerWidth = 44, minimumFingerWidth = 5;
inline constexpr int shaftHeight = 8, medianRadius = 2, maximumCandidates = 20;
inline constexpr double minimumProminence = 2, separationWidthFraction = 0.85;
inline constexpr double whiteReferenceFloor = 40, blackReferenceFloor = 5;
inline constexpr double clearFloor = 5, cyanFloor = 20, greenFloor = 40, darkFloor = 60;
inline constexpr std::array<double, 7> classCutoffs{5, 20, 40, 60, 70, 85, 95};
inline constexpr int blackSideInset = 1;
inline constexpr int crossSectionHeight = 4, supportExtension = 4, forwardVeto = 2;
inline constexpr int corridorMargin = 9, supportWidth = 2;
inline constexpr int lightFrontDepth = 2, minimumFrontStrip = 2, minimumBlobArea = 6;
inline constexpr double blobAreaFraction = 0.04, sideReachFraction = 0.5;
inline constexpr int minimumLightReach = 2, lightForwardExtent = 4;
inline constexpr int midFrontDepth = 4, midMaximumOnset = 3, midRise = 6;
inline constexpr int midOpeningWidth = 2;
inline constexpr int midMinimumGrowth = 3, midMinimumReach = 4, midFrontNearTip = 1;
inline constexpr int midFrontWidthDivisor = 4, midMaximumBandThickness = 1;
inline constexpr double midMinimumSlope = 0.5, midEdgeStepFraction = 0.15;
inline constexpr int midMinimumEdgeStep = 2;
} // namespace makeshift::vision::constants
