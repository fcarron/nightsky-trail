import type {
  ElevationProfileRequest,
  ElevationProfileResponse,
} from "../../types/api";
import type { ComputedRoute } from "../route/routeModel";

export interface ElevationProfile {
  distanceMeters: number;
  ascentMeters: number;
  descentMeters: number;
  minElevationMeters: number;
  maxElevationMeters: number;
  hikingTime: HikingTime;
  maxAbsGradientPercent: number;
  points: ElevationPoint[];
  gradientBands: ElevationGradientBand[];
}

export interface HikingTime {
  durationMinutes: number;
  method: "swiss_hiking_polynomial";
  segmentLengthMeters: number;
  smoothingWindowMeters: number;
  segmentCount: number;
}

export interface ElevationPoint {
  distanceMeters: number;
  elevationMeters: number;
  smoothedElevationMeters: number;
  gradientPercent: number;
  longitude: number;
  latitude: number;
}

export interface ElevationGradientBand {
  startDistanceMeters: number;
  endDistanceMeters: number;
  gradientPercent: number;
  group: GradientGroup;
}

export interface DistanceRange {
  startDistanceMeters: number;
  endDistanceMeters: number;
}

export interface KilometreSplit extends DistanceRange {
  index: number;
  ascentMeters: number;
  descentMeters: number;
  netGradientPercent: number;
  maxUphillGradientPercent: number;
  maxDownhillGradientPercent: number;
  hikingMinutes: number;
  runningMinutes: number | null;
}

export interface Climb extends DistanceRange {
  index: number;
  elevationGainMeters: number;
  averageGradientPercent: number;
  maxRelevantGradientPercent: number;
  hikingMinutes: number;
  runningMinutes: number | null;
  score: number;
  timePenaltyMinutes: number;
  category: ClimbEffortCategory;
}

export type ClimbEffortCategory =
  "leicht" | "moderat" | "anspruchsvoll" | "hart" | "sehr hart" | "extrem";

export interface ClimbDetectionConfig {
  minimumDistanceMeters: number;
  minimumElevationGainMeters: number;
  minimumTimePenaltyMinutes: number;
  softSplitLossFactor: number;
  softSplitLossMinimumMeters: number;
  softSplitLossMaximumMeters: number;
  hardSplitLossFactor: number;
  hardSplitLossMinimumMeters: number;
  hardSplitLossMaximumMeters: number;
  plateauSplitDistanceFactor: number;
  plateauSplitDistanceMinimumMeters: number;
  plateauSplitDistanceMaximumMeters: number;
}

export const DEFAULT_CLIMB_DETECTION: ClimbDetectionConfig = {
  minimumDistanceMeters: 400,
  minimumElevationGainMeters: 80,
  minimumTimePenaltyMinutes: 5,
  softSplitLossFactor: 0.1,
  softSplitLossMinimumMeters: 30,
  softSplitLossMaximumMeters: 80,
  hardSplitLossFactor: 0.2,
  hardSplitLossMinimumMeters: 60,
  hardSplitLossMaximumMeters: 150,
  plateauSplitDistanceFactor: 0.12,
  plateauSplitDistanceMinimumMeters: 400,
  plateauSplitDistanceMaximumMeters: 1_200,
};

export function climbEffortCategoryForScore(
  score: number,
): ClimbEffortCategory {
  if (score >= 13) return "extrem";
  if (score >= 7.5) return "sehr hart";
  if (score >= 4.5) return "hart";
  if (score >= 2.5) return "anspruchsvoll";
  if (score >= 1) return "moderat";
  return "leicht";
}

export interface GradientGroup {
  id: string;
  label: string;
  color: string;
}

export interface GradientDistributionBin {
  distanceMeters: number;
  endGradientPercent: number | null;
  label: string;
  startGradientPercent: number | null;
}

export interface SustainedGradient {
  downhillGradientPercent: number | null;
  downhillRange: DistanceRange | null;
  uphillGradientPercent: number | null;
  uphillRange: DistanceRange | null;
  windowMeters: number;
}

