from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import httpx

from planner.domain.route import Waypoint

DEFAULT_TIMEOUT_SECONDS = 10.0
ROUTE_DETAILS = [
    "hike_rating",
    "foot_network",
    "road_class",
]
SUPPORTED_PROFILES = {"hike"}
HIKING_MODEL_PATH = Path(__file__).resolve().parent / "graphhopper_models" / "hiking.json"


class GraphHopperError(RuntimeError):
    code = "routing_unavailable"

    def __init__(self, message: str, details: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class GraphHopperUnavailableError(GraphHopperError):
    code = "routing_unavailable"


class GraphHopperNoRouteError(GraphHopperError):
    code = "no_route"


@lru_cache(maxsize=1)
def load_hiking_custom_model() -> dict[str, object]:
    with HIKING_MODEL_PATH.open(encoding="utf-8") as model_file:
        model: object = json.load(model_file)

    if not isinstance(model, dict):
        raise GraphHopperUnavailableError("The routing custom model is invalid.")
    return model


@dataclass(frozen=True)
class GraphHopperRoute:
    distance_meters: float
    coordinates: list[list[float]]
    details: dict[str, list[list[object]]]


class GraphHopperClient:
    def __init__(
        self,
        base_url: str,
        *,
        profile: str = "hike",
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.profile = profile
        self.timeout = httpx.Timeout(timeout_seconds)

    def route_segment(
        self,
        start: Waypoint,
        end: Waypoint,
        *,
        profile: str | None = None,
    ) -> GraphHopperRoute:
        routing_profile = profile or self.profile
        if routing_profile not in SUPPORTED_PROFILES:
            raise GraphHopperUnavailableError("The routing profile is not configured.")

        payload = {
            "points": [
                [start.longitude, start.latitude],
                [end.longitude, end.latitude],
            ],
            "profile": routing_profile,
            "points_encoded": False,
            "instructions": False,
            "calc_points": True,
            "details": ROUTE_DETAILS,
        }
        if routing_profile == "hike":
            payload["custom_model"] = load_hiking_custom_model()

        try:
            response = httpx.post(
                f"{self.base_url}/route",
                json=payload,
                timeout=self.timeout,
            )
        except httpx.TimeoutException as error:
            raise GraphHopperUnavailableError(
                "The routing service timed out.",
            ) from error
        except httpx.HTTPError as error:
            raise GraphHopperUnavailableError(
                "The routing service is currently unavailable.",
            ) from error

        return parse_graphhopper_response(response)


def parse_graphhopper_response(response: httpx.Response) -> GraphHopperRoute:
    try:
        payload = response.json()
    except ValueError as error:
        raise GraphHopperUnavailableError(
            "The routing service returned invalid JSON.",
        ) from error

    if response.status_code >= 500:
        raise GraphHopperUnavailableError(
            "The routing service is currently unavailable.",
            extract_error_details(payload),
        )

    if response.status_code >= 400:
        raise GraphHopperNoRouteError(
            extract_error_message(payload, "No route could be found."),
            extract_error_details(payload),
        )

    if not isinstance(payload, dict):
        raise GraphHopperUnavailableError("The routing service returned an invalid response.")

    paths = payload.get("paths")
    if not isinstance(paths, list) or not paths:
        raise GraphHopperNoRouteError("No route could be found.")

    path = paths[0]
    if not isinstance(path, dict):
        raise GraphHopperUnavailableError("The routing service returned an invalid path.")

    distance = path.get("distance")
    if not isinstance(distance, int | float):
        raise GraphHopperUnavailableError("The routing service returned an invalid distance.")

    points = path.get("points")
    if not isinstance(points, dict):
        raise GraphHopperUnavailableError("The routing service returned invalid route geometry.")

    coordinates = points.get("coordinates")
    if not is_coordinate_list(coordinates):
        raise GraphHopperUnavailableError("The routing service returned invalid coordinates.")

    details = path.get("details", {})
    if not isinstance(details, dict):
        details = {}

    return GraphHopperRoute(
        distance_meters=float(distance),
        coordinates=coordinates,
        details={key: value for key, value in details.items() if isinstance(value, list)},
    )


def is_coordinate_list(value: object) -> bool:
    return (
        isinstance(value, list)
        and len(value) >= 2
        and all(
            isinstance(coordinate, list)
            and len(coordinate) >= 2
            and isinstance(coordinate[0], int | float)
            and isinstance(coordinate[1], int | float)
            for coordinate in value
        )
    )


def extract_error_message(payload: object, fallback: str) -> str:
    if isinstance(payload, dict) and isinstance(payload.get("message"), str):
        return payload["message"]
    return fallback


def extract_error_details(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict):
        return {}

    hints = payload.get("hints")
    details: dict[str, object] = {}
    if isinstance(hints, list):
        details["hints"] = hints
    return details
