from __future__ import annotations

from django.core.cache import cache

from planner.integrations.swisstopo import SearchResult
from planner.services.search import search_locations


def test_search_is_cached_by_normalized_query() -> None:
    cache.clear()
    client = FakeSearchClient()

    first = search_locations(client, "  Bern  ", limit=8, cache_timeout_seconds=60)
    second = search_locations(client, "bern", limit=8, cache_timeout_seconds=60)

    assert first == second
    assert client.queries == [("  Bern  ", 8)]


class FakeSearchClient:
    def __init__(self) -> None:
        self.queries: list[tuple[str, int]] = []

    def search_locations(self, query: str, *, limit: int) -> list[SearchResult]:
        self.queries.append((query, limit))
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
