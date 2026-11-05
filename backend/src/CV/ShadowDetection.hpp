#pragma once
#include <array>
#include <cstdint>
#include <opencv2/core.hpp>
#include <optional>
#include <vector>

namespace makeshift::cvbaseline {
enum class FilterMethod { Projection, Color };
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
    int c = 4, d = 4, e = 4;
    std::optional<int> searchWidth;
    std::optional<double> downwardThreshold;
    std::optional<int> corridorRadius = 9;
    int minimumUpwardShadowWidth = 3;
};
struct ShadowPaths {
    int aY = 0, downwardY = 0, upwardY = 0;
    bool crossSectionComplete = false;
    std::vector<Pixel> arc, edgeSamples;
    std::optional<int> corridorMinimumX, corridorMaximumX;
    std::array<ShadowLevel, 4> levels;
};
inline constexpr std::array<int, 4> shadowCutoffs{5, 20, 40, 60};
ShadowPaths measureMonotoneShadowPaths(const ShadowDifference &difference,
                                       const std::vector<uint8_t> &mask, const Fingertip &tip,
                                       CandidateFilter filter = {},
                                       ShadowPathSettings settings = {});
} // namespace makeshift::cvbaseline
