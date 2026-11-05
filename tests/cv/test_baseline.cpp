#include "Fingertips.hpp"
#include "Homography.hpp"
#include "ShadowDetection.hpp"
#include <cmath>
#include <functional>
#include <iostream>
#include <limits>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <stdexcept>

using namespace makeshift::cvbaseline;
namespace {
void require(bool ok, const std::string &message) {
    if (!ok)
        throw std::runtime_error(message);
}
void rejects(const std::function<void()> &f) {
    try {
        f();
    } catch (const std::invalid_argument &) {
        return;
    }
    throw std::runtime_error("Expected invalid_argument");
}
void geometry() {
    const std::array<Point, 4> source{{{20, 10}, {150, 25}, {130, 140}, {5, 120}}},
        target{{{0, 0}, {1, 0}, {1, 1}, {0, 1}}};
    const auto h = computeHomography(source, target);
    require(bool(h), "Perspective solve");
    const auto inverse = invertHomography(*h);
    require(bool(inverse), "Inverse");
    for (int i = 0; i < 4; ++i) {
        const auto p = projectPoint(*h, source[i]);
        require(bool(p), "Project");
        require(std::hypot(p->x - target[i].x, p->y - target[i].y) < 1e-10,
                "Corner correspondence");
        const auto back = projectPoint(*inverse, *p);
        require(bool(back), "Inverse project");
        require(std::hypot(back->x - source[i].x, back->y - source[i].y) < 1e-9, "Round trip");
    }
    require(!computeHomography({}, target), "Degenerate corners");
    require(!invertHomography({}), "Singular inverse");
    require(!projectPoint({}, {}), "Zero denominator");
    auto bad = *h;
    bad[0] = std::numeric_limits<double>::infinity();
    require(!projectPoint(bad, {1, 2}) && !invertHomography(bad), "Nonfinite transform");
}
void measurements() {
    cv::Mat ref(32, 40, CV_8UC4, cv::Scalar(230, 230, 230, 255)), frame = ref.clone();
    frame.at<cv::Vec4b>(1, 1) = {150, 150, 150, 255};
    frame.at<cv::Vec4b>(1, 2) = {150, 95, 75, 255};
    frame.at<cv::Vec4b>(1, 3) = {0, 0, 0, 255};
    frame.at<cv::Vec4b>(1, 4)[3] = 0;
    ref.at<cv::Vec4b>(1, 5) = {5, 5, 5, 255};
    const auto original = frame.clone(), empty = ref.clone();
    const auto d = measureShadowDifference(frame, ref);
    const auto mask = filteredDarkeningBoundaryMask(d);
    require(d.lumaDrop[41] == 80 && mask[41] == 0, "Neutral shadow");
    require(mask[42] == 1, "Color-rejected boundary");
    require(d.projectionValid[43] == 0 && std::isnan(d.colorShift[43]) && mask[43] == 0,
            "Near black unknown");
    require(!d.valid[44] && !d.valid[45], "Alpha and dark reference exclusions");
    require(cv::norm(original, frame, cv::NORM_INF) == 0 && cv::norm(empty, ref, cv::NORM_INF) == 0,
            "Inputs unchanged");
    require(identifyFilteredFingertips(measureShadowDifference(ref, ref)).candidates.empty(),
            "Empty reference proposals");
    require(
        measureShadowDifference(frame(cv::Rect(1, 1, 20, 20)), ref(cv::Rect(1, 1, 20, 20))).width ==
            20,
        "Noncontiguous input");
}
void directional() {
    cv::Mat ref(100, 80, CV_8UC4, cv::Scalar(230, 230, 230, 255)), frame = ref.clone();
    frame(cv::Rect(30, 10, 20, 51)).setTo(cv::Scalar(150, 95, 75, 255));
    auto run = [&](int minimumWidth = 5) {
        const auto difference = measureShadowDifference(frame, ref);
        const auto estimate = identifyFilteredFingertips(difference);
        require(estimate.candidates.size() == 1, "Single automatic tip");
        const auto &t = estimate.candidates[0];
        require(t.x == 40 && t.y == 60 && t.width == 20, "Plateau center");
        ShadowPathSettings settings;
        settings.minimumUpwardShadowWidth = minimumWidth;
        return measureMonotoneShadowPaths(difference, estimate.mask, t, {}, settings);
    };
    require(run().levels[2].patternMatch == false, "Clear paper is not support");
    for (int y = 52; y <= 60; ++y)
        frame.at<cv::Vec4b>(y, 29) = {150, 150, 150, 255};
    require(run().levels[2].patternMatch == false, "Thin upward path fails width");
    frame.at<cv::Vec4b>(54, 28) = {150, 150, 150, 255};
    require(run(3).levels[2].patternMatch == false, "Two pixels fail width3");
    frame.at<cv::Vec4b>(54, 27) = {150, 150, 150, 255};
    require(run(3).levels[2].patternMatch == true, "Three pixels satisfy width3");
    for (int x = 26; x <= 29; ++x)
        frame.at<cv::Vec4b>(54, x) = {150, 150, 150, 255};
    require(run().levels[2].patternMatch == false, "Four pixels fail width");
    frame.at<cv::Vec4b>(54, 25) = {150, 150, 150, 255};
    require(run().levels[2].patternMatch == true, "Five-pixel support");
    for (int y = 61; y <= 64; ++y)
        frame.at<cv::Vec4b>(y, 40) = {200, 200, 200, 255};
    require(run().levels[1].patternMatch == false && run().levels[1].downwardVeto,
            "Downward-only veto");
    require(run().levels[2].patternMatch == true, "Strict per-cutoff darkening");
    for (int y = 61; y <= 64; ++y)
        frame.at<cv::Vec4b>(y, 40) = {230, 230, 230, 255};
    for (int y = 60; y <= 64; ++y)
        frame.at<cv::Vec4b>(y, 29) = {150, 150, 150, 255};
    require(!run().levels[2].ignoredSeeds.empty() && !run().levels[2].downwardVeto,
            "Both-target points ignored");
}
void darkOnly() {
    cv::Mat ref(100, 80, CV_8UC4, cv::Scalar(230, 230, 230, 255)), frame = ref.clone();
    frame(cv::Rect(30, 10, 20, 51)).setTo(cv::Scalar(150, 95, 75, 255));
    auto paintSupport = [&](uint8_t value) {
        for (int y = 52; y <= 60; ++y)
            frame.at<cv::Vec4b>(y, 29) = {value, value, value, 255};
        for (int x = 25; x <= 29; ++x)
            frame.at<cv::Vec4b>(54, x) = {value, value, value, 255};
    };
    auto run = [&](bool restricted) {
        const auto d = measureShadowDifference(frame, ref);
        const auto tips = identifyFilteredFingertips(d);
        require(tips.candidates.size() == 1, "Dark-only geometry unchanged");
        ShadowPathSettings settings;
        settings.minimumUpwardShadowWidth = 5; // This fixture explicitly tests five-pixel support.
        if (restricted)
            settings.maximumCurrentLuma = 110;
        const auto paths =
            measureMonotoneShadowPaths(d, tips.mask, tips.candidates[0], {}, settings);
        if (restricted)
            for (const auto &level : paths.levels)
                for (const auto *searches : {&level.upwardSearches, &level.downwardSearches})
                    for (const auto &search : *searches)
                        for (auto p : search.path)
                            require(d.currentLuma[p.y * d.width + p.x] <= 110,
                                    "Witness uses only dark pixels");
        return paths;
    };
    paintSupport(150);
    require(run(false).levels[1].patternMatch == true, "Light support in original rule");
    require(run(true).levels[1].patternMatch == false, "Light seeds and width excluded");
    paintSupport(110);
    require(run(true).levels[1].patternMatch == true, "Inclusive dark brightness cutoff");
    frame.at<cv::Vec4b>(55, 29) = {150, 150, 150, 255};
    require(run(true).levels[1].patternMatch == false, "Cannot traverse a light bridge");
    paintSupport(100);
    frame.at<cv::Vec4b>(54, 25) = {150, 150, 150, 255};
    require(run(true).levels[1].patternMatch == false, "Light pixels cannot supply width");
    paintSupport(100);
    for (int y = 61; y <= 64; ++y)
        frame.at<cv::Vec4b>(y, 40) = {200, 200, 200, 255};
    require(run(false).levels[1].downwardVeto, "Light downward veto in original rule");
    require(run(true).levels[1].patternMatch == true,
            "Excluded light veto can change rejection to match");
    auto d = measureShadowDifference(frame, ref);
    const auto tips = identifyFilteredFingertips(d);
    ShadowPathSettings settings;
    settings.maximumCurrentLuma = 110;
    d.currentLuma[55 * d.width + 29] = NAN;
    require(measureMonotoneShadowPaths(d, tips.mask, tips.candidates[0], {}, settings)
                .levels[1]
                .upwardUnknown,
            "Unavailable brightness remains unknown");
    d.currentLuma.clear();
    rejects([&] { measureMonotoneShadowPaths(d, tips.mask, tips.candidates[0], {}, settings); });
}
void invalid() {
    cv::Mat image(32, 40, CV_8UC4, cv::Scalar(230, 230, 230, 255));
    rejects([&] { measureShadowDifference({}, image); });
    rejects([&] { measureShadowDifference(cv::Mat(32, 40, CV_8UC3), image); });
    rejects([&] { measureShadowDifference(image, image, -1); });
    auto d = measureShadowDifference(image, image);
    rejects([&] {
        auto bad = d;
        bad.valid.pop_back();
        identifyFilteredFingertips(bad);
    });
    rejects([&] {
        FingertipOptions o;
        o.minimumProminence = NAN;
        identifyFilteredFingertips(d, o);
    });
    rejects([&] { measureMonotoneShadowPaths(d, {}, Fingertip{}); });
    rejects([&] {
        ShadowPathSettings s;
        s.minimumUpwardShadowWidth = 0;
        measureMonotoneShadowPaths(d, std::vector<uint8_t>(1280), {1, 20, 20, 0, 20}, {}, s);
    });
}
void pixelList(const std::vector<Pixel> &actual, const cv::FileNode &expected,
               const std::string &label) {
    require(actual.size() == expected.size(), label + " size");
    for (size_t i = 0; i < actual.size(); ++i)
        require(actual[i].x == int(expected[int(i)]["x"]) &&
                    actual[i].y == int(expected[int(i)]["y"]),
                label + " coordinate");
}
void searches(const std::vector<ShadowSearch> &actual, const cv::FileNode &expected) {
    require(actual.size() == expected.size(), "Search count");
    for (size_t i = 0; i < actual.size(); ++i) {
        const auto &a = actual[i];
        const auto e = expected[int(i)];
        require(a.seed.x == int(e["seed"]["x"]) && a.seed.y == int(e["seed"]["y"]), "Seed order");
        for (const auto &field : std::initializer_list<std::pair<const char *, bool>>{
                 {"reached", a.reached},
                 {"targetReached", a.targetReached},
                 {"unavailable", a.unavailable},
                 {"ignored", a.ignored},
                 {"hitWidthLimit", a.hitWidthLimit},
                 {"hitCorridorLimit", a.hitCorridorLimit}})
            require(field.second == bool(int(e[field.first])),
                    std::string("Search ") + field.first);
        pixelList(a.path, e["path"], "Search path");
        require(bool(a.widthWitness) == !e["widthWitness"].empty(), "Width witness presence");
        if (a.widthWitness) {
            const auto span = e["widthWitness"];
            const auto &s = *a.widthWitness;
            require(s.left == int(span["left"]) && s.right == int(span["right"]) &&
                        s.y == int(span["y"]) && s.width == int(span["width"]),
                    "Width witness");
        }
    }
}
void parity(const std::string &path) {
    cv::FileStorage fixture(path, cv::FileStorage::READ);
    require(fixture.isOpened(), "Open fixture");
    cv::Mat frame, ref;
    cv::cvtColor(cv::imread(std::string(fixture["current"]), cv::IMREAD_UNCHANGED), frame,
                 cv::COLOR_BGRA2RGBA);
    cv::cvtColor(cv::imread(std::string(fixture["reference"]), cv::IMREAD_UNCHANGED), ref,
                 cv::COLOR_BGRA2RGBA);
    auto d = measureShadowDifference(frame, ref);
    for (const auto &entry :
         std::initializer_list<std::pair<const char *, const std::vector<float> *>>{
             {"lumaDrop", &d.lumaDrop},
             {"colorShift", &d.colorShift},
             {"multiplier", &d.multiplier},
             {"attenuation", &d.attenuation},
             {"residualReference", &d.residualReference},
             {"residualCurrent", &d.residualCurrent}}) {
        const auto expected = fixture["difference"][entry.first];
        require(expected.size() == entry.second->size(), "Measurement size");
        size_t i = 0;
        for (const auto &node : expected) {
            const double e = double(node), a = (*entry.second)[i++];
            require(e == -999 ? std::isnan(a) : std::abs(e - a) < 1e-5,
                    std::string("Measurement ") + entry.first);
        }
    }
    FingertipOptions oracleOptions;
    oracleOptions.filter.maximumResidual = 0.12;
    const auto estimate = identifyFilteredFingertips(d, oracleOptions);
    for (const auto &entry :
         std::initializer_list<std::pair<const char *, const std::vector<uint8_t> *>>{
             {"mask", &estimate.mask},
             {"valid", &d.valid},
             {"projectionValid", &d.projectionValid}}) {
        const auto expected = fixture[entry.first];
        require(expected.size() == entry.second->size(), "Mask size");
        size_t i = 0;
        for (const auto &node : expected)
            require(int(node) == (*entry.second)[i++], std::string("Pixel ") + entry.first);
    }
    const auto candidates = fixture["candidates"];
    require(estimate.candidates.size() == candidates.size(), "Candidate count");
    for (size_t i = 0; i < estimate.candidates.size(); ++i) {
        const auto &t = estimate.candidates[i];
        const auto e = candidates[int(i)];
        require(t.x == int(e["x"]) && t.y == int(e["y"]) && t.width == int(e["width"]) &&
                    t.id == int(e["id"]) && t.component == int(e["component"]) &&
                    t.prominence == double(e["prominence"]) &&
                    t.lobeLeft == int(e["lobeBounds"]["left"]) &&
                    t.lobeRight == int(e["lobeBounds"]["right"]),
                "Candidate geometry");
        ShadowPathSettings oracleSettings;
        oracleSettings.minimumUpwardShadowWidth = 5; // Historical frontend parity configuration.
        const auto result =
            measureMonotoneShadowPaths(d, estimate.mask, t, oracleOptions.filter, oracleSettings);
        const auto expected = fixture["paths"][int(i)];
        require(result.crossSectionComplete == bool(int(expected["crossSection"]["complete"])),
                "Cross section");
        pixelList(result.arc, expected["arc"], "Arc");
        pixelList(result.edgeSamples, expected["edgeSamples"], "Edge");
        for (int k = 0; k < 4; ++k) {
            const auto &a = result.levels[k];
            const auto level = expected["levels"][k];
            require((a.patternMatch ? int(*a.patternMatch) : -1) == int(level["decision"]),
                    "Decision");
            for (const auto &field : std::initializer_list<std::pair<const char *, bool>>{
                     {"downwardVeto", a.downwardVeto},
                     {"upwardReached", a.upwardReached},
                     {"downwardUnknown", a.downwardUnknown},
                     {"upwardUnknown", a.upwardUnknown}})
                require(field.second == bool(int(level[field.first])),
                        std::string("Level ") + field.first);
            pixelList(a.ignoredSeeds, level["ignoredSeeds"], "Ignored seeds");
            searches(a.downwardSearches, level["downwardSearches"]);
            searches(a.upwardSearches, level["upwardSearches"]);
        }
    }
}
} // namespace
int main(int argc, char **argv) {
    try {
        if (argc == 3 && std::string(argv[1]) == "--report-settings") {
            cv::FileStorage report(argv[2], cv::FileStorage::READ);
            require(report.isOpened(), "Open generated report");
            const ShadowPathSettings actual;
            require(int(report["minimumUpwardShadowWidth"]) == actual.minimumUpwardShadowWidth,
                    "Report must reflect configured upward width");
            require(int(report["c"]) == actual.c && int(report["d"]) == actual.d &&
                        int(report["e"]) == actual.e,
                    "Report must reflect configured search distances");
            require(int(report["corridorRadius"]) == actual.corridorRadius.value_or(-1),
                    "Report must reflect configured corridor");
            std::cout << "PASS generated settings match compiled configuration\n";
        } else if (argc > 1) {
            for (int i = 1; i < argc; ++i)
                parity(argv[i]);
            std::cout << "PASS frontend parity: " << argc - 1 << " fixtures\n";
        } else {
            geometry();
            measurements();
            directional();
            darkOnly();
            invalid();
            std::cout
                << "PASS homography, measurements, directional decisions and invalid inputs\n";
        }
        return 0;
    } catch (const std::exception &e) {
        std::cerr << "FAIL " << e.what() << '\n';
        return 1;
    }
}
