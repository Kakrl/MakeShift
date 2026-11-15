#pragma once
#include "Fingertips.hpp"
#include "KeyboardGeometry.hpp"
#include "ShadowMeasurements.hpp"
#include <optional>

namespace makeshift::vision {
enum class ContactState { Unknown, Released, Pressed };
struct Contact {
    Fingertip tip;
    ContactState state = ContactState::Unknown;
};
// One combined decision path. Frame-local candidates do not establish press identity.
std::vector<Contact> detectContacts(const ShadowMeasurements &shadows,
                                     const FingertipEstimate &fingers,
                                     const std::optional<KeyboardGeometry> &geometry,
                                     cv::Size nativeSize);
} // namespace makeshift::vision
