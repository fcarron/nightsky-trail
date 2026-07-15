from __future__ import annotations

import pytest

from planner.domain.elevation import (
    ElevationSample,
    ElevationValidationError,
    build_elevation_profile,
)


def test_build_elevation_profile_smooths_and_calculates_totals() -> None:
    profile = build_elevation_profile(
        [
            ElevationSample(0, 500, 7.4, 46.9),
            ElevationSample(25, 510, 7.41, 46.91),
            ElevationSample(50, 530, 7.42, 46.92),
            ElevationSample(75, 520, 7.43, 46.93),
            ElevationSample(100, 540, 7.44, 46.94),
        ]
    )

    assert profile.distance_meters == 100
    assert profile.min_elevation_meters == 500
    assert profile.max_elevation_meters == 540
    assert profile.points[0].smoothed_elevation_meters == pytest.approx(505)
    assert profile.ascent_meters == pytest.approx(25)
    assert profile.descent_meters == pytest.approx(0.0)
    assert profile.points[2].gradient_percent == pytest.approx(25.0)


def test_build_elevation_profile_rejects_too_few_samples() -> None:
    with pytest.raises(ElevationValidationError) as error:
        build_elevation_profile([ElevationSample(0, 500, 7.4, 46.9)])

    assert error.value.code == "too_few_elevation_samples"
