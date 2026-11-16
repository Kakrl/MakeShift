#pragma once
#include "Pipeline.hpp"
#include <chrono>
#include <functional>

namespace makeshift::vision {
enum class ReferenceScan { Idle, Captured, BlockedMarkers, BlockedPresses, BlockedFingertips };
struct VisionFrameResult {
    cv::Mat analysisRgba;
    FrameResult detection;
    std::vector<int> pressedKeys; // Sorted unique semitone offsets from the leftmost C.
    bool referenceReady = false;
    bool homographyReady = false;
    ReferenceScan referenceScan = ReferenceScan::Idle;
};
// Owns native-frame preprocessing and reference policy. Pipeline owns detection.
class Vision {
  public:
    using TimePoint = std::chrono::steady_clock::time_point;
    using Clock = std::function<TimePoint()>;
    explicit Vision(Clock clock = [] { return std::chrono::steady_clock::now(); });
    void setReference(); // One attempt on the next frame; first capture confirms empty paper.
    void reset();
    VisionFrameResult processFrame(const cv::Mat &nativeRgba, int octaves);
    const std::optional<KeyboardGeometry> &geometry() const { return pipeline_.geometry(); }
    bool ready() const { return pipeline_.ready(); }
  private:
    Pipeline pipeline_;
    Clock clock_;
    bool referenceRequested_ = false;
    cv::Size nativeSize_;
    int octaves_ = 0;
    std::optional<TimePoint> nextCheck_;
};
} // namespace makeshift::vision
