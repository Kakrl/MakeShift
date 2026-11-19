#include "Constants.hpp"
#include "Vision.hpp"
#include <emscripten/bind.h>
#include <stdexcept>

namespace makeshift::vision {
namespace {
using emscripten::val;
val point(Point p) {
    auto out = val::object();
    out.set("x", p.x);
    out.set("y", p.y);
    return out;
}
val polygon(const std::vector<cv::Point> &vertices) {
    auto out = val::array();
    for (size_t i = 0; i < vertices.size(); ++i)
        out.set(i, point({double(vertices[i].x), double(vertices[i].y)}));
    return out;
}
const char *stateName(ContactState state) {
    return state == ContactState::Pressed    ? "pressed"
           : state == ContactState::Released ? "released"
                                             : "unknown";
}
val scanResult(ReferenceScan scan) {
    auto out = val::object();
    out.set("status", scan == ReferenceScan::Idle       ? "idle"
                      : scan == ReferenceScan::Captured ? "captured"
                                                        : "blocked");
    const char *reason = scan == ReferenceScan::BlockedMarkers      ? "markers-missing-or-invalid"
                         : scan == ReferenceScan::BlockedPresses    ? "active-presses"
                         : scan == ReferenceScan::BlockedFingertips ? "fingertips-in-piano"
                                                                    : nullptr;
    out.set("reason", reason ? val(reason) : val::null());
    return out;
}
template <typename T> val copyPlane(const std::vector<T> &plane, const char *type) {
    return val::global(type).new_(val(emscripten::typed_memory_view(plane.size(), plane.data())));
}
} // namespace
class VisionBinding {
  public:
    void setReference() { model_.setReference(); }
    void reset() {
        model_.reset();
        last_ = {};
    }
    val processFrame(val rgba, int width, int height, int octaves) {
        try {
            // JS validates types/length before this call. Retain capacity across frames.
            if (width < 1 || height < 1 || width > constants::maximumWasmFrameSide ||
                height > constants::maximumWasmFrameSide || octaves < 1 || octaves > 3)
                throw std::invalid_argument("Invalid frame dimensions or octave count");
            input_.resize(size_t(width) * height * 4);
            val(emscripten::typed_memory_view(input_.size(), input_.data()))
                .call<void>("set", rgba);
            const cv::Mat frame(height, width, CV_8UC4, input_.data());
            last_ = model_.processFrame(frame, octaves);
            if (last_.detection.referenceRevision > 9007199254740991ULL)
                throw std::overflow_error(
                    "Reference revision exceeds JavaScript safe integer range");
            auto out = val::object();
            out.set("width", width);
            out.set("height", height);
            out.set("referenceReady", last_.referenceReady);
            out.set("referenceRevision", double(last_.detection.referenceRevision));
            out.set("homographyReady", last_.homographyReady);
            out.set("referenceScan", scanResult(last_.referenceScan));
            auto pressedKeys = val::array();
            for (size_t i = 0; i < last_.pressedKeys.size(); ++i)
                pressedKeys.set(i, last_.pressedKeys[i]);
            out.set("pressedKeys", pressedKeys);
            auto tips = val::array();
            const double sx = double(width) / last_.analysisRgba.cols;
            const double sy = double(height) / last_.analysisRgba.rows;
            for (size_t i = 0; i < last_.detection.contacts.size(); ++i) {
                const auto &c = last_.detection.contacts[i];
                auto tip = val::object();
                tip.set("id", c.tip.id);
                tip.set("point", point({c.tip.x * sx, c.tip.y * sy}));
                tip.set("pressed", c.state == ContactState::Pressed);
                tip.set("state", stateName(c.state));
                tips.set(i, tip);
            }
            out.set("fingertips", tips);
            auto ranges = val::array();
            for (size_t i = 0; i < last_.detection.pressedAnchors.size(); ++i) {
                const auto anchor = last_.detection.pressedAnchors[i];
                auto range = val::object();
                range.set("anchor", point(anchor));
                range.set("outline", polygon(model_.geometry()->pressRangeOutline(anchor, 1, 1)));
                ranges.set(i, range);
            }
            out.set("pressRanges", ranges);
            out.set("geometry", val::null());
            if (model_.geometry()) {
                const auto &g = *model_.geometry();
                auto geometry = val::object();
                auto h = val::array(), inverse = val::array(), centers = val::array(),
                     keys = val::array();
                const auto inv = *invertHomography(g.frameToSheet);
                for (size_t i = 0; i < 9; ++i) {
                    h.set(i, g.frameToSheet[i]);
                    inverse.set(i, inv[i]);
                }
                for (size_t i = 0; i < 4; ++i)
                    centers.set(i, point(g.markerCenters[i]));
                const auto polygons = g.polygons(1, 1);
                for (size_t i = 0; i < polygons.size(); ++i)
                    keys.set(i, polygon(polygons[i]));
                const auto &first = polygons.front(), &last = polygons.back();
                geometry.set("frameToSheet", h);
                geometry.set("sheetToFrame", inverse);
                geometry.set("markerCenters", centers);
                geometry.set("whiteKeyPolygons", keys);
                geometry.set("keyboardOutline", polygon({first[0], last[1], last[2], first[3]}));
                out.set("geometry", geometry);
            }
            return out;
        } catch (const std::exception &error) {
            auto failure = val::object();
            failure.set("error", std::string(error.what()));
            return failure;
        }
    }
    val diagnostics() const {
        if (!last_.detection.ready)
            return val::null();
        const auto &d = last_.detection.shadows;
        auto out = val::object();
        out.set("width", d.width);
        out.set("height", d.height);
        out.set("fingerMask", copyPlane(last_.detection.fingerMask, "Uint8Array"));
        out.set("valid", copyPlane(d.valid, "Uint8Array"));
        out.set("rawDrop", copyPlane(d.rawDrop, "Float32Array"));
        out.set("score", copyPlane(d.score, "Float32Array"));
        return out;
    }

  private:
    Vision model_;
    VisionFrameResult last_;
    std::vector<uint8_t> input_;
};
EMSCRIPTEN_BINDINGS(makeshift_vision) {
    emscripten::constant("maximumFrameSide", constants::maximumWasmFrameSide);
    emscripten::class_<VisionBinding>("VisionBinding")
        .constructor<>()
        .function("setReference", &VisionBinding::setReference)
        .function("reset", &VisionBinding::reset)
        .function("processFrame", &VisionBinding::processFrame)
        .function("diagnostics", &VisionBinding::diagnostics);
}
} // namespace makeshift::vision
