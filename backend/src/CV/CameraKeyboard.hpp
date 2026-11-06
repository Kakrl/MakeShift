#pragma once
#include "Homography.hpp"
#include <opencv2/core.hpp>
#include <string>
#include <vector>

namespace makeshift::cvbaseline {
struct CameraKeyboard {
    Homography frameToSheet;
    std::array<Point, 4> markerCenters;
    int octaves = 1;
    int keyAt(Point nativePoint) const;
    std::vector<std::vector<cv::Point>> polygons(double scaleX, double scaleY) const;
    std::string label(int keyIndex) const;
};
// Detect the four printed marker centers on the same native frame as reference capture.
// No per-frame tracking: sheet/camera must stay fixed until the next capture.
std::optional<CameraKeyboard> acquireCameraKeyboard(const cv::Mat &nativeBgr, int octaves);
} // namespace makeshift::cvbaseline
