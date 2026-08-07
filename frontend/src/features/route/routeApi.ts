import type {
  ComputedRouteSegmentDto,
  RouteComputeRequest,
  RouteComputeResponse,
} from "../../types/api";
import type { ComputedRoute, RoutePlan } from "./routeModel";
import { totalStraightLineDistanceMeters } from "./routeGeometry";

export function toRouteComputeRequest(plan: RoutePlan): RouteComputeRequest {
  return {
    profile: plan.routingProfile,
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

export function toImportedComputedRoute(plan: RoutePlan): ComputedRoute | null {
  const geometry = plan.importedGeometry;
  const firstWaypoint = plan.waypoints[0];
  const lastWaypoint = plan.waypoints.at(-1);
  if (!geometry || geometry.length < 2 || !firstWaypoint || !lastWaypoint) {
    return null;
  }

  const distanceMeters = totalStraightLineDistanceMeters(geometry);
  const segment = plan.segments[0];
  return {
    distanceMeters,
    geometry,
    segments: [
      {
        details: { importedGpx: true },
        distanceMeters,
        fromWaypointId: segment?.fromWaypointId ?? firstWaypoint.id,
        geometry,
        id: segment?.id ?? `${firstWaypoint.id}-${lastWaypoint.id}`,
        mode: "straight",
        toWaypointId: segment?.toWaypointId ?? lastWaypoint.id,
      },
    ],
    warnings: [],
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
