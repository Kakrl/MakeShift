#include "CrFingerDetection.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>

namespace makeshift::cvbaseline {
namespace {
double crDifference(const cv::Vec4b &p, const cv::Vec4b &ref) {
    const auto cr = [](const cv::Vec4b &rgb) {
        const double Y = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
        return (rgb[0] - Y) * 0.713;
    };
    return std::abs(cr(p) - cr(ref));
}
int otsuThreshold(const std::array<int, 256> &histogram) {
    int total = 0, leftCount = 0;
    double sum = 0, leftSum = 0, best = 0;
    int threshold = -1;
    for (int i = 0; i < 256; ++i) {
        total += histogram[i];
        sum += i * histogram[i];
    }
    for (int i = 0; i < 255; ++i) {
        leftCount += histogram[i];
        leftSum += i * histogram[i];
        const int rightCount = total - leftCount;
        if (!leftCount || !rightCount)
            continue;
        const double delta = leftSum / leftCount - (sum - leftSum) / rightCount;
        const double variance = double(leftCount) * rightCount * delta * delta;
        if (variance > best) {
            best = variance;
            threshold = i;
        }
    }
    return threshold; // No split for a constant/empty patch.
}
} // namespace
std::vector<uint8_t> crChangeFingerMask(const cv::Mat &current, const cv::Mat &reference,
                                        double minimumChange) {
    if (current.empty() || current.type() != CV_8UC4 || reference.type() != CV_8UC4 ||
        current.size() != reference.size() || current.total() > 640 * 640 ||
        !std::isfinite(minimumChange) || minimumChange < 0 || minimumChange > 255)
        throw std::invalid_argument("Expected matched bounded RGBA and Cr threshold 0..255");
    std::vector<uint8_t> mask(current.total());
    for (int y = 0; y < current.rows; ++y)
        for (int x = 0; x < current.cols; ++x) {
            const auto p = current.at<cv::Vec4b>(y, x), ref = reference.at<cv::Vec4b>(y, x);
            if (!p[3] || !ref[3])
                continue;
            // OpenCV YCrCb coefficients, in byte-equivalent units. The Cr
            // offset cancels in the difference. Y is only part of defining Cr;
            // no separate condition is applied to Y or to brightness change.
            mask[size_t(y) * current.cols + x] = crDifference(p, ref) > minimumChange;
        }
    return mask;
}
FingertipEstimate identifyCrChangeFingertips(const cv::Mat &current, const cv::Mat &reference,
                                             double minimumChange, FingertipOptions options) {
    return identifyFingertipsFromMask(
        current.cols, current.rows, crChangeFingerMask(current, reference, minimumChange), options);
}
CrOtsuResult refineCrFingertipsWithOtsu(const cv::Mat &current, const cv::Mat &reference,
                                        double minimumChange, int radius,
                                        FingertipOptions options) {
    if (radius < 1 || radius > 2)
        throw std::invalid_argument("Otsu fingertip expansion must be 1 or 2 analysis pixels");
    CrOtsuResult result;
    result.original = identifyCrChangeFingertips(current, reference, minimumChange, options);
    auto mask = result.original.mask;
    const int w = current.cols, h = current.rows;
    const ShadowPathSettings geometry;
    for (const auto &tip : result.original.candidates) {
        // Histogram includes an interior strip and surrounding background.
        // Expansion is restricted to the distal c rows used for the tip arc.
        const int halfWidth = (tip.width + 1) / 2;
        const int left = std::max(0, tip.x - halfWidth - radius);
        const int right = std::min(w - 1, tip.x + halfWidth + radius);
        const int top = std::max(0, tip.y - geometry.c - geometry.e);
        const int bottom = std::min(h - 1, tip.y + radius);
        const int patchW = right - left + 1, patchH = bottom - top + 1;
        std::vector<int> values(size_t(patchW) * patchH, -1);
        std::array<int, 256> histogram{};
        for (int y = top; y <= bottom; ++y)
            for (int x = left; x <= right; ++x) {
                const auto p = current.at<cv::Vec4b>(y, x), ref = reference.at<cv::Vec4b>(y, x);
                if (!p[3] || !ref[3])
                    continue;
                const int value = cv::saturate_cast<uint8_t>(crDifference(p, ref));
                values[(y - top) * patchW + x - left] = value;
                ++histogram[value];
            }
        const int threshold = otsuThreshold(histogram);
        CrOtsuRegion region{tip.id, left, top, patchW, patchH, threshold, 0};
        if (threshold >= 0) {
            std::vector<uint8_t> allowed(values.size()), visited(values.size());
            std::vector<int> queue;
            for (int y = top; y <= bottom; ++y)
                for (int x = left; x <= right; ++x) {
                    const int local = (y - top) * patchW + x - left;
                    if (result.original.mask[y * w + x]) {
                        queue.push_back(local);
                        visited[local] = 1;
                        continue;
                    }
                    if (values[local] <= threshold)
                        continue;
                    for (int dy = -radius; dy <= radius; ++dy)
                        for (int dx = -radius; dx <= radius; ++dx) {
                            const int nx = x + dx, ny = y + dy;
                            if (dx * dx + dy * dy <= radius * radius && nx >= 0 && nx < w &&
                                ny >= std::max(0, tip.y - geometry.c) && ny <= tip.y &&
                                result.original.mask[ny * w + nx])
                                allowed[local] = 1;
                        }
                }
            for (size_t head = 0; head < queue.size(); ++head) {
                const int local = queue[head], x = local % patchW, y = local / patchW;
                for (int dy = -1; dy <= 1; ++dy)
                    for (int dx = -1; dx <= 1; ++dx) {
                        const int nx = x + dx, ny = y + dy, next = ny * patchW + nx;
                        if (nx < 0 || nx >= patchW || ny < 0 || ny >= patchH || visited[next] ||
                            !allowed[next])
                            continue;
                        visited[next] = 1;
                        queue.push_back(next);
                        mask[(top + ny) * w + left + nx] = 1;
                        ++region.addedPixels;
                    }
            }
        }
        result.regions.push_back(region);
    }
    result.refined = identifyFingertipsFromMask(w, h, std::move(mask), options);
    return result;
}
} // namespace makeshift::cvbaseline
