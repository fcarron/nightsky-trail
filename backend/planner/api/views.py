from __future__ import annotations

import logging
from time import perf_counter

from django.conf import settings
from django.core.cache import cache
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView
from shapely.geometry import LineString

from planner.api.exceptions import UnprocessableEntity
from planner.api.serializers import (
    ElevationProfileRequestSerializer,
    RouteComputeRequestSerializer,
    TrailsQuerySerializer,
)
from planner.domain.coordinates import lv95_to_wgs84, wgs84_to_lv95
from planner.domain.elevation import ElevationValidationError, build_elevation_profile
from planner.domain.route import (
    RouteValidationError,
    SegmentRequest,
    Waypoint,
)
from planner.domain.trail_matching import (
    TrailMatchingThresholds,
    match_osm_segments,
    split_osm_way,
)
from planner.integrations.graphhopper import GraphHopperClient
from planner.integrations.local_osm import LocalOsmTrailIndex, LocalOsmUnavailableError
from planner.integrations.overpass import (
    OsmWay,
    OverpassClient,
    OverpassUnavailableError,
    includes_unknown_difficulty_ways,
)
from planner.integrations.swisstopo import (
    LineStringGeometry,
    SwisstopoClient,
    SwisstopoUnavailableError,
)
from planner.integrations.swisstopo_trails import (
    SwisstopoTrailClient,
    SwisstopoTrailsUnavailableError,
)
from planner.services.routing import compute_route