export const GRADIENT_GROUPS: GradientGroup[] = [
  { id: "easy", label: "<5%", color: "#dcefb4" },
  { id: "moderate", label: "5-10%", color: "#f4d35e" },
  { id: "strong", label: "10-15%", color: "#f59e42" },
  { id: "steep", label: "15-20%", color: "#e4572e" },
  { id: "very-steep", label: "20-30%", color: "#b91c1c" },
  { id: "extreme", label: ">30%", color: "#7f1d1d" },
];
export const GRADIENT_DISTRIBUTION_BIN_WIDTH_PERCENT = 2.5;
export const GRADIENT_DISTRIBUTION_LIMIT_PERCENT = 30;
export const SUSTAINED_GRADIENT_WINDOWS_METERS = [100, 500, 1_000] as const;
export const FLAT_HIKING_PACE_MIN_PER_KM = 14.271;
export const DEFAULT_RUNNING_UPHILL_CORRECTION = 1.2;
const SWISS_HIKING_COEFFICIENTS = [
  14.271, 3.6991, 2.5922, -1.4384, 0.32105, 0.81542, -0.090261, -0.20757,
  0.010192, 0.028588, -0.00057466, -0.0021842, 0.000015176, 0.000086894,
  -0.00000013584, -0.0000014026,
];

export function toElevationProfileRequest(
  route: ComputedRoute,
): ElevationProfileRequest {
  return {
    geometry: {
      type: "LineString",
      coordinates: resampleGeometryForElevation(route.geometry).map(
        (coordinate) => [coordinate.lon, coordinate.lat],
      ),
    },
  };
}

const ELEVATION_GEOMETRY_TARGET_SPACING_METERS = 25;
const ELEVATION_GEOMETRY_MAX_POINTS = 800;
const EARTH_RADIUS_METERS = 6_371_000;

export function resampleGeometryForElevation(
  geometry: ComputedRoute["geometry"],
): ComputedRoute["geometry"] {
  if (geometry.length <= 2) {
    return geometry;
  }

  const distances = cumulativeDistances(geometry);
  const totalDistance = distances[distances.length - 1] ?? 0;
  if (totalDistance <= 0) {
    return [geometry[0], geometry[geometry.length - 1]];
  }

  const targetPointCount = Math.min(
    ELEVATION_GEOMETRY_MAX_POINTS,
    Math.max(
      2,
      Math.ceil(totalDistance / ELEVATION_GEOMETRY_TARGET_SPACING_METERS) + 1,
    ),
  );
  const spacing = totalDistance / (targetPointCount - 1);

  const sampled = [];
  let segmentIndex = 1;
  for (let index = 0; index < targetPointCount; index += 1) {
    const targetDistance =
      index === targetPointCount - 1 ? totalDistance : index * spacing;
    while (
      segmentIndex < distances.length - 1 &&
      distances[segmentIndex] < targetDistance
    ) {
      segmentIndex += 1;
    }

    const before = geometry[segmentIndex - 1];
    const after = geometry[segmentIndex];
    const beforeDistance = distances[segmentIndex - 1];
    const afterDistance = distances[segmentIndex];
    const ratio =
      afterDistance > beforeDistance
        ? (targetDistance - beforeDistance) / (afterDistance - beforeDistance)
        : 0;

    sampled.push({
      lon: before.lon + (after.lon - before.lon) * ratio,
      lat: before.lat + (after.lat - before.lat) * ratio,
    });
  }

  return sampled;
}

function cumulativeDistances(geometry: ComputedRoute["geometry"]): number[] {
  const distances = [0];
  for (let index = 1; index < geometry.length; index += 1) {
    distances.push(
      distances[index - 1] +
        distanceMeters(geometry[index - 1], geometry[index]),
    );
  }
  return distances;
}

