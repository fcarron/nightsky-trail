import type { LonLat, RoutePlan, RouteSegment, Waypoint } from "./routeModel";

export function exportPointsToGpx(points: LonLat[], name: string): string {
  const escapedName = escapeXml(name);
  const trackPoints = points
    .map(
      (point) =>
        `      <trkpt lat="${point.lat.toFixed(7)}" lon="${point.lon.toFixed(7)}" />`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="nightsky trail" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapedName}</name>
  </metadata>
  <trk>
    <name>${escapedName}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>
`;
}

export function importRoutePlanFromGpx(gpxText: string): RoutePlan {
  const document = new DOMParser().parseFromString(gpxText, "application/xml");
  if (document.querySelector("parsererror")) {
    throw new Error("GPX konnte nicht gelesen werden.");
  }

  const trackPoints = pointsFromElements(document, "trkpt");
  const routePoints = pointsFromElements(document, "rtept");
  const waypointPoints = pointsFromElements(document, "wpt");
  // A GPX export may carry control waypoints alongside its full track. The
  // track is the authoritative geometry; appending the waypoints would create
  // artificial return legs after its endpoint.
  const points =
    trackPoints.length > 0
      ? trackPoints
      : routePoints.length > 0
        ? routePoints
        : waypointPoints;
  if (points.length < 2) {
    throw new Error("GPX enthält zu wenige Punkte.");
  }

  const waypoints: Waypoint[] = [points[0], points[points.length - 1]].map(
    (position, index) => ({
      id: `gpx-${index + 1}`,
      position,
    }),
  );
  const segments: RouteSegment[] = waypoints.slice(1).map((waypoint, index) => {
    const previousWaypoint = waypoints[index];
    return {
      fromWaypointId: previousWaypoint.id,
      id: `${previousWaypoint.id}-${waypoint.id}`,
      mode: "straight",
      toWaypointId: waypoint.id,
    };
  });

  return {
    importedGeometry: points,
    routingProfile: "hike",
    segments,
    waypoints,
  };
}

function pointsFromElements(document: Document, tagName: string): LonLat[] {
  return Array.from(document.getElementsByTagNameNS("*", tagName)).flatMap(
    (element) => {
      const lat = Number(element.getAttribute("lat"));
      const lon = Number(element.getAttribute("lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return [];
      }
      return [{ lat, lon }];
    },
  );
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
