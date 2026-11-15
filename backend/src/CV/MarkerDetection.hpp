#pragma once
#include "KeyboardGeometry.hpp"
namespace makeshift::vision {
std::optional<KeyboardGeometry> detectKeyboard(const cv::Mat &nativeBgr, int octaves);
}
