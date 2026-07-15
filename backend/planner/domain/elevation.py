from __future__ import annotations

from dataclasses import dataclass
from statistics import median

SMOOTHING_DISTANCE_METERS = 80
MIN_GRADIENT_DISTANCE_METERS = 100
GRADIENT_SAMPLE_MULTIPLIER = 4
ASCENT_DELTA_THRESHOLD_METERS = 1.0


@dataclass(frozen=True)
class ElevationSample:
    distance_meters: float
    elevation_meters: float
    longitude: float
    latitude: float


@dataclass(frozen=True)
class ElevationPoint:
    distance_meters: float
    elevation_meters: float
    smoothed_elevation_meters: float
    gradient_percent: float
    longitude: float
    latitude: float


@dataclass(frozen=True)
class ElevationProfile:
    distance_meters: float
    ascent_meters: float
    descent_meters: float
    min_elevation_meters: float
    max_elevation_meters: float
    points: list[ElevationPoint]


class ElevationValidationError(ValueError):
    def __init__(self, code: str, message: str, details: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


def build_elevation_profile(samples: list[ElevationSample]) -> ElevationProfile:
    if len(samples) < 2:
        raise ElevationValidationError(
            "too_few_elevation_samples",
            "At least two elevation samples are required.",
        )

    smoothed = smooth_elevations(samples)
    gradients = calculate_gradients(samples, smoothed)
    points = [
        ElevationPoint(
            distance_meters=sample.distance_meters,
            elevation_meters=sample.elevation_meters,
            smoothed_elevation_meters=smoothed[index],
            gradient_percent=gradients[index],
            longitude=sample.longitude,
            latitude=sample.latitude,
        )
        for index, sample in enumerate(samples)
    ]
    ascent, descent = calculate_ascent_descent(smoothed)

    return ElevationProfile(
        distance_meters=samples[-1].distance_meters,
        ascent_meters=ascent,
        descent_meters=descent,
        min_elevation_meters=min(sample.elevation_meters for sample in samples),
        max_elevation_meters=max(sample.elevation_meters for sample in samples),
        points=points,
    )


def smooth_elevations(samples: list[ElevationSample]) -> list[float]:
    sample_spacing = typical_sample_distance(samples)
    radius_meters = max(SMOOTHING_DISTANCE_METERS / 2, sample_spacing * 1.5)
    smoothed: list[float] = []
    for sample in samples:
        window = [
            candidate.elevation_meters
            for candidate in samples
            if abs(candidate.distance_meters - sample.distance_meters) <= radius_meters
        ]
        smoothed.append(sum(window) / len(window))
    return smoothed


def calculate_ascent_descent(smoothed_elevations: list[float]) -> tuple[float, float]:
    ascent = 0.0
    descent = 0.0
    for previous, current in zip(smoothed_elevations, smoothed_elevations[1:], strict=False):
        delta = current - previous
        if abs(delta) < ASCENT_DELTA_THRESHOLD_METERS:
            continue
        if delta > 0:
            ascent += delta
        else:
            descent += abs(delta)
    return ascent, descent


def calculate_gradients(samples: list[ElevationSample], elevations: list[float]) -> list[float]:
    gradient_distance = max(
        MIN_GRADIENT_DISTANCE_METERS,
        typical_sample_distance(samples) * GRADIENT_SAMPLE_MULTIPLIER,
    )
    gradients: list[float] = []
    for sample in samples:
        before = find_sample_at_distance(
            samples,
            sample.distance_meters - gradient_distance / 2,
        )
        after = find_sample_at_distance(
            samples,
            sample.distance_meters + gradient_distance / 2,
        )
        distance_delta = samples[after].distance_meters - samples[before].distance_meters
        if distance_delta <= 0:
            gradients.append(0.0)
            continue

        elevation_delta = elevations[after] - elevations[before]
        gradients.append((elevation_delta / distance_delta) * 100)
    return gradients


def typical_sample_distance(samples: list[ElevationSample]) -> float:
    distances = [
        current.distance_meters - previous.distance_meters
        for previous, current in zip(samples, samples[1:], strict=False)
        if current.distance_meters > previous.distance_meters
    ]
    if not distances:
        return MIN_GRADIENT_DISTANCE_METERS
    return float(median(distances))


def find_sample_at_distance(samples: list[ElevationSample], distance_meters: float) -> int:
    return min(
        range(len(samples)),
        key=lambda index: abs(samples[index].distance_meters - distance_meters),
    )
