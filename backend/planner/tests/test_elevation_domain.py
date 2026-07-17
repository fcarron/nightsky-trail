from __future__ import annotations

import pytest

from planner.domain.elevation import (
    ElevationSample,
    ElevationValidationError,
    build_elevation_profile,
    calculate_swiss_hiking_time,
    evaluate_swiss_hiking_polynomial,
    swiss_hiking_minutes_per_km,
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


def test_swiss_hiking_time_flat_route_uses_flat_polynomial_pace() -> None:
    hiking_time = calculate_swiss_hiking_time(samples_for_slope(1000, 0, spacing=25))

    assert swiss_hiking_minutes_per_km(0) == pytest.approx(14.271)
    assert hiking_time.duration_minutes == 14
    assert hiking_time.method == "swiss_hiking_polynomial"
    assert hiking_time.segment_length_m == 50
    assert hiking_time.smoothing_window_m == 40
    assert hiking_time.segment_count == 20


def test_swiss_hiking_time_uses_slope_divided_by_ten_for_polynomial_input() -> None:
    assert swiss_hiking_minutes_per_km(10) == pytest.approx(
        evaluate_swiss_hiking_polynomial(1)
    )
    assert swiss_hiking_minutes_per_km(10) != pytest.approx(
        evaluate_swiss_hiking_polynomial(10)
    )


def test_swiss_hiking_time_constant_positive_and_negative_ten_percent() -> None:
    positive = calculate_swiss_hiking_time(samples_for_slope(1000, 10, spacing=25))
    negative = calculate_swiss_hiking_time(samples_for_slope(1000, -10, spacing=25))

    assert positive.duration_minutes == round(evaluate_swiss_hiking_polynomial(1))
    assert negative.duration_minutes == round(evaluate_swiss_hiking_polynomial(-1))


def test_swiss_hiking_time_uses_linear_rules_at_forty_percent_boundaries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def explode(_s: float) -> float:
        raise AssertionError("Polynomial must not be evaluated at +/-40%.")

    monkeypatch.setattr("planner.domain.elevation.evaluate_swiss_hiking_polynomial", explode)

    assert swiss_hiking_minutes_per_km(40) == pytest.approx(68)
    assert swiss_hiking_minutes_per_km(-40) == pytest.approx(36)


def test_swiss_hiking_time_uses_linear_rules_outside_forty_percent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def explode(_s: float) -> float:
        raise AssertionError("Polynomial must not be evaluated outside +/-40%.")

    monkeypatch.setattr("planner.domain.elevation.evaluate_swiss_hiking_polynomial", explode)

    assert swiss_hiking_minutes_per_km(50) == pytest.approx(85)
    assert swiss_hiking_minutes_per_km(-50) == pytest.approx(45)


def test_swiss_hiking_time_smooths_noisy_elevation_data() -> None:
    noisy = [
        ElevationSample(distance, 500 + (3 if index % 2 else -3), 7.4, 46.9)
        for index, distance in enumerate(range(0, 1001, 10))
    ]

    hiking_time = calculate_swiss_hiking_time(noisy)

    assert hiking_time.duration_minutes == pytest.approx(14, abs=1)


def test_swiss_hiking_time_includes_final_partial_segment() -> None:
    hiking_time = calculate_swiss_hiking_time(samples_for_slope(125, 0, spacing=25))

    assert hiking_time.segment_count == 3
    assert hiking_time.duration_minutes == round(0.125 * 14.271)


def test_swiss_hiking_time_ignores_duplicate_zero_distance_points() -> None:
    samples = [
        ElevationSample(0, 500, 7.4, 46.9),
        ElevationSample(0, 900, 7.4, 46.9),
        ElevationSample(50, 500, 7.41, 46.91),
        ElevationSample(100, 500, 7.42, 46.92),
    ]

    hiking_time = calculate_swiss_hiking_time(samples)

    assert hiking_time.segment_count == 2
    assert hiking_time.duration_minutes == round(0.1 * 14.271)


def test_swiss_hiking_time_rounds_only_final_result() -> None:
    hiking_time = calculate_swiss_hiking_time(samples_for_slope(300, 0, spacing=25))

    assert hiking_time.segment_count == 6
    assert hiking_time.duration_minutes == round(0.3 * 14.271)
    assert hiking_time.duration_minutes != 6


def test_swiss_hiking_time_is_independent_from_original_sample_density() -> None:
    sparse = calculate_swiss_hiking_time(samples_for_slope(1000, 10, spacing=25))
    dense = calculate_swiss_hiking_time(samples_for_slope(1000, 10, spacing=10))

    assert sparse.segment_count == dense.segment_count == 20
    assert sparse.duration_minutes == dense.duration_minutes


def samples_for_slope(
    distance_meters: int,
    slope_percent: float,
    *,
    spacing: int,
) -> list[ElevationSample]:
    samples = []
    distance = 0
    while distance < distance_meters:
        samples.append(sample_at_distance(distance, slope_percent))
        distance += spacing
    samples.append(sample_at_distance(distance_meters, slope_percent))
    return samples


def sample_at_distance(distance_meters: int, slope_percent: float) -> ElevationSample:
    return ElevationSample(
        distance_meters,
        500 + (distance_meters * slope_percent / 100),
        7.4,
        46.9,
    )
