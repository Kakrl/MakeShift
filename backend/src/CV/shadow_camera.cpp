#include "Constants.hpp"
#include "Pipeline.hpp"
#include "ShadowView.hpp"
#include "Vision.hpp"
#include <array>
#include <chrono>
#include <filesystem>
#include <iostream>
#include <opencv2/highgui.hpp>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/videoio.hpp>
#include <sstream>
#include <stdexcept>
#include <string>

using namespace makeshift::vision;
namespace {
int parseNumber(const std::string &arg, const std::string &prefix) {
    const auto value = arg.substr(prefix.size());
    if (value.empty() || value.find_first_not_of("0123456789") != std::string::npos)
        throw std::invalid_argument("Expected nonnegative integer: " + arg);
    return std::stoi(value);
}
void text(cv::Mat &image, const std::string &value, int y) {
    cv::putText(image, value, {12, y}, cv::FONT_HERSHEY_SIMPLEX, 0.48, {240, 240, 240}, 1,
                cv::LINE_AA);
}
std::string saveCase(const cv::Mat &native, const FrameResult &result) {
    if (!result.ready)
        return "Save skipped: capture reference with B, then wait for detection";
    try {
        const std::filesystem::path directory{MAKESHIFT_CASES_DIR};
        std::filesystem::create_directories(directory);
        const auto timestamp = std::chrono::duration_cast<std::chrono::microseconds>(
                                   std::chrono::system_clock::now().time_since_epoch())
                                   .count();
        std::string name = "case_" + std::to_string(timestamp);
        while (std::filesystem::exists(directory / (name + "_frame.png")) ||
               std::filesystem::exists(directory / (name + "_shadows.png")))
            name += "_1";
        const auto framePath = directory / (name + "_frame.png");
        const auto shadowPath = directory / (name + "_shadows.png");
        if (!cv::imwrite(framePath.string(), native) ||
            !cv::imwrite(shadowPath.string(), renderShadowClasses(result)))
            throw std::runtime_error("PNG write failed; capture may be incomplete");
        std::cout << "Saved " << framePath << " and " << shadowPath << std::endl;
        return "Saved " + name + " (frame + shadows)";
    } catch (const std::exception &error) {
        std::cerr << "Case save failed: " << error.what() << '\n';
        return "Save failed; see terminal for details";
    }
}
void highlightPressedKeys(cv::Mat &video, const KeyboardGeometry &geometry, cv::Size nativeSize,
                          const std::vector<int> &pressedKeys) {
    if (pressedKeys.empty())
        return;
    const auto inverse = invertHomography(geometry.frameToSheet);
    if (!inverse)
        return;
    const double sx = double(video.cols) / nativeSize.width;
    const double sy = double(video.rows) / nativeSize.height;
    // Label the complete keyboard first so black keys mask white-key highlights.
    // Zero is background; chromatic offsets are stored as offset + 1.
    cv::Mat labels(video.size(), CV_8UC1, cv::Scalar(0));
    constexpr std::array<int, 7> whiteOffsets{0, 2, 4, 5, 7, 9, 11};
    const auto whites = geometry.polygons(sx, sy);
    for (size_t i = 0; i < whites.size(); ++i)
        cv::fillConvexPoly(labels, whites[i], cv::Scalar(12 * (i / 7) + whiteOffsets[i % 7] + 1));
    constexpr std::array<int, 5> blackOffsets{1, 3, 6, 8, 10};
    const double span =
        (7 * geometry.octaves + 1) * constants::whitePitchMm - 2 * constants::markerInsetMm;
    for (int octave = 0; octave < geometry.octaves; ++octave) {
        for (size_t i = 0; i < blackOffsets.size(); ++i) {
            const double center =
                (7 * octave + constants::blackBoundaries[i]) * constants::whitePitchMm;
            const double left =
                (center - constants::blackWidthMm / 2 - constants::markerInsetMm) / span;
            const double right =
                (center + constants::blackWidthMm / 2 - constants::markerInsetMm) / span;
            std::vector<cv::Point> polygon;
            for (const Point corner : std::array<Point, 4>{{{left, constants::keyTop},
                                                            {right, constants::keyTop},
                                                            {right, constants::blackBottom},
                                                            {left, constants::blackBottom}}}) {
                const auto point = projectPoint(*inverse, corner);
                if (!point)
                    return;
                polygon.emplace_back(cvRound(point->x * sx), cvRound(point->y * sy));
            }
            cv::fillConvexPoly(labels, polygon, cv::Scalar(12 * octave + blackOffsets[i] + 1));
        }
    }
    std::array<bool, 12 * constants::maximumOctaves + 2> active{};
    for (const int key : pressedKeys)
        if (key >= 0 && key <= 12 * geometry.octaves)
            active[key + 1] = true;
    const cv::Vec3b highlight{0, 60, 255}; // BGR, display only.
    for (int y = 0; y < video.rows; ++y) {
        auto *pixels = video.ptr<cv::Vec3b>(y);
        const auto *keys = labels.ptr<uint8_t>(y);
        for (int x = 0; x < video.cols; ++x)
            if (active[keys[x]])
                for (int channel = 0; channel < 3; ++channel)
                    pixels[x][channel] = cv::saturate_cast<uint8_t>(0.6 * pixels[x][channel] +
                                                                    0.4 * highlight[channel]);
    }
}
} // namespace
int main(int argc, char **argv) {
    try {
        int device = 0, octaves = 1;
        for (int i = 1; i < argc; ++i) {
            const std::string arg = argv[i];
            if (arg == "--help") {
                std::cout
                    << "Usage: shadow_camera [--camera=0] [--octaves=1]\n"
                       "B: request empty sheet reference and markers; R: reset; Q/Esc: quit.\n"
                       "S: save raw camera frame and clean shadow classes to " MAKESHIFT_CASES_DIR
                       "\n"
                       "Live video on left, shadow classes on right; guarded reference checks "
                       "every 10 seconds.\n";
                return 0;
            }
            if (arg.rfind("--camera=", 0) == 0)
                device = parseNumber(arg, "--camera=");
            else if (arg.rfind("--octaves=", 0) == 0)
                octaves = parseNumber(arg, "--octaves=");
            else
                throw std::invalid_argument("Unknown option: " + arg);
        }
        if (octaves < constants::minimumOctaves || octaves > constants::maximumOctaves)
            throw std::invalid_argument("Octaves must be 1..3");
        cv::VideoCapture camera(device);
        if (!camera.isOpened())
            throw std::runtime_error("Cannot open camera " + std::to_string(device));
        camera.set(cv::CAP_PROP_FRAME_WIDTH, constants::cameraWidth);
        camera.set(cv::CAP_PROP_FRAME_HEIGHT, constants::cameraHeight);
        camera.set(cv::CAP_PROP_FPS, constants::cameraFps);
        camera.set(cv::CAP_PROP_BUFFERSIZE, 1);
        Vision vision;
        std::string scanStatus = "Reference: press B with empty paper and all four markers visible";
        std::string saveStatus = "S: save current frame + shadow classes to backend/src/CV/cases";
        const std::string window = "MakeShift - live video | shadow classes";
        cv::namedWindow(window, cv::WINDOW_NORMAL);
        bool windowShown = false;
        while (true) {
            cv::Mat native;
            if (!camera.read(native) || native.empty()) {
                vision.reset();
                throw std::runtime_error("Camera stopped delivering frames");
            }
            cv::Mat nativeRgba;
            cv::cvtColor(native, nativeRgba, cv::COLOR_BGR2RGBA);
            const auto output = vision.processFrame(nativeRgba, octaves);
            const auto &rgba = output.analysisRgba;
            const auto &result = output.detection;
            switch (output.referenceScan) {
            case ReferenceScan::Captured:
                scanStatus = "Reference captured; next automatic check in 10 seconds";
                break;
            case ReferenceScan::BlockedMarkers:
                scanStatus = "Reference check blocked: four valid markers required";
                break;
            case ReferenceScan::BlockedPresses:
                scanStatus = "Reference check blocked: active press";
                break;
            case ReferenceScan::BlockedFingertips:
                scanStatus = "Reference check blocked: fingertip inside piano homography";
                break;
            case ReferenceScan::Idle:
                break;
            }
            cv::Mat video;
            cv::cvtColor(rgba, video, cv::COLOR_RGBA2BGR);
            cv::Mat classes(video.size(), CV_8UC3, cv::Scalar(0, 0, 0));
            if (result.ready) {
                classes = renderShadowClasses(result);
                if (vision.geometry()) {
                    highlightPressedKeys(video, *vision.geometry(), native.size(),
                                         output.pressedKeys);
                    for (const auto &polygon : vision.geometry()->polygons(
                             double(video.cols) / native.cols, double(video.rows) / native.rows))
                        cv::polylines(video, polygon, true, {180, 180, 180}, 1);
                }
                if (vision.geometry()) {
                    for (const auto anchor : result.pressedAnchors) {
                        const auto outline = vision.geometry()->pressRangeOutline(
                            anchor, double(video.cols) / native.cols,
                            double(video.rows) / native.rows);
                        const cv::Point center{cvRound(anchor.x * video.cols / native.cols),
                                               cvRound(anchor.y * video.rows / native.rows)};
                        for (cv::Mat *panel : {&video, &classes}) {
                            if (!outline.empty())
                                cv::polylines(*panel, outline, true, {255, 80, 230}, 1,
                                              cv::LINE_AA);
                            cv::drawMarker(*panel, center, {255, 80, 230}, cv::MARKER_CROSS, 5, 1);
                        }
                    }
                }
                for (const auto &contact : result.contacts) {
                    const cv::Scalar color =
                        contact.state == ContactState::Pressed    ? cv::Scalar(0, 220, 0)
                        : contact.state == ContactState::Released ? cv::Scalar(0, 0, 240)
                                                                  : cv::Scalar(0, 200, 240);
                    for (cv::Mat *panel : {&video, &classes})
                        cv::circle(*panel, {contact.tip.x, contact.tip.y}, 4, color, 1);
                }
            }
            cv::Mat pair;
            cv::hconcat(video, classes, pair);
            cv::Mat display(pair.rows + 184, pair.cols, CV_8UC3, cv::Scalar(28, 28, 28));
            pair.copyTo(display(cv::Rect(0, 0, pair.cols, pair.rows)));
            text(display,
                 "B: empty reference   R: reset   Q/Esc: quit | Keep camera, paper and lighting "
                 "fixed",
                 pair.rows + 20);
            text(display,
                 !output.referenceReady
                     ? "Waiting for reference: clear paper, show four markers, then press B"
                     : "Reference ready | automatic guarded checks every 10 seconds",
                 pair.rows + 42);
            text(display,
                 "Classes: white=clear, blue=faint, cyan, green, yellow, orange, red; dark "
                 "blue=finger; black=unknown",
                 pair.rows + 64);
            text(display,
                 "Tip circles: green=press, red=release, yellow=unknown | Scores: white=luma drop; "
                 "black=percent loss",
                 pair.rows + 86);
            std::ostringstream rangeLabel;
            rangeLabel << "Magenta ring/cross: fixed anchor, radius "
                       << 100 * constants::pressMatchKeyFraction << "% of white-key width ("
                       << constants::pressMatchRadiusMm << " mm)";
            text(display, rangeLabel.str(), pair.rows + 108);
            text(display, scanStatus, pair.rows + 130);
            text(display, "Red key fill on video: held keys (including retained presses)",
                 pair.rows + 152);
            text(display, saveStatus, pair.rows + 174);
            cv::imshow(window, display);
            windowShown = true;
            const int key = cv::waitKey(1) & 0xff;
            if (key == 27 || key == 'q' || key == 'Q' ||
                (windowShown && cv::getWindowProperty(window, cv::WND_PROP_VISIBLE) < 1))
                break;
            if (key == 'r' || key == 'R') {
                vision.reset();
                scanStatus = "Reference cleared; press B to capture again";
            }
            if (key == 'b' || key == 'B')
                vision.setReference();
            if (key == 's' || key == 'S')
                saveStatus = saveCase(native, result);
        }
        vision.reset();
        camera.release();
        cv::destroyAllWindows();
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
