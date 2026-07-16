from __future__ import annotations

import httpx
import pytest
from django.urls import reverse
from rest_framework.test import APIClient
from shapely.geometry import LineString

from planner.domain.coordinates import wgs84_to_lv95
from planner.domain.trail_matching import OFFICIAL_CATEGORY_BERGWANDERWEG, OfficialTrail
from planner.integrations.local_osm import LocalOsmUnavailableError
from planner.integrations.overpass import (
    OsmWay,
    OverpassClient,
    OverpassUnavailableError,
    build_trails_query,
    includes_unknown_difficulty_ways,
    parse_overpass_response,
)


def test_parse_overpass_response_returns_normalized_ways() -> None:
    response = httpx.Response(
        200,
        json={
            "elements": [
                {
                    "type": "way",
                    "id": 123,
                    "tags": {
                        "highway": "path",
                        "sac_scale": "mountain_hiking",
                        "trail_visibility": "good",
                        "source": "survey",
                    },
                    "geometry": [
                        {"lon": 7.4474, "lat": 46.948},
                        {"lon": 7.45, "lat": 46.95},
                    ],
                }
            ]
        },
    )

    assert parse_overpass_response(response) == [
        OsmWay(
            id=123,
            coordinates=[[7.4474, 46.948], [7.45, 46.95]],
            tags={
                "highway": "path",
                "sac_scale": "mountain_hiking",
                "trail_visibility": "good",
            },
        )
    ]


def test_parse_overpass_response_maps_http_errors() -> None:
    response = httpx.Response(
        406,
        headers={"content-type": "text/html"},
        text="<html>Not Acceptable</html>",
    )

    with pytest.raises(OverpassUnavailableError) as error:
        parse_overpass_response(response)

    assert error.value.code == "trails_unavailable"
    assert error.value.details == {"statusCode": 406}


def test_parse_overpass_response_maps_remark_without_elements() -> None:
    response = httpx.Response(
        200,
        json={"elements": [], "remark": "runtime error: Query ran out of memory"},
    )

    with pytest.raises(OverpassUnavailableError) as error:
        parse_overpass_response(response)

    assert error.value.code == "trails_unavailable"
    assert error.value.details == {"remark": "runtime error: Query ran out of memory"}


def test_build_trails_query_loads_known_and_unknown_difficulty_ways() -> None:
    query = build_trails_query(7.44, 46.94, 7.46, 46.96)

    assert 'way["highway"~' in query
    assert 'way["sac_scale"]' in query
    assert 'way["route"~"^(hiking|foot)$"]' in query
    assert "46.9400000,7.4400000,46.9600000,7.4600000" in query
    assert includes_unknown_difficulty_ways((7.44, 46.94, 7.46, 46.96))


def test_build_trails_query_limits_large_viewports_to_known_difficulty() -> None:
    query = build_trails_query(7.40, 46.90, 7.55, 47.00)

    assert 'way["sac_scale"]' in query
    assert 'way["highway"~' not in query
    assert 'way["route"~"^(hiking|foot)$"]' not in query
    assert not includes_unknown_difficulty_ways((7.40, 46.90, 7.55, 47.00))


