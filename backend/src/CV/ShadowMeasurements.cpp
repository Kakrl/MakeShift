#include "ShadowMeasurements.hpp"
#include "Constants.hpp"
#include <algorithm>
#include <stdexcept>

namespace makeshift::vision {
void validateImages(const cv::Mat &current, const cv::Mat &reference) {
    if (current.empty() || current.type() != CV_8UC4 || reference.type() != CV_8UC4 ||
        current.size() != reference.size() || current.cols > constants::analysisSide ||
        current.rows > constants::analysisSide)
        throw std::invalid_argument("Expected matching RGBA analysis images, at most 640 per side");
}
ShadowMeasurements measureShadows(const cv::Mat &current, const cv::Mat &reference,
                                   const std::vector<uint8_t> &black) {
    validateImages(current, reference);
    if (black.size() != current.total())
        throw std::invalid_argument("Black-key mask size mismatch");
    ShadowMeasurements out;
    out.width = current.cols;
    out.height = current.rows;
    out.rawDrop.resize(current.total());
    out.score.resize(current.total());
    out.valid.resize(current.total());
    for (int y = 0; y < current.rows; ++y) {
        for (int x = 0; x < current.cols; ++x) {
            const auto c = current.at<cv::Vec4b>(y, x), r = reference.at<cv::Vec4b>(y, x);
            const int i = y * current.cols + x;
            const auto luma = [&](const cv::Vec4b &p) {
                // Preserve the selected native arithmetic: white encoded luma,
                // integer-weight black luma for exact low-reference equalities.
                return black[i] ? (2126 * p[0] + 7152 * p[1] + 722 * p[2]) / 10000.0 :
                                  0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
            };
            const double yr = luma(r), raw = yr - luma(c);
            out.rawDrop[i] = float(raw);
            out.valid[i] = c[3] && r[3] &&
                yr >= (black[i] ? constants::blackReferenceFloor : constants::whiteReferenceFloor);
            if (!out.valid[i])
                continue;
            if (!black[i]) {
                out.score[i] = float(raw);
                continue;
            }
            // Horizontal inset only; never erode the top/bottom support rows.
            bool interior = true;
            for (int dx = -constants::blackSideInset; dx <= constants::blackSideInset; ++dx)
                interior &= x + dx >= 0 && x + dx < current.cols && black[i + dx];
            if (interior && raw > constants::clearFloor)
                out.score[i] = float(100 * std::clamp(raw / yr, 0.0, 1.0));
        }
    }
    return out;
}
} // namespace makeshift::vision
