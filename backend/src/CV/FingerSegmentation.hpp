#pragma once
#include "Constants.hpp"
#include "Fingertips.hpp"
#include <algorithm>
#include <opencv2/core.hpp>
#include <optional>

namespace makeshift::vision {
inline bool rgbDropsAreFinger(int r, int g, int b) {
    return std::max({r, g, b}) - std::min({r, g, b}) >= constants::rgbSpread &&
           int(r < constants::rgbLowChannel) + int(g < constants::rgbLowChannel) +
                   int(b < constants::rgbLowChannel) <
               2;
}
std::vector<uint8_t> seedFingers(const cv::Mat &current, const cv::Mat &reference,
                                 const std::vector<uint8_t> &blackRegion);
// One frozen exterior ring; does not recursively grow newly added pixels.
std::vector<uint8_t> refineFingerMask(const cv::Mat &current, const FingertipEstimate &initial);
std::optional<double> normalizedLinearRgbGap(const cv::Vec4b &pixel);
} // namespace makeshift::vision
