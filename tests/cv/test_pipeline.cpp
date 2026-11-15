#include "Constants.hpp"
#include "ContactGeometry.hpp"
#include "FingerSegmentation.hpp"
#include "Pipeline.hpp"
#include "ShadowView.hpp"
#include <cmath>
#include <functional>
#include <iostream>
#include <limits>
#include <opencv2/imgproc.hpp>
#include <stdexcept>

using namespace makeshift::vision;
namespace {
void require(bool value, const char *message) {
    if (!value) throw std::runtime_error(message);
}
void rejects(const std::function<void()> &operation) {
    bool rejected = false;
    try { operation(); } catch (const std::invalid_argument &) { rejected = true; }
    require(rejected, "Invalid input must throw");
}
cv::Mat paper() { return cv::Mat(80, 80, CV_8UC4, cv::Scalar(230, 230, 230, 255)); }
void referenceLifecycle() {
    Pipeline pipeline;
    auto reference = paper(), frame = reference.clone();
    require(!pipeline.processFrame(frame, frame.size()).ready, "No reference, no decisions");
    pipeline.setReference(reference, reference.size());
    reference.setTo(cv::Scalar(0, 0, 0, 0));
    auto result = pipeline.processFrame(frame, frame.size());
    require(result.ready && result.contacts.empty() && result.shadows.valid[0] &&
            result.shadows.score[0] == 0, "Reference is an owned snapshot");
    const auto revision = result.referenceRevision;
    require(!pipeline.processFrame(frame, {160, 160}).ready && !pipeline.geometry() &&
            pipeline.referenceRevision() > revision, "Native size changes invalidate reference/geometry");
    pipeline.setReference(frame, frame.size());
    require(!pipeline.processFrame(cv::Mat(40, 40, CV_8UC4), frame.size()).ready,
            "Analysis size changes invalidate reference");
    pipeline.setReference(frame, frame.size());
    rejects([&] { pipeline.setReference(cv::Mat(80, 80, CV_8UC3), frame.size()); });
    require(pipeline.ready(), "Failed replacement leaves valid reference intact");
    pipeline.reset();
    require(!pipeline.ready() && !pipeline.processFrame(frame, frame.size()).ready,
            "Reset produces no stale contacts");
    rejects([&] { pipeline.setReference(frame, {40, 40}); });
    rejects([&] { pipeline.setReference(cv::Mat(641, 1, CV_8UC4), {641, 641}); });
}
void segmentation() {
    require(rgbDropsAreFinger(30, 15, 0) && !rgbDropsAreFinger(29, 15, 0) &&
            !rgbDropsAreFinger(30, 14, 0), "Exact RGB spread/low-channel boundaries");
    auto reference = paper(), frame = reference.clone();
    frame(cv::Rect(30, 10, 20, 41)).setTo(cv::Scalar(150, 95, 75, 255));
    auto mask = seedFingers(frame, reference, std::vector<uint8_t>(6400));
    auto tips = identifyFingertipsFromMask(80, 80, mask);
    require(tips.candidates.size() == 1 && tips.candidates[0].y == 50 &&
            tips.candidates[0].width == 20, "Supported fingertip geometry");
    // Two red exterior pixels: only the one adjacent to frozen seeds may grow.
    frame.at<cv::Vec4b>(51, 40) = {255, 0, 0, 255};
    frame.at<cv::Vec4b>(52, 40) = {255, 0, 0, 255};
    const auto grown = refineFingerMask(frame, tips);
    require(grown[51 * 80 + 40] && !grown[52 * 80 + 40] && tips.mask == mask,
            "Frozen one-ring growth excludes second-hop pixels and preserves input");
    require(!normalizedLinearRgbGap({0, 0, 0, 255}) &&
            *normalizedLinearRgbGap({100, 100, 100, 255}) == 0, "Zero and neutral normalized color");
    auto blackReference = cv::Mat(1, 2, CV_8UC4, cv::Scalar(30, 30, 30, 255));
    cv::Mat bright(1, 2, CV_8UC4, cv::Scalar(200, 130, 100, 255));
    const auto recovered = seedFingers(bright, blackReference, {1, 0});
    require(recovered[0] && !recovered[1], "Reverse RGB recovery is localized to geometric black region");
    rejects([&] { seedFingers(frame, reference, {}); });
    rejects([&] { identifyFingertipsFromMask(80, 80, {1}); });
}
void blackMeasurements() {
    cv::Mat reference(1, 7, CV_8UC4, cv::Scalar(30, 30, 30, 255));
    auto frame = reference.clone();
    frame.setTo(cv::Scalar(15, 15, 15, 255));
    frame.at<cv::Vec4b>(0, 2) = {25, 25, 25, 255};
    reference.at<cv::Vec4b>(0, 3) = {5, 5, 5, 255};
    frame.at<cv::Vec4b>(0, 3) = {0, 0, 0, 255};
    reference.at<cv::Vec4b>(0, 4) = {4, 4, 4, 255};
    frame.at<cv::Vec4b>(0, 5)[3] = 0;
    const auto result = measureShadows(frame, reference, {1, 1, 1, 1, 1, 1, 1});
    require(result.rawDrop[1] == 15 && result.score[1] == 50 && result.valid[1],
            "Black raw drop and percent score retained separately");
    require(result.score[0] == 0 && result.score[6] == 0 && result.score[2] == 0,
            "Side inset and raw drop exactly five supply no amplified score");
    require(result.valid[3] && !result.valid[4] && !result.valid[5], "Reference floor and alpha availability");
    require(!measureShadows(frame, reference, std::vector<uint8_t>(7)).valid[1],
            "White pixels keep reference floor forty");
    KeyboardGeometry g{{1.0 / 200, 0, 0, 0, 1.0 / 200, 0, 0, 0, 1}, {}, 1};
    for (int octaves : {1, 2, 3}) {
        g.octaves = octaves;
        const auto region = projectBlackKeys(g, {200, 200}, {200, 200});
        const double span = (7 * octaves + 1) * 23.5 - 2 * constants::markerInsetMm;
        for (int octave = 0; octave < octaves; ++octave) {
            for (int boundary : {1, 2, 4, 5, 6}) {
                const int x = cvRound(((7 * octave + boundary) * 23.5 - constants::markerInsetMm) / span * 200);
                require(region[50 * 200 + x] && !region[150 * 200 + x],
                        "Projected black rectangles occupy printed top region for every octave");
            }
        }
    }
    g.octaves = 4;
    rejects([&] { projectBlackKeys(g, {200, 200}, {200, 200}); });
}
struct Fixture {
    cv::Mat reference = paper(), frame = reference.clone();
    std::vector<uint8_t> mask = std::vector<uint8_t>(6400);
    Fingertip tip{1, 40, 40, 1, 20};
    ContactGeometry geometry;
    Fixture() {
        for (int y = 20; y <= 40; ++y)
            for (int x = 30; x <= 49; ++x) mask[y * 80 + x] = 1;
        geometry = distalGeometry(measure(), mask, tip);
    }
    ShadowMeasurements measure() { return measureShadows(frame, reference, std::vector<uint8_t>(6400)); }
};
void contactRules() {
    Fixture f;
    require(darkContact(f.measure(), f.mask, f.tip, f.geometry) == false &&
            !lightContact(f.measure(), f.mask, f.tip, f.geometry) &&
            !midContact(f.measure(), f.mask, f.tip, f.geometry, 20), "Paper alone is not contact");
    for (int drop : {60, 61}) {
        f.frame = f.reference.clone();
        f.frame(cv::Rect(27, 32, 3, 9)).setTo(cv::Scalar(230 - drop, 230 - drop, 230 - drop, 255));
        require(darkContact(f.measure(), f.mask, f.tip, f.geometry) == (drop > 60),
                "Strict dark floor above sixty");
    }
    f.frame(cv::Rect(27, 41, 3, 2)).setTo(cv::Scalar(160, 160, 160, 255));
    require(darkContact(f.measure(), f.mask, f.tip, f.geometry) == false,
            "Same-seed paired support/veto cannot accept");
    f.frame = f.reference.clone();
    f.frame(cv::Rect(27, 34, 3, 7)).setTo(cv::Scalar(210, 210, 210, 255));
    require(!lightContact(f.measure(), f.mask, f.tip, f.geometry), "One light side cannot accept");
    f.frame(cv::Rect(50, 34, 3, 7)).setTo(cv::Scalar(210, 210, 210, 255));
    require(lightContact(f.measure(), f.mask, f.tip, f.geometry), "Two substantial light sides accept");
    f.frame(cv::Rect(30, 41, 20, 2)).setTo(cv::Scalar(230, 230, 230, 0));
    require(!lightContact(f.measure(), f.mask, f.tip, f.geometry), "Unknown is never clear paper");
    for (int drop : {20, 21, 40, 41}) {
        f.frame = f.reference.clone();
        for (int up = 0; up <= 10; ++up)
            for (int step = 1; step <= 1 + up; ++step)
                f.frame.at<cv::Vec4b>(40 - up, 49 + step) =
                    {uint8_t(230 - drop), uint8_t(230 - drop), uint8_t(230 - drop), 255};
        require(midContact(f.measure(), f.mask, f.tip, f.geometry, 20) == (drop > 20) &&
                midContact(f.measure(), f.mask, f.tip, f.geometry, 40) == (drop > 40),
                "Mid side floors are strict and distinct");
    }
    f.frame(cv::Rect(35, 41, 11, 4)).setTo(cv::Scalar(150, 150, 150, 255));
    require(!midContact(f.measure(), f.mask, f.tip, f.geometry, 20), "Dark front rejects mid");
}
void homographyEligibility() {
    // The playable footprint extends horizontally beyond the marker-center square.
    // Test every edge and corner through a perspective transform, for 1..3 octaves.
    const std::array<Point, 4> camera{{{10, 5}, {150, 18}, {130, 140}, {5, 110}}};
    const std::array<Point, 4> sheet{{{0, 0}, {1, 0}, {1, 1}, {0, 1}}};
    const auto transform = computeHomography(camera, sheet);
    require(bool(transform), "Perspective test transform");
    const auto inverse = invertHomography(*transform);
    for (int octaves : {1, 2, 3}) {
        KeyboardGeometry keyboard{*transform, {}, octaves};
        const double span = (7 * octaves + 1) * constants::whitePitchMm -
                            2 * constants::markerInsetMm;
        const double left = -constants::markerInsetMm / span;
        const double right = 1 + constants::markerInsetMm / span;
        const auto contains = [&](double u, double v) {
            return keyboard.withinHomography(*projectPoint(*inverse, {u, v}));
        };
        // Stay a tiny distance inside/outside when testing round-tripped boundaries.
        constexpr double inset = 1e-7;
        for (double u : {left + inset, 0.5, right - inset}) {
            require(contains(u, constants::keyTop + inset) &&
                    contains(u, constants::keyBottom - inset), "Playable corners inside perspective homography");
            require(!contains(u, constants::keyTop - inset) &&
                    !contains(u, constants::keyBottom + inset), "Vertical outside points rejected");
        }
        require(contains(left + inset, 0.5) && contains(right - inset, 0.5) &&
                !contains(left - inset, 0.5) && !contains(right + inset, 0.5),
                "Horizontal edges use the full keyboard rather than the marker square");
        require(!keyboard.withinHomography({NAN, 1}) &&
                !keyboard.withinHomography({1, INFINITY}), "Nonfinite points rejected");
    }
    KeyboardGeometry identity{{1, 0, 0, 0, 1, 0, 0, 0, 1}, {}, 1};
    require(identity.withinHomography({0.5, constants::keyTop}) &&
            identity.withinHomography({0.5, constants::keyBottom}), "Exact vertical boundaries inclusive");
    KeyboardGeometry singular{{0, 0, 0.5, 0, 0, 0.5, 0, 0, 1}, {}, 1};
    require(!singular.withinHomography({1, 1}), "Singular transform cannot admit points");

    auto reference = paper(), frame = reference.clone();
    frame(cv::Rect(30, 20, 20, 21)).setTo(cv::Scalar(150, 95, 75, 255));
    // Yellow has two zero drops: no RGB seed, but it passes normalized refinement.
    frame.at<cv::Vec4b>(41, 40) = {230, 230, 0, 255};
    frame.at<cv::Vec4b>(42, 40) = {230, 230, 0, 255};
    const auto seeds = seedFingers(frame, reference, std::vector<uint8_t>(6400));
    require(!seeds[41 * 80 + 40], "Growth probe must not already be a seed");
    Pipeline pipeline;
    pipeline.setReference(reference, reference.size());
    auto result = pipeline.processFrame(frame, frame.size());
    require(result.fingerMask == seeds && !result.contacts.empty() &&
            result.contacts[0].state == ContactState::Released,
            "Missing geometry skips refinement and cannot generate a press");
    KeyboardGeometry keyboard{{1.0 / 80, 0, 3, 0, 1.0 / 80, 0, 0, 0, 1}, {}, 1};
    pipeline.setReference(reference, {160, 160}, keyboard);
    result = pipeline.processFrame(frame, {160, 160});
    require(result.fingerMask == seeds && result.contacts[0].state == ContactState::Released,
            "Outside tip skips refinement and contact even with native/analysis scaling");
    keyboard.frameToSheet = {1.0 / 160, 0, 0, 0, 1.0 / 160, 0, 0, 0, 1};
    pipeline.setReference(reference, {160, 160}, keyboard);
    result = pipeline.processFrame(frame, {160, 160});
    require(result.fingerMask[41 * 80 + 40] && !result.fingerMask[42 * 80 + 40],
            "Inside scaled tip receives the same frozen one-ring refinement");
    keyboard.frameToSheet = {1.0 / 80, 0, 0, 0, 0.01, 0.5, 0, 0, 1};
    pipeline.setReference(reference, frame.size(), keyboard);
    result = pipeline.processFrame(frame, frame.size());
    require(result.fingerMask[41 * 80 + 40] && result.contacts[0].tip.y == 41 &&
            result.contacts[0].state == ContactState::Released,
            "Refined tip crossing the boundary is gated again before shadow searches");

    auto mixed = reference.clone();
    mixed(cv::Rect(10, 20, 12, 21)).setTo(cv::Scalar(150, 95, 75, 255));
    mixed(cv::Rect(50, 20, 12, 21)).setTo(cv::Scalar(150, 95, 75, 255));
    mixed.at<cv::Vec4b>(41, 16) = mixed.at<cv::Vec4b>(41, 56) = {230, 230, 0, 255};
    keyboard.frameToSheet = {1.0 / 40, 0, 0, 0, 1.0 / 80, 0, 0, 0, 1};
    pipeline.setReference(reference, mixed.size(), keyboard);
    const auto mixedResult = pipeline.processFrame(mixed, mixed.size());
    require(mixedResult.fingerMask[41 * 80 + 16] && !mixedResult.fingerMask[41 * 80 + 56] &&
            mixedResult.fingerMask[30 * 80 + 56],
            "Mixed frame refines only eligible tip while retaining outside fingers as occluders");

    // This contact would pass the light fallback inside; outside/missing must release.
    frame.at<cv::Vec4b>(41, 40) = frame.at<cv::Vec4b>(42, 40) = {230, 230, 230, 255};
    frame(cv::Rect(27, 34, 3, 7)).setTo(cv::Scalar(210, 210, 210, 255));
    frame(cv::Rect(50, 34, 3, 7)).setTo(cv::Scalar(210, 210, 210, 255));
    keyboard.frameToSheet = {1.0 / 80, 0, 0, 0, 1.0 / 80, 0, 0, 0, 1};
    pipeline.setReference(reference, frame.size(), keyboard);
    require(pipeline.processFrame(frame, frame.size()).contacts[0].state == ContactState::Pressed,
            "Eligible light contact still accepts");
    keyboard.frameToSheet[2] = 3;
    pipeline.setReference(reference, frame.size(), keyboard);
    require(pipeline.processFrame(frame, frame.size()).contacts[0].state == ContactState::Released,
            "Identical contact outside geometry releases");
    pipeline.setReference(reference, frame.size());
    require(pipeline.processFrame(frame, frame.size()).contacts[0].state == ContactState::Released,
            "Identical contact without geometry releases");
}
void pressAnchors() {
    cv::Mat reference(160, 640, CV_8UC4, cv::Scalar(230, 230, 230, 255));
    KeyboardGeometry keyboard{{1.0 / 1280, 0, 0, 0, 1.0 / 320, 0, 0, 0, 1}, {}, 1};
    const cv::Size native{1280, 320};
    const auto finger = [&](cv::Mat &frame, int x, bool pressed) {
        frame(cv::Rect(x - 4, 20, 8, 61)).setTo(cv::Scalar(150, 95, 75, 255));
        if (pressed) {
            frame(cv::Rect(x - 7, 74, 3, 7)).setTo(cv::Scalar(210, 210, 210, 255));
            frame(cv::Rect(x + 4, 74, 3, 7)).setTo(cv::Scalar(210, 210, 210, 255));
        }
    };
    const auto single = [&](int x, bool pressed) {
        auto frame = reference.clone();
        finger(frame, x, pressed);
        return frame;
    };
    const auto samePoint = [](Point a, Point b) { return a.x == b.x && a.y == b.y; };
    Pipeline pipeline;
    pipeline.setReference(reference, native, keyboard);
    auto result = pipeline.processFrame(single(320, true), native);
    require(result.contacts.size() == 1 && result.contacts[0].state == ContactState::Pressed &&
            result.pressedAnchors.size() == 1, "New detected press creates one anchor");
    const Point anchor = result.pressedAnchors[0];
    require(anchor.x == 640 && anchor.y == 160, "Stored anchors use native coordinates");
    result = pipeline.processFrame(single(328, false), native);
    require(result.contacts[0].state == ContactState::Pressed &&
            result.contacts[0].tip.x == 328 && samePoint(result.pressedAnchors[0], anchor),
            "Nearby tip bypasses failed shadow detection and keeps original anchor");
    result = pipeline.processFrame(single(336, false), native);
    require(result.contacts[0].state == ContactState::Pressed &&
            samePoint(result.pressedAnchors[0], anchor), "Repeated motion does not move anchor");
    result = pipeline.processFrame(single(344, false), native);
    require(result.contacts[0].state == ContactState::Released && result.pressedAnchors.empty(),
            "Motion beyond original anchor releases instead of accumulating drift");
    result = pipeline.processFrame(single(320, false), native);
    require(result.contacts[0].state == ContactState::Released && result.pressedAnchors.empty(),
            "Released anchor cannot resurrect without a new detection");

    pipeline.processFrame(single(320, true), native);
    auto two = reference.clone();
    finger(two, 312, false);
    finger(two, 328, false);
    result = pipeline.processFrame(two, native);
    require(result.contacts.size() == 2 && result.contacts[0].state == ContactState::Pressed &&
            result.contacts[1].state == ContactState::Released && result.pressedAnchors.size() == 1 &&
            samePoint(result.pressedAnchors[0], anchor), "Each old anchor matches once in fingertip order");
    result = pipeline.processFrame(reference, native);
    require(result.contacts.empty() && result.pressedAnchors.empty(), "Missing tips remove all unmatched anchors");

    // New detections are not available for matching until the following frame.
    finger(two, 312, true);
    result = pipeline.processFrame(two, native);
    require(result.contacts[0].state == ContactState::Pressed &&
            result.contacts[1].state == ContactState::Released && result.pressedAnchors.size() == 1,
            "A new press cannot be inherited by another tip in the same frame");
    finger(two, 328, true);
    result = pipeline.processFrame(two, native);
    require(result.contacts[0].state == ContactState::Pressed &&
            result.contacts[1].state == ContactState::Pressed && result.pressedAnchors.size() == 2,
            "Held and newly detected presses both appear in result contacts and next anchors");

    pipeline.reset();
    require(!pipeline.processFrame(two, native).ready, "Reset clears reference and anchors");
    pipeline.setReference(reference, native, keyboard);
    result = pipeline.processFrame(single(312, false), native);
    require(result.contacts[0].state == ContactState::Released && result.pressedAnchors.empty(),
            "Reset cannot retain an old press");
    pipeline.processFrame(single(320, true), native);
    pipeline.setReference(reference, native, keyboard);
    require(pipeline.processFrame(single(320, false), native).pressedAnchors.empty(),
            "Reference recapture clears old anchors");
    pipeline.processFrame(single(320, true), native);
    require(!pipeline.processFrame(single(320, false), {640, 160}).ready,
            "Native frame change invalidates active anchors");
    pipeline.setReference(reference, native, keyboard);
    require(pipeline.processFrame(single(320, false), native).pressedAnchors.empty(),
            "Frame-size invalidation cannot retain an old press");
    pipeline.processFrame(single(320, true), native);
    pipeline.setReference(reference, native);
    require(pipeline.processFrame(single(320, false), native).pressedAnchors.empty(),
            "Missing replacement geometry cannot retain an old press");
}
void pressRangeGeometry() {
    const std::array<Point, 4> camera{{{10, 5}, {600, 18}, {530, 300}, {5, 250}}};
    const std::array<Point, 4> sheet{{{0, 0}, {1, 0}, {1, 1}, {0, 1}}};
    const auto transform = *computeHomography(camera, sheet);
    const auto inverse = *invertHomography(transform);
    for (int octaves : {1, 2, 3}) {
        KeyboardGeometry keyboard{transform, {}, octaves};
        const double span = (7 * octaves + 1) * constants::whitePitchMm - 2 * constants::markerInsetMm;
        for (Point center : {Point{0.2, 0.3}, Point{0.8, 0.7}}) {
            const auto anchor = *projectPoint(inverse, center);
            for (Point direction : {Point{1, 0}, Point{0, 1}, Point{0.6, 0.8}}) {
                for (double fraction : {0.99, 1.01}) {
                    const Point target{
                        center.x + direction.x * constants::pressMatchRadiusMm * fraction / span,
                        center.y + direction.y * constants::pressMatchRadiusMm * fraction *
                            (constants::keyBottom - constants::keyTop) / constants::whiteLengthMm};
                    require(keyboard.withinPressRange(*projectPoint(inverse, target), anchor) ==
                            (fraction < 1), "Matching radius uses physical distances under perspective");
                }
            }
            const auto outline = keyboard.pressRangeOutline(anchor, 0.5, 0.5);
            require(outline.size() == size_t(constants::pressRangeSegments), "Full visible range outline");
            for (int i = 0; i < constants::pressRangeSegments; ++i) {
                const double angle = 2 * std::acos(-1.0) * i / constants::pressRangeSegments;
                const auto expected = *projectPoint(inverse, {
                    center.x + constants::pressMatchRadiusMm * std::cos(angle) / span,
                    center.y + constants::pressMatchRadiusMm * std::sin(angle) *
                        (constants::keyBottom - constants::keyTop) / constants::whiteLengthMm});
                require(outline[i].x == cvRound(expected.x * 0.5) &&
                        outline[i].y == cvRound(expected.y * 0.5), "Visible outline matches association radius");
            }
        }
    }
    KeyboardGeometry invalid{};
    require(!invalid.withinPressRange({1, 1}, {2, 2}) &&
            invalid.pressRangeOutline({1, 1}, 1, 1).empty(), "Unavailable projections supply no match/range");
}
void combinedAndView() {
    auto reference = paper(), frame = reference.clone();
    frame(cv::Rect(30, 20, 20, 21)).setTo(cv::Scalar(150, 95, 75, 255));
    frame(cv::Rect(27, 34, 3, 7)).setTo(cv::Scalar(210, 210, 210, 255));
    frame(cv::Rect(50, 34, 3, 7)).setTo(cv::Scalar(210, 210, 210, 255));
    Pipeline pipeline;
    KeyboardGeometry keyboard{{1.0 / 80, 0, 0, 0, 1.0 / 80, 0, 0, 0, 1}, {}, 1};
    pipeline.setReference(reference, reference.size(), keyboard);
    auto result = pipeline.processFrame(frame, frame.size());
    require(result.contacts.size() == 1 && result.contacts[0].state == ContactState::Pressed,
            "Production pipeline accepts the light fallback");
    const auto repeat = pipeline.processFrame(frame, frame.size());
    require(repeat.fingerMask == result.fingerMask && repeat.contacts[0].state == result.contacts[0].state,
            "Repeated frame keeps press without moving the current fingertip");
    const auto view = renderShadowClasses(result);
    require(view.at<cv::Vec3b>(30, 40) == cv::Vec3b(100, 0, 0) &&
            view.at<cv::Vec3b>(0, 0) == cv::Vec3b(255, 255, 255), "Finger display precedence and clear paper");
    for (size_t i = 0; i < constants::classCutoffs.size(); ++i) {
        result.shadows.score[0] = float(constants::classCutoffs[i]);
        const auto equal = renderShadowClasses(result).at<cv::Vec3b>(0, 0);
        result.shadows.score[0] = std::nextafter(float(constants::classCutoffs[i]), INFINITY);
        require(equal != renderShadowClasses(result).at<cv::Vec3b>(0, 0), "Class equality stays in lower band");
    }
    result.shadows.valid[0] = 0;
    require(renderShadowClasses(result).at<cv::Vec3b>(0, 0) == cv::Vec3b(0, 0, 0), "Unknown displays black");
    pipeline.reset();
    require(!pipeline.processFrame(frame, frame.size()).ready, "Reset clears accepted contacts");
    rejects([&] { renderShadowClasses({}); });
}
}
int main() {
    try {
        referenceLifecycle(); segmentation(); blackMeasurements(); contactRules(); homographyEligibility(); pressAnchors(); pressRangeGeometry(); combinedAndView();
        std::cout << "PASS reference lifecycle, segmentation/refinement, black geometry/scores, contact flow and class view\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n'; return 1;
    }
}
