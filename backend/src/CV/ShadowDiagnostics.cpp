#include "ShadowDiagnostics.hpp"
#include "ColorDiagnostics.hpp"
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
                      const FingertipEstimate &tips, CandidateFilter filter) {
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
        const auto decision = finalShadowDecision(paths[i]);
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
std::vector<DiagnosticImage>
renderShadowDiagnostics(const cv::Mat &original, const cv::Mat &source, const cv::Mat &reference,
                        const ShadowDifference &d, const FingertipEstimate &tips,
                        const std::vector<ShadowPaths> &paths, double maximumResidual,
                        bool darkShadowsOnly, const std::string &fingerMethod, double crThreshold,
                        const FingertipEstimate *originalCrTips, bool lightShadowTest) {
    if (source.size() != cv::Size(d.width, d.height) || reference.size() != source.size() ||
        tips.candidates.size() != paths.size())
        throw std::invalid_argument("Mismatched diagnostic inputs");
    const std::string tolerance = cv::format("%.6g", maximumResidual);
    CandidateFilter shadowFilter;
    shadowFilter.maximumResidual = maximumResidual;
    if (fingerMethod != "projection")
        shadowFilter.method = FilterMethod::FingerMask;
    const auto darkLimit =
        darkShadowsOnly ? std::optional<double>(consideredShadowMaximumLuma) : std::nullopt;
    const auto usedShadows = maskedShadowHeatmap(d, tips, shadowFilter, 20, darkLimit);
    auto usedShadowsWithFingers = usedShadows.clone();
    for (int y = 0; y < d.height; ++y)
        for (int x = 0; x < d.width; ++x)
            if (tips.mask[y * d.width + x])
                usedShadowsWithFingers.at<cv::Vec3b>(y, x) =
                    originalCrTips && !originalCrTips->mask[y * d.width + x]
                        ? cv::Vec3b(180, 0, 255)
                        : cv::Vec3b(100, 0, 0);
    auto colors = renderColorDiagnostics(source, reference);
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
    add("original.png", "Original image", "Native resolution, without annotations",
        original.clone());
    add("original-results.png", "Results on original",
        "Native resolution; green match / red no match / gray unknown at cutoff 20",
        originalResults(original, d, tips, paths));
    add("heatmap-darkening.png", "Darkening",
        "Luma drop: black <=5; cool to warm 5..100; saturated >=100; gray unavailable",
        heatmap(d, d.lumaDrop, 5, 100, false));
    add("heatmap-residual.png", "Projection color mismatch",
        "Residual: black0; scale0..0.30; " + (fingerMethod == "projection"
                                                  ? "active shadow filter <=" + tolerance
                                                  : "context only, NOT a Cr shadow filter"),
        heatmap(d, d.residualCurrent, 0, 0.30, true));
    add("heatmap-color-shift.png", "Normalized color shift",
        "Channel-proportion shift: black 0; cool to warm 0..30; context only; gray unavailable",
        heatmap(d, d.colorShift, 0, 30, false));
    add("heatmap-shadow.png", "Filtered shadow darkening",
        fingerMethod == "projection" ? "Scale5..100; projection filtered; finger mask excluded"
                                     : "Scale5..100; outside Cr fingers; NO residual exclusion",
        maskedShadowHeatmap(d, tips, shadowFilter));
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
    const auto classified = shadowClasses(source, d, tips, shadowFilter);
    add("shadow-classes.png", "Shadow classes (provisional)",
        "Dark blue: finger mask; purple: shadow luma <=110; gray: lighter shadow; white: clear; "
        "black: unavailable",
        classified);
    cv::Mat subtraction;
    cv::subtract(reference, source, subtraction); // Saturating uint8: darkening only.
    add("subtraction.png", "RGB subtraction",
        "Raw max(reference - current, 0); no filters or rescaling", subtraction);
    std::array<cv::Mat, 3> isolated;
    const std::array<std::string, 3> channelNames{"R", "G", "B"};
    for (int k = 0; k < 3; ++k) {
        cv::Mat channel;
        cv::extractChannel(subtraction, channel, 2 - k); // OpenCV stores BGR.
        isolated[k] = cv::Mat::zeros(source.size(), CV_8UC3);
        cv::insertChannel(channel, isolated[k], 2 - k);
        const auto lower = std::array<std::string, 3>{"r", "g", "b"}[k];
        add("subtraction-" + lower + ".png", "Subtraction: " + channelNames[k] + " only",
            "Raw channel drop 0..255; other channels zero; no filters or rescaling", isolated[k]);
    }
    const bool lightEnabled =
        lightShadowTest || std::any_of(paths.begin(), paths.end(), [](const auto &p) {
            return p.light.evaluated || p.light.reason == "dark-pass";
        });
    std::vector<cv::Mat> panels{
        label(source, "Original (analysis-sized preview)",
              "Full-resolution original.png is also saved"),
        label(candidates(source, tips, paths),
              lightEnabled      ? "Results: dark OR light fallback"
              : darkShadowsOnly ? "Results at cutoff 20 (dark only)"
                                : "Results at cutoff 20 (all shadows)",
              "Green match / red no match / gray unknown; spatial IDs"),
        label(reference, "Empty reference", "Coordinate-matched background"),
        label(output[2].pixels, "Darkening heatmap",
              "Black <=5; cool to warm 5..100; gray unavailable"),
        label(
            fingerMethod == "projection" ? output[3].pixels : crChange->pixels,
            fingerMethod == "projection" ? "Projection residual heatmap" : "Cr change (display x4)",
            fingerMethod == "projection" ? "Scale0..0.30; active projection filter"
                                         : "Mask uses RAW Cr >" + cv::format("%.6g", crThreshold) +
                                               "; display gain does not affect mask"),
        label(usedShadowsWithFingers, "Fingers + shadows used by DFS (cutoff20)",
              std::string("Blue/pink: fingers; heat: drop >20") +
                  (darkShadowsOnly ? "; current luma <=110" : "; all brightness levels")),
        label(originalFingerAndShadow,
              originalCrTips ? "Original Cr shadow (before Otsu)"
                             : "Original shadow (" + fingerMethod + " mask)",
              "Blue: fingers; " + maskedRule),
        label(fingerAndShadow,
              originalCrTips ? "New Otsu shadow (refined fingertips)"
                             : "Filtered shadow heatmap (" + fingerMethod + " fingers)",
              "Blue: original fingers; pink: Otsu additions; heat: filtered shadows"),
        label(classified, "Dark / light shadows (" + fingerMethod + ")",
              "Blue: fingers; magenta: luma <=110; gray: lighter shadows; white: clear; black: "
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
    for (auto &image : colors.images)
        output.push_back(std::move(image));
    add("comparison.png", "Original, results and underlying diagnostics",
        "Original diagnostics plus absolute color-channel changes at the same analysis scale",
        mosaic(panels, 3));
    if (lightEnabled) {
        auto light = source.clone();
        const auto paint = [&](const std::vector<Pixel> &pixels, cv::Vec3b color) {
            for (auto p : pixels)
                light.at<cv::Vec3b>(p.y, p.x) = color;
        };
        for (size_t i = 0; i < paths.size(); ++i) {
            const auto &e = paths[i].light;
            paint(e.leftShadow, {255, 220, 0});
            paint(e.rightShadow, {255, 0, 255});
            paint(e.front, {0, 220, 255});
            paint(e.clearBand, {0, 255, 0});
            paint(e.clearStrip, {255, 255, 255});
            const auto &tip = tips.candidates[i];
            cv::putText(light,
                        std::to_string(tip.id) + ":" +
                            (e.reason == "dark-pass" ? "dark"
                             : e.matched             ? "light"
                                                     : "no"),
                        {tip.x + 3, tip.y + 12}, cv::FONT_HERSHEY_SIMPLEX, 0.3,
                        decisionColor(finalShadowDecision(paths[i])), 1);
        }
        add("light-shadow.png", "Light-shadow fallback",
            "Yellow front; white clear strip; green clear band; cyan/magenta side blobs. Reasons "
            "in JSON.",
            light);
    }
    return output;
}
} // namespace makeshift::cvbaseline
