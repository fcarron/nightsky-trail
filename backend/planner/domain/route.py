from __future__ import annotations

from dataclasses import dataclass
from math import asin, cos, radians, sin, sqrt
from typing import Literal

SegmentMode = Literal["straight", "routed"]

EARTH_RADIUS_METERS = 6_371_000
MIN_WAYPOINTS = 2
MAX_WAYPOINTS = 50

SWITZERLAND_BOUNDS_WITH_TOLERANCE = {
    "min_lon": 5.75,
    "min_lat": 45.65,
    "max_lon": 10.70,
    "max_lat": 47.95,
}


class RouteValidationError(ValueError):
    def __init__(self, code: str, message: str, details: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


@dataclass(frozen=True)
class Waypoint:
    id: str
    longitude: float
    latitude: float


@dataclass(frozen=True)
class SegmentRequest:
    from_waypoint_id: str
    to_waypoint_id: str
    mode: SegmentMode


@dataclass(frozen=True)
class RouteSegment:
    id: str
    from_waypoint_id: str
    to_waypoint_id: str
    mode: SegmentMode
    distance_meters: float
    geometry: dict[str, object]
    details: dict[str, object] | None = None


@dataclass(frozen=True)
class ComputedRoute:
    geometry: dict[str, object]
    distance_meters: float
    segments: list[RouteSegment]
    warnings: list[str]


def compute_manual_route(
    waypoints: list[Waypoint],
    requested_segments: list[SegmentRequest] | None = None,
) -> ComputedRoute:
    validate_waypoints(waypoints)
    segments = requested_segments or build_default_straight_segments(waypoints)
    validate_segments(waypoints, segments)

    computed_segments = [compute_segment(waypoints, segment) for segment in segments]
    coordinates = [[waypoint.longitude, waypoint.latitude] for waypoint in waypoints]

    return ComputedRoute(
        geometry={"type": "LineString", "coordinates": coordinates},
        distance_meters=sum(segment.distance_meters for segment in computed_segments),
        segments=computed_segments,
        warnings=[],
    )


def validate_waypoints(waypoints: list[Waypoint]) -> None:
    if len(waypoints) < MIN_WAYPOINTS:
        raise RouteValidationError(
            "too_few_waypoints",
            "At least two waypoints are required to compute a route.",
            {"minimum": MIN_WAYPOINTS},
        )

    if len(waypoints) > MAX_WAYPOINTS:
        raise RouteValidationError(
            "too_many_waypoints",
            "Too many waypoints were provided.",
            {"maximum": MAX_WAYPOINTS},
        )

    seen_ids: set[str] = set()
    for index, waypoint in enumerate(waypoints):
        if waypoint.id in seen_ids:
            raise RouteValidationError(
                "duplicate_waypoint_id",
                "Waypoint IDs must be unique.",
                {"id": waypoint.id},
            )
        seen_ids.add(waypoint.id)

        if not coordinate_is_in_supported_bounds(waypoint.longitude, waypoint.latitude):
            raise RouteValidationError(
                "coordinate_outside_switzerland",
                "Waypoint is outside the supported Switzerland planning area.",
                {"index": index, "id": waypoint.id},
            )


def validate_segments(
    waypoints: list[Waypoint],
    segments: list[SegmentRequest],
    *,
    allow_routed: bool = False,
) -> None:
    waypoint_ids = {waypoint.id for waypoint in waypoints}
    expected_segment_count = len(waypoints) - 1

    if len(segments) != expected_segment_count:
        raise RouteValidationError(
            "invalid_segment_count",
            "Segment count must match the waypoint chain.",
            {"expected": expected_segment_count, "actual": len(segments)},
        )

    for index, segment in enumerate(segments):
        expected_from = waypoints[index].id
        expected_to = waypoints[index + 1].id

        if segment.mode != "straight" and not allow_routed:
            raise RouteValidationError(
                "routing_unavailable",
                "Routed segments are not available until GraphHopper is configured.",
                {"segmentIndex": index},
            )

        if (
            segment.from_waypoint_id not in waypoint_ids
            or segment.to_waypoint_id not in waypoint_ids
            or segment.from_waypoint_id != expected_from
            or segment.to_waypoint_id != expected_to
        ):
            raise RouteValidationError(
                "invalid_segment_chain",
                "Segments must connect consecutive waypoints in order.",
                {
                    "segmentIndex": index,
                    "expectedFromWaypointId": expected_from,
                    "expectedToWaypointId": expected_to,
                },
            )


def build_default_straight_segments(waypoints: list[Waypoint]) -> list[SegmentRequest]:
    return [
        SegmentRequest(
            from_waypoint_id=waypoints[index].id,
            to_waypoint_id=waypoints[index + 1].id,
            mode="straight",
        )
        for index in range(len(waypoints) - 1)
    ]


def compute_segment(waypoints: list[Waypoint], segment: SegmentRequest) -> RouteSegment:
    waypoint_by_id = {waypoint.id: waypoint for waypoint in waypoints}
    start = waypoint_by_id[segment.from_waypoint_id]
    end = waypoint_by_id[segment.to_waypoint_id]
    coordinates = [[start.longitude, start.latitude], [end.longitude, end.latitude]]

    return RouteSegment(
        id=f"{segment.from_waypoint_id}-{segment.to_waypoint_id}",
        from_waypoint_id=segment.from_waypoint_id,
        to_waypoint_id=segment.to_waypoint_id,
        mode=segment.mode,
        distance_meters=distance_meters_between(start, end),
        geometry={"type": "LineString", "coordinates": coordinates},
    )


def distance_meters_between(start: Waypoint, end: Waypoint) -> float:
    start_lat = radians(start.latitude)
    end_lat = radians(end.latitude)
    delta_lat = radians(end.latitude - start.latitude)
    delta_lon = radians(end.longitude - start.longitude)

    haversine = sin(delta_lat / 2) ** 2 + cos(start_lat) * cos(end_lat) * sin(delta_lon / 2) ** 2
    return 2 * EARTH_RADIUS_METERS * asin(sqrt(haversine))


def coordinate_is_in_supported_bounds(longitude: float, latitude: float) -> bool:
    return (
        SWITZERLAND_BOUNDS_WITH_TOLERANCE["min_lon"]
        <= longitude
        <= SWITZERLAND_BOUNDS_WITH_TOLERANCE["max_lon"]
        and SWITZERLAND_BOUNDS_WITH_TOLERANCE["min_lat"]
        <= latitude
        <= SWITZERLAND_BOUNDS_WITH_TOLERANCE["max_lat"]
    )
