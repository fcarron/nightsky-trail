#!/usr/bin/env python3
"""Update the local SAC hut map data without adding a runtime data dependency."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from planner.integrations.sac_huts import (  # noqa: E402
    SAC_HUTS_SOURCE_URL,
    SAC_TOUR_PORTAL_URL,
    enrich_sac_huts_from_portal,
    parse_sac_huts_wikitext,
    write_sac_huts_geojson,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        help="Path to saved source wikitext. Omit to download the current public list.",
    )
    parser.add_argument(
        "--skip-official",
        action="store_true",
        help="Use only the list data; intended for parser debugging when offline.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Maximum parallel SAC portal requests during an update (default: 4).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "data" / "sac_huts.geojson",
        help="Generated GeoJSON destination.",
    )
    arguments = parser.parse_args()

    if arguments.source:
        wikitext = Path(arguments.source).read_text(encoding="utf-8")
    else:
        request = Request(SAC_HUTS_SOURCE_URL, headers={"User-Agent": "nightsky-trail/0.1"})
        with urlopen(request, timeout=30) as response:  # noqa: S310 - fixed public source
            wikitext = response.read().decode("utf-8")

    payload = parse_sac_huts_wikitext(wikitext)
    if not arguments.skip_official:
        workers = arguments.workers
        if not 1 <= workers <= 4:
            parser.error("--workers must be between 1 and 4.")
        sac_ids = [feature["properties"]["sac_id"] for feature in payload["features"]]
        with ThreadPoolExecutor(max_workers=workers) as executor:
            pages = dict(executor.map(fetch_sac_portal_page, sac_ids))
        payload = enrich_sac_huts_from_portal(payload, pages)
    write_sac_huts_geojson(payload, arguments.output)
    print(f"Wrote {len(payload['features'])} SAC huts to {arguments.output}")


def fetch_sac_portal_page(sac_id: str) -> tuple[str, str]:
    request = Request(
        SAC_TOUR_PORTAL_URL.format(sac_id=sac_id),
        headers={"User-Agent": "nightsky-trail/0.1 (local data update)"},
    )
    with urlopen(request, timeout=30) as response:  # noqa: S310 - fixed official source
        return sac_id, response.read().decode("utf-8")


if __name__ == "__main__":
    main()
