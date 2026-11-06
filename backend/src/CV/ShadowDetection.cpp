#include "ShadowDetection.hpp"
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace makeshift::cvbaseline {
void validateFilter(const CandidateFilter &f) {
    if ((f.method != FilterMethod::Projection && f.method != FilterMethod::Color &&
         f.method != FilterMethod::FingerMask) ||
        !std::isfinite(f.maximumColorShift) || f.maximumColorShift < 0 ||
        !std::isfinite(f.maximumResidual) || f.maximumResidual < 0)
        throw std::invalid_argument("Invalid shadow filter");
}
void validateDifference(const ShadowDifference &d) {
    if (d.width < 1 || d.height < 1 || int64_t(d.width) * d.height > 640 * 640)
        throw std::invalid_argument("Analysis must contain 1..640*640 pixels");
    const auto n = size_t(d.width) * d.height;
    if (d.valid.size() != n || d.projectionValid.size() != n || d.lumaDrop.size() != n ||
        d.colorShift.size() != n || d.residualCurrent.size() != n)
        throw std::invalid_argument("Invalid measurement arrays");
}
ShadowDifference measureShadowDifference(const cv::Mat &current, const cv::Mat &reference,
                                         double floor) {
    if (current.empty() || current.type() != CV_8UC4 || reference.type() != CV_8UC4 ||
        current.size() != reference.size() || current.total() > 640 * 640 ||
        !std::isfinite(floor) || floor < 0 || floor > 255)
        throw std::invalid_argument(
            "Expected matching bounded RGBA images and valid reference floor");
    ShadowDifference d;
    d.width = current.cols;
    d.height = current.rows;
    const auto n = current.total();
    const float nan = std::numeric_limits<float>::quiet_NaN();
    d.lumaDrop.resize(n);
    d.colorShift.resize(n);
    d.currentLuma.assign(n, nan);
    d.valid.resize(n);
    d.projectionValid.resize(n);
    d.multiplier.assign(n, nan);
    d.attenuation.assign(n, nan);
    d.residualReference.assign(n, nan);
    d.residualCurrent.assign(n, nan);
    double total = 0;
    for (int y = 0; y < d.height; ++y)
        for (int x = 0; x < d.width; ++x) {
            const auto p = current.at<cv::Vec4b>(y, x), ref = reference.at<cv::Vec4b>(y, x);
            const double r = p[0], g = p[1], b = p[2], rr = ref[0], rg = ref[1], rb = ref[2];
            const double referenceLuma = 0.2126 * rr + 0.7152 * rg + 0.0722 * rb;
            if (!p[3] || !ref[3] || referenceLuma < floor)
                continue;
            const auto i = size_t(y) * d.width + x;
            d.valid[i] = 1;
            ++d.sampledPixels;
            const double currentLuma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            d.currentLuma[i] = float(currentLuma);
            const double drop = referenceLuma - currentLuma;
            d.lumaDrop[i] = float(drop);
            total += std::max(0.0, drop);
            d.maxDarkening = std::max(d.maxDarkening, drop);
            const double sum = r + g + b, referenceSum = rr + rg + rb,
                         squared = rr * rr + rg * rg + rb * rb;
            if (squared > 0) {
                const double a = (r * rr + g * rg + b * rb) / squared;
                const double residual = std::hypot(r - a * rr, g - a * rg, b - a * rb),
                             norm = std::hypot(r, g, b);
                d.multiplier[i] = float(a);
                d.attenuation[i] = float(1 - a);
                d.residualReference[i] = float(residual / std::sqrt(squared));
                d.residualCurrent[i] = norm > 0 ? float(residual / norm) : nan;
                d.projectionValid[i] = sum >= 15 && referenceSum >= 15;
            }
            d.colorShift[i] = sum < 15 || referenceSum < 15
                                  ? nan
                                  : float(255 * std::max({std::abs(r / sum - rr / referenceSum),
                                                          std::abs(g / sum - rg / referenceSum),
                                                          std::abs(b / sum - rb / referenceSum)}));
        }
    d.meanDarkening = d.sampledPixels ? total / d.sampledPixels : 0;
    return d;
}
std::vector<uint8_t> filteredDarkeningBoundaryMask(const ShadowDifference &d, CandidateFilter f) {
    validateDifference(d);
    validateFilter(f);
    if (f.method == FilterMethod::FingerMask)
        throw std::invalid_argument(
            "FingerMask shadow mode requires an independently supplied finger mask");
    std::vector<uint8_t> mask(d.valid.size());
    for (size_t i = 0; i < mask.size(); ++i) {
        const double mismatch =
            f.method == FilterMethod::Color ? d.colorShift[i] : d.residualCurrent[i];
        mask[i] =
            d.valid[i] && std::isfinite(d.lumaDrop[i]) && d.lumaDrop[i] > 5 &&
            std::isfinite(mismatch) &&
            (f.method != FilterMethod::Projection || d.projectionValid[i]) &&
            mismatch > (f.method == FilterMethod::Color ? f.maximumColorShift : f.maximumResidual);
    }
    return mask;
}
ShadowPixelState classifyShadowPixel(const ShadowDifference &d, const std::vector<uint8_t> &mask,
                                     size_t i, double threshold, CandidateFilter filter,
                                     std::optional<double> maximumCurrentLuma) {
    if (mask[i])
        return ShadowPixelState::Clear;
    if (!d.valid[i] || !std::isfinite(d.lumaDrop[i]))
        return ShadowPixelState::Unknown;
    double mismatch = 0, maximumMismatch = 0;
    if (filter.method != FilterMethod::FingerMask) {
        mismatch = filter.method == FilterMethod::Color ? d.colorShift[i] : d.residualCurrent[i];
        maximumMismatch = filter.method == FilterMethod::Color ? filter.maximumColorShift
                                                               : filter.maximumResidual;
        if (!std::isfinite(mismatch) ||
            (filter.method == FilterMethod::Projection && !d.projectionValid[i]))
            return ShadowPixelState::Unknown;
    }
    if (maximumCurrentLuma) {
        if (!std::isfinite(d.currentLuma[i]))
            return ShadowPixelState::Unknown;
        if (d.currentLuma[i] > *maximumCurrentLuma)
            return ShadowPixelState::Clear;
    }
    return d.lumaDrop[i] > threshold && mismatch <= maximumMismatch ? ShadowPixelState::Shadow
                                                                    : ShadowPixelState::Clear;
}
} // namespace makeshift::cvbaseline