logger = logging.getLogger(__name__)
WARNING_RELEVANT_SAC_SCALES = {
    "demanding_mountain_hiking",
    "demanding_alpine_hiking",
    "difficult_alpine_hiking",
}


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
        started_at = perf_counter()
        serializer = TrailsQuerySerializer(data=getattr(request, "query_params", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_trails_request",
                "OSM difficulty request validation failed.",
                {"fields": serializer.errors},
            )

        zoom = serializer.validated_data["zoom"]
        include_osm = serializer.validated_data["include_osm"]
        include_official = serializer.validated_data["include_official"]
        include_debug = serializer.validated_data["include_debug"]
        bbox = serializer.validated_data["bbox"]
        bbox_area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
        cache_key = trails_cache_key(
            bbox,
            zoom,
            include_osm=include_osm,
            include_official=include_official,
            include_debug=include_debug,
        )
        cached_payload = cache.get(cache_key)
        if cached_payload is not None:
            logger.info(
                "trails cache hit zoom=%s bbox_area=%.6f include_osm=%s "
                "include_official=%s include_debug=%s elapsed_ms total=%s",
                zoom,
                bbox_area,
                include_osm,
                include_official,
                include_debug,
                elapsed_ms(started_at),
            )
            return Response(cached_payload)

        warnings = []
        ways = []
        swisstopo_trails = []
        load_osm = include_osm and zoom >= 13 and bbox_area <= 0.02
        osm_started_at = perf_counter()
        if load_osm:
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
        elif include_osm and zoom < 13:
            warnings.append("OSM difficulty loads at zoom level 13 or higher.")
        elif include_osm:
            warnings.append("OSM difficulty viewport is too large; zoom in for OSM matching.")
        osm_elapsed_ms = elapsed_ms(osm_started_at)

        swisstopo_started_at = perf_counter()
        try:
            swisstopo_trails = SwisstopoTrailClient(
                settings.SWISSTOPO_TRAILS_GPKG_PATH,
                settings.SWISSTOPO_TRAILS_ZIP_PATH,
                download_url=settings.SWISSTOPO_TRAILS_URL,
                timeout_seconds=settings.SWISSTOPO_TRAILS_TIMEOUT_SECONDS,
            ).trails(bbox_wgs84_to_lv95(bbox))
        except SwisstopoTrailsUnavailableError:
            warnings.append("Official swisstopo hiking trail features are currently unavailable.")
        swisstopo_elapsed_ms = elapsed_ms(swisstopo_started_at)

        thresholds = TrailMatchingThresholds()
        match_started_at = perf_counter()
        ways_to_match = ways if include_debug else warning_relevant_ways(ways)
        osm_segments = [
            segment
            for way in ways_to_match
            for segment in split_osm_way(
                way.id,
                way.tags.get("sac_scale"),
                LineString([wgs84_to_lv95(lon, lat) for lon, lat in way.coordinates]),
                thresholds,
            )
        ]
        combined_segments = match_osm_segments(osm_segments, swisstopo_trails, thresholds)
        match_elapsed_ms = elapsed_ms(match_started_at)

        response_combined_segments = [
            segment for segment in combined_segments if include_debug or segment.warning_overlay
        ]

        serialize_started_at = perf_counter()
        response_payload = {
            "ways": [
                {
                    "id": way.id,
                    "geometry": {"type": "LineString", "coordinates": way.coordinates},
                    "tags": way.tags,
                }
                for way in ways
                if include_debug
            ],
            "trailSummary": summarize_osm_ways(ways),
            "officialSegments": [
                {
                    "id": trail.id,
                    "officialCategory": trail.category,
                    "geometry": line_string_to_geojson_wgs84(trail.geometry),
                }
                for trail in swisstopo_trails
                if include_official
            ],
            "combinedSegments": [
                {
                    "osmWayId": segment.osm_way_id,
                    "swisstopoId": segment.swisstopo_id,
                    "officialCategory": segment.official_category,
                    "osmSacScale": segment.osm_sac_scale,
                    "tLevel": segment.t_level,
                    "matchScore": segment.match_score,
                    "matchStatus": segment.match_status,
                    "warningOverlay": segment.warning_overlay,
                    "geometry": line_string_to_geojson_wgs84(segment.geometry),
                }
                for segment in response_combined_segments
            ],
            "warnings": warnings,
        }
        serialize_elapsed_ms = elapsed_ms(serialize_started_at)

        logger.info(
            "trails request zoom=%s bbox_area=%.6f include_osm=%s include_official=%s "
            "include_debug=%s load_osm=%s osm_ways=%s match_ways=%s official=%s "
            "osm_segments=%s combined=%s response_combined=%s warnings=%s "
            "elapsed_ms total=%s osm=%s swisstopo=%s match=%s serialize=%s",
            zoom,
            bbox_area,
            include_osm,
            include_official,
            include_debug,
            load_osm,
            len(ways),
            len(ways_to_match),
            len(swisstopo_trails),
            len(osm_segments),
            len(combined_segments),
            len(response_combined_segments),
            len(warnings),
            elapsed_ms(started_at),
            osm_elapsed_ms,
            swisstopo_elapsed_ms,
            match_elapsed_ms,
            serialize_elapsed_ms,
        )
        cache.set(cache_key, response_payload, settings.TRAILS_CACHE_TIMEOUT_SECONDS)
        return Response(response_payload)


def estimate_sample_count(coordinates: list[list[float]]) -> int:
    # The frontend keeps route distance separately; this heuristic keeps requests bounded
    # until elevation caching and geometry resampling are implemented.
    return max(50, len(coordinates) * 25)


def bbox_wgs84_to_lv95(
    bbox: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    min_lon, min_lat, max_lon, max_lat = bbox
    min_x, min_y = wgs84_to_lv95(min_lon, min_lat)
    max_x, max_y = wgs84_to_lv95(max_lon, max_lat)
    return min(min_x, max_x), min(min_y, max_y), max(min_x, max_x), max(min_y, max_y)


def line_string_to_geojson_wgs84(geometry: LineString) -> dict[str, object]:
    return {
        "type": "LineString",
        "coordinates": [
            list(lv95_to_wgs84(float(coordinate[0]), float(coordinate[1])))
            for coordinate in geometry.coords
        ],
    }


def warning_relevant_ways(ways: list[OsmWay]) -> list[OsmWay]:
    return [
        way
        for way in ways
        if way.tags.get("sac_scale") in WARNING_RELEVANT_SAC_SCALES
    ]


def elapsed_ms(started_at: float) -> int:
    return round((perf_counter() - started_at) * 1000)


def trails_cache_key(
    bbox: tuple[float, float, float, float],
    zoom: int,
    *,
    include_osm: bool,
    include_official: bool,
    include_debug: bool,
) -> str:
    decimals = settings.TRAILS_CACHE_BBOX_DECIMALS
    rounded_bbox = ",".join(f"{coordinate:.{decimals}f}" for coordinate in bbox)
    flags = f"osm:{int(include_osm)}:official:{int(include_official)}:debug:{int(include_debug)}"
    return f"trails:v3:zoom:{zoom}:bbox:{rounded_bbox}:{flags}"


def summarize_osm_ways(ways: list[OsmWay]) -> dict[str, object]:
    by_label: dict[str, int] = {}
    tag_counts: dict[str, int] = {}
    for way in ways:
        label = format_sac_scale(way.tags.get("sac_scale"))
        by_label[label] = by_label.get(label, 0) + 1
        for key in ("highway", "trail_visibility", "surface", "foot", "access"):
            value = way.tags.get(key)
            if not value:
                continue
            count_key = f"{key}={value}"
            tag_counts[count_key] = tag_counts.get(count_key, 0) + 1

    common_tags = []
    for tag, count in sorted(tag_counts.items(), key=lambda item: item[1], reverse=True)[:5]:
        key, value = tag.split("=", 1)
        common_tags.append({"key": key, "value": value, "count": count})

    return {
        "totalWays": len(ways),
        "byLabel": by_label,
        "commonTags": common_tags,
    }


def format_sac_scale(value: str | None) -> str:
    if value == "strolling":
        return "<T1"
    if value == "hiking":
        return "T1"
    if value == "mountain_hiking":
        return "T2"
    if value == "demanding_mountain_hiking":
        return "T3"
    if value == "alpine_hiking":
        return "T4"
    if value == "demanding_alpine_hiking":
        return "T5"
    if value == "difficult_alpine_hiking":
        return "T6"
    return "?"
