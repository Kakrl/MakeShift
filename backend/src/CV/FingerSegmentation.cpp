#include "FingerSegmentation.hpp"
#include "ShadowMeasurements.hpp"
#include <array>
#include <cmath>
#include <set>
#include <stdexcept>

namespace makeshift::vision {
std::optional<double> normalizedLinearRgbGap(const cv::Vec4b &pixel) {
    static const auto table = [] {
        std::array<double, 256> values{};
        for (size_t i = 0; i < values.size(); ++i) {
            const double c = double(i) / 255;
            values[i] = c <= 0.04045 ? c / 12.92 : std::pow((c + 0.055) / 1.055, 2.4);
        }
        return values;
    }();
    const std::array<double, 3> linear{table[pixel[0]], table[pixel[1]], table[pixel[2]]};
    const double sum = linear[0] + linear[1] + linear[2];
    if (sum == 0)
        return {};
    const std::array<double, 3> normalized{linear[0] / sum, linear[1] / sum, linear[2] / sum};
    return *std::max_element(normalized.begin(), normalized.end()) -
           *std::min_element(normalized.begin(), normalized.end());
}
std::vector<uint8_t> refineFingerMask(const cv::Mat &current, const FingertipEstimate &initial) {
    const int w = current.cols, h = current.rows;
    if (current.type() != CV_8UC4 || current.total() != initial.mask.size())
        throw std::invalid_argument("Invalid refinement image/mask");
    const auto &mask = initial.mask;
    auto grown = mask;
    std::set<int> exterior;
    for (const auto &tip : initial.candidates) {
        const int top = tip.y - constants::refinementHeight;
        if (top < 0 || !mask[top * w + tip.x])
            continue;
        int left = tip.x, right = tip.x;
        while (left > 0 && tip.x - left < tip.width && mask[top * w + left - 1])
            --left;
        while (right < w - 1 && right - tip.x < tip.width && mask[top * w + right + 1])
            ++right;
        if (left == 0 || right == w - 1 || mask[top * w + left - 1] ||
            mask[top * w + right + 1])
            continue;
        // Same connected distal lower/side arc geometry as ShadowPaths; no DFS
        // or shadow classification is needed to recover the boundary itself.
        std::set<int> interior;
        std::vector<int> pending;
        for (int x = left; x <= right; ++x) {
            interior.insert(top * w + x);
            pending.push_back(top * w + x);
        }
        for (size_t k = 0; k < pending.size(); ++k) {
            const int x = pending[k] % w, y = pending[k] / w;
            for (int dy = -1; dy <= 1; ++dy)
                for (int dx = -1; dx <= 1; ++dx) {
                    const int nx = x + dx, ny = y + dy, i = ny * w + nx;
                    if (nx >= left && nx <= right && ny >= top && ny <= tip.y + constants::distalExtension && ny < h &&
                        mask[i] && interior.insert(i).second)
                        pending.push_back(i);
                }
        }
        std::set<int> arc;
        for (int x = left; x <= right; ++x) {
            int bottom = top;
            for (int y = top; y <= std::min(h - 1, tip.y + constants::distalExtension); ++y)
                if (interior.count(y * w + x))
                    bottom = y;
            arc.insert(bottom * w + x);
        }
        for (int y = top; y <= std::min(h - 1, tip.y + constants::distalExtension); ++y) {
            int first = -1, last = -1;
            for (int x = left; x <= right; ++x)
                if (interior.count(y * w + x)) {
                    if (first < 0)
                        first = x;
                    last = x;
                }
            if (first >= 0) {
                arc.insert(y * w + first);
                arc.insert(y * w + last);
            }
        }
        for (const int i : arc) {
            const int x = i % w, y = i / w;
            for (int dy = -1; dy <= 1; ++dy)
                for (int dx = -1; dx <= 1; ++dx) {
                    const int nx = x + dx, ny = y + dy, j = ny * w + nx;
                    if (nx >= 0 && nx < w && ny >= top && ny < h && !mask[j])
                        exterior.insert(j);
                }
        }
    }
    for (const int i : exterior) {
        const auto gap = normalizedLinearRgbGap(current.at<cv::Vec4b>(i / w, i % w));
        if (gap && *gap >= constants::refinementGap) {
            grown[i] = 1;
        }
    }
    return grown;
}
} // namespace makeshift::vision

namespace makeshift::vision {
std::vector<uint8_t> seedFingers(const cv::Mat &current, const cv::Mat &reference,
                                 const std::vector<uint8_t> &black) {
    validateImages(current, reference);
    if (black.size() != current.total())
        throw std::invalid_argument("Black-key mask size mismatch");
    std::vector<uint8_t> mask(current.total());
    for (int y = 0; y < current.rows; ++y) {
        for (int x = 0; x < current.cols; ++x) {
            const auto c = current.at<cv::Vec4b>(y, x), r = reference.at<cv::Vec4b>(y, x);
            const int i = y * current.cols + x;
            mask[i] = rgbDropsAreFinger(std::max(int(r[0]) - c[0], 0),
                                        std::max(int(r[1]) - c[1], 0),
                                        std::max(int(r[2]) - c[2], 0));
            if (black[i])
                mask[i] |= rgbDropsAreFinger(std::max(int(c[0]) - r[0], 0),
                                             std::max(int(c[1]) - r[1], 0),
                                             std::max(int(c[2]) - r[2], 0));
        }
    }
    return mask;
}
} // namespace makeshift::vision
