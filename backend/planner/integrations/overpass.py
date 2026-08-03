from __future__ import annotations

from dataclasses import dataclass

import httpx

DEFAULT_TIMEOUT_SECONDS = 12.0
BROAD_TRAIL_QUERY_MAX_AREA = 0.004
TRAIL_HIGHWAY_PATTERN = "^(path|footway|track|steps|pedestrian|bridleway)$"
OVERPASS_TAGS = [
    "name",
    "highway",
    "foot",
    "access",
    "sac_scale",
    "trail_visibility",
    "informal",
    "surface",
    "tracktype",
    "smoothness",
    "incline",
    "bridge",
    "tunnel",
    "ford",
    "bicycle",
    "horse",
]


class OverpassError(RuntimeError):
    code = "trails_unavailable"

    def __init__(self, message: str, details: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class OverpassUnavailableError(OverpassError):
    """Raised when the configured Overpass service cannot serve a request."""


@dataclass(frozen=True)
class OsmWay:
    id: int
    coordinates: list[list[float]]
    tags: dict[str, str]


class OverpassClient:
    def __init__(
        self,
        base_url: str,
        *,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = httpx.Timeout(timeout_seconds)

    def trails(self, bbox: tuple[float, float, float, float]) -> list[OsmWay]:
        min_lon, min_lat, max_lon, max_lat = bbox
        query = build_trails_query(min_lon, min_lat, max_lon, max_lat)
        try:
            return self._query(query)
        except OverpassUnavailableError:
            if not includes_unknown_difficulty_ways(bbox):
                raise

        return self._query(build_known_difficulty_query(min_lon, min_lat, max_lon, max_lat))

    def _query(self, query: str) -> list[OsmWay]:
        try:
            response = httpx.post(
                f"{self.base_url}/interpreter",
                data={"data": query},
                headers={
                    "Accept": "application/json",
                    "User-Agent": "nightsky-trail/0.1 trail difficulty layer",
                },
                timeout=self.timeout,
            )
        except httpx.TimeoutException as error:
            raise OverpassUnavailableError("The OSM difficulty service timed out.") from error
        except httpx.HTTPError as error:
            raise OverpassUnavailableError(
                "The OSM difficulty service is currently unavailable."
            ) from error

        return parse_overpass_response(response)


def build_trails_query(min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> str:
    if not includes_unknown_difficulty_ways((min_lon, min_lat, max_lon, max_lat)):
        return build_known_difficulty_query(min_lon, min_lat, max_lon, max_lat)

    bbox = format_overpass_bbox(min_lon, min_lat, max_lon, max_lat)
    return f"""
[out:json][timeout:10][maxsize:8388608];
(
  way["highway"~"{TRAIL_HIGHWAY_PATTERN}"]({bbox});
  way["route"~"^(hiking|foot)$"]({bbox});
  way["sac_scale"]({bbox});
);
out tags geom;
""".strip()


def build_known_difficulty_query(
    min_lon: float, min_lat: float, max_lon: float, max_lat: float
) -> str:
    bbox = format_overpass_bbox(min_lon, min_lat, max_lon, max_lat)
    return f"""
[out:json][timeout:10][maxsize:8388608];
(
  way["sac_scale"]({bbox});
);
out tags geom;
""".strip()


def format_overpass_bbox(min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> str:
    return f"{min_lat:.7f},{min_lon:.7f},{max_lat:.7f},{max_lon:.7f}"


def includes_unknown_difficulty_ways(bbox: tuple[float, float, float, float]) -> bool:
    min_lon, min_lat, max_lon, max_lat = bbox
    return (max_lon - min_lon) * (max_lat - min_lat) <= BROAD_TRAIL_QUERY_MAX_AREA


def parse_overpass_response(response: httpx.Response) -> list[OsmWay]:
    if response.status_code >= 400:
        raise OverpassUnavailableError(
            "The OSM difficulty service is currently unavailable.",
            {"statusCode": response.status_code},
        )

    try:
        payload = response.json()
    except ValueError as error:
        raise OverpassUnavailableError(
            "The OSM difficulty service returned invalid JSON."
        ) from error

    if not isinstance(payload, dict):
        raise OverpassUnavailableError("The OSM difficulty service returned an invalid response.")

    elements = payload.get("elements")
    if not isinstance(elements, list):
        raise OverpassUnavailableError("The OSM difficulty service returned invalid elements.")
    if not elements and isinstance(payload.get("remark"), str):
        raise OverpassUnavailableError(
            "The OSM difficulty service could not load this viewport.",
            {"remark": payload["remark"][:160]},
        )

    ways: list[OsmWay] = []
    for element in elements:
        if not isinstance(element, dict) or element.get("type") != "way":
            continue

        way_id = element.get("id")
        geometry = element.get("geometry")
        tags = element.get("tags", {})
        if not isinstance(way_id, int) or not isinstance(tags, dict):
            continue

        coordinates = parse_geometry(geometry)
        if len(coordinates) < 2:
            continue

        normalized_tags = {
            key: str(value)
            for key, value in tags.items()
            if key in OVERPASS_TAGS
            and isinstance(key, str)
            and isinstance(value, str | int | float | bool)
        }

        ways.append(OsmWay(id=way_id, coordinates=coordinates, tags=normalized_tags))

    return ways


def parse_geometry(value: object) -> list[list[float]]:
    if not isinstance(value, list):
        return []

    coordinates: list[list[float]] = []
    for point in value:
        if not isinstance(point, dict):
            continue

        longitude = point.get("lon")
        latitude = point.get("lat")
        if isinstance(longitude, int | float) and isinstance(latitude, int | float):
            coordinates.append([float(longitude), float(latitude)])

    return coordinates
