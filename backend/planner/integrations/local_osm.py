from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import osmium

from planner.integrations.overpass import OVERPASS_TAGS, OsmWay

TRAIL_HIGHWAYS = {"path", "footway", "track", "steps", "pedestrian", "bridleway"}
TRAIL_ROUTES = {"hiking", "foot"}
SCHEMA_VERSION = 1
MAX_TRAIL_RESULTS = 5000

_INDEX_LOCK = threading.Lock()


class LocalOsmUnavailableError(RuntimeError):
    code = "trails_unavailable"

    def __init__(self, message: str, details: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


@dataclass(frozen=True)
class LocalOsmTrailIndex:
    pbf_path: Path
    db_path: Path

    def trails(self, bbox: tuple[float, float, float, float]) -> list[OsmWay]:
        ensure_index(self.pbf_path, self.db_path)
        min_lon, min_lat, max_lon, max_lat = bbox
        with sqlite3.connect(self.db_path) as connection:
            rows = connection.execute(
                """
                SELECT osm_id, coordinates_json, tags_json
                FROM trail_ways
                WHERE max_lon >= ?
                  AND min_lon <= ?
                  AND max_lat >= ?
                  AND min_lat <= ?
                ORDER BY osm_id
                LIMIT ?
                """,
                (min_lon, max_lon, min_lat, max_lat, MAX_TRAIL_RESULTS),
            ).fetchall()

        return [row_to_osm_way(row) for row in rows]


class TrailWayHandler(osmium.SimpleHandler):
    def __init__(self, writer: TrailIndexWriter) -> None:
        super().__init__()
        self.writer = writer

    def way(self, way: object) -> None:
        tags = {str(tag.k): str(tag.v) for tag in way.tags}
        if not is_relevant_tags(tags):
            return

        coordinates = way_coordinates(way.nodes)
        if len(coordinates) < 2:
            return

        normalized_tags = {key: value for key, value in tags.items() if key in OVERPASS_TAGS}
        self.writer.add_way(int(way.id), coordinates, normalized_tags)


class TrailIndexWriter:
    def __init__(self, db_path: Path, pbf_path: Path) -> None:
        self.db_path = db_path
        self.pbf_path = pbf_path
        self.connection: sqlite3.Connection | None = None
        self.pending = 0

    def __enter__(self) -> TrailIndexWriter:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.db_path)
        self.connection.execute("PRAGMA journal_mode = WAL")
        self.connection.execute("PRAGMA synchronous = NORMAL")
        self.connection.execute("DROP TABLE IF EXISTS metadata")
        self.connection.execute("DROP TABLE IF EXISTS trail_ways")
        self.connection.execute(
            """
            CREATE TABLE metadata (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            )
            """
        )
        self.connection.execute(
            """
            CREATE TABLE trail_ways (
              osm_id INTEGER PRIMARY KEY,
              min_lon REAL NOT NULL,
              min_lat REAL NOT NULL,
              max_lon REAL NOT NULL,
              max_lat REAL NOT NULL,
              coordinates_json TEXT NOT NULL,
              tags_json TEXT NOT NULL
            )
            """
        )
        self.connection.execute(
            "CREATE INDEX trail_ways_bbox ON trail_ways (min_lon, max_lon, min_lat, max_lat)"
        )
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        if exc_type is None:
            stat = self.pbf_path.stat()
            metadata = {
                "schema_version": str(SCHEMA_VERSION),
                "pbf_size": str(stat.st_size),
                "pbf_mtime_ns": str(stat.st_mtime_ns),
            }
            self.connection_or_raise.executemany(
                "INSERT INTO metadata (key, value) VALUES (?, ?)",
                metadata.items(),
            )
            self.connection_or_raise.commit()
        self.connection_or_raise.close()

    def add_way(
        self,
        osm_id: int,
        coordinates: list[list[float]],
        tags: dict[str, str],
    ) -> None:
        min_lon, min_lat, max_lon, max_lat = coordinate_bounds(coordinates)
        self.connection_or_raise.execute(
            """
            INSERT OR REPLACE INTO trail_ways
              (osm_id, min_lon, min_lat, max_lon, max_lat, coordinates_json, tags_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                osm_id,
                min_lon,
                min_lat,
                max_lon,
                max_lat,
                json.dumps(coordinates, separators=(",", ":")),
                json.dumps(tags, separators=(",", ":"), sort_keys=True),
            ),
        )
        self.pending += 1
        if self.pending >= 1000:
            self.connection_or_raise.commit()
            self.pending = 0

    @property
    def connection_or_raise(self) -> sqlite3.Connection:
        if self.connection is None:
            raise RuntimeError("Trail index writer is not open.")
        return self.connection


def ensure_index(pbf_path: Path, db_path: Path) -> None:
    if not pbf_path.exists():
        raise LocalOsmUnavailableError(
            "The local OSM extract is not available.",
            {"path": str(pbf_path)},
        )

    with _INDEX_LOCK:
        if index_is_current(pbf_path, db_path):
            return

        temporary_path = db_path.with_suffix(".tmp.sqlite3")
        if temporary_path.exists():
            temporary_path.unlink()

        try:
            with TrailIndexWriter(temporary_path, pbf_path) as writer:
                TrailWayHandler(writer).apply_file(str(pbf_path), locations=True)
        except Exception as error:
            if temporary_path.exists():
                temporary_path.unlink()
            raise LocalOsmUnavailableError(
                "The local OSM trail index could not be built."
            ) from error

        temporary_path.replace(db_path)


def index_is_current(pbf_path: Path, db_path: Path) -> bool:
    if not db_path.exists():
        return False

    try:
        stat = pbf_path.stat()
        with sqlite3.connect(db_path) as connection:
            metadata = dict(connection.execute("SELECT key, value FROM metadata").fetchall())
    except (OSError, sqlite3.Error):
        return False

    return metadata == {
        "schema_version": str(SCHEMA_VERSION),
        "pbf_size": str(stat.st_size),
        "pbf_mtime_ns": str(stat.st_mtime_ns),
    }


def is_relevant_tags(tags: dict[str, str]) -> bool:
    return (
        tags.get("highway") in TRAIL_HIGHWAYS
        or tags.get("route") in TRAIL_ROUTES
        or "sac_scale" in tags
    )


def way_coordinates(nodes: Iterable[object]) -> list[list[float]]:
    coordinates: list[list[float]] = []
    for node in nodes:
        location = node.location
        if not location.valid():
            continue
        coordinates.append([round(float(location.lon), 7), round(float(location.lat), 7)])
    return coordinates


def coordinate_bounds(coordinates: list[list[float]]) -> tuple[float, float, float, float]:
    longitudes = [coordinate[0] for coordinate in coordinates]
    latitudes = [coordinate[1] for coordinate in coordinates]
    return min(longitudes), min(latitudes), max(longitudes), max(latitudes)


def row_to_osm_way(row: tuple[int, str, str]) -> OsmWay:
    osm_id, coordinates_json, tags_json = row
    return OsmWay(
        id=osm_id,
        coordinates=json.loads(coordinates_json),
        tags=json.loads(tags_json),
    )
