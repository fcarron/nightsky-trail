from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from planner.domain.elevation import ElevationSample
from planner.integrations.swisstopo import LineStringGeometry, SwisstopoUnavailableError


@pytest.mark.django_db
def test_elevation_profile_returns_normalized_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    client = APIClient()
    monkeypatch.setattr("planner.api.views.SwisstopoClient", FakeSwisstopoClient)

    response = client.post(
        reverse("elevation-profile"),
        {
            "geometry": {
                "type": "LineString",
                "coordinates": [[7.4474, 46.948], [7.45, 46.95]],
            }
        },
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["distanceMeters"] == 100
    assert payload["ascentMeters"] == 30
    assert payload["descentMeters"] == 0
    assert payload["minElevationMeters"] == 500
    assert payload["maxElevationMeters"] == 540
    assert payload["hikingTime"] == {
        "duration_minutes": 7,
        "method": "swiss_hiking_polynomial",
        "segment_length_m": 50,
        "smoothing_window_m": 40,
        "segment_count": 2,
    }
    assert payload["points"][0] == {
        "distanceMeters": 0,
        "elevationMeters": 500,
        "smoothedElevationMeters": 505,
        "gradientPercent": 30,
        "longitude": 7.4474,
        "latitude": 46.948,
    }
    assert FakeSwisstopoClient.last_geometry == LineStringGeometry(
        coordinates=[[7.4474, 46.948], [7.45, 46.95]]
    )
    assert FakeSwisstopoClient.last_sample_count == 50


@pytest.mark.django_db
def test_elevation_profile_returns_422_for_upstream_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = APIClient()
    monkeypatch.setattr("planner.api.views.SwisstopoClient", UnavailableSwisstopoClient)

    response = client.post(
        reverse("elevation-profile"),
        {
            "geometry": {
                "type": "LineString",
                "coordinates": [[7.4474, 46.948], [7.45, 46.95]],
            }
        },
        format="json",
    )

    assert response.status_code == 422
    assert response.json() == {
        "code": "elevation_unavailable",
        "message": "The elevation service is currently unavailable.",
        "details": {},
    }


@pytest.mark.django_db
def test_elevation_profile_returns_422_for_outside_switzerland() -> None:
    client = APIClient()

    response = client.post(
        reverse("elevation-profile"),
        {
            "geometry": {
                "type": "LineString",
                "coordinates": [[2.3522, 48.8566], [7.45, 46.95]],
            }
        },
        format="json",
    )

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_elevation_request"


class FakeSwisstopoClient:
    last_geometry: LineStringGeometry | None = None
    last_sample_count: int | None = None

    def __init__(self, *args: object, **kwargs: object) -> None:
        pass

    def elevation_profile(
        self,
        geometry: LineStringGeometry,
        *,
        sample_count: int,
    ) -> list[ElevationSample]:
        FakeSwisstopoClient.last_geometry = geometry
        FakeSwisstopoClient.last_sample_count = sample_count
        return [
            ElevationSample(0, 500, 7.4474, 46.948),
            ElevationSample(25, 510, 7.448, 46.949),
            ElevationSample(50, 520, 7.449, 46.9495),
            ElevationSample(75, 530, 7.4495, 46.9498),
            ElevationSample(100, 540, 7.45, 46.95),
        ]


class UnavailableSwisstopoClient:
    def __init__(self, *args: object, **kwargs: object) -> None:
        pass

    def elevation_profile(
        self,
        geometry: LineStringGeometry,
        *,
        sample_count: int,
    ) -> list[ElevationSample]:
        raise SwisstopoUnavailableError()
