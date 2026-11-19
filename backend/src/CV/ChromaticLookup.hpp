#pragma once
#include "KeyboardGeometry.hpp"
#include <optional>

namespace makeshift::vision {
// Semitone offset from the leftmost C, inclusive 0..12*octaves.
// Same physical regions as frontend keyboardGeometry.ts; black keys take priority.
std::optional<int> chromaticKeyAt(const KeyboardGeometry &geometry, Point nativePoint);
// Fixed press anchors supply stable pitches; multiple anchors on a key collapse to one.
std::vector<int> pressedChromaticKeys(const KeyboardGeometry &geometry,
                                      const std::vector<Point> &anchors);
} // namespace makeshift::vision
