#include "ChromaticLookup.hpp"
#include "Constants.hpp"
#include <algorithm>
#include <cmath>

namespace makeshift::vision {
std::optional<int> chromaticKeyAt(const KeyboardGeometry &geometry, Point nativePoint) {
    const int octaves = geometry.octaves;
    if (octaves < constants::minimumOctaves || octaves > constants::maximumOctaves ||
        !invertHomography(geometry.frameToSheet))
        return std::nullopt;
    const auto sheet = projectPoint(geometry.frameToSheet, nativePoint);
    if (!sheet || sheet->y < constants::keyTop || sheet->y > constants::keyBottom)
        return std::nullopt;
    const double width = (7 * octaves + 1) * constants::whitePitchMm;
    const double span = width - 2 * constants::markerInsetMm;
    const double xMm = sheet->x * span + constants::markerInsetMm;
    if (xMm < 0 || xMm > width)
        return std::nullopt;

    constexpr std::array<int, 5> blackOffsets{1, 3, 6, 8, 10};
    if (sheet->y <= constants::blackBottom) {
        for (int octave = 0; octave < octaves; ++octave) {
            for (size_t key = 0; key < constants::blackBoundaries.size(); ++key) {
                const double center =
                    (7 * octave + constants::blackBoundaries[key]) * constants::whitePitchMm;
                if (std::abs(xMm - center) <= constants::blackWidthMm / 2)
                    return 12 * octave + blackOffsets[key];
            }
        }
    }
    // Inclusive shared white-key boundaries belong to the left key, as in the frontend.
    const int white = std::max(0, int(std::ceil(xMm / constants::whitePitchMm)) - 1);
    constexpr std::array<int, 7> whiteOffsets{0, 2, 4, 5, 7, 9, 11};
    return 12 * (white / 7) + whiteOffsets[white % 7];
}

std::vector<int> pressedChromaticKeys(const KeyboardGeometry &geometry,
                                      const std::vector<Point> &anchors) {
    std::vector<int> keys;
    keys.reserve(anchors.size());
    for (const auto anchor : anchors) {
        if (const auto key = chromaticKeyAt(geometry, anchor))
            keys.push_back(*key);
    }
    std::sort(keys.begin(), keys.end());
    keys.erase(std::unique(keys.begin(), keys.end()), keys.end());
    return keys;
}
} // namespace makeshift::vision
