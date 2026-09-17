from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from planner.integrations.swisstopo import MapFeatureInfo


def test_map_feature_endpoint_returns_normalized_wanderland_detail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeSwisstopoMapClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        def feature_info(self, layer: str, **kwargs: float) -> MapFeatureInfo | None:
            assert layer == "wanderland"
            assert kwargs == {"x": 830_000, "y": 5_900_000, "resolution": 2}
            return MapFeatureInfo(
                kind="wanderland",
                title="ViaJacobi",
                details=[("Routennummer", "1"), ("Netz", "Wanderland Schweiz")],
                schweiz_mobil_url="https://schweizmobil.ch/de/wanderland/route-1",
            )

    monkeypatch.setattr("planner.api.views.SwisstopoMapClient", FakeSwisstopoMapClient)

    response = APIClient().get(
        reverse("map-feature-info"),
        {"layer": "wanderland", "x": 830_000, "y": 5_900_000, "resolution": 2},
    )

    assert response.status_code == 200
    assert response.json() == {
        "feature": {
            "details": [["Routennummer", "1"], ["Netz", "Wanderland Schweiz"]],
            "kind": "wanderland",
            "schweizMobilUrl": "https://schweizmobil.ch/de/wanderland/route-1",
            "title": "ViaJacobi",
        }
    }


def test_map_feature_endpoint_rejects_coordinates_outside_switzerland() -> None:
    response = APIClient().get(
        reverse("map-feature-info"),
        {"layer": "wanderland", "x": 2_000_000, "y": 5_900_000, "resolution": 2},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_map_feature_request"
