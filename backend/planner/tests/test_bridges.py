from __future__ import annotations

from planner.integrations.overpass import OsmWay
from planner.services.bridges import bridge_ranges_for_geometry


def test_bridge_ranges_match_an_imported_track_to_an_osm_bridge() -> None:
    ranges = bridge_ranges_for_geometry(
        [[7.4, 46.9], [7.402, 46.9]],
        [
            OsmWay(
                id=1,
                coordinates=[[7.4008, 46.9], [7.4012, 46.9]],
                tags={"bridge": "yes", "highway": "footway"},
            )
        ],
    )

    assert len(ranges) == 1
    assert ranges[0][0] < 70
    assert ranges[0][1] > 90


def test_bridge_ranges_ignore_nearby_non_bridge_ways() -> None:
    assert (
        bridge_ranges_for_geometry(
            [[7.4, 46.9], [7.402, 46.9]],
            [
                OsmWay(
                    id=1,
                    coordinates=[[7.4008, 46.9], [7.4012, 46.9]],
                    tags={"highway": "footway"},
                )
            ],
        )
        == []
    )
