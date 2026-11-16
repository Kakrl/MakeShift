// Native oracle/fixture exporter for the JS/WASM contract tests; no camera access.
#include "Vision.hpp"
#include <filesystem>
#include <fstream>
#include <iostream>
#include <opencv2/imgproc.hpp>
#include <opencv2/objdetect/aruco_detector.hpp>
#include <stdexcept>
using namespace makeshift::vision;
namespace {
void point(cv::FileStorage &f, Point p) { f << "{" << "x" << p.x << "y" << p.y << "}"; }
void polygon(cv::FileStorage &f, const std::vector<cv::Point> &p) {
    f << "["; for (auto v : p) point(f, {double(v.x), double(v.y)}); f << "]";
}
cv::Mat paper(bool missing = false) {
    cv::Mat image(480, 640, CV_8UC4, cv::Scalar(230, 230, 230, 255));
    const std::array<cv::Point, 4> centers{{{80, 60}, {560, 60}, {560, 420}, {80, 420}}};
    const auto dictionary = cv::aruco::getPredefinedDictionary(cv::aruco::DICT_4X4_50);
    for (int id = 0; id < (missing ? 3 : 4); ++id) {
        cv::Mat marker, rgba;
        cv::aruco::generateImageMarker(dictionary, id, 48, marker);
        cv::cvtColor(marker, rgba, cv::COLOR_GRAY2RGBA);
        rgba.copyTo(image(cv::Rect(centers[id].x - 24, centers[id].y - 24, 48, 48)));
    }
    return image;
}
cv::Mat finger(int x, int y, bool pressed) {
    auto image = paper();
    image(cv::Rect(x - 10, y - 60, 20, 61)).setTo(cv::Scalar(150, 95, 75, 255));
    if (pressed) {
        image(cv::Rect(x - 13, y - 8, 3, 9)).setTo(cv::Scalar(210, 210, 210, 255));
        image(cv::Rect(x + 10, y - 8, 3, 9)).setTo(cv::Scalar(210, 210, 210, 255));
    }
    return image;
}
template <typename T> void binary(const std::filesystem::path &p, const std::vector<T> &v) {
    std::ofstream out(p, std::ios::binary);
    out.write(reinterpret_cast<const char *>(v.data()), v.size() * sizeof(T));
    if (!out) throw std::runtime_error("Cannot write parity fixture");
}
void result(cv::FileStorage &f, const VisionFrameResult &r, const Vision &v, cv::Size size) {
    f << "{" << "width" << size.width << "height" << size.height;
    f << "referenceReady" << int(r.referenceReady) << "homographyReady" << int(r.homographyReady);
    f << "referenceRevision" << double(r.detection.referenceRevision);
    const auto scan = r.referenceScan;
    f << "referenceScan" << "{" << "status" << (scan == ReferenceScan::Idle ? "idle" :
        scan == ReferenceScan::Captured ? "captured" : "blocked") << "reason" <<
        (scan == ReferenceScan::BlockedMarkers ? "markers-missing-or-invalid" :
         scan == ReferenceScan::BlockedPresses ? "active-presses" :
         scan == ReferenceScan::BlockedFingertips ? "fingertips-in-piano" : "") << "}";
    f << "fingertips" << "[";
    const double sx = double(size.width) / r.analysisRgba.cols, sy = double(size.height) / r.analysisRgba.rows;
    for (const auto &c : r.detection.contacts) {
        f << "{" << "id" << c.tip.id << "point";
        point(f, {c.tip.x * sx, c.tip.y * sy});
        f << "pressed" << int(c.state == ContactState::Pressed) << "state" <<
            (c.state == ContactState::Pressed ? "pressed" : c.state == ContactState::Released ? "released" : "unknown") << "}";
    }
    f << "]" << "pressRanges" << "[";
    for (auto a : r.detection.pressedAnchors) {
        f << "{" << "anchor"; point(f, a);
        f << "outline"; polygon(f, v.geometry()->pressRangeOutline(a, 1, 1)); f << "}";
    }
    f << "]";
    if (v.geometry()) {
        const auto &g = *v.geometry();
        f << "geometry" << "{" << "frameToSheet" << "[";
        for (auto x : g.frameToSheet) f << x;
        f << "]" << "sheetToFrame" << "[";
        const auto inverse = *invertHomography(g.frameToSheet);
        for (auto x : inverse) f << x;
        f << "]" << "markerCenters" << "[";
        for (auto p : g.markerCenters) point(f, p);
        f << "]" << "whiteKeyPolygons" << "[";
        const auto keys = g.polygons(1, 1);
        for (const auto &key : keys) polygon(f, key);
        f << "]" << "keyboardOutline";
        polygon(f, {keys.front()[0], keys.back()[1], keys.back()[2], keys.front()[3]}); f << "}";
    }
    f << "}";
}
}
int main(int argc, char **argv) {
    try {
        if (argc != 2) throw std::invalid_argument("Usage: wasm_parity_native output-directory");
        const std::filesystem::path dir(argv[1]);
        std::filesystem::create_directories(dir);
        int64_t now = 0;
        Vision model([&] { return Vision::TimePoint{} + std::chrono::milliseconds(now); });
        cv::FileStorage f((dir / "manifest.json").string(), cv::FileStorage::WRITE | cv::FileStorage::FORMAT_JSON);
        f << "steps" << "[";
        int index = 0;
        const auto action = [&](const char *name) {
            f << "{" << "action" << name << "}";
            if (std::string(name) == "setReference") model.setReference(); else model.reset();
        };
        const auto frame = [&](cv::Mat image, int octaves = 1) {
            const std::string stem = std::to_string(index++);
            std::vector<uint8_t> bytes(image.data, image.data + image.total() * 4);
            binary(dir / (stem + ".rgba"), bytes);
            const auto r = model.processFrame(image, octaves);
            f << "{" << "action" << "frame" << "time" << double(now) << "file" << (stem + ".rgba")
              << "width" << image.cols << "height" << image.rows << "octaves" << octaves << "expected";
            result(f, r, model, image.size());
            if (r.detection.ready) {
                binary(dir / (stem + ".mask"), r.detection.fingerMask);
                binary(dir / (stem + ".valid"), r.detection.shadows.valid);
                binary(dir / (stem + ".raw"), r.detection.shadows.rawDrop);
                binary(dir / (stem + ".score"), r.detection.shadows.score);
                f << "diagnostics" << stem << "analysisWidth" << r.analysisRgba.cols << "analysisHeight" << r.analysisRgba.rows;
            }
            f << "}";
        };
        frame(paper()); action("setReference"); frame(paper()); frame(paper());
        frame(finger(300, 260, true)); frame(finger(303, 260, false));
        action("setReference"); frame(finger(303, 260, false));
        frame(paper()); frame(finger(300, 260, false));
        action("setReference"); frame(finger(300, 260, false));
        frame(finger(25, 260, false)); action("setReference"); frame(finger(25, 260, false));
        action("reset"); action("setReference"); frame(paper());
        now = 9999; frame(paper()); now = 10000; frame(paper(true));
        now = 19999; frame(paper()); now = 20000; frame(paper());
        frame(paper(), 2); action("setReference"); frame(paper(), 2);
        cv::Mat large; cv::resize(paper(), large, {1280, 960}, 0, 0, cv::INTER_NEAREST);
        frame(large, 2); action("setReference"); frame(large, 2); frame(large, 2);
        action("reset"); action("setReference"); frame(paper(), 3); frame(paper(), 3);
        f << "]"; f.release();
        std::cout << "Exported " << index << " native frames\n";
    } catch (const std::exception &e) { std::cerr << e.what() << '\n'; return 1; }
}
