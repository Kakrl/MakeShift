#include "Homography.hpp"
#include <algorithm>
#include <cmath>

namespace makeshift::cvbaseline {
std::optional<Homography> computeHomography(const std::array<Point, 4> &source,
                                            const std::array<Point, 4> &target) {
    std::array<std::array<double, 9>, 8> rows{};
    for (int k = 0; k < 4; ++k) {
        const auto [x, y] = source[k];
        const auto [u, v] = target[k];
        if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(u) || !std::isfinite(v))
            return std::nullopt;
        rows[2 * k] = {x, y, 1, 0, 0, 0, -u * x, -u * y, u};
        rows[2 * k + 1] = {0, 0, 0, x, y, 1, -v * x, -v * y, v};
    }
    for (int col = 0; col < 8; ++col) {
        int pivot = col;
        for (int row = col + 1; row < 8; ++row)
            if (std::abs(rows[row][col]) > std::abs(rows[pivot][col]))
                pivot = row;
        if (std::abs(rows[pivot][col]) < 1e-10)
            return std::nullopt;
        std::swap(rows[col], rows[pivot]);
        const double divisor = rows[col][col];
        for (int j = col; j <= 8; ++j)
            rows[col][j] /= divisor;
        for (int row = 0; row < 8; ++row)
            if (row != col) {
                const double factor = rows[row][col];
                for (int j = col; j <= 8; ++j)
                    rows[row][j] -= factor * rows[col][j];
            }
    }
    Homography result{};
    for (int k = 0; k < 8; ++k) {
        result[k] = rows[k][8];
        if (!std::isfinite(result[k]))
            return std::nullopt;
    }
    result[8] = 1;
    return result;
}
std::optional<Point> projectPoint(const Homography &h, Point p) {
    for (double v : h)
        if (!std::isfinite(v))
            return std::nullopt;
    if (!std::isfinite(p.x) || !std::isfinite(p.y))
        return std::nullopt;
    const double denominator = h[6] * p.x + h[7] * p.y + h[8];
    if (std::abs(denominator) < 1e-10)
        return std::nullopt;
    Point result{(h[0] * p.x + h[1] * p.y + h[2]) / denominator,
                 (h[3] * p.x + h[4] * p.y + h[5]) / denominator};
    if (!std::isfinite(result.x) || !std::isfinite(result.y))
        return std::nullopt;
    return result;
}
std::optional<Homography> invertHomography(const Homography &h) {
    for (double v : h)
        if (!std::isfinite(v))
            return std::nullopt;
    const auto [a, b, c, d, e, f, g, j, i] = h;
    const double determinant = a * (e * i - f * j) - b * (d * i - f * g) + c * (d * j - e * g);
    if (std::abs(determinant) < 1e-10 || !std::isfinite(determinant))
        return std::nullopt;
    Homography result{(e * i - f * j) / determinant, (c * j - b * i) / determinant,
                      (b * f - c * e) / determinant, (f * g - d * i) / determinant,
                      (a * i - c * g) / determinant, (c * d - a * f) / determinant,
                      (d * j - e * g) / determinant, (b * g - a * j) / determinant,
                      (a * e - b * d) / determinant};
    for (double v : result)
        if (!std::isfinite(v))
            return std::nullopt;
    return result;
}
} // namespace makeshift::cvbaseline