def test_overpass_client_falls_back_to_known_difficulty_query(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    def fake_post(
        url: str,
        *,
        data: dict[str, str],
        headers: dict[str, str],
        timeout: httpx.Timeout,
    ) -> httpx.Response:
        calls.append(data["data"])
        if len(calls) == 1:
            return httpx.Response(504, json={"remark": "timeout"})
        return httpx.Response(
            200,
            json={
                "elements": [
                    {
                        "type": "way",
                        "id": 123,
                        "tags": {"highway": "path", "sac_scale": "hiking"},
                        "geometry": [
                            {"lon": 7.4474, "lat": 46.948},
                            {"lon": 7.45, "lat": 46.95},
                        ],
                    }
                ]
            },
        )

    monkeypatch.setattr(httpx, "post", fake_post)

    ways = OverpassClient("https://overpass.example.test/api").trails((7.44, 46.94, 7.46, 46.96))

    assert len(calls) == 2
    assert 'way["highway"~' in calls[0]
    assert 'way["sac_scale"]' in calls[1]
    assert 'way["highway"~' not in calls[1]
    assert ways[0].tags["sac_scale"] == "hiking"


@pytest.mark.django_db
def test_trails_endpoint_returns_debug_ways(monkeypatch: pytest.MonkeyPatch) -> None:
    client = APIClient()
    monkeypatch.setattr("planner.api.views.LocalOsmTrailIndex", MissingLocalOsmTrailIndex)
    monkeypatch.setattr("planner.api.views.OverpassClient", FakeOverpassClient)
    monkeypatch.setattr("planner.api.views.SwisstopoTrailClient", FakeSwisstopoTrailClient)

    response = client.get(
        reverse("trails"),
        {"bbox": "7.44,46.94,7.46,46.96", "zoom": "14", "include_debug": "true"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ways"][0]["id"] == 123
    assert payload["trailSummary"]["totalWays"] == 1
    assert payload["trailSummary"]["byLabel"] == {"T2": 1}
    assert payload["officialSegments"][0]["officialCategory"] == "mountain_hiking_trail"
    assert payload["combinedSegments"][0]["matchStatus"] == "matched"
    assert payload["combinedSegments"][0]["tLevel"] == 2
    assert payload["combinedSegments"][0]["warningOverlay"] is False
    assert payload["warnings"] == []


@pytest.mark.django_db
def test_trails_endpoint_can_omit_official_and_non_warning_segments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = APIClient()
    monkeypatch.setattr("planner.api.views.LocalOsmTrailIndex", MissingLocalOsmTrailIndex)
    monkeypatch.setattr("planner.api.views.OverpassClient", FakeOverpassClient)
    monkeypatch.setattr("planner.api.views.SwisstopoTrailClient", FakeSwisstopoTrailClient)

    response = client.get(
        reverse("trails"),
        {
            "bbox": "7.44,46.94,7.46,46.96",
            "include_official": "false",
            "zoom": "14",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ways"] == []
    assert payload["trailSummary"]["totalWays"] == 1
    assert payload["trailSummary"]["byLabel"] == {"T2": 1}
    assert payload["officialSegments"] == []
    assert payload["combinedSegments"] == []


@pytest.mark.django_db
def test_trails_endpoint_rejects_large_bbox() -> None:
    client = APIClient()

    response = client.get(
        reverse("trails"),
        {"bbox": "7.0,46.5,8.0,47.5", "zoom": "14"},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_trails_request"


@pytest.mark.django_db
def test_trails_endpoint_skips_low_zoom(monkeypatch: pytest.MonkeyPatch) -> None:
    client = APIClient()
    monkeypatch.setattr("planner.api.views.OverpassClient", ExplodingOverpassClient)

    response = client.get(
        reverse("trails"),
        {"bbox": "7.44,46.94,7.46,46.96", "zoom": "12"},
    )

    assert response.status_code == 200
    assert response.json()["ways"] == []
    assert response.json()["trailSummary"]["totalWays"] == 0


class FakeOverpassClient:
    def __init__(self, *args: object, **kwargs: object) -> None:
        pass

    def trails(self, bbox: tuple[float, float, float, float]) -> list[OsmWay]:
        assert bbox == (7.44, 46.94, 7.46, 46.96)
        return [
            OsmWay(
                id=123,
                coordinates=[[7.4474, 46.948], [7.45, 46.95]],
                tags={"highway": "path", "sac_scale": "mountain_hiking"},
            )
        ]


class MissingLocalOsmTrailIndex:
    def __init__(self, *args: object, **kwargs: object) -> None:
        pass

    def trails(self, bbox: tuple[float, float, float, float]) -> list[OsmWay]:
        raise LocalOsmUnavailableError("No local index in this test.")


class FakeSwisstopoTrailClient:
    def __init__(self, *args: object, **kwargs: object) -> None:
        pass

    def trails(self, bbox: tuple[float, float, float, float]) -> list[OfficialTrail]:
        return [
            OfficialTrail(
                id="official-1",
                category=OFFICIAL_CATEGORY_BERGWANDERWEG,
                geometry=LineString(
                    [
                        wgs84_to_lv95(7.4474, 46.948),
                        wgs84_to_lv95(7.45, 46.95),
                    ]
                ),
            )
        ]


class ExplodingOverpassClient:
    def __init__(self, *args: object, **kwargs: object) -> None:
        raise AssertionError("Overpass should not be called below zoom 13.")
