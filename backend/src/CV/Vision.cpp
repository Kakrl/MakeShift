#include "Vision.hpp"
#include "ChromaticLookup.hpp"
#include "Constants.hpp"
#include "MarkerDetection.hpp"
#include <algorithm>
#include <opencv2/imgproc.hpp>
#include <stdexcept>

namespace makeshift::vision {
Vision::Vision(Clock clock) : clock_(std::move(clock)) {
    if (!clock_)
        throw std::invalid_argument("Vision requires a clock");
}
void Vision::setReference() { referenceRequested_ = true; }
void Vision::reset() {
    pipeline_.reset();
    referenceRequested_ = false;
    nativeSize_ = {};
    octaves_ = 0;
    nextCheck_.reset();
}
VisionFrameResult Vision::processFrame(const cv::Mat &native, int octaves) {
    if (native.empty() || native.type() != CV_8UC4 || native.dims != 2 ||
        octaves < constants::minimumOctaves || octaves > constants::maximumOctaves)
        throw std::invalid_argument("Expected native RGBA frame and 1..3 octaves");
    if (!nativeSize_.empty() && (native.size() != nativeSize_ || octaves != octaves_))
        reset();
    nativeSize_ = native.size();
    octaves_ = octaves;
    const auto now = clock_();
    VisionFrameResult result;
    const double scale =
        std::min(1.0, double(constants::analysisSide) / std::max(native.cols, native.rows));
    const cv::Size analysisSize{std::max(1, cvRound(native.cols * scale)),
                                std::max(1, cvRound(native.rows * scale))};
    cv::resize(native, result.analysisRgba, analysisSize, 0, 0, cv::INTER_AREA);

    // First evaluate current tips/retained presses with the old reference.
    result.detection = pipeline_.processFrame(result.analysisRgba, native.size());
    const bool automatic = pipeline_.ready() && nextCheck_ && now >= *nextCheck_;
    if (referenceRequested_ || automatic) {
        referenceRequested_ = false; // One request/check, never a capture backlog.
        if (automatic)
            nextCheck_ = now + std::chrono::seconds(constants::referenceRefreshSeconds);
        cv::Mat bgr;
        cv::cvtColor(native, bgr, cv::COLOR_RGBA2BGR);
        const auto candidate = detectKeyboard(bgr, octaves);
        result.referenceScan = ReferenceScan::BlockedMarkers;
        if (candidate) {
            const bool pressed =
                !result.detection.pressedAnchors.empty() ||
                std::any_of(result.detection.contacts.begin(), result.detection.contacts.end(),
                            [](const auto &c) { return c.state == ContactState::Pressed; });
            const bool occupied = std::any_of(
                result.detection.contacts.begin(), result.detection.contacts.end(),
                [&](const auto &c) {
                    const Point p{double(c.tip.x) * native.cols / result.analysisRgba.cols,
                                  double(c.tip.y) * native.rows / result.analysisRgba.rows};
                    // Only tips inside the freshly scanned piano region block refresh.
                    return candidate->withinHomography(p);
                });
            if (pressed)
                result.referenceScan = ReferenceScan::BlockedPresses;
            else if (occupied)
                result.referenceScan = ReferenceScan::BlockedFingertips;
            else {
                // With no first reference, emptiness relies on the explicit user request.
                pipeline_.setReference(result.analysisRgba, native.size(), candidate);
                nextCheck_ = now + std::chrono::seconds(constants::referenceRefreshSeconds);
                result.referenceScan = ReferenceScan::Captured;
                result.detection = {}; // Do not label a capture frame with old-reference results.
                result.detection.referenceRevision = pipeline_.referenceRevision();
            }
        }
    }
    result.referenceReady = pipeline_.ready();
    result.homographyReady = geometry().has_value();
    if (geometry())
        result.pressedKeys = pressedChromaticKeys(*geometry(), result.detection.pressedAnchors);
    return result;
}
} // namespace makeshift::vision
