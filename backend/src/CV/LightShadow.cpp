#include "Fingertips.hpp"
#include <algorithm>
#include <cmath>
#include <map>
#include <stdexcept>

namespace makeshift::cvbaseline {
LightShadowEvidence measureLightShadow(const ShadowDifference &d, const std::vector<uint8_t> &mask,
                                       const Fingertip &tip, const ShadowPaths &paths,
                                       bool independent) {
    validateDifference(d);
    if (mask.size() != d.valid.size() || tip.width < 1 || tip.width > 128 || tip.x < 0 ||
        tip.x >= d.width || tip.y < 0 || tip.y >= d.height)
        throw std::invalid_argument("Invalid light-shadow geometry");
    LightShadowEvidence out;
    if (!independent && paths.levels[1].patternMatch == true) {
        out.reason = "dark-pass";
        return out;
    }
    out.evaluated = true;
    out.minimumStrip = defaultLightShadowMinimumStrip;
    out.minimumBlobArea = std::max(6, int(std::ceil(tip.width * tip.width * 0.04)));
    out.reason = "incomplete-front";
    if (!paths.crossSectionComplete || paths.arc.empty())
        return out;
    // Lowest point in each column of the existing distal arc. This preserves
    // the baseline's downward-facing fingertip convention and frozen mask.
    std::map<int, int> bottom;
    for (auto p : paths.arc) {
        auto found = bottom.find(p.x);
        if (found == bottom.end() || p.y > found->second)
            bottom[p.x] = p.y;
    }
    for (auto [x, y] : bottom)
        out.front.push_back({x, y});
    const int w = d.width, h = d.height;
    CandidateFilter allShadows;
    allShadows.method = FilterMethod::FingerMask;
    using State = ShadowPixelState;
    const auto state = [&](int x, int y) {
        if (x < 0 || x >= w || y < 0 || y >= h || mask[y * w + x])
            return State::Unknown;
        return classifyShadowPixel(d, mask, y * w + x, 5, allShadows);
    };
    const int lowX = std::max(0, bottom.begin()->first - tip.width / 2);
    const int highX = std::min(w - 1, bottom.rbegin()->first + tip.width / 2);
    const int lowY = std::max(0, tip.y - tip.width);
    const int highY = std::min(h - 1, tip.y + std::max(4, tip.width / 2));
    // Local connected components are bounded to this fingertip's neighborhood.
    // Unavailable samples are barriers, never evidence of clear paper.
    std::map<int, int> labels;
    std::vector<std::vector<Pixel>> blobs;
    for (int y = lowY; y <= highY; ++y)
        for (int x = lowX; x <= highX; ++x) {
            if (state(x, y) != State::Shadow || labels.count(y * w + x))
                continue;
            const int id = int(blobs.size());
            std::vector<Pixel> blob{{x, y}};
            labels[y * w + x] = id;
            for (size_t k = 0; k < blob.size(); ++k)
                for (int dy = -1; dy <= 1; ++dy)
                    for (int dx = -1; dx <= 1; ++dx) {
                        const int nx = blob[k].x + dx, ny = blob[k].y + dy;
                        if (nx >= lowX && nx <= highX && ny >= lowY && ny <= highY &&
                            state(nx, ny) == State::Shadow &&
                            labels.emplace(ny * w + nx, id).second)
                            blob.push_back({nx, ny});
                    }
            blobs.push_back(std::move(blob));
        }
    const auto support = [&](int edgeX, int direction) -> std::vector<Pixel> {
        const int reach = std::max(2, int(std::ceil(tip.width * 0.5)));
        for (int step = 0; step <= reach; ++step) {
            const int x = edgeX + direction * step;
            const auto column = bottom.find(x);
            const int frontY = column == bottom.end() ? (direction < 0 ? bottom.begin()->second
                                                                       : bottom.rbegin()->second)
                                                      : column->second;
            for (int y = lowY; y <= frontY + 1; ++y) {
                // Only shadow directly adjacent to the fingertip counts.
                if (x < 0 || x >= w || y < 0 || y >= h || state(x, y) != State::Shadow)
                    continue;
                bool touches = false;
                for (int dy = -1; dy <= 1; ++dy)
                    for (int dx = -1; dx <= 1; ++dx)
                        if (x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h &&
                            mask[(y + dy) * w + x + dx])
                            touches = true;
                const auto label = labels.find(y * w + x);
                if (touches && label != labels.end() &&
                    int(blobs[label->second].size()) >= out.minimumBlobArea)
                    return blobs[label->second];
            }
        }
        return {};
    };
    out.reason = "no-clear-strip";
    bool unknown = false;
    for (size_t start = 0; start < out.front.size();) {
        size_t end = start;
        std::vector<Pixel> band;
        while (end < out.front.size()) {
            const auto p = out.front[end];
            if (end > start && p.x != out.front[end - 1].x + 1)
                break;
            bool clear = true;
            for (int depth = 1; depth <= out.bandDepth; ++depth) {
                const auto value = state(p.x, p.y + depth);
                unknown |= value == State::Unknown;
                clear &= value == State::Clear;
            }
            if (!clear)
                break;
            for (int depth = 1; depth <= out.bandDepth; ++depth)
                band.push_back({p.x, p.y + depth});
            ++end;
        }
        if (int(end - start) >= out.minimumStrip) {
            auto left = support(out.front[start].x - 1, -1);
            auto right = support(out.front[end - 1].x + 1, 1);
            if (out.clearStrip.empty() || end - start > out.clearStrip.size()) {
                out.clearStrip.assign(out.front.begin() + start, out.front.begin() + end);
                out.clearBand = band;
                out.leftShadow = left;
                out.rightShadow = right;
            }
            if (!left.empty() && !right.empty()) {
                out.clearStrip.assign(out.front.begin() + start, out.front.begin() + end);
                out.clearBand = std::move(band);
                out.leftShadow = std::move(left);
                out.rightShadow = std::move(right);
                out.matched = true;
                out.reason = "clear-front-with-two-side-shadows";
                return out;
            }
            out.reason = left.empty() && right.empty() ? "missing-both-side-shadows"
                         : left.empty()                ? "missing-left-shadow"
                                                       : "missing-right-shadow";
        }
        start = end > start ? end : start + 1;
    }
    if (out.clearStrip.empty() && unknown)
        out.reason = "no-clear-strip-unavailable-samples";
    return out;
}
} // namespace makeshift::cvbaseline
