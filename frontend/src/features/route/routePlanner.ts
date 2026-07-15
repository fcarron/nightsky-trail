import type {
  LonLat,
  RoutePlan,
  RouteSegment,
  SegmentMode,
  Waypoint,
} from "./routeModel";

export interface PlannerHistory {
  past: RoutePlan[];
  present: RoutePlan;
  future: RoutePlan[];
}

export type PlannerAction =
  | { type: "add-waypoint"; waypoint: { id: string; position: LonLat } }
  | {
      type: "insert-waypoint";
      segmentId: string;
      waypoint: { id: string; position: LonLat };
    }
  | { type: "move-waypoint"; id: string; position: LonLat }
  | { type: "set-segment-mode"; id: string; mode: SegmentMode }
  | { type: "delete-waypoint"; id: string }
  | { type: "clear" }
  | { type: "reverse" }
  | { type: "undo" }
  | { type: "redo" };

export const emptyPlan: RoutePlan = {
  waypoints: [],
  segments: [],
};

export const initialPlannerHistory: PlannerHistory = {
  past: [],
  present: emptyPlan,
  future: [],
};

export function createPlannerHistory(
  plan: RoutePlan = emptyPlan,
): PlannerHistory {
  return {
    past: [],
    present: normalizeRoutePlan(plan),
    future: [],
  };
}

export function routePlannerReducer(
  history: PlannerHistory,
  action: PlannerAction,
): PlannerHistory {
  switch (action.type) {
    case "add-waypoint":
      return commit(history, addWaypoint(history.present, action.waypoint));

    case "insert-waypoint":
      return commit(
        history,
        insertWaypoint(history.present, action.segmentId, action.waypoint),
      );

    case "move-waypoint":
      return commit(history, {
        waypoints: history.present.waypoints.map((waypoint) =>
          waypoint.id === action.id
            ? { ...waypoint, position: action.position }
            : waypoint,
        ),
        segments: history.present.segments,
      });

    case "set-segment-mode":
      return commit(history, {
        waypoints: history.present.waypoints,
        segments: history.present.segments.map((segment) =>
          segment.id === action.id
            ? { ...segment, mode: action.mode }
            : segment,
        ),
      });

    case "delete-waypoint":
      return commit(history, deleteWaypoint(history.present, action.id));

    case "clear":
      return commit(history, emptyPlan);

    case "reverse": {
      const waypoints = [...history.present.waypoints].reverse();
      return commit(history, {
        waypoints,
        segments: rebuildRoutedSegments(waypoints),
      });
    }

    case "undo": {
      const previous = history.past.at(-1);
      if (!previous) {
        return history;
      }

      return {
        past: history.past.slice(0, -1),
        present: previous,
        future: [history.present, ...history.future],
      };
    }

    case "redo": {
      const next = history.future[0];
      if (!next) {
        return history;
      }

      return {
        past: [...history.past, history.present],
        present: next,
        future: history.future.slice(1),
      };
    }
  }
}

export function normalizeRoutePlan(plan: RoutePlan): RoutePlan {
  return {
    waypoints: plan.waypoints,
    segments: plan.segments.length
      ? plan.segments
      : rebuildRoutedSegments(plan.waypoints),
  };
}

export function rebuildStraightSegments(waypoints: Waypoint[]): RouteSegment[] {
  return waypoints.slice(1).map((waypoint, index) => {
    const previousWaypoint = waypoints[index];
    return createStraightSegment(previousWaypoint.id, waypoint.id);
  });
}

export function rebuildRoutedSegments(waypoints: Waypoint[]): RouteSegment[] {
  return waypoints.slice(1).map((waypoint, index) => {
    const previousWaypoint = waypoints[index];
    return createRoutedSegment(previousWaypoint.id, waypoint.id);
  });
}

function commit(history: PlannerHistory, nextPlan: RoutePlan): PlannerHistory {
  const normalizedPlan = normalizeRoutePlan(nextPlan);
  if (
    Object.is(history.present, normalizedPlan) ||
    plansEqual(history.present, normalizedPlan)
  ) {
    return history;
  }

  return {
    past: [...history.past, history.present],
    present: normalizedPlan,
    future: [],
  };
}

function addWaypoint(plan: RoutePlan, waypoint: Waypoint): RoutePlan {
  const previousWaypoint = plan.waypoints.at(-1);
  return {
    waypoints: [...plan.waypoints, waypoint],
    segments: previousWaypoint
      ? [
          ...plan.segments,
          createRoutedSegment(previousWaypoint.id, waypoint.id),
        ]
      : plan.segments,
  };
}

function insertWaypoint(
  plan: RoutePlan,
  segmentId: string,
  waypoint: Waypoint,
): RoutePlan {
  const segmentIndex = plan.segments.findIndex(
    (segment) => segment.id === segmentId,
  );
  if (segmentIndex < 0) {
    return addWaypoint(plan, waypoint);
  }

  const segment = plan.segments[segmentIndex];
  const waypointIndex = plan.waypoints.findIndex(
    (item) => item.id === segment.toWaypointId,
  );
  if (waypointIndex < 1) {
    return addWaypoint(plan, waypoint);
  }

  return {
    waypoints: [
      ...plan.waypoints.slice(0, waypointIndex),
      waypoint,
      ...plan.waypoints.slice(waypointIndex),
    ],
    segments: [
      ...plan.segments.slice(0, segmentIndex),
      createSegment(segment.fromWaypointId, waypoint.id, segment.mode),
      createSegment(waypoint.id, segment.toWaypointId, segment.mode),
      ...plan.segments.slice(segmentIndex + 1),
    ],
  };
}

function deleteWaypoint(plan: RoutePlan, waypointId: string): RoutePlan {
  const waypoints = plan.waypoints.filter(
    (waypoint) => waypoint.id !== waypointId,
  );
  return {
    waypoints,
    segments: rebuildRoutedSegments(waypoints),
  };
}

function createStraightSegment(
  fromWaypointId: string,
  toWaypointId: string,
): RouteSegment {
  return createSegment(fromWaypointId, toWaypointId, "straight");
}

function createRoutedSegment(
  fromWaypointId: string,
  toWaypointId: string,
): RouteSegment {
  return createSegment(fromWaypointId, toWaypointId, "routed");
}

function createSegment(
  fromWaypointId: string,
  toWaypointId: string,
  mode: SegmentMode,
): RouteSegment {
  return {
    id: `${fromWaypointId}-${toWaypointId}`,
    fromWaypointId,
    toWaypointId,
    mode,
  };
}

function plansEqual(first: RoutePlan, second: RoutePlan): boolean {
  if (
    first.waypoints.length !== second.waypoints.length ||
    first.segments.length !== second.segments.length
  ) {
    return false;
  }

  const waypointsEqual = first.waypoints.every((waypoint, index) => {
    const other = second.waypoints[index];
    return (
      waypoint.id === other.id &&
      waypoint.position.lon === other.position.lon &&
      waypoint.position.lat === other.position.lat
    );
  });

  const segmentsEqual = first.segments.every((segment, index) => {
    const other = second.segments[index];
    return (
      segment.id === other.id &&
      segment.fromWaypointId === other.fromWaypointId &&
      segment.toWaypointId === other.toWaypointId &&
      segment.mode === other.mode
    );
  });

  return waypointsEqual && segmentsEqual;
}
