export interface LonLat {
  lon: number;
  lat: number;
}

export interface Waypoint {
  id: string;
  position: LonLat;
}

export type SegmentMode = "straight" | "routed";

export interface RouteSegment {
  id: string;
  fromWaypointId: string;
  toWaypointId: string;
  mode: SegmentMode;
}

export interface ComputedRouteSegment extends RouteSegment {
  distanceMeters: number;
  geometry: LonLat[];
  details: Record<string, unknown>;
}

export interface ComputedRoute {
  geometry: LonLat[];
  distanceMeters: number;
  segments: ComputedRouteSegment[];
  warnings: string[];
}

export interface RoutePlan {
  waypoints: Waypoint[];
  segments: RouteSegment[];
}

export interface RouteSummary {
  waypointCount: number;
  segmentCount: number;
  distanceMeters: number;
}
