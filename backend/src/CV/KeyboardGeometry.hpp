#pragma once
#include "Homography.hpp"
#include <cstdint>
#include <opencv2/core.hpp>
#include <vector>

namespace makeshift::vision {
struct KeyboardGeometry {
    Homography frameToSheet;
    std::array<Point, 4> markerCenters{};
    int octaves = 1;
    // Native camera coordinates; inclusive playable-key footprint, not marker margins.
    bool withinHomography(Point nativePoint) const;
    bool withinPressRange(Point nativePoint, Point nativeAnchor) const;
    std::vector<cv::Point> pressRangeOutline(Point nativeAnchor, double scaleX, double scaleY) const;
    int keyAt(Point nativePoint) const; // White-strip eligibility only, not MIDI pitch.
    std::vector<std::vector<cv::Point>> polygons(double scaleX, double scaleY) const;
};
std::vector<uint8_t> projectBlackKeys(const KeyboardGeometry &geometry, cv::Size nativeSize,
                                     cv::Size analysisSize);
} // namespace makeshift::vision
