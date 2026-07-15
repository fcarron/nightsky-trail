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
      coordinates: route.geometry.map((coordinate) => [
        coordinate.lon,
        coordinate.lat,
      ]),
    },
  };
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
