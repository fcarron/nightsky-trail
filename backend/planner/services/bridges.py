from __future__ import annotations

from shapely.geometry import LineString, Point

from planner.domain.coordinates import wgs84_to_lv95
from planner.integrations.overpass import OsmWay

BRIDGE_MATCH_TOLERANCE_METERS = 15.0
BRIDGE_ANCHOR_PADDING_METERS = 5.0


def bridge_ranges_for_geometry(
    coordinates: list[list[float]], ways: list[OsmWay]
) -> list[tuple[float, float]]:
    """Return route-distance ranges where an imported track follows an OSM bridge."""
    if len(coordinates) < 2:
        return []

    route = LineString([wgs84_to_lv95(lon, lat) for lon, lat in coordinates])
    if route.length <= 0:
        return []

    ranges = []
    for way in ways:
        if way.tags.get("bridge") in (None, "no") or len(way.coordinates) < 2:
            continue
        bridge = LineString([wgs84_to_lv95(lon, lat) for lon, lat in way.coordinates])
        if bridge.length <= 0 or route.distance(bridge) > BRIDGE_MATCH_TOLERANCE_METERS:
            continue

        distances = [route.project(Point(point)) for point in bridge.coords]
        start = max(0.0, min(distances) - BRIDGE_ANCHOR_PADDING_METERS)
        end = min(route.length, max(distances) + BRIDGE_ANCHOR_PADDING_METERS)
        if end > start:
            ranges.append((start, end))

    return merge_bridge_ranges(ranges)


def merge_bridge_ranges(ranges: list[tuple[float, float]]) -> list[tuple[float, float]]:
    merged: list[tuple[float, float]] = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1] + BRIDGE_ANCHOR_PADDING_METERS:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged
