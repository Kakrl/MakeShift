#pragma once
#include <array>
#include <optional>

namespace makeshift::cvbaseline {
struct Point {
    double x = 0, y = 0;
};
using Homography = std::array<double, 9>;
// Port of frontend/src/cv/homography.ts. Ordered corresponding corners,
// unmirrored pixels to caller-defined sheet coordinates. No image warping/I/O.
std::optional<Homography> computeHomography(const std::array<Point, 4> &source,
                                            const std::array<Point, 4> &target);
std::optional<Point> projectPoint(const Homography &matrix, Point point);
std::optional<Homography> invertHomography(const Homography &matrix);
} // namespace makeshift::cvbaseline
