from __future__ import annotations

import pytest
from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APIClient


@pytest.mark.parametrize(
    ("method", "url", "payload"),
    [
        ("post", reverse("route-compute"), {}),
        ("post", reverse("elevation-profile"), {}),
        ("get", reverse("search"), {"q": "B"}),
    ],
)
@override_settings(
    ROUTE_RATE_LIMIT=1,
    ELEVATION_RATE_LIMIT=1,
    SEARCH_RATE_LIMIT=1,
    PUBLIC_API_RATE_WINDOW_SECONDS=60,
)
def test_public_compute_endpoints_are_rate_limited(
    method: str,
    url: str,
    payload: dict[str, object],
) -> None:
    cache.clear()
    client = APIClient()

    first = getattr(client, method)(url, payload, format="json")
    second = getattr(client, method)(url, payload, format="json")

    assert first.status_code == 422
    assert second.status_code == 429
    assert second.json()["code"] == "rate_limited"
