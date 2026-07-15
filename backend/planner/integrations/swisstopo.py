from __future__ import annotations

import json
from dataclasses import dataclass

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


@dataclass(frozen=True)
class LineStringGeometry:
    coordinates: list[list[float]]


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
