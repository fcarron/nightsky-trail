import { describe, expect, it } from "vitest";

import type { ComputedRoute } from "../route/routeModel";
import {
  FLAT_HIKING_PACE_MIN_PER_KM,
  calculateKilometreSplits,
  climbCategoryForScore,
  detectClimbs,
  estimatePersonalRunningMinutes,
  resampleGeometryForElevation,
  toElevationProfileRequest,
} from "./elevationModel";
import type { ElevationProfile } from "./elevationModel";

describe("elevation profile request geometry", () => {
  it("keeps short route geometry unchanged", () => {
    const route = buildRoute([
      { lon: 7.4, lat: 46.9 },
      { lon: 7.41, lat: 46.91 },
    ]);

    expect(toElevationProfileRequest(route).geometry.coordinates).toEqual([
      [7.4, 46.9],
      [7.41, 46.91],
    ]);
  });

  it("limits dense route geometry before requesting elevation", () => {
    const geometry = Array.from({ length: 2_000 }, (_, index) => ({
      lon: 7.4 + index * 0.00001,
      lat: 46.9 + index * 0.00001,
    }));

    const sampled = resampleGeometryForElevation(geometry);

    expect(sampled.length).toBeLessThanOrEqual(800);
    expect(sampled[0]).toEqual(geometry[0]);
    expect(sampled[sampled.length - 1]).toEqual(geometry[geometry.length - 1]);
  });
});

describe("personal running-time estimate", () => {
  it("keeps the configured flat running pace unchanged", () => {
    const profile = buildProfile(samplesForSlope(1_000, 0));

    expect(estimatePersonalRunningMinutes(profile, 6.5)).toBe(7);
  });

  it("adds the uphill correction only on positive slopes", () => {
    const uphill = buildProfile(samplesForSlope(1_000, 10));
    const downhill = buildProfile(samplesForSlope(1_000, -10));
    const flatRunningPace = 6.5;
    const scale = flatRunningPace / FLAT_HIKING_PACE_MIN_PER_KM;
    const uphillHikingPace = swissHikingMinutesPerKmForTest(10);
    const downhillHikingPace = swissHikingMinutesPerKmForTest(-10);

    expect(estimatePersonalRunningMinutes(uphill, flatRunningPace)).toBe(
      Math.round(
        flatRunningPace +
          (uphillHikingPace - FLAT_HIKING_PACE_MIN_PER_KM) * scale * 1.2,
      ),
    );
    expect(estimatePersonalRunningMinutes(downhill, flatRunningPace)).toBe(
      Math.round(
        flatRunningPace +
          (downhillHikingPace - FLAT_HIKING_PACE_MIN_PER_KM) * scale,
      ),
    );
  });

  it("sums unrounded segment times and includes the final partial segment", () => {
    const profile = buildProfile(samplesForSlope(125, 0));

    expect(estimatePersonalRunningMinutes(profile, 6.5)).toBe(
      Math.round(0.125 * 6.5),
    );
  });

  it("is independent from the original elevation-point density", () => {
    const sparse = buildProfile(samplesForSlope(1_000, 10, 100));
    const dense = buildProfile(samplesForSlope(1_000, 10, 10));

    expect(estimatePersonalRunningMinutes(sparse, 6.5)).toBe(
      estimatePersonalRunningMinutes(dense, 6.5),
    );
  });
});

describe("route analysis", () => {
  it("assigns FIETS-inspired climb categories at the defined thresholds", () => {
    expect(climbCategoryForScore(6.5)).toBe("HC");
    expect(climbCategoryForScore(5)).toBe("1");
    expect(climbCategoryForScore(3.5)).toBe("2");
    expect(climbCategoryForScore(2)).toBe("3");
    expect(climbCategoryForScore(0.5)).toBe("4");
    expect(climbCategoryForScore(0.25)).toBe("5");
    expect(climbCategoryForScore(0.24)).toBeNull();
  });

  it("creates kilometre splits including the final partial kilometre", () => {
    const splits = calculateKilometreSplits(
      buildProfile(samplesForSlope(2_250, 10)),
      6.5,
    );

    expect(splits).toHaveLength(3);
    expect(splits[2]).toMatchObject({
      startDistanceMeters: 2_000,
      endDistanceMeters: 2_250,
    });
    expect(splits[0].ascentMeters).toBeCloseTo(100, 0);
    expect(splits[0].runningMinutes).not.toBeNull();
  });

  it("keeps a short interruption inside a continuous climb", () => {
    const profile = buildProfile([
      ...samplesForSlope(600, 20),
      {
        distanceMeters: 700,
        elevationMeters: 110,
        smoothedElevationMeters: 110,
        gradientPercent: -10,
        latitude: 46.9,
        longitude: 7.4,
      },
      {
        distanceMeters: 1_800,
        elevationMeters: 330,
        smoothedElevationMeters: 330,
        gradientPercent: 20,
        latitude: 46.9,
        longitude: 7.4,
      },
    ]);
    const climbs = detectClimbs(profile, 6.5);

    expect(climbs).toHaveLength(1);
    expect(climbs[0]).toMatchObject({
      elevationGainMeters: 330,
      score: expect.closeTo(6.05, 1),
    });
  });
});

function buildRoute(geometry: ComputedRoute["geometry"]): ComputedRoute {
  return {
    distanceMeters: 0,
    geometry,
    segments: [],
    warnings: [],
  };
}

function samplesForSlope(
  distanceMeters: number,
  slopePercent: number,
  spacingMeters = 25,
) {
  const samples = [];
  for (let distance = 0; distance < distanceMeters; distance += spacingMeters) {
    samples.push({
      distanceMeters: distance,
      elevationMeters: (distance * slopePercent) / 100,
      gradientPercent: slopePercent,
      latitude: 46.9,
      longitude: 7.4,
      smoothedElevationMeters: (distance * slopePercent) / 100,
    });
  }
  samples.push({
    distanceMeters,
    elevationMeters: (distanceMeters * slopePercent) / 100,
    gradientPercent: slopePercent,
    latitude: 46.9,
    longitude: 7.4,
    smoothedElevationMeters: (distanceMeters * slopePercent) / 100,
  });
  return samples;
}

function buildProfile(points: ElevationProfile["points"]): ElevationProfile {
  return {
    ascentMeters: 0,
    descentMeters: 0,
    distanceMeters: points[points.length - 1]?.distanceMeters ?? 0,
    gradientBands: [],
    hikingTime: {
      durationMinutes: 0,
      method: "swiss_hiking_polynomial",
      segmentCount: 0,
      segmentLengthMeters: 50,
      smoothingWindowMeters: 40,
    },
    maxAbsGradientPercent: 0,
    maxElevationMeters: 0,
    minElevationMeters: 0,
    points,
  };
}

function swissHikingMinutesPerKmForTest(slopePercent: number): number {
  const coefficients = [
    14.271, 3.6991, 2.5922, -1.4384, 0.32105, 0.81542, -0.090261, -0.20757,
    0.010192, 0.028588, -0.00057466, -0.0021842, 0.000015176, 0.000086894,
    -0.00000013584, -0.0000014026,
  ];
  const s = slopePercent / 10;
  if (s > -4 && s < 4) {
    return coefficients.reduceRight(
      (result, coefficient) => result * s + coefficient,
      0,
    );
  }
  if (s >= 4) {
    return 17 * s;
  }
  return -9 * s;
}
