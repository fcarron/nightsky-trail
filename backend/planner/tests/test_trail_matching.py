from __future__ import annotations

from shapely.geometry import LineString

from planner.domain.trail_matching import (
    MATCH_STATUS_AMBIGUOUS,
    MATCH_STATUS_MATCHED,
    MATCH_STATUS_OSM_ONLY,
    OFFICIAL_CATEGORY_ALPINWANDERWEG,
    OFFICIAL_CATEGORY_BERGWANDERWEG,
    OfficialTrail,
    TrailMatchingThresholds,
    match_osm_segments,
    split_osm_way,
    warning_overlay_for,
)

THRESHOLDS = TrailMatchingThresholds(
    candidate_distance_meters=12,
    osm_segment_length_meters=50,
    minimum_match_score=0.72,
    ambiguity_score_delta=0.08,
)


def test_red_swisstopo_line_with_matching_t3_osm_segment_warns() -> None:
    official = official_trail("red", OFFICIAL_CATEGORY_BERGWANDERWEG, 0)
    osm = osm_segment(1, "demanding_mountain_hiking", 1)

    [combined] = match_osm_segments([osm], [official], THRESHOLDS)

    assert combined.match_status == MATCH_STATUS_MATCHED
    assert combined.official_category == OFFICIAL_CATEGORY_BERGWANDERWEG
    assert combined.warning_overlay is True


def test_blue_swisstopo_line_with_matching_t3_osm_segment_does_not_warn() -> None:
    official = official_trail("blue", OFFICIAL_CATEGORY_ALPINWANDERWEG, 0)
    osm = osm_segment(1, "demanding_mountain_hiking", 1)

    [combined] = match_osm_segments([osm], [official], THRESHOLDS)

    assert combined.match_status == MATCH_STATUS_MATCHED
    assert combined.official_category == OFFICIAL_CATEGORY_ALPINWANDERWEG
    assert combined.warning_overlay is False


def test_blue_swisstopo_line_with_matching_t5_osm_segment_warns() -> None:
    official = official_trail("blue", OFFICIAL_CATEGORY_ALPINWANDERWEG, 0)
    osm = osm_segment(1, "demanding_alpine_hiking", 1)

    [combined] = match_osm_segments([osm], [official], THRESHOLDS)

    assert combined.match_status == MATCH_STATUS_MATCHED
    assert combined.t_level == 5
    assert combined.warning_overlay is True


def test_blue_line_only_short_t5_subsection_warns() -> None:
    official = official_trail("blue", OFFICIAL_CATEGORY_ALPINWANDERWEG, 0, length=2000)
    segments = [
        osm_segment(1, "demanding_mountain_hiking", 1, start=0, end=600),
        osm_segment(2, "alpine_hiking", 1, start=600, end=900),
        osm_segment(3, "demanding_alpine_hiking", 1, start=900, end=1050),
        osm_segment(4, "demanding_mountain_hiking", 1, start=1050, end=2000),
    ]

    combined = match_osm_segments(segments, [official], THRESHOLDS)

    assert [segment.warning_overlay for segment in combined] == [False, False, True, False]
    assert combined[2].geometry.length == 150


def test_parallel_nearby_paths_choose_parallel_match_not_nearest_crossing() -> None:
    crossing = OfficialTrail(
        id="crossing",
        category=OFFICIAL_CATEGORY_BERGWANDERWEG,
        geometry=LineString([(50, -30), (50, 30)]),
    )
    parallel = official_trail("parallel", OFFICIAL_CATEGORY_BERGWANDERWEG, 8)
    osm = osm_segment(1, "demanding_mountain_hiking", 0)

    [combined] = match_osm_segments([osm], [crossing, parallel], THRESHOLDS)

    assert combined.match_status == MATCH_STATUS_MATCHED
    assert combined.swisstopo_id == "parallel"
    assert combined.warning_overlay is True


def test_ambiguous_parallel_candidates_do_not_warn() -> None:
    official_a = official_trail("a", OFFICIAL_CATEGORY_BERGWANDERWEG, 6)
    official_b = official_trail("b", OFFICIAL_CATEGORY_BERGWANDERWEG, -6)
    osm = osm_segment(1, "demanding_mountain_hiking", 0)

    [combined] = match_osm_segments([osm], [official_a, official_b], THRESHOLDS)

    assert combined.match_status == MATCH_STATUS_AMBIGUOUS
    assert combined.warning_overlay is False


def test_missing_sac_scale_does_not_warn() -> None:
    assert warning_overlay_for(OFFICIAL_CATEGORY_BERGWANDERWEG, None) is False


def test_osm_segment_without_swisstopo_match_does_not_warn() -> None:
    official = official_trail("far", OFFICIAL_CATEGORY_BERGWANDERWEG, 100)
    osm = osm_segment(1, "demanding_mountain_hiking", 0)

    [combined] = match_osm_segments([osm], [official], THRESHOLDS)

    assert combined.match_status == MATCH_STATUS_OSM_ONLY
    assert combined.warning_overlay is False


def test_swisstopo_segment_without_osm_match_has_no_combined_segment() -> None:
    official = official_trail("red", OFFICIAL_CATEGORY_BERGWANDERWEG, 0)

    assert match_osm_segments([], [official], THRESHOLDS) == []


def test_long_osm_way_is_split_into_matching_pieces() -> None:
    segments = split_osm_way(
        123,
        "demanding_alpine_hiking",
        LineString([(0, 0), (120, 0)]),
        THRESHOLDS,
    )

    assert len(segments) == 3
    assert [round(segment.geometry.length) for segment in segments] == [50, 50, 20]
    assert all(segment.osm_way_id == 123 for segment in segments)


def official_trail(
    trail_id: str,
    category: str,
    y_offset: float,
    *,
    length: float = 100,
) -> OfficialTrail:
    return OfficialTrail(
        id=trail_id,
        category=category,
        geometry=LineString([(0, y_offset), (length, y_offset)]),
    )


def osm_segment(
    way_id: int,
    sac_scale: str | None,
    y_offset: float,
    *,
    start: float = 0,
    end: float = 100,
):
    [segment] = split_osm_way(
        way_id,
        sac_scale,
        LineString([(start, y_offset), (end, y_offset)]),
        TrailMatchingThresholds(osm_segment_length_meters=end - start + 1),
    )
    return segment
