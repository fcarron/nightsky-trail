from __future__ import annotations

import pytest

from planner.domain.route import (
    RouteValidationError,
    SegmentRequest,
    Waypoint,
    compute_manual_route,
)


def test_compute_manual_route_returns_straight_segments() -> None:
    route = compute_manual_route(
        [
            Waypoint(id="a", longitude=7.4474, latitude=46.948),
            Waypoint(id="b", longitude=8.5417, latitude=47.3769),
        ]
    )

    assert route.geometry == {
        "type": "LineString",
        "coordinates": [[7.4474, 46.948], [8.5417, 47.3769]],
    }
    assert route.distance_meters > 95_000
    assert route.distance_meters < 97_000
    assert route.segments[0].mode == "straight"
    assert route.segments[0].geometry == {
        "type": "LineString",
        "coordinates": [[7.4474, 46.948], [8.5417, 47.3769]],
    }


def test_compute_manual_route_rejects_coordinates_outside_switzerland() -> None:
    with pytest.raises(RouteValidationError) as error:
        compute_manual_route(
            [
                Waypoint(id="a", longitude=7.4474, latitude=46.948),
                Waypoint(id="b", longitude=2.3522, latitude=48.8566),
            ]
        )

    assert error.value.code == "coordinate_outside_switzerland"


def test_compute_manual_route_rejects_routed_segments_until_routing_exists() -> None:
    with pytest.raises(RouteValidationError) as error:
        compute_manual_route(
            [
                Waypoint(id="a", longitude=7.4474, latitude=46.948),
                Waypoint(id="b", longitude=8.5417, latitude=47.3769),
            ],
            [
                SegmentRequest(
                    from_waypoint_id="a",
                    to_waypoint_id="b",
                    mode="routed",
                )
            ],
        )

    assert error.value.code == "routing_unavailable"
