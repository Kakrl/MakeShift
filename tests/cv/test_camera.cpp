#include "CameraKeyboard.hpp"
#include "CameraShadow.hpp"
#include "CameraSnapshot.hpp"
#include <chrono>
#include <filesystem>
#include <iostream>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/objdetect/aruco_detector.hpp>
#include <stdexcept>

using namespace makeshift::cvbaseline;
namespace fs = std::filesystem;
namespace {
void require(bool condition, const char *message) {
    if (!condition)
        throw std::runtime_error(message);
}
struct Scratch {
    fs::path directory =
        fs::temp_directory_path() /
        ("makeshift-camera-test-" +
         std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    Scratch() { require(fs::create_directory(directory), "Expected unique scratch directory"); }
    ~Scratch() {
        std::error_code error;
        fs::remove_all(directory, error);
    }
};
cv::Mat markerScene() {
    cv::Mat scene(600, 800, CV_8UC1, cv::Scalar(255));
    const auto dictionary = cv::aruco::getPredefinedDictionary(cv::aruco::DICT_4X4_50);
    const std::array<cv::Point, 4> positions{{{60, 40}, {660, 40}, {660, 490}, {60, 490}}};
    for (int id = 0; id < 4; ++id) {
        cv::Mat marker;
        cv::aruco::generateImageMarker(dictionary, id, 70, marker);
        marker.copyTo(scene(cv::Rect(positions[id], cv::Size(70, 70))));
    }
    cv::Mat bgr;
    cv::cvtColor(scene, bgr, cv::COLOR_GRAY2BGR);
    return bgr;
}
void keysAndMarkers() {
    const auto scene = markerScene();
    const auto keyboard = acquireCameraKeyboard(scene, 1);
    require(bool(keyboard), "Four markers should acquire keyboard");
    require(keyboard->polygons(1, 1).size() == 8, "One octave has eight white keys");
    require(keyboard->label(0) == "C3" && keyboard->label(7) == "C4", "Default note labels");
    require(keyboard->keyAt({20, 300}) == -1 && keyboard->keyAt({400, 20}) == -1,
            "Off-sheet points must not press keys");
    for (int i = 0; i < 8; ++i)
        require(keyboard->keyAt({65 + (i + 0.5) * 82.5, 300}) == i,
                "Printed key center maps to correct key");

    // Detection and hit testing must work in perspective, not only on a rectangle.
    const cv::Mat warp =
        (cv::Mat_<double>(3, 3) << 0.8, 0.07, 25, 0.02, 0.78, 15, 0.0001, 0.00005, 1);
    cv::Mat warped;
    cv::warpPerspective(scene, warped, warp, scene.size(), cv::INTER_LINEAR, cv::BORDER_CONSTANT,
                        cv::Scalar(255, 255, 255));
    const auto perspective = acquireCameraKeyboard(warped, 1);
    require(bool(perspective), "Perspective markers should acquire keyboard");
    Homography matrix{};
    std::copy(warp.ptr<double>(), warp.ptr<double>() + 9, matrix.begin());
    for (int i = 0; i < 8; ++i) {
        const auto point = projectPoint(matrix, {65 + (i + 0.5) * 82.5, 300});
        require(point && perspective->keyAt(*point) == i, "Perspective key mapping");
    }
    cv::Mat missing = scene.clone();
    missing(cv::Rect(650, 480, 90, 90)).setTo(cv::Scalar(255, 255, 255));
    require(!acquireCameraKeyboard(missing, 1), "Missing marker rejects calibration");
    cv::Mat duplicate = scene.clone();
    scene(cv::Rect(60, 40, 70, 70)).copyTo(duplicate(cv::Rect(350, 240, 70, 70)));
    require(!acquireCameraKeyboard(duplicate, 1), "Duplicate marker rejects calibration");

    // Use the same declared 23.5 mm key pitch and fixed marker inset for extensions.
    for (int octaves : {2, 3}) {
        const auto extended = acquireCameraKeyboard(scene, octaves);
        require(extended && extended->polygons(1, 1).size() == size_t(7 * octaves + 1),
                "Extended keyboard count");
    }
}
void snapshots() {
    Scratch scratch;
    const auto image = markerScene();
    cv::Mat reference(image.size(), image.type(), cv::Scalar(212, 215, 220));
    const auto first = saveCameraSnapshot(scratch.directory / "experiment", image, reference);
    const auto second = saveCameraSnapshot(scratch.directory / "experiment", image, reference);
    require(first.image != second.image && first.reference != second.reference,
            "Snapshots never overwrite previous capture");
    for (const auto files : {first, second}) {
        require(cv::norm(image, cv::imread(files.image.string()), cv::NORM_INF) == 0,
                "Snapshot preserves native pixels");
        require(cv::norm(reference, cv::imread(files.reference.string()), cv::NORM_INF) == 0,
                "Snapshot pairs exact captured reference");
    }
    int savedFiles = 0;
    for (const auto &entry : fs::directory_iterator(scratch.directory / "experiment")) {
        require(entry.path().extension() == ".png", "Snapshots produce PNG files only");
        ++savedFiles;
    }
    require(savedFiles == 4, "Two snapshots produce exactly two image/reference PNG pairs");
    const auto noReference = saveCameraSnapshot(scratch.directory, image, {});
    require(noReference.reference.empty() && fs::is_regular_file(noReference.image),
            "Photo before calibration saves without a fake reference");
    bool rejected = false;
    try {
        saveCameraSnapshot(scratch.directory, image, cv::Mat(3, 4, CV_8UC3));
    } catch (const std::invalid_argument &) {
        rejected = true;
    }
    require(rejected, "Mismatched snapshot reference must be rejected");
}
void shadowAlgorithms() {
    require(cameraShadowAlgorithm("combined") == ShadowAlgorithm::Combined &&
                cameraShadowAlgorithm("dark") == ShadowAlgorithm::Dark &&
                cameraShadowAlgorithm("light") == ShadowAlgorithm::Light &&
                cameraShadowAlgorithm("mid") == ShadowAlgorithm::Mid,
            "Camera selects all four shadow modes");
    bool rejected = false;
    try {
        cameraShadowAlgorithm("invalid");
    } catch (const std::invalid_argument &) {
        rejected = true;
    }
    require(rejected, "Invalid algorithm rejected before opening camera");

    cv::Mat reference(80, 80, CV_8UC4, cv::Scalar(230, 230, 230, 255));
    std::vector<uint8_t> mask(80 * 80);
    for (int y = 20; y <= 40; ++y)
        for (int x = 30; x <= 49; ++x)
            mask[y * 80 + x] = 1;
    Fingertip tip;
    tip.x = 40;
    tip.y = 40;
    tip.width = 20;
    CandidateFilter filter;
    filter.method = FilterMethod::FingerMask;
    const auto keyboard = acquireCameraKeyboard(markerScene(), 1);
    require(bool(keyboard), "Synthetic camera keyboard acquired");
    const int keyIndex = keyboard->keyAt({tip.x * 10.0, tip.y * 7.5});
    require(keyIndex >= 0, "Camera tip maps to a calibrated key");
    for (int pattern = 0; pattern < 4; ++pattern) {
        auto frame = reference.clone();
        if (pattern == 1)
            frame(cv::Rect(27, 30, 3, 11)).setTo(cv::Scalar(90, 90, 90, 255));
        if (pattern == 2) {
            frame(cv::Rect(27, 34, 3, 12)).setTo(cv::Scalar(210, 210, 210, 255));
            frame(cv::Rect(50, 34, 3, 12)).setTo(cv::Scalar(210, 210, 210, 255));
        }
        if (pattern == 3)
            for (int up = 0; up <= 10; ++up)
                for (int x = 50; x <= 50 + up; ++x)
                    frame.at<cv::Vec4b>(40 - up, x) = {180, 180, 180, 255};
        const auto difference = measureShadowDifference(frame, reference);
        const auto combined =
            measureCameraShadowPaths(difference, mask, tip, ShadowAlgorithm::Combined, filter);
        const bool highlighted = keyIndex >= 0 && finalShadowDecision(combined).value_or(false);
        require(highlighted == (pattern != 0),
                "Combined highlight accepts each shadow pattern only");
        if (pattern == 1)
            require(combined.levels[1].patternMatch == true &&
                        combined.light.reason == "dark-pass" && combined.mid.reason == "dark-pass",
                    "Dark acceptance skips both camera fallbacks");
        if (pattern == 2)
            require(combined.levels[1].patternMatch == false && combined.light.matched &&
                        combined.mid.reason == "light-pass",
                    "Light fallback drives camera result");
        if (pattern == 3)
            require(combined.levels[1].patternMatch == false && !combined.light.matched &&
                        combined.mid.matched,
                    "Mid fallback drives camera result");
        for (auto algorithm :
             {ShadowAlgorithm::Dark, ShadowAlgorithm::Light, ShadowAlgorithm::Mid}) {
            const auto paths = measureCameraShadowPaths(difference, mask, tip, algorithm, filter);
            const bool expected = pattern == 1   ? algorithm == ShadowAlgorithm::Dark
                                  : pattern == 2 ? algorithm == ShadowAlgorithm::Light
                                  : pattern == 3 ? algorithm == ShadowAlgorithm::Mid
                                                 : false;
            require(finalShadowDecision(paths) == expected,
                    "Individual camera modes report only their own detector");
            if (algorithm == ShadowAlgorithm::Light)
                require(paths.light.evaluated && !paths.mid.evaluated,
                        "Independent light evaluates even after dark matches");
            if (algorithm == ShadowAlgorithm::Mid)
                require(paths.mid.evaluated && !paths.light.evaluated,
                        "Independent mid evaluates every camera candidate");
        }
    }
    auto unavailable = reference.clone();
    unavailable.setTo(cv::Scalar(230, 230, 230, 0));
    const auto paths = measureCameraShadowPaths(measureShadowDifference(unavailable, reference),
                                                mask, tip, ShadowAlgorithm::Combined, filter);
    require(!finalShadowDecision(paths) && !finalShadowDecision(paths).value_or(false),
            "Unknown camera evidence cannot highlight a key");
}
} // namespace
int main() {
    try {
        keysAndMarkers();
        snapshots();
        shadowAlgorithms();
        std::cout << "Camera marker, perspective-key and lossless snapshot checks passed\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
