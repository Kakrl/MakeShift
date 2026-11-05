#include "Mog2Reference.hpp"

#include <functional>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <utility>

using makeshift::cvexperiment::Mog2Reference;

namespace {
void require(bool condition, const char *message) {
    if (!condition) {
        throw std::runtime_error(message);
    }
}
void rejects(const std::function<void()> &operation) {
    try {
        operation();
    } catch (const std::invalid_argument &) {
        return;
    }
    throw std::runtime_error("Expected invalid_argument");
}
void unchanged() {
    const cv::Mat reference(24, 32, CV_8UC3, cv::Scalar::all(240));
    Mog2Reference detector(reference);
    require(cv::countNonZero(detector.classify(reference)) == 0,
            "Self-reference must be background");
}
void categories() {
    const cv::Mat reference(24, 32, CV_8UC3, cv::Scalar::all(240));
    Mog2Reference detector(reference);
    cv::Mat frame = reference.clone();
    frame(cv::Rect(0, 0, 8, 8)).setTo(cv::Scalar::all(160));
    frame(cv::Rect(8, 0, 8, 8)).setTo(cv::Scalar(40, 80, 180));
    frame(cv::Rect(16, 0, 8, 8)).setTo(cv::Scalar::all(60));
    const cv::Mat mask = detector.classify(frame);
    require(mask.type() == CV_8UC1, "Labels must be uint8 single-channel");
    require(mask.at<unsigned char>(2, 2) == 127, "Proportional dimming should be possible shadow");
    require(mask.at<unsigned char>(2, 10) == 255, "Color change should be foreground");
    require(mask.at<unsigned char>(2, 18) == 255, "Below tau should be foreground");
    require(mask.at<unsigned char>(12, 20) == 0, "Unchanged paper should be background");
}
void frozen() {
    cv::Mat reference(24, 32, CV_8UC3, cv::Scalar::all(240));
    Mog2Reference detector(reference);
    const cv::Mat hand(reference.size(), CV_8UC3, cv::Scalar(40, 80, 180));
    const cv::Mat first = detector.classify(hand);
    reference.setTo(cv::Scalar::all(0)); // Caller mutation must not mutate the trained model.
    for (int i = 0; i < 600; ++i) {
        require(cv::countNonZero(detector.classify(hand) != first) == 0,
                "Held foreground must not be learned");
    }
    const cv::Mat other(hand.size(), CV_8UC3, cv::Scalar::all(160));
    detector.classify(other);
    require(cv::countNonZero(detector.classify(hand) != first) == 0,
            "Order must not affect labels");
    require(cv::norm(hand, cv::Mat(hand.size(), CV_8UC3, cv::Scalar(40, 80, 180)), cv::NORM_INF) ==
                0,
            "Input must remain unchanged");
}
void invalidInputs() {
    rejects([] { Mog2Reference detector(cv::Mat{}); });
    rejects([] { Mog2Reference detector(cv::Mat(8, 8, CV_8UC1)); });
    const cv::Mat reference(24, 32, CV_8UC3, cv::Scalar::all(240));
    rejects([&] { Mog2Reference detector(reference, {0, 0.5}); });
    rejects([&] { Mog2Reference detector(reference, {16, 1}); });
    rejects(
        [&] { Mog2Reference detector(reference, {16, std::numeric_limits<double>::quiet_NaN()}); });
    Mog2Reference detector(reference);
    rejects([&] { detector.classify(cv::Mat{}); });
    rejects([&] { detector.classify(cv::Mat(24, 32, CV_32FC3)); });
    rejects([&] { detector.classify(cv::Mat(25, 32, CV_8UC3)); });
    require(cv::countNonZero(detector.classify(reference)) == 0,
            "Rejected input must not reset the model");
}
} // namespace

int main() {
    int failures = 0;
    for (const auto &[name, test] : {std::pair<const char *, void (*)()>{"unchanged", unchanged},
                                     {"categories", categories},
                                     {"frozen", frozen},
                                     {"invalid inputs", invalidInputs}}) {
        try {
            test();
            std::cout << "PASS " << name << '\n';
        } catch (const std::exception &error) {
            ++failures;
            std::cerr << "FAIL " << name << ": " << error.what() << '\n';
        }
    }
    return failures == 0 ? 0 : 1;
}
