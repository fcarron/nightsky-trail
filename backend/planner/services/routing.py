from __future__ import annotations

from planner.domain.route import (
    ComputedRoute,
    RouteSegment,
    RouteValidationError,
    SegmentRequest,
    Waypoint,
    build_default_straight_segments,
    compute_segment,
    validate_segments,
    validate_waypoints,
)
from planner.integrations.graphhopper import (
    GraphHopperClient,
    GraphHopperError,
)


def compute_route(
    waypoints: list[Waypoint],
    requested_segments: list[SegmentRequest] | None,
    graphhopper: GraphHopperClient,
) -> ComputedRoute:
    validate_waypoints(waypoints)
    segments = requested_segments or build_default_straight_segments(waypoints)
    validate_segments(waypoints, segments, allow_routed=True)

    waypoint_by_id = {waypoint.id: waypoint for waypoint in waypoints}
    computed_segments: list[RouteSegment] = []
    warnings: list[str] = []

    for index, segment in enumerate(segments):
        if segment.mode == "straight":
            computed_segments.append(compute_segment(waypoints, segment))
            continue

        start = waypoint_by_id[segment.from_waypoint_id]
        end = waypoint_by_id[segment.to_waypoint_id]
        try:
            routed = graphhopper.route_segment(start, end)
        except GraphHopperError as error:
            raise RouteValidationError(
                error.code,
                error.message,
                {"segmentIndex": index, **error.details},
            ) from error

        computed_segments.append(
            RouteSegment(
                id=f"{segment.from_waypoint_id}-{segment.to_waypoint_id}",
                from_waypoint_id=segment.from_waypoint_id,
                to_waypoint_id=segment.to_waypoint_id,
                mode="routed",
                distance_meters=routed.distance_meters,
                geometry={"type": "LineString", "coordinates": routed.coordinates},
                details=routed.details,
            )
        )

    coordinates = combine_segment_coordinates(computed_segments)
    return ComputedRoute(
        geometry={"type": "LineString", "coordinates": coordinates},
        distance_meters=sum(segment.distance_meters for segment in computed_segments),
        segments=computed_segments,
        warnings=warnings,
    )


def combine_segment_coordinates(segments: list[RouteSegment]) -> list[list[float]]:
    coordinates: list[list[float]] = []
    for segment in segments:
        segment_coordinates = segment.geometry.get("coordinates")
        if not isinstance(segment_coordinates, list):
            continue

        for coordinate in segment_coordinates:
            if coordinates and coordinates[-1] == coordinate:
                continue
            if isinstance(coordinate, list):
                coordinates.append(coordinate)
    return coordinates
