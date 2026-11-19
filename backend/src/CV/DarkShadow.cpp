#include "ContactGeometry.hpp"
#include "Constants.hpp"
#include <algorithm>
#include <cmath>
#include <set>

namespace makeshift::vision {
ContactGeometry distalGeometry(const ShadowMeasurements &diff,
                                const std::vector<uint8_t> &mask, const Fingertip &tip) {
    ContactGeometry result;
    const int w = diff.width, h = diff.height;
    const int top = tip.y - constants::crossSectionHeight;
    int left = tip.x, right = tip.x;
    const bool geometryReady = top >= 0 && mask[top * w + tip.x];
    if (geometryReady) {
        while (left > 0 && tip.x - left < tip.width && mask[top * w + left - 1])
            --left;
        while (right < w - 1 && right - tip.x < tip.width && mask[top * w + right + 1])
            ++right;
    }
    result.complete = geometryReady && left > 0 && right < w - 1 &&
                                  !mask[top * w + left - 1] &&
                                  !mask[top * w + right + 1];
    std::set<int> contourSeen;
    const auto addContour = [&](int x, int y) {
        if (contourSeen.insert(y * w + x).second)
            result.arc.push_back({x, y});
    };
    if (result.complete) {
        std::set<int> interior;
        std::vector<int> pending;
        for (int x = left; x <= right; ++x) {
            const int i = top * w + x;
            interior.insert(i);
            pending.push_back(i);
        }
        for (size_t k = 0; k < pending.size(); ++k) {
            const int i = pending[k], x = i % w, y = i / w;
            if (y >= tip.y + constants::distalExtension || y == h - 1)
                result.unavailable = true;
            for (int dy = -1; dy <= 1; ++dy)
                for (int dx = -1; dx <= 1; ++dx) {
                    const int nx = x + dx, ny = y + dy, j = ny * w + nx;
                    if (nx >= left && nx <= right && ny >= top && ny <= tip.y + constants::distalExtension && ny < h &&
                        mask[j] && interior.insert(j).second)
                        pending.push_back(j);
                }
        }
        for (int x = left; x <= right; ++x) {
            int y = top;
            for (int row = top; row <= std::min(h - 1, tip.y + constants::distalExtension); ++row)
                if (interior.count(row * w + x))
                    y = row;
            addContour(x, y);
        }
        for (int y = top; y <= std::min(h - 1, tip.y + constants::distalExtension); ++y) {
            int first = -1, last = -1;
            for (int x = left; x <= right; ++x)
                if (interior.count(y * w + x)) {
                    if (first < 0)
                        first = x;
                    last = x;
                }
            if (first >= 0) {
                addContour(first, y);
                addContour(last, y);
            }
        }
    }

    return result;
}
std::optional<bool> darkContact(const ShadowMeasurements &d, const std::vector<uint8_t> &mask,
                                const Fingertip &tip, const ContactGeometry &geometry) {
    const int w = d.width, h = d.height;
    int low = w, high = 0;
    std::set<int> seeds;
    for (auto p : geometry.arc) {
        low = std::min(low, p.x);
        high = std::max(high, p.x);
        for (int dy = -1; dy <= 1; ++dy)
            for (int dx = -1; dx <= 1; ++dx) {
                const int x = p.x + dx, y = p.y + dy;
                if (x >= 0 && x < w && y >= tip.y - constants::crossSectionHeight && y < h &&
                    !mask[y * w + x])
                    seeds.insert(y * w + x);
            }
    }
    low = std::max(0, low - constants::corridorMargin);
    high = std::min(w - 1, high + constants::corridorMargin);
    // Unknown is separate from clear. Fingers block every search.
    const auto state = [&](int x, int y) {
        if (x < 0 || x >= w || y < 0 || y >= h)
            return -1;
        const int i = y * w + x;
        if (mask[i]) return 0;
        if (!d.valid[i] || !std::isfinite(d.score[i])) return -1;
        return int(d.score[i] > constants::darkContactFloor);
    };
    struct Search { bool reached = false, unknown = false; };
    const auto search = [&](int seed, int direction) {
        Search out;
        const int sx = seed % w, sy = seed / w;
        const int minimumX = std::max(low, sx - tip.width / 2);
        const int maximumX = std::min(high, sx - tip.width / 2 + tip.width - 1);
        const int target = direction > 0 ? tip.y + constants::forwardVeto :
            tip.y - constants::crossSectionHeight - constants::supportExtension;
        const int neededWidth = direction > 0 ? 1 : constants::supportWidth;
        const auto wide = [&](int x, int y) {
            int l = x, r = x;
            while (r - l + 1 < neededWidth && l > minimumX && state(l - 1, y) == 1) --l;
            while (r - l + 1 < neededWidth && r < maximumX && state(r + 1, y) == 1) ++r;
            return r - l + 1 >= neededWidth;
        };
        // Width-qualified and unqualified arrivals are distinct states.
        std::vector<int> stack{seed * 2 + int(wide(sx, sy))};
        std::set<int> visited{stack.front()};
        while (!stack.empty()) {
            const int key = stack.back(); stack.pop_back();
            const int i = key / 2, x = i % w, y = i / w;
            const bool hasWidth = key % 2;
            if ((direction > 0 ? y >= target : y <= target) && hasWidth) {
                out.reached = true;
                break;
            }
            for (int dy : {0, direction}) {
                for (int dx : {-1, 0, 1}) {
                    if (!dx && !dy) continue;
                    const int nx = x + dx, ny = y + dy;
                    if (direction < 0 && ny < target) continue;
                    if (nx < minimumX || nx > maximumX) continue;
                    const int next = state(nx, ny);
                    if (next < 0) { out.unknown = true; continue; }
                    if (!next) continue;
                    const int nextKey = (ny * w + nx) * 2 + int(hasWidth || wide(nx, ny));
                    if (visited.insert(nextKey).second) stack.push_back(nextKey);
                }
            }
        }
        return out;
    };
    bool upward = false, downwardUnknown = !geometry.complete || geometry.unavailable, upwardUnknown = !geometry.complete || geometry.unavailable;
    for (int seed : seeds) {
        const int s = state(seed % w, seed / w);
        if (s < 0) { downwardUnknown = upwardUnknown = true; continue; }
        if (!s) continue;
        const auto down = search(seed, 1), up = search(seed, -1);
        if (down.reached && up.reached) continue;
        if (down.reached) return false;
        upward |= up.reached;
        downwardUnknown |= down.unknown;
        upwardUnknown |= up.unknown;
    }
    if (!upward && !upwardUnknown) return false;
    if (downwardUnknown || !upward) return std::nullopt;
    return true;
}
} // namespace makeshift::vision
