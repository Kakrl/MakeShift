#include "ShadowView.hpp"
#include "Constants.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>

namespace makeshift::vision {
cv::Mat renderShadowClasses(const FrameResult &frame) {
    const auto &d = frame.shadows;
    const auto n = size_t(std::max(0, d.width)) * std::max(0, d.height);
    if (!frame.ready || !n || n > constants::maximumPixels || frame.fingerMask.size() != n ||
        d.valid.size() != n || d.score.size() != n)
        throw std::invalid_argument("Expected ready frame with matching shadow arrays");
    // BGR palette is display-only; algorithm thresholds live in Constants.hpp.
    static const std::array<cv::Vec3b, 8> colors{{{255, 255, 255},
                                                  {230, 150, 90},
                                                  {220, 210, 30},
                                                  {70, 190, 70},
                                                  {30, 225, 245},
                                                  {20, 140, 250},
                                                  {25, 40, 225},
                                                  {15, 15, 130}}};
    cv::Mat image(d.height, d.width, CV_8UC3, cv::Scalar(0, 0, 0));
    for (int y = 0; y < d.height; ++y) {
        for (int x = 0; x < d.width; ++x) {
            const int i = y * d.width + x;
            if (frame.fingerMask[i])
                image.at<cv::Vec3b>(y, x) = {100, 0, 0};
            else if (d.valid[i] && std::isfinite(d.score[i])) {
                const auto bin = std::lower_bound(constants::classCutoffs.begin(),
                                                  constants::classCutoffs.end(), d.score[i]) -
                                 constants::classCutoffs.begin();
                image.at<cv::Vec3b>(y, x) = colors[bin];
            }
        }
    }
    return image;
}
} // namespace makeshift::vision
