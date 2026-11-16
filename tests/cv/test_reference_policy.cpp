#include "Constants.hpp"
#include "ChromaticLookup.hpp"
#include "Vision.hpp"
#include <algorithm>
#include <cmath>
#include <chrono>
#include <functional>
#include <iostream>
#include <opencv2/imgproc.hpp>
#include <opencv2/objdetect/aruco_detector.hpp>
#include <stdexcept>

using namespace makeshift::vision;
namespace {
void require(bool ok, const char *message) {
    if (!ok) throw std::runtime_error(message);
}
void rejects(const std::function<void()> &fn) {
    bool threw = false;
    try { fn(); } catch (const std::invalid_argument &) { threw = true; }
    require(threw, "Malformed input must throw");
}
cv::Mat paper(int missing = -1) {
    cv::Mat image(480, 640, CV_8UC4, cv::Scalar(230, 230, 230, 255));
    const std::array<cv::Point, 4> centers{{{80, 60}, {560, 60}, {560, 420}, {80, 420}}};
    const auto dictionary = cv::aruco::getPredefinedDictionary(cv::aruco::DICT_4X4_50);
    for (int id = 0; id < 4; ++id) {
        if (id == missing) continue;
        cv::Mat marker, rgba;
        cv::aruco::generateImageMarker(dictionary, id, 48, marker);
        cv::cvtColor(marker, rgba, cv::COLOR_GRAY2RGBA);
        rgba.copyTo(image(cv::Rect(centers[id].x - 24, centers[id].y - 24, 48, 48)));
    }
    return image;
}
cv::Mat finger(int x, int bottom, bool pressed = false) {
    auto image = paper();
    image(cv::Rect(x - 10, bottom - 60, 20, 61)).setTo(cv::Scalar(150, 95, 75, 255));
    if (pressed) {
        image(cv::Rect(x - 13, bottom - 8, 3, 9)).setTo(cv::Scalar(210, 210, 210, 255));
        image(cv::Rect(x + 10, bottom - 8, 3, 9)).setTo(cv::Scalar(210, 210, 210, 255));
    }
    return image;
}
struct Fixture {
    int64_t millis = 0;
    Vision vision{[this] { return Vision::TimePoint{} + std::chrono::milliseconds(millis); }};
    VisionFrameResult frame(const cv::Mat &image, int octaves = 1) {
        return vision.processFrame(image, octaves);
    }
    uint64_t capture() {
        vision.setReference();
        const auto r = frame(paper());
        require(r.referenceScan == ReferenceScan::Captured && r.referenceReady && r.homographyReady,
                "Explicit capture acquires real synthetic ArUco markers");
        require(!r.detection.ready && r.detection.contacts.empty() && r.detection.pressedAnchors.empty(),
                "Capture frame returns no stale detection results");
        return r.detection.referenceRevision;
    }
};
void firstCaptureAndTiming() {
    Fixture f;
    f.millis = 100000;
    auto r = f.frame(paper());
    require(!r.referenceReady && !r.homographyReady && r.referenceScan == ReferenceScan::Idle,
            "First reference is never captured automatically");
    f.vision.setReference();
    r = f.frame(paper(2));
    require(r.referenceScan == ReferenceScan::BlockedMarkers && !r.referenceReady,
            "Missing first markers block capture");
    require(!f.frame(paper()).referenceReady, "Blocked manual request is consumed once");
    const auto revision = f.capture();
    f.millis += 9999;
    r = f.frame(paper());
    require(r.referenceScan == ReferenceScan::Idle && r.detection.ready &&
            r.detection.referenceRevision == revision, "No automatic check before ten seconds");
    ++f.millis;
    r = f.frame(paper());
    require(r.referenceScan == ReferenceScan::Captured && r.detection.referenceRevision == revision + 1,
            "Automatic reference refresh exactly at ten seconds");
    f.millis += 100000;
    require(f.frame(paper()).referenceScan == ReferenceScan::Captured, "Late frame triggers one refresh");
    require(f.frame(paper()).referenceScan == ReferenceScan::Idle, "No backlog of overdue checks");
}
void refreshGuards() {
    Fixture f;
    auto revision = f.capture();
    f.millis = 10000;
    auto r = f.frame(paper(0));
    require(r.referenceScan == ReferenceScan::BlockedMarkers && r.referenceReady &&
            r.detection.referenceRevision == revision, "Failed refresh keeps old reference/geometry");
    f.millis = 10001;
    require(f.frame(paper()).referenceScan == ReferenceScan::Idle, "Failed auto check waits another interval");
    f.millis = 20000;
    r = f.frame(finger(300, 260)); // Unpressed tip inside the piano homography.
    require(r.referenceScan == ReferenceScan::BlockedFingertips && r.detection.contacts.size() == 1 &&
            r.detection.contacts[0].state == ContactState::Released,
            "Unpressed fingertip inside piano homography blocks refresh");
    f.millis = 30000;
    r = f.frame(finger(25, 260));
    require(r.referenceScan == ReferenceScan::Captured, "Fingertip outside paper does not block capture");
    revision = r.detection.referenceRevision;
    // Explicitly return to clean reference, since the last capture included an outside object.
    f.vision.setReference();
    f.frame(paper());
    r = f.frame(finger(300, 260, true));
    require(r.detection.pressedAnchors.size() == 1, "Fixture establishes an active press");
    const auto heldKeys = r.pressedKeys;
    require(heldKeys.size() == 1, "Vision maps an accepted press to a chromatic key");
    r = f.frame(finger(310, 260));
    require(r.pressedKeys == heldKeys && r.detection.pressedAnchors.size() == 1,
            "Retained press keeps its original pitch when the fingertip moves");
    const auto &tip = r.detection.contacts.front().tip;
    require(chromaticKeyAt(*f.vision.geometry(), {double(tip.x), double(tip.y)}) != heldKeys.front(),
            "Retention fixture crosses a chromatic region boundary");
    f.millis = 40000;
    r = f.frame(finger(300, 260));
    require(r.referenceScan == ReferenceScan::BlockedPresses && r.detection.pressedAnchors.size() == 1,
            "Retained press blocks refresh even when fresh shadows reject");
    require(r.pressedKeys == heldKeys, "Blocked reference refresh preserves held pitches");
    f.millis = 40001;
    r = f.frame(paper());
    require(r.referenceScan == ReferenceScan::Idle && r.detection.pressedAnchors.empty(),
            "Releasing press does not bypass refresh cadence");
    require(r.pressedKeys.empty(), "Absent anchors release the complete key snapshot");
    f.millis = 50000;
    r = f.frame(paper());
    require(r.referenceScan == ReferenceScan::Captured && r.detection.referenceRevision > revision &&
            r.detection.contacts.empty(), "Clean due frame replaces reference without old contacts");
}
void homographyAndAtomicity() {
    // Outside detections, including printed margins/clothing, do not block refresh.
    for (const auto position : {cv::Point{300, 90}, cv::Point{25, 260}}) {
        Fixture margin;
        margin.capture();
        const auto image = finger(position.x, position.y);
        const auto before = margin.frame(image);
        require(before.detection.contacts.size() == 1 &&
                before.detection.contacts[0].state == ContactState::Released,
                "Outside fixture is detected but not a press");
        margin.millis = 10000;
        require(margin.frame(image).referenceScan == ReferenceScan::Captured,
                "Outside/margin fingertips do not block automatic refresh");
    }
    Fixture f;
    const auto revision = f.capture();
    const auto oldTransform = f.vision.geometry()->frameToSheet;
    auto shifted = paper();
    // Move all markers without changing the camera dimensions.
    auto old = shifted.clone();
    shifted.setTo(cv::Scalar(230, 230, 230, 255));
    old(cv::Rect(0, 0, 620, 480)).copyTo(shifted(cv::Rect(20, 0, 620, 480)));
    // A tip inside the newly scanned piano still blocks replacement.
    shifted(cv::Rect(90, 200, 20, 61)).setTo(cv::Scalar(150, 95, 75, 255));
    f.millis = 10000;
    auto r = f.frame(shifted);
    require(r.referenceScan == ReferenceScan::BlockedFingertips &&
            r.detection.referenceRevision == revision && f.vision.geometry()->frameToSheet == oldTransform,
            "Current piano fingertip blocks capture and preserves old geometry atomically");
    // Keep an outside detection on the old paper margin; it must not block.
    shifted(cv::Rect(90, 200, 20, 61)).setTo(cv::Scalar(230, 230, 230, 255));
    shifted(cv::Rect(40, 200, 10, 61)).setTo(cv::Scalar(150, 95, 75, 255));
    f.millis = 20000;
    r = f.frame(shifted);
    require(r.referenceScan == ReferenceScan::Captured &&
            f.vision.geometry()->frameToSheet != oldTransform && r.detection.contacts.empty(),
            "Reference and moved homography are accepted together");
    r = f.frame(shifted);
    require(r.detection.ready && r.detection.contacts.empty() &&
            std::all_of(r.detection.shadows.rawDrop.begin(), r.detection.shadows.rawDrop.end(),
                        [](float v) { return v == 0; }), "Accepted reference pixels match the capture frame");
}
void forcedChecksAndInvalidation() {
    Fixture f;
    const auto revision = f.capture();
    f.millis = 2000;
    f.vision.setReference();
    auto r = f.frame(paper(3));
    require(r.referenceScan == ReferenceScan::BlockedMarkers && r.detection.referenceRevision == revision,
            "Force requests a check without bypassing markers");
    f.millis = 10000;
    require(f.frame(paper()).referenceScan == ReferenceScan::Captured,
            "Failed force keeps original automatic deadline");
    f.millis = 11000;
    f.vision.setReference();
    r = f.frame(finger(300, 260));
    require(r.referenceScan == ReferenceScan::BlockedFingertips, "Force cannot bypass fingertip guard");
    require(f.frame(paper()).referenceScan == ReferenceScan::Idle, "Blocked forced request is one-shot");
    f.vision.setReference();
    r = f.frame(paper());
    require(r.referenceScan == ReferenceScan::Captured, "Force can capture before automatic deadline");
    f.millis = 20000;
    require(f.frame(paper()).referenceScan == ReferenceScan::Idle, "Successful force restarts interval");
    f.millis = 21000;
    require(f.frame(paper()).referenceScan == ReferenceScan::Captured, "Forced capture uses fresh ten-second interval");
    r = f.frame(paper(), 2);
    require(!r.referenceReady && !r.homographyReady && !f.vision.geometry(), "Octave changes invalidate geometry");
    f.vision.setReference();
    require(f.frame(paper(), 2).referenceScan == ReferenceScan::Captured, "New layout requires manual capture");
    cv::Mat large;
    cv::resize(paper(), large, {1280, 960}, 0, 0, cv::INTER_NEAREST);
    r = f.frame(large, 2);
    require(!r.referenceReady && r.analysisRgba.size() == cv::Size(640, 480),
            "Native size changes invalidate; Vision owns bounded analysis resize");
    f.vision.setReference();
    r = f.frame(large, 2);
    require(r.referenceScan == ReferenceScan::Captured && f.vision.geometry()->markerCenters[1].x > 1000,
            "Markers stay in native coordinates while reference is downsampled");
    rejects([&] { f.frame(cv::Mat(20, 20, CV_8UC3), 2); });
    rejects([&] { f.frame(large, 4); });
    require(f.vision.ready(), "Invalid inputs preserve valid reference");
    f.vision.setReference();
    f.vision.reset();
    require(!f.frame(large, 2).referenceReady, "Reset clears pending requests, reference and timer");
    f.millis += 100000;
    require(!f.frame(large, 2).referenceReady, "Reset cannot auto-bootstrap after elapsed time");
    const auto tiny = f.frame(cv::Mat(1280, 1, CV_8UC4, cv::Scalar(230, 230, 230, 255)));
    require(tiny.analysisRgba.size() == cv::Size(1, 640), "Very thin input retains nonzero analysis dimensions");
}
}
int main() {
    try {
        firstCaptureAndTiming(); refreshGuards(); homographyAndAtomicity(); forcedChecksAndInvalidation();
        std::cout << "PASS manual bootstrap, timed/forced guards, atomic refresh and invalidation\n";
        return 0;
    } catch (const std::exception &e) { std::cerr << e.what() << '\n'; return 1; }
}
