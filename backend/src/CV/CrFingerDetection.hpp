#pragma once
#include "Fingertips.hpp"

namespace makeshift::cvbaseline {
inline constexpr double defaultCrFingerThreshold = 13;
// Temporary experiment: classify fingers solely by absolute Cr change in
// 0..255-equivalent units. No Y/darkening, projection or reference-luma gate.
// Requires matched bounded RGBA; alpha=0 is unavailable and never a finger.
std::vector<uint8_t> crChangeFingerMask(const cv::Mat &currentRgba, const cv::Mat &referenceRgba,
                                        double minimumChange = defaultCrFingerThreshold);
FingertipEstimate identifyCrChangeFingertips(const cv::Mat &currentRgba,
                                             const cv::Mat &referenceRgba,
                                             double minimumChange = defaultCrFingerThreshold,
                                             FingertipOptions options = {});
inline constexpr int defaultCrOtsuRadius = 2;
struct CrOtsuRegion {
    int candidateId, x, y, width, height, threshold, addedPixels;
};
struct CrOtsuResult {
    FingertipEstimate original, refined;
    std::vector<CrOtsuRegion> regions;
};
// Local Otsu on unamplified Cr change. Add connected pixels only within radius
// 1..2 (Euclidean analysis pixels) of the ORIGINAL distal fingertip mask.
CrOtsuResult refineCrFingertipsWithOtsu(const cv::Mat &currentRgba, const cv::Mat &referenceRgba,
                                        double minimumChange = defaultCrFingerThreshold,
                                        int radius = defaultCrOtsuRadius,
                                        FingertipOptions options = {});
} // namespace makeshift::cvbaseline
