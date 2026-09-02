import { describe, expect, it } from "vitest";

import { createClimbPeakMarkers } from "./climbMarkers";
import type { Climb, ElevationProfile } from "./elevationModel";

describe("climb peak markers", () => {
  it("places the effort category at the climb end point in the profile", () => {
    const profile = profileWithPoints();
    const climb: Climb = {
      averageGradientPercent: 15,
      category: "hart",
      elevationGainMeters: 150,
      endDistanceMeters: 1_000,
      hikingMinutes: 22,
      index: 2,
      maxRelevantGradientPercent: 24,
      runningMinutes: 15,
      score: 4.8,
      startDistanceMeters: 0,
      timePenaltyMinutes: 48,
    };

    expect(createClimbPeakMarkers(profile, [climb])).toEqual([
      {
        coord: [1, 650],
        name: "Anstieg 2: hart",
        value: "hart",
      },
    ]);
  });
});

function profileWithPoints(): ElevationProfile {
  return {
    ascentMeters: 150,
    descentMeters: 0,
    distanceMeters: 1_000,
    gradientBands: [],
    hikingTime: {
      durationMinutes: 22,
      method: "swiss_hiking_polynomial",
      segmentCount: 20,
      segmentLengthMeters: 50,
      smoothingWindowMeters: 40,
    },
    maxAbsGradientPercent: 24,
    maxElevationMeters: 650,
    minElevationMeters: 500,
    points: [
      {
        distanceMeters: 0,
        elevationMeters: 500,
        gradientPercent: 0,
        latitude: 46.9,
        longitude: 7.4,
        smoothedElevationMeters: 500,
      },
      {
        distanceMeters: 1_000,
        elevationMeters: 650,
        gradientPercent: 15,
        latitude: 46.91,
        longitude: 7.41,
        smoothedElevationMeters: 650,
      },
    ],
  };
}
