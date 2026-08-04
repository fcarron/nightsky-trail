from __future__ import annotations

import httpx
import pytest

from planner.domain.route import Waypoint
from planner.integrations.graphhopper import (
    ROUTE_DETAILS,
    GraphHopperClient,
    GraphHopperNoRouteError,
    GraphHopperRoute,
    GraphHopperUnavailableError,
    load_hiking_custom_model,
    parse_graphhopper_response,
)


def test_parse_graphhopper_response_returns_route() -> None:
    response = httpx.Response(
        200,
        json={
            "paths": [
                {
                    "distance": 1480.5,
                    "points": {
                        "type": "LineString",
                        "coordinates": [[7.4474, 46.948], [7.45, 46.95]],
                    },
                    "details": {"hike_rating": [[0, 1, "hiking"]]},
                }
            ]
        },
    )

    route = parse_graphhopper_response(response)

    assert route == GraphHopperRoute(
        distance_meters=1480.5,
        coordinates=[[7.4474, 46.948], [7.45, 46.95]],
        details={"hike_rating": [[0, 1, "hiking"]]},
    )


def test_parse_graphhopper_response_maps_400_to_no_route() -> None:
    response = httpx.Response(
        400,
        json={
            "message": "Cannot find point",
            "hints": [{"message": "Cannot find point 0"}],
        },
    )

    with pytest.raises(GraphHopperNoRouteError) as error:
        parse_graphhopper_response(response)

    assert error.value.code == "no_route"
    assert error.value.message == "Cannot find point"
    assert error.value.details == {"hints": [{"message": "Cannot find point 0"}]}


def test_parse_graphhopper_response_maps_500_to_unavailable() -> None:
    response = httpx.Response(503, json={"message": "Service unavailable"})

    with pytest.raises(GraphHopperUnavailableError) as error:
        parse_graphhopper_response(response)

    assert error.value.code == "routing_unavailable"


def test_parse_graphhopper_response_rejects_invalid_geometry() -> None:
    response = httpx.Response(
        200,
        json={"paths": [{"distance": 10, "points": {"coordinates": []}}]},
    )

    with pytest.raises(GraphHopperUnavailableError):
        parse_graphhopper_response(response)


def test_graphhopper_client_posts_expected_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[dict[str, object]] = []

    def fake_post(url: str, json: dict[str, object], timeout: httpx.Timeout) -> httpx.Response:
        requests.append({"url": url, "json": json, "timeout": timeout})
        return httpx.Response(
            200,
            json={
                "paths": [
                    {
                        "distance": 12.0,
                        "points": {"coordinates": [[7.4, 46.9], [7.5, 47.0]]},
                    }
                ]
            },
        )

    monkeypatch.setattr("planner.integrations.graphhopper.httpx.post", fake_post)
    client = GraphHopperClient("http://graphhopper.test/")

    route = client.route_segment(
        Waypoint(id="a", longitude=7.4, latitude=46.9),
        Waypoint(id="b", longitude=7.5, latitude=47.0),
        profile="hike",
    )

    assert route.distance_meters == 12.0
    assert requests[0]["url"] == "http://graphhopper.test/route"
    assert requests[0]["json"] == {
        "points": [[7.4, 46.9], [7.5, 47.0]],
        "profile": "hike",
        "points_encoded": False,
        "instructions": False,
        "calc_points": True,
        "details": ROUTE_DETAILS,
        "custom_model": load_hiking_custom_model(),
    }


def test_graphhopper_client_defaults_to_hike_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[dict[str, object]] = []

    def fake_post(url: str, json: dict[str, object], timeout: httpx.Timeout) -> httpx.Response:
        requests.append(json)
        return httpx.Response(
            200,
            json={
                "paths": [
                    {
                        "distance": 12.0,
                        "points": {"coordinates": [[7.4, 46.9], [7.5, 47.0]]},
                    }
                ]
            },
        )

    monkeypatch.setattr("planner.integrations.graphhopper.httpx.post", fake_post)

    GraphHopperClient("http://graphhopper.test/").route_segment(
        Waypoint(id="a", longitude=7.4, latitude=46.9),
        Waypoint(id="b", longitude=7.5, latitude=47.0),
    )

    assert requests[0]["profile"] == "hike"


def test_graphhopper_client_rejects_disabled_bike_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[dict[str, object]] = []

    def fake_post(url: str, json: dict[str, object], timeout: httpx.Timeout) -> httpx.Response:
        requests.append(json)
        return httpx.Response(
            200,
            json={
                "paths": [
                    {
                        "distance": 12.0,
                        "points": {"coordinates": [[7.4, 46.9], [7.5, 47.0]]},
                    }
                ]
            },
        )

    monkeypatch.setattr("planner.integrations.graphhopper.httpx.post", fake_post)

    with pytest.raises(GraphHopperUnavailableError):
        GraphHopperClient("http://graphhopper.test/").route_segment(
            Waypoint(id="a", longitude=7.4, latitude=46.9),
            Waypoint(id="b", longitude=7.5, latitude=47.0),
            profile="bike",
        )

    assert requests == []


def test_hiking_custom_model_is_permissive() -> None:
    model = load_hiking_custom_model()

    assert model["distance_influence"] == 25
    assert all(
        statement.get("multiply_by") != "0"
        for statement in model["priority"]
        if isinstance(statement, dict)
    )
