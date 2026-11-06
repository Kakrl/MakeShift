#include "CameraSnapshot.hpp"
#include <chrono>
#include <opencv2/imgcodecs.hpp>
#include <stdexcept>

namespace makeshift::cvbaseline {
CameraSnapshot saveCameraSnapshot(const std::filesystem::path &directory, const cv::Mat &image,
                                  const cv::Mat &reference) {
    if (image.empty() || image.type() != CV_8UC3 ||
        (!reference.empty() && (reference.type() != CV_8UC3 || reference.size() != image.size())))
        throw std::invalid_argument("Snapshot requires native BGR pixels and a matched reference");
    std::filesystem::create_directories(directory);
    const auto ticks = std::chrono::duration_cast<std::chrono::microseconds>(
                           std::chrono::system_clock::now().time_since_epoch())
                           .count();
    CameraSnapshot files;
    int suffix = 0;
    do {
        const auto stem = "camera-" + std::to_string(ticks) + "-" + std::to_string(suffix++);
        files.image = directory / (stem + ".png");
        files.reference = directory / (stem + "-reference.png");
    } while (std::filesystem::exists(files.image) || std::filesystem::exists(files.reference));
    if (!cv::imwrite(files.image.string(), image))
        throw std::runtime_error("Cannot save snapshot PNG");
    if (!reference.empty()) {
        if (!cv::imwrite(files.reference.string(), reference))
            throw std::runtime_error("Cannot save snapshot reference PNG");
    } else {
        files.reference.clear();
    }
    return files;
}
} // namespace makeshift::cvbaseline
