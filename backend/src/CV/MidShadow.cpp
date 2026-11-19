#include "Constants.hpp"
#include "ContactGeometry.hpp"
#include <algorithm>
#include <cmath>
#include <map>
#include <set>

namespace makeshift::vision {
bool midContact(const ShadowMeasurements &d, const std::vector<uint8_t> &mask, const Fingertip &tip,
                const ContactGeometry &geometry, double floor) {
    if (!geometry.complete || geometry.arc.empty())
        return false;
    const int w = d.width, h = d.height;
    const auto known = [&](int x, int y) {
        return x >= 0 && x < w && y >= 0 && y < h && d.valid[y * w + x] &&
               std::isfinite(d.score[y * w + x]) && !mask[y * w + x];
    };
    const auto shadow = [&](int x, int y) { return known(x, y) && d.score[y * w + x] > floor; };
    const auto finger = [&](int x, int y) {
        return x >= 0 && x < w && y >= 0 && y < h && d.valid[y * w + x] && mask[y * w + x];
    };
    std::map<int, int> bottom;
    for (auto p : geometry.arc) {
        const auto found = bottom.find(p.x);
        if (found == bottom.end() || p.y > found->second)
            bottom[p.x] = p.y;
    }
    int strip = 0, previous = -2;
    bool frontAccepted = false;
    for (auto [x, y] : bottom) {
        bool thin = y >= tip.y - constants::midFrontNearTip &&
                    std::abs(x - tip.x) <= std::max(1, tip.width / constants::midFrontWidthDivisor);
        int green = 0, cyan = 0;
        for (int depth = 1; thin && depth <= constants::midFrontDepth; ++depth) {
            if (!known(x, y + depth)) {
                thin = false;
                break;
            }
            const double score = d.score[(y + depth) * w + x];
            if (score > constants::darkFloor)
                thin = false;
            else if (score > constants::greenFloor)
                ++green;
            else if (score > constants::cyanFloor)
                ++cyan;
        }
        thin &= green <= constants::midMaximumBandThickness &&
                cyan <= constants::midMaximumBandThickness;
        if (!thin || x != previous + 1)
            strip = 0;
        if (thin && ++strip >= constants::minimumFrontStrip)
            frontAccepted = true;
        previous = x;
    }
    if (!frontAccepted)
        return false;
    struct Row {
        int x, y, width;
        bool occluded, merged;
    };
    const int reach = std::max(constants::midMinimumReach, tip.width / 2);
    const int edgeStep = std::max(constants::midMinimumEdgeStep,
                                  int(std::ceil(tip.width * constants::midEdgeStepFraction)));
    const int minimumArea =
        std::max(constants::minimumBlobArea,
                 int(std::ceil(tip.width * tip.width * constants::blobAreaFraction)));
    for (int direction : {-1, 1}) {
        std::vector<Row> rows;
        int onset = -1;
        for (int up = 0; up <= constants::midRise; ++up) {
            const int y = tip.y - up;
            if (y < 0 || !mask[y * w + tip.x])
                break;
            int x = tip.x;
            while (x + direction >= 0 && x + direction < w &&
                   std::abs(x + direction - tip.x) <= tip.width && mask[y * w + x + direction])
                x += direction;
            bool merged = false;
            if (!rows.empty() && rows.back().occluded &&
                direction * (x - rows.back().x) > edgeStep &&
                finger(rows.back().x + direction, y)) {
                merged = true;
                x = rows.back().x;
            }
            int width = 0;
            while (!merged && width < reach && shadow(x + direction * (width + 1), y))
                ++width;
            const bool occluded = merged || (width > 0 && finger(x + direction * (width + 1), y));
            rows.push_back({x, y, width, occluded, merged});
            if (onset < 0 && (width >= constants::midOpeningWidth || occluded))
                onset = up;
        }
        if (onset < 0 || onset > constants::midMaximumOnset ||
            int(rows.size()) <= constants::midRise)
            continue;
        // Fit measured separation from the finger. Hidden rows supply no invented width.
        double n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (size_t i = 0; i < rows.size(); ++i) {
            if (rows[i].occluded)
                continue;
            ++n;
            sx += i;
            sy += rows[i].width;
            sxx += i * i;
            sxy += i * rows[i].width;
        }
        const double slope = n >= 2 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : 0;
        if (!rows.back().occluded &&
            (rows.front().occluded ||
             rows.back().width - rows.front().width < constants::midMinimumGrowth ||
             slope < constants::midMinimumSlope))
            continue;
        int seedRow = onset;
        while (seedRow < int(rows.size()) && rows[seedRow].width == 0)
            ++seedRow;
        if (seedRow == int(rows.size()))
            continue;
        std::vector<Pixel> mass{{rows[seedRow].x + direction, rows[seedRow].y}};
        std::set<int> visited{mass[0].y * w + mass[0].x};
        bool forward = false;
        for (size_t k = 0; k < mass.size(); ++k) {
            forward |= mass[k].y > tip.y + constants::forwardVeto;
            for (int dy = -1; dy <= 1; ++dy) {
                for (int dx = -1; dx <= 1; ++dx) {
                    const int x = mass[k].x + dx, y = mass[k].y + dy;
                    if (std::abs(x - tip.x) <= tip.width && y >= tip.y - tip.width &&
                        y <= tip.y + constants::forwardVeto + 1 && shadow(x, y) &&
                        visited.insert(y * w + x).second)
                        mass.push_back({x, y});
                }
            }
        }
        bool connected = true;
        for (size_t i = onset; i < rows.size(); ++i)
            connected &= rows[i].merged || (rows[i].width > 0 &&
                                            visited.count(rows[i].y * w + rows[i].x + direction));
        if (connected && !forward && int(mass.size()) >= minimumArea)
            return true;
    }
    return false;
}
} // namespace makeshift::vision
