from __future__ import annotations

from django.conf import settings
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from planner.api.exceptions import UnprocessableEntity
from planner.api.serializers import (
    ElevationProfileRequestSerializer,
    RouteComputeRequestSerializer,
    TrailsQuerySerializer,
)
from planner.domain.elevation import ElevationValidationError, build_elevation_profile
from planner.domain.route import (
    RouteValidationError,
    SegmentRequest,
    Waypoint,
)
from planner.integrations.graphhopper import GraphHopperClient
from planner.integrations.local_osm import LocalOsmTrailIndex, LocalOsmUnavailableError
from planner.integrations.overpass import (
    OverpassClient,
    OverpassUnavailableError,
    includes_unknown_difficulty_ways,
)
from planner.integrations.swisstopo import (
    LineStringGeometry,
    SwisstopoClient,
    SwisstopoUnavailableError,
)
from planner.services.routing import compute_route


class HealthView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="health",
        responses={200: dict[str, str]},
    )
    def get(self, request: object) -> Response:
        return Response({"status": "ok"})


class RouteComputeView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="route_compute",
        request=RouteComputeRequestSerializer,
        responses={200: dict[str, object]},
    )
    def post(self, request: object) -> Response:
        serializer = RouteComputeRequestSerializer(data=getattr(request, "data", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_route_request",
                "Route request validation failed.",
                {"fields": serializer.errors},
            )

        data = serializer.validated_data
        waypoints = [
            Waypoint(
                id=waypoint["id"],
                longitude=waypoint["longitude"],
                latitude=waypoint["latitude"],
            )
            for waypoint in data["waypoints"]
        ]
        segments = [
            SegmentRequest(
                from_waypoint_id=segment["fromWaypointId"],
                to_waypoint_id=segment["toWaypointId"],
                mode=segment["mode"],
            )
            for segment in data.get("segments", [])
        ]

        try:
            route = compute_route(
                waypoints,
                segments or None,
                GraphHopperClient(
                    settings.GRAPHHOPPER_BASE_URL,
                    profile=settings.GRAPHHOPPER_PROFILE,
                    timeout_seconds=settings.GRAPHHOPPER_TIMEOUT_SECONDS,
                ),
            )
        except RouteValidationError as error:
            raise UnprocessableEntity(error.code, error.message, error.details) from error

        return Response(
            {
                "geometry": route.geometry,
                "distanceMeters": round(route.distance_meters, 3),
                "segments": [
                    {
                        "id": segment.id,
                        "fromWaypointId": segment.from_waypoint_id,
                        "toWaypointId": segment.to_waypoint_id,
                        "mode": segment.mode,
                        "distanceMeters": round(segment.distance_meters, 3),
                        "geometry": segment.geometry,
                        "details": segment.details or {},
                    }
                    for segment in route.segments
                ],
                "warnings": route.warnings,
            }
        )


class ElevationProfileView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="elevation_profile",
        request=ElevationProfileRequestSerializer,
        responses={200: dict[str, object]},
    )
    def post(self, request: object) -> Response:
        serializer = ElevationProfileRequestSerializer(data=getattr(request, "data", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_elevation_request",
                "Elevation request validation failed.",
                {"fields": serializer.errors},
            )

        geometry = serializer.validated_data["geometry"]
        coordinates = geometry["coordinates"]
        sample_count = max(2, min(500, round(estimate_sample_count(coordinates))))

        try:
            samples = SwisstopoClient(
                settings.SWISSTOPO_BASE_URL,
                timeout_seconds=settings.SWISSTOPO_TIMEOUT_SECONDS,
            ).elevation_profile(
                LineStringGeometry(coordinates=coordinates),
                sample_count=sample_count,
            )
            profile = build_elevation_profile(samples)
        except SwisstopoUnavailableError as error:
            raise UnprocessableEntity(error.code, error.message, {}) from error
        except ElevationValidationError as error:
            raise UnprocessableEntity(error.code, error.message, error.details) from error

        return Response(
            {
                "distanceMeters": round(profile.distance_meters, 3),
                "ascentMeters": round(profile.ascent_meters, 3),
                "descentMeters": round(profile.descent_meters, 3),
                "minElevationMeters": round(profile.min_elevation_meters, 3),
                "maxElevationMeters": round(profile.max_elevation_meters, 3),
                "points": [
                    {
                        "distanceMeters": round(point.distance_meters, 3),
                        "elevationMeters": round(point.elevation_meters, 3),
                        "smoothedElevationMeters": round(point.smoothed_elevation_meters, 3),
                        "gradientPercent": round(point.gradient_percent, 3),
                        "longitude": point.longitude,
                        "latitude": point.latitude,
                    }
                    for point in profile.points
                ],
            }
        )


class TrailsView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="trails",
        responses={200: dict[str, object]},
    )
    def get(self, request: object) -> Response:
        serializer = TrailsQuerySerializer(data=getattr(request, "query_params", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_trails_request",
                "OSM difficulty request validation failed.",
                {"fields": serializer.errors},
            )

        zoom = serializer.validated_data["zoom"]
        if zoom < 13:
            return Response(
                {
                    "ways": [],
                    "warnings": ["OSM difficulty loads at zoom level 13 or higher."],
                }
            )

        bbox = serializer.validated_data["bbox"]
        warnings = []
        try:
            ways = LocalOsmTrailIndex(
                settings.OSM_PBF_PATH,
                settings.OSM_TRAIL_INDEX_PATH,
            ).trails(bbox)
        except LocalOsmUnavailableError:
            if not includes_unknown_difficulty_ways(bbox):
                warnings.append(
                    "Only OSM ways with known difficulty are loaded for this viewport. "
                    "Zoom in to include unknown difficulty ways."
                )
            try:
                ways = OverpassClient(
                    settings.OVERPASS_BASE_URL,
                    timeout_seconds=settings.OVERPASS_TIMEOUT_SECONDS,
                ).trails(bbox)
            except OverpassUnavailableError as error:
                raise UnprocessableEntity(error.code, error.message, error.details) from error

        return Response(
            {
                "ways": [
                    {
                        "id": way.id,
                        "geometry": {"type": "LineString", "coordinates": way.coordinates},
                        "tags": way.tags,
                    }
                    for way in ways
                ],
                "warnings": warnings,
            }
        )


def estimate_sample_count(coordinates: list[list[float]]) -> int:
    # The frontend keeps route distance separately; this heuristic keeps requests bounded
    # until elevation caching and geometry resampling are implemented.
    return max(50, len(coordinates) * 25)
