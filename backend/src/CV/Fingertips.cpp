#include "Fingertips.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace makeshift::cvbaseline {
FingertipEstimate identifyFilteredFingertips(const ShadowDifference &d, FingertipOptions o) {
    validateDifference(d);
    validateFilter(o.filter);
    if (o.minimumComponentArea < 1 || o.minimumComponentArea > 640 * 640 ||
        !std::isfinite(o.minimumProminence) || o.minimumProminence < 1 ||
        o.minimumProminence > 640 || o.minimumSeparation < 2 || o.minimumSeparation > 640 ||
        o.maximumFingerWidth < 3 || o.maximumFingerWidth > 128)
        throw std::invalid_argument("Invalid fingertip options");
    FingertipEstimate result{filteredDarkeningBoundaryMask(d, o.filter), {}};
    const int w = d.width, h = d.height, n = w * h;
    std::vector<int> labels(n), queue(n);
    struct Component {
        int id, left, right, top, bottom;
    };
    std::vector<Component> components;
    int nextId = 0;
    for (int start = 0; start < n; ++start) {
        if (!result.mask[start] || labels[start])
            continue;
        const int id = ++nextId;
        int head = 0, tail = 1;
        queue[0] = start;
        labels[start] = id;
        int left = w, right = 0, top = h, bottom = 0;
        while (head < tail) {
            const int i = queue[head++], x = i % w, y = i / w;
            left = std::min(left, x);
            right = std::max(right, x);
            top = std::min(top, y);
            bottom = std::max(bottom, y);
            for (int dy = -1; dy <= 1; ++dy)
                for (int dx = -1; dx <= 1; ++dx) {
                    const int nx = x + dx, ny = y + dy, j = ny * w + nx;
                    if (nx < 0 || nx >= w || ny < 0 || ny >= h || !result.mask[j] || labels[j])
                        continue;
                    labels[j] = id;
                    queue[tail++] = j;
                }
        }
        if (tail >= o.minimumComponentArea && bottom - top >= 16)
            components.push_back({id, left, right, top, bottom});
    }
    std::vector<Fingertip> tips;
    for (const auto &c : components) {
        std::vector<int> envelope(w, -1);
        for (int x = c.left; x <= c.right; ++x)
            for (int y = c.bottom; y >= c.top + 2; --y) {
                const int i = y * w + x;
                if (labels[i] == c.id && labels[i - w] == c.id && labels[i - 2 * w] == c.id) {
                    envelope[x] = y;
                    break;
                }
            }
        auto smooth = envelope;
        for (int x = c.left; x <= c.right; ++x) {
            std::vector<int> values;
            for (int dx = -2; dx <= 2; ++dx)
                if (x + dx >= 0 && x + dx < w && envelope[x + dx] >= 0)
                    values.push_back(envelope[x + dx]);
            if (!values.empty()) {
                std::sort(values.begin(), values.end());
                smooth[x] = values[values.size() / 2];
            }
        }
        std::vector<Fingertip> proposals;
        for (int x = c.left; x <= c.right; ++x) {
            const int start = x, y = smooth[start];
            int end = start;
            while (end < c.right && smooth[end + 1] == y)
                ++end;
            x = end;
            if (y < c.top + 8 || y >= h - 1 || start == 0 || end == w - 1)
                continue;
            if (smooth[start - 1] >= y || smooth[end + 1] >= y)
                continue;
            const int lowest =
                *std::max_element(envelope.begin() + start, envelope.begin() + end + 1);
            std::vector<int> supported;
            for (int col = start; col <= end; ++col)
                if (envelope[col] == lowest)
                    supported.push_back(col);
            const int center = supported[supported.size() / 2], tipY = envelope[center];
            const int radius = int(std::floor(o.maximumFingerWidth / 2.0 + 0.5));
            int lowLeft = tipY, lowRight = tipY, leftValley = c.left, rightValley = c.right;
            for (int dx = 1; dx <= radius; ++dx) {
                const int lx = start - dx, rx = end + dx;
                const int ly = lx >= 0 && lx < w && envelope[lx] >= 0 ? envelope[lx] : c.top;
                const int ry = rx >= 0 && rx < w && envelope[rx] >= 0 ? envelope[rx] : c.top;
                if (ly < lowLeft) {
                    lowLeft = ly;
                    leftValley = std::max(0, lx);
                }
                if (ry < lowRight) {
                    lowRight = ry;
                    rightValley = std::min(w - 1, rx);
                }
            }
            const double prominence = tipY - std::max(lowLeft, lowRight);
            const int row = std::max(c.top, tipY - 8);
            int left = center, right = center;
            if (tipY < 0 || labels[row * w + center] != c.id)
                continue;
            while (left > leftValley && labels[row * w + left - 1] == c.id)
                --left;
            while (right < rightValley && labels[row * w + right + 1] == c.id)
                ++right;
            const int fingerWidth = right - left + 1;
            if (prominence >= o.minimumProminence && fingerWidth >= 5 &&
                fingerWidth <= o.maximumFingerWidth)
                proposals.push_back(
                    {0, center, tipY, c.id, fingerWidth, prominence, leftValley, rightValley});
        }
        std::stable_sort(proposals.begin(), proposals.end(),
                         [](auto a, auto b) { return a.prominence > b.prominence; });
        for (const auto &p : proposals) {
            const bool duplicate = std::any_of(tips.begin(), tips.end(), [&](auto t) {
                return t.component == p.component &&
                       std::abs(t.x - p.x) <
                           std::max(double(o.minimumSeparation), std::min(t.width, p.width) * 0.85);
            });
            if (!duplicate)
                tips.push_back(p);
        }
    }
    std::stable_sort(tips.begin(), tips.end(), [](auto a, auto b) { return a.x < b.x; });
    if (tips.size() > 20)
        tips.resize(20);
    for (size_t i = 0; i < tips.size(); ++i)
        tips[i].id = int(i) + 1;
    result.candidates = std::move(tips);
    return result;
}
} // namespace makeshift::cvbaseline
