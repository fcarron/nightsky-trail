from __future__ import annotations

import json

import httpx
import pytest

from planner.integrations.swisstopo import (
    LineStringGeometry,
    SearchResult,
    SwisstopoClient,
    SwisstopoSearchUnavailableError,
    SwisstopoUnavailableError,
    parse_profile_response,
    parse_search_response,
)


def test_parse_profile_response_returns_samples() -> None:
    response = httpx.Response(
        200,
        json=[
            {
                "dist": 0,
                "easting": 2_600_000,
                "northing": 1_200_000,
                "alts": {"COMB": 540.5},
            },
            {
                "dist": 50,
                "easting": 2_600_050,
                "northing": 1_200_050,
                "alts": {"COMB": 545.0},
            },
        ],
    )

    samples = parse_profile_response(response)

    assert len(samples) == 2
    assert samples[0].distance_meters == 0
    assert samples[0].elevation_meters == 540.5
    assert 7.4 < samples[0].longitude < 7.5
    assert 46.9 < samples[0].latitude < 47.0


def test_parse_profile_response_rejects_invalid_payload() -> None:
    response = httpx.Response(200, json={"unexpected": "shape"})

    with pytest.raises(SwisstopoUnavailableError):
        parse_profile_response(response)


def test_swisstopo_client_posts_expected_request(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[dict[str, object]] = []

    def fake_post(
        url: str,
        data: dict[str, str],
        timeout: httpx.Timeout,
    ) -> httpx.Response:
        requests.append({"url": url, "data": data, "timeout": timeout})
        return httpx.Response(
            200,
            json=[
                {
                    "dist": 0,
                    "easting": 2_600_000,
                    "northing": 1_200_000,
                    "alts": {"COMB": 540},
                },
                {
                    "dist": 50,
                    "easting": 2_600_050,
                    "northing": 1_200_050,
                    "alts": {"COMB": 545},
                },
            ],
        )

    monkeypatch.setattr("planner.integrations.swisstopo.httpx.post", fake_post)
    client = SwisstopoClient("https://api3.geo.admin.ch/")

    samples = client.elevation_profile(
        LineStringGeometry(coordinates=[[7.4474, 46.948], [7.45, 46.95]]),
        sample_count=50,
    )

    assert len(samples) == 2
    assert requests[0]["url"] == "https://api3.geo.admin.ch/rest/services/profile.json"
    data = requests[0]["data"]
    assert data["sr"] == "2056"
    assert data["nb_points"] == "50"
    assert data["distinct_points"] == "True"
    geometry = json.loads(data["geom"])
    assert geometry["type"] == "LineString"
    assert geometry["coordinates"][0][0] > 2_600_000
    assert geometry["coordinates"][0][1] > 1_195_000


def test_parse_search_response_returns_locations() -> None:
    response = httpx.Response(
        200,
        json={
            "results": [
                {
                    "id": 123,
                    "attrs": {
                        "label": "<b>Bern</b>",
                        "origin": "gazetteer",
                        "lon": 7.4474,
                        "lat": 46.948,
                        "zoomlevel": 12,
                    },
                }
            ]
        },
    )

    results = parse_search_response(response)

    assert results == [
        SearchResult(
            id="123",
            label="Bern",
            origin="gazetteer",
            longitude=7.4474,
            latitude=46.948,
            zoom=12,
        )
    ]


def test_swisstopo_client_search_requests_geometry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[dict[str, object]] = []

    def fake_get(
        url: str,
        params: dict[str, str],
        timeout: httpx.Timeout,
    ) -> httpx.Response:
        requests.append({"url": url, "params": params, "timeout": timeout})
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "id": 53,
                        "attrs": {
                            "label": "<b>Wil (ZH)</b>",
                            "origin": "gg25",
                            "lon": 8.5016,
                            "lat": 47.6101,
                            "zoomlevel": 14,
                        },
                    }
                ]
            },
        )

    monkeypatch.setattr("planner.integrations.swisstopo.httpx.get", fake_get)
    client = SwisstopoClient("https://api3.geo.admin.ch/")

    results = client.search_locations("wil", limit=5)

    assert results[0].label == "Wil (ZH)"
    assert requests[0]["url"] == "https://api3.geo.admin.ch/rest/services/ech/SearchServer"
    params = requests[0]["params"]
    assert params == {
        "searchText": "wil",
        "type": "locations",
        "limit": "5",
        "sr": "4326",
    }


def test_parse_search_response_rejects_invalid_payload() -> None:
    response = httpx.Response(200, json={"unexpected": []})

    with pytest.raises(SwisstopoSearchUnavailableError):
        parse_search_response(response)
