#include "Pipeline.hpp"
#include "Constants.hpp"
#include "FingerSegmentation.hpp"
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
    ++revision_;
}
void Pipeline::reset() {
    reference_.release();
    geometry_.reset();
    blackRegion_.clear();
    nativeSize_ = {};
    ++revision_;
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

    // 2. Freeze initial geometry, grow one exterior ring, then re-extract tips.
    auto grown = refineFingerMask(current, initial);
    auto fingers = identifyFingertipsFromMask(current.cols, current.rows, std::move(grown));

    // 3. Measure raw drops and effective white/black shadow scores.
    result.shadows = measureShadows(current, reference_, blackRegion_);

    // 4. Apply keyboard eligibility, then the production dark -> light -> mid flow.
    result.contacts = detectContacts(result.shadows, fingers, geometry_, native);
    result.fingerMask = std::move(fingers.mask);
    result.ready = true;
    return result;
}
} // namespace makeshift::vision
