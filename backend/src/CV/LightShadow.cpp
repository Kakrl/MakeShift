#include "Constants.hpp"
#include "ContactGeometry.hpp"
#include <algorithm>
#include <cmath>
#include <map>
namespace makeshift::vision {
bool lightContact(const ShadowMeasurements &d, const std::vector<uint8_t> &mask,
                  const Fingertip &tip, const ContactGeometry &geometry) {
    if (!geometry.complete || geometry.arc.empty())
        return false;
    std::vector<Pixel> front;
    const int minimumArea =
        std::max(constants::minimumBlobArea,
                 int(std::ceil(tip.width * tip.width * constants::blobAreaFraction)));
    // Lowest point in each column of the existing distal arc. This preserves
    // the baseline's downward-facing fingertip convention and frozen mask.
    std::map<int, int> bottom;
    for (auto p : geometry.arc) {
        auto found = bottom.find(p.x);
        if (found == bottom.end() || p.y > found->second)
            bottom[p.x] = p.y;
    }
    for (auto [x, y] : bottom)
        front.push_back({x, y});
    const int w = d.width, h = d.height;
    enum class State { Unknown, Clear, Shadow };
    const auto state = [&](int x, int y) {
        if (x < 0 || x >= w || y < 0 || y >= h || mask[y * w + x] || !d.valid[y * w + x] ||
            !std::isfinite(d.score[y * w + x]))
            return State::Unknown;
        return d.score[y * w + x] > constants::clearFloor ? State::Shadow : State::Clear;
    };
    const int lowX = std::max(0, bottom.begin()->first - tip.width / 2);
    const int highX = std::min(w - 1, bottom.rbegin()->first + tip.width / 2);
    const int lowY = std::max(0, tip.y - tip.width);
    const int highY =
        std::min(h - 1, tip.y + std::max(constants::lightForwardExtent, tip.width / 2));
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
    const auto support = [&](int edgeX, int direction) -> bool {
        const int reach = std::max(constants::minimumLightReach,
                                   int(std::ceil(tip.width * constants::sideReachFraction)));
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
                    int(blobs[label->second].size()) >= minimumArea)
                    return true;
            }
        }
        return false;
    };
    for (size_t start = 0; start < front.size();) {
        size_t end = start;
        while (end < front.size()) {
            const auto p = front[end];
            if (end > start && p.x != front[end - 1].x + 1)
                break;
            bool clear = true;
            for (int depth = 1; depth <= constants::lightFrontDepth; ++depth) {
                const auto value = state(p.x, p.y + depth);
                clear &= value == State::Clear;
            }
            if (!clear)
                break;
            ++end;
        }
        if (int(end - start) >= constants::minimumFrontStrip) {
            const bool left = support(front[start].x - 1, -1);
            const bool right = support(front[end - 1].x + 1, 1);
            if (left && right)
                return true;
        }
        start = end > start ? end : start + 1;
    }
    return false;
}
} // namespace makeshift::vision
