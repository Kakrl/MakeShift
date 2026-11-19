#include "ContactDetection.hpp"
#include "Constants.hpp"
#include "ContactGeometry.hpp"

namespace makeshift::vision {
std::vector<Contact> detectContacts(const ShadowMeasurements &shadows,
                                    const FingertipEstimate &fingers,
                                    const std::optional<KeyboardGeometry> &geometry,
                                    cv::Size native) {
    std::vector<Contact> contacts;
    contacts.reserve(fingers.candidates.size());
    for (const auto &tip : fingers.candidates) {
        Contact contact{tip, ContactState::Released};
        const Point nativeTip{double(tip.x) * native.width / shadows.width,
                              double(tip.y) * native.height / shadows.height};
        if (geometry && geometry->withinHomography(nativeTip)) {
            const auto distal = distalGeometry(shadows, fingers.mask, tip);
            const auto dark = constants::darkShadowEnabled
                                  ? darkContact(shadows, fingers.mask, tip, distal)
                                  : std::optional<bool>{false};
            bool accepted = dark == true;
            if (!accepted)
                accepted = lightContact(shadows, fingers.mask, tip, distal);
            if (!accepted) {
                const bool green =
                    midContact(shadows, fingers.mask, tip, distal, constants::greenFloor);
                const bool cyan =
                    midContact(shadows, fingers.mask, tip, distal, constants::cyanFloor);
                accepted = green || cyan;
            }
            contact.state = accepted           ? ContactState::Pressed
                            : dark.has_value() ? ContactState::Released
                                               : ContactState::Unknown;
        }
        contacts.push_back(contact);
    }
    return contacts;
}
} // namespace makeshift::vision
