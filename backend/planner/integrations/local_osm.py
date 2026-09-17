from __future__ import annotations

import json
import logging
import sqlite3
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

import osmium

from planner.integrations.overpass import OVERPASS_TAGS, OsmWay

TRAIL_HIGHWAYS = {"path", "footway", "track", "steps", "pedestrian", "bridleway"}
TRAIL_ROUTES = {"hiking", "foot"}
SCHEMA_VERSION = 5
MAX_TRAIL_RESULTS = 5000
MAX_DRINKING_WATER_RESULTS = 1000
MAX_TOILET_RESULTS = 1000
LEGACY_SCHEMA_VERSION = 3
PROGRESS_INTERVAL = 500_000

_INDEX_LOCK = threading.Lock()
logger = logging.getLogger(__name__)


class LocalOsmUnavailableError(RuntimeError):
    code = "trails_unavailable"

    def __init__(self, message: str, details: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class LocalOsmIndexNotReadyError(LocalOsmUnavailableError):
    code = "osm_index_not_ready"


@dataclass(frozen=True)
class LocalOsmTrailIndex:
    pbf_path: Path
    db_path: Path

    def trails(self, bbox: tuple[float, float, float, float]) -> list[OsmWay]:
        require_current_index(self.pbf_path, self.db_path)
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

    def drinking_water(self, bbox: tuple[float, float, float, float]) -> list[DrinkingWaterPlace]:
        require_current_index(self.pbf_path, self.db_path)
        min_lon, min_lat, max_lon, max_lat = bbox
        with sqlite3.connect(self.db_path) as connection:
            rows = connection.execute(
                """
                SELECT osm_type, osm_id, longitude, latitude, tags_json
                FROM drinking_water
                WHERE longitude >= ? AND longitude <= ?
                  AND latitude >= ? AND latitude <= ?
                ORDER BY osm_type, osm_id
                LIMIT ?
                """,
                (min_lon, max_lon, min_lat, max_lat, MAX_DRINKING_WATER_RESULTS),
            ).fetchall()
        return deduplicate_drinking_water_places(row_to_drinking_water_place(row) for row in rows)

    def toilets(self, bbox: tuple[float, float, float, float]) -> list[ToiletPlace]:
        """Return publicly accessible toilets represented by OSM nodes or areas."""

        require_current_index(self.pbf_path, self.db_path)
        min_lon, min_lat, max_lon, max_lat = bbox
        with sqlite3.connect(self.db_path) as connection:
            rows = connection.execute(
                """
                SELECT osm_type, osm_id, longitude, latitude, tags_json
                FROM toilets
                WHERE longitude >= ? AND longitude <= ?
                  AND latitude >= ? AND latitude <= ?
                ORDER BY osm_type, osm_id
                LIMIT ?
                """,
                (min_lon, max_lon, min_lat, max_lat, MAX_TOILET_RESULTS),
            ).fetchall()
        return [row_to_toilet_place(row) for row in rows]


@dataclass(frozen=True)
class DrinkingWaterPlace:
    osm_type: str
    osm_id: int
    longitude: float
    latitude: float
    name: str | None
    place_type: str
    seasonal: bool


@dataclass(frozen=True)
class ToiletPlace:
    osm_type: str
    osm_id: int
    longitude: float
    latitude: float
    name: str | None
    wheelchair: str | None
    fee: bool | None


@dataclass(frozen=True)
class DrinkingWaterRelation:
    osm_id: int
    node_ids: tuple[int, ...]
    way_ids: tuple[int, ...]
    tags: dict[str, str]


class DrinkingWaterRelationHandler(osmium.SimpleHandler):
    """Collect confirmed-water relation members before resolving their geometry."""

    def __init__(self) -> None:
        super().__init__()
        self.relations: list[DrinkingWaterRelation] = []

    def relation(self, relation: object) -> None:
        tags = {str(tag.k): str(tag.v) for tag in relation.tags}
        if not is_confirmed_drinking_water(tags):
            return
        node_ids = tuple(int(member.ref) for member in relation.members if member.type == "n")
        way_ids = tuple(int(member.ref) for member in relation.members if member.type == "w")
        if node_ids or way_ids:
            self.relations.append(DrinkingWaterRelation(int(relation.id), node_ids, way_ids, tags))


class TrailWayHandler(osmium.SimpleHandler):
    def __init__(
        self,
        writer: TrailIndexWriter,
        drinking_water_relations: Iterable[DrinkingWaterRelation] = (),
        progress: Callable[[str], None] | None = None,
    ) -> None:
        super().__init__()
        self.writer = writer
        self.relation_nodes: dict[int, list[DrinkingWaterRelation]] = {}
        self.relation_ways: dict[int, list[DrinkingWaterRelation]] = {}
        self.relation_coordinates: dict[int, list[list[float]]] = {}
        self.relations_by_id: dict[int, DrinkingWaterRelation] = {}
        self.progress = progress
        self.node_count = 0
        self.way_count = 0
        for relation in drinking_water_relations:
            self.relations_by_id[relation.osm_id] = relation
            self.relation_coordinates[relation.osm_id] = []
            for node_id in relation.node_ids:
                self.relation_nodes.setdefault(node_id, []).append(relation)
            for way_id in relation.way_ids:
                self.relation_ways.setdefault(way_id, []).append(relation)

    def way(self, way: object) -> None:
        self.way_count += 1
        self._report_progress("ways", self.way_count)
        tags = {str(tag.k): str(tag.v) for tag in way.tags}
        relevant_trail = is_relevant_tags(tags)
        drinking_water = is_confirmed_drinking_water(tags)
        public_toilet = is_public_toilet(tags)
        related_water = self.relation_ways.get(int(way.id), [])
        if not (relevant_trail or drinking_water or public_toilet or related_water):
            return

        coordinates = way_coordinates(way.nodes)
        if relevant_trail and len(coordinates) >= 2:
            normalized_tags = {key: value for key, value in tags.items() if key in OVERPASS_TAGS}
            self.writer.add_way(int(way.id), coordinates, normalized_tags)

        if drinking_water and coordinates:
            longitude = sum(point[0] for point in coordinates) / len(coordinates)
            latitude = sum(point[1] for point in coordinates) / len(coordinates)
            self.writer.add_drinking_water("way", int(way.id), longitude, latitude, tags)
        if public_toilet and coordinates:
            longitude = sum(point[0] for point in coordinates) / len(coordinates)
            latitude = sum(point[1] for point in coordinates) / len(coordinates)
            self.writer.add_toilet("way", int(way.id), longitude, latitude, tags)
        for relation in related_water:
            self.relation_coordinates[relation.osm_id].extend(coordinates)

    def node(self, node: object) -> None:
        self.node_count += 1
        self._report_progress("nodes", self.node_count)
        tags = {str(tag.k): str(tag.v) for tag in node.tags}
        if not node.location.valid():
            return
        if is_confirmed_drinking_water(tags):
            self.writer.add_drinking_water(
                "node", int(node.id), float(node.location.lon), float(node.location.lat), tags
            )
        if is_public_toilet(tags):
            self.writer.add_toilet(
                "node", int(node.id), float(node.location.lon), float(node.location.lat), tags
            )
        for relation in self.relation_nodes.get(int(node.id), []):
            self.relation_coordinates[relation.osm_id].append(
                [float(node.location.lon), float(node.location.lat)]
            )

    def write_drinking_water_relations(self) -> None:
        for relation_id, coordinates in self.relation_coordinates.items():
            if not coordinates:
                continue
            relation = self.relations_by_id[relation_id]
            longitude = sum(point[0] for point in coordinates) / len(coordinates)
            latitude = sum(point[1] for point in coordinates) / len(coordinates)
            self.writer.add_drinking_water(
                "relation", relation_id, longitude, latitude, relation.tags
            )

    def _report_progress(self, object_type: str, count: int) -> None:
        if self.progress is not None and count % PROGRESS_INTERVAL == 0:
            self.progress(f"Processed {count:,} OSM {object_type}…")


class ToiletIndexUpgradeHandler(osmium.SimpleHandler):
    """Add public toilets to an existing index without rewriting trails or water."""

    def __init__(
        self, connection: sqlite3.Connection, progress: Callable[[str], None] | None
    ) -> None:
        super().__init__()
        self.connection = connection
        self.progress = progress
        self.node_count = 0
        self.way_count = 0

    def node(self, node: object) -> None:
        self.node_count += 1
        self._report_progress("nodes", self.node_count)
        tags = {str(tag.k): str(tag.v) for tag in node.tags}
        if not node.location.valid() or not is_public_toilet(tags):
            return
        self._add_toilet(
            "node", int(node.id), float(node.location.lon), float(node.location.lat), tags
        )

    def way(self, way: object) -> None:
        self.way_count += 1
        self._report_progress("ways", self.way_count)
        tags = {str(tag.k): str(tag.v) for tag in way.tags}
        if not is_public_toilet(tags):
            return
        coordinates = way_coordinates(way.nodes)
        if not coordinates:
            return
        longitude = sum(point[0] for point in coordinates) / len(coordinates)
        latitude = sum(point[1] for point in coordinates) / len(coordinates)
        self._add_toilet("way", int(way.id), longitude, latitude, tags)

    def _add_toilet(
        self, osm_type: str, osm_id: int, longitude: float, latitude: float, tags: dict[str, str]
    ) -> None:
        self.connection.execute(
            "INSERT OR REPLACE INTO toilets VALUES (?, ?, ?, ?, ?)",
            (
                osm_type,
                osm_id,
                round(longitude, 7),
                round(latitude, 7),
                json.dumps(compact_toilet_tags(tags), separators=(",", ":"), sort_keys=True),
            ),
        )

    def _report_progress(self, object_type: str, count: int) -> None:
        if self.progress is not None and count % PROGRESS_INTERVAL == 0:
            self.progress(f"Processed {count:,} OSM {object_type}…")


class TrailIndexWriter:
    def __init__(self, db_path: Path, pbf_path: Path) -> None:
        self.db_path = db_path
        self.pbf_path = pbf_path
        self.connection: sqlite3.Connection | None = None
        self.pending = 0

    def __enter__(self) -> TrailIndexWriter:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.db_path)
        # The index is built into a temporary file and atomically replaced.
        # DELETE avoids orphaned WAL sidecars after an interrupted build.
        self.connection.execute("PRAGMA journal_mode = DELETE")
        self.connection.execute("PRAGMA synchronous = NORMAL")
        self.connection.execute("DROP TABLE IF EXISTS metadata")
        self.connection.execute("DROP TABLE IF EXISTS trail_ways")
        self.connection.execute("DROP TABLE IF EXISTS drinking_water")
        self.connection.execute("DROP TABLE IF EXISTS toilets")
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
            CREATE TABLE drinking_water (
              osm_type TEXT NOT NULL,
              osm_id INTEGER NOT NULL,
              longitude REAL NOT NULL,
              latitude REAL NOT NULL,
              tags_json TEXT NOT NULL,
              PRIMARY KEY (osm_type, osm_id)
            )
            """
        )
        self.connection.execute(
            "CREATE INDEX drinking_water_point ON drinking_water (longitude, latitude)"
        )
        self.connection.execute(
            """
            CREATE TABLE toilets (
              osm_type TEXT NOT NULL,
              osm_id INTEGER NOT NULL,
              longitude REAL NOT NULL,
              latitude REAL NOT NULL,
              tags_json TEXT NOT NULL,
              PRIMARY KEY (osm_type, osm_id)
            )
            """
        )
        self.connection.execute("CREATE INDEX toilets_point ON toilets (longitude, latitude)")
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

    def add_drinking_water(
        self, osm_type: str, osm_id: int, longitude: float, latitude: float, tags: dict[str, str]
    ) -> None:
        self.connection_or_raise.execute(
            "INSERT OR REPLACE INTO drinking_water VALUES (?, ?, ?, ?, ?)",
            (
                osm_type,
                osm_id,
                round(longitude, 7),
                round(latitude, 7),
                json.dumps(
                    compact_drinking_water_tags(tags), separators=(",", ":"), sort_keys=True
                ),
            ),
        )
        self.pending += 1
        if self.pending >= 1000:
            self.connection_or_raise.commit()
            self.pending = 0

    def add_toilet(
        self, osm_type: str, osm_id: int, longitude: float, latitude: float, tags: dict[str, str]
    ) -> None:
        self.connection_or_raise.execute(
            "INSERT OR REPLACE INTO toilets VALUES (?, ?, ?, ?, ?)",
            (
                osm_type,
                osm_id,
                round(longitude, 7),
                round(latitude, 7),
                json.dumps(compact_toilet_tags(tags), separators=(",", ":"), sort_keys=True),
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


def ensure_index(
    pbf_path: Path,
    db_path: Path,
    progress: Callable[[str], None] | None = None,
) -> None:
    if not pbf_path.exists():
        raise LocalOsmUnavailableError(
            "The local OSM extract is not available.",
            {"path": str(pbf_path)},
        )

    with _INDEX_LOCK:
        if index_is_current(pbf_path, db_path):
            return

        if legacy_index_can_be_upgraded(pbf_path, db_path):
            report_progress(progress, "Upgrading the existing OSM index with public toilets…")
            upgrade_legacy_index_with_toilets(pbf_path, db_path, progress)
            return

        temporary_path = db_path.with_suffix(".tmp.sqlite3")
        if temporary_path.exists():
            temporary_path.unlink()

        try:
            with TrailIndexWriter(temporary_path, pbf_path) as writer:
                report_progress(progress, "Reading OSM relations for drinking-water places…")
                relation_handler = DrinkingWaterRelationHandler()
                relation_handler.apply_file(str(pbf_path))
                report_progress(progress, "Building the local trail, water and toilet index…")
                handler = TrailWayHandler(writer, relation_handler.relations, progress)
                handler.apply_file(str(pbf_path), locations=True)
                handler.write_drinking_water_relations()
        except Exception as error:
            if temporary_path.exists():
                temporary_path.unlink()
            logger.exception("Local OSM index build failed for %s", pbf_path)
            raise LocalOsmUnavailableError(
                "The local OSM trail index could not be built."
            ) from error

        temporary_path.replace(db_path)


def upgrade_legacy_index_with_toilets(
    pbf_path: Path,
    db_path: Path,
    progress: Callable[[str], None] | None,
) -> None:
    """Upgrade schema 3 in place, preserving the large trail and water tables."""

    with sqlite3.connect(db_path) as connection:
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                CREATE TABLE toilets (
                  osm_type TEXT NOT NULL,
                  osm_id INTEGER NOT NULL,
                  longitude REAL NOT NULL,
                  latitude REAL NOT NULL,
                  tags_json TEXT NOT NULL,
                  PRIMARY KEY (osm_type, osm_id)
                )
                """
            )
            connection.execute("CREATE INDEX toilets_point ON toilets (longitude, latitude)")
            report_progress(progress, "Scanning the Swiss OSM extract for public toilets…")
            ToiletIndexUpgradeHandler(connection, progress).apply_file(
                str(pbf_path), locations=True
            )
            connection.execute(
                "UPDATE metadata SET value = ? WHERE key = 'schema_version'",
                (str(SCHEMA_VERSION),),
            )
            connection.commit()
        except BaseException:
            connection.rollback()
            raise


