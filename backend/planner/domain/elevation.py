from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass
from statistics import median

SMOOTHING_DISTANCE_METERS = 80
MIN_GRADIENT_DISTANCE_METERS = 100
GRADIENT_SAMPLE_MULTIPLIER = 4
ASCENT_DELTA_THRESHOLD_METERS = 1.0
HIKING_TIME_SMOOTHING_WINDOW_METERS = 40
HIKING_TIME_SEGMENT_LENGTH_METERS = 50
SWISS_HIKING_TIME_METHOD = "swiss_hiking_polynomial"
SWISS_HIKING_COEFFICIENTS = [
    14.271,
    3.6991,
    2.5922,
    -1.4384,
    0.32105,
    0.81542,
    -0.090261,
    -0.20757,
    0.010192,
    0.028588,
    -0.00057466,
    -0.0021842,
    0.000015176,
    0.000086894,
    -0.00000013584,
    -0.0000014026,
]


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
class HikingTime:
    duration_minutes: int
    method: str
    segment_length_m: int
    smoothing_window_m: int
    segment_count: int


@dataclass(frozen=True)
class ElevationProfile:
    distance_meters: float
    ascent_meters: float
    descent_meters: float
    min_elevation_meters: float
    max_elevation_meters: float
    points: list[ElevationPoint]
    hiking_time: HikingTime


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
    hiking_time = calculate_swiss_hiking_time(samples)

    return ElevationProfile(
        distance_meters=samples[-1].distance_meters,
        ascent_meters=ascent,
        descent_meters=descent,
        min_elevation_meters=min(sample.elevation_meters for sample in samples),
        max_elevation_meters=max(sample.elevation_meters for sample in samples),
        points=points,
        hiking_time=hiking_time,
    )


def smooth_elevations(samples: list[ElevationSample]) -> list[float]:
    sample_spacing = typical_sample_distance(samples)
    radius_meters = max(SMOOTHING_DISTANCE_METERS / 2, sample_spacing * 1.5)
    return moving_average_elevations(samples, radius_meters)


def smooth_elevations_for_window(
    samples: list[ElevationSample],
    smoothing_window_meters: float,
) -> list[float]:
    return moving_average_elevations(samples, smoothing_window_meters / 2)


def moving_average_elevations(
    samples: list[ElevationSample],
    radius_meters: float,
) -> list[float]:
    smoothed: list[float] = []
    left = 0
    right = 0
    elevation_sum = 0.0

    for sample in samples:
        maximum_distance = sample.distance_meters + radius_meters
        while right < len(samples) and samples[right].distance_meters <= maximum_distance:
            elevation_sum += samples[right].elevation_meters
            right += 1

        minimum_distance = sample.distance_meters - radius_meters
        while left < right and samples[left].distance_meters < minimum_distance:
            elevation_sum -= samples[left].elevation_meters
            left += 1

        smoothed.append(elevation_sum / (right - left))
    return smoothed


def calculate_ascent_descent(smoothed_elevations: list[float]) -> tuple[float, float]:
    if len(smoothed_elevations) < 2:
        return 0.0, 0.0

    ascent = 0.0
    descent = 0.0
    pending_delta = 0.0
    previous = smoothed_elevations[0]

    for current in smoothed_elevations[1:]:
        pending_delta += current - previous
        previous = current
        if abs(pending_delta) < ASCENT_DELTA_THRESHOLD_METERS:
            continue
        if pending_delta > 0:
            ascent += pending_delta
        else:
            descent += abs(pending_delta)
        pending_delta = 0.0
    return ascent, descent


def calculate_gradients(samples: list[ElevationSample], elevations: list[float]) -> list[float]:
    gradient_distance = max(
        MIN_GRADIENT_DISTANCE_METERS,
        typical_sample_distance(samples) * GRADIENT_SAMPLE_MULTIPLIER,
    )
    sample_distances = [sample.distance_meters for sample in samples]
    gradients: list[float] = []
    for sample in samples:
        before = find_distance_index(
            sample_distances,
            sample.distance_meters - gradient_distance / 2,
        )
        after = find_distance_index(
            sample_distances,
            sample.distance_meters + gradient_distance / 2,
        )
        distance_delta = samples[after].distance_meters - samples[before].distance_meters
        if distance_delta <= 0:
            gradients.append(0.0)
            continue

        elevation_delta = elevations[after] - elevations[before]
        gradients.append((elevation_delta / distance_delta) * 100)
    return gradients


