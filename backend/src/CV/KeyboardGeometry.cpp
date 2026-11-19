#include "KeyboardGeometry.hpp"
#include "Constants.hpp"
#include <algorithm>
#include <cmath>
#include <opencv2/imgproc.hpp>
#include <stdexcept>

namespace makeshift::vision {
namespace {
double markerSpan(int octaves) {
    return (constants::whiteKeysPerOctave * octaves + 1) * constants::whitePitchMm -
           2 * (constants::markerInsetMm);
}
double leftEdge(int octaves) { return -(constants::markerInsetMm) / markerSpan(octaves); }
} // namespace
bool KeyboardGeometry::withinHomography(Point point) const {
    if (octaves < constants::minimumOctaves || octaves > constants::maximumOctaves ||
        !invertHomography(frameToSheet))
        return false;
    return keyAt(point) >= 0;
}
bool KeyboardGeometry::withinPressRange(Point point, Point anchor) const {
    const auto p = projectPoint(frameToSheet, point);
    const auto a = projectPoint(frameToSheet, anchor);
    if (!p || !a)
        return false;
    const double dx = (p->x - a->x) * markerSpan(octaves);
    const double dy =
        (p->y - a->y) * constants::whiteLengthMm / (constants::keyBottom - constants::keyTop);
    return std::hypot(dx, dy) <= constants::pressMatchRadiusMm;
}
std::vector<cv::Point> KeyboardGeometry::pressRangeOutline(Point anchor, double sx,
                                                           double sy) const {
    const auto center = projectPoint(frameToSheet, anchor);
    const auto inverse = invertHomography(frameToSheet);
    if (!center || !inverse)
        return {};
    std::vector<cv::Point> outline;
    outline.reserve(constants::pressRangeSegments);
    for (int i = 0; i < constants::pressRangeSegments; ++i) {
        const double angle = 2 * std::acos(-1.0) * i / constants::pressRangeSegments;
        const Point sheet{
            center->x + constants::pressMatchRadiusMm * std::cos(angle) / markerSpan(octaves),
            center->y + constants::pressMatchRadiusMm * std::sin(angle) *
                            (constants::keyBottom - constants::keyTop) / constants::whiteLengthMm};
        const auto p = projectPoint(*inverse, sheet);
        if (!p || !std::isfinite(p->x * sx) || !std::isfinite(p->y * sy) ||
            std::abs(p->x * sx) > 100000 || std::abs(p->y * sy) > 100000)
            return {};
        outline.emplace_back(cvRound(p->x * sx), cvRound(p->y * sy));
    }
    return outline;
}
int KeyboardGeometry::keyAt(Point point) const {
    const auto p = projectPoint(frameToSheet, point);
    if (!p || p->y < constants::keyTop || p->y > constants::keyBottom)
        return -1;
    const double key = (p->x - leftEdge(octaves)) * markerSpan(octaves) / constants::whitePitchMm;
    const int count = constants::whiteKeysPerOctave * octaves + 1;
    if (key < 0 || key > count)
        return -1;
    // Shared boundaries belong to the first (left) key, as in the browser.
    return std::max(0, int(std::ceil(key)) - 1);
}
std::vector<std::vector<cv::Point>> KeyboardGeometry::polygons(double sx, double sy) const {
    const auto inverse = invertHomography(frameToSheet);
    if (!inverse)
        return {};
    std::vector<std::vector<cv::Point>> keys;
    for (int i = 0; i < constants::whiteKeysPerOctave * octaves + 1; ++i) {
        const double left = leftEdge(octaves) + i * constants::whitePitchMm / markerSpan(octaves);
        const double right = left + constants::whitePitchMm / markerSpan(octaves);
        std::vector<cv::Point> polygon;
        for (const auto point : std::array<Point, 4>{{{left, constants::keyTop},
                                                      {right, constants::keyTop},
                                                      {right, constants::keyBottom},
                                                      {left, constants::keyBottom}}}) {
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
} // namespace makeshift::vision

namespace makeshift::vision {
std::vector<uint8_t> projectBlackKeys(const KeyboardGeometry &g, cv::Size native,
                                      cv::Size analysis) {
    if (native.width < 1 || native.height < 1 || analysis.width < 1 || analysis.height < 1 ||
        analysis.width > constants::analysisSide || analysis.height > constants::analysisSide ||
        g.octaves < constants::minimumOctaves || g.octaves > constants::maximumOctaves ||
        !invertHomography(g.frameToSheet))
        throw std::invalid_argument("Invalid keyboard geometry or image size");
    std::vector<uint8_t> black(analysis.area());
    const double span = markerSpan(g.octaves);
    for (int y = 0; y < analysis.height; ++y) {
        for (int x = 0; x < analysis.width; ++x) {
            const auto p =
                projectPoint(g.frameToSheet, {(x + 0.5) * native.width / analysis.width - 0.5,
                                              (y + 0.5) * native.height / analysis.height - 0.5});
            if (!p || p->y < constants::keyTop || p->y > constants::blackBottom)
                continue;
            const double mm = p->x * span + constants::markerInsetMm;
            for (int octave = 0; octave < g.octaves; ++octave)
                for (int boundary : constants::blackBoundaries)
                    if (std::abs(mm - (constants::whiteKeysPerOctave * octave + boundary) *
                                          constants::whitePitchMm) <= constants::blackWidthMm / 2)
                        black[y * analysis.width + x] = 1;
        }
    }
    return black;
}
} // namespace makeshift::vision
