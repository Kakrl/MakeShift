#pragma once
#include "CrFingerDetection.hpp"
#include "Fingertips.hpp"
#include <string>

namespace makeshift::cvbaseline {
// Provisional display cutoff, also used by optional dark-only DFS.
inline constexpr double consideredShadowMaximumLuma = 110;
struct DiagnosticImage {
    std::string filename, title, explanation;
    cv::Mat pixels;
};
// Rendering only: returns shadow-classes.png and comparison.png.
// Comparison panels retain analysis coordinates; no detector changes or I/O.
std::vector<DiagnosticImage> renderShadowDiagnostics(
    const cv::Mat &sourceBgr, const cv::Mat &referenceBgr, const ShadowDifference &difference,
    const FingertipEstimate &tips, const std::vector<ShadowPaths> &paths,
    double maximumResidual = CandidateFilter{}.maximumResidual, bool darkShadowsOnly = false,
    const std::string &fingerMethod = "projection", double crThreshold = defaultCrFingerThreshold,
    const FingertipEstimate *originalCrTips = nullptr, bool lightShadowTest = false,
    double maximumShadowLuma = consideredShadowMaximumLuma, bool midShadowTest = false,
    const std::string &algorithm = "combined");
} // namespace makeshift::cvbaseline
