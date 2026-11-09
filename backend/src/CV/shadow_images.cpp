#include "CrFingerDetection.hpp"
#include "Fingertips.hpp"
#include "Homography.hpp"
#include "MidShadow.hpp"
#include "ShadowDetection.hpp"
#include "ShadowDiagnostics.hpp"
#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <stdexcept>

namespace fs = std::filesystem;
using namespace makeshift::cvbaseline;
namespace {
void writePixels(cv::FileStorage &out, const char *name, const std::vector<Pixel> &pixels) {
    out << name << "[";
    for (auto p : pixels)
        out << "{" << "x" << p.x << "y" << p.y << "}";
    out << "]";
}
cv::Mat loadRgba(const std::string &path) {
    const auto image = cv::imread(path, cv::IMREAD_UNCHANGED);
    if (image.empty() || image.depth() != CV_8U)
        throw std::invalid_argument("Unreadable/non-8-bit image: " + path);
    cv::Mat rgba;
    if (image.channels() == 4)
        cv::cvtColor(image, rgba, cv::COLOR_BGRA2RGBA);
    else if (image.channels() == 3)
        cv::cvtColor(image, rgba, cv::COLOR_BGR2RGBA);
    else if (image.channels() == 1)
        cv::cvtColor(image, rgba, cv::COLOR_GRAY2RGBA);
    else
        throw std::invalid_argument("Unsupported channel count");
    return rgba;
}
void writeImage(const fs::path &path, const cv::Mat &image) {
    if (!cv::imwrite(path.string(), image))
        throw std::runtime_error("Failed to write " + path.string());
}
// Remove only retired generated artifacts after a successful full export.
// Preserve captures used as inputs, symlinks and unrelated files in reused folders.
void removeRetiredOutputs(const fs::path &output, const fs::path &current,
                          const fs::path &reference) {
    std::vector<std::string> retired{"reference.png",
                                     "boundary.png",
                                     "valid.png",
                                     "darkening.png",
                                     "measurements.yml.gz",
                                     "original.png",
                                     "original-results.png",
                                     "heatmap-darkening.png",
                                     "heatmap-residual.png",
                                     "heatmap-color-shift.png",
                                     "heatmap-shadow.png",
                                     "dfs-5.png",
                                     "dfs-20.png",
                                     "dfs-40.png",
                                     "dfs-60.png",
                                     "dfs-comparison.png",
                                     "subtraction.png",
                                     "subtraction-r.png",
                                     "subtraction-g.png",
                                     "subtraction-b.png",
                                     "light-shadow.png",
                                     "mid-shadow.png"};
    for (const auto *space : {"rgb", "hsv", "lab", "ycrcb", "normalized-rgb", "cmy", "ryb"}) {
        const auto prefix = std::string("color-") + space;
        retired.push_back(prefix + "-comparison.png");
        for (const auto *row : {"current", "reference", "change"})
            for (int channel = 1; channel <= 3; ++channel)
                retired.push_back(prefix + "-" + row + "-" + std::to_string(channel) + ".png");
    }
    for (const auto &name : retired) {
        const auto file = output / name;
        if (fs::is_regular_file(file) && !fs::is_symlink(file) && !fs::equivalent(file, current) &&
            !fs::equivalent(file, reference))
            fs::remove(file);
    }
}
void writeSearches(cv::FileStorage &out, const char *name,
                   const std::vector<ShadowSearch> &searches) {
    out << name << "[";
    for (const auto &s : searches) {
        out << "{" << "x" << s.seed.x << "y" << s.seed.y << "reached" << int(s.reached)
            << "targetReached" << int(s.targetReached) << "ignored" << int(s.ignored)
            << "unavailable" << int(s.unavailable) << "path" << "[";
        for (auto p : s.path)
            out << "{" << "x" << p.x << "y" << p.y << "}";
        out << "]" << "hitWidthLimit" << int(s.hitWidthLimit) << "hitCorridorLimit"
            << int(s.hitCorridorLimit);
        if (s.widthWitness) {
            const auto &span = *s.widthWitness;
            out << "widthWitness" << "{" << "left" << span.left << "right" << span.right << "y"
                << span.y << "width" << span.width << "}";
        }
        out << "}";
    }
    out << "]";
}
} // namespace
int main(int argc, char **argv) {
    try {
        cv::CommandLineParser parser(
            argc, argv,
            "{help h ? | | Show help}"
            "{image | | Current image path}"
            "{reference | | Coordinate-matched empty reference}"
            "{residual | | Override CandidateFilter maximum projection residual}"
            "{finger-method |cr-otsu| Finger mask: cr-otsu, cr or projection}"
            "{cr-threshold | | Override compiled Cr threshold, in 0..255 units}"
            "{otsu-radius | | Fingertip expansion radius, 1 or 2 analysis pixels}"
            "{algorithm |combined| Report combined fallbacks or independently dark, light, mid}"
            "{dark-shadows-only |false| Restrict DFS to dark shadow classes}"
            "{maximum-shadow-luma |110| Maximum current brightness for dark DFS, 0..255}"
            "{compact-report |false| Export JSON and candidate overlay only}"
            "{light-shadow-test |false| Try clear-front/side-shadow fallback after dark failure}"
            "{mid-shadow-test |false| Try thin-front/mid-or-darker side opening after failure}"
            "{case | | Optional three-digit case folder, such as 001; reused on rerun}"
            "{output |backend/test-results| Existing results directory; generated files are "
            "replaced}"
            "{max-side |640| Longest analysis side, 0 retains native size (max 640*640 pixels)}"
            "{corners | | Optional JSON: source array of four x/y native image points, ordered "
            "TL TR BR BL}");
        if (parser.has("help")) {
            parser.printMessage();
            return 0;
        }
        const auto currentPath = parser.get<std::string>("image"),
                   referencePath = parser.get<std::string>("reference");
        const auto outputPath = parser.get<std::string>("output"),
                   cornersPath = parser.get<std::string>("corners");
        const auto caseId = parser.get<std::string>("case");
        if (!caseId.empty() &&
            (caseId.size() != 3 || !std::all_of(caseId.begin(), caseId.end(),
                                                [](char ch) { return ch >= '0' && ch <= '9'; })))
            throw std::invalid_argument("Case must be three digits, such as 001");
        const int maxSide = parser.get<int>("max-side");
        CandidateFilter filter;
        const auto fingerMethod = parser.get<std::string>("finger-method");
        const double crThreshold = parser.has("cr-threshold") ? parser.get<double>("cr-threshold")
                                                              : defaultCrFingerThreshold;
        const int otsuRadius =
            parser.has("otsu-radius") ? parser.get<int>("otsu-radius") : defaultCrOtsuRadius;
        if ((fingerMethod != "cr" && fingerMethod != "cr-otsu" && fingerMethod != "projection") ||
            !std::isfinite(crThreshold) || crThreshold < 0 || crThreshold > 255 || otsuRadius < 1 ||
            otsuRadius > 2)
            throw std::invalid_argument("Use --finger-method=cr-otsu|cr|projection, "
                                        "--cr-threshold=0..255, --otsu-radius=1|2");
        if (parser.has("residual"))
            filter.maximumResidual = parser.get<double>("residual");
        validateFilter(filter);
        const auto algorithmName = parser.get<std::string>("algorithm");
        ShadowAlgorithm algorithm;
        if (algorithmName == "combined")
            algorithm = ShadowAlgorithm::Combined;
        else if (algorithmName == "dark")
            algorithm = ShadowAlgorithm::Dark;
        else if (algorithmName == "light")
            algorithm = ShadowAlgorithm::Light;
        else if (algorithmName == "mid")
            algorithm = ShadowAlgorithm::Mid;
        else
            throw std::invalid_argument("Use --algorithm=combined|dark|light|mid");
        const bool independent = algorithm != ShadowAlgorithm::Combined;
        const bool legacyLight = parser.get<bool>("light-shadow-test");
        const bool legacyMid = parser.get<bool>("mid-shadow-test");
        if (independent && (legacyLight || legacyMid))
            throw std::invalid_argument("Use --algorithm alone instead of fallback-test flags");
        const bool darkShadowsOnly = independent || parser.get<bool>("dark-shadows-only");
        const bool lightShadowTest = algorithm == ShadowAlgorithm::Light || legacyLight;
        const bool midShadowTest = algorithm == ShadowAlgorithm::Mid || legacyMid;
        if ((lightShadowTest || midShadowTest) && !darkShadowsOnly)
            throw std::invalid_argument("Light/mid fallback requires --dark-shadows-only=true");
        const double maximumShadowLuma = parser.get<double>("maximum-shadow-luma");
        const bool compactReport = parser.get<bool>("compact-report");
        if (!std::isfinite(maximumShadowLuma) || maximumShadowLuma < 0 || maximumShadowLuma > 255)
            throw std::invalid_argument("Maximum shadow luma must be finite and within 0..255");
        ShadowPathSettings pathSettings;
        if (darkShadowsOnly)
            pathSettings.maximumCurrentLuma = maximumShadowLuma;
        if (!parser.check() || currentPath.empty() || referencePath.empty() || outputPath.empty() ||
            maxSide < 0 || maxSide > 640)
            throw std::invalid_argument(
                "Supply --image, --reference, --output and max-side 0..640");
        cv::Mat current = loadRgba(currentPath), reference = loadRgba(referencePath);
        if (current.size() != reference.size())
            throw std::invalid_argument("Native image/reference dimensions differ");
        const auto native = current.size();
        std::optional<Homography> transform;
        if (!cornersPath.empty()) {
            cv::FileStorage corners(cornersPath, cv::FileStorage::READ);
            const auto points = corners["source"];
            if (!corners.isOpened() || !points.isSeq() || points.size() != 4)
                throw std::invalid_argument("Expected four source corners");
            std::array<Point, 4> source{}, target{{{0, 0}, {1, 0}, {1, 1}, {0, 1}}};
            for (int i = 0; i < 4; ++i) {
                const auto p = points[i];
                if ((!p["x"].isReal() && !p["x"].isInt()) || (!p["y"].isReal() && !p["y"].isInt()))
                    throw std::invalid_argument("Invalid corner");
                source[i] = {double(p["x"]), double(p["y"])};
            }
            transform = computeHomography(source, target);
            if (!transform)
                throw std::invalid_argument("Degenerate homography corners");
        }
        const double scale =
            maxSide ? std::min(1.0, double(maxSide) / std::max(native.width, native.height)) : 1;
        const cv::Size analysis(int(std::floor(native.width * scale + 0.5)),
                                int(std::floor(native.height * scale + 0.5)));
        if (analysis.width < 1 || analysis.height < 1 ||
            int64_t(analysis.width) * analysis.height > 640 * 640)
            throw std::invalid_argument("Analysis size outside 1..640*640 pixels");
        if (analysis != native) {
            cv::resize(current, current, analysis, 0, 0, cv::INTER_AREA);
            cv::resize(reference, reference, analysis, 0, 0, cv::INTER_AREA);
        }
        const auto difference = measureShadowDifference(current, reference);
        FingertipOptions fingertipOptions;
        fingertipOptions.filter = filter;
        std::optional<CrOtsuResult> refinement;
        FingertipEstimate tips;
        if (fingerMethod == "cr-otsu") {
            refinement = refineCrFingertipsWithOtsu(current, reference, crThreshold, otsuRadius,
                                                    fingertipOptions);
            tips = refinement->refined;
        } else if (fingerMethod == "cr") {
            tips = identifyCrChangeFingertips(current, reference, crThreshold, fingertipOptions);
        } else {
            tips = identifyFilteredFingertips(difference, fingertipOptions);
        }
        std::vector<ShadowPaths> paths;
        CandidateFilter shadowFilter = filter;
        if (fingerMethod != "projection")
            shadowFilter.method = FilterMethod::FingerMask;
        for (const auto &tip : tips.candidates)
            paths.push_back(
                measureMonotoneShadowPaths(difference, tips.mask, tip, shadowFilter, pathSettings));
        for (auto &p : paths)
            p.algorithm = algorithm;
        if (lightShadowTest)
            for (size_t i = 0; i < paths.size(); ++i)
                paths[i].light = measureLightShadow(difference, tips.mask, tips.candidates[i],
                                                    paths[i], independent);
        if (midShadowTest)
            for (size_t i = 0; i < paths.size(); ++i)
                paths[i].mid = measureMidShadow(difference, tips.mask, tips.candidates[i], paths[i],
                                                maximumShadowLuma, independent);
        fs::path output(outputPath);
        if (!fs::is_directory(output))
            throw std::invalid_argument("Results directory must already exist");
        if (!caseId.empty()) {
            output /= caseId;
            fs::create_directory(output);
        }
        cv::Mat currentBgr, referenceBgr;
        cv::cvtColor(current, currentBgr, cv::COLOR_RGBA2BGR);
        cv::cvtColor(reference, referenceBgr, cv::COLOR_RGBA2BGR);
        if (!compactReport) {
            writeImage(output / "source.png", currentBgr);
            cv::Mat shadow(analysis, CV_8UC1);
            for (int y = 0; y < analysis.height; ++y)
                for (int x = 0; x < analysis.width; ++x)
                    shadow.at<uint8_t>(y, x) =
                        classifyShadowPixel(difference, tips.mask, y * analysis.width + x, 5,
                                            shadowFilter) == ShadowPixelState::Shadow
                            ? 255
                            : 0;
            writeImage(output / "shadow-compatible.png", shadow);
        }
        cv::FileStorage report((output / "results.json").string(),
                               cv::FileStorage::WRITE | cv::FileStorage::FORMAT_JSON);
        if (!report.isOpened())
            throw std::runtime_error("Cannot write report");
        report
            << "schemaVersion" << 2 << "compactReport" << int(compactReport) << "algorithm"
            << algorithmName << "independentAlgorithm" << int(independent) << "method"
            << (fingerMethod == "cr-otsu" ? "cr-otsu-directional-shadow-v1"
                : fingerMethod == "cr"    ? "cr-directional-shadow-v1"
                                          : "filtered-directional-shadow-v1")
            << "fingerMethod" << fingerMethod << "minimumAbsoluteCrChange" << crThreshold
            << "shadowMethod" << (fingerMethod == "projection" ? "projection" : "cr-mask-darkening")
            << "shadowResidualApplied" << int(fingerMethod == "projection") << "fingerMaskRule"
            << (fingerMethod != "projection"
                    ? "Absolute Cr change > threshold; alpha valid; no darkening "
                      "or reference-luma gate"
                    : "Darkening >5 and projection residual > maximumResidual")
            << "otsuEnabled" << int(bool(refinement)) << "otsuRadius"
            << (refinement ? otsuRadius : 0) << "otsuRule"
            << "Local Otsu on raw Cr change quantized to0..255; connected additions within "
               "Euclidean radius of original distal c-row mask; no cumulative growth"
            << "opencvVersion" << CV_VERSION << "source" << fs::absolute(currentPath).string()
            << "reference" << fs::absolute(referencePath).string() << "nativeWidth" << native.width
            << "nativeHeight" << native.height << "width" << analysis.width << "height"
            << analysis.height << "resize" << "INTER_AREA" << "minimumReferenceLuma" << 40
            << "geometryDarkeningFloor" << 5 << "maximumResidual" << filter.maximumResidual << "c"
            << pathSettings.c << "d" << pathSettings.d << "e" << pathSettings.e << "corridorRadius"
            << pathSettings.corridorRadius.value_or(-1) << "minimumUpwardShadowWidth"
            << pathSettings.minimumUpwardShadowWidth << "decisionEncoding"
            << "-1 unknown, 0 no match, 1 match; no key eligibility or note events"
            << "lightShadowTest" << int(lightShadowTest) << "lightShadowDarkeningFloor" << 5
            << "lightShadowBandDepth" << 2 << "lightShadowMinimumStrip"
            << defaultLightShadowMinimumStrip << "lightShadowStripWidthFraction" << 0.0
            << "lightShadowBlobAreaFraction" << 0.04 << "lightShadowSideReachWidthFraction" << 0.5
            << "midShadowTest" << int(midShadowTest) << "midShadowMinimumDrop"
            << middleShadowMinimumDrop << "midShadowFaintMaximumDrop" << faintShadowMaximumDrop
            << "midShadowRule"
            << "mid-or-darker sides; finger-blocked rows supply assumed opening support; "
               "at most one brown and one gray per front scan"
            << "darkShadowsOnly" << int(darkShadowsOnly) << "maximumSearchCurrentLuma"
            << pathSettings.maximumCurrentLuma.value_or(-1) << "visualization" << "{"
            << "darkeningFloor" << 5 << "darkeningFullScale" << 100 << "residualFullScale" << 0.30
            << "colorShiftFullScale" << 30 << "palette"
            << "TURBO; black below display floor, gray unavailable"
            << "source" << "source.png" << "candidates" << "candidates.png"
            << "shadowCompatible" << "shadow-compatible.png" << "combined" << "comparison.png"
            << "colorChannelPanelLocation" << "comparison.png"
            << "subtractionRule"
            << "Per-channel max(reference - current, 0), raw 0..255, no filters or normalization"
            << "colorChannelRule"
            << "Convert current/reference separately; fixed-range grayscale channels and absolute "
               "changes; hue change circular; RYB is a nonstandard artist-style approximation"
            << "crChangeDisplayGain" << 4 << "cbChangeDisplayGain" << 4 << "shadowClasses"
            << "shadow-classes.png" << "shadowClassMaximumCurrentLuma" << maximumShadowLuma
            << "shadowClassMiddleMinimumDrop" << middleShadowMinimumDrop << "shadowClassMiddleColor"
            << "brown RGB145,85,42; mid-side threshold when mid test is enabled"
            << "shadowClassFaintMaximumDrop" << faintShadowMaximumDrop << "shadowClassFaintColor"
            << "lavender RGB170,140,230; visualization only"
            << "shadowClassRule"
            << (fingerMethod == "projection" ? "Outside fingers; valid projection-compatible "
                                               "darkening; luma <= cutoff magenta, else drop >=40 "
                                               "brown, else drop <=20 lavender, else gray"
                                             : "Outside Cr fingers; valid darkening; no residual "
                                               "filter; luma <= cutoff magenta, else drop >=40 "
                                               "brown, else drop <=20 lavender, else gray")
            << "}"
            << "otsuRegions" << "[";
        if (refinement)
            for (const auto &region : refinement->regions)
                report << "{" << "originalCandidateId" << region.candidateId << "x" << region.x
                       << "y" << region.y << "width" << region.width << "height" << region.height
                       << "threshold" << region.threshold << "addedPixels" << region.addedPixels
                       << "}";
        report << "]" << "candidates" << "[";
        auto overlay = currentBgr.clone();
        for (size_t i = 0; i < tips.candidates.size(); ++i) {
            const auto &t = tips.candidates[i];
            const auto &p = paths[i];
            report << "{" << "id" << t.id << "x" << t.x << "y" << t.y << "width" << t.width
                   << "component" << t.component << "prominence" << t.prominence << "lobeLeft"
                   << t.lobeLeft << "lobeRight" << t.lobeRight;
            if (transform) {
                const auto sheet =
                    projectPoint(*transform, {double(t.x) * native.width / analysis.width,
                                              double(t.y) * native.height / analysis.height});
                if (sheet)
                    report << "sheet" << "{" << "x" << sheet->x << "y" << sheet->y << "}";
            }
            report << "aY" << p.aY << "downwardY" << p.downwardY << "upwardY" << p.upwardY;
            if (p.corridorMinimumX)
                report << "corridorMinimumX" << *p.corridorMinimumX << "corridorMaximumX"
                       << *p.corridorMaximumX;
            writePixels(report, "arc", p.arc);
            writePixels(report, "edgeSamples", p.edgeSamples);
            const auto finalDecision = finalShadowDecision(p);
            report << "finalDecision" << (finalDecision ? int(*finalDecision) : -1)
                   << "decisionSource"
                   << (independent ? (finalDecision == true ? algorithmName.c_str() : "neither")
                       : p.levels[1].patternMatch == true ? "dark"
                       : p.light.matched                  ? "light"
                       : p.mid.matched                    ? "mid"
                                                          : "neither")
                   << "lightShadow" << "{" << "evaluated" << int(p.light.evaluated) << "matched"
                   << int(p.light.matched) << "reason" << p.light.reason << "minimumStrip"
                   << p.light.minimumStrip << "bandDepth" << p.light.bandDepth << "minimumBlobArea"
                   << p.light.minimumBlobArea;
            writePixels(report, "front", p.light.front);
            writePixels(report, "clearStrip", p.light.clearStrip);
            writePixels(report, "clearBand", p.light.clearBand);
            writePixels(report, "leftShadow", p.light.leftShadow);
            writePixels(report, "rightShadow", p.light.rightShadow);
            report << "}";
            const auto &mid = p.mid;
            report << "midShadow" << "{" << "evaluated" << int(mid.evaluated) << "matched"
                   << int(mid.matched) << "reason" << mid.reason << "frontDepth" << mid.frontDepth
                   << "minimumStrip" << mid.minimumStrip << "maximumBrownPerScan" << 1
                   << "maximumGrayPerScan" << 1 << "maximumOnset" << mid.maximumOnset << "rise"
                   << mid.rise << "minimumGrowth" << mid.minimumGrowth << "minimumSlope" << 0.5
                   << "maximumForward" << mid.maximumForward << "minimumBlobArea"
                   << mid.minimumBlobArea << "maximumEdgeStep" << mid.maximumEdgeStep << "direction"
                   << mid.direction << "onset" << mid.onset << "usedOcclusion"
                   << int(mid.usedOcclusion) << "shapeAcceptedByOcclusion"
                   << int(mid.shapeAcceptedByOcclusion) << "growthMeasured"
                   << int(mid.matched && !mid.shapeAcceptedByOcclusion) << "growth" << mid.growth
                   << "slopeMeasured" << int(mid.matched && !mid.shapeAcceptedByOcclusion)
                   << "slope" << mid.slope << "sideRows" << "[";
            for (const auto &row : mid.rows)
                report << "{" << "upwardDistance" << row.upwardDistance << "fingerEdgeX"
                       << row.fingerEdge.x << "y" << row.fingerEdge.y << "endpointX"
                       << row.endpoint.x << "visibleWidth" << row.visibleWidth << "fingerOccluded"
                       << int(row.fingerOccluded) << "maskMerged" << int(row.maskMerged)
                       << "scanLimit" << int(row.scanLimit) << "}";
            report << "]";
            writePixels(report, "frontStrip", mid.frontStrip);
            writePixels(report, "frontBand", mid.frontBand);
            writePixels(report, "fingerEdge", mid.fingerEdge);
            writePixels(report, "boundary", mid.boundary);
            writePixels(report, "mass", mid.mass);
            report << "}";
            report << "crossSectionComplete" << int(p.crossSectionComplete) << "levels" << "[";
            for (const auto &level : p.levels) {
                report << "{" << "threshold" << level.threshold << "decision"
                       << (level.patternMatch ? int(*level.patternMatch) : -1) << "downwardVeto"
                       << int(level.downwardVeto) << "upwardReached" << int(level.upwardReached)
                       << "downwardUnknown" << int(level.downwardUnknown) << "upwardUnknown"
                       << int(level.upwardUnknown);
                writeSearches(report, "downwardSearches", level.downwardSearches);
                writeSearches(report, "upwardSearches", level.upwardSearches);
                writePixels(report, "ignoredSeeds", level.ignoredSeeds);
                report << "}";
                if (level.threshold == 20) {
                    const cv::Scalar color = !finalDecision   ? cv::Scalar(128, 128, 128)
                                             : *finalDecision ? cv::Scalar(0, 200, 0)
                                                              : cv::Scalar(0, 0, 220);
                    cv::circle(overlay, {t.x, t.y}, 4, color, 1);
                    cv::putText(overlay,
                                std::to_string(t.id) + ":" +
                                    (!finalDecision   ? "?"
                                     : *finalDecision ? "match"
                                                      : "no"),
                                {t.x + 5, t.y}, cv::FONT_HERSHEY_SIMPLEX, 0.35, color, 1);
                }
            }
            report << "]" << "}";
        }
        report << "]";
        report.release();
        writeImage(output / "candidates.png", overlay);
        if (compactReport)
            return 0;
        const auto diagnostics = renderShadowDiagnostics(
            currentBgr, referenceBgr, difference, tips, paths, filter.maximumResidual,
            darkShadowsOnly, fingerMethod, crThreshold,
            refinement ? &refinement->original : nullptr, lightShadowTest, maximumShadowLuma,
            midShadowTest, algorithmName);
        for (const auto &image : diagnostics)
            writeImage(output / image.filename, image.pixels);
        std::ofstream gallery(output / "index.html");
        gallery
            << "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" "
               "content=\"width=device-width,initial-scale=1\"><title>Shadow diagnostics</title>"
               "<style>body{font-family:system-ui;margin:24px;background:#181818;color:#eee}"
               "a{color:#8dcaff}img{width:100%;height:auto}</style>"
               "<h1>Shadow diagnostics</h1><p>Finger mask: "
            << fingerMethod << "; Cr threshold: " << crThreshold
            << "; projection residual <=" << filter.maximumResidual
            << ". Algorithm: " << algorithmName << ". Light enabled: " << lightShadowTest
            << ". Mid enabled: " << midShadowTest
            << ".</p>"
               "<p>Green: match; red: no match; gray: unknown. Spatial candidate IDs; "
               "no keyboard eligibility or note events.</p>"
               "<p><a href=\"results.json\">Settings, decisions and witness paths</a></p>";
        for (const auto *name :
             {"comparison", "source", "shadow-classes", "shadow-compatible", "candidates"})
            gallery << "<figure><h2>" << name << "</h2><a href=\"" << name
                    << ".png\"><img loading=\"lazy\" src=\"" << name << ".png\"></a></figure>";
        gallery.close();
        if (!gallery)
            throw std::runtime_error("Cannot write gallery");
        removeRetiredOutputs(output, currentPath, referencePath);
        std::cout << "Output: " << fs::absolute(output)
                  << "\nCandidates: " << tips.candidates.size()
                  << " (frame-local IDs; no contact accuracy claim)\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
