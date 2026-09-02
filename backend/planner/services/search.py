from __future__ import annotations

from hashlib import sha256
from typing import Protocol

from django.core.cache import cache

from planner.integrations.swisstopo import SearchResult

SEARCH_CACHE_VERSION = "v1"


class SearchClient(Protocol):
    def search_locations(self, query: str, *, limit: int) -> list[SearchResult]: ...


def search_locations(
    client: SearchClient,
    query: str,
    *,
    limit: int,
    cache_timeout_seconds: int,
) -> list[SearchResult]:
    cache_key = search_cache_key(query, limit)
    if cache_timeout_seconds > 0:
        cached_results = cache.get(cache_key)
        if isinstance(cached_results, list) and all(
            isinstance(result, SearchResult) for result in cached_results
        ):
            return cached_results

    results = client.search_locations(query, limit=limit)
    if cache_timeout_seconds > 0:
        cache.set(cache_key, results, timeout=cache_timeout_seconds)
    return results


def search_cache_key(query: str, limit: int) -> str:
    normalized_query = " ".join(query.casefold().split())
    digest = sha256(normalized_query.encode("utf-8")).hexdigest()
    return f"location-search:{SEARCH_CACHE_VERSION}:{limit}:{digest}"
