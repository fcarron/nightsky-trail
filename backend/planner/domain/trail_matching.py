from __future__ import annotations

from dataclasses import dataclass
from statistics import mean

from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

OFFICIAL_CATEGORY_WANDERWEG = "hiking_trail"
OFFICIAL_CATEGORY_BERGWANDERWEG = "mountain_hiking_trail"
OFFICIAL_CATEGORY_ALPINWANDERWEG = "alpine_hiking_trail"
OFFICIAL_CATEGORY_OTHER = "other"
OFFICIAL_CATEGORY_UNKNOWN = "unknown"

MATCH_STATUS_MATCHED = "matched"
MATCH_STATUS_AMBIGUOUS = "ambiguous"
MATCH_STATUS_OSM_ONLY = "osm_only"

SAC_SCALE_T_LEVELS = {
    "hiking": 1,
    "mountain_hiking": 2,
    "demanding_mountain_hiking": 3,
    "alpine_hiking": 4,
    "demanding_alpine_hiking": 5,
    "difficult_alpine_hiking": 6,
}

SWISSTOPO_CATEGORY_VALUES = {
    0: OFFICIAL_CATEGORY_WANDERWEG,
    1: OFFICIAL_CATEGORY_BERGWANDERWEG,
    2: OFFICIAL_CATEGORY_ALPINWANDERWEG,
    3: OFFICIAL_CATEGORY_OTHER,
    "Wanderweg": OFFICIAL_CATEGORY_WANDERWEG,
    "Bergwanderweg": OFFICIAL_CATEGORY_BERGWANDERWEG,
    "Alpinwanderweg": OFFICIAL_CATEGORY_ALPINWANDERWEG,
    "andere": OFFICIAL_CATEGORY_OTHER,
}


@dataclass(frozen=True)
class TrailMatchingThresholds:
    candidate_distance_meters: float = 12.0
    osm_segment_length_meters: float = 35.0
    minimum_match_score: float = 0.72
    ambiguity_score_delta: float = 0.08


@dataclass(frozen=True)
class OfficialTrail:
    id: str
    category: str
    geometry: LineString


@dataclass(frozen=True)
class OsmTrailSegment:
    osm_way_id: int
    sac_scale: str | None
    t_level: int | None
    geometry: LineString


@dataclass(frozen=True)
class CombinedTrailSegment:
    osm_way_id: int
    swisstopo_id: str | None
    official_category: str | None
    osm_sac_scale: str | None
    t_level: int | None
    match_score: float
    match_status: str
    warning_overlay: bool
    geometry: LineString


def normalize_swisstopo_category(value: object) -> str:
    if value is None:
        return OFFICIAL_CATEGORY_UNKNOWN
    return SWISSTOPO_CATEGORY_VALUES.get(value, OFFICIAL_CATEGORY_UNKNOWN)


def normalize_sac_scale(value: str | None) -> int | None:
    if value is None:
        return None
    return SAC_SCALE_T_LEVELS.get(value)


def warning_overlay_for(official_category: str | None, t_level: int | None) -> bool:
    if t_level is None:
        return False
    return (
        official_category == OFFICIAL_CATEGORY_BERGWANDERWEG
        and t_level == 3
        or official_category == OFFICIAL_CATEGORY_ALPINWANDERWEG
        and t_level in {5, 6}
    )


def split_osm_way(
    osm_way_id: int,
    sac_scale: str | None,
    geometry: LineString,
    thresholds: TrailMatchingThresholds,
) -> list[OsmTrailSegment]:
    if geometry.length <= thresholds.osm_segment_length_meters:
        return [
            OsmTrailSegment(
                osm_way_id=osm_way_id,
                sac_scale=sac_scale,
                t_level=normalize_sac_scale(sac_scale),
                geometry=geometry,
            )
        ]

    segments: list[OsmTrailSegment] = []
    distance = 0.0
    while distance < geometry.length:
        next_distance = min(distance + thresholds.osm_segment_length_meters, geometry.length)
        segment = substring_line(geometry, distance, next_distance)
        if segment.length > 0:
            segments.append(
                OsmTrailSegment(
                    osm_way_id=osm_way_id,
                    sac_scale=sac_scale,
                    t_level=normalize_sac_scale(sac_scale),
                    geometry=segment,
                )
            )
        distance = next_distance
    return segments


