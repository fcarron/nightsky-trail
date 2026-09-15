from __future__ import annotations

import json

import pytest
from django.conf import settings
from rest_framework.test import APIClient

from planner.integrations.sac_huts import (
    enrich_sac_huts_from_portal,
    parse_coordinate,
    parse_sac_huts_wikitext,
    parse_sac_portal_hut_page,
)


def test_parse_sac_huts_wikitext_creates_compact_geojson() -> None:
    payload = parse_sac_huts_wikitext(
        """| '''[[Gelmerhütte]]'''<br />
{{Coordinate|NS=46.63128|EW=8.34271|elevation=2412|region=CH-BE}}&nbsp;
[[Datei:Logo Schweizer Alpen-Club.jpg|20px|verweis=https://www.sac-cas.ch/de/huetten-und-touren/tourenportal/2147000112/]]
| '''[[Dossenhütte|Dossenhütte SAC]]'''<br />
{{Coordinate|NS=46/39/18.4|EW=8/10/10.6|elevation=2663|region=CH-BE}}&nbsp;
[[Datei:Logo Schweizer Alpen-Club.jpg|20px|verweis=https://www.sac-cas.ch/de/huetten-und-touren/tourenportal/2147000082/]]
"""
    )

    assert payload == {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [8.169611111111111, 46.65511111111111],
                },
                "properties": {"name": "Dossenhütte SAC", "ele": 2663, "sac_id": "2147000082"},
            },
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [8.34271, 46.63128]},
                "properties": {"name": "Gelmerhütte", "ele": 2412, "sac_id": "2147000112"},
            },
        ],
    }


def test_parse_sac_huts_wikitext_rejects_duplicate_ids() -> None:
    entry = """| '''[[Gelmerhütte]]'''<br />
{{Coordinate|NS=46.63128|EW=8.34271|elevation=2412|region=CH-BE}}&nbsp;
[[Datei:Logo Schweizer Alpen-Club.jpg|20px|verweis=https://www.sac-cas.ch/de/huetten-und-touren/tourenportal/2147000112/]]
"""

    with pytest.raises(ValueError, match="Duplicate"):
        parse_sac_huts_wikitext(entry + entry)


def test_parse_coordinate_supports_decimal_and_dms() -> None:
    assert parse_coordinate("46.63128") == 46.63128
    assert parse_coordinate("46/39/18.4") == pytest.approx(46.6551111111)
    assert parse_coordinate("46/24/1/N") == pytest.approx(46.4002777778)


def test_sac_portal_page_overrides_stale_list_values() -> None:
    page = """
<div data-map-options='{"center":[2629000,1148490],"zoomLevel":9}'></div>
<h2 class="m-introduction__headline fs-h2">
  Mutthornhütte SAC
  <span class="m-introduction__subline fs-h2-subline">2788 m</span>
</h2>
"""
    official = parse_sac_portal_hut_page(page)
    payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [7.8, 46.4]},
                "properties": {"name": "Mutthornhütte", "ele": 201, "sac_id": "2147000187"},
            }
        ],
    }

    enriched = enrich_sac_huts_from_portal(payload, {"2147000187": page})

    assert official["name"] == "Mutthornhütte SAC"
    assert official["ele"] == 2788
    assert enriched["features"][0]["properties"]["ele"] == 2788
    longitude, latitude = enriched["features"][0]["geometry"]["coordinates"]
    assert 7 < longitude < 9
    assert 45 < latitude < 47


def test_versioned_sac_hut_dataset_contains_the_full_official_list() -> None:
    payload = json.loads(settings.SAC_HUTS_PATH.read_text(encoding="utf-8"))

    assert len(payload["features"]) == 152
    assert {
        "name": "Gelmerhütte SAC",
        "ele": 2412,
        "sac_id": "2147000112",
    } in [feature["properties"] for feature in payload["features"]]


def test_sac_huts_endpoint_serves_the_versioned_dataset() -> None:
    response = APIClient().get("/api/v1/sac-huts")

    assert response.status_code == 200
    assert len(response.json()["features"]) == 152