function distanceMeters(
  first: ComputedRoute["geometry"][number],
  second: ComputedRoute["geometry"][number],
): number {
  const firstLat = toRadians(first.lat);
  const secondLat = toRadians(second.lat);
  const latDelta = toRadians(second.lat - first.lat);
  const lonDelta = toRadians(second.lon - first.lon);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(lonDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function toElevationProfile(
  response: ElevationProfileResponse,
): ElevationProfile {
  const points = response.points;
  return {
    distanceMeters: response.distanceMeters,
    ascentMeters: response.ascentMeters,
    descentMeters: response.descentMeters,
    minElevationMeters: response.minElevationMeters,
    maxElevationMeters: response.maxElevationMeters,
    hikingTime: {
      durationMinutes: response.hikingTime.duration_minutes,
      method: response.hikingTime.method,
      segmentLengthMeters: response.hikingTime.segment_length_m,
      smoothingWindowMeters: response.hikingTime.smoothing_window_m,
      segmentCount: response.hikingTime.segment_count,
    },
    maxAbsGradientPercent: points.reduce(
      (max, point) => Math.max(max, Math.abs(point.gradientPercent)),
      0,
    ),
    points,
    gradientBands: buildGradientBands(points),
  };
}

export function gradientGroupForPercent(
  gradientPercent: number,
): GradientGroup {
  const absoluteGradient = Math.abs(gradientPercent);
  if (absoluteGradient < 5) {
    return GRADIENT_GROUPS[0];
  }
  if (absoluteGradient < 10) {
    return GRADIENT_GROUPS[1];
  }
  if (absoluteGradient < 15) {
    return GRADIENT_GROUPS[2];
  }
  if (absoluteGradient < 20) {
    return GRADIENT_GROUPS[3];
  }
  if (absoluteGradient < 30) {
    return GRADIENT_GROUPS[4];
  }
  return GRADIENT_GROUPS[5];
}

export function estimatePersonalRunningMinutes(
  profile: ElevationProfile,
  flatRunningPaceMinPerKm: number,
  uphillCorrection = DEFAULT_RUNNING_UPHILL_CORRECTION,
): number {
  const monotonicPoints = profile.points.filter(
    (point, index, points) =>
      index === 0 || point.distanceMeters > points[index - 1].distanceMeters,
  );
  if (monotonicPoints.length < 2 || profile.distanceMeters <= 0) {
    return 0;
  }

  const segmentLengthMeters = profile.hikingTime.segmentLengthMeters;
  const segmentBoundaries = fixedSegmentBoundaries(
    monotonicPoints[monotonicPoints.length - 1].distanceMeters,
    segmentLengthMeters,
  );
  const scale = flatRunningPaceMinPerKm / FLAT_HIKING_PACE_MIN_PER_KM;
  let totalMinutes = 0;

  for (let index = 1; index < segmentBoundaries.length; index += 1) {
    const startDistance = segmentBoundaries[index - 1];
    const endDistance = segmentBoundaries[index];
    const horizontalDistance = endDistance - startDistance;
    if (horizontalDistance <= 0) {
      continue;
    }

    const startElevation = interpolateSmoothedElevationAtDistance(
      monotonicPoints,
      startDistance,
    );
    const endElevation = interpolateSmoothedElevationAtDistance(
      monotonicPoints,
      endDistance,
    );
    const slopePercent =
      (100 * (endElevation - startElevation)) / horizontalDistance;
    const hikingPace = swissHikingMinutesPerKm(slopePercent);
    const slopePenalty = hikingPace - FLAT_HIKING_PACE_MIN_PER_KM;
    const correction = slopePercent > 0 ? uphillCorrection : 1;
    const runningPace =
      flatRunningPaceMinPerKm + slopePenalty * scale * correction;
    totalMinutes += (horizontalDistance / 1000) * runningPace;
  }

  return Math.round(totalMinutes);
}

export function calculateKilometreSplits(
  profile: ElevationProfile,
  flatRunningPaceMinPerKm?: number,
): KilometreSplit[] {
  const result: KilometreSplit[] = [];
  for (
    let start = 0, index = 1;
    start < profile.distanceMeters;
    start += 1000, index += 1
  ) {
    const end = Math.min(profile.distanceMeters, start + 1000);
    result.push({
      ...rangeStatistics(profile, start, end, flatRunningPaceMinPerKm),
      index,
    });
  }
  return result;
}

export function calculateGradientDistribution(
  profile: ElevationProfile,
): GradientDistributionBin[] {
  const bins = createGradientDistributionBins();
  const intervals = smoothedElevationIntervals(profile.points);

  for (const interval of intervals) {
    const bin = gradientDistributionBinForPercent(
      bins,
      interval.gradientPercent,
    );
    if (bin) {
      bin.distanceMeters += interval.distanceMeters;
    }
  }

  return bins;
}

export function calculateSustainedGradients(
  profile: ElevationProfile,
  windowsMeters: readonly number[] = SUSTAINED_GRADIENT_WINDOWS_METERS,
): SustainedGradient[] {
  if (profile.points.length < 2) {
    return windowsMeters.map((windowMeters) => ({
      downhillGradientPercent: null,
      downhillRange: null,
      uphillGradientPercent: null,
      uphillRange: null,
      windowMeters,
    }));
  }

  return windowsMeters.map((windowMeters) => {
    if (windowMeters <= 0 || profile.distanceMeters < windowMeters) {
      return {
        downhillGradientPercent: null,
        downhillRange: null,
        uphillGradientPercent: null,
        uphillRange: null,
        windowMeters,
      };
    }

    const lastStart = profile.distanceMeters - windowMeters;
    const starts = uniqueSortedNumbers([
      0,
      lastStart,
      ...profile.points
        .map((point) => point.distanceMeters)
        .filter((distance) => distance > 0 && distance < lastStart),
    ]);
    let steepestUphill = 0;
    let steepestDownhill = 0;
    let uphillRange: DistanceRange | null = null;
    let downhillRange: DistanceRange | null = null;

    for (const startDistanceMeters of starts) {
      const elevationDelta =
        interpolateSmoothedElevationAtDistance(
          profile.points,
          startDistanceMeters + windowMeters,
        ) -
        interpolateSmoothedElevationAtDistance(
          profile.points,
          startDistanceMeters,
        );
      const gradientPercent = (elevationDelta * 100) / windowMeters;
      if (gradientPercent > steepestUphill) {
        steepestUphill = gradientPercent;
        uphillRange = {
          startDistanceMeters,
          endDistanceMeters: startDistanceMeters + windowMeters,
        };
      }
      if (gradientPercent < steepestDownhill) {
        steepestDownhill = gradientPercent;
        downhillRange = {
          startDistanceMeters,
          endDistanceMeters: startDistanceMeters + windowMeters,
        };
      }
    }

    return {
      downhillGradientPercent: steepestDownhill < 0 ? steepestDownhill : null,
      downhillRange,
      uphillGradientPercent: steepestUphill > 0 ? steepestUphill : null,
      uphillRange,
      windowMeters,
    };
  });
}

export function detectClimbs(
  profile: ElevationProfile,
  flatRunningPaceMinPerKm?: number,
  config = DEFAULT_CLIMB_DETECTION,
): Climb[] {
  const points = profile.points;
  const climbs: Climb[] = [];
  let startIndex: number | null = null;
  let peakIndex = 0;
  let recoverableValley = false;

  const finish = (endIndex: number) => {
    if (startIndex === null) return;
    const start = points[startIndex];
    const end = points[endIndex];
    const distance = end.distanceMeters - start.distanceMeters;
    const gain = end.smoothedElevationMeters - start.smoothedElevationMeters;
    if (
      distance >= config.minimumDistanceMeters &&
      gain >= config.minimumElevationGainMeters
    ) {
      const stats = rangeStatistics(
        profile,
        start.distanceMeters,
        end.distanceMeters,
        flatRunningPaceMinPerKm,
      );
      const climbTimeMinutes = calculateHikingMinutesForRange(
        profile,
        start.distanceMeters,
        end.distanceMeters,
      );
      const flatTimeMinutes = (distance / 1000) * FLAT_HIKING_PACE_MIN_PER_KM;
      const timePenaltyMinutes = climbTimeMinutes - flatTimeMinutes;
      const score = timePenaltyMinutes / 10;
      if (timePenaltyMinutes >= config.minimumTimePenaltyMinutes) {
        climbs.push({
          ...stats,
          index: climbs.length + 1,
          elevationGainMeters: gain,
          averageGradientPercent: (gain / distance) * 100,
          maxRelevantGradientPercent: stats.maxUphillGradientPercent,
          score,
          timePenaltyMinutes,
          category: climbEffortCategoryForScore(score),
        });
      }
    }
    startIndex = null;
    recoverableValley = false;
  };

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const delta =
      point.smoothedElevationMeters - previous.smoothedElevationMeters;
    if (startIndex === null) {
      if (delta > 0) {
        startIndex = index - 1;
        peakIndex = index;
        recoverableValley = false;
      }
      continue;
    }
    const start = points[startIndex];
    const peak = points[peakIndex];
    const candidateGainMeters =
      peak.smoothedElevationMeters - start.smoothedElevationMeters;
    const candidateLengthMeters = point.distanceMeters - start.distanceMeters;
    const splitThresholds = climbSplitThresholds(
      candidateGainMeters,
      candidateLengthMeters,
      config,
    );
    const loss = peak.smoothedElevationMeters - point.smoothedElevationMeters;
    const distanceBelowPeakMeters = point.distanceMeters - peak.distanceMeters;

    if (point.smoothedElevationMeters > peak.smoothedElevationMeters) {
      peakIndex = index;
      recoverableValley = false;
      continue;
    }

    if (
      recoverableValley &&
      loss <= 0 &&
      distanceBelowPeakMeters < splitThresholds.plateauSplitDistanceMeters
    ) {
      peakIndex = index;
      recoverableValley = false;
      continue;
    }

    if (loss >= splitThresholds.softSplitLossMeters) {
      recoverableValley = true;
    }

    if (
      loss >= splitThresholds.hardSplitLossMeters ||
      distanceBelowPeakMeters >= splitThresholds.plateauSplitDistanceMeters
    ) {
      finish(peakIndex);
      if (delta > 0) {
        startIndex = index - 1;
        peakIndex = index;
        recoverableValley = false;
      }
    }
  }
  finish(peakIndex);
  return climbs;
}

function climbSplitThresholds(
  candidateGainMeters: number,
  candidateLengthMeters: number,
  config: ClimbDetectionConfig,
) {
  return {
    softSplitLossMeters: clamp(
      config.softSplitLossFactor * candidateGainMeters,
      config.softSplitLossMinimumMeters,
      config.softSplitLossMaximumMeters,
    ),
    hardSplitLossMeters: clamp(
      config.hardSplitLossFactor * candidateGainMeters,
      config.hardSplitLossMinimumMeters,
      config.hardSplitLossMaximumMeters,
    ),
    plateauSplitDistanceMeters: clamp(
      config.plateauSplitDistanceFactor * candidateLengthMeters,
      config.plateauSplitDistanceMinimumMeters,
      config.plateauSplitDistanceMaximumMeters,
    ),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rangeStatistics(
  profile: ElevationProfile,
  startDistanceMeters: number,
  endDistanceMeters: number,
  flatRunningPaceMinPerKm?: number,
): Omit<KilometreSplit, "index"> {
  const points = pointsInRange(
    profile.points,
    startDistanceMeters,
    endDistanceMeters,
  );
  let ascent = 0;
  let descent = 0;
  let maxUp = 0;
  let maxDown = 0;
  for (let index = 1; index < points.length; index += 1) {
    const delta =
      points[index].smoothedElevationMeters -
      points[index - 1].smoothedElevationMeters;
    if (delta > 0) ascent += delta;
    else descent -= delta;
  }
  for (const point of points) {
    maxUp = Math.max(maxUp, point.gradientPercent);
    maxDown = Math.min(maxDown, point.gradientPercent);
  }
  const distance = endDistanceMeters - startDistanceMeters;
  const net =
    distance > 0
      ? (((points.at(-1)?.smoothedElevationMeters ?? 0) -
          points[0].smoothedElevationMeters) *
          100) /
        distance
      : 0;
  return {
    startDistanceMeters,
    endDistanceMeters,
    ascentMeters: ascent,
    descentMeters: descent,
    netGradientPercent: net,
    maxUphillGradientPercent: maxUp,
    maxDownhillGradientPercent: maxDown,
    hikingMinutes: estimateHikingMinutesForRange(
      profile,
      startDistanceMeters,
      endDistanceMeters,
    ),
    runningMinutes:
      flatRunningPaceMinPerKm === undefined
        ? null
        : estimateRunningMinutesForRange(
            profile,
            startDistanceMeters,
            endDistanceMeters,
            flatRunningPaceMinPerKm,
          ),
  };
}

function pointsInRange(
  points: ElevationPoint[],
  start: number,
  end: number,
): ElevationPoint[] {
  return [
    pointAtDistance(points, start),
    ...points.filter(
      (point) => point.distanceMeters > start && point.distanceMeters < end,
    ),
    pointAtDistance(points, end),
  ];
}

function pointAtDistance(
  points: ElevationPoint[],
  distanceMeters: number,
): ElevationPoint {
  const after =
    points.find((point) => point.distanceMeters >= distanceMeters) ??
    points.at(-1)!;
  const before =
    [...points]
      .reverse()
      .find((point) => point.distanceMeters <= distanceMeters) ?? points[0];
  const distance = after.distanceMeters - before.distanceMeters;
  const ratio =
    distance > 0 ? (distanceMeters - before.distanceMeters) / distance : 0;
  return {
    ...before,
    distanceMeters,
    smoothedElevationMeters:
      before.smoothedElevationMeters +
      (after.smoothedElevationMeters - before.smoothedElevationMeters) * ratio,
    gradientPercent:
      before.gradientPercent +
      (after.gradientPercent - before.gradientPercent) * ratio,
  };
}

function estimateHikingMinutesForRange(
  profile: ElevationProfile,
  start: number,
  end: number,
): number {
  return estimateRangeMinutes(profile, start, end, FLAT_HIKING_PACE_MIN_PER_KM);
}

function estimateRunningMinutesForRange(
  profile: ElevationProfile,
  start: number,
  end: number,
  flatPace: number,
): number {
  return estimateRangeMinutes(profile, start, end, flatPace, true);
}

function estimateRangeMinutes(
  profile: ElevationProfile,
  start: number,
  end: number,
  flatPace: number,
  running = false,
): number {
  return Math.round(
    calculateRangeMinutes(profile, start, end, flatPace, running),
  );
}

function calculateHikingMinutesForRange(
  profile: ElevationProfile,
  start: number,
  end: number,
): number {
  return calculateRangeMinutes(
    profile,
    start,
    end,
    FLAT_HIKING_PACE_MIN_PER_KM,
  );
}

function calculateRangeMinutes(
  profile: ElevationProfile,
  start: number,
  end: number,
  flatPace: number,
  running = false,
): number {
  const boundaries = fixedSegmentBoundaries(
    end - start,
    profile.hikingTime.segmentLengthMeters,
  ).map((value) => value + start);
  let total = 0;
  const scale = flatPace / FLAT_HIKING_PACE_MIN_PER_KM;
  for (let index = 1; index < boundaries.length; index += 1) {
    const distance = boundaries[index] - boundaries[index - 1];
    const delta =
      interpolateSmoothedElevationAtDistance(
        profile.points,
        boundaries[index],
      ) -
      interpolateSmoothedElevationAtDistance(
        profile.points,
        boundaries[index - 1],
      );
    const slope = (delta * 100) / distance;
    const hikingPace = swissHikingMinutesPerKm(slope);
    const pace = running
      ? flatPace +
        (hikingPace - FLAT_HIKING_PACE_MIN_PER_KM) *
          scale *
          (slope > 0 ? DEFAULT_RUNNING_UPHILL_CORRECTION : 1)
      : hikingPace;
    total += (distance / 1000) * pace;
  }
  return total;
}

function swissHikingMinutesPerKm(slopePercent: number): number {
  const s = slopePercent / 10;
  if (s > -4 && s < 4) {
    return evaluateSwissHikingPolynomial(s);
  }
  if (s >= 4) {
    return 17 * s;
  }
  return -9 * s;
}

function evaluateSwissHikingPolynomial(s: number): number {
  return SWISS_HIKING_COEFFICIENTS.reduceRight(
    (result, coefficient) => result * s + coefficient,
    0,
  );
}

function fixedSegmentBoundaries(
  totalDistanceMeters: number,
  segmentLengthMeters: number,
): number[] {
  if (totalDistanceMeters <= 0) {
    return [0];
  }

  const boundaries = [0];
  let nextDistance = segmentLengthMeters;
  while (nextDistance < totalDistanceMeters) {
    boundaries.push(nextDistance);
    nextDistance += segmentLengthMeters;
  }
  boundaries.push(totalDistanceMeters);
  return boundaries;
}

function interpolateSmoothedElevationAtDistance(
  points: ElevationPoint[],
  distanceMeters: number,
): number {
  if (distanceMeters <= points[0].distanceMeters) {
    return points[0].smoothedElevationMeters;
  }
  const lastPoint = points[points.length - 1];
  if (distanceMeters >= lastPoint.distanceMeters) {
    return lastPoint.smoothedElevationMeters;
  }

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (current.distanceMeters < distanceMeters) {
      continue;
    }
    const distanceDelta = current.distanceMeters - previous.distanceMeters;
    if (distanceDelta <= 0) {
      return current.smoothedElevationMeters;
    }
    const ratio = (distanceMeters - previous.distanceMeters) / distanceDelta;
    return (
      previous.smoothedElevationMeters +
      (current.smoothedElevationMeters - previous.smoothedElevationMeters) *
        ratio
    );
  }

  return lastPoint.smoothedElevationMeters;
}

function createGradientDistributionBins(): GradientDistributionBin[] {
  const bins: GradientDistributionBin[] = [
    {
      distanceMeters: 0,
      endGradientPercent: -GRADIENT_DISTRIBUTION_LIMIT_PERCENT,
      label: `< -${GRADIENT_DISTRIBUTION_LIMIT_PERCENT} %`,
      startGradientPercent: null,
    },
  ];
  const binCount =
    (GRADIENT_DISTRIBUTION_LIMIT_PERCENT * 2) /
    GRADIENT_DISTRIBUTION_BIN_WIDTH_PERCENT;

  for (let index = 0; index < binCount; index += 1) {
    const start =
      -GRADIENT_DISTRIBUTION_LIMIT_PERCENT +
      index * GRADIENT_DISTRIBUTION_BIN_WIDTH_PERCENT;
    const end = start + GRADIENT_DISTRIBUTION_BIN_WIDTH_PERCENT;
    bins.push({
      distanceMeters: 0,
      endGradientPercent: end,
      label: `${formatGradientBinNumber(start)} bis ${formatGradientBinNumber(end)} %`,
      startGradientPercent: start,
    });
  }

  bins.push({
    distanceMeters: 0,
    endGradientPercent: null,
    label: `> ${GRADIENT_DISTRIBUTION_LIMIT_PERCENT} %`,
    startGradientPercent: GRADIENT_DISTRIBUTION_LIMIT_PERCENT,
  });
  return bins;
}

function gradientDistributionBinForPercent(
  bins: GradientDistributionBin[],
  gradientPercent: number,
): GradientDistributionBin | undefined {
  if (gradientPercent < -GRADIENT_DISTRIBUTION_LIMIT_PERCENT) {
    return bins[0];
  }
  if (gradientPercent > GRADIENT_DISTRIBUTION_LIMIT_PERCENT) {
    return bins.at(-1);
  }

  const regularBinIndex = Math.min(
    Math.floor(
      (gradientPercent + GRADIENT_DISTRIBUTION_LIMIT_PERCENT) /
        GRADIENT_DISTRIBUTION_BIN_WIDTH_PERCENT,
    ),
    bins.length - 3,
  );
  return bins[regularBinIndex + 1];
}

function smoothedElevationIntervals(points: ElevationPoint[]) {
  const intervals: Array<{
    distanceMeters: number;
    gradientPercent: number;
  }> = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const distanceMeters = current.distanceMeters - previous.distanceMeters;
    if (distanceMeters <= 0) {
      continue;
    }
    intervals.push({
      distanceMeters,
      gradientPercent:
        ((current.smoothedElevationMeters - previous.smoothedElevationMeters) *
          100) /
        distanceMeters,
    });
  }
  return intervals;
}

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((first, second) => first - second);
}

function formatGradientBinNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function buildGradientBands(points: ElevationPoint[]): ElevationGradientBand[] {
  return points.slice(1).map((point, index) => {
    const previous = points[index];
    const gradientPercent =
      (previous.gradientPercent + point.gradientPercent) / 2;
    return {
      startDistanceMeters: previous.distanceMeters,
      endDistanceMeters: point.distanceMeters,
      gradientPercent,
      group: gradientGroupForPercent(gradientPercent),
    };
  });
}

export function formatElevationMeters(value: number): string {
  return `${Math.round(value).toLocaleString("de-CH")} m`;
}

export function formatGradientPercent(value: number): string {
  return `${value.toFixed(1)} %`;
}

export function formatDurationMinutes(minutes: number): string {
  const roundedMinutes = Math.round(minutes);
  const hours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;
  if (hours === 0) {
    return `${remainingMinutes} min`;
  }
  return `${hours}:${remainingMinutes.toString().padStart(2, "0")} h`;
}
