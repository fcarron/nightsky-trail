import type { Climb, ElevationProfile } from "./elevationModel";

export type ClimbPeakDatum = {
  coord: [number, number];
  name: string;
  value: string;
};

export function createClimbPeakMarkers(
  profile: ElevationProfile,
  climbs: Climb[],
): ClimbPeakDatum[] {
  return climbs.map((climb) => {
    const peak = nearestPointAtDistance(profile, climb.endDistanceMeters);

    return {
      coord: [
        climb.endDistanceMeters / 1000,
        peak?.smoothedElevationMeters ?? profile.maxElevationMeters,
      ],
      name: `Anstieg ${climb.index}: ${climb.category}`,
      value: climb.category,
    };
  });
}

function nearestPointAtDistance(
  profile: ElevationProfile,
  distanceMeters: number,
) {
  return profile.points.reduce(
    (nearest, point) =>
      Math.abs(point.distanceMeters - distanceMeters) <
      Math.abs(nearest.distanceMeters - distanceMeters)
        ? point
        : nearest,
    profile.points[0],
  );
}
