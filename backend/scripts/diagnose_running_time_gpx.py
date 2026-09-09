"""Temporary GPX diagnostic for the personal running-time estimate.

Run inside the backend container, for example:
    uv run python scripts/diagnose_running_time_gpx.py \
      "../Aletsch HM_gezeichnet.gpx"

The CSV contains one row per 50 m running-time segment. The default model
matches the current frontend: it uses the profile's ``smoothedElevationMeters``
values returned by the backend. A 40 m comparison is printed as well because
the Swiss hiking-time integration smooths separately at that window.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
import xml.etree.ElementTree as element_tree
from collections import defaultdict
from dataclasses import dataclass
from math import asin, ceil, cos, radians, sin, sqrt
from pathlib import Path

import django
from django.conf import settings

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from planner.domain.elevation import (  # noqa: E402
    HIKING_TIME_SMOOTHING_WINDOW_METERS,
    ElevationProfile,
    ElevationSample,
    fixed_segment_boundaries,
    interpolate_elevation_at_distance,
    smooth_elevations_for_window,
    swiss_hiking_minutes_per_km,
)
from planner.integrations.swisstopo import SwisstopoClient  # noqa: E402
from planner.services.elevation import get_elevation_profile  # noqa: E402

FLAT_RUNNING_PACE_MIN_PER_KM = 5.0
FLAT_HIKING_PACE_MIN_PER_KM = 14.271
FLAT_RUNNING_COST = 3.6
ELEVATION_TARGET_SPACING_METERS = 25.0
ELEVATION_MAX_POINTS = 6_000
APPROXIMATELY_FLAT_SLOPE_PERCENT = 0.5
BUCKETS = (
    "<= -20%",
    "-20 .. -15%",
    "-15 .. -10%",
    "-10 .. -5%",
    "-5 .. 0%",
    "0 .. 5%",
    "5 .. 10%",
    "10 .. 15%",
    "15 .. 20%",
    "> 20%",
)


@dataclass(frozen=True)
class Segment:
    start_distance_meters: float
    end_distance_meters: float
    start_elevation_meters: float
    end_elevation_meters: float
    slope_percent: float
    running_pace_min_per_km: float
    running_time_seconds: float
    minetti_cost: float | None

    @property
    def distance_meters(self) -> float:
        return self.end_distance_meters - self.start_distance_meters

    @property
    def ascent_meters(self) -> float:
        return max(0.0, self.end_elevation_meters - self.start_elevation_meters)

    @property
    def descent_meters(self) -> float:
        return max(0.0, self.start_elevation_meters - self.end_elevation_meters)

    @property
    def model_branch(self) -> str:
        return "minetti_uphill" if self.slope_percent > 0 else "swiss_downhill"

    @property
    def terrain_multiplier(self) -> float:
        return self.running_pace_min_per_km / FLAT_RUNNING_PACE_MIN_PER_KM


@dataclass
class BucketTotals:
    distance_meters: float = 0.0
    ascent_meters: float = 0.0
    descent_meters: float = 0.0
    running_time_seconds: float = 0.0

    def add(self, segment: Segment) -> None:
        self.distance_meters += segment.distance_meters
        self.ascent_meters += segment.ascent_meters
        self.descent_meters += segment.descent_meters
        self.running_time_seconds += segment.running_time_seconds


def main() -> None:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    django.setup()
    arguments = parse_arguments()
    coordinates = resample_geometry_for_elevation(parse_gpx_track(arguments.gpx))
    profile = get_elevation_profile(
        SwisstopoClient(
            settings.SWISSTOPO_BASE_URL,
            timeout_seconds=settings.SWISSTOPO_TIMEOUT_SECONDS,
        ),
        coordinates,
        cache_timeout_seconds=0,
    )

    frontend_samples = [
        ElevationSample(
            distance_meters=point.distance_meters,
            elevation_meters=point.smoothed_elevation_meters,
            longitude=point.longitude,
            latitude=point.latitude,
        )
        for point in profile.points
    ]
    frontend_segments = build_segments(frontend_samples)
    flat_downhill_segments = build_segments(frontend_samples, downhill_mode="flat")
    capped_downhill_segments = build_segments(frontend_samples, downhill_mode="capped")
    forty_meter_segments = build_segments(
        raw_samples(profile),
        smoothing_window_meters=HIKING_TIME_SMOOTHING_WINDOW_METERS,
    )

    write_csv(arguments.csv, frontend_segments)
    print_header(profile.distance_meters, len(coordinates), arguments.csv)
    print_downhill_scenarios(
        {
            "A  current hybrid (Swiss downhill)": frontend_segments,
            "B  Minetti uphill, flat downhill": flat_downhill_segments,
            "C  Minetti uphill, capped downhill": capped_downhill_segments,
        }
    )
    print_overall(
        "Current frontend model", frontend_segments, profile.ascent_meters, profile.descent_meters
    )
    print_buckets(frontend_segments)
    print_time_contribution(frontend_segments)
    print_overall(
        "40 m smoothing comparison",
        forty_meter_segments,
        sum(segment.ascent_meters for segment in forty_meter_segments),
        sum(segment.descent_meters for segment in forty_meter_segments),
    )


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gpx", type=Path, help="Local GPX track to analyse")
    parser.add_argument(
        "--csv",
        type=Path,
        default=Path("/tmp/aletsch-running-time-debug.csv"),
        help="Path for per-segment diagnostics CSV",
    )
    return parser.parse_args()


def parse_gpx_track(path: Path) -> list[tuple[float, float]]:
    root = element_tree.parse(path).getroot()
    coordinates: list[tuple[float, float]] = []
    for element in root.iter():
        if element.tag.rsplit("}", maxsplit=1)[-1] != "trkpt":
            continue
        latitude = float(element.attrib["lat"])
        longitude = float(element.attrib["lon"])
        coordinates.append((longitude, latitude))
    if len(coordinates) < 2:
        raise ValueError("The GPX file must contain at least two track points.")
    return coordinates


def resample_geometry_for_elevation(
    geometry: list[tuple[float, float]],
) -> list[list[float]]:
    if len(geometry) <= 2:
        return [list(point) for point in geometry]

    distances = [0.0]
    for previous, current in zip(geometry, geometry[1:], strict=False):
        distances.append(distances[-1] + haversine_distance_meters(previous, current))
    total_distance = distances[-1]
    if total_distance <= 0:
        return [list(geometry[0]), list(geometry[-1])]

    point_count = min(
        ELEVATION_MAX_POINTS,
        max(2, ceil(total_distance / ELEVATION_TARGET_SPACING_METERS) + 1),
    )
    spacing = total_distance / (point_count - 1)
    sampled: list[list[float]] = []
    segment_index = 1
    for index in range(point_count):
        target_distance = total_distance if index == point_count - 1 else index * spacing
        while segment_index < len(distances) - 1 and distances[segment_index] < target_distance:
            segment_index += 1
        before = geometry[segment_index - 1]
        after = geometry[segment_index]
        before_distance = distances[segment_index - 1]
        after_distance = distances[segment_index]
        ratio = (
            (target_distance - before_distance) / (after_distance - before_distance)
            if after_distance > before_distance
            else 0.0
        )
        sampled.append(
            [
                before[0] + (after[0] - before[0]) * ratio,
                before[1] + (after[1] - before[1]) * ratio,
            ]
        )
    return sampled


def haversine_distance_meters(first: tuple[float, float], second: tuple[float, float]) -> float:
    longitude_delta = radians(second[0] - first[0])
    latitude_delta = radians(second[1] - first[1])
    first_latitude = radians(first[1])
    second_latitude = radians(second[1])
    value = (
        sin(latitude_delta / 2) ** 2
        + cos(first_latitude) * cos(second_latitude) * sin(longitude_delta / 2) ** 2
    )
    return 2 * 6_371_000 * asin(sqrt(value))


def raw_samples(profile: ElevationProfile) -> list[ElevationSample]:
    return [
        ElevationSample(
            distance_meters=point.distance_meters,
            elevation_meters=point.elevation_meters,
            longitude=point.longitude,
            latitude=point.latitude,
        )
        for point in profile.points
    ]


def build_segments(
    samples: list[ElevationSample],
    *,
    smoothing_window_meters: float | None = None,
    downhill_mode: str = "swiss",
) -> list[Segment]:
    elevations = (
        [sample.elevation_meters for sample in samples]
        if smoothing_window_meters is None
        else smooth_elevations_for_window(samples, smoothing_window_meters)
    )
    sample_distances = [sample.distance_meters for sample in samples]
    boundaries = fixed_segment_boundaries(samples[-1].distance_meters, 50)
    segments: list[Segment] = []
    for start, end in zip(boundaries, boundaries[1:], strict=False):
        distance = end - start
        if distance <= 0:
            continue
        start_elevation = interpolate_elevation_at_distance(
            samples, elevations, start, sample_distances
        )
        end_elevation = interpolate_elevation_at_distance(
            samples, elevations, end, sample_distances
        )
        slope_percent = (end_elevation - start_elevation) * 100 / distance
        running_pace, minetti_cost = running_pace_for_slope(slope_percent, downhill_mode)
        segments.append(
            Segment(
                start_distance_meters=start,
                end_distance_meters=end,
                start_elevation_meters=start_elevation,
                end_elevation_meters=end_elevation,
                slope_percent=slope_percent,
                running_pace_min_per_km=running_pace,
                running_time_seconds=(distance / 1_000) * running_pace * 60,
                minetti_cost=minetti_cost,
            )
        )
    return segments


def running_pace_for_slope(
    slope_percent: float, downhill_mode: str = "swiss"
) -> tuple[float, float | None]:
    if slope_percent > 0:
        cost = minetti_running_cost(slope_percent)
        return FLAT_RUNNING_PACE_MIN_PER_KM * cost / FLAT_RUNNING_COST, cost

    if downhill_mode == "flat":
        return FLAT_RUNNING_PACE_MIN_PER_KM, None

    hiking_pace = swiss_hiking_minutes_per_km(slope_percent)
    scale = FLAT_RUNNING_PACE_MIN_PER_KM / FLAT_HIKING_PACE_MIN_PER_KM
    swiss_pace = FLAT_RUNNING_PACE_MIN_PER_KM + (hiking_pace - FLAT_HIKING_PACE_MIN_PER_KM) * scale
    if downhill_mode == "capped":
        return max(FLAT_RUNNING_PACE_MIN_PER_KM, swiss_pace), None
    return swiss_pace, None


def minetti_running_cost(slope_percent: float) -> float:
    incline = slope_percent / 100
    return (
        155.4 * incline**5
        - 30.4 * incline**4
        - 43.3 * incline**3
        + 46.3 * incline**2
        + 19.5 * incline
        + FLAT_RUNNING_COST
    )


def gradient_bucket(slope_percent: float) -> str:
    if slope_percent <= -20:
        return BUCKETS[0]
    if slope_percent <= -15:
        return BUCKETS[1]
    if slope_percent <= -10:
        return BUCKETS[2]
    if slope_percent <= -5:
        return BUCKETS[3]
    if slope_percent <= 0:
        return BUCKETS[4]
    if slope_percent <= 5:
        return BUCKETS[5]
    if slope_percent <= 10:
        return BUCKETS[6]
    if slope_percent <= 15:
        return BUCKETS[7]
    if slope_percent <= 20:
        return BUCKETS[8]
    return BUCKETS[9]


def write_csv(path: Path, segments: list[Segment]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(
            output,
            fieldnames=(
                "start_distance_km",
                "end_distance_km",
                "segment_length_m",
                "start_elevation_m",
                "end_elevation_m",
                "slope_percent",
                "ascent_m",
                "descent_m",
                "model_branch",
                "terrain_multiplier",
                "running_pace_min_km",
                "segment_time_seconds",
                "minetti_cost",
            ),
        )
        writer.writeheader()
        for segment in segments:
            writer.writerow(
                {
                    "start_distance_km": f"{segment.start_distance_meters / 1_000:.3f}",
                    "end_distance_km": f"{segment.end_distance_meters / 1_000:.3f}",
                    "segment_length_m": f"{segment.distance_meters:.1f}",
                    "start_elevation_m": f"{segment.start_elevation_meters:.1f}",
                    "end_elevation_m": f"{segment.end_elevation_meters:.1f}",
                    "slope_percent": f"{segment.slope_percent:.2f}",
                    "ascent_m": f"{segment.ascent_meters:.1f}",
                    "descent_m": f"{segment.descent_meters:.1f}",
                    "model_branch": segment.model_branch,
                    "terrain_multiplier": f"{segment.terrain_multiplier:.3f}",
                    "running_pace_min_km": f"{segment.running_pace_min_per_km:.3f}",
                    "segment_time_seconds": f"{segment.running_time_seconds:.2f}",
                    "minetti_cost": ""
                    if segment.minetti_cost is None
                    else f"{segment.minetti_cost:.4f}",
                }
            )


def print_header(distance_meters: float, coordinate_count: int, csv_path: Path) -> None:
    print("Running-time diagnostic")
    print(f"Resampled GPX coordinates: {coordinate_count}")
    print(f"CSV: {csv_path}")
    print(f"Route distance: {distance_meters / 1_000:.2f} km")


def print_downhill_scenarios(scenarios: dict[str, list[Segment]]) -> None:
    current_seconds = sum(
        segment.running_time_seconds for segment in scenarios["A  current hybrid (Swiss downhill)"]
    )
    print("\nDownhill scenarios")
    for title, segments in scenarios.items():
        total_seconds = sum(segment.running_time_seconds for segment in segments)
        print(
            f"  {title}: {format_seconds(total_seconds)} "
            f"({format_signed_seconds(total_seconds - current_seconds)} vs A)"
        )


def print_overall(
    title: str,
    segments: list[Segment],
    ascent_meters: float,
    descent_meters: float,
) -> None:
    distance = sum(segment.distance_meters for segment in segments)
    total_seconds = sum(segment.running_time_seconds for segment in segments)
    uphill_distance = sum(
        segment.distance_meters for segment in segments if segment.slope_percent > 0
    )
    downhill_distance = sum(
        segment.distance_meters for segment in segments if segment.slope_percent < 0
    )
    flat_distance = sum(
        segment.distance_meters
        for segment in segments
        if abs(segment.slope_percent) <= APPROXIMATELY_FLAT_SLOPE_PERCENT
    )
    flat_seconds = distance / 1_000 * FLAT_RUNNING_PACE_MIN_PER_KM * 60
    print(f"\n{title}")
    print(f"  total ascent: {ascent_meters:.0f} m")
    print(f"  total descent: {descent_meters:.0f} m")
    print(f"  flat-equivalent time: {format_seconds(flat_seconds)}")
    print(f"  predicted running time: {format_seconds(total_seconds)}")
    print(f"  additional time vs flat: {format_seconds(total_seconds - flat_seconds)}")
    print(f"  segments: {len(segments)}")
    print(f"  distance uphill: {uphill_distance / 1_000:.2f} km")
    print(f"  distance downhill: {downhill_distance / 1_000:.2f} km")
    print(
        "  distance approximately flat "
        f"(±{APPROXIMATELY_FLAT_SLOPE_PERCENT:g}%): "
        f"{flat_distance / 1_000:.2f} km"
    )


def print_buckets(segments: list[Segment]) -> None:
    totals = bucket_totals(segments)
    route_distance = sum(segment.distance_meters for segment in segments)
    route_time = sum(segment.running_time_seconds for segment in segments)
    print("\nGradient buckets")
    print("bucket           distance  route%  ascent  descent  time     time%  pace    multiplier")
    for bucket in BUCKETS:
        total = totals[bucket]
        pace = (
            total.running_time_seconds / 60 / (total.distance_meters / 1_000)
            if total.distance_meters
            else 0
        )
        multiplier = pace / FLAT_RUNNING_PACE_MIN_PER_KM if pace else 0
        print(
            f"{bucket:14} {total.distance_meters / 1_000:6.2f} km "
            f"{percentage(total.distance_meters, route_distance):6.1f}% "
            f"{total.ascent_meters:6.0f} m {total.descent_meters:7.0f} m "
            f"{format_seconds(total.running_time_seconds):>8} "
            f"{percentage(total.running_time_seconds, route_time):6.1f}% "
            f"{format_pace(pace):>7} {multiplier:10.2f}x"
        )
    print("\nAscent by uphill-gradient bucket")
    for bucket in BUCKETS[5:]:
        print(f"  {bucket:12}: {totals[bucket].ascent_meters:.0f} m")


def print_time_contribution(segments: list[Segment]) -> None:
    totals = bucket_totals(segments)
    groups = {
        "flat/downhill": BUCKETS[:5],
        "0-5% uphill": (BUCKETS[5],),
        "5-10% uphill": (BUCKETS[6],),
        "10-15% uphill": (BUCKETS[7],),
        "15-20% uphill": (BUCKETS[8],),
        ">20% uphill": (BUCKETS[9],),
    }
    print("\nTime contribution")
    for title, buckets in groups.items():
        distance = sum(totals[bucket].distance_meters for bucket in buckets)
        running_seconds = sum(totals[bucket].running_time_seconds for bucket in buckets)
        flat_seconds = distance / 1_000 * FLAT_RUNNING_PACE_MIN_PER_KM * 60
        print(
            f"  {title:16}: {format_seconds(running_seconds):>8} "
            f"({format_signed_seconds(running_seconds - flat_seconds)} vs flat)"
        )


def bucket_totals(segments: list[Segment]) -> dict[str, BucketTotals]:
    totals: dict[str, BucketTotals] = defaultdict(BucketTotals)
    for segment in segments:
        totals[gradient_bucket(segment.slope_percent)].add(segment)
    return totals


def percentage(value: float, total: float) -> float:
    return 100 * value / total if total else 0.0


def format_pace(minutes_per_km: float) -> str:
    seconds = round(minutes_per_km * 60)
    return f"{seconds // 60}:{seconds % 60:02d}/km"


def format_seconds(seconds: float) -> str:
    rounded = round(seconds)
    return f"{rounded // 3600}:{(rounded % 3600) // 60:02d}:{rounded % 60:02d}"


def format_signed_seconds(seconds: float) -> str:
    sign = "+" if seconds >= 0 else "-"
    return f"{sign}{format_seconds(abs(seconds))}"


if __name__ == "__main__":
    main()
