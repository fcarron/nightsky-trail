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
  maxAbsGradientPercent: number;
  points: ElevationPoint[];
  gradientBands: ElevationGradientBand[];
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

export interface GradientGroup {
  id: string;
  label: string;
  color: string;
}

export const GRADIENT_GROUPS: GradientGroup[] = [
  { id: "easy", label: "<5%", color: "#dcefb4" },
  { id: "moderate", label: "5-10%", color: "#f4d35e" },
  { id: "strong", label: "10-15%", color: "#f59e42" },
  { id: "steep", label: "15-20%", color: "#e4572e" },
  { id: "very-steep", label: "20-30%", color: "#b91c1c" },
  { id: "extreme", label: ">30%", color: "#7f1d1d" },
];

export function toElevationProfileRequest(
  route: ComputedRoute,
): ElevationProfileRequest {
  return {
    geometry: {
      type: "LineString",
      coordinates: resampleGeometryForElevation(route.geometry).map((coordinate) => [
        coordinate.lon,
        coordinate.lat,
      ]),
    },
  };
}

const ELEVATION_GEOMETRY_TARGET_SPACING_METERS = 30;
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
    Math.max(2, Math.ceil(totalDistance / ELEVATION_GEOMETRY_TARGET_SPACING_METERS) + 1),
  );
  const spacing = totalDistance / (targetPointCount - 1);

  const sampled = [];
  let segmentIndex = 1;
  for (let index = 0; index < targetPointCount; index += 1) {
    const targetDistance = index === targetPointCount - 1 ? totalDistance : index * spacing;
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
      distances[index - 1] + distanceMeters(geometry[index - 1], geometry[index]),
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
