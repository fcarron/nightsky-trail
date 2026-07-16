from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse
from zipfile import ZipFile

import httpx
from shapely import wkb
from shapely.geometry import LineString

from planner.domain.trail_matching import OfficialTrail, normalize_swisstopo_category

DEFAULT_SWISSTOPO_TRAILS_URL = "https://data.geo.admin.ch/ch.swisstopo.swisstlm3d-wanderwege/swisstlm3d-wanderwege/swisstlm3d-wanderwege_2056_5728.gpkg.zip"
GPKG_HEADER_PREFIX = b"GP"
ENVELOPE_LENGTHS = {
    0: 0,
    1: 32,
    2: 48,
    3: 48,
    4: 64,
}


class SwisstopoTrailsUnavailableError(RuntimeError):
    code = "swisstopo_trails_unavailable"

    def __init__(self, message: str, details: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


@dataclass(frozen=True)
class SwisstopoTrailClient:
    gpkg_path: Path
    zip_path: Path
    download_url: str = DEFAULT_SWISSTOPO_TRAILS_URL
    timeout_seconds: float = 60.0

    def trails(self, bbox_lv95: tuple[float, float, float, float]) -> list[OfficialTrail]:
        ensure_geopackage(self.gpkg_path, self.zip_path, self.download_url, self.timeout_seconds)
        min_x, min_y, max_x, max_y = bbox_lv95
        try:
            with sqlite3.connect(self.gpkg_path) as connection:
                rows = connection.execute(
                    """
                    SELECT s.id, s.uuid, s.wanderwege, s.geom
                    FROM tlm_strassen_strasse s
                    JOIN rtree_tlm_strassen_strasse_geom r ON r.id = s.id
                    WHERE s.wanderwege IS NOT NULL
                      AND r.maxx >= ?
                      AND r.minx <= ?
                      AND r.maxy >= ?
                      AND r.miny <= ?
                    """,
                    (min_x, max_x, min_y, max_y),
                ).fetchall()
        except sqlite3.Error as error:
            raise SwisstopoTrailsUnavailableError(
                "The local swisstopo hiking trail dataset could not be read."
            ) from error

        trails: list[OfficialTrail] = []
        for row in rows:
            trail = row_to_official_trail(row)
            if trail is not None:
                trails.append(trail)
        return trails


def ensure_geopackage(
    gpkg_path: Path,
    zip_path: Path,
    download_url: str,
    timeout_seconds: float,
) -> None:
    if gpkg_path.exists():
        return

    gpkg_path.parent.mkdir(parents=True, exist_ok=True)
    if not zip_path.exists():
        download_file(download_url, zip_path, timeout_seconds)
    extract_geopackage(zip_path, gpkg_path)


def download_file(url: str, target_path: Path, timeout_seconds: float) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with httpx.stream("GET", url, timeout=timeout_seconds, follow_redirects=True) as response:
            response.raise_for_status()
            temporary_path = target_path.with_suffix(target_path.suffix + ".tmp")
            with temporary_path.open("wb") as target:
                for chunk in response.iter_bytes():
                    target.write(chunk)
            temporary_path.replace(target_path)
    except httpx.HTTPError as error:
        raise SwisstopoTrailsUnavailableError(
            "The official swisstopo hiking trail dataset could not be downloaded.",
            {"url": urlparse(url).netloc},
        ) from error


def extract_geopackage(zip_path: Path, gpkg_path: Path) -> None:
    try:
        with ZipFile(zip_path) as archive:
            gpkg_member = next(
                (name for name in archive.namelist() if name.lower().endswith(".gpkg")),
                None,
            )
            if gpkg_member is None:
                raise SwisstopoTrailsUnavailableError(
                    "The official swisstopo hiking trail archive contains no GeoPackage."
                )
            temporary_path = gpkg_path.with_suffix(gpkg_path.suffix + ".tmp")
            with temporary_path.open("wb") as target:
                target.write(archive.read(gpkg_member))
            temporary_path.replace(gpkg_path)
    except OSError as error:
        raise SwisstopoTrailsUnavailableError(
            "The official swisstopo hiking trail archive could not be extracted."
        ) from error


def row_to_official_trail(row: tuple[int, str | None, object, bytes]) -> OfficialTrail | None:
    feature_id, uuid, category_value, geometry_blob = row
    geometry = load_geopackage_linestring(geometry_blob)
    if geometry is None:
        return None
    return OfficialTrail(
        id=uuid or str(feature_id),
        category=normalize_swisstopo_category(category_value),
        geometry=geometry,
    )


def load_geopackage_linestring(blob: bytes) -> LineString | None:
    if not blob.startswith(GPKG_HEADER_PREFIX) or len(blob) < 8:
        return None
    flags = blob[3]
    envelope_code = (flags >> 1) & 0b111
    header_length = 8 + ENVELOPE_LENGTHS.get(envelope_code, 0)
    geometry = wkb.loads(blob[header_length:])
    if isinstance(geometry, LineString):
        return geometry
    return None
