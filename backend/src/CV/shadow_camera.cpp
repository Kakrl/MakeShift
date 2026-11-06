#include "CameraKeyboard.hpp"
#include "CameraSnapshot.hpp"
#include "CrFingerDetection.hpp"
#include "Fingertips.hpp"
#include "ShadowDiagnostics.hpp"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <opencv2/highgui.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/videoio.hpp>

using namespace makeshift::cvbaseline;

int main(int argc, char **argv) {
    try {
        cv::CommandLineParser parser(
            argc, argv,
            "{help h | | Show controls}"
            "{camera |0| Camera device index}"
            "{max-side |640| Analysis size, 64..640}"
            "{octaves |1| Octaves on the printed sheet, 1..3}"
            "{snapshot-dir |experiment| Save S-key images here}"
            "{finger-method |cr-otsu| Finger mask: cr-otsu, cr or projection}"
            "{otsu-radius | | Fingertip expansion, 1 or 2 analysis pixels}"
            "{cr-threshold | | Override compiled Cr threshold, 0..255}");
        if (parser.has("help")) {
            parser.printMessage();
            std::cout << "B: capture empty sheet and keys; R: clear reference; Q/Esc: quit.\n"
                         "S: save clean camera image and matching reference to experiment/.\n"
                         "Keep camera/sheet fixed, fingers pointing down in the image.\n"
                         "Green MATCH / red NO MATCH / gray UNKNOWN are shadow patterns.\n";
            return 0;
        }
        const int device = parser.get<int>("camera");
        const int maxSide = parser.get<int>("max-side");
        const int octaves = parser.get<int>("octaves");
        const auto snapshotDirectory = parser.get<std::string>("snapshot-dir");
        const auto fingerMethod = parser.get<std::string>("finger-method");
        const int otsuRadius =
            parser.has("otsu-radius") ? parser.get<int>("otsu-radius") : defaultCrOtsuRadius;
        const double crThreshold = parser.has("cr-threshold") ? parser.get<double>("cr-threshold")
                                                              : defaultCrFingerThreshold;
        if (!parser.check() || device < 0 || maxSide < 64 || maxSide > 640 || octaves < 1 ||
            octaves > 3 || snapshotDirectory.empty() ||
            (fingerMethod != "cr" && fingerMethod != "cr-otsu" && fingerMethod != "projection") ||
            !std::isfinite(crThreshold) || crThreshold < 0 || crThreshold > 255 || otsuRadius < 1 ||
            otsuRadius > 2)
            throw std::invalid_argument(
                "Use --camera=0 (or another index), --max-side=64..640, --octaves=1..3");

        cv::VideoCapture camera(device);
        if (!camera.isOpened())
            throw std::runtime_error(
                "Cannot open camera. Allow camera access for your terminal "
                "in system settings, close other camera apps, or try --camera=1.");
        // Best effort only: camera drivers may ignore these requests.
        camera.set(cv::CAP_PROP_FRAME_WIDTH, 1280);
        camera.set(cv::CAP_PROP_FRAME_HEIGHT, 720);
        camera.set(cv::CAP_PROP_FPS, 30);
        camera.set(cv::CAP_PROP_BUFFERSIZE, 1);
        const std::string window = "MakeShift native shadow camera";
        cv::namedWindow(window, cv::WINDOW_AUTOSIZE);
        cv::Mat reference, referenceBgr, frame;
        cv::Size referenceNative;
        std::optional<CameraKeyboard> keyboard;
        std::string notice = "Remove hands, show all four markers, press B";
        CandidateFilter filter;
        CandidateFilter shadowFilter;
        if (fingerMethod != "projection")
            shadowFilter.method = FilterMethod::FingerMask;
        ShadowPathSettings settings;
        settings.maximumCurrentLuma = consideredShadowMaximumLuma;
        FingertipOptions options;
        options.filter = filter;
        std::cout << "Camera open. Remove hands; press B after exposure settles.\n"
                     "B: reference + keys; S: save snapshot; R: reset; Q/Esc: quit. No audio.\n"
                  << "Residual " << filter.maximumResidual
                  << ", dark luma <= " << *settings.maximumCurrentLuma << ", upward width "
                  << settings.minimumUpwardShadowWidth << ".\n";
        std::cout << "Finger mask: " << fingerMethod << ", Cr threshold " << crThreshold << ".\n";

        while (true) {
            if (!camera.read(frame) || frame.empty())
                throw std::runtime_error("Camera stopped delivering frames. Restart the runner.");
            const auto started = std::chrono::steady_clock::now();
            const double scale = std::min(1.0, double(maxSide) / std::max(frame.cols, frame.rows));
            cv::Mat analysis, rgba;
            cv::resize(frame, analysis,
                       cv::Size(int(std::floor(frame.cols * scale + 0.5)),
                                int(std::floor(frame.rows * scale + 0.5))),
                       0, 0, cv::INTER_AREA);
            cv::cvtColor(analysis, rgba, cv::COLOR_BGR2RGBA);
            if (!reference.empty() &&
                (reference.size() != rgba.size() || referenceNative != frame.size())) {
                reference.release();
                referenceBgr.release();
                keyboard.reset();
                std::cout << "Camera dimensions changed. Remove hands and capture again with B.\n";
            }
            cv::Mat overlay = analysis.clone();
            cv::Mat classes(analysis.size(), CV_8UC3, cv::Scalar(255, 255, 255));
            std::vector<bool> pressed(7 * octaves + 1, false);
            if (!reference.empty()) {
                const auto diff = measureShadowDifference(rgba, reference);
                const auto tips =
                    fingerMethod == "cr-otsu"
                        ? refineCrFingertipsWithOtsu(rgba, reference, crThreshold, otsuRadius,
                                                     options)
                              .refined
                    : fingerMethod == "cr"
                        ? identifyCrChangeFingertips(rgba, reference, crThreshold, options)
                        : identifyFilteredFingertips(diff, options);
                for (int y = 0; y < diff.height; ++y) {
                    for (int x = 0; x < diff.width; ++x) {
                        const int i = y * diff.width + x;
                        auto &pixel = classes.at<cv::Vec3b>(y, x);
                        const auto shadowState =
                            classifyShadowPixel(diff, tips.mask, i, 5, shadowFilter);
                        if (tips.mask[i])
                            pixel = {100, 0, 0};
                        else if (shadowState == ShadowPixelState::Unknown)
                            pixel = {0, 0, 0};
                        else if (shadowState == ShadowPixelState::Shadow)
                            pixel = diff.currentLuma[i] <= consideredShadowMaximumLuma
                                        ? cv::Vec3b(180, 0, 180)
                                        : cv::Vec3b(128, 128, 128);
                    }
                }
                for (const auto &tip : tips.candidates) {
                    const int keyIndex =
                        keyboard ? keyboard->keyAt({tip.x * double(frame.cols) / analysis.cols,
                                                    tip.y * double(frame.rows) / analysis.rows})
                                 : -1;
                    std::optional<bool> decision;
                    // Once calibrated, ignore off-keyboard proposals before expensive DFS.
                    if (!keyboard || keyIndex >= 0) {
                        const auto paths = measureMonotoneShadowPaths(diff, tips.mask, tip,
                                                                      shadowFilter, settings);
                        decision = paths.levels[1].patternMatch; // cutoff 20
                    }
                    if (keyIndex >= 0 && decision.value_or(false))
                        pressed[keyIndex] = true;
                    const cv::Scalar color = !decision   ? cv::Scalar(160, 160, 160)
                                             : *decision ? cv::Scalar(0, 200, 0)
                                                         : cv::Scalar(0, 0, 230);
                    cv::circle(overlay, {tip.x, tip.y}, 5, color, 2);
                    const std::string label = std::to_string(tip.id) + (!decision   ? " UNKNOWN"
                                                                        : *decision ? " MATCH"
                                                                                    : " NO MATCH");
                    cv::putText(overlay, label, {std::max(0, tip.x - 25), std::max(12, tip.y - 10)},
                                cv::FONT_HERSHEY_SIMPLEX, 0.35, color, 1, cv::LINE_AA);
                }
            }
            std::string pressedNames;
            if (keyboard) {
                const auto polygons = keyboard->polygons(double(analysis.cols) / frame.cols,
                                                         double(analysis.rows) / frame.rows);
                cv::Mat fills = overlay.clone();
                for (size_t i = 0; i < polygons.size(); ++i) {
                    if (pressed[i]) {
                        cv::fillConvexPoly(fills, polygons[i], cv::Scalar(30, 220, 30));
                        pressedNames +=
                            (pressedNames.empty() ? "" : ", ") + keyboard->label(int(i));
                    }
                }
                cv::addWeighted(fills, 0.4, overlay, 0.6, 0, overlay);
                for (size_t i = 0; i < polygons.size(); ++i) {
                    cv::polylines(overlay, polygons[i], true,
                                  pressed[i] ? cv::Scalar(30, 240, 30) : cv::Scalar(255, 180, 0), 2,
                                  cv::LINE_AA);
                    const auto p = (polygons[i][2] + polygons[i][3]) / 2;
                    cv::putText(overlay, keyboard->label(int(i)), p, cv::FONT_HERSHEY_SIMPLEX, 0.4,
                                cv::Scalar(255, 255, 255), 1, cv::LINE_AA);
                }
            }
            cv::Mat panels, display;
            cv::hconcat(overlay, classes, panels);
            cv::copyMakeBorder(panels, display, 0, 124, 0, 0, cv::BORDER_CONSTANT,
                               cv::Scalar(25, 25, 25));
            const int textY = panels.rows + 18;
            const double processingMs = std::chrono::duration<double, std::milli>(
                                            std::chrono::steady_clock::now() - started)
                                            .count();
            const std::string status = reference.empty()
                                           ? "Remove hands, press B to capture empty sheet"
                                           : "Reference set | mask " + fingerMethod +
                                                 " | cutoff 20 | analysis " +
                                                 std::to_string(int(processingMs)) + " ms";
            cv::putText(display, status, {8, textY}, cv::FONT_HERSHEY_SIMPLEX, 0.45,
                        cv::Scalar(255, 255, 255), 1, cv::LINE_AA);
            cv::putText(display, "B: reference + keys | S: save photo | R: reset | Q/Esc: quit",
                        {8, textY + 22}, cv::FONT_HERSHEY_SIMPLEX, 0.4, cv::Scalar(230, 230, 230),
                        1);
            cv::putText(display,
                        "Point fingers down in image. Pattern matches are not validated contact or "
                        "key events.",
                        {8, textY + 44}, cv::FONT_HERSHEY_SIMPLEX, 0.4, cv::Scalar(230, 230, 230),
                        1);
            cv::putText(
                display,
                keyboard ? "Pressed: " + (pressedNames.empty() ? std::string("none") : pressedNames)
                         : "Keys: not calibrated - show markers and press B",
                {8, textY + 66}, cv::FONT_HERSHEY_SIMPLEX, 0.45, cv::Scalar(80, 240, 80), 1);
            cv::putText(display, notice, {8, textY + 88}, cv::FONT_HERSHEY_SIMPLEX, 0.4,
                        cv::Scalar(255, 255, 255), 1);
            cv::imshow(window, display);
            const int key = cv::waitKey(1) & 0xff;
            if (key == 27 || key == 'q' || key == 'Q' ||
                // Some window backends return -1 for unsupported properties.
                cv::getWindowProperty(window, cv::WND_PROP_VISIBLE) == 0)
                break;
            if (key == 'r' || key == 'R') {
                reference.release();
                referenceBgr.release();
                keyboard.reset();
                notice = "Reset. Remove hands and press B.";
            }
            if (key == 'b' || key == 'B') {
                reference = rgba.clone();
                referenceBgr = frame.clone();
                referenceNative = frame.size();
                keyboard = acquireCameraKeyboard(frame, octaves);
                notice = keyboard ? "Reference + keys captured. Green keys = shadow pattern MATCH."
                                  : "Reference captured; markers missing/invalid. Show IDs 0,1,2,3 "
                                    "and press B again.";
                std::cout << notice << '\n';
            }
            if (key == 's' || key == 'S') {
                try {
                    const auto files = saveCameraSnapshot(snapshotDirectory, frame, referenceBgr);
                    notice = "Saved " + files.image.filename().string() +
                             (files.reference.empty() ? " (no reference yet)" : " + reference");
                    std::cout << "Snapshot: " << std::filesystem::absolute(files.image) << '\n';
                    if (!files.reference.empty())
                        std::cout << "Reference: " << std::filesystem::absolute(files.reference)
                                  << '\n';
                } catch (const std::exception &error) {
                    notice = std::string("Snapshot failed: ") + error.what();
                    std::cerr << notice << '\n';
                }
            }
        }
        camera.release();
        cv::destroyAllWindows();
        return 0;
    } catch (const std::exception &error) {
        std::cerr << "shadow_camera: " << error.what() << '\n';
        return 1;
    }
}
