#pragma once
// Internal contact-stage interface; callers use Pipeline.hpp.
#include "Fingertips.hpp"
#include "ShadowMeasurements.hpp"
#include <optional>
#include <vector>

namespace makeshift::vision {
struct Pixel {
    int x = 0, y = 0;
};
struct ContactGeometry {
    bool complete = false, unavailable = false;
    std::vector<Pixel> arc;
};
ContactGeometry distalGeometry(const ShadowMeasurements &measurements,
                               const std::vector<uint8_t> &mask, const Fingertip &tip);
std::optional<bool> darkContact(const ShadowMeasurements &measurements,
                                const std::vector<uint8_t> &mask, const Fingertip &tip,
                                const ContactGeometry &geometry);
bool lightContact(const ShadowMeasurements &measurements, const std::vector<uint8_t> &mask,
                  const Fingertip &tip, const ContactGeometry &geometry);
bool midContact(const ShadowMeasurements &measurements, const std::vector<uint8_t> &mask,
                const Fingertip &tip, const ContactGeometry &geometry, double sideFloor);
} // namespace makeshift::vision
