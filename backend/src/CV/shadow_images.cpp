#include "Fingertips.hpp"
#include "Homography.hpp"
#include "ShadowDetection.hpp"
#include "ShadowDiagnostics.hpp"
#include <algorithm>
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
            "{dark-shadows-only |false| Restrict DFS to dark shadow classes}"
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
        if (parser.has("residual"))
            filter.maximumResidual = parser.get<double>("residual");
        validateFilter(filter);
        const bool darkShadowsOnly = parser.get<bool>("dark-shadows-only");
        ShadowPathSettings pathSettings;
        if (darkShadowsOnly)
            pathSettings.maximumCurrentLuma = consideredShadowMaximumLuma;
        if (!parser.check() || currentPath.empty() || referencePath.empty() || outputPath.empty() ||
            maxSide < 0 || maxSide > 640)
            throw std::invalid_argument(
                "Supply --image, --reference, --output and max-side 0..640");
        cv::Mat current = loadRgba(currentPath), reference = loadRgba(referencePath);
        if (current.size() != reference.size())
            throw std::invalid_argument("Native image/reference dimensions differ");
        const auto native = current.size();
        cv::Mat originalBgr;
        cv::cvtColor(current, originalBgr, cv::COLOR_RGBA2BGR);
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
        const auto tips = identifyFilteredFingertips(difference, fingertipOptions);
        std::vector<ShadowPaths> paths;
        for (const auto &tip : tips.candidates)
            paths.push_back(
                measureMonotoneShadowPaths(difference, tips.mask, tip, filter, pathSettings));
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
        writeImage(output / "source.png", currentBgr);
        writeImage(output / "reference.png", referenceBgr);
        cv::Mat boundary(analysis, CV_8UC1), valid(analysis, CV_8UC1), shadow(analysis, CV_8UC1),
            darkening(analysis, CV_8UC1);
        for (int y = 0; y < analysis.height; ++y)
            for (int x = 0; x < analysis.width; ++x) {
                const int i = y * analysis.width + x;
                boundary.at<uint8_t>(y, x) = tips.mask[i] * 255;
                valid.at<uint8_t>(y, x) = difference.valid[i] * 255;
                shadow.at<uint8_t>(y, x) =
                    difference.valid[i] && difference.projectionValid[i] &&
                            difference.lumaDrop[i] > 5 &&
                            difference.residualCurrent[i] <= filter.maximumResidual
                        ? 255
                        : 0;
                darkening.at<uint8_t>(y, x) = cv::saturate_cast<uint8_t>(difference.lumaDrop[i]);
            }
        writeImage(output / "boundary.png", boundary);
        writeImage(output / "valid.png", valid);
        writeImage(output / "shadow-compatible.png", shadow);
        writeImage(output / "darkening.png", darkening);
        // Raw float arrays (including NaNs), unlike the clipped darkening PNG.
        cv::FileStorage raw((output / "measurements.yml.gz").string(), cv::FileStorage::WRITE);
        if (!raw.isOpened())
            throw std::runtime_error("Cannot write measurements");
        for (const auto &entry :
             std::initializer_list<std::pair<const char *, const std::vector<float> *>>{
                 {"lumaDrop", &difference.lumaDrop},
                 {"currentLuma", &difference.currentLuma},
                 {"colorShift", &difference.colorShift},
                 {"multiplier", &difference.multiplier},
                 {"attenuation", &difference.attenuation},
                 {"residualReference", &difference.residualReference},
                 {"residualCurrent", &difference.residualCurrent}})
            raw << entry.first
                << cv::Mat(analysis.height, analysis.width, CV_32F,
                           const_cast<float *>(entry.second->data()));
        raw << "projectionValid"
            << cv::Mat(analysis.height, analysis.width, CV_8U,
                       const_cast<uint8_t *>(difference.projectionValid.data()));
        raw << "valid"
            << cv::Mat(analysis.height, analysis.width, CV_8U,
                       const_cast<uint8_t *>(difference.valid.data()));
        raw.release();
        cv::FileStorage report((output / "results.json").string(),
                               cv::FileStorage::WRITE | cv::FileStorage::FORMAT_JSON);
        if (!report.isOpened())
            throw std::runtime_error("Cannot write report");
        report << "schemaVersion" << 2 << "method" << "filtered-directional-shadow-v1"
               << "opencvVersion" << CV_VERSION << "source" << fs::absolute(currentPath).string()
               << "reference" << fs::absolute(referencePath).string() << "nativeWidth"
               << native.width << "nativeHeight" << native.height << "width" << analysis.width
               << "height" << analysis.height << "resize" << "INTER_AREA" << "minimumReferenceLuma"
               << 40 << "geometryDarkeningFloor" << 5 << "maximumResidual" << filter.maximumResidual
               << "c" << pathSettings.c << "d" << pathSettings.d << "e" << pathSettings.e
               << "corridorRadius" << pathSettings.corridorRadius.value_or(-1)
               << "minimumUpwardShadowWidth" << pathSettings.minimumUpwardShadowWidth
               << "decisionEncoding"
               << "-1 unknown, 0 no match, 1 match; no key eligibility or note events"
               << "darkShadowsOnly" << int(darkShadowsOnly) << "maximumSearchCurrentLuma"
               << pathSettings.maximumCurrentLuma.value_or(-1) << "visualization" << "{"
               << "darkeningFloor" << 5 << "darkeningFullScale" << 100 << "residualFullScale"
               << 0.30 << "colorShiftFullScale" << 30 << "palette"
               << "TURBO; black below display floor, gray unavailable"
               << "original" << "original.png" << "originalResults" << "original-results.png"
               << "combined" << "comparison.png"
               << "shadowClasses" << "shadow-classes.png" << "shadowClassMaximumCurrentLuma"
               << consideredShadowMaximumLuma << "shadowClassRule"
               << "current luma <= cutoff among valid projection-compatible darkened pixels; "
                  "search restriction only when darkShadowsOnly is enabled"
               << "}"
               << "candidates" << "[";
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
                    const cv::Scalar color = !level.patternMatch   ? cv::Scalar(128, 128, 128)
                                             : *level.patternMatch ? cv::Scalar(0, 200, 0)
                                                                   : cv::Scalar(0, 0, 220);
                    cv::circle(overlay, {t.x, t.y}, 4, color, 1);
                    cv::putText(overlay,
                                std::to_string(t.id) + ":" +
                                    (!level.patternMatch   ? "?"
                                     : *level.patternMatch ? "match"
                                                           : "no"),
                                {t.x + 5, t.y}, cv::FONT_HERSHEY_SIMPLEX, 0.35, color, 1);
                }
            }
            report << "]" << "}";
        }
        report << "]";
        report.release();
        writeImage(output / "candidates.png", overlay);
        const auto diagnostics =
            renderShadowDiagnostics(originalBgr, currentBgr, referenceBgr, difference, tips, paths,
                                    filter.maximumResidual, darkShadowsOnly);
        for (const auto &image : diagnostics)
            writeImage(output / image.filename, image.pixels);
        std::ofstream gallery(output / "index.html");
        gallery << "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" "
                   "content=\"width=device-width,initial-scale=1\"><title>Native shadow "
                   "diagnostics</title>"
                << "<style>body{font-family:system-ui;margin:24px;background:#181818;color:#eee}a{"
                   "color:#8dcaff}img{width:100%;height:auto}main{display:grid;grid-template-"
                   "columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:24px}figure{margin:0 "
                   "0 24px}figcaption{margin:8px 0;color:#ccc}</style>"
                << "<h1>Original, results and diagnostics</h1><p>Green: shadow-pattern match; red: "
                   "no match; gray: unknown at cutoff 20. IDs are spatial candidates. No keyboard "
                   "eligibility or note events.</p>"
                << "<p><a href=\"results.json\">Results and witness paths</a> · <a "
                   "href=\"measurements.yml.gz\">Raw float measurements</a></p>"
                << "<figure><a href=\"comparison.png\"><img "
                   "src=\"comparison.png\"></a><figcaption>Combined image: original, results, "
                   "reference, measurement heatmaps, boundary mask and dark-shadow classes. Click "
                   "for full "
                   "size.</figcaption></figure>"
                << "<h2>Original and results at native resolution</h2><main>";
        const auto show = [&](const DiagnosticImage &image) {
            gallery << "<figure><h3>" << image.title << "</h3><a href=\"" << image.filename
                    << "\"><img loading=\"lazy\" src=\"" << image.filename << "\"></a><figcaption>"
                    << image.explanation << "</figcaption></figure>";
        };
        show(diagnostics[0]);
        show(diagnostics[1]);
        gallery << "</main><h2>Heatmaps and directional searches</h2><p>Heatmaps use fixed scales "
                   "across runs: black below the display floor, cool to warm with increasing "
                   "value, gray unavailable. Color shift is context; projection residual is the "
                   "active filter.</p><main>";
        for (size_t i = 2; i < diagnostics.size(); ++i)
            if (diagnostics[i].filename != "comparison.png")
                show(diagnostics[i]);
        gallery << "</main><details><summary>Raw masks and analysis-sized inputs</summary><main>";
        for (const auto *name : {"source", "reference", "boundary", "shadow-compatible",
                                 "darkening", "valid", "candidates"})
            gallery << "<figure><h3>" << name << "</h3><a href=\"" << name
                    << ".png\"><img loading=\"lazy\" src=\"" << name << ".png\"></a></figure>";
        gallery << "</main></details>";
        gallery.close();
        if (!gallery)
            throw std::runtime_error("Cannot write gallery");
        std::cout << "Output: " << fs::absolute(output)
                  << "\nCandidates: " << tips.candidates.size()
                  << " (frame-local IDs; no contact accuracy claim)\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