def require_current_index(pbf_path: Path, db_path: Path) -> None:
    """Keep expensive PBF indexing out of interactive API requests."""

    if not pbf_path.exists():
        raise LocalOsmUnavailableError(
            "The local OSM extract is not available.", {"path": str(pbf_path)}
        )
    if not index_is_current(pbf_path, db_path):
        raise LocalOsmIndexNotReadyError(
            "The local OSM index is not ready. Run 'python manage.py build_osm_index'."
        )


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


def legacy_index_can_be_upgraded(pbf_path: Path, db_path: Path) -> bool:
    """Only schema 3 has the same trail/water layout but lacks public toilets."""

    if not db_path.exists():
        return False
    try:
        stat = pbf_path.stat()
        with sqlite3.connect(db_path) as connection:
            metadata = dict(connection.execute("SELECT key, value FROM metadata").fetchall())
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                ).fetchall()
            }
    except (OSError, sqlite3.Error):
        return False

    return (
        metadata
        == {
            "schema_version": str(LEGACY_SCHEMA_VERSION),
            "pbf_size": str(stat.st_size),
            "pbf_mtime_ns": str(stat.st_mtime_ns),
        }
        and {"metadata", "trail_ways", "drinking_water"}.issubset(tables)
        and "toilets" not in tables
    )


