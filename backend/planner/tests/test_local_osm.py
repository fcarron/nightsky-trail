from __future__ import annotations

import sqlite3
from pathlib import Path

from planner.integrations.local_osm import (
    TrailIndexWriter,
    coordinate_bounds,
    is_confirmed_drinking_water,
    is_relevant_tags,
    row_to_osm_way,
)


def test_is_relevant_tags_accepts_trails_and_difficulty() -> None:
    assert is_relevant_tags({"highway": "path"})
    assert is_relevant_tags({"highway": "footway"})
    assert is_relevant_tags({"route": "hiking"})
    assert is_relevant_tags({"sac_scale": "mountain_hiking"})
    assert is_relevant_tags({"highway": "residential", "bridge": "yes"})


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


def test_confirmed_drinking_water_filter() -> None:
    assert is_confirmed_drinking_water({"amenity": "drinking_water"})
    assert is_confirmed_drinking_water({"amenity": "fountain", "drinking_water": "yes"})
    assert is_confirmed_drinking_water({"natural": "spring", "drinking_water": "yes"})
    assert is_confirmed_drinking_water({"fountain": "drinking"})
    assert not is_confirmed_drinking_water({"amenity": "fountain"})
    assert not is_confirmed_drinking_water({"amenity": "drinking_water", "drinking_water": "no"})
    assert not is_confirmed_drinking_water({"amenity": "drinking_water", "access": "private"})
    assert not is_confirmed_drinking_water({"disused:amenity": "drinking_water"})


def test_drinking_water_writer_deduplicates_osm_objects(tmp_path: Path) -> None:
    pbf_path = tmp_path / "switzerland.osm.pbf"
    pbf_path.touch()
    db_path = tmp_path / "trails.sqlite3"
    with TrailIndexWriter(db_path, pbf_path) as writer:
        writer.add_drinking_water("node", 123, 7.4, 46.9, {"name": "Brunnen"})
        writer.add_drinking_water("node", 123, 7.4, 46.9, {"name": "Brunnen"})

    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM drinking_water").fetchone() == (1,)
