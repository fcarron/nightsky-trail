from __future__ import annotations

import json
from dataclasses import dataclass, replace
from hashlib import sha256
from math import ceil, hypot
from typing import Protocol

from django.core.cache import cache

from planner.domain.coordinates import lv95_to_wgs84, wgs84_to_lv95
from planner.domain.elevation import ElevationProfile, ElevationSample, build_elevation_profile
from planner.integrations.swisstopo import LineStringGeometry, SwisstopoUnavailableError

ELEVATION_SAMPLE_SPACING_METERS = 25.0
ELEVATION_CHUNK_LENGTH_METERS = 10_000.0
SWISSTOPO_MAX_PROFILE_SAMPLES = 500
DISTANCE_ROUNDING_TOLERANCE_METERS = 0.001
ELEVATION_CACHE_VERSION = "v2"


class ElevationClient(Protocol):
    def elevation_profile(
        self,
        geometry: LineStringGeometry,
        *,
        sample_count: int,
    ) -> list[ElevationSample]: ...


@dataclass(frozen=True)
class ElevationGeometryChunk:
    coordinates: list[list[float]]
    distance_meters: float


def get_elevation_profile(
    client: ElevationClient,
    coordinates: list[list[float]],
    *,
    bridge_ranges: list[tuple[float, float]] | None = None,
    cache_timeout_seconds: int,
) -> ElevationProfile:
    normalized_bridge_ranges = sorted(bridge_ranges or [])
    cache_key = elevation_cache_key(coordinates, normalized_bridge_ranges)
    if cache_timeout_seconds > 0:
        cached_profile = cache.get(cache_key)
        if isinstance(cached_profile, ElevationProfile):
            return cached_profile

    samples = load_elevation_samples(client, coordinates)
    profile = build_elevation_profile(
        interpolate_bridge_elevations(samples, normalized_bridge_ranges)
    )
    if cache_timeout_seconds > 0:
        cache.set(cache_key, profile, timeout=cache_timeout_seconds)
    return profile


