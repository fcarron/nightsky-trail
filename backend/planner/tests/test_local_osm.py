from __future__ import annotations

from planner.integrations.local_osm import coordinate_bounds, is_relevant_tags, row_to_osm_way


def test_is_relevant_tags_accepts_trails_and_difficulty() -> None:
    assert is_relevant_tags({"highway": "path"})
    assert is_relevant_tags({"highway": "footway"})
    assert is_relevant_tags({"route": "hiking"})
    assert is_relevant_tags({"sac_scale": "mountain_hiking"})


def test_is_relevant_tags_rejects_unrelated_ways() -> None:
    assert not is_relevant_tags({"highway": "primary"})
    assert not is_relevant_tags({"route": "bus"})
    assert not is_relevant_tags({"name": "Forest"})


def test_coordinate_bounds_returns_bbox() -> None:
    assert coordinate_bounds([[7.5, 46.7], [7.4, 46.9], [7.6, 46.8]]) == (
        7.4,
        46.7,
        7.6,
        46.9,
    )


def test_row_to_osm_way_returns_normalized_way() -> None:
    way = row_to_osm_way(
        (
            123,
            "[[7.4,46.7],[7.5,46.8]]",
            '{"highway":"path","sac_scale":"hiking"}',
        )
    )

    assert way.id == 123
    assert way.coordinates == [[7.4, 46.7], [7.5, 46.8]]
    assert way.tags == {"highway": "path", "sac_scale": "hiking"}
