from __future__ import annotations

from shapely.geometry import LineString

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

    route_coordinates = [wgs84_to_lv95(lon, lat) for lon, lat in coordinates]
    route = LineString(route_coordinates)
    if route.length <= 0:
        return []
    cumulative_distances = [0.0]
    for first, second in zip(route_coordinates, route_coordinates[1:], strict=False):
        cumulative_distances.append(cumulative_distances[-1] + LineString([first, second]).length)

    ranges = []
    for way in ways:
        if way.tags.get("bridge") in (None, "no") or len(way.coordinates) < 2:
            continue
        bridge = LineString([wgs84_to_lv95(lon, lat) for lon, lat in way.coordinates])
        if bridge.length <= 0 or route.distance(bridge) > BRIDGE_MATCH_TOLERANCE_METERS:
            continue

        matched_ranges: list[tuple[float, float]] = []
        for index, (first, second) in enumerate(
            zip(route_coordinates, route_coordinates[1:], strict=False)
        ):
            segment = LineString([first, second])
            intersection = segment.intersection(bridge.buffer(BRIDGE_MATCH_TOLERANCE_METERS))
            points = geometry_points(intersection)
            if points:
                distances = [
                    cumulative_distances[index] + segment.project(point) for point in points
                ]
                matched_ranges.append((min(distances), max(distances)))
        for start, end in matched_ranges:
            start = max(0.0, start - BRIDGE_ANCHOR_PADDING_METERS)
            end = min(route.length, end + BRIDGE_ANCHOR_PADDING_METERS)
            if end > start:
                ranges.append((start, end))

    return merge_bridge_ranges(ranges)


def geometry_points(geometry: object) -> list[object]:
    if hasattr(geometry, "geoms"):
        return [point for child in geometry.geoms for point in geometry_points(child)]
    if hasattr(geometry, "coords"):
        from shapely.geometry import Point

        return [Point(coordinate) for coordinate in geometry.coords]
    return []


def merge_bridge_ranges(ranges: list[tuple[float, float]]) -> list[tuple[float, float]]:
    merged: list[tuple[float, float]] = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1] + BRIDGE_ANCHOR_PADDING_METERS:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged
