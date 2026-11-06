#pragma once
#include "ShadowDiagnostics.hpp"

namespace makeshift::cvbaseline {
struct ColorDiagnostics {
    std::vector<DiagnosticImage> images;
    std::vector<DiagnosticImage> changes;
};
// Display-only conversions of current and reference separately. Fixed scales;
// never reinterpret transformed component triplets as RGB display colors.
ColorDiagnostics renderColorDiagnostics(const cv::Mat &currentBgr, const cv::Mat &referenceBgr);
} // namespace makeshift::cvbaseline
