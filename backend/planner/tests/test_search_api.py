from __future__ import annotations

import pytest
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APIClient

from planner.integrations.swisstopo import SearchResult


@pytest.fixture(autouse=True)
def clear_api_cache() -> None:
    cache.clear()


def test_search_endpoint_returns_normalized_results(monkeypatch) -> None:
    class FakeSwisstopoClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        def search_locations(self, query: str, *, limit: int) -> list[SearchResult]:
            assert query == "Bern"
            assert limit == 8
            return [
                SearchResult(
                    id="bern",
                    label="Bern",
                    origin="gazetteer",
                    longitude=7.4474,
                    latitude=46.948,
                    zoom=12,
                )
            ]

    monkeypatch.setattr("planner.api.views.SwisstopoClient", FakeSwisstopoClient)

    response = APIClient().get(reverse("search"), {"q": "Bern"})

    assert response.status_code == 200
    assert response.json() == {
        "results": [
            {
                "id": "bern",
                "label": "Bern",
                "origin": "gazetteer",
                "longitude": 7.4474,
                "latitude": 46.948,
                "zoom": 12,
            }
        ]
    }


def test_search_endpoint_validates_query() -> None:
    response = APIClient().get(reverse("search"), {"q": "B"})

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_search_request"
