from __future__ import annotations

import json
import re
from dataclasses import dataclass
from html import unescape

import httpx

from planner.domain.coordinates import lv95_to_wgs84, wgs84_to_lv95
from planner.domain.elevation import ElevationSample

DEFAULT_TIMEOUT_SECONDS = 10.0


class SwisstopoUnavailableError(RuntimeError):
    """Raised when the configured swisstopo service cannot serve a request."""

    code = "elevation_unavailable"

    def __init__(self, message: str = "The elevation service is currently unavailable.") -> None:
        super().__init__(message)
        self.message = message


class SwisstopoSearchUnavailableError(RuntimeError):
    """Raised when the configured swisstopo search service cannot serve a request."""

    code = "search_unavailable"

    def __init__(self, message: str = "The search service is currently unavailable.") -> None:
        super().__init__(message)
        self.message = message


@dataclass(frozen=True)
class LineStringGeometry:
    coordinates: list[list[float]]


@dataclass(frozen=True)
class SearchResult:
    id: str
    label: str
    origin: str
    longitude: float
    latitude: float
    zoom: int


class SwisstopoClient:
    def __init__(
        self,
        base_url: str,
        *,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = httpx.Timeout(timeout_seconds)

    def elevation_profile(
        self,
        geometry: LineStringGeometry,
        *,
        sample_count: int,
    ) -> list[ElevationSample]:
        lv95_geometry = {
            "type": "LineString",
            "coordinates": [
                list(wgs84_to_lv95(longitude, latitude))
                for longitude, latitude in geometry.coordinates
            ],
        }

        try:
            response = httpx.post(
                f"{self.base_url}/rest/services/profile.json",
                data={
                    "geom": json.dumps(lv95_geometry),
                    "sr": "2056",
                    "nb_points": str(sample_count),
                    "distinct_points": "True",
                },
                timeout=self.timeout,
            )
        except httpx.HTTPError as error:
            raise SwisstopoUnavailableError() from error

        return parse_profile_response(response)

    def search_locations(self, query: str, *, limit: int = 8) -> list[SearchResult]:
        try:
            response = httpx.get(
                f"{self.base_url}/rest/services/ech/SearchServer",
                params={
                    "searchText": query,
                    "type": "locations",
                    "limit": str(limit),
                    "sr": "4326",
                },
                timeout=self.timeout,
            )
        except httpx.HTTPError as error:
            raise SwisstopoSearchUnavailableError() from error

        return parse_search_response(response)


def parse_profile_response(response: httpx.Response) -> list[ElevationSample]:
    if response.status_code >= 400:
        raise SwisstopoUnavailableError()

    try:
        payload = response.json()
    except ValueError as error:
        raise SwisstopoUnavailableError("The elevation service returned invalid JSON.") from error

    if not isinstance(payload, list):
        raise SwisstopoUnavailableError("The elevation service returned an invalid response.")

    samples: list[ElevationSample] = []
    for item in payload:
        if not isinstance(item, dict):
            raise SwisstopoUnavailableError("The elevation service returned an invalid point.")

        distance = item.get("dist")
        easting = item.get("easting")
        northing = item.get("northing")
        alts = item.get("alts")
        elevation = alts.get("COMB") if isinstance(alts, dict) else None
        numeric_values = (distance, easting, northing, elevation)
        if not all(isinstance(value, int | float) for value in numeric_values):
            raise SwisstopoUnavailableError("The elevation service returned invalid point values.")

        longitude, latitude = lv95_to_wgs84(float(easting), float(northing))
        samples.append(
            ElevationSample(
                distance_meters=float(distance),
                elevation_meters=float(elevation),
                longitude=longitude,
                latitude=latitude,
            )
        )

    return samples


def parse_search_response(response: httpx.Response) -> list[SearchResult]:
    if response.status_code >= 400:
        raise SwisstopoSearchUnavailableError()

    try:
        payload = response.json()
    except ValueError as error:
        raise SwisstopoSearchUnavailableError(
            "The search service returned invalid JSON."
        ) from error

    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        raise SwisstopoSearchUnavailableError("The search service returned an invalid response.")

    results: list[SearchResult] = []
    for item in payload["results"]:
        if not isinstance(item, dict):
            continue

        attrs = item.get("attrs")
        if not isinstance(attrs, dict):
            continue

        lon = attrs.get("lon")
        lat = attrs.get("lat")
        if not isinstance(lon, int | float) or not isinstance(lat, int | float):
            continue

        raw_label = attrs.get("label")
        detail = attrs.get("detail")
        origin = attrs.get("origin")
        zoom_level = attrs.get("zoomlevel")
        result_id = item.get("id")
        label = clean_search_label(raw_label if isinstance(raw_label, str) else detail)
        if not label:
            continue

        results.append(
            SearchResult(
                id=str(result_id if result_id is not None else f"{lon:.7f},{lat:.7f}"),
                label=label,
                origin=origin if isinstance(origin, str) else "location",
                longitude=float(lon),
                latitude=float(lat),
                zoom=normalized_search_zoom(zoom_level),
            )
        )

    return results


def clean_search_label(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", unescape(value))).strip()


def normalized_search_zoom(value: object) -> int:
    if not isinstance(value, int | float):
        return 14
    if value < 1 or value > 20:
        return 14
    return int(value)
