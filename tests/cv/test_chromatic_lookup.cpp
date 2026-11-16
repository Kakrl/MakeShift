#include "ChromaticLookup.hpp"
#include "Constants.hpp"
#include <iostream>
#include <limits>
#include <stdexcept>

using namespace makeshift::vision;
namespace {
void require(bool ok, const char *message) {
    if (!ok)
        throw std::runtime_error(message);
}
Point cameraPoint(const KeyboardGeometry &g, double whitePosition, double y) {
    const double span = (7 * g.octaves + 1) * constants::whitePitchMm -
                        2 * constants::markerInsetMm;
    const Point sheet{(whitePosition * constants::whitePitchMm - constants::markerInsetMm) / span, y};
    return *projectPoint(*invertHomography(g.frameToSheet), sheet);
}
void pitchesAndPerspective() {
    constexpr std::array<int, 7> whiteOffsets{0, 2, 4, 5, 7, 9, 11};
    constexpr std::array<int, 5> boundaries{1, 2, 4, 5, 6};
    constexpr std::array<int, 5> blackOffsets{1, 3, 6, 8, 10};
    const std::array<Point, 4> sheet{{{0, 0}, {1, 0}, {1, 1}, {0, 1}}};
    const std::array<Point, 4> camera{{{80, 60}, {1150, 120}, {1000, 680}, {170, 620}}};
    for (int octaves = 1; octaves <= 3; ++octaves) {
        KeyboardGeometry g{*computeHomography(camera, sheet), camera, octaves};
        for (int white = 0; white <= 7 * octaves; ++white) {
            const int expected = (white / 7) * 12 + whiteOffsets[white % 7];
            require(chromaticKeyAt(g, cameraPoint(g, white + 0.5, 0.8)) == expected,
                    "Every white key including final C maps through perspective");
        }
        for (int octave = 0; octave < octaves; ++octave) {
            for (size_t key = 0; key < boundaries.size(); ++key) {
                const double center = octave * 7 + boundaries[key];
                require(chromaticKeyAt(g, cameraPoint(g, center, 0.3)) ==
                            octave * 12 + blackOffsets[key],
                        "Every black key takes priority over underlying white regions");
                require(chromaticKeyAt(g, cameraPoint(g, center - 0.1, 0.8)) ==
                            octave * 12 + whiteOffsets[boundaries[key] - 1],
                        "Below a black cap selects the underlying white key");
            }
        }
        for (const Point p : {cameraPoint(g, -0.01, 0.5),
                              cameraPoint(g, 7 * octaves + 1.01, 0.5),
                              cameraPoint(g, 0.5, 0.09), cameraPoint(g, 0.5, 0.91)})
            require(!chromaticKeyAt(g, p), "Outside keyboard produces no key");
        const auto c = cameraPoint(g, 0.5, 0.8);
        const auto sharp = cameraPoint(g, 1, 0.3);
        const auto high = cameraPoint(g, 7 * octaves + 0.5, 0.8);
        require(pressedChromaticKeys(g, {high, sharp, c, sharp, c}) ==
                    std::vector<int>({0, 1, 12 * octaves}),
                "Snapshot is sorted, deduplicated, and includes low C");
        require(pressedChromaticKeys(g, {}).empty(), "Empty press snapshot releases every key");
    }
}
void edgesAndInvalidInputs() {
    // Native pixels equal sheet coordinates here, isolating inclusive edge policy.
    KeyboardGeometry g{{1, 0, 0, 0, 1, 0, 0, 0, 1}, {}, 1};
    require(chromaticKeyAt(g, cameraPoint(g, 0, 0.1)) == 0, "Top-left edge is inclusive");
    require(chromaticKeyAt(g, cameraPoint(g, 8, 0.9)) == 12, "Bottom-right edge is inclusive");
    require(chromaticKeyAt(g, cameraPoint(g, 3, 0.8)) == 4,
            "Shared white boundary belongs to left key (E/F)");
    const double halfBlack = 13.7 / (2 * 23.5);
    require(chromaticKeyAt(g, cameraPoint(g, 1 - halfBlack + 1e-6, 0.3)) == 1,
            "Black width matches frontend physical dimensions");
    require(chromaticKeyAt(g, cameraPoint(g, 1 - halfBlack - 1e-6, 0.3)) == 0,
            "Just outside black cap returns white");
    require(chromaticKeyAt(g, cameraPoint(g, 1, 0.58)) == 1,
            "Black cap bottom is inclusive at 90/150 white length");
    require(chromaticKeyAt(g, cameraPoint(g, 0.99, 0.580001)) == 0,
            "Below black cap returns white");
    require(!chromaticKeyAt(g, {std::numeric_limits<double>::quiet_NaN(), 0.5}),
            "Nonfinite camera point is rejected");
    require(!chromaticKeyAt(g, {0.5, std::numeric_limits<double>::infinity()}),
            "Infinite camera point is rejected");
    g.frameToSheet = {};
    require(!chromaticKeyAt(g, {0.5, 0.5}), "Singular homography is rejected");
    g.frameToSheet = {1, 0, 0, 0, 1, 0, 0, 0, 1};
    for (const int octaves : {0, 4}) {
        g.octaves = octaves;
        require(!chromaticKeyAt(g, {0.5, 0.5}), "Unsupported layout is rejected");
    }
}
} // namespace
int main() {
    try {
        pitchesAndPerspective();
        edgesAndInvalidInputs();
        std::cout << "Chromatic lookup passed: 1-3 octaves, perspective, priority, edges and snapshots\n";
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
