#include "Pipeline.hpp"
#include "Constants.hpp"
#include "FingerSegmentation.hpp"
#include <algorithm>
#include <stdexcept>

namespace makeshift::vision {
void Pipeline::setReference(const cv::Mat &image, cv::Size native,
                            std::optional<KeyboardGeometry> geometry) {
    validateImages(image, image);
    if (native.width < image.cols || native.height < image.rows)
        throw std::invalid_argument("Native frame cannot be smaller than analysis frame");
    auto black = geometry ? projectBlackKeys(*geometry, native, image.size()) :
                            std::vector<uint8_t>(image.total());
    auto reference = image.clone();
    reference_ = std::move(reference);
    nativeSize_ = native;
    geometry_ = std::move(geometry);
    blackRegion_ = std::move(black);
    prevPressed_.clear();
    nextPressed_.clear();
    ++revision_;
}
void Pipeline::reset() {
    reference_.release();
    geometry_.reset();
    blackRegion_.clear();
    nativeSize_ = {};
    prevPressed_.clear();
    nextPressed_.clear();
    ++revision_;
}
bool Pipeline::alreadyPressed(Point point) {
    for (auto it = prevPressed_.begin(); it != prevPressed_.end(); ++it) {
        if (geometry_->withinPressRange(point, *it)) {
            nextPressed_.push_back(*it); // Keep the original anchor, never the new tip.
            prevPressed_.erase(it);     // This anchor can match only once this frame.
            return true;
        }
    }
    return false;
}
FrameResult Pipeline::processFrame(const cv::Mat &current, cv::Size native) {
    FrameResult result;
    // A changed camera/frame invalidates reference and geometry together.
    if (ready() && (current.size() != reference_.size() || native != nativeSize_)) reset();
    result.referenceRevision = revision_;
    if (!ready()) return result;
    validateImages(current, reference_);

    // 1. RGB seeds, including localized brightening recovery over black ink.
    auto seeds = seedFingers(current, reference_, blackRegion_);
    auto initial = identifyFingertipsFromMask(current.cols, current.rows, std::move(seeds));

    // 2. Refine only tips inside the calibrated keyboard. Keep the full seed mask
    // so outside fingers remain occluders; never crop a finger at the boundary.
    initial.candidates.erase(
        std::remove_if(initial.candidates.begin(), initial.candidates.end(), [&](const auto &tip) {
            const Point nativeTip{double(tip.x) * native.width / current.cols,
                                  double(tip.y) * native.height / current.rows};
            return !geometry_ || !geometry_->withinHomography(nativeTip);
        }),
        initial.candidates.end());
    auto grown = initial.candidates.empty() ? std::move(initial.mask) :
                                             refineFingerMask(current, initial);
    auto fingers = identifyFingertipsFromMask(current.cols, current.rows, std::move(grown));

    // 3. Measure raw drops and effective white/black shadow scores.
    result.shadows = measureShadows(current, reference_, blackRegion_);

    // 4. Keep matched press anchors; only unmatched eligible tips need shadow checks.
    nextPressed_.clear();
    FingertipEstimate pending{std::move(fingers.mask), {}};
    std::vector<size_t> pendingIndices;
    result.contacts.reserve(fingers.candidates.size());
    for (const auto &tip : fingers.candidates) {
        result.contacts.push_back({tip, ContactState::Released});
        const Point nativeTip{double(tip.x) * native.width / current.cols,
                              double(tip.y) * native.height / current.rows};
        if (!geometry_ || !geometry_->withinHomography(nativeTip)) continue;
        if (alreadyPressed(nativeTip)) {
            result.contacts.back().state = ContactState::Pressed;
        } else {
            pending.candidates.push_back(tip);
            pendingIndices.push_back(result.contacts.size() - 1);
        }
    }
    const auto detected = detectContacts(result.shadows, pending, geometry_, native);
    for (size_t i = 0; i < detected.size(); ++i) {
        const auto &contact = detected[i];
        result.contacts[pendingIndices[i]] = contact;
        if (contact.state == ContactState::Pressed) {
            nextPressed_.push_back({double(contact.tip.x) * native.width / current.cols,
                                    double(contact.tip.y) * native.height / current.rows});
        }
    }
    prevPressed_ = std::move(nextPressed_); // Unmatched old anchors disappear here.
    result.pressedAnchors = prevPressed_;
    result.fingerMask = std::move(pending.mask);
    result.ready = true;
    return result;
}
} // namespace makeshift::vision
