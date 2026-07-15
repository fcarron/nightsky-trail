export interface HealthResponse {
  status: "ok";
}

export interface RouteComputeRequest {
  waypoints: RouteWaypointDto[];
  segments: RouteSegmentRequestDto[];
}

export interface RouteWaypointDto {
  id: string;
  longitude: number;
  latitude: number;
}

export interface RouteSegmentRequestDto {
  fromWaypointId: string;
  toWaypointId: string;
  mode: "straight" | "routed";
}

export interface RouteComputeResponse {
  geometry: LineStringGeometryDto;
  distanceMeters: number;
  segments: ComputedRouteSegmentDto[];
  warnings: string[];
}

export interface ElevationProfileRequest {
  geometry: LineStringGeometryDto;
}

export interface ElevationProfileResponse {
  distanceMeters: number;
  ascentMeters: number;
  descentMeters: number;
  minElevationMeters: number;
  maxElevationMeters: number;
  points: ElevationProfilePointDto[];
}

export interface TrailsResponse {
  ways: OsmWayDto[];
  warnings: string[];
}

export interface OsmWayDto {
  id: number;
  geometry: LineStringGeometryDto;
  tags: Record<string, string>;
}

export interface ElevationProfilePointDto {
  distanceMeters: number;
  elevationMeters: number;
  smoothedElevationMeters: number;
  gradientPercent: number;
  longitude: number;
  latitude: number;
}

export interface ComputedRouteSegmentDto {
  id: string;
  fromWaypointId: string;
  toWaypointId: string;
  mode: "straight" | "routed";
  distanceMeters: number;
  geometry: LineStringGeometryDto;
  details: Record<string, unknown>;
}

export interface LineStringGeometryDto {
  type: "LineString";
  coordinates: [number, number][];
}

export interface ApiErrorResponse {
  code: string;
  message: string;
  details: Record<string, unknown>;
}
