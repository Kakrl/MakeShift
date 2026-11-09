#include "ShadowDiagnostics.hpp"
#include "ColorDiagnostics.hpp"
#include <algorithm>
#include <cmath>
#include <opencv2/imgproc.hpp>
#include <stdexcept>

namespace makeshift::cvbaseline {
namespace {
const cv::Scalar background(24, 24, 24), text(240, 240, 240), unknown(128, 128, 128);
const cv::Scalar downward(0, 0, 240), match(0, 210, 0);
cv::Scalar decisionColor(const std::optional<bool> &decision) {
    return !decision ? unknown : *decision ? match : downward;
}
cv::Mat label(const cv::Mat &image, const std::string &title, const std::string &explanation) {
    cv::Mat panel(image.rows + 64, image.cols, CV_8UC3, background);
    image.copyTo(panel(cv::Rect(0, 64, image.cols, image.rows)));
    cv::putText(panel, title, {10, 23}, cv::FONT_HERSHEY_SIMPLEX, 0.52, text, 1, cv::LINE_AA);
    cv::putText(panel, explanation, {10, 47}, cv::FONT_HERSHEY_SIMPLEX, 0.37, text, 1, cv::LINE_AA);
    return panel;
}
cv::Mat mosaic(const std::vector<cv::Mat> &images, int columns) {
    const auto size = images.front().size();
    cv::Mat result(size.height * int((images.size() + columns - 1) / columns), size.width * columns,
                   CV_8UC3, background);
    for (size_t i = 0; i < images.size(); ++i)
        images[i].copyTo(result(cv::Rect(int(i % columns) * size.width,
                                         int(i / columns) * size.height, size.width, size.height)));
    return result;
}
cv::Mat heatmap(const ShadowDifference &d, const std::vector<float> &field, double floor,
                double fullScale, bool projection, bool shadowOnly = false,
                double maximumResidual = 0.12) {
    cv::Mat gray(d.height, d.width, CV_8UC1);
    for (int y = 0; y < d.height; ++y)
        for (int x = 0; x < d.width; ++x) {
            const int i = y * d.width + x;
            const double value =
                !std::isfinite(field[i]) || (shadowOnly && d.residualCurrent[i] > maximumResidual)
                    ? floor
                    : field[i];
            gray.at<uint8_t>(y, x) = cv::saturate_cast<uint8_t>(
                255 * std::clamp((value - floor) / (fullScale - floor), 0.0, 1.0));
        }
    cv::Mat colors;
    cv::applyColorMap(gray, colors, cv::COLORMAP_TURBO);
    for (int y = 0; y < d.height; ++y)
        for (int x = 0; x < d.width; ++x) {
            const int i = y * d.width + x;
            if (!d.valid[i] || !std::isfinite(field[i]) ||
                (projection && (!d.projectionValid[i] || !std::isfinite(d.residualCurrent[i]))))
                colors.at<cv::Vec3b>(y, x) = {128, 128, 128};
            else if (gray.at<uint8_t>(y, x) == 0 ||
                     (shadowOnly && d.residualCurrent[i] > maximumResidual))
                colors.at<cv::Vec3b>(y, x) = {0, 0, 0};
        }
    return colors;
}
cv::Mat candidates(const cv::Mat &source, const FingertipEstimate &tips,
                   const std::vector<ShadowPaths> &paths) {
    auto result = source.clone();
    for (size_t i = 0; i < tips.candidates.size(); ++i) {
        const auto &tip = tips.candidates[i];
        const auto decision = finalShadowDecision(paths[i]);
        const auto color = decisionColor(decision);
        cv::circle(result, {tip.x, tip.y}, 4, color, 1);
        cv::putText(result,
                    std::to_string(tip.id) + ":" +
                        (!decision   ? "?"
                         : *decision ? "match"
                                     : "no"),
                    {tip.x + 5, tip.y}, cv::FONT_HERSHEY_SIMPLEX, 0.35, color, 1, cv::LINE_AA);
    }
    return result;
}
cv::Mat maskedShadowHeatmap(const ShadowDifference &d, const FingertipEstimate &tips,
                            CandidateFilter filter, double threshold = 5,
                            std::optional<double> maximumLuma = {}) {
    auto image = heatmap(d, d.lumaDrop, 5, 100, false);
    for (int y = 0; y < d.height; ++y)
        for (int x = 0; x < d.width; ++x) {
            const int i = y * d.width + x;
            auto &pixel = image.at<cv::Vec3b>(y, x);
            const auto state = classifyShadowPixel(d, tips.mask, i, threshold, filter, maximumLuma);
            if (state == ShadowPixelState::Clear)
                pixel = {0, 0, 0};
            else if (state == ShadowPixelState::Unknown)
                pixel = {128, 128, 128};
        }
    return image;
}
cv::Mat shadowClasses(const cv::Mat &source, const ShadowDifference &d,
                      const FingertipEstimate &tips, CandidateFilter filter,
                      double maximumShadowLuma) {
    cv::Mat image(source.size(), CV_8UC3, cv::Scalar(255, 255, 255));
    for (int y = 0; y < d.height; ++y)
        for (int x = 0; x < d.width; ++x) {
            const int i = y * d.width + x;
            auto &color = image.at<cv::Vec3b>(y, x);
            if (tips.mask[i]) {
                color = {100, 0, 0};
                continue;
            } // BGR: dark blue finger proposal.
            const auto state = classifyShadowPixel(d, tips.mask, i, 5, filter);
            if (state == ShadowPixelState::Unknown) {
                color = {0, 0, 0};
                continue;
            }
            if (state == ShadowPixelState::Clear)
                continue;
            if (d.lumaDrop[i] >= middleShadowMinimumDrop)
                color = {42, 85, 145}; // Brown: medium shadow, display only.
            else if (d.lumaDrop[i] <= faintShadowMaximumDrop)
                color = {230, 140, 170}; // Lavender: faint shadow, display only.
            else
                color = {128, 128, 128}; // Gray: remaining light shadow.
            const auto p = source.at<cv::Vec3b>(y, x);
            const double currentLuma = 0.2126 * p[2] + 0.7152 * p[1] + 0.0722 * p[0];
            if (currentLuma <= maximumShadowLuma)
                color = {180, 0, 180}; // Purple: dark shadow considered for inspection.
        }
    return image;
}
} // namespace
std::vector<DiagnosticImage> renderShadowDiagnostics(
    const cv::Mat &source, const cv::Mat &reference, const ShadowDifference &d,
    const FingertipEstimate &tips, const std::vector<ShadowPaths> &paths, double maximumResidual,
    bool darkShadowsOnly, const std::string &fingerMethod, double crThreshold,
    const FingertipEstimate *originalCrTips, bool lightShadowTest, double maximumShadowLuma,
    bool midShadowTest, const std::string &algorithm) {
    if (source.size() != cv::Size(d.width, d.height) || reference.size() != source.size() ||
        tips.candidates.size() != paths.size())
        throw std::invalid_argument("Mismatched diagnostic inputs");
    const auto lumaText = cv::format("%.6g", maximumShadowLuma);
    const std::string tolerance = cv::format("%.6g", maximumResidual);
    CandidateFilter shadowFilter;
    shadowFilter.maximumResidual = maximumResidual;
    if (fingerMethod != "projection")
        shadowFilter.method = FilterMethod::FingerMask;
    const auto darkLimit =
        darkShadowsOnly ? std::optional<double>(maximumShadowLuma) : std::nullopt;
    const auto usedShadows = maskedShadowHeatmap(d, tips, shadowFilter, 20, darkLimit);
    auto usedShadowsWithFingers = usedShadows.clone();
    for (int y = 0; y < d.height; ++y)
        for (int x = 0; x < d.width; ++x)
            if (tips.mask[y * d.width + x])
                usedShadowsWithFingers.at<cv::Vec3b>(y, x) =
                    originalCrTips && !originalCrTips->mask[y * d.width + x]
                        ? cv::Vec3b(180, 0, 255)
                        : cv::Vec3b(100, 0, 0);
    auto colors = renderColorDiagnostics(source, reference, true);
    const auto crChange =
        std::find_if(colors.changes.begin(), colors.changes.end(), [](const auto &image) {
            return image.filename == "color-ycrcb-change-2.png";
        });
    std::vector<DiagnosticImage> output;
    const auto add = [&](std::string file, std::string title, std::string explanation,
                         cv::Mat image) {
        output.push_back(
            {std::move(file), std::move(title), std::move(explanation), std::move(image)});
    };
    const auto maskedShadows = maskedShadowHeatmap(d, tips, shadowFilter);
    const auto originalShadows =
        originalCrTips ? maskedShadowHeatmap(d, *originalCrTips, shadowFilter) : maskedShadows;
    auto originalFingerAndShadow = originalShadows.clone();
    const auto &originalMask = originalCrTips ? originalCrTips->mask : tips.mask;
    for (int y = 0; y < d.height; ++y)
        for (int x = 0; x < d.width; ++x)
            if (originalMask[y * d.width + x])
                originalFingerAndShadow.at<cv::Vec3b>(y, x) = {100, 0, 0};
    auto fingerAndShadow = maskedShadows.clone();
    for (int y = 0; y < d.height; ++y)
        for (int x = 0; x < d.width; ++x)
            if (tips.mask[y * d.width + x])
                fingerAndShadow.at<cv::Vec3b>(y, x) =
                    originalCrTips && !originalCrTips->mask[y * d.width + x]
                        ? cv::Vec3b(180, 0, 255)
                        : cv::Vec3b(100, 0, 0);
    const std::string maskedRule =
        fingerMethod == "projection"
            ? "Residual <=" + tolerance + "; 5..100 scale; finger mask excluded"
            : "Outside Cr fingers; darkening5..100; no residual filter";
    const auto classified = shadowClasses(source, d, tips, shadowFilter, maximumShadowLuma);
    add("shadow-classes.png", "Shadow classes (provisional)",
        "Dark blue: fingers; magenta: luma <=" + lumaText +
            "; brown: drop >=40; gray: 20<drop<40; lavender: 5<drop<=20; white: clear; "
            "black: unavailable",
        classified);
    cv::Mat subtraction;
    cv::subtract(reference, source, subtraction); // Saturating uint8: darkening only.
    std::array<cv::Mat, 3> isolated;
    for (int k = 0; k < 3; ++k) {
        cv::Mat channel;
        cv::extractChannel(subtraction, channel, 2 - k); // OpenCV stores BGR.
        isolated[k] = cv::Mat::zeros(source.size(), CV_8UC3);
        cv::insertChannel(channel, isolated[k], 2 - k);
    }
    const bool lightEnabled =
        lightShadowTest || std::any_of(paths.begin(), paths.end(), [](const auto &p) {
            return p.light.evaluated || p.light.reason == "dark-pass";
        });
    const bool midEnabled =
        midShadowTest || std::any_of(paths.begin(), paths.end(), [](const auto &p) {
            return p.mid.evaluated || p.mid.reason != "disabled";
        });
    std::vector<cv::Mat> panels{
        label(source, "Original (analysis-sized preview)",
              "source.png uses the analysis resolution"),
        label(candidates(source, tips, paths),
              algorithm != "combined" ? "Results: " + algorithm + " algorithm only"
              : midEnabled            ? "Results: dark / light / mid algorithms"
              : lightEnabled          ? "Results: dark OR light fallback"
              : darkShadowsOnly       ? "Results at cutoff 20 (dark only)"
                                      : "Results at cutoff 20 (all shadows)",
              "Green match / red no match / gray unknown; spatial IDs"),
        label(reference, "Empty reference", "Coordinate-matched background"),
        label(heatmap(d, d.lumaDrop, 5, 100, false), "Darkening heatmap",
              "Black <=5; cool to warm 5..100; gray unavailable"),
        label(
            fingerMethod == "projection" ? heatmap(d, d.residualCurrent, 0, 0.30, true)
                                         : crChange->pixels,
            fingerMethod == "projection" ? "Projection residual heatmap" : "Cr change (display x4)",
            fingerMethod == "projection" ? "Scale0..0.30; active projection filter"
                                         : "Mask uses RAW Cr >" + cv::format("%.6g", crThreshold) +
                                               "; display gain does not affect mask"),
        label(usedShadowsWithFingers, "Fingers + shadows used by DFS (cutoff20)",
              std::string("Blue/pink: fingers; heat: drop >20") +
                  (darkShadowsOnly ? "; current luma <=" + lumaText : "; all brightness levels")),
        label(originalFingerAndShadow,
              originalCrTips ? "Original Cr shadow (before Otsu)"
                             : "Original shadow (" + fingerMethod + " mask)",
              "Blue: fingers; " + maskedRule),
        label(fingerAndShadow,
              originalCrTips ? "New Otsu shadow (refined fingertips)"
                             : "Filtered shadow heatmap (" + fingerMethod + " fingers)",
              "Blue: original fingers; pink: Otsu additions; heat: filtered shadows"),
        label(classified, "Dark / mid / light / faint shadows (" + fingerMethod + ")",
              "Blue: fingers; magenta: luma <=" + lumaText +
                  "; brown: >=40; gray: 20..40; lavender: >5..20; white: clear; black: "
                  "unknown"),
        label(subtraction, "RGB subtraction",
              "Raw max(reference - current, 0); no filters; 0..255"),
        label(isolated[0], "Subtraction: R only", "Red drop only; G and B zero; same 0..255 scale"),
        label(isolated[1], "Subtraction: G only",
              "Green drop only; R and B zero; same 0..255 scale"),
        label(isolated[2], "Subtraction: B only",
              "Blue drop only; R and G zero; same 0..255 scale")};
    while (panels.size() % 3)
        panels.emplace_back(source.rows + 64, source.cols, CV_8UC3, background);
    for (const auto &change : colors.changes)
        panels.push_back(label(change.pixels, change.title, change.explanation));
    add("comparison.png", "Original, results and underlying diagnostics",
        "Original diagnostics plus absolute color-channel changes at the same analysis scale",
        mosaic(panels, 3));
    return output;
}
} // namespace makeshift::cvbaseline
