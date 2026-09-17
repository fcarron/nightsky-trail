from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APIClient

from planner.integrations.local_osm import (
    SCHEMA_VERSION,
    DrinkingWaterPlace,
    ToiletIndexUpgradeHandler,
    ToiletPlace,
    TrailIndexWriter,
    coordinate_bounds,
    deduplicate_drinking_water_places,
    is_confirmed_drinking_water,
    is_public_toilet,
    is_relevant_tags,
    legacy_index_can_be_upgraded,
    row_to_osm_way,
    upgrade_legacy_index_with_toilets,
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


def test_public_toilet_filter() -> None:
    assert is_public_toilet({"amenity": "toilets"})
    assert is_public_toilet({"amenity": "toilets", "access": "yes"})
    assert not is_public_toilet({"amenity": "toilets", "access": "private"})
    assert not is_public_toilet({"amenity": "toilets", "access": "customers"})
    assert not is_public_toilet({"amenity": "toilets", "disused:amenity": "toilets"})
    assert not is_public_toilet({"amenity": "fountain"})


def test_drinking_water_writer_deduplicates_osm_objects(tmp_path: Path) -> None:
    pbf_path = tmp_path / "switzerland.osm.pbf"
    pbf_path.touch()
    db_path = tmp_path / "trails.sqlite3"
    with TrailIndexWriter(db_path, pbf_path) as writer:
        writer.add_drinking_water("node", 123, 7.4, 46.9, {"name": "Brunnen"})
        writer.add_drinking_water("node", 123, 7.4, 46.9, {"name": "Brunnen"})

    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM drinking_water").fetchone() == (1,)


def test_toilet_writer_deduplicates_osm_objects(tmp_path: Path) -> None:
    pbf_path = tmp_path / "switzerland.osm.pbf"
    pbf_path.touch()
    db_path = tmp_path / "trails.sqlite3"
    with TrailIndexWriter(db_path, pbf_path) as writer:
        writer.add_toilet("node", 123, 7.4, 46.9, {"name": "WC"})
        writer.add_toilet("node", 123, 7.4, 46.9, {"name": "WC"})

    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM toilets").fetchone() == (1,)


def test_legacy_index_is_upgraded_in_place_with_toilets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pbf_path = tmp_path / "switzerland.osm.pbf"
    pbf_path.touch()
    db_path = tmp_path / "trails.sqlite3"
    stat = pbf_path.stat()
    with sqlite3.connect(db_path) as connection:
        connection.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        connection.execute("CREATE TABLE trail_ways (osm_id INTEGER PRIMARY KEY)")
        connection.execute("CREATE TABLE drinking_water (osm_id INTEGER PRIMARY KEY)")
        connection.executemany(
            "INSERT INTO metadata VALUES (?, ?)",
            {
                "schema_version": "3",
                "pbf_size": str(stat.st_size),
                "pbf_mtime_ns": str(stat.st_mtime_ns),
            }.items(),
        )

    def add_fixture_toilet(self: ToiletIndexUpgradeHandler, _path: str, **_kwargs: object) -> None:
        self._add_toilet("node", 123, 7.4, 46.9, {"name": "WC"})

    monkeypatch.setattr(ToiletIndexUpgradeHandler, "apply_file", add_fixture_toilet)

    assert legacy_index_can_be_upgraded(pbf_path, db_path)
    upgrade_legacy_index_with_toilets(pbf_path, db_path, None)

    with sqlite3.connect(db_path) as connection:
        assert dict(connection.execute("SELECT key, value FROM metadata"))["schema_version"] == str(
            SCHEMA_VERSION
        )
        assert connection.execute("SELECT osm_type, osm_id FROM toilets").fetchone() == (
            "node",
            123,
        )


def test_drinking_water_query_deduplicates_matching_node_and_way() -> None:
    node = DrinkingWaterPlace("node", 1, 7.4474, 46.9481, "Dorfbrunnen", "fountain", False)
    way = DrinkingWaterPlace("way", 2, 7.4474001, 46.9481001, "Dorfbrunnen", "fountain", False)

    assert deduplicate_drinking_water_places([node, way]) == [node]


def test_toilets_endpoint_returns_normalized_public_toilets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeLocalOsmTrailIndex:
        def __init__(self, *args: object) -> None:
            pass

        def toilets(self, bbox: tuple[float, float, float, float]) -> list[ToiletPlace]:
            assert bbox == (7.4, 46.9, 7.5, 47.0)
            return [
                ToiletPlace(
                    "node",
                    123,
                    7.4474,
                    46.9481,
                    "WC Bahnhof",
                    "yes",
                    True,
                )
            ]

    cache.clear()
    monkeypatch.setattr("planner.api.views.LocalOsmTrailIndex", FakeLocalOsmTrailIndex)

    response = APIClient().get(
        reverse("toilets"),
        {"bbox": "7.4,46.9,7.5,47.0", "zoom": "14"},
    )

    assert response.status_code == 200
    assert response.json()["features"][0]["properties"] == {
        "name": "WC Bahnhof",
        "wheelchair": "yes",
        "fee": True,
        "osm_type": "node",
        "osm_id": 123,
    }
