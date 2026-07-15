from __future__ import annotations

import httpx
import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from planner.integrations.overpass import OsmWay, OverpassUnavailableError, parse_overpass_response


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


@pytest.mark.django_db
def test_trails_endpoint_returns_debug_ways(monkeypatch: pytest.MonkeyPatch) -> None:
    client = APIClient()
    monkeypatch.setattr("planner.api.views.OverpassClient", FakeOverpassClient)

    response = client.get(
        reverse("trails"),
        {"bbox": "7.44,46.94,7.46,46.96", "zoom": "14"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "ways": [
            {
                "id": 123,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[7.4474, 46.948], [7.45, 46.95]],
                },
                "tags": {"highway": "path", "sac_scale": "mountain_hiking"},
            }
        ],
        "warnings": [],
    }


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


class ExplodingOverpassClient:
    def __init__(self, *args: object, **kwargs: object) -> None:
        raise AssertionError("Overpass should not be called below zoom 13.")
