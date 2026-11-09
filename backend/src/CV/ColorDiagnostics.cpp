#include "ColorDiagnostics.hpp"
#include <algorithm>
#include <cmath>
#include <opencv2/imgproc.hpp>
#include <stdexcept>

namespace makeshift::cvbaseline {
namespace {
struct Space {
    std::string name, title;
    std::array<std::string, 3> channels;
    std::array<double, 3> minimum, span;
    std::array<cv::Mat, 2> pixels;
};
cv::Mat caption(const cv::Mat &image, const std::string &title, const std::string &detail) {
    cv::Mat result(image.rows + 64, image.cols, CV_8UC3, cv::Scalar(24, 24, 24));
    image.copyTo(result(cv::Rect(0, 64, image.cols, image.rows)));
    cv::putText(result, title, {10, 23}, cv::FONT_HERSHEY_SIMPLEX, 0.5, cv::Scalar(240, 240, 240),
                1, cv::LINE_AA);
    cv::putText(result, detail, {10, 47}, cv::FONT_HERSHEY_SIMPLEX, 0.35, cv::Scalar(240, 240, 240),
                1, cv::LINE_AA);
    return result;
}
cv::Vec3f rybApproximation(cv::Vec3f rgb) {
    // Nonstandard artist-style heuristic: remove white, extract yellow, split
    // remaining green into yellow/blue, normalize peak, then restore white.
    const float white = std::min({rgb[0], rgb[1], rgb[2]});
    rgb -= cv::Vec3f(white, white, white);
    const float peak = std::max({rgb[0], rgb[1], rgb[2]});
    float yellow = std::min(rgb[0], rgb[1]);
    rgb[0] -= yellow;
    rgb[1] -= yellow;
    if (rgb[1] > 0 && rgb[2] > 0) {
        rgb[1] *= 0.5f;
        rgb[2] *= 0.5f;
    }
    cv::Vec3f result(rgb[0], yellow + rgb[1], rgb[2] + rgb[1]);
    const float newPeak = std::max({result[0], result[1], result[2]});
    if (newPeak > 0)
        result *= peak / newPeak;
    return result + cv::Vec3f(white, white, white);
}
} // namespace
ColorDiagnostics renderColorDiagnostics(const cv::Mat &current, const cv::Mat &reference,
                                        bool changesOnly) {
    if (current.empty() || current.type() != CV_8UC3 || reference.type() != CV_8UC3 ||
        current.size() != reference.size())
        throw std::invalid_argument("Color diagnostics require matched BGR images");
    std::vector<Space> spaces{
        {"rgb", "RGB", {"R", "G", "B"}, {0, 0, 0}, {1, 1, 1}, {}},
        {"hsv", "HSV", {"H", "S", "V"}, {0, 0, 0}, {360, 1, 1}, {}},
        {"lab", "Lab", {"L", "a", "b"}, {0, -128, -128}, {100, 255, 255}, {}},
        {"ycrcb", "YCrCb", {"Y", "Cr", "Cb"}, {0, 0, 0}, {1, 1, 1}, {}},
        {"normalized-rgb", "Normalized RGB", {"r", "g", "b"}, {0, 0, 0}, {1, 1, 1}, {}},
        {"cmy", "CMY", {"C", "M", "Y"}, {0, 0, 0}, {1, 1, 1}, {}},
        {"ryb", "RYB approximation", {"R", "Y", "B"}, {0, 0, 0}, {1, 1, 1}, {}}};
    std::array<cv::Mat, 2> bgr;
    current.convertTo(bgr[0], CV_32FC3, 1.0 / 255);
    reference.convertTo(bgr[1], CV_32FC3, 1.0 / 255);
    for (int side = 0; side < 2; ++side) {
        cv::cvtColor(bgr[side], spaces[0].pixels[side], cv::COLOR_BGR2RGB);
        cv::cvtColor(bgr[side], spaces[1].pixels[side], cv::COLOR_BGR2HSV);
        cv::cvtColor(bgr[side], spaces[2].pixels[side], cv::COLOR_BGR2Lab);
        cv::cvtColor(bgr[side], spaces[3].pixels[side], cv::COLOR_BGR2YCrCb);
        for (int index : {4, 5, 6})
            spaces[index].pixels[side] = cv::Mat(current.size(), CV_32FC3);
        for (int y = 0; y < current.rows; ++y)
            for (int x = 0; x < current.cols; ++x) {
                const auto rgb = spaces[0].pixels[side].at<cv::Vec3f>(y, x);
                const float sum = rgb[0] + rgb[1] + rgb[2];
                spaces[4].pixels[side].at<cv::Vec3f>(y, x) =
                    sum > 0 ? rgb / sum : cv::Vec3f(0, 0, 0);
                spaces[5].pixels[side].at<cv::Vec3f>(y, x) = cv::Vec3f(1, 1, 1) - rgb;
                spaces[6].pixels[side].at<cv::Vec3f>(y, x) = rybApproximation(rgb);
            }
    }
    ColorDiagnostics result;
    cv::Mat rgbChange;
    cv::absdiff(current, reference, rgbChange);
    for (const auto &space : spaces) {
        std::vector<cv::Mat> panels;
        for (int row = changesOnly ? 2 : 0; row < 3; ++row) {
            const std::string rowName = row == 0 ? "current" : row == 1 ? "reference" : "change";
            const cv::Mat &context = row == 0 ? current : row == 1 ? reference : rgbChange;
            if (!changesOnly)
                panels.push_back(
                    caption(context, row == 2 ? "RGB absolute change (context)" : rowName,
                            space.title + (space.name == "ryb" ? " - nonstandard heuristic"
                                                               : " - grayscale channels")));
            for (int channel = 0; channel < 3; ++channel) {
                const double displayGain = space.name == "ycrcb" && row == 2 && channel > 0 ? 4 : 1;
                cv::Mat gray(current.size(), CV_8UC1);
                for (int y = 0; y < current.rows; ++y)
                    for (int x = 0; x < current.cols; ++x) {
                        const float a = space.pixels[0].at<cv::Vec3f>(y, x)[channel];
                        const float b = space.pixels[1].at<cv::Vec3f>(y, x)[channel];
                        double value = row == 0 ? a : b, span = space.span[channel];
                        if (row == 2) {
                            value = std::abs(a - b);
                            if (space.name == "hsv" && channel == 0) {
                                value = std::min(value, 360.0 - value);
                                span = 180;
                            }
                        } else {
                            value -= space.minimum[channel];
                        }
                        bool undefined = false;
                        for (int side = 0; side < 2; ++side) {
                            if (row != 2 && side != row)
                                continue;
                            if (space.name == "hsv" && channel == 0)
                                undefined |= spaces[1].pixels[side].at<cv::Vec3f>(y, x)[1] <= 1e-6;
                            if (space.name == "normalized-rgb") {
                                const auto p = spaces[0].pixels[side].at<cv::Vec3f>(y, x);
                                undefined |= p[0] + p[1] + p[2] == 0;
                            }
                        }
                        gray.at<uint8_t>(y, x) =
                            undefined
                                ? 128
                                : cv::saturate_cast<uint8_t>(255 * value / span * displayGain);
                    }
                cv::Mat display;
                cv::cvtColor(gray, display, cv::COLOR_GRAY2BGR);
                const std::string title =
                    space.title + " " + space.channels[channel] + " " + rowName;
                std::string detail;
                if (row == 2)
                    detail = space.name == "hsv" && channel == 0
                                 ? "Circular hue change 0..180 deg; gray=undefined"
                                 : "Absolute channel change; fixed full channel range";
                else
                    detail = cv::format("Fixed range %.0f..%.0f; grayscale, no auto contrast",
                                        space.minimum[channel],
                                        space.minimum[channel] + space.span[channel]);
                if (space.name == "normalized-rgb")
                    detail += "; gray=undefined black";
                if (row != 2 && space.name == "hsv" && channel == 0)
                    detail = "Hue 0..360 deg; gray=undefined (no saturation)";
                if (displayGain > 1)
                    detail = "Absolute change x4 for display only; clipped at white";
                const std::string filename = "color-" + space.name + "-" + rowName + "-" +
                                             std::to_string(channel + 1) + ".png";
                DiagnosticImage image{filename, title, detail, display};
                if (row == 2)
                    result.changes.push_back(image);
                if (!changesOnly)
                    panels.push_back(caption(display, title, detail));
            }
        }
        if (changesOnly)
            continue;
        cv::Mat grid(3 * (current.rows + 64), 4 * current.cols, CV_8UC3);
        for (size_t i = 0; i < panels.size(); ++i)
            panels[i].copyTo(
                grid(cv::Rect(int(i % 4) * current.cols, int(i / 4) * (current.rows + 64),
                              current.cols, current.rows + 64)));
        result.images.push_back({"color-" + space.name + "-comparison.png",
                                 space.title + ": current / reference / change",
                                 "Rows: current, reference, absolute change. Columns: RGB context, "
                                 "three grayscale channels. Fixed scales.",
                                 grid});
    }
    return result;
}
} // namespace makeshift::cvbaseline