def report_progress(progress: Callable[[str], None] | None, message: str) -> None:
    if progress is not None:
        progress(message)


def is_relevant_tags(tags: dict[str, str]) -> bool:
    return (
        tags.get("highway") in TRAIL_HIGHWAYS
        or tags.get("route") in TRAIL_ROUTES
        or "sac_scale" in tags
        or tags.get("bridge") not in (None, "no")
    )


def is_confirmed_drinking_water(tags: dict[str, str]) -> bool:
    if tags.get("drinking_water") == "no" or tags.get("access") == "private":
        return False
    if (
        tags.get("disused:amenity") == "drinking_water"
        or tags.get("abandoned:amenity") == "drinking_water"
    ):
        return False
    return (
        tags.get("amenity") == "drinking_water"
        or tags.get("drinking_water") == "yes"
        or tags.get("fountain") == "drinking"
    )


def compact_drinking_water_tags(tags: dict[str, str]) -> dict[str, str]:
    return {
        key: tags[key]
        for key in ("name", "seasonal", "natural", "man_made", "amenity", "fountain")
        if key in tags
    }


def drinking_water_type(tags: dict[str, str]) -> str:
    if tags.get("natural") == "spring":
        return "spring"
    if tags.get("man_made") == "water_tap":
        return "tap"
    if tags.get("amenity") == "fountain" or "fountain" in tags:
        return "fountain"
    return "other"


