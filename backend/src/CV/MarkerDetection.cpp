#include "MarkerDetection.hpp"
#include "Constants.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <opencv2/imgproc.hpp>
#include <opencv2/objdetect/aruco_detector.hpp>
namespace makeshift::vision {
std::optional<KeyboardGeometry> detectKeyboard(const cv::Mat &image, int octaves) {
    if (octaves < constants::minimumOctaves || octaves > constants::maximumOctaves || image.empty() || image.type() != CV_8UC3)
        throw std::invalid_argument("Expected BGR frame and 1..3 paper octaves");
    const auto dictionary = cv::aruco::getPredefinedDictionary(cv::aruco::DICT_4X4_50);
    cv::aruco::DetectorParameters parameters;
    parameters.cornerRefinementMethod = cv::aruco::CORNER_REFINE_SUBPIX;
    cv::aruco::ArucoDetector detector(dictionary, parameters);
    std::vector<int> ids;
    std::vector<std::vector<cv::Point2f>> corners;
    detector.detectMarkers(image, corners, ids);
    std::array<int, 4> counts{};
    std::array<Point, 4> centers{};
    for (size_t i = 0; i < ids.size(); ++i) {
        if (ids[i] < 0 || ids[i] > 3)
            continue;
        const int id = ids[i];
        ++counts[id];
        // Diagonal intersection gives the projectively correct marker center.
        const auto &c = corners[i];
        const cv::Point2f a = c[2] - c[0], b = c[3] - c[1], delta = c[1] - c[0];
        const double denominator = a.x * b.y - a.y * b.x;
        if (std::abs(denominator) < constants::markerDiagonalEpsilon)
            return std::nullopt;
        const double t = (delta.x * b.y - delta.y * b.x) / denominator;
        centers[id] = {c[0].x + t * a.x, c[0].y + t * a.y};
    }
    if (std::any_of(counts.begin(), counts.end(), [](int count) { return count != 1; }))
        return std::nullopt;
    std::vector<cv::Point2f> outline;
    for (const auto p : centers)
        outline.emplace_back(p.x, p.y);
    if (!cv::isContourConvex(outline) || std::abs(cv::contourArea(outline)) < constants::minimumMarkerArea)
        return std::nullopt;
    const std::array<Point, 4> square{{{0, 0}, {1, 0}, {1, 1}, {0, 1}}};
    const auto transform = computeHomography(centers, square);
    if (!transform || !invertHomography(*transform))
        return std::nullopt;
    KeyboardGeometry keyboard{*transform, centers, octaves};
    if (keyboard.polygons(1, 1).size() != size_t(7 * octaves + 1))
        return std::nullopt;
    return keyboard;
}
}