def calculate_swiss_hiking_time(
    samples: list[ElevationSample],
    *,
    segment_length_meters: int = HIKING_TIME_SEGMENT_LENGTH_METERS,
    smoothing_window_meters: int = HIKING_TIME_SMOOTHING_WINDOW_METERS,
) -> HikingTime:
    monotonic_samples = remove_duplicate_distance_samples(samples)
    if len(monotonic_samples) < 2:
        return HikingTime(
            duration_minutes=0,
            method=SWISS_HIKING_TIME_METHOD,
            segment_length_m=segment_length_meters,
            smoothing_window_m=smoothing_window_meters,
            segment_count=0,
        )

    smoothed = smooth_elevations_for_window(monotonic_samples, smoothing_window_meters)
    total_distance = monotonic_samples[-1].distance_meters
    segment_boundaries = fixed_segment_boundaries(total_distance, segment_length_meters)
    sample_distances = [sample.distance_meters for sample in monotonic_samples]
    total_minutes = 0.0
    segment_count = 0
    for start_distance, end_distance in zip(
        segment_boundaries,
        segment_boundaries[1:],
        strict=False,
    ):
        horizontal_distance = end_distance - start_distance
        if horizontal_distance <= 0:
            continue

        start_elevation = interpolate_elevation_at_distance(
            monotonic_samples,
            smoothed,
            start_distance,
            sample_distances,
        )
        end_elevation = interpolate_elevation_at_distance(
            monotonic_samples,
            smoothed,
            end_distance,
            sample_distances,
        )
        slope_percent = 100 * (end_elevation - start_elevation) / horizontal_distance
        minutes_per_km = swiss_hiking_minutes_per_km(slope_percent)
        total_minutes += (horizontal_distance / 1000) * minutes_per_km
        segment_count += 1

    return HikingTime(
        duration_minutes=round(total_minutes),
        method=SWISS_HIKING_TIME_METHOD,
        segment_length_m=segment_length_meters,
        smoothing_window_m=smoothing_window_meters,
        segment_count=segment_count,
    )


def swiss_hiking_minutes_per_km(slope_percent: float) -> float:
    s = slope_percent / 10
    if -4 < s < 4:
        return evaluate_swiss_hiking_polynomial(s)
    if s >= 4:
        return 17 * s
    return -9 * s


def evaluate_swiss_hiking_polynomial(s: float) -> float:
    result = 0.0
    for coefficient in reversed(SWISS_HIKING_COEFFICIENTS):
        result = result * s + coefficient
    return result


def remove_duplicate_distance_samples(samples: list[ElevationSample]) -> list[ElevationSample]:
    monotonic_samples: list[ElevationSample] = []
    for sample in samples:
        if monotonic_samples and sample.distance_meters <= monotonic_samples[-1].distance_meters:
            continue
        monotonic_samples.append(sample)
    return monotonic_samples


def fixed_segment_boundaries(
    total_distance_meters: float,
    segment_length_meters: int,
) -> list[float]:
    if total_distance_meters <= 0:
        return [0.0]

    boundaries = [0.0]
    next_distance = float(segment_length_meters)
    while next_distance < total_distance_meters:
        boundaries.append(next_distance)
        next_distance += segment_length_meters
    boundaries.append(total_distance_meters)
    return boundaries


def interpolate_elevation_at_distance(
    samples: list[ElevationSample],
    elevations: list[float],
    distance_meters: float,
    sample_distances: list[float] | None = None,
) -> float:
    if distance_meters <= samples[0].distance_meters:
        return elevations[0]
    if distance_meters >= samples[-1].distance_meters:
        return elevations[-1]

    distances = sample_distances or [sample.distance_meters for sample in samples]
    index = bisect_left(distances, distance_meters)
    previous = samples[index - 1]
    current = samples[index]
    distance_delta = current.distance_meters - previous.distance_meters
    if distance_delta <= 0:
        return elevations[index]

    ratio = (distance_meters - previous.distance_meters) / distance_delta
    return elevations[index - 1] + (elevations[index] - elevations[index - 1]) * ratio


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
    return find_distance_index(
        [sample.distance_meters for sample in samples],
        distance_meters,
    )


def find_distance_index(distances: list[float], distance_meters: float) -> int:
    index = bisect_left(distances, distance_meters)
    if index <= 0:
        return 0
    if index >= len(distances):
        return len(distances) - 1
    if distance_meters - distances[index - 1] <= distances[index] - distance_meters:
        return index - 1
    return index