def is_public_toilet(tags: dict[str, str]) -> bool:
    """Keep toilets that are public or have no explicit access restriction."""

    if tags.get("amenity") != "toilets":
        return False
    if tags.get("access") in {"private", "no", "customers"}:
        return False
    return tags.get("disused:amenity") != "toilets" and tags.get("abandoned:amenity") != "toilets"


def compact_toilet_tags(tags: dict[str, str]) -> dict[str, str]:
    return {key: tags[key] for key in ("name", "wheelchair", "fee", "opening_hours") if key in tags}


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


def row_to_drinking_water_place(row: tuple[str, int, float, float, str]) -> DrinkingWaterPlace:
    osm_type, osm_id, longitude, latitude, tags_json = row
    tags = json.loads(tags_json)
    return DrinkingWaterPlace(
        osm_type=osm_type,
        osm_id=osm_id,
        longitude=longitude,
        latitude=latitude,
        name=tags.get("name"),
        place_type=drinking_water_type(tags),
        seasonal=tags.get("seasonal") == "yes",
    )


def row_to_toilet_place(row: tuple[str, int, float, float, str]) -> ToiletPlace:
    osm_type, osm_id, longitude, latitude, tags_json = row
    tags = json.loads(tags_json)
    fee = tags.get("fee")
    return ToiletPlace(
        osm_type=osm_type,
        osm_id=osm_id,
        longitude=longitude,
        latitude=latitude,
        name=tags.get("name"),
        wheelchair=tags.get("wheelchair"),
        fee=True if fee == "yes" else False if fee == "no" else None,
    )


def deduplicate_drinking_water_places(
    places: Iterable[DrinkingWaterPlace],
) -> list[DrinkingWaterPlace]:
    """Collapse node/way duplicates without merging nearby, distinct taps."""

    unique: list[DrinkingWaterPlace] = []
    seen: set[tuple[float, float, str]] = set()
    for place in places:
        key = (
            round(place.longitude, 6),
            round(place.latitude, 6),
            (place.name or "").casefold(),
        )
        if key not in seen:
            seen.add(key)
            unique.append(place)
    return unique
