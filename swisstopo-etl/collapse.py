#!/usr/bin/env python3
import json
import math
import sys


def monotone_chain_hull(points):
    """2D convex hull (Andrew's monotone chain), stdlib only. points: [(x, y), ...]"""
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)

    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)

    return lower[:-1] + upper[:-1]


def iter_polygon_vertices(geometry):
    """Yield every (lng, lat, z) vertex across all rings/polygons of a Multi/Polygon Z geometry."""
    coords = geometry['coordinates']
    gtype = geometry['type']
    polygons = coords if gtype == 'MultiPolygon' else [coords]
    for polygon in polygons:
        for ring in polygon:
            for v in ring:
                yield v


# A single Building_solid OBJECTID can, rarely, bundle TIN triangles from two
# spatially disjoint structures (confirmed on the Lausanne tile: OBJECTID 687
# fused two buildings ~1.7km apart). No real single building is this wide, so
# treat it as a data artifact and drop it rather than feed a phantom giant
# into the shadow model.
MAX_PLAUSIBLE_RADIUS_M = 150


def collapse_feature(feature):
    verts3d = list(iter_polygon_vertices(feature['geometry']))
    if len(verts3d) < 3:
        return None, None

    zs = [v[2] for v in verts3d if len(v) > 2]
    if not zs:
        return None, None
    height = max(zs) - min(zs)

    xy = [(v[0], v[1]) for v in verts3d]
    hull = monotone_chain_hull(xy)
    if len(hull) < 3:
        return None, None

    verts = [{'lat': y, 'lng': x} for x, y in hull]

    centroid = {
        'lat': sum(p['lat'] for p in verts) / len(verts),
        'lng': sum(p['lng'] for p in verts) / len(verts),
    }

    cos_lat = math.cos(centroid['lat'] * math.pi / 180)
    radius = 0.0
    for p in verts:
        dlat = (p['lat'] - centroid['lat']) * 111000
        dlng = (p['lng'] - centroid['lng']) * 111000 * cos_lat
        d = math.sqrt(dlat * dlat + dlng * dlng)
        if d > radius:
            radius = d

    if radius > MAX_PLAUSIBLE_RADIUS_M:
        return None, ('oversized', feature.get('properties', {}).get('OBJECTID'), radius)

    return {
        'centroid': centroid,
        'height': height,
        'verts': verts,
        'radius': radius,
        'hasHeight': True,
    }, None


def main():
    if len(sys.argv) != 3:
        print(f"usage: {sys.argv[0]} <in.geojson> <out.json>", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1]) as f:
        data = json.load(f)

    out = []
    skipped = 0
    for feature in data['features']:
        b, flag = collapse_feature(feature)
        if b is None:
            skipped += 1
            if flag:
                kind, objectid, radius = flag
                print(f"  skipped {kind}: OBJECTID={objectid} radius={radius:.0f}m", file=sys.stderr)
            continue
        out.append(b)

    with open(sys.argv[2], 'w') as f:
        json.dump(out, f)

    print(f"collapsed {len(out)} buildings, skipped {skipped}, from {len(data['features'])} features")


if __name__ == '__main__':
    main()
