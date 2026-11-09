#include "MidShadow.hpp"
#include "Fingertips.hpp"
#include <algorithm>
#include <cmath>
#include <map>
#include <stdexcept>

namespace makeshift::cvbaseline {
MidShadowEvidence measureMidShadow(const ShadowDifference &d, const std::vector<uint8_t> &mask,
                                   const Fingertip &tip, const ShadowPaths &paths, double darkCap,
                                   bool independent) {
    validateDifference(d);
    if (mask.size() != d.valid.size() || tip.width < 1 || tip.width > 128 || tip.x < 0 ||
        tip.x >= d.width || tip.y < 0 || tip.y >= d.height || !std::isfinite(darkCap) ||
        darkCap < 0 || darkCap > 255)
        throw std::invalid_argument("Invalid mid-shadow geometry or brightness cap");
    MidShadowEvidence out;
    if (!independent && (paths.levels[1].patternMatch == true || paths.light.matched)) {
        out.reason = paths.light.matched ? "light-pass" : "dark-pass";
        return out;
    }
    out.evaluated = true;
    out.minimumBlobArea = std::max(6, int(std::ceil(tip.width * tip.width * 0.04)));
    out.maximumEdgeStep = std::max(2, int(std::ceil(tip.width * 0.15)));
    if (!paths.crossSectionComplete || paths.arc.empty()) {
        out.reason = "incomplete-front";
        return out;
    }
    std::map<int, int> bottom;
    for (auto p : paths.arc) {
        if (p.x < 0 || p.x >= d.width || p.y < 0 || p.y >= d.height)
            throw std::invalid_argument("Invalid mid-shadow arc");
        auto found = bottom.find(p.x);
        if (found == bottom.end() || p.y > found->second)
            bottom[p.x] = p.y;
    }
    std::vector<Pixel> front;
    for (auto [x, y] : bottom)
        front.push_back({x, y});
    out.reason = "no-thin-front";
    const int w = d.width, h = d.height;
    // Unknown and fingers are barriers. Faint shadows are ignored only as
    // thickness evidence, never treated as a route through unavailable pixels.
    const auto known = [&](int x, int y) {
        return x >= 0 && x < w && y >= 0 && y < h && d.valid[y * w + x] && !mask[y * w + x];
    };
    const auto strongShadow = [&](int x, int y) {
        return known(x, y) && d.lumaDrop[y * w + x] > 5 &&
               (d.lumaDrop[y * w + x] >= middleShadowMinimumDrop ||
                d.currentLuma[y * w + x] <= darkCap);
    };
    const auto finger = [&](int x, int y) {
        return x >= 0 && x < w && y >= 0 && y < h && d.valid[y * w + x] && mask[y * w + x];
    };
    std::vector<Pixel> strip, band;
    for (auto p : front) {
        bool thin = p.y >= tip.y - 1 && std::abs(p.x - tip.x) <= std::max(1, tip.width / 4);
        int mid = 0, light = 0;
        std::vector<Pixel> column;
        for (int depth = 1; thin && depth <= out.frontDepth; ++depth) {
            const int y = p.y + depth;
            if (!known(p.x, y)) {
                thin = false;
                break;
            }
            const int i = y * w + p.x;
            if (d.lumaDrop[i] > 5 && d.currentLuma[i] <= darkCap)
                thin = false;
            else if (d.lumaDrop[i] >= middleShadowMinimumDrop)
                ++mid;
            else if (d.lumaDrop[i] > faintShadowMaximumDrop)
                ++light;
            column.push_back({p.x, y});
        }
        thin &= mid <= 1 && light <= 1;
        if (!thin || (!strip.empty() && p.x != strip.back().x + 1)) {
            strip.clear();
            band.clear();
        }
        if (thin) {
            strip.push_back(p);
            band.insert(band.end(), column.begin(), column.end());
            if (strip.size() > out.frontStrip.size()) {
                out.frontStrip = strip;
                out.frontBand = band;
            }
        }
    }
    if (int(out.frontStrip.size()) < out.minimumStrip)
        return out;
    out.reason = "no-early-side-opening";
    const int reach = std::max(4, tip.width / 2);
    for (int direction : {-1, 1}) {
        std::vector<Pixel> boundary, edge;
        std::vector<int> widths;
        std::vector<MidShadowRow> rows;
        int onset = -1;
        for (int up = 0; up <= out.rise; ++up) {
            const int y = tip.y - up;
            if (y < 0 || !mask[y * w + tip.x])
                break;
            int x = tip.x;
            while (x + direction >= 0 && x + direction < w &&
                   std::abs(x + direction - tip.x) <= tip.width && mask[y * w + x + direction])
                x += direction;
            MidShadowRow row;
            row.upwardDistance = up;
            // A previous visible shadow must actually have met a finger before
            // a merged mask can continue that occlusion. A broad target finger
            // by itself is not an occluder. This is a local mask hypothesis,
            // not an anatomical identity or a measurement behind the blocker.
            if (!rows.empty() && rows.back().fingerOccluded &&
                direction * (x - rows.back().fingerEdge.x) > out.maximumEdgeStep) {
                const int anchor = rows.back().fingerEdge.x;
                if (finger(anchor + direction, y)) {
                    row.maskMerged = true;
                    row.fingerOccluded = true;
                    x = anchor;
                }
            }
            int width = 0;
            while (!row.maskMerged && width < reach && strongShadow(x + direction * (width + 1), y))
                ++width;
            row.fingerEdge = {x, y};
            row.visibleWidth = width;
            row.endpoint = {x + direction * (width + 1), y};
            row.fingerOccluded |= width > 0 && finger(row.endpoint.x, y);
            row.scanLimit = width == reach && strongShadow(row.endpoint.x, y);
            rows.push_back(row);
            edge.push_back({x, y});
            boundary.push_back({x + direction * width, y});
            widths.push_back(width);
            if (onset < 0 && (width >= 2 || row.fingerOccluded))
                onset = up;
        }
        if (onset < 0 || onset > out.maximumOnset || int(widths.size()) <= out.rise)
            continue;
        // Fit separation from the finger, not the image-space edge slope.
        // A short overall trend tolerates individual pixel irregularities.
        double sx = 0, sy = 0, sxx = 0, sxy = 0;
        double n = 0;
        bool usedOcclusion = false;
        for (size_t i = 0; i < rows.size(); ++i) {
            usedOcclusion |= rows[i].fingerOccluded;
            if (rows[i].fingerOccluded)
                continue;
            ++n;
            sx += i;
            sy += widths[i];
            sxx += i * i;
            sxy += i * widths[i];
        }
        const double slope = n >= 2 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : 0;
        const int growth = widths.back() - widths.front();
        // The user's experimental rule accepts a finger-blocked endpoint as
        // sufficient opening. Fully visible endpoints still use actual widths
        // and the fitted trend. No arbitrary lengths enter the fit or area.
        const bool shapeAcceptedByOcclusion = rows.back().fingerOccluded;
        if (!shapeAcceptedByOcclusion &&
            (rows.front().fingerOccluded || growth < out.minimumGrowth || slope < 0.5))
            continue;
        // Trace only observed mid/dark pixels; never add mask pixels or unseen
        // area. A merged row is supported only by prior finger-blocked evidence.
        // Local bounds limit both work and borrowing from neighboring fingers.
        int seedRow = onset;
        while (seedRow < int(rows.size()) && widths[seedRow] == 0)
            ++seedRow;
        if (seedRow == int(rows.size()))
            continue;
        std::vector<Pixel> mass{{edge[seedRow].x + direction, edge[seedRow].y}};
        std::map<int, bool> visited;
        visited[mass[0].y * w + mass[0].x] = true;
        bool extendsForward = false;
        for (size_t k = 0; k < mass.size(); ++k) {
            extendsForward |= mass[k].y > tip.y + out.maximumForward;
            for (int dy = -1; dy <= 1; ++dy)
                for (int dx = -1; dx <= 1; ++dx) {
                    const int x = mass[k].x + dx, y = mass[k].y + dy;
                    if (std::abs(x - tip.x) <= tip.width && y >= tip.y - tip.width &&
                        y <= tip.y + out.maximumForward + 1 && strongShadow(x, y) &&
                        visited.emplace(y * w + x, true).second)
                        mass.push_back({x, y});
                }
        }
        bool connected = true;
        for (size_t i = onset; i < edge.size(); ++i)
            connected &=
                rows[i].maskMerged ||
                (widths[i] > 0 && visited.count(edge[i].y * w + edge[i].x + direction) > 0);
        if (!connected || extendsForward || int(mass.size()) < out.minimumBlobArea)
            continue;
        out.direction = direction;
        out.onset = onset;
        out.usedOcclusion = usedOcclusion;
        out.shapeAcceptedByOcclusion = shapeAcceptedByOcclusion;
        out.growth = shapeAcceptedByOcclusion ? 0 : growth;
        out.slope = shapeAcceptedByOcclusion ? 0 : slope;
        out.rows = std::move(rows);
        out.boundary = std::move(boundary);
        out.fingerEdge = std::move(edge);
        out.mass = std::move(mass);
        out.matched = true;
        out.reason = shapeAcceptedByOcclusion ? "thin-front-with-finger-occluded-opening"
                                              : "thin-front-with-early-mid-dark-opening";
        return out;
    }
    return out;
}
} // namespace makeshift::cvbaseline
