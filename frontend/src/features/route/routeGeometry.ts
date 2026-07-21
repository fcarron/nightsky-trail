import type {
  LonLat,
  RoutePlan,
  RouteSegment,
  RouteSummary,
  Waypoint,
} from "./routeModel";

const EARTH_RADIUS_METERS = 6_371_000;

export function distanceMetersBetween(start: LonLat, end: LonLat): number {
  const startLat = toRadians(start.lat);
  const endLat = toRadians(end.lat);
  const deltaLat = toRadians(end.lat - start.lat);
  const deltaLon = toRadians(end.lon - start.lon);

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLon / 2) ** 2;

  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function totalStraightLineDistanceMeters(waypoints: LonLat[]): number {
  return waypoints.slice(1).reduce((total, waypoint, index) => {
    return total + distanceMetersBetween(waypoints[index], waypoint);
  }, 0);
}

export function summarizeRoute(plan: RoutePlan): RouteSummary {
  return {
    waypointCount: plan.waypoints.length,
    segmentCount: plan.segments.length,
    distanceMeters: plan.importedGeometry
      ? totalStraightLineDistanceMeters(plan.importedGeometry)
      : totalSegmentDistanceMeters(plan.waypoints, plan.segments),
  };
}

export function totalSegmentDistanceMeters(
  waypoints: Waypoint[],
  segments: RouteSegment[],
): number {
  const waypointById = new Map(
    waypoints.map((waypoint) => [waypoint.id, waypoint]),
  );

  return segments.reduce((total, segment) => {
    const from = waypointById.get(segment.fromWaypointId);
    const to = waypointById.get(segment.toWaypointId);
    if (!from || !to) {
      return total;
    }

    return total + distanceMetersBetween(from.position, to.position);
  }, 0);
}

export function formatDistance(meters: number): string {
  if (meters < 1_000) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1_000).toFixed(2)} km`;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