def match_osm_segments(
    osm_segments: list[OsmTrailSegment],
    official_trails: list[OfficialTrail],
    thresholds: TrailMatchingThresholds | None = None,
) -> list[CombinedTrailSegment]:
    active_thresholds = thresholds or TrailMatchingThresholds()
    if not official_trails:
        return [osm_only_segment(segment) for segment in osm_segments]

    tree = STRtree([trail.geometry for trail in official_trails])
    combined: list[CombinedTrailSegment] = []

    for segment in osm_segments:
        candidates = [
            official_trails[int(index)]
            for index in tree.query(
                segment.geometry.buffer(active_thresholds.candidate_distance_meters)
            )
        ]
        scored = sorted(
            (
                (score_match(segment.geometry, candidate.geometry, active_thresholds), candidate)
                for candidate in candidates
            ),
            key=lambda item: item[0],
            reverse=True,
        )
        reliable = [
            (score, candidate)
            for score, candidate in scored
            if score >= active_thresholds.minimum_match_score
        ]
        if not reliable:
            combined.append(osm_only_segment(segment))
            continue

        best_score, best_candidate = reliable[0]
        if (
            len(reliable) > 1
            and best_score - reliable[1][0] < active_thresholds.ambiguity_score_delta
        ):
            combined.append(
                CombinedTrailSegment(
                    osm_way_id=segment.osm_way_id,
                    swisstopo_id=None,
                    official_category=None,
                    osm_sac_scale=segment.sac_scale,
                    t_level=segment.t_level,
                    match_score=round(best_score, 4),
                    match_status=MATCH_STATUS_AMBIGUOUS,
                    warning_overlay=False,
                    geometry=segment.geometry,
                )
            )
            continue

        combined.append(
            CombinedTrailSegment(
                osm_way_id=segment.osm_way_id,
                swisstopo_id=best_candidate.id,
                official_category=best_candidate.category,
                osm_sac_scale=segment.sac_scale,
                t_level=segment.t_level,
                match_score=round(best_score, 4),
                match_status=MATCH_STATUS_MATCHED,
                warning_overlay=warning_overlay_for(best_candidate.category, segment.t_level),
                geometry=segment.geometry,
            )
        )

    return combined


def score_match(
    osm_geometry: LineString,
    official_geometry: LineString,
    thresholds: TrailMatchingThresholds,
) -> float:
    if osm_geometry.length == 0:
        return 0.0

    coverage = (
        osm_geometry.intersection(
            official_geometry.buffer(thresholds.candidate_distance_meters)
        ).length
        / osm_geometry.length
    )
    distances = sample_distances(osm_geometry, official_geometry)
    average_distance = mean(distances) if distances else thresholds.candidate_distance_meters
    distance_score = max(0.0, 1.0 - average_distance / thresholds.candidate_distance_meters)
    direction_score = direction_similarity(osm_geometry, official_geometry)
    return 0.5 * coverage + 0.3 * distance_score + 0.2 * direction_score


def sample_distances(osm_geometry: LineString, official_geometry: LineString) -> list[float]:
    sample_count = max(3, min(9, round(osm_geometry.length / 8)))
    distances: list[float] = []
    for index in range(sample_count):
        fraction = index / (sample_count - 1)
        point = osm_geometry.interpolate(osm_geometry.length * fraction)
        distances.append(point.distance(official_geometry))
    return distances


def direction_similarity(osm_geometry: LineString, official_geometry: LineString) -> float:
    osm_vector = line_vector(osm_geometry)
    midpoint = osm_geometry.interpolate(osm_geometry.length / 2)
    projected = official_geometry.project(midpoint)
    start = official_geometry.interpolate(max(0.0, projected - 5.0))
    end = official_geometry.interpolate(min(official_geometry.length, projected + 5.0))
    official_vector = (end.x - start.x, end.y - start.y)

    osm_length = (osm_vector[0] ** 2 + osm_vector[1] ** 2) ** 0.5
    official_length = (official_vector[0] ** 2 + official_vector[1] ** 2) ** 0.5
    if osm_length == 0 or official_length == 0:
        return 0.0
    dot = osm_vector[0] * official_vector[0] + osm_vector[1] * official_vector[1]
    return abs(dot / (osm_length * official_length))


def line_vector(geometry: LineString) -> tuple[float, float]:
    start = Point(geometry.coords[0])
    end = Point(geometry.coords[-1])
    return end.x - start.x, end.y - start.y


def substring_line(geometry: LineString, start_distance: float, end_distance: float) -> LineString:
    points = [geometry.interpolate(start_distance)]
    for coordinate in geometry.coords:
        point = Point(coordinate)
        projected = geometry.project(point)
        if start_distance < projected < end_distance:
            points.append(point)
    points.append(geometry.interpolate(end_distance))
    return LineString([(point.x, point.y) for point in points])


def osm_only_segment(segment: OsmTrailSegment) -> CombinedTrailSegment:
    return CombinedTrailSegment(
        osm_way_id=segment.osm_way_id,
        swisstopo_id=None,
        official_category=None,
        osm_sac_scale=segment.sac_scale,
        t_level=segment.t_level,
        match_score=0.0,
        match_status=MATCH_STATUS_OSM_ONLY,
        warning_overlay=False,
        geometry=segment.geometry,
    )
