from __future__ import annotations

import pytest

from planner.domain.coordinates import lv95_to_wgs84, wgs84_to_lv95


def test_wgs84_lv95_round_trip() -> None:
    longitude = 7.4474
    latitude = 46.948

    easting, northing = wgs84_to_lv95(longitude, latitude)
    round_trip_longitude, round_trip_latitude = lv95_to_wgs84(easting, northing)

    assert 2_600_000 < easting < 2_610_000
    assert 1_195_000 < northing < 1_205_000
    assert round_trip_longitude == pytest.approx(longitude, abs=0.000001)
    assert round_trip_latitude == pytest.approx(latitude, abs=0.000001)
