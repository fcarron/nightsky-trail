import type {
  ComputedRouteSegmentDto,
  RouteComputeRequest,
  RouteComputeResponse,
} from "../../types/api";
import type { ComputedRoute, RoutePlan } from "./routeModel";

export function toRouteComputeRequest(plan: RoutePlan): RouteComputeRequest {
  return {
    waypoints: plan.waypoints.map((waypoint) => ({
      id: waypoint.id,
      longitude: waypoint.position.lon,
      latitude: waypoint.position.lat,
    })),
    segments: plan.segments.map((segment) => ({
      fromWaypointId: segment.fromWaypointId,
      toWaypointId: segment.toWaypointId,
      mode: segment.mode,
    })),
  };
}

export function toComputedRoute(response: RouteComputeResponse): ComputedRoute {
  return {
    geometry: response.geometry.coordinates.map(([lon, lat]) => ({ lon, lat })),
    distanceMeters: response.distanceMeters,
    segments: response.segments.map(toComputedRouteSegment),
    warnings: response.warnings,
  };
}

function toComputedRouteSegment(segment: ComputedRouteSegmentDto) {
  return {
    id: segment.id,
    fromWaypointId: segment.fromWaypointId,
    toWaypointId: segment.toWaypointId,
    mode: segment.mode,
    distanceMeters: segment.distanceMeters,
    geometry: segment.geometry.coordinates.map(([lon, lat]) => ({ lon, lat })),
    details: segment.details,
  };
}
