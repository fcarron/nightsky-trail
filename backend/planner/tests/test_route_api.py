from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from planner.domain.route import Waypoint
from planner.integrations.graphhopper import GraphHopperRoute, GraphHopperUnavailableError


@pytest.mark.django_db
def test_route_compute_returns_normalized_straight_route(monkeypatch: pytest.MonkeyPatch) -> None:
    client = APIClient()
    monkeypatch.setattr("planner.api.views.GraphHopperClient", NoopGraphHopperClient)

    response = client.post(
        reverse("route-compute"),
        {
            "waypoints": [
                {"id": "a", "longitude": 7.4474, "latitude": 46.948},
                {"id": "b", "longitude": 8.5417, "latitude": 47.3769},
            ],
            "segments": [
                {
                    "fromWaypointId": "a",
                    "toWaypointId": "b",
                    "mode": "straight",
                }
            ],
        },
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["geometry"] == {
        "type": "LineString",
        "coordinates": [[7.4474, 46.948], [8.5417, 47.3769]],
    }
    assert payload["distanceMeters"] > 95_000
    assert payload["distanceMeters"] < 97_000
    assert payload["segments"][0]["mode"] == "straight"
    assert payload["segments"][0]["details"] == {}
    assert payload["warnings"] == []


@pytest.mark.django_db
def test_route_compute_returns_routed_segment(monkeypatch: pytest.MonkeyPatch) -> None:
    client = APIClient()
    monkeypatch.setattr("planner.api.views.GraphHopperClient", FakeGraphHopperClient)

    response = client.post(
        reverse("route-compute"),
        {
            "waypoints": [
                {"id": "a", "longitude": 7.4474, "latitude": 46.948},
                {"id": "b", "longitude": 8.5417, "latitude": 47.3769},
            ],
            "segments": [
                {
                    "fromWaypointId": "a",
                    "toWaypointId": "b",
                    "mode": "routed",
                }
            ],
        },
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["distanceMeters"] == 1200
    assert payload["segments"][0] == {
        "id": "a-b",
        "fromWaypointId": "a",
        "toWaypointId": "b",
        "mode": "routed",
        "distanceMeters": 1200,
        "geometry": {
            "type": "LineString",
            "coordinates": [[7.4474, 46.948], [8.2, 47.2], [8.5417, 47.3769]],
        },
        "details": {
            "hike_rating": [[0, 2, "hiking"]],
            "surface": [[0, 1, "asphalt"], [1, 2, "ground"]],
        },
    }


@pytest.mark.django_db
def test_route_compute_supports_bike_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = APIClient()
    RecordingGraphHopperClient.profiles = []
    monkeypatch.setattr("planner.api.views.GraphHopperClient", RecordingGraphHopperClient)

    response = client.post(
        reverse("route-compute"),
        {
            "profile": "bike",
            "waypoints": [
                {"id": "a", "longitude": 7.4474, "latitude": 46.948},
                {"id": "b", "longitude": 8.5417, "latitude": 47.3769},
            ],
            "segments": [
                {
                    "fromWaypointId": "a",
                    "toWaypointId": "b",
                    "mode": "routed",
                }
            ],
        },
        format="json",
    )

    assert response.status_code == 200
    assert RecordingGraphHopperClient.profiles == ["bike"]


@pytest.mark.django_db
def test_route_compute_returns_mixed_straight_and_routed_segments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = APIClient()
    monkeypatch.setattr("planner.api.views.GraphHopperClient", FakeGraphHopperClient)

    response = client.post(
        reverse("route-compute"),
        {
            "waypoints": [
                {"id": "a", "longitude": 7.4474, "latitude": 46.948},
                {"id": "b", "longitude": 8.0, "latitude": 47.0},
                {"id": "c", "longitude": 8.5417, "latitude": 47.3769},
            ],
            "segments": [
                {
                    "fromWaypointId": "a",
                    "toWaypointId": "b",
                    "mode": "straight",
                },
                {
                    "fromWaypointId": "b",
                    "toWaypointId": "c",
                    "mode": "routed",
                },
            ],
        },
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["segments"][0]["mode"] == "straight"
    assert payload["segments"][1]["mode"] == "routed"
    assert payload["geometry"]["coordinates"] == [
        [7.4474, 46.948],
        [8.0, 47.0],
        [8.2, 47.2],
        [8.5417, 47.3769],
    ]
    assert payload["distanceMeters"] > 43_000


@pytest.mark.django_db
def test_route_compute_returns_422_when_graphhopper_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = APIClient()
    monkeypatch.setattr("planner.api.views.GraphHopperClient", UnavailableGraphHopperClient)

    response = client.post(
        reverse("route-compute"),
        {
            "waypoints": [
                {"id": "a", "longitude": 7.4474, "latitude": 46.948},
                {"id": "b", "longitude": 8.5417, "latitude": 47.3769},
            ],
            "segments": [
                {
                    "fromWaypointId": "a",
                    "toWaypointId": "b",
                    "mode": "routed",
                }
            ],
        },
        format="json",
    )

    assert response.status_code == 422
    assert response.json() == {
        "code": "routing_unavailable",
        "message": "The routing service is currently unavailable.",
        "details": {"segmentIndex": 0},
    }


@pytest.mark.django_db
def test_route_compute_returns_422_for_invalid_waypoint_count() -> None:
    client = APIClient()

    response = client.post(
        reverse("route-compute"),
        {"waypoints": [{"id": "a", "longitude": 7.4474, "latitude": 46.948}]},
        format="json",
    )

    assert response.status_code == 422
    assert response.json()["code"] == "too_few_waypoints"


class NoopGraphHopperClient:
    def __init__(self, *args: object, **kwargs: object) -> None:
        pass


class FakeGraphHopperClient:
    def __init__(self, *args: object, **kwargs: object) -> None:
        pass

    def route_segment(self, start: Waypoint, end: Waypoint, **kwargs: object) -> GraphHopperRoute:
        return GraphHopperRoute(
            distance_meters=1200.0,
            coordinates=[
                [start.longitude, start.latitude],
                [8.2, 47.2],
                [end.longitude, end.latitude],
            ],
            details={
                "hike_rating": [[0, 2, "hiking"]],
                "surface": [[0, 1, "asphalt"], [1, 2, "ground"]],
            },
        )


class RecordingGraphHopperClient(FakeGraphHopperClient):
    profiles: list[object] = []

    def route_segment(self, start: Waypoint, end: Waypoint, **kwargs: object) -> GraphHopperRoute:
        self.profiles.append(kwargs.get("profile"))
        return super().route_segment(start, end, **kwargs)


class UnavailableGraphHopperClient:
    def __init__(self, *args: object, **kwargs: object) -> None:
        pass

    def route_segment(self, *args: object, **kwargs: object) -> GraphHopperRoute:
        raise GraphHopperUnavailableError("The routing service is currently unavailable.")
