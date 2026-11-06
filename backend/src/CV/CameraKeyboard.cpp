#include "CameraKeyboard.hpp"
#include <algorithm>
#include <cmath>
#include <opencv2/imgproc.hpp>
#include <opencv2/objdetect/aruco_detector.hpp>
#include <stdexcept>

namespace makeshift::cvbaseline {
namespace {
double markerSpan(int octaves) { return (7 * octaves + 1) * 23.5 - 2 * (188.0 / 1.1 * 0.05); }
double leftEdge(int octaves) { return -(188.0 / 1.1 * 0.05) / markerSpan(octaves); }
} // namespace
int CameraKeyboard::keyAt(Point point) const {
    const auto p = projectPoint(frameToSheet, point);
    if (!p || p->y < 0.1 || p->y > 0.9)
        return -1;
    const double key = (p->x - leftEdge(octaves)) * markerSpan(octaves) / 23.5;
    const int count = 7 * octaves + 1;
    if (key < 0 || key > count)
        return -1;
    // Shared boundaries belong to the first (left) key, as in the browser.
    return std::max(0, int(std::ceil(key)) - 1);
}
std::vector<std::vector<cv::Point>> CameraKeyboard::polygons(double sx, double sy) const {
    const auto inverse = invertHomography(frameToSheet);
    if (!inverse)
        return {};
    std::vector<std::vector<cv::Point>> keys;
    for (int i = 0; i < 7 * octaves + 1; ++i) {
        const double left = leftEdge(octaves) + i * 23.5 / markerSpan(octaves);
        const double right = left + 23.5 / markerSpan(octaves);
        std::vector<cv::Point> polygon;
        for (const auto point :
             std::array<Point, 4>{{{left, 0.1}, {right, 0.1}, {right, 0.9}, {left, 0.9}}}) {
            const auto projected = projectPoint(*inverse, point);
            if (!projected || std::abs(projected->x * sx) > 100000 ||
                std::abs(projected->y * sy) > 100000)
                return {};
            polygon.emplace_back(cvRound(projected->x * sx), cvRound(projected->y * sy));
        }
        keys.push_back(std::move(polygon));
    }
    return keys;
}
std::string CameraKeyboard::label(int index) const {
    static const std::array<std::string, 7> names{"C", "D", "E", "F", "G", "A", "B"};
    return names.at(index % 7) + std::to_string(3 + index / 7);
}
std::optional<CameraKeyboard> acquireCameraKeyboard(const cv::Mat &image, int octaves) {
    if (octaves < 1 || octaves > 3 || image.empty() || image.type() != CV_8UC3)
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
        if (std::abs(denominator) < 1e-6)
            return std::nullopt;
        const double t = (delta.x * b.y - delta.y * b.x) / denominator;
        centers[id] = {c[0].x + t * a.x, c[0].y + t * a.y};
    }
    if (std::any_of(counts.begin(), counts.end(), [](int count) { return count != 1; }))
        return std::nullopt;
    std::vector<cv::Point2f> outline;
    for (const auto p : centers)
        outline.emplace_back(p.x, p.y);
    if (!cv::isContourConvex(outline) || std::abs(cv::contourArea(outline)) < 400)
        return std::nullopt;
    const std::array<Point, 4> square{{{0, 0}, {1, 0}, {1, 1}, {0, 1}}};
    const auto transform = computeHomography(centers, square);
    if (!transform || !invertHomography(*transform))
        return std::nullopt;
    CameraKeyboard keyboard{*transform, centers, octaves};
    if (keyboard.polygons(1, 1).size() != size_t(7 * octaves + 1))
        return std::nullopt;
    return keyboard;
}
} // namespace makeshift::cvbaseline