def elevation_cache_key(
    coordinates: list[list[float]],
    bridge_ranges: list[tuple[float, float]] | None = None,
) -> str:
    normalized_geometry = [
        [round(float(longitude), 7), round(float(latitude), 7)]
        for longitude, latitude in coordinates
    ]
    normalized_bridge_ranges = [
        [round(float(start), 3), round(float(end), 3)] for start, end in (bridge_ranges or [])
    ]
    digest = sha256(
        json.dumps(
            {
                "geometry": normalized_geometry,
                "bridge_ranges": normalized_bridge_ranges,
            },
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    return f"elevation-profile:{ELEVATION_CACHE_VERSION}:{digest}"


def interpolate_bridge_elevations(
    samples: list[ElevationSample],
    bridge_ranges: list[tuple[float, float]],
) -> list[ElevationSample]:
    corrected = list(samples)
    if len(corrected) < 3 or not bridge_ranges:
        return corrected

    for start_distance, end_distance in sorted(bridge_ranges):
        before_index = next(
            (
                index
                for index in range(len(corrected) - 1, -1, -1)
                if corrected[index].distance_meters <= start_distance
            ),
            None,
        )
        after_index = next(
            (
                index
                for index, sample in enumerate(corrected)
                if sample.distance_meters >= end_distance
            ),
            None,
        )
        if before_index is None or after_index is None or before_index >= after_index:
            continue

        before = corrected[before_index]
        after = corrected[after_index]
        distance_span = after.distance_meters - before.distance_meters
        if distance_span <= 0:
            continue

        for index in range(before_index + 1, after_index):
            sample = corrected[index]
            if not start_distance <= sample.distance_meters <= end_distance:
                continue
            ratio = (sample.distance_meters - before.distance_meters) / distance_span
            corrected[index] = replace(
                sample,
                elevation_meters=before.elevation_meters
                + (after.elevation_meters - before.elevation_meters) * ratio,
            )

    return corrected


def load_elevation_samples(
    client: ElevationClient,
    coordinates: list[list[float]],
    *,
    chunk_length_meters: float = ELEVATION_CHUNK_LENGTH_METERS,
    sample_spacing_meters: float = ELEVATION_SAMPLE_SPACING_METERS,
    max_samples: int = SWISSTOPO_MAX_PROFILE_SAMPLES,
) -> list[ElevationSample]:
    if sample_spacing_meters <= 0:
        raise ValueError("sample_spacing_meters must be positive")
    if max_samples < 2:
        raise ValueError("max_samples must be at least two")

    chunks = split_elevation_geometry(coordinates, chunk_length_meters=chunk_length_meters)
    merged_samples: list[ElevationSample] = []
    distance_offset = 0.0

    for chunk in chunks:
        sample_count = min(
            max_samples,
            max(
                2,
                ceil(
                    (chunk.distance_meters - DISTANCE_ROUNDING_TOLERANCE_METERS)
                    / sample_spacing_meters
                )
                + 1,
            ),
        )
        samples = client.elevation_profile(
            LineStringGeometry(coordinates=chunk.coordinates),
            sample_count=sample_count,
        )
        if len(samples) < 2:
            raise SwisstopoUnavailableError(
                "The elevation service returned too few samples for a route section."
            )

        chunk_origin = samples[0].distance_meters
        for index, sample in enumerate(samples):
            if merged_samples and index == 0:
                continue
            merged_samples.append(
                replace(
                    sample,
                    distance_meters=distance_offset
                    + max(0.0, sample.distance_meters - chunk_origin),
                )
            )
        distance_offset += max(0.0, samples[-1].distance_meters - chunk_origin)

    return merged_samples


def split_elevation_geometry(
    coordinates: list[list[float]],
    *,
    chunk_length_meters: float = ELEVATION_CHUNK_LENGTH_METERS,
) -> list[ElevationGeometryChunk]:
    if len(coordinates) < 2:
        return []
    if chunk_length_meters <= 0:
        raise ValueError("chunk_length_meters must be positive")

    projected = [wgs84_to_lv95(longitude, latitude) for longitude, latitude in coordinates]
    chunks: list[ElevationGeometryChunk] = []
    current_coordinates = [coordinates[0]]
    current_distance = 0.0

    for coordinate_index in range(1, len(coordinates)):
        segment_start = projected[coordinate_index - 1]
        segment_end = projected[coordinate_index]
        segment_end_coordinate = coordinates[coordinate_index]

        while True:
            segment_distance = projected_distance(segment_start, segment_end)
            if segment_distance <= 0:
                break

            remaining_capacity = chunk_length_meters - current_distance
            if segment_distance <= remaining_capacity:
                current_coordinates.append(segment_end_coordinate)
                current_distance += segment_distance
                break

            ratio = remaining_capacity / segment_distance
            boundary = (
                segment_start[0] + (segment_end[0] - segment_start[0]) * ratio,
                segment_start[1] + (segment_end[1] - segment_start[1]) * ratio,
            )
            boundary_coordinate = list(lv95_to_wgs84(*boundary))
            current_coordinates.append(boundary_coordinate)
            chunks.append(
                ElevationGeometryChunk(
                    coordinates=current_coordinates,
                    distance_meters=chunk_length_meters,
                )
            )
            current_coordinates = [boundary_coordinate]
            current_distance = 0.0
            segment_start = boundary

        if current_distance >= chunk_length_meters and coordinate_index < len(coordinates) - 1:
            chunks.append(
                ElevationGeometryChunk(
                    coordinates=current_coordinates,
                    distance_meters=current_distance,
                )
            )
            current_coordinates = [segment_end_coordinate]
            current_distance = 0.0

    if len(current_coordinates) >= 2:
        chunks.append(
            ElevationGeometryChunk(
                coordinates=current_coordinates,
                distance_meters=current_distance,
            )
        )

    return chunks


def projected_distance(first: tuple[float, float], second: tuple[float, float]) -> float:
    return hypot(second[0] - first[0], second[1] - first[1])
