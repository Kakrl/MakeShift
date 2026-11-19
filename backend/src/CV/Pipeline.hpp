#pragma once
#include "ContactDetection.hpp"
#include "KeyboardGeometry.hpp"
#include "ShadowMeasurements.hpp"
#include <optional>

namespace makeshift::vision {
struct FrameResult {
    bool ready = false;
    uint64_t referenceRevision = 0;
    std::vector<uint8_t> fingerMask;
    ShadowMeasurements shadows;
    std::vector<Contact> contacts;
    std::vector<Point>
        pressedAnchors; // Fixed native-camera points, not current fingertip positions.
};
// Owns reference, geometry and fixed press anchors. No capture, windows, or audio.
class Pipeline {
  public:
    void setReference(const cv::Mat &analysisRgba, cv::Size nativeSize,
                      std::optional<KeyboardGeometry> geometry = {});
    void reset();
    FrameResult processFrame(const cv::Mat &analysisRgba, cv::Size nativeSize);
    const std::optional<KeyboardGeometry> &geometry() const { return geometry_; }
    bool ready() const { return !reference_.empty(); }
    uint64_t referenceRevision() const { return revision_; }

  private:
    bool alreadyPressed(Point nativePoint);
    std::vector<Point> prevPressed_, nextPressed_;
    cv::Mat reference_;
    cv::Size nativeSize_;
    std::optional<KeyboardGeometry> geometry_;
    std::vector<uint8_t> blackRegion_;
    uint64_t revision_ = 0;
};
} // namespace makeshift::vision
