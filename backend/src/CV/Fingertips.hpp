#pragma once
#include "ShadowDetection.hpp"

namespace makeshift::cvbaseline {
struct Fingertip {
    int id = 0, x = 0, y = 0, component = 0, width = 0;
    double prominence = 0;
    int lobeLeft = 0, lobeRight = 0;
};
struct FingertipOptions {
    int minimumComponentArea = 80, minimumSeparation = 12, maximumFingerWidth = 44;
    double minimumProminence = 2;
    CandidateFilter filter;
};
struct FingertipEstimate {
    std::vector<uint8_t> mask; // Original filtered mask, including small regions, like frontend.
    std::vector<Fingertip> candidates; // At most 20, ordered by X; IDs are frame-local.
};
// Downward-facing filtered-mask plateau/local-lobe proposals. No tracking or I/O.
FingertipEstimate identifyFilteredFingertips(const ShadowDifference &difference,
                                             FingertipOptions options = {});
// Shared proposal geometry; caller supplies a binary mask (0/1).
FingertipEstimate identifyFingertipsFromMask(int width, int height, std::vector<uint8_t> mask,
                                             FingertipOptions options = {});
} // namespace makeshift::cvbaseline
