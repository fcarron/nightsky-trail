from __future__ import annotations

from django.core.cache import cache

from planner.domain.coordinates import lv95_to_wgs84, wgs84_to_lv95
from planner.domain.elevation import ElevationSample
from planner.integrations.swisstopo import LineStringGeometry
from planner.services.elevation import (
    get_elevation_profile,
    load_elevation_samples,
    split_elevation_geometry,
)


def test_long_geometry_is_split_into_continuous_chunks() -> None:
    coordinates = eastbound_coordinates(step_meters=5_000, count=6)

    chunks = split_elevation_geometry(coordinates)

    assert [round(chunk.distance_meters) for chunk in chunks] == [10_000, 10_000, 5_000]
    assert chunks[0].coordinates[-1] == chunks[1].coordinates[0]
    assert chunks[1].coordinates[-1] == chunks[2].coordinates[0]


def test_chunk_samples_are_merged_with_global_distance_and_no_duplicate_boundaries() -> None:
    client = FakeElevationClient()

    samples = load_elevation_samples(
        client,
        eastbound_coordinates(step_meters=5_000, count=6),
    )

    assert client.sample_counts == [401, 401, 201]
    assert [round(sample.distance_meters) for sample in samples] == [
        0,
        5_000,
        10_000,
        15_000,
        20_000,
        22_500,
        25_000,
    ]


def test_profile_is_cached_by_normalized_geometry() -> None:
    cache.clear()
    client = FakeElevationClient()
    coordinates = eastbound_coordinates(step_meters=100, count=2)

    first = get_elevation_profile(client, coordinates, cache_timeout_seconds=60)
    second = get_elevation_profile(client, coordinates, cache_timeout_seconds=60)

    assert first == second
    assert client.sample_counts == [5]


class FakeElevationClient:
    def __init__(self) -> None:
        self.sample_counts: list[int] = []

    def elevation_profile(
        self,
        geometry: LineStringGeometry,
        *,
        sample_count: int,
    ) -> list[ElevationSample]:
        self.sample_counts.append(sample_count)
        first = geometry.coordinates[0]
        last = geometry.coordinates[-1]
        first_projected = wgs84_to_lv95(*first)
        last_projected = wgs84_to_lv95(*last)
        distance = last_projected[0] - first_projected[0]
        midpoint = [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2]
        return [
            ElevationSample(0, 500, *first),
            ElevationSample(distance / 2, 510, *midpoint),
            ElevationSample(distance, 520, *last),
        ]


def eastbound_coordinates(*, step_meters: int, count: int) -> list[list[float]]:
    return [
        list(lv95_to_wgs84(2_600_000 + index * step_meters, 1_200_000)) for index in range(count)
    ]
