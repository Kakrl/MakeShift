#include "Fingertips.hpp"
#include "ShadowDetection.hpp"
#include <algorithm>
#include <cmath>
#include <map>
#include <set>
#include <stdexcept>

namespace makeshift::cvbaseline {
// Port of measureMonotoneShadowPaths in frontend/src/cv/shadowTipEvidence.ts.
// Insertion order matters for the diagnostic witness chosen by DFS.
ShadowPaths measureMonotoneShadowPaths(const ShadowDifference &diff,
                                       const std::vector<uint8_t> &mask, const Fingertip &tip,
                                       CandidateFilter filter, ShadowPathSettings s) {
    validateDifference(diff);
    validateFilter(filter);
    if (s.maximumCurrentLuma &&
        (!std::isfinite(*s.maximumCurrentLuma) || *s.maximumCurrentLuma < 0 ||
         *s.maximumCurrentLuma > 255 || diff.currentLuma.size() != diff.valid.size()))
        throw std::invalid_argument("Invalid shadow brightness restriction");
    const int w = diff.width, h = diff.height, searchWidth = s.searchWidth.value_or(tip.width);
    if (mask.size() != diff.valid.size() || tip.x < 0 || tip.x >= w || tip.y < 0 || tip.y >= h ||
        tip.width < 1 || tip.width > 128 || s.c < 1 || s.c > 24 || s.d < 1 || s.d > 24 || s.e < 1 ||
        s.e > 24 || searchWidth < 1 || searchWidth > 128 || s.minimumUpwardShadowWidth < 1 ||
        s.minimumUpwardShadowWidth > 128 ||
        (s.corridorRadius && (*s.corridorRadius < 1 || *s.corridorRadius > 24)) ||
        (s.downwardThreshold && (!std::isfinite(*s.downwardThreshold) || *s.downwardThreshold < 0 ||
                                 *s.downwardThreshold > 255)))
        throw std::invalid_argument("Invalid tip, mask or DFS settings");
    ShadowPaths result;
    result.aY = tip.y - s.c;
    result.downwardY = tip.y + s.d;
    result.upwardY = result.aY - s.e;
    enum class State { Unknown, Clear, Shadow };
    const auto state = [&](int x, int y, double threshold) {
        if (x < 0 || x >= w || y < 0 || y >= h)
            return State::Unknown;
        const int i = y * w + x;
        if (mask[i])
            return State::Clear;
        const double mismatch =
            filter.method == FilterMethod::Color ? diff.colorShift[i] : diff.residualCurrent[i];
        if (!diff.valid[i] || !std::isfinite(diff.lumaDrop[i]) || !std::isfinite(mismatch) ||
            (filter.method == FilterMethod::Projection && !diff.projectionValid[i]))
            return State::Unknown;
        if (s.maximumCurrentLuma) {
            if (!std::isfinite(diff.currentLuma[i]))
                return State::Unknown;
            if (diff.currentLuma[i] > *s.maximumCurrentLuma)
                return State::Clear;
        }
        return diff.lumaDrop[i] > threshold &&
                       mismatch <= (filter.method == FilterMethod::Color ? filter.maximumColorShift
                                                                         : filter.maximumResidual)
                   ? State::Shadow
                   : State::Clear;
    };
    int left = tip.x, right = tip.x;
    const bool geometryReady = result.aY >= 0 && mask[result.aY * w + tip.x];
    if (geometryReady) {
        while (left > 0 && tip.x - left < tip.width && mask[result.aY * w + left - 1])
            --left;
        while (right < w - 1 && right - tip.x < tip.width && mask[result.aY * w + right + 1])
            ++right;
    }
    result.crossSectionComplete = geometryReady && left > 0 && right < w - 1 &&
                                  !mask[result.aY * w + left - 1] &&
                                  !mask[result.aY * w + right + 1];
    bool incompleteArc = !result.crossSectionComplete;
    std::set<int> contourSeen;
    const auto addContour = [&](int x, int y) {
        if (contourSeen.insert(y * w + x).second)
            result.arc.push_back({x, y});
    };
    if (result.crossSectionComplete) {
        std::set<int> interior;
        std::vector<int> pending;
        for (int x = left; x <= right; ++x) {
            const int i = result.aY * w + x;
            interior.insert(i);
            pending.push_back(i);
        }
        for (size_t k = 0; k < pending.size(); ++k) {
            const int i = pending[k], x = i % w, y = i / w;
            if (y >= tip.y + 6 || y == h - 1)
                incompleteArc = true;
            for (int dy = -1; dy <= 1; ++dy)
                for (int dx = -1; dx <= 1; ++dx) {
                    const int nx = x + dx, ny = y + dy, j = ny * w + nx;
                    if (nx >= left && nx <= right && ny >= result.aY && ny <= tip.y + 6 && ny < h &&
                        mask[j] && interior.insert(j).second)
                        pending.push_back(j);
                }
        }
        for (int x = left; x <= right; ++x) {
            int y = result.aY;
            for (int row = result.aY; row <= std::min(h - 1, tip.y + 6); ++row)
                if (interior.count(row * w + x))
                    y = row;
            addContour(x, y);
        }
        for (int y = result.aY; y <= std::min(h - 1, tip.y + 6); ++y) {
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
    if (s.corridorRadius && !result.arc.empty()) {
        int low = w, high = 0;
        for (auto p : result.arc) {
            low = std::min(low, p.x);
            high = std::max(high, p.x);
        }
        result.corridorMinimumX = std::max(0, low - *s.corridorRadius);
        result.corridorMaximumX = std::min(w - 1, high + *s.corridorRadius);
    }
    std::set<int> edgeSeen;
    for (auto p : result.arc)
        for (int dy = -1; dy <= 1; ++dy)
            for (int dx = -1; dx <= 1; ++dx) {
                const int x = p.x + dx, y = p.y + dy, i = y * w + x;
                if (y >= result.aY && x >= 0 && x < w && y < h && !mask[i] &&
                    edgeSeen.insert(i).second)
                    result.edgeSamples.push_back({x, y});
            }
    const auto search = [&](Pixel seed, double threshold, int direction) {
        ShadowSearch out;
        out.seed = seed;
        const int minimumX = seed.x - searchWidth / 2, maximumX = minimumX + searchWidth - 1;
        const int targetY = direction == 1 ? result.downwardY : result.upwardY;
        const int minimumWidth = direction == -1 ? s.minimumUpwardShadowWidth : 1;
        std::map<int, WidthWitness> cache;
        const auto shadowWidth = [&](int x, int y) {
            const int i = y * w + x;
            const auto found = cache.find(i);
            if (found != cache.end())
                return found->second;
            int l = x, r = x;
            const int low = std::max({0, minimumX, result.corridorMinimumX.value_or(0)});
            const int high = std::min({w - 1, maximumX, result.corridorMaximumX.value_or(w - 1)});
            while (r - l + 1 < minimumWidth && l > low &&
                   state(l - 1, y, threshold) == State::Shadow)
                --l;
            while (r - l + 1 < minimumWidth && r < high &&
                   state(r + 1, y, threshold) == State::Shadow)
                ++r;
            WidthWitness span{l, r, y, r - l + 1};
            cache[i] = span;
            return span;
        };
        const bool firstWide = shadowWidth(seed.x, seed.y).width >= minimumWidth;
        std::vector<int> stack{(seed.y * w + seed.x) * 2 + int(firstWide)};
        std::map<int, int> parents{{stack[0], -1}};
        int reached = -1;
        while (!stack.empty()) {
            const int key = stack.back();
            stack.pop_back();
            const int i = key / 2, x = i % w, y = i / w;
            const bool hasWidth = key % 2 == 1;
            if (direction == 1 ? y >= targetY : y <= targetY) {
                out.targetReached = true;
                if (hasWidth) {
                    reached = key;
                    break;
                }
            }
            for (int dy : {0, direction})
                for (int dx : {-1, 0, 1}) {
                    if (!dx && !dy)
                        continue;
                    const int nx = x + dx, ny = y + dy;
                    if (direction == -1 && ny < targetY)
                        continue;
                    if (nx < minimumX || nx > maximumX) {
                        out.hitWidthLimit = true;
                        continue;
                    }
                    if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
                        out.unavailable = true;
                        continue;
                    }
                    if (result.corridorMinimumX &&
                        (nx < *result.corridorMinimumX || nx > *result.corridorMaximumX)) {
                        out.hitCorridorLimit = true;
                        continue;
                    }
                    const auto next = state(nx, ny, threshold);
                    if (next == State::Unknown) {
                        out.unavailable = true;
                        continue;
                    }
                    if (next == State::Shadow) {
                        const bool wide = hasWidth || shadowWidth(nx, ny).width >= minimumWidth;
                        const int j = (ny * w + nx) * 2 + int(wide);
                        if (parents.emplace(j, key).second)
                            stack.push_back(j);
                    }
                }
        }
        out.reached = reached != -1;
        for (int key = reached; key != -1; key = parents.at(key)) {
            const int i = key / 2;
            out.path.push_back({i % w, i / w});
        }
        std::reverse(out.path.begin(), out.path.end());
        for (auto p : out.path) {
            const auto span = shadowWidth(p.x, p.y);
            if (span.width >= minimumWidth) {
                out.widthWitness = span;
                break;
            }
        }
        return out;
    };
    for (size_t k = 0; k < shadowCutoffs.size(); ++k) {
        auto &level = result.levels[k];
        level.threshold = shadowCutoffs[k];
        const double downThreshold = s.downwardThreshold.value_or(level.threshold);
        const bool unknown =
            incompleteArc ||
            std::any_of(result.edgeSamples.begin(), result.edgeSamples.end(),
                        [&](auto p) { return state(p.x, p.y, level.threshold) == State::Unknown; });
        level.downwardUnknown = unknown;
        level.upwardUnknown = unknown;
        for (auto seed : result.edgeSamples) {
            std::optional<ShadowSearch> down, up;
            if (state(seed.x, seed.y, downThreshold) == State::Shadow)
                down = search(seed, downThreshold, 1);
            if (state(seed.x, seed.y, level.threshold) == State::Shadow)
                up = search(seed, level.threshold, -1);
            const bool ignored = down && up && down->reached && up->reached;
            if (ignored)
                level.ignoredSeeds.push_back(seed);
            if (down) {
                down->ignored = ignored;
                level.downwardSearches.push_back(std::move(*down));
            }
            if (up) {
                up->ignored = ignored;
                level.upwardSearches.push_back(std::move(*up));
            }
        }
        for (const auto &r : level.downwardSearches)
            if (!r.ignored) {
                level.downwardVeto |= r.reached;
                level.downwardUnknown |= r.unavailable;
            }
        for (const auto &r : level.upwardSearches)
            if (!r.ignored) {
                level.upwardReached |= r.reached;
                level.upwardUnknown |= r.unavailable;
            }
        if (level.downwardVeto || (!level.upwardReached && !level.upwardUnknown))
            level.patternMatch = false;
        else if (level.downwardUnknown || !level.upwardReached)
            level.patternMatch = std::nullopt;
        else
            level.patternMatch = true;
    }
    return result;
}
} // namespace makeshift::cvbaseline
