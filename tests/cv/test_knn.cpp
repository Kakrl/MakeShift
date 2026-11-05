#include "KnnReference.hpp"

#include <functional>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <utility>

using makeshift::cvexperiment::KnnReference;

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
    for (int value : {0, 40, 240}) {
        const cv::Mat reference(24, 32, CV_8UC3, cv::Scalar::all(value));
        KnnReference detector(reference);
        const auto result = detector.classify(reference);
        require(cv::countNonZero(result.labels) == 0, "Warm reference must be background");
        require(result.prepareMs >= 0 && result.classifyMs >= 0, "Separate nonnegative timings");
    }
}
void categories() {
    const cv::Mat reference(24, 32, CV_8UC3, cv::Scalar::all(240));
    KnnReference detector(reference);
    cv::Mat frame = reference.clone();
    frame(cv::Rect(0, 0, 8, 8)).setTo(cv::Scalar::all(160));
    frame(cv::Rect(8, 0, 8, 8)).setTo(cv::Scalar(40, 80, 180));
    frame(cv::Rect(16, 0, 8, 8)).setTo(cv::Scalar::all(60));
    const auto mask = detector.classify(frame).labels;
    require(mask.type() == CV_8UC1, "Labels must be uint8 single-channel");
    require(mask.at<unsigned char>(2, 2) == 127, "Proportional dimming should be possible shadow");
    require(mask.at<unsigned char>(2, 10) == 255, "Color change should be foreground");
    require(mask.at<unsigned char>(2, 18) == 255, "Below tau should be foreground");
    require(mask.at<unsigned char>(12, 20) == 0, "Unchanged paper should be background");
}
void independentCases() {
    cv::Mat reference(24, 32, CV_8UC3, cv::Scalar::all(240));
    KnnReference detector(reference);
    const cv::Mat hand(reference.size(), CV_8UC3, cv::Scalar(40, 80, 180));
    const auto first = detector.classify(hand).labels;
    reference.setTo(cv::Scalar::all(0));
    for (int i = 0; i < 80; ++i) {
        cv::theRNG().next();
        const auto rngBefore = cv::theRNG().state;
        require(cv::countNonZero(detector.classify(hand).labels != first) == 0,
                "Repeated cases and external RNG must not change labels");
        require(cv::theRNG().state == rngBefore, "Caller RNG must be restored");
    }
    detector.classify(reference);
    require(cv::countNonZero(detector.classify(hand).labels != first) == 0,
            "Earlier case must not contaminate the next one");
    require(cv::norm(hand, cv::Mat(hand.size(), CV_8UC3, cv::Scalar(40, 80, 180)), cv::NORM_INF) ==
                0,
            "Input must remain unchanged");
}
void distanceThreshold() {
    const cv::Mat reference(24, 32, CV_8UC3, cv::Scalar::all(240));
    const cv::Mat smallChange(reference.size(), CV_8UC3, cv::Scalar::all(230));
    KnnReference tolerant(reference);
    KnnReference strict(reference, {100, 0.5});
    require(cv::countNonZero(tolerant.classify(smallChange).labels) == 0,
            "Squared RGB distance300 is inside default400 tolerance");
    const auto strictMask = strict.classify(smallChange).labels;
    require(cv::countNonZero(strictMask != 127) == 0,
            "Same dimming should be shadow when outside stricter tolerance");
}
void invalidInputs() {
    rejects([] { KnnReference detector(cv::Mat{}); });
    rejects([] { KnnReference detector(cv::Mat(8, 8, CV_8UC1)); });
    const cv::Mat reference(24, 32, CV_8UC3, cv::Scalar::all(240));
    rejects([&] { KnnReference detector(reference, {0, 0.5}); });
    rejects([&] { KnnReference detector(reference, {400, 1}); });
    rejects(
        [&] { KnnReference detector(reference, {400, std::numeric_limits<double>::quiet_NaN()}); });
    KnnReference detector(reference);
    rejects([&] { detector.classify(cv::Mat{}); });
    rejects([&] { detector.classify(cv::Mat(24, 32, CV_32FC3)); });
    rejects([&] { detector.classify(cv::Mat(25, 32, CV_8UC3)); });
    require(cv::countNonZero(detector.classify(reference).labels) == 0,
            "Rejected input must not affect subsequent classification");
}
} // namespace

int main() {
    int failures = 0;
    for (const auto &[name, test] : {std::pair<const char *, void (*)()>{"unchanged", unchanged},
                                     {"categories", categories},
                                     {"independent cases", independentCases},
                                     {"distance threshold", distanceThreshold},
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
