#include "CrFingerDetection.hpp"
#include "Fingertips.hpp"
#include "Homography.hpp"
#include "MidShadow.hpp"
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
void crFingers() {
    cv::Mat reference(32, 40, CV_8UC4, cv::Scalar(100, 100, 100, 255));
    auto current = reference.clone();
    current.at<cv::Vec4b>(1, 1) = {200, 100, 100, 255}; // Brighter, positive Cr change.
    current.at<cv::Vec4b>(1, 2) = {0, 100, 100, 255};   // Negative Cr change.
    current.at<cv::Vec4b>(1, 3) = {20, 20, 20, 255};    // Neutral darkening: not a finger.
    current.at<cv::Vec4b>(1, 4) = {110, 100, 100, 255}; // Below Cr10.
    current.at<cv::Vec4b>(1, 5) = {200, 100, 100, 0};
    current.at<cv::Vec4b>(1, 6) = {200, 100, 100, 255};
    reference.at<cv::Vec4b>(1, 6)[3] = 0;
    reference.at<cv::Vec4b>(1, 7) = {0, 0, 0, 255};
    current.at<cv::Vec4b>(1, 7) = {255, 0, 0, 255}; // No reference-luma gate.
    const auto original = current.clone(), empty = reference.clone();
    const auto mask = crChangeFingerMask(current, reference);
    require(mask[41] && mask[42], "Absolute Cr detects both signs without a darkening gate");
    require(!mask[43] && !mask[44] && !mask[0],
            "Neutral shadow, low Cr and unchanged background excluded");
    require(!mask[45] && !mask[46] && mask[47],
            "Alpha respected without reference brightness gate");
    require(!crChangeFingerMask(current, reference, 255)[41], "Cr threshold override");
    require(!crChangeFingerMask(current, reference, 0)[0],
            "Zero change is excluded at threshold zero");
    require(cv::norm(original, current, cv::NORM_INF) == 0 &&
                cv::norm(empty, reference, cv::NORM_INF) == 0,
            "Cr classifier does not mutate input");
    const auto roi = cv::Rect(1, 1, 20, 20);
    require(crChangeFingerMask(current(roi), reference(roi)) ==
                crChangeFingerMask(current(roi).clone(), reference(roi).clone()),
            "Noncontiguous Cr input");
    rejects([&] { crChangeFingerMask(current, reference, -1); });
    rejects([&] { crChangeFingerMask(current, reference, NAN); });
    rejects([&] { crChangeFingerMask(current, reference, 256); });
    rejects([&] { crChangeFingerMask(current, cv::Mat(3, 4, CV_8UC4)); });
    rejects([&] { identifyFingertipsFromMask(10, 10, std::vector<uint8_t>(100, 2)); });
    cv::Mat largeRef(100, 80, CV_8UC4, cv::Scalar(230, 230, 230, 255));
    auto finger = largeRef.clone();
    finger(cv::Rect(30, 10, 20, 51)).setTo(cv::Scalar(150, 95, 75, 255));
    const auto tips = identifyCrChangeFingertips(finger, largeRef);
    require(tips.candidates.size() == 1 && tips.candidates[0].x == 40 && tips.candidates[0].y == 60,
            "Cr mask uses the same plateau fingertip geometry");
}
void crOtsuFingertips() {
    cv::Mat reference(100, 80, CV_8UC4, cv::Scalar(230, 230, 230, 255));
    auto current = reference.clone();
    current(cv::Rect(30, 10, 20, 51)).setTo(cv::Scalar(150, 120, 120, 255)); // Cr~15, seed.
    const cv::Vec4b weak{150, 130, 130, 255}; // Cr~10, below seed threshold13.
    for (int y = 58; y <= 60; ++y)
        current.at<cv::Vec4b>(y, 29) = weak;
    for (int y = 59; y <= 60; ++y)
        for (int x = 27; x <= 28; ++x)
            current.at<cv::Vec4b>(y, x) = weak;
    for (int y = 61; y <= 64; ++y)
        for (int x = 38; x <= 42; ++x)
            current.at<cv::Vec4b>(y, x) = weak;
    current.at<cv::Vec4b>(40, 29) = weak; // Farther up the finger: leave unchanged.
    for (int y = 52; y <= 64; ++y)
        current.at<cv::Vec4b>(y, 50)[3] = 0; // Gap blocks connection to an island.
    current.at<cv::Vec4b>(60, 51) = weak;
    const auto before = current.clone();
    const auto result = refineCrFingertipsWithOtsu(current, reference, 13, 2);
    require(result.original.candidates.size() == 1, "Single original Cr fingertip");
    require(result.refined.mask[60 * 80 + 29] && result.refined.mask[60 * 80 + 28],
            "Otsu recovers connected weak left edge within2 pixels");
    require(!result.refined.mask[60 * 80 + 27] && !result.refined.mask[63 * 80 + 40],
            "Otsu does not grow a third pixel");
    require(!result.refined.mask[40 * 80 + 29], "Otsu does not grow the finger shaft");
    require(!result.refined.mask[60 * 80 + 50] && !result.refined.mask[60 * 80 + 51],
            "Unavailable gap and disconnected island remain excluded");
    require(result.original.mask == crChangeFingerMask(current, reference, 13),
            "Original Cr mask retained");
    for (int y = 0; y < 100; ++y)
        for (int x = 0; x < 80; ++x) {
            const int i = y * 80 + x;
            require(!result.original.mask[i] || result.refined.mask[i],
                    "Refinement never removes original fingers");
            if (!result.refined.mask[i] || result.original.mask[i])
                continue;
            bool anchored = false;
            for (int dy = -2; dy <= 2; ++dy)
                for (int dx = -2; dx <= 2; ++dx) {
                    const int nx = x + dx, ny = y + dy;
                    if (dx * dx + dy * dy <= 4 && nx >= 0 && nx < 80 && ny >= 56 && ny <= 60 &&
                        result.original.mask[ny * 80 + nx])
                        anchored = true;
                }
            require(anchored, "All additions obey original distal Euclidean radius2");
        }
    const auto onePixel = refineCrFingertipsWithOtsu(current, reference, 13, 1);
    require(onePixel.refined.mask[60 * 80 + 29] && !onePixel.refined.mask[60 * 80 + 28],
            "Radius1 override");
    require(refineCrFingertipsWithOtsu(current, reference, 13, 2).refined.mask ==
                result.refined.mask,
            "Repeated frames do not accumulate growth");
    require(cv::norm(before, current, cv::NORM_INF) == 0, "Otsu input unchanged");
    require(refineCrFingertipsWithOtsu(reference, reference, 13, 2).regions.empty(),
            "No seeds means no expansion");
    rejects([&] { refineCrFingertipsWithOtsu(current, reference, 13, 0); });
    rejects([&] { refineCrFingertipsWithOtsu(current, reference, 13, 3); });

    // Independently verify the local threshold against OpenCV's Otsu on the
    // same unamplified Cr samples (alpha-invalid samples excluded).
    const auto &region = result.regions.at(0);
    std::vector<uint8_t> samples;
    for (int y = region.y; y < region.y + region.height; ++y)
        for (int x = region.x; x < region.x + region.width; ++x) {
            if (!current.at<cv::Vec4b>(y, x)[3])
                continue;
            cv::Mat rgb(1, 2, CV_32FC3);
            const auto p = current.at<cv::Vec4b>(y, x), ref = reference.at<cv::Vec4b>(y, x);
            rgb.at<cv::Vec3f>(0, 0) = cv::Vec3f(p[0], p[1], p[2]) / 255;
            rgb.at<cv::Vec3f>(0, 1) = cv::Vec3f(ref[0], ref[1], ref[2]) / 255;
            cv::Mat converted;
            cv::cvtColor(rgb, converted, cv::COLOR_RGB2YCrCb);
            samples.push_back(
                cv::saturate_cast<uint8_t>(255 * std::abs(converted.at<cv::Vec3f>(0, 0)[1] -
                                                          converted.at<cv::Vec3f>(0, 1)[1])));
        }
    cv::Mat binary;
    const double threshold = cv::threshold(cv::Mat(samples).reshape(1, 1), binary, 0, 255,
                                           cv::THRESH_BINARY | cv::THRESH_OTSU);
    require(threshold == region.threshold && region.addedPixels > 0,
            "Local raw Cr Otsu threshold matches OpenCV");
}
void crShadowEvidence() {
    cv::Mat reference(100, 80, CV_8UC4, cv::Scalar(230, 230, 230, 255));
    auto current = reference.clone();
    current(cv::Rect(30, 10, 20, 51)).setTo(cv::Scalar(150, 95, 75, 255));
    for (int y = 52; y <= 60; ++y)
        current.at<cv::Vec4b>(y, 29) = {30, 30, 100, 255};
    for (int x = 27; x <= 29; ++x)
        current.at<cv::Vec4b>(54, x) = {30, 30, 100, 255};
    current.at<cv::Vec4b>(3, 3) = {0, 0, 0, 255};
    current.at<cv::Vec4b>(3, 4) = {111, 111, 111, 255};
    current.at<cv::Vec4b>(3, 5) = {110, 110, 110, 255};
    current.at<cv::Vec4b>(3, 6) = {210, 210, 210, 255};
    current.at<cv::Vec4b>(3, 7)[3] = 0;
    reference.at<cv::Vec4b>(3, 8)[3] = 0;
    reference.at<cv::Vec4b>(3, 9) = {10, 10, 10, 255};
    auto d = measureShadowDifference(current, reference);
    const auto tips = identifyCrChangeFingertips(current, reference, 13);
    CandidateFilter crFilter;
    crFilter.method = FilterMethod::FingerMask;
    ShadowPathSettings settings;
    settings.maximumCurrentLuma = 110;
    require(d.residualCurrent[55 * 80 + 29] > 0.125 && !tips.mask[55 * 80 + 29],
            "Cr frees dark pixels previously rejected by projection");
    const auto oldPaths =
        measureMonotoneShadowPaths(d, tips.mask, tips.candidates.at(0), {}, settings);
    const auto newPaths =
        measureMonotoneShadowPaths(d, tips.mask, tips.candidates.at(0), crFilter, settings);
    require(oldPaths.levels[1].patternMatch == false && newPaths.levels[1].patternMatch == true,
            "DFS uses Cr-excluded shadow pixels without residual veto");
    const auto state = [&](int x) {
        return classifyShadowPixel(d, tips.mask, 3 * 80 + x, 20, crFilter, 110);
    };
    require(state(3) == ShadowPixelState::Shadow && !d.projectionValid[3 * 80 + 3],
            "Opaque black shadow does not require a chromaticity measurement");
    require(state(4) == ShadowPixelState::Clear && state(5) == ShadowPixelState::Shadow,
            "Dark shadow gate remains inclusive110");
    require(state(6) == ShadowPixelState::Clear && state(0) == ShadowPixelState::Clear,
            "Strict darkening cutoff and unchanged background remain clear");
    require(state(7) == ShadowPixelState::Unknown && state(8) == ShadowPixelState::Unknown &&
                state(9) == ShadowPixelState::Unknown,
            "Unavailable/reference-floor evidence remains unknown");
    require(classifyShadowPixel(d, tips.mask, 40 * 80 + 40, 20, crFilter, 110) ==
                ShadowPixelState::Clear,
            "Cr fingers cannot also be shadows");
    rejects([&] { filteredDarkeningBoundaryMask(d, crFilter); });
}
void lightShadow() {
    cv::Mat ref(80, 80, CV_8UC4, cv::Scalar(230, 230, 230, 255));
    auto frame = ref.clone();
    std::vector<uint8_t> mask(80 * 80);
    for (int y = 20; y <= 40; ++y)
        for (int x = 30; x <= 49; ++x)
            mask[y * 80 + x] = 1;
    Fingertip tip;
    tip.x = 40;
    tip.y = 40;
    tip.width = 20;
    ShadowPaths paths;
    paths.aY = 36;
    paths.crossSectionComplete = true;
    paths.levels[1].patternMatch = false;
    for (int x = 30; x <= 49; ++x)
        paths.arc.push_back({x, 40});
    const auto run = [&] {
        return measureLightShadow(measureShadowDifference(frame, ref), mask, tip, paths);
    };
    require(!run().matched, "Clear paper alone is not a press");
    frame(cv::Rect(27, 34, 3, 12)).setTo(cv::Scalar(210, 210, 210, 255));
    require(!run().matched, "One side shadow is insufficient");
    frame(cv::Rect(50, 34, 3, 12)).setTo(cv::Scalar(210, 210, 210, 255));
    auto evidence = run();
    require(evidence.matched && evidence.clearStrip.size() == 20,
            "Light shadows on both sides support a clear front strip");
    require(!evidence.leftShadow.empty() && !evidence.rightShadow.empty(),
            "Matched result retains both blob witnesses");
    paths.light = evidence;
    require(finalShadowDecision(paths) == true && paths.levels[1].patternMatch == false,
            "Fallback accepts without overwriting dark failure");
    frame(cv::Rect(30, 41, 20, 1)).setTo(cv::Scalar(224, 224, 224, 255));
    require(!run().matched, "Even thin light shadow across the whole front rejects");
    frame(cv::Rect(30, 41, 20, 1)).setTo(cv::Scalar(230, 230, 230, 255));
    frame(cv::Rect(30, 42, 20, 1)).setTo(cv::Scalar(210, 210, 210, 255));
    require(!run().matched, "One clear row before shadow is not a two-row clear band");
    frame(cv::Rect(30, 42, 20, 1)).setTo(cv::Scalar(230, 230, 230, 0));
    require(!run().matched, "Unavailable pixels cannot supply the clear band");
    frame = ref.clone();
    frame.at<cv::Vec4b>(40, 29) = {210, 210, 210, 255};
    frame.at<cv::Vec4b>(40, 50) = {210, 210, 210, 255};
    require(!run().matched, "Side specks cannot supply substantial blobs");
    frame = ref.clone();
    frame(cv::Rect(27, 34, 3, 12)).setTo(cv::Scalar(210, 210, 210, 255));
    frame(cv::Rect(50, 34, 3, 12)).setTo(cv::Scalar(210, 210, 210, 255));
    frame(cv::Rect(30, 41, 20, 1)).setTo(cv::Scalar(210, 210, 210, 255));
    frame(cv::Rect(39, 41, 1, 1)).setTo(cv::Scalar(230, 230, 230, 255));
    require(!run().matched, "One-pixel opening is shorter than the minimum strip");
    frame.at<cv::Vec4b>(41, 40) = {230, 230, 230, 255};
    require(run().matched, "Two-pixel opening between supported shadows passes");
    frame(cv::Rect(30, 43, 20, 1)).setTo(cv::Scalar(210, 210, 210, 255));
    evidence = run();
    require(evidence.matched, "Two sides may connect into the same larger shadow blob");
    paths.crossSectionComplete = false;
    require(!run().matched, "Incomplete fingertip cannot pass");
    paths.levels[1].patternMatch = true;
    evidence = run();
    require(!evidence.evaluated && evidence.reason == "dark-pass",
            "Dark success skips the light test");
    rejects([&] { measureLightShadow(measureShadowDifference(frame, ref), {}, tip, paths); });
}
void midShadow() {
    cv::Mat ref(80, 80, CV_8UC4, cv::Scalar(230, 230, 230, 255));
    auto frame = ref.clone();
    std::vector<uint8_t> mask(80 * 80);
    Fingertip tip;
    tip.x = 40;
    tip.y = 40;
    tip.width = 20;
    ShadowPaths paths;
    paths.crossSectionComplete = true;
    paths.levels[1].patternMatch = false;
    for (int y = 20; y <= 40; ++y)
        for (int x = 30; x <= 49; ++x)
            mask[y * 80 + x] = 1;
    for (int x = 30; x <= 49; ++x)
        paths.arc.push_back({x, 40});
    const auto run = [&] {
        return measureMidShadow(measureShadowDifference(frame, ref), mask, tip, paths);
    };
    const auto wedge = [&](int side, int onset, bool constant = false) {
        frame = ref.clone();
        for (int up = 0; up <= 10; ++up) {
            const int width = constant ? 4 : (up < onset ? 1 : 2 + up - onset);
            for (int step = 1; step <= width; ++step)
                frame.at<cv::Vec4b>(40 - up, (side < 0 ? 30 : 49) + side * step) = {180, 180, 180,
                                                                                    255};
        }
    };
    require(!run().matched, "Clear paper cannot pass the mid algorithm");
    for (int side : {-1, 1}) {
        wedge(side, 1);
        auto evidence = run();
        require(evidence.matched && evidence.direction == side && evidence.onset == 1,
                "Either single brown side opening near the tip is sufficient");
        require(!evidence.mass.empty() && evidence.boundary.size() == 7,
                "Mid result retains brown mass and measured boundaries");
    }
    // One brown plus one gray pixel per outward front scan is allowed;
    // lavender is ignored, while unavailable samples remain barriers.
    frame(cv::Rect(35, 41, 11, 1)).setTo(cv::Scalar(180, 180, 180, 255));
    frame(cv::Rect(35, 42, 11, 1)).setTo(cv::Scalar(200, 200, 200, 255));
    frame(cv::Rect(35, 43, 11, 2)).setTo(cv::Scalar(220, 220, 220, 255));
    require(run().matched, "Thin brown/gray front and faint remainder pass");
    frame(cv::Rect(35, 42, 11, 1)).setTo(cv::Scalar(180, 180, 180, 255));
    require(!run().matched, "Two brown front pixels reject");
    frame(cv::Rect(35, 41, 11, 2)).setTo(cv::Scalar(200, 200, 200, 255));
    require(!run().matched, "Two gray front pixels reject");
    frame(cv::Rect(35, 41, 11, 4)).setTo(cv::Scalar(230, 230, 230, 0));
    require(!run().matched, "Unavailable front cannot be interpreted as thin");
    frame(cv::Rect(40, 41, 1, 4)).setTo(cv::Scalar(230, 230, 230, 255));
    require(!run().matched, "A single thin front column is insufficient");
    frame(cv::Rect(41, 41, 1, 4)).setTo(cv::Scalar(230, 230, 230, 255));
    require(run().matched, "Two consecutive thin front columns suffice");
    wedge(1, 1);
    frame(cv::Rect(35, 41, 11, 1)).setTo(cv::Scalar(110, 110, 110, 255));
    require(!run().matched, "Dark front evidence is not ignored");
    wedge(1, 4);
    require(!run().matched, "Opening beginning too far up the finger rejects");
    wedge(1, 1, true);
    require(!run().matched, "Constant-width side band is not an outward opening");
    // A slanted finger and parallel shadow boundary still have constant
    // separation; image-space slope alone must not qualify.
    frame = ref.clone();
    std::fill(mask.begin(), mask.end(), 0);
    for (int up = 0; up <= 20; ++up) {
        for (int x = 30 + up; x <= 49 + up; ++x)
            mask[(40 - up) * 80 + x] = 1;
        for (int x = 50 + up; x <= 53 + up; ++x)
            frame.at<cv::Vec4b>(40 - up, x) = {180, 180, 180, 255};
    }
    require(!run().matched, "Angled finger alone does not create relative widening");
    std::fill(mask.begin(), mask.end(), 0);
    for (int y = 20; y <= 40; ++y)
        for (int x = 30; x <= 49; ++x)
            mask[y * 80 + x] = 1;
    wedge(1, 1);
    frame(cv::Rect(50, 37, 10, 1)).setTo(cv::Scalar(180, 180, 180, 0));
    require(!run().matched, "Unavailable side row cannot connect the opening to its mass");
    wedge(1, 1);
    frame(cv::Rect(50, 40, 2, 4)).setTo(cv::Scalar(180, 180, 180, 255));
    require(!run().matched, "Connected mass extending too far below the tip rejects");
    wedge(1, 1);
    frame(cv::Rect(50, 34, 10, 7)).setTo(cv::Scalar(200, 200, 200, 255));
    require(!run().matched, "Gray side shadows do not supply brown opening evidence");
    wedge(1, 1);
    for (int y = 0; y < frame.rows; ++y)
        for (int x = 0; x < frame.cols; ++x)
            if (frame.at<cv::Vec4b>(y, x)[0] == 180)
                frame.at<cv::Vec4b>(y, x) = {210, 210, 210, 255};
    require(!run().matched, "Weak side shadows below the mid threshold do not support opening");
    require(
        measureMidShadow(measureShadowDifference(frame, ref), mask, tip, paths, 210).matched &&
            !measureMidShadow(measureShadowDifference(frame, ref), mask, tip, paths, 209).matched,
        "The selected inclusive dark cap also supplies mid-or-darker support");
    wedge(1, 1);
    for (int up = 0; up <= 6; ++up)
        frame.at<cv::Vec4b>(40 - up, 50) = {110, 110, 110, 255};
    require(run().matched, "Dark pixels adjoining the finger do not break a mid opening");
    wedge(1, 1);
    paths.mid = run();
    require(finalShadowDecision(paths) == true && !paths.light.matched &&
                paths.levels[1].patternMatch == false,
            "Mid success preserves separate dark and light results");
    // A neighboring finger blocks an attached mid/dark band. Visible widths
    // would shrink; blocked rows and their final merge are explicit assumptions.
    frame = ref.clone();
    for (int up = 0; up <= 6; ++up) {
        const int y = 40 - up;
        const int stop = up == 0 ? 53 : (up < 6 ? 55 - up / 2 : 50);
        for (int x = 50; x < stop; ++x)
            frame.at<cv::Vec4b>(y, x) = {180, 180, 180, 255};
        if (up > 0)
            for (int x = stop; x <= 65; ++x)
                mask[y * 80 + x] = 1;
    }
    auto occluded = run();
    require(occluded.matched && occluded.usedOcclusion && occluded.shapeAcceptedByOcclusion,
            "Finger-blocked endpoint supplies assumed opening support");
    require(occluded.rows.back().maskMerged && occluded.rows.back().visibleWidth == 0,
            "Merged finger row retains zero visible width rather than a fabricated length");
    for (auto p : occluded.mass)
        require(!mask[p.y * 80 + p.x], "Finger pixels never count toward visible shadow area");
    auto hiddenMask = mask;
    auto hiddenFrame = frame.clone();
    for (int x = 50; x < 80; ++x)
        mask[34 * 80 + x] = 0;
    frame(cv::Rect(50, 34, 2, 1)).setTo(cv::Scalar(180, 180, 180, 255));
    require(!run().matched,
            "A later visible narrow endpoint uses its actual width despite earlier occlusion");
    mask = hiddenMask;
    frame = hiddenFrame;
    frame(cv::Rect(35, 41, 11, 4)).setTo(cv::Scalar(230, 230, 230, 0));
    require(!run().matched, "Occlusion cannot bypass unavailable front evidence");
    frame = ref.clone();
    require(!run().matched, "Neighboring finger without visible shadow mass cannot pass");
    for (int y = 20; y <= 40; ++y)
        for (int x = 50; x < 80; ++x)
            mask[y * 80 + x] = 0;
    wedge(1, 1, true);
    // Clear/lighter space before a neighboring finger ends the scan normally.
    for (int y = 34; y <= 40; ++y)
        for (int x = 55; x <= 65; ++x)
            mask[y * 80 + x] = 1;
    require(!run().matched, "A clear gap before another finger does not count as occlusion");
    frame(cv::Rect(54, 34, 1, 7)).setTo(cv::Scalar(200, 200, 200, 255));
    require(!run().matched, "A gray gap before another finger does not count as occlusion");
    frame(cv::Rect(54, 34, 1, 7)).setTo(cv::Scalar(180, 180, 180, 0));
    require(!run().matched, "Unavailable pixels cannot bridge to a neighboring finger");
    paths.levels[1].patternMatch = true;
    require(!run().evaluated && run().reason == "dark-pass", "Dark success skips mid");
    paths.levels[1].patternMatch = false;
    paths.light.matched = true;
    require(!run().evaluated && run().reason == "light-pass", "Light success skips mid");
    paths.light.matched = false;
    paths.crossSectionComplete = false;
    require(!run().matched, "Incomplete fingertip cannot pass mid");
    rejects([&] { measureMidShadow(measureShadowDifference(frame, ref), {}, tip, paths); });
    rejects([&] { measureMidShadow(measureShadowDifference(frame, ref), mask, tip, paths, 256); });
}
void independentAlgorithms() {
    cv::Mat ref(80, 80, CV_8UC4, cv::Scalar(230, 230, 230, 255));
    auto frame = ref.clone();
    std::vector<uint8_t> mask(80 * 80);
    for (int y = 20; y <= 40; ++y)
        for (int x = 30; x <= 49; ++x)
            mask[y * 80 + x] = 1;
    Fingertip tip;
    tip.x = 40;
    tip.y = 40;
    tip.width = 20;
    ShadowPaths paths;
    paths.crossSectionComplete = true;
    paths.levels[1].patternMatch = true;
    for (int x = 30; x <= 49; ++x)
        paths.arc.push_back({x, 40});
    auto d = measureShadowDifference(frame, ref);
    require(!measureLightShadow(d, mask, tip, paths).evaluated,
            "Combined light still skips a dark acceptance");
    paths.light = measureLightShadow(d, mask, tip, paths, true);
    require(paths.light.evaluated && !paths.light.matched,
            "Independent light evaluates and rejects clear paper despite dark acceptance");
    paths.algorithm = ShadowAlgorithm::Light;
    require(finalShadowDecision(paths) == false,
            "Dark acceptance cannot override light-only failure");
    frame(cv::Rect(27, 34, 3, 12)).setTo(cv::Scalar(210, 210, 210, 255));
    frame(cv::Rect(50, 34, 3, 12)).setTo(cv::Scalar(210, 210, 210, 255));
    d = measureShadowDifference(frame, ref);
    paths.light = measureLightShadow(d, mask, tip, paths, true);
    require(paths.light.matched && finalShadowDecision(paths) == true,
            "Independent light can accept a candidate also accepted by dark");
    paths.mid = measureMidShadow(d, mask, tip, paths, 110, true);
    paths.algorithm = ShadowAlgorithm::Mid;
    require(paths.mid.evaluated && !paths.mid.matched && finalShadowDecision(paths) == false,
            "Independent mid rejects gray sides despite both dark and light acceptance");
    require(!measureMidShadow(d, mask, tip, paths).evaluated,
            "Combined mid retains its earlier-success skip");
    frame = ref.clone();
    for (int up = 0; up <= 10; ++up)
        for (int x = 50; x <= 50 + up; ++x)
            frame.at<cv::Vec4b>(40 - up, x) = {180, 180, 180, 255};
    paths.mid = measureMidShadow(measureShadowDifference(frame, ref), mask, tip, paths, 110, true);
    require(paths.mid.matched && finalShadowDecision(paths) == true,
            "Independent mid measures visible geometry even when earlier algorithms pass");
    paths.light.matched = false;
    paths.algorithm = ShadowAlgorithm::Light;
    require(finalShadowDecision(paths) == false,
            "Mid acceptance cannot override light-only failure");
    paths.algorithm = ShadowAlgorithm::Dark;
    paths.levels[1].patternMatch = false;
    require(finalShadowDecision(paths) == false, "Light/mid cannot override dark-only failure");
    paths.levels[1].patternMatch.reset();
    require(!finalShadowDecision(paths), "Dark-only UNKNOWN is preserved");
    paths.algorithm = ShadowAlgorithm::Combined;
    require(finalShadowDecision(paths) == true, "Combined mode still accepts a fallback match");
    paths.crossSectionComplete = false;
    paths.algorithm = ShadowAlgorithm::Mid;
    paths.mid = measureMidShadow(d, mask, tip, paths, 110, true);
    require(!finalShadowDecision(paths), "Independent incomplete mid geometry remains UNKNOWN");
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
        oracleSettings.d = 4; // Freeze the historical frontend oracle, independent of native d2.
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
            if (std::string(report["fingerMethod"]) == "cr" ||
                std::string(report["fingerMethod"]) == "cr-otsu")
                require(double(report["minimumAbsoluteCrChange"]) == defaultCrFingerThreshold,
                        "Report must inherit compiled Cr default when no override is passed");
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
            crFingers();
            crOtsuFingertips();
            crShadowEvidence();
            directional();
            darkOnly();
            lightShadow();
            midShadow();
            independentAlgorithms();
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
