from __future__ import annotations

from functools import lru_cache

from pyproj import Transformer


@lru_cache(maxsize=1)
def wgs84_to_lv95_transformer() -> Transformer:
    return Transformer.from_crs("EPSG:4326", "EPSG:2056", always_xy=True)


@lru_cache(maxsize=1)
def lv95_to_wgs84_transformer() -> Transformer:
    return Transformer.from_crs("EPSG:2056", "EPSG:4326", always_xy=True)


def wgs84_to_lv95(longitude: float, latitude: float) -> tuple[float, float]:
    easting, northing = wgs84_to_lv95_transformer().transform(longitude, latitude)
    return float(easting), float(northing)


def lv95_to_wgs84(easting: float, northing: float) -> tuple[float, float]:
    longitude, latitude = lv95_to_wgs84_transformer().transform(easting, northing)
    return float(longitude), float(latitude)
