export interface HealthResponse {
  status: "ok";
}

export interface AuthSessionResponse {
  authenticated: boolean;
  user: AuthUserDto | null;
}

export interface AuthUserDto {
  id: number;
  username: string;
}

export interface SavedTourDto {
  id: string;
  name: string;
  routeData: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface SavedTourResponse {
  tour: SavedTourDto;
}

export interface SavedTourListResponse {
  tours: SavedTourDto[];
}

export interface SearchResponse {
  results: SearchResultDto[];
}

export interface SearchResultDto {
  id: string;
  label: string;
  origin: string;
  longitude: number;
  latitude: number;
  zoom: number;
}

export interface RouteComputeRequest {
  waypoints: RouteWaypointDto[];
  segments: RouteSegmentRequestDto[];
  profile: "hike";
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
  hikingTime: HikingTimeDto;
  points: ElevationProfilePointDto[];
}

export interface HikingTimeDto {
  duration_minutes: number;
  method: "swiss_hiking_polynomial";
  segment_length_m: number;
  smoothing_window_m: number;
  segment_count: number;
}

export interface TrailsResponse {
  ways: OsmWayDto[];
  trailSummary: TrailSummaryDto;
  officialSegments: OfficialTrailSegmentDto[];
  combinedSegments: CombinedTrailSegmentDto[];
  warnings: string[];
}

export interface TrailSummaryDto {
  totalWays: number;
  byLabel: Record<string, number>;
  commonTags: TrailSummaryTagDto[];
}

export interface TrailSummaryTagDto {
  key: string;
  value: string;
  count: number;
}

export interface OsmWayDto {
  id: number;
  geometry: LineStringGeometryDto;
  tags: Record<string, string>;
}

export interface OfficialTrailSegmentDto {
  id: string;
  officialCategory: string;
  geometry: LineStringGeometryDto;
}

export interface CombinedTrailSegmentDto {
  osmWayId: number;
  swisstopoId: string | null;
  officialCategory: string | null;
  osmSacScale: string | null;
  tLevel: number | null;
  matchScore: number;
  matchStatus:
    "matched" | "ambiguous" | "osm_only" | "swisstopo_only" | "unknown";
  warningOverlay: boolean;
  geometry: LineStringGeometryDto;
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
