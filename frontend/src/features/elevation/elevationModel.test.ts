import { describe, expect, it } from "vitest";

import type { ComputedRoute } from "../route/routeModel";
import {
  DEFAULT_RUNNING_UPHILL_CORRECTION,
  FLAT_HIKING_PACE_MIN_PER_KM,
  calculateGradientDistribution,
  calculateKilometreSplits,
  calculateSustainedGradients,
  climbEffortCategoryForScore,
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

  it("keeps approximately 25 metre geometry spacing for long routes", () => {
    const geometry = Array.from({ length: 2_001 }, (_, index) => ({
      lon: 7.4 + index * 0.0001,
      lat: 46.9,
    }));

    const sampled = resampleGeometryForElevation(geometry);

    expect(sampled.length).toBeGreaterThan(500);
    expect(sampled.length).toBeLessThanOrEqual(6_000);
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
          (uphillHikingPace - FLAT_HIKING_PACE_MIN_PER_KM) *
            scale *
            DEFAULT_RUNNING_UPHILL_CORRECTION,
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
  it("assigns effort categories at the defined score thresholds", () => {
    expect(climbEffortCategoryForScore(0.99)).toBe("leicht");
    expect(climbEffortCategoryForScore(1)).toBe("moderat");
    expect(climbEffortCategoryForScore(2.5)).toBe("anspruchsvoll");
    expect(climbEffortCategoryForScore(4.5)).toBe("hart");
    expect(climbEffortCategoryForScore(7.5)).toBe("sehr hart");
    expect(climbEffortCategoryForScore(13)).toBe("extrem");
  });

  it("scores a climb from its segment-wise hiking-time penalty", () => {
    const profile = buildProfile([
      elevationPoint(0, 0),
      elevationPoint(500, 100),
      elevationPoint(1_000, 100),
    ]);

    const [climb] = detectClimbs(profile);
    const expectedPenalty =
      (swissHikingMinutesPerKmForTest(20) - FLAT_HIKING_PACE_MIN_PER_KM) * 0.5;

    expect(climb.timePenaltyMinutes).toBeCloseTo(expectedPenalty, 5);
    expect(climb.score).toBeCloseTo(expectedPenalty / 10, 5);
  });

  it("keeps a short but noticeable descent inside a continuous climb", () => {
    const climbs = detectClimbs(
      buildProfile([
        elevationPoint(0, 0),
        elevationPoint(500, 120),
        elevationPoint(700, 70),
        elevationPoint(1_400, 220),
      ]),
    );

    expect(climbs).toHaveLength(1);
    expect(climbs[0]).toMatchObject({
      startDistanceMeters: 0,
      endDistanceMeters: 1_400,
      elevationGainMeters: 220,
    });
  });

  it("keeps a large climb together when a 70 m valley recovers quickly", () => {
    const climbs = detectClimbs(
      buildProfile([
        elevationPoint(0, 0),
        elevationPoint(2_500, 500),
        elevationPoint(2_600, 430),
        elevationPoint(2_750, 500),
        elevationPoint(4_750, 900),
      ]),
    );

    expect(climbs).toHaveLength(1);
    expect(climbs[0]).toMatchObject({
      startDistanceMeters: 0,
      endDistanceMeters: 4_750,
      elevationGainMeters: 900,
    });
  });

  it("splits a large climb after a long unrecovered valley", () => {
    const climbs = detectClimbs(
      buildProfile([
        elevationPoint(0, 0),
        elevationPoint(2_500, 500),
        elevationPoint(2_600, 430),
        elevationPoint(4_250, 430),
        elevationPoint(6_250, 830),
      ]),
    );

    expect(climbs).toHaveLength(2);
    expect(climbs.map((climb) => climb.elevationGainMeters)).toEqual([
      500, 400,
    ]);
  });

  it("splits a large climb immediately after a loss above its hard threshold", () => {
    const climbs = detectClimbs(
      buildProfile([
        elevationPoint(0, 0),
        elevationPoint(5_000, 1_000),
        elevationPoint(5_200, 840),
        elevationPoint(7_200, 1_240),
      ]),
    );

    expect(climbs).toHaveLength(2);
    expect(climbs.map((climb) => climb.elevationGainMeters)).toEqual([
      1_000, 400,
    ]);
  });

  it("ends a climb after a long plateau without a new high point", () => {
    const climbs = detectClimbs(
      buildProfile([
        elevationPoint(0, 0),
        elevationPoint(2_500, 500),
        elevationPoint(3_200, 500),
      ]),
    );

    expect(climbs).toHaveLength(1);
    expect(climbs[0]?.endDistanceMeters).toBe(2_500);
  });

  it("splits climbs after a sustained meaningful descent", () => {
    const climbs = detectClimbs(
      buildProfile([
        elevationPoint(0, 0),
        elevationPoint(600, 120),
        elevationPoint(1_000, 60),
        elevationPoint(1_700, 180),
      ]),
    );

    expect(climbs).toHaveLength(2);
    expect(climbs.map((climb) => climb.elevationGainMeters)).toEqual([
      120, 120,
    ]);
  });

  it("filters climbs with less than five extra hiking minutes", () => {
    const climbs = detectClimbs(
      buildProfile([elevationPoint(0, 0), elevationPoint(800, 80)]),
    );

    expect(climbs).toEqual([]);
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

  it("weights gradient bins by their segment distance", () => {
    const distribution = calculateGradientDistribution(
      buildProfile([
        elevationPoint(0, 0),
        elevationPoint(100, 10),
        elevationPoint(400, -50),
      ]),
    );

    expect(
      distribution.find((bin) => bin.label === "10 bis 12.5 %"),
    ).toMatchObject({
      ascentMeters: 10,
      descentMeters: 0,
      distanceMeters: 100,
    });
    expect(
      distribution.find((bin) => bin.label === "-20 bis -17.5 %"),
    ).toMatchObject({
      ascentMeters: 0,
      descentMeters: 60,
      distanceMeters: 300,
    });
    expect(
      distribution.reduce((total, bin) => total + bin.distanceMeters, 0),
    ).toBe(400);
  });

  it("finds steep gradients over sustained distance windows", () => {
    const sustainedGradients = calculateSustainedGradients(
      buildProfile([
        elevationPoint(0, 0),
        elevationPoint(100, 20),
        elevationPoint(200, 0),
        elevationPoint(500, 50),
        elevationPoint(1_000, -50),
      ]),
    );

    expect(sustainedGradients).toEqual([
      {
        downhillGradientPercent: -20,
        downhillRange: {
          endDistanceMeters: 200,
          startDistanceMeters: 100,
        },
        uphillGradientPercent: 20,
        uphillRange: {
          endDistanceMeters: 100,
          startDistanceMeters: 0,
        },
        windowMeters: 100,
      },
      {
        downhillGradientPercent: -20,
        downhillRange: {
          endDistanceMeters: 1_000,
          startDistanceMeters: 500,
        },
        uphillGradientPercent: 10,
        uphillRange: {
          endDistanceMeters: 500,
          startDistanceMeters: 0,
        },
        windowMeters: 500,
      },
      {
        downhillGradientPercent: -5,
        downhillRange: {
          endDistanceMeters: 1_000,
          startDistanceMeters: 0,
        },
        uphillGradientPercent: null,
        uphillRange: null,
        windowMeters: 1_000,
      },
    ]);
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
      score: expect.any(Number),
      timePenaltyMinutes: expect.any(Number),
    });
    expect(climbs[0].score).toBeCloseTo(climbs[0].timePenaltyMinutes / 10, 5);
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

function elevationPoint(distanceMeters: number, elevationMeters: number) {
  return {
    distanceMeters,
    elevationMeters,
    gradientPercent: 0,
    latitude: 46.9,
    longitude: 7.4,
    smoothedElevationMeters: elevationMeters,
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
