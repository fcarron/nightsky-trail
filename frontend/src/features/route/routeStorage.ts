import type { RoutePlan, RouteSegment, Waypoint } from "./routeModel";
import { emptyPlan, normalizeRoutePlan } from "./routePlanner";

const STORAGE_KEY = "swiss-route-planner.active-route.v1";

export function loadStoredRoute(
  storage: Storage = window.localStorage,
): RoutePlan {
  const rawValue = storage.getItem(STORAGE_KEY);
  if (!rawValue) {
    return emptyPlan;
  }

  try {
    return normalizeRoutePlan(parseRoutePlan(JSON.parse(rawValue)));
  } catch {
    return emptyPlan;
  }
}

export function saveStoredRoute(
  plan: RoutePlan,
  storage: Storage = window.localStorage,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(plan));
}

export function clearStoredRoute(storage: Storage = window.localStorage): void {
  storage.removeItem(STORAGE_KEY);
}

function parseRoutePlan(value: unknown): RoutePlan {
  if (!isRecord(value)) {
    throw new Error("Stored route is not an object.");
  }

  const waypoints = parseWaypoints(value.waypoints);
  const segments = parseSegments(value.segments);
  return { waypoints, segments };
}

function parseWaypoints(value: unknown): Waypoint[] {
  if (!Array.isArray(value)) {
    throw new Error("Stored route waypoints are invalid.");
  }

  return value.map((waypoint) => {
    if (!isRecord(waypoint) || typeof waypoint.id !== "string") {
      throw new Error("Stored route waypoint is invalid.");
    }

    const position = waypoint.position;
    if (
      !isRecord(position) ||
      typeof position.lon !== "number" ||
      typeof position.lat !== "number" ||
      !Number.isFinite(position.lon) ||
      !Number.isFinite(position.lat)
    ) {
      throw new Error("Stored route waypoint position is invalid.");
    }

    return {
      id: waypoint.id,
      position: {
        lon: position.lon,
        lat: position.lat,
      },
    };
  });
}

function parseSegments(value: unknown): RouteSegment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((segment) => {
    if (
      !isRecord(segment) ||
      typeof segment.id !== "string" ||
      typeof segment.fromWaypointId !== "string" ||
      typeof segment.toWaypointId !== "string" ||
      (segment.mode !== "straight" && segment.mode !== "routed")
    ) {
      throw new Error("Stored route segment is invalid.");
    }

    return {
      id: segment.id,
      fromWaypointId: segment.fromWaypointId,
      toWaypointId: segment.toWaypointId,
      mode: segment.mode,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
