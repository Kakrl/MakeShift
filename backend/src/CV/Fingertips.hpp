#pragma once
#include <cstdint>
#include <vector>

namespace makeshift::vision {
struct Fingertip {
    int id = 0, x = 0, y = 0, component = 0, width = 0;
    double prominence = 0;
    int lobeLeft = 0, lobeRight = 0;
};
struct FingertipEstimate {
    std::vector<uint8_t> mask;
    std::vector<Fingertip> candidates; // Frame-local IDs; no press tracking.
};
FingertipEstimate identifyFingertipsFromMask(int width, int height, std::vector<uint8_t> mask);
} // namespace makeshift::vision
