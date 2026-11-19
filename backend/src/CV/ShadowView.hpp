#pragma once
#include "Pipeline.hpp"
namespace makeshift::vision {
// BGR display image. Does not alter measurements or perform detection.
cv::Mat renderShadowClasses(const FrameResult &frame);
} // namespace makeshift::vision
