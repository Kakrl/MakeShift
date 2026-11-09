#pragma once
#include "MidShadow.hpp"
#include "ShadowDiagnostics.hpp"
#include <stdexcept>

namespace makeshift::cvbaseline {
inline ShadowAlgorithm cameraShadowAlgorithm(const std::string &name) {
    if (name == "combined")
        return ShadowAlgorithm::Combined;
    if (name == "dark")
        return ShadowAlgorithm::Dark;
    if (name == "light")
        return ShadowAlgorithm::Light;
    if (name == "mid")
        return ShadowAlgorithm::Mid;
    throw std::invalid_argument("Use --algorithm=combined|dark|light|mid");
}

// In-memory camera classification, independent of capture, GUI and key mapping.
// Combined mode uses dark -> light -> mid; individual modes ignore earlier
// decisions while retaining the same mask and distal arc geometry.
inline ShadowPaths measureCameraShadowPaths(const ShadowDifference &difference,
                                            const std::vector<uint8_t> &mask, const Fingertip &tip,
                                            ShadowAlgorithm algorithm, CandidateFilter filter = {},
                                            ShadowPathSettings settings = {}) {
    if (!settings.maximumCurrentLuma)
        settings.maximumCurrentLuma = consideredShadowMaximumLuma;
    auto paths = measureMonotoneShadowPaths(difference, mask, tip, filter, settings);
    paths.algorithm = algorithm;
    const bool independent = algorithm != ShadowAlgorithm::Combined;
    if (algorithm == ShadowAlgorithm::Combined || algorithm == ShadowAlgorithm::Light)
        paths.light = measureLightShadow(difference, mask, tip, paths, independent);
    if (algorithm == ShadowAlgorithm::Combined || algorithm == ShadowAlgorithm::Mid)
        paths.mid = measureMidShadow(difference, mask, tip, paths, *settings.maximumCurrentLuma,
                                     independent);
    return paths;
}
} // namespace makeshift::cvbaseline
