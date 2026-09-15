"""Normalize the public SAC hut list into the small map dataset used by the API."""

from __future__ import annotations

import html
import json
import re
from pathlib import Path
from typing import Any

from pyproj import Transformer

SAC_HUTS_SOURCE_URL = (
    "https://de.wikipedia.org/w/index.php?title=Liste_der_H%C3%BCtten_des_"
    "Schweizer_Alpen-Clubs&action=raw"
)
SAC_TOUR_PORTAL_URL = "https://www.sac-cas.ch/de/huetten-und-touren/sac-tourenportal/{sac_id}/"

_HUT_ENTRY = re.compile(
    r"^\|\s*'''(?P<name>[^\n]+?)'''[^\n]*\n"
    r"(?P<coordinate>\{\{Coordinate\|[^\n]+\}\})[^\n]*?(?:\n)?"
    r"\[\[Datei:Logo Schweizer Alpen-Club\.jpg[^\n]*?"
    r"tourenportal/(?P<sac_id>2147\d+)/",
    re.IGNORECASE | re.MULTILINE,
)
_WIKI_LINK = re.compile(r"\[\[(?P<target>[^\]|]+)(?:\|(?P<label>[^\]]+))?\]\]")
_SAC_MAP_OPTIONS = re.compile(r"data-map-options='(?P<options>\{[^']+\})'")
_SAC_HEADLINE = re.compile(
    r'<h2 class="m-introduction__headline[^>]*>\s*(?P<name>.*?)\s*'
    r'<span class="m-introduction__subline[^>]*>(?P<elevation>[\d’\']+)\s*m</span>',
    re.DOTALL,
)
_LV95_TO_WGS84 = Transformer.from_crs("EPSG:2056", "EPSG:4326", always_xy=True)


def parse_sac_huts_wikitext(wikitext: str) -> dict[str, Any]:
    """Return normalized GeoJSON from the maintained SAC hut list wikitext.

    The source contains direct SAC tour portal links and coordinates for every
    entry. It is deliberately parsed outside the running web application;
    the API serves the generated local file only.
    """

    features: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for match in _HUT_ENTRY.finditer(wikitext):
        coordinate_values = coordinate_parameters(match.group("coordinate"))
        if {"NS", "EW", "elevation"} - coordinate_values.keys():
            continue

        sac_id = match.group("sac_id")
        if sac_id in seen_ids:
            raise ValueError(f"Duplicate SAC tour portal id: {sac_id}")
        seen_ids.add(sac_id)

        name = normalize_wiki_name(match.group("name"))
        latitude = parse_coordinate(coordinate_values["NS"])
        longitude = parse_coordinate(coordinate_values["EW"])
        elevation = int(coordinate_values["elevation"])
        if not name or not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            raise ValueError(f"Invalid SAC hut entry: {sac_id}")

        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [longitude, latitude]},
                "properties": {"name": name, "ele": elevation, "sac_id": sac_id},
            }
        )

    if not features:
        raise ValueError("No SAC hut entries found in the source.")

    features.sort(key=lambda feature: str(feature["properties"]["name"]).casefold())
    return {"type": "FeatureCollection", "features": features}


def normalize_wiki_name(value: str) -> str:
    """Reduce a bolded MediaWiki title to its visible hut name."""

    value = _WIKI_LINK.sub(lambda match: match.group("label") or match.group("target"), value)
    value = re.sub(r"\{\{[^{}]+\}\}", "", value)
    value = re.sub(r"<[^>]+>", "", value)
    return " ".join(value.replace("&nbsp;", " ").split())


def coordinate_parameters(coordinate_markup: str) -> dict[str, str]:
    """Read only the exact ``Coordinate`` template parameter names."""

    parameters: dict[str, str] = {}
    for part in coordinate_markup.removeprefix("{{Coordinate|").removesuffix("}}").split("|"):
        key, separator, value = part.partition("=")
        if separator and key.strip() in {"NS", "EW", "elevation"}:
            parameters[key.strip()] = value.strip()
    return parameters


def parse_coordinate(value: str) -> float:
    """Parse decimal or degree/minute/second coordinates from MediaWiki."""

    normalized = value.strip().upper()
    direction = normalized[-1:] if normalized[-1:] in {"N", "S", "E", "W"} else ""
    if direction:
        normalized = normalized[:-1].rstrip("/")
    parts = [float(part) for part in normalized.split("/")]
    sign = -1 if direction in {"S", "W"} else 1
    if len(parts) == 1:
        return sign * parts[0]
    if len(parts) == 2:
        return sign * (parts[0] + parts[1] / 60)
    if len(parts) == 3:
        return sign * (parts[0] + parts[1] / 60 + parts[2] / 3600)
    raise ValueError(f"Unsupported coordinate: {value}")


def parse_sac_portal_hut_page(page_html: str) -> dict[str, object]:
    """Extract the current name, elevation and map centre from a SAC hut page."""

    map_match = _SAC_MAP_OPTIONS.search(page_html)
    headline_match = _SAC_HEADLINE.search(page_html)
    if map_match is None or headline_match is None:
        raise ValueError("SAC hut page is missing map or headline data.")

    map_options = json.loads(html.unescape(map_match.group("options")))
    center = map_options.get("center")
    if (
        not isinstance(center, list)
        or len(center) != 2
        or not all(isinstance(value, int | float) for value in center)
    ):
        raise ValueError("SAC hut page has an invalid map centre.")
    longitude, latitude = _LV95_TO_WGS84.transform(center[0], center[1])
    elevation = int(re.sub(r"[^0-9]", "", headline_match.group("elevation")))
    name = " ".join(html.unescape(re.sub(r"<[^>]+>", "", headline_match.group("name"))).split())
    if not name or not (5 <= longitude <= 11 and 45 <= latitude <= 48):
        raise ValueError("SAC hut page has invalid hut data.")
    return {"name": name, "ele": elevation, "coordinates": [longitude, latitude]}


def enrich_sac_huts_from_portal(
    payload: dict[str, Any], portal_pages: dict[str, str]
) -> dict[str, Any]:
    """Replace potentially stale list values with the current SAC portal values."""

    enriched_features: list[dict[str, Any]] = []
    for feature in payload["features"]:
        sac_id = feature["properties"]["sac_id"]
        page_html = portal_pages.get(sac_id)
        if page_html is None:
            raise ValueError(f"Missing SAC portal page: {sac_id}")
        official = parse_sac_portal_hut_page(page_html)
        enriched_features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": official["coordinates"]},
                "properties": {
                    "name": official["name"],
                    "ele": official["ele"],
                    "sac_id": sac_id,
                },
            }
        )
    return {"type": "FeatureCollection", "features": enriched_features}


def write_sac_huts_geojson(payload: dict[str, Any], destination: Path) -> None:
    """Write compact deterministic GeoJSON for the frontend map layer."""

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
