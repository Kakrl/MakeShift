#include "ShadowDiagnostics.hpp"
#include <algorithm>
#include <cmath>
#include <opencv2/imgproc.hpp>
#include <stdexcept>

namespace makeshift::cvbaseline {
namespace {
const cv::Scalar background(24, 24, 24), text(240, 240, 240), unknown(128, 128, 128);
const cv::Scalar upward(255, 220, 0), downward(0, 0, 240), arcColor(0, 220, 255), match(0, 210, 0);
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
        const auto &level = paths[i].levels[1];
        const auto color = decisionColor(level.patternMatch);
        cv::circle(result, {tip.x, tip.y}, 4, color, 1);
        cv::putText(result,
                    std::to_string(tip.id) + ":" +
                        (!level.patternMatch   ? "?"
                         : *level.patternMatch ? "match"
                                               : "no"),
                    {tip.x + 5, tip.y}, cv::FONT_HERSHEY_SIMPLEX, 0.35, color, 1, cv::LINE_AA);
    }
    return result;
}
cv::Mat shadowClasses(const cv::Mat &source, const ShadowDifference &d,
                      const FingertipEstimate &tips, double maximumResidual) {
    cv::Mat image(source.size(), CV_8UC3, cv::Scalar(255, 255, 255));
    for (int y = 0; y < d.height; ++y)
        for (int x = 0; x < d.width; ++x) {
            const int i = y * d.width + x;
            auto &color = image.at<cv::Vec3b>(y, x);
            if (tips.mask[i]) {
                color = {100, 0, 0};
                continue;
            } // BGR: dark blue finger proposal.
            if (!d.valid[i] || !d.projectionValid[i] || !std::isfinite(d.lumaDrop[i]) ||
                !std::isfinite(d.residualCurrent[i])) {
                color = {0, 0, 0};
                continue;
            }
            if (d.lumaDrop[i] <= 5 || d.residualCurrent[i] > maximumResidual)
                continue;
            color = {128, 128, 128}; // Compatible shadow excluded by brightness cutoff.
            const auto p = source.at<cv::Vec3b>(y, x);
            const double currentLuma = 0.2126 * p[2] + 0.7152 * p[1] + 0.0722 * p[0];
            if (currentLuma <= consideredShadowMaximumLuma)
                color = {180, 0, 180}; // Purple: dark shadow considered for inspection.
        }
    return image;
}
cv::Mat originalResults(const cv::Mat &original, const ShadowDifference &d,
                        const FingertipEstimate &tips, const std::vector<ShadowPaths> &paths) {
    auto result = original.clone();
    const double sx = double(original.cols) / d.width, sy = double(original.rows) / d.height;
    for (size_t i = 0; i < tips.candidates.size(); ++i) {
        const auto &tip = tips.candidates[i];
        const auto &decision = paths[i].levels[1].patternMatch;
        const cv::Point p(int(std::round(tip.x * sx)), int(std::round(tip.y * sy)));
        const auto color = decisionColor(decision);
        cv::circle(result, p, std::max(4, int(std::round(4 * sx))), color,
                   std::max(1, int(std::round(sx))));
        cv::putText(result,
                    std::to_string(tip.id) + ":" +
                        (!decision   ? "?"
                         : *decision ? "match"
                                     : "no"),
                    p + cv::Point(int(5 * sx), 0), cv::FONT_HERSHEY_SIMPLEX, 0.35 * sx, color,
                    std::max(1, int(std::round(sx))), cv::LINE_AA);
    }
    return result;
}
cv::Mat dfs(const cv::Mat &source, const FingertipEstimate &tips,
            const std::vector<ShadowPaths> &paths, int levelIndex) {
    cv::Mat image;
    source.convertTo(image, -1, 0.5);
    for (size_t i = 0; i < paths.size(); ++i) {
        const auto &p = paths[i];
        const auto &level = p.levels[levelIndex];
        if (p.corridorMinimumX) {
            const int top = std::max(0, p.upwardY), bottom = std::min(source.rows - 1, p.downwardY);
            if (top <= bottom)
                cv::rectangle(image, {*p.corridorMinimumX, top}, {*p.corridorMaximumX, bottom},
                              cv::Scalar(90, 90, 90), 1);
        }
        for (auto pixel : p.arc)
            image.at<cv::Vec3b>(pixel.y, pixel.x) = {0, 220, 255};
        for (const auto &searches : {&level.downwardSearches, &level.upwardSearches})
            for (const auto &search : *searches) {
                if (!search.reached)
                    continue; // Successful witness paths; failed explorations remain in JSON.
                const auto color = search.ignored                        ? unknown
                                   : searches == &level.downwardSearches ? downward
                                                                         : upward;
                for (size_t k = 1; k < search.path.size(); ++k)
                    cv::line(image, {search.path[k - 1].x, search.path[k - 1].y},
                             {search.path[k].x, search.path[k].y}, color, 1);
                if (search.widthWitness && searches == &level.upwardSearches && !search.ignored) {
                    const auto &span = *search.widthWitness;
                    cv::line(image, {span.left, span.y}, {span.right, span.y}, match, 1);
                }
            }
        const auto &t = tips.candidates[i];
        cv::circle(image, {t.x, t.y}, 3, decisionColor(level.patternMatch), 1);
        cv::putText(image, std::to_string(t.id), {t.x + 4, t.y}, cv::FONT_HERSHEY_SIMPLEX, 0.35,
                    decisionColor(level.patternMatch), 1);
    }
    return image;
}
} // namespace
std::vector<DiagnosticImage> renderShadowDiagnostics(const cv::Mat &original, const cv::Mat &source,
                                                     const cv::Mat &reference,
                                                     const ShadowDifference &d,
                                                     const FingertipEstimate &tips,
                                                     const std::vector<ShadowPaths> &paths,
                                                     double maximumResidual, bool darkShadowsOnly) {
    if (source.size() != cv::Size(d.width, d.height) || reference.size() != source.size() ||
        tips.candidates.size() != paths.size())
        throw std::invalid_argument("Mismatched diagnostic inputs");
    const std::string tolerance = cv::format("%.6g", maximumResidual);
    std::vector<DiagnosticImage> output;
    const auto add = [&](std::string file, std::string title, std::string explanation,
                         cv::Mat image) {
        output.push_back(
            {std::move(file), std::move(title), std::move(explanation), std::move(image)});
    };
    add("original.png", "Original image", "Native resolution, without annotations",
        original.clone());
    add("original-results.png", "Results on original",
        "Native resolution; green match / red no match / gray unknown at cutoff 20",
        originalResults(original, d, tips, paths));
    add("heatmap-darkening.png", "Darkening",
        "Luma drop: black <=5; cool to warm 5..100; saturated >=100; gray unavailable",
        heatmap(d, d.lumaDrop, 5, 100, false));
    add("heatmap-residual.png", "Projection color mismatch",
        "Residual: black 0; cool to warm 0..0.30; shadow filter <=" + tolerance +
            "; gray unavailable",
        heatmap(d, d.residualCurrent, 0, 0.30, true));
    add("heatmap-color-shift.png", "Normalized color shift",
        "Channel-proportion shift: black 0; cool to warm 0..30; context only; gray unavailable",
        heatmap(d, d.colorShift, 0, 30, false));
    add("heatmap-shadow.png", "Filtered shadow darkening",
        "Same 5..100 scale; projection residual <=" + tolerance +
            "; rejected/clear black; unavailable gray",
        heatmap(d, d.lumaDrop, 5, 100, true, true, maximumResidual));
    std::vector<cv::Mat> dfsPanels;
    for (int k = 0; k < 4; ++k) {
        const auto title = "DFS cutoff " + std::to_string(shadowCutoffs[k]) +
                           (darkShadowsOnly ? " (dark only)" : " (all shadows)");
        auto image = dfs(source, tips, paths, k);
        dfsPanels.push_back(
            label(image, title, "Cyan up / red down / gray ignored; green width; yellow arc"));
        add("dfs-" + std::to_string(shadowCutoffs[k]) + ".png", title,
            "Successful paths: cyan upward, red downward, gray both-target ignored; green width "
            "witness; yellow arc",
            image);
    }
    add("dfs-comparison.png", "Directional searches at all cutoffs",
        "Identical source and geometry; only darkening cutoff changes", mosaic(dfsPanels, 2));
    cv::Mat boundary(d.height, d.width, CV_8UC1);
    for (int y = 0; y < d.height; ++y)
        for (int x = 0; x < d.width; ++x)
            boundary.at<uint8_t>(y, x) = tips.mask[y * d.width + x] * 255;
    cv::Mat boundaryBgr;
    cv::cvtColor(boundary, boundaryBgr, cv::COLOR_GRAY2BGR);
    const auto classified = shadowClasses(source, d, tips, maximumResidual);
    add("shadow-classes.png", "Shadow classes (provisional)",
        "Dark blue: finger mask; purple: shadow luma <=110; gray: lighter shadow; white: clear; "
        "black: unavailable",
        classified);
    const std::vector<cv::Mat> panels{
        label(source, "Original (analysis-sized preview)",
              "Full-resolution original.png is also saved"),
        label(candidates(source, tips, paths),
              darkShadowsOnly ? "Results at cutoff 20 (dark only)"
                              : "Results at cutoff 20 (all shadows)",
              "Green match / red no match / gray unknown; spatial IDs"),
        label(reference, "Empty reference", "Coordinate-matched background"),
        label(output[2].pixels, "Darkening heatmap",
              "Black <=5; cool to warm 5..100; gray unavailable"),
        label(output[3].pixels, "Projection residual heatmap",
              "Cool to warm 0..0.30; shadow filter <=" + tolerance + "; gray unknown"),
        label(output[5].pixels, "Filtered shadow heatmap",
              "Residual <=" + tolerance + "; same darkening scale 5..100"),
        label(boundaryBgr, "Filtered boundary mask",
              "Valid darkening >5 rejected by residual filter"),
        label(output[4].pixels, "Color shift heatmap (context)",
              "Cool to warm 0..30; not the active projection filter"),
        label(classified, "Dark shadow candidates (provisional)",
              "Blue finger; purple dark shadow; gray light shadow; white clear; black unknown")};
    add("comparison.png", "Original, results and underlying diagnostics",
        "Nine labeled panels at the same analysis scale", mosaic(panels, 3));
    return output;
}
} // namespace makeshift::cvbaseline
