#pragma once
#include <cstdint>
#include <opencv2/core.hpp>
#include <vector>

namespace makeshift::vision {
struct ShadowMeasurements {
    int width = 0, height = 0;
    std::vector<float> rawDrop, score;
    std::vector<uint8_t> valid;
};
void validateImages(const cv::Mat &current, const cv::Mat &reference);
ShadowMeasurements measureShadows(const cv::Mat &current, const cv::Mat &reference,
                                  const std::vector<uint8_t> &blackRegion);
} // namespace makeshift::vision
