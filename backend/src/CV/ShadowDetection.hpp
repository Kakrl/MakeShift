#pragma once
#include <array>
#include <cstdint>
#include <opencv2/core.hpp>
#include <optional>
#include <string>
#include <vector>

namespace makeshift::cvbaseline {
enum class FilterMethod { Projection, Color, FingerMask };
struct CandidateFilter {
    FilterMethod method = FilterMethod::Projection;
    double maximumColorShift = 10, maximumResidual = 0.125;
};
// Float32 storage intentionally matches frontend typed-array rounding.
struct ShadowDifference {
    int width = 0, height = 0;
    std::vector<float> lumaDrop, colorShift, multiplier, attenuation, residualReference,
        residualCurrent, currentLuma;
    std::vector<uint8_t> valid, projectionValid;
    int sampledPixels = 0;
    double maxDarkening = 0, meanDarkening = 0;
};
enum class ShadowPixelState { Unknown, Clear, Shadow };
// Shared pixel classification for DFS and diagnostics. Callers validate array
// sizes/settings once; FingerMask mode uses no projection/color exclusion.
ShadowPixelState classifyShadowPixel(const ShadowDifference &difference,
                                     const std::vector<uint8_t> &fingerMask, size_t index,
                                     double threshold, CandidateFilter filter = {},
                                     std::optional<double> maximumCurrentLuma = {});
// Inputs: coordinate-matched CV_8UC4 RGBA, alpha=0 means unavailable.
// Throws invalid_argument on invalid dimensions/types/settings; no resizing/I/O.
ShadowDifference measureShadowDifference(const cv::Mat &currentRgba, const cv::Mat &referenceRgba,
                                         double minimumReferenceLuma = 40);
void validateDifference(const ShadowDifference &difference);
void validateFilter(const CandidateFilter &filter);
std::vector<uint8_t> filteredDarkeningBoundaryMask(const ShadowDifference &difference,
                                                   CandidateFilter filter = {});
struct Fingertip;
struct Pixel {
    int x = 0, y = 0;
};
struct WidthWitness {
    int left = 0, right = 0, y = 0, width = 0;
};
struct ShadowSearch {
    Pixel seed;
    bool reached = false, targetReached = false, unavailable = false, ignored = false;
    bool hitWidthLimit = false, hitCorridorLimit = false;
    std::optional<WidthWitness> widthWitness;
    std::vector<Pixel> path;
};
struct ShadowLevel {
    int threshold = 0;
    bool downwardVeto = false, upwardReached = false, downwardUnknown = false,
         upwardUnknown = false;
    std::optional<bool> patternMatch;
    std::vector<ShadowSearch> downwardSearches, upwardSearches;
    std::vector<Pixel> ignoredSeeds;
};
struct ShadowPathSettings {
    std::optional<double> maximumCurrentLuma; // No brightness restriction by default.
    int c = 4, d = 2, e = 4;
    std::optional<int> searchWidth;
    std::optional<double> downwardThreshold;
    std::optional<int> corridorRadius = 9;
    int minimumUpwardShadowWidth = 2;
};
inline constexpr int defaultLightShadowMinimumStrip = 2;
// Shared brightness classes; mid side scans include brown and darker.
inline constexpr double middleShadowMinimumDrop = 40;
inline constexpr double faintShadowMaximumDrop = 20;
struct MidShadowRow {
    Pixel fingerEdge, endpoint;
    int upwardDistance = 0, visibleWidth = 0;
    bool fingerOccluded = false, maskMerged = false, scanLimit = false;
};
struct MidShadowEvidence {
    bool evaluated = false, matched = false;
    std::string reason = "disabled";
    int frontDepth = 4, minimumStrip = 2, maximumOnset = 3, rise = 6;
    int minimumGrowth = 3, maximumForward = 2, minimumBlobArea = 0, maximumEdgeStep = 0;
    int direction = 0, onset = -1, growth = 0;
    double slope = 0;
    bool usedOcclusion = false, shapeAcceptedByOcclusion = false;
    std::vector<MidShadowRow> rows;
    std::vector<Pixel> frontStrip, frontBand, boundary, fingerEdge, mass;
};
struct LightShadowEvidence {
    bool evaluated = false, matched = false;
    int minimumStrip = 0, bandDepth = 2, minimumBlobArea = 0;
    std::string reason = "disabled";
    std::vector<Pixel> front, clearStrip, clearBand, leftShadow, rightShadow;
};
enum class ShadowAlgorithm { Combined, Dark, Light, Mid };
struct ShadowPaths {
    ShadowAlgorithm algorithm = ShadowAlgorithm::Combined;
    MidShadowEvidence mid;
    LightShadowEvidence light;
    int aY = 0, downwardY = 0, upwardY = 0;
    bool crossSectionComplete = false;
    std::vector<Pixel> arc, edgeSamples;
    std::optional<int> corridorMinimumX, corridorMaximumX;
    std::array<ShadowLevel, 4> levels;
};
// Native experiment: retains the original dark decisions in levels.
// independent=true measures light even when dark matches.
LightShadowEvidence measureLightShadow(const ShadowDifference &difference,
                                       const std::vector<uint8_t> &mask, const Fingertip &tip,
                                       const ShadowPaths &paths, bool independent = false);
inline std::optional<bool> finalShadowDecision(const ShadowPaths &paths) {
    if (paths.algorithm == ShadowAlgorithm::Dark)
        return paths.levels[1].patternMatch;
    if (paths.algorithm == ShadowAlgorithm::Light)
        return !paths.light.evaluated || paths.light.reason == "incomplete-front" ||
                       paths.light.reason == "no-clear-strip-unavailable-samples"
                   ? std::nullopt
                   : std::optional<bool>(paths.light.matched);
    if (paths.algorithm == ShadowAlgorithm::Mid)
        return !paths.mid.evaluated || paths.mid.reason == "incomplete-front"
                   ? std::nullopt
                   : std::optional<bool>(paths.mid.matched);
    return (paths.light.matched || paths.mid.matched) ? std::optional<bool>(true)
                                                      : paths.levels[1].patternMatch;
}
inline constexpr std::array<int, 4> shadowCutoffs{5, 20, 40, 60};
ShadowPaths measureMonotoneShadowPaths(const ShadowDifference &difference,
                                       const std::vector<uint8_t> &mask, const Fingertip &tip,
                                       CandidateFilter filter = {},
                                       ShadowPathSettings settings = {});
} // namespace makeshift::cvbaseline
