#include "Constants.hpp"
#include "MarkerDetection.hpp"
#include "Pipeline.hpp"
#include "ShadowView.hpp"
#include <iostream>
#include <opencv2/highgui.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/videoio.hpp>
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
cv::Mat analysisFrame(const cv::Mat &bgr) {
    const double scale = std::min(1.0, double(constants::analysisSide) / std::max(bgr.cols, bgr.rows));
    cv::Mat small, rgba;
    cv::resize(bgr, small, {}, scale, scale, cv::INTER_AREA);
    cv::cvtColor(small, rgba, cv::COLOR_BGR2RGBA);
    return rgba;
}
void text(cv::Mat &image, const std::string &value, int y) {
    cv::putText(image, value, {12, y}, cv::FONT_HERSHEY_SIMPLEX, 0.48,
                {240, 240, 240}, 1, cv::LINE_AA);
}
}
int main(int argc, char **argv) {
    try {
        int device = 0, octaves = 1;
        for (int i = 1; i < argc; ++i) {
            const std::string arg = argv[i];
            if (arg == "--help") {
                std::cout << "Usage: shadow_camera [--camera=0] [--octaves=1]\n"
                             "B: capture empty sheet reference and markers; R: reset; Q/Esc: quit.\n"
                             "Live video on left, shadow classes on right.\n";
                return 0;
            }
            if (arg.rfind("--camera=", 0) == 0) device = parseNumber(arg, "--camera=");
            else if (arg.rfind("--octaves=", 0) == 0) octaves = parseNumber(arg, "--octaves=");
            else throw std::invalid_argument("Unknown option: " + arg);
        }
        if (octaves < constants::minimumOctaves || octaves > constants::maximumOctaves)
            throw std::invalid_argument("Octaves must be 1..3");
        cv::VideoCapture camera(device);
        if (!camera.isOpened()) throw std::runtime_error("Cannot open camera " + std::to_string(device));
        camera.set(cv::CAP_PROP_FRAME_WIDTH, constants::cameraWidth);
        camera.set(cv::CAP_PROP_FRAME_HEIGHT, constants::cameraHeight);
        camera.set(cv::CAP_PROP_FPS, constants::cameraFps);
        camera.set(cv::CAP_PROP_BUFFERSIZE, 1);
        Pipeline pipeline;
        const std::string window = "MakeShift - live video | shadow classes";
        cv::namedWindow(window, cv::WINDOW_NORMAL);
        bool windowShown = false;
        while (true) {
            cv::Mat native;
            if (!camera.read(native) || native.empty()) {
                pipeline.reset();
                throw std::runtime_error("Camera stopped delivering frames");
            }
            const auto rgba = analysisFrame(native);
            const auto result = pipeline.processFrame(rgba, native.size());
            cv::Mat video;
            cv::cvtColor(rgba, video, cv::COLOR_RGBA2BGR);
            cv::Mat classes(video.size(), CV_8UC3, cv::Scalar(0, 0, 0));
            if (result.ready) {
                classes = renderShadowClasses(result);
                if (pipeline.geometry()) {
                    for (const auto &polygon : pipeline.geometry()->polygons(
                             double(video.cols) / native.cols, double(video.rows) / native.rows))
                        cv::polylines(video, polygon, true, {180, 180, 180}, 1);
                }
                for (const auto &contact : result.contacts) {
                    const cv::Scalar color = contact.state == ContactState::Pressed ? cv::Scalar(0, 220, 0) :
                        contact.state == ContactState::Released ? cv::Scalar(0, 0, 240) : cv::Scalar(0, 200, 240);
                    for (cv::Mat *panel : {&video, &classes})
                        cv::circle(*panel, {contact.tip.x, contact.tip.y}, 4, color, 1);
                }
            }
            cv::Mat pair;
            cv::hconcat(video, classes, pair);
            cv::Mat display(pair.rows + 96, pair.cols, CV_8UC3, cv::Scalar(28, 28, 28));
            pair.copyTo(display(cv::Rect(0, 0, pair.cols, pair.rows)));
            text(display, "B: empty reference   R: reset   Q/Esc: quit | Keep camera, paper and lighting fixed", pair.rows + 20);
            text(display, !result.ready ? "Waiting for reference: remove hands, show four markers, then press B" :
                pipeline.geometry() ? "Reference ready | geometry/black-key processing active" :
                                      "Reference ready | markers missing: geometry/black-key processing inactive", pair.rows + 42);
            text(display, "Classes: white=clear, blue=faint, cyan, green, yellow, orange, red; dark blue=finger; black=unknown", pair.rows + 64);
            text(display, "Tip circles: green=press, red=release, yellow=unknown | Scores: white=luma drop; black=percent loss", pair.rows + 86);
            cv::imshow(window, display);
            windowShown = true;
            const int key = cv::waitKey(1) & 0xff;
            if (key == 27 || key == 'q' || key == 'Q' ||
                (windowShown && cv::getWindowProperty(window, cv::WND_PROP_VISIBLE) < 1)) break;
            if (key == 'r' || key == 'R') pipeline.reset();
            if (key == 'b' || key == 'B')
                pipeline.setReference(rgba, native.size(), detectKeyboard(native, octaves));
        }
        pipeline.reset();
        camera.release();
        cv::destroyAllWindows();
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
