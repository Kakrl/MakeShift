#pragma once
#include <filesystem>
#include <opencv2/core.hpp>

namespace makeshift::cvbaseline {
struct CameraSnapshot {
    std::filesystem::path image, reference;
};
// Save native, unannotated pixels. Creates only the explicitly selected folder;
// each call uses new filenames and never overwrites an earlier capture.
CameraSnapshot saveCameraSnapshot(const std::filesystem::path &directory, const cv::Mat &nativeBgr,
                                  const cv::Mat &referenceBgr);
} // namespace makeshift::cvbaseline
