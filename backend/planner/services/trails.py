from __future__ import annotations

import logging
from time import perf_counter

from django.conf import settings
from django.core.cache import cache
from shapely.geometry import LineString

from planner.domain.coordinates import lv95_to_wgs84, wgs84_to_lv95
from planner.domain.trail_matching import (
    TrailMatchingThresholds,
    match_osm_segments,
    split_osm_way,
)
from planner.integrations.local_osm import LocalOsmTrailIndex, LocalOsmUnavailableError
from planner.integrations.overpass import (
    OsmWay,
    OverpassClient,
    includes_unknown_difficulty_ways,
)
from planner.integrations.swisstopo_trails import (
    SwisstopoTrailClient,
    SwisstopoTrailsUnavailableError,
)

logger = logging.getLogger(__name__)
TRAILS_MIN_ZOOM = 13
# Keep the first OSM difficulty viewport aligned with the official trail layer.
TRAILS_MAX_BBOX_AREA = 0.12

WARNING_RELEVANT_SAC_SCALES = {
    "demanding_mountain_hiking",
    "demanding_alpine_hiking",
    "difficult_alpine_hiking",
}


def build_trails_response(
    bbox: tuple[float, float, float, float],
    zoom: int,
    *,
    include_osm: bool,
    include_official: bool,
    include_debug: bool,
) -> dict[str, object]:
    started_at = perf_counter()
    bbox_area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
    requested_include_debug = include_debug
    cache_key = trails_cache_key(
        bbox,
        zoom,
        include_osm=include_osm,
        include_official=include_official,
        include_debug=requested_include_debug,
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
        return cached_payload

    warnings = []
    ways = []
    swisstopo_trails = []
    if include_debug and (
        zoom < settings.TRAILS_DEBUG_MIN_ZOOM
        or bbox_area > settings.TRAILS_DEBUG_MAX_BBOX_AREA
    ):
        include_debug = False
        warnings.append("Match Debug is limited to small viewports. Zoom in to enable it.")

    load_osm = (
        include_osm and zoom >= TRAILS_MIN_ZOOM and bbox_area <= TRAILS_MAX_BBOX_AREA
    )

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
            ways = OverpassClient(
                settings.OVERPASS_BASE_URL,
                timeout_seconds=settings.OVERPASS_TIMEOUT_SECONDS,
            ).trails(bbox)
    elif include_osm and zoom < TRAILS_MIN_ZOOM:
        warnings.append(f"OSM difficulty loads at zoom level {TRAILS_MIN_ZOOM} or higher.")
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
        "include_debug=%s requested_debug=%s load_osm=%s osm_ways=%s match_ways=%s official=%s "
        "osm_segments=%s combined=%s response_combined=%s warnings=%s "
        "elapsed_ms total=%s osm=%s swisstopo=%s match=%s serialize=%s",
        zoom,
        bbox_area,
        include_osm,
        include_official,
        include_debug,
        requested_include_debug,
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
    return response_payload


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
    return [way for way in ways if way.tags.get("sac_scale") in WARNING_RELEVANT_SAC_SCALES]


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
    return f"trails:v4:zoom:{zoom}:bbox:{rounded_bbox}:{flags}"


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


def elapsed_ms(started_at: float) -> int:
    return round((perf_counter() - started_at) * 1000)
