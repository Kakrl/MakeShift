#pragma once
#include "ShadowDetection.hpp"

namespace makeshift::cvbaseline {
// Native experiment: mid-or-darker side opening with a thin front band.
// Finger-blocked side rows can supply assumed opening support, recorded as
// occluded rather than assigned a fabricated shadow width.
// Combined mode skips earlier successes. independent=true evaluates every tip;
// existing dark/light evidence is never changed.
MidShadowEvidence measureMidShadow(const ShadowDifference &difference,
                                   const std::vector<uint8_t> &mask, const Fingertip &tip,
                                   const ShadowPaths &paths, double maximumDarkLuma = 110,
                                   bool independent = false);
} // namespace makeshift::cvbaseline
