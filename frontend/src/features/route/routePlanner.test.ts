import { describe, expect, it } from "vitest";

import {
  formatDistance,
  totalStraightLineDistanceMeters,
} from "./routeGeometry";
import { initialPlannerHistory, routePlannerReducer } from "./routePlanner";

describe("route geometry", () => {
  it("calculates straight-line distance across consecutive waypoints", () => {
    const distance = totalStraightLineDistanceMeters([
      { lon: 7.4474, lat: 46.948 },
      { lon: 8.5417, lat: 47.3769 },
    ]);

    expect(distance).toBeGreaterThan(95_000);
    expect(distance).toBeLessThan(97_000);
  });

  it("formats metric distances", () => {
    expect(formatDistance(822)).toBe("822 m");
    expect(formatDistance(12_345)).toBe("12.35 km");
  });
});

describe("route planner reducer", () => {
  it("adds, moves, deletes, undoes, and redoes waypoints", () => {
    let history = initialPlannerHistory;

    history = routePlannerReducer(history, {
      type: "add-waypoint",
      waypoint: { id: "a", position: { lon: 7.4, lat: 46.9 } },
    });
    history = routePlannerReducer(history, {
      type: "add-waypoint",
      waypoint: { id: "b", position: { lon: 8.5, lat: 47.3 } },
    });
    history = routePlannerReducer(history, {
      type: "move-waypoint",
      id: "a",
      position: { lon: 7.5, lat: 46.95 },
    });
    history = routePlannerReducer(history, {
      type: "delete-waypoint",
      id: "b",
    });

    expect(history.present.waypoints).toEqual([
      { id: "a", position: { lon: 7.5, lat: 46.95 } },
    ]);
    expect(history.present.segments).toEqual([]);

    history = routePlannerReducer(history, { type: "undo" });
    expect(history.present.waypoints).toHaveLength(2);
    expect(history.present.segments).toEqual([
      {
        id: "a-b",
        fromWaypointId: "a",
        toWaypointId: "b",
        mode: "routed",
      },
    ]);

    history = routePlannerReducer(history, { type: "redo" });
    expect(history.present.waypoints).toHaveLength(1);
    expect(history.present.segments).toEqual([]);
  });

  it("clears redo history after a new edit", () => {
    let history = routePlannerReducer(initialPlannerHistory, {
      type: "add-waypoint",
      waypoint: { id: "a", position: { lon: 7.4, lat: 46.9 } },
    });

    history = routePlannerReducer(history, { type: "undo" });
    history = routePlannerReducer(history, {
      type: "add-waypoint",
      waypoint: { id: "b", position: { lon: 8.5, lat: 47.3 } },
    });

    expect(history.future).toEqual([]);
    expect(history.present.waypoints.map((waypoint) => waypoint.id)).toEqual([
      "b",
    ]);
  });

  it("allows an existing position to be appended as a new waypoint", () => {
    const firstPosition = { lon: 7.4, lat: 46.9 };
    let history = routePlannerReducer(initialPlannerHistory, {
      type: "add-waypoint",
      waypoint: { id: "a", position: firstPosition },
    });
    history = routePlannerReducer(history, {
      type: "add-waypoint",
      waypoint: { id: "b", position: { lon: 7.5, lat: 47.0 } },
    });
    history = routePlannerReducer(history, {
      type: "add-waypoint",
      waypoint: { id: "c", position: firstPosition },
    });

    expect(history.present.waypoints).toHaveLength(3);
    expect(history.present.waypoints[2]).toEqual({
      id: "c",
      position: firstPosition,
    });
    expect(history.present.segments[1]).toMatchObject({
      fromWaypointId: "b",
      toWaypointId: "c",
    });
  });

  it("starts a new route without retaining the previous undo history", () => {
    let history = routePlannerReducer(initialPlannerHistory, {
      type: "add-waypoint",
      waypoint: { id: "a", position: { lon: 7.4, lat: 46.9 } },
    });

    history = routePlannerReducer(history, {
      type: "reset",
      plan: { routingProfile: "foot", waypoints: [], segments: [] },
    });

    expect(history.present.routingProfile).toBe("foot");
    expect(history.present.waypoints).toEqual([]);
    expect(history.past).toEqual([]);
    expect(history.future).toEqual([]);
  });

  it("converts an imported track into routed segments explicitly", () => {
    const history = routePlannerReducer(
      {
        future: [],
        past: [],
        present: {
          importedGeometry: [
            { lon: 7.4, lat: 46.9 },
            { lon: 7.5, lat: 47 },
          ],
          routingProfile: "hike",
          segments: [
            {
              fromWaypointId: "a",
              id: "a-b",
              mode: "straight",
              toWaypointId: "b",
            },
          ],
          waypoints: [
            { id: "a", position: { lon: 7.4, lat: 46.9 } },
            { id: "b", position: { lon: 7.5, lat: 47 } },
          ],
        },
      },
      { type: "reroute-imported" },
    );

    expect(history.present.importedGeometry).toBeUndefined();
    expect(history.present.waypoints.length).toBeGreaterThan(2);
    expect(history.present.waypoints[0]?.position).toEqual({
      lon: 7.4,
      lat: 46.9,
    });
    expect(history.present.waypoints.at(-1)?.position).toEqual({
      lon: 7.5,
      lat: 47,
    });
    expect(history.present.segments).toHaveLength(
      history.present.waypoints.length - 1,
    );
    expect(
      history.present.segments.every((segment) => segment.mode === "routed"),
    ).toBe(true);
  });

  it("rebuilds routed segments when reversing the route", () => {
    let history = initialPlannerHistory;

    for (const waypoint of [
      { id: "a", position: { lon: 7.4, lat: 46.9 } },
      { id: "b", position: { lon: 8.0, lat: 47.0 } },
      { id: "c", position: { lon: 8.5, lat: 47.3 } },
    ]) {
      history = routePlannerReducer(history, {
        type: "add-waypoint",
        waypoint,
      });
    }

    history = routePlannerReducer(history, { type: "reverse" });

    expect(history.present.waypoints.map((waypoint) => waypoint.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(history.present.segments).toEqual([
      {
        id: "c-b",
        fromWaypointId: "c",
        toWaypointId: "b",
        mode: "routed",
      },
      {
        id: "b-a",
        fromWaypointId: "b",
        toWaypointId: "a",
        mode: "routed",
      },
    ]);
  });

  it("adds routed segments by default and updates a segment mode without changing waypoints", () => {
    let history = initialPlannerHistory;
    history = routePlannerReducer(history, {
      type: "add-waypoint",
      waypoint: { id: "a", position: { lon: 7.4, lat: 46.9 } },
    });
    history = routePlannerReducer(history, {
      type: "add-waypoint",
      waypoint: { id: "b", position: { lon: 8.0, lat: 47.0 } },
    });

    expect(history.present.waypoints.map((waypoint) => waypoint.id)).toEqual([
      "a",
      "b",
    ]);
    expect(history.present.segments[0].mode).toBe("routed");

    history = routePlannerReducer(history, {
      type: "set-segment-mode",
      id: "a-b",
      mode: "straight",
    });

    expect(history.present.waypoints.map((waypoint) => waypoint.id)).toEqual([
      "a",
      "b",
    ]);
    expect(history.present.segments[0].mode).toBe("straight");
  });

  it("uses the requested mode for newly drawn segments", () => {
    let history = initialPlannerHistory;
    history = routePlannerReducer(history, {
      type: "add-waypoint",
      waypoint: { id: "a", position: { lon: 7.4, lat: 46.9 } },
    });
    history = routePlannerReducer(history, {
      type: "add-waypoint",
      segmentMode: "straight",
      waypoint: { id: "b", position: { lon: 8.0, lat: 47.0 } },
    });
    history = routePlannerReducer(history, {
      type: "add-waypoint",
      segmentMode: "routed",
      waypoint: { id: "c", position: { lon: 8.2, lat: 47.1 } },
    });

    expect(history.present.segments).toEqual([
      {
        id: "a-b",
        fromWaypointId: "a",
        toWaypointId: "b",
        mode: "straight",
      },
      {
        id: "b-c",
        fromWaypointId: "b",
        toWaypointId: "c",
        mode: "routed",
      },
    ]);
  });

  it("supports the city foot routing profile while editing", () => {
    let history = routePlannerReducer(initialPlannerHistory, {
      type: "set-routing-profile",
      profile: "foot",
    });
    history = routePlannerReducer(history, {
      type: "add-waypoint",
      waypoint: { id: "a", position: { lon: 7.4, lat: 46.9 } },
    });
    history = routePlannerReducer(history, {
      type: "add-waypoint",
      waypoint: { id: "b", position: { lon: 8.0, lat: 47.0 } },
    });
    history = routePlannerReducer(history, {
      type: "move-waypoint",
      id: "a",
      position: { lon: 7.45, lat: 46.95 },
    });

    expect(history.present.routingProfile).toBe("foot");
  });

  it("replaces the active plan when loading a saved tour", () => {
    const history = routePlannerReducer(initialPlannerHistory, {
      type: "replace",
      plan: {
        routingProfile: "hike",
        waypoints: [{ id: "loaded-a", position: { lon: 7.4, lat: 46.9 } }],
        segments: [],
      },
    });

    expect(history.present.waypoints).toEqual([
      { id: "loaded-a", position: { lon: 7.4, lat: 46.9 } },
    ]);
  });

  it("inserts a waypoint into an existing segment and preserves segment mode", () => {
    let history = initialPlannerHistory;
    history = routePlannerReducer(history, {
      type: "add-waypoint",
      waypoint: { id: "a", position: { lon: 7.4, lat: 46.9 } },
    });
    history = routePlannerReducer(history, {
      type: "add-waypoint",
      waypoint: { id: "b", position: { lon: 8.0, lat: 47.0 } },
    });

    history = routePlannerReducer(history, {
      type: "insert-waypoint",
      segmentId: "a-b",
      waypoint: { id: "x", position: { lon: 7.7, lat: 46.95 } },
    });

    expect(history.present.waypoints.map((waypoint) => waypoint.id)).toEqual([
      "a",
      "x",
      "b",
    ]);
    expect(history.present.segments).toEqual([
      {
        id: "a-x",
        fromWaypointId: "a",
        toWaypointId: "x",
        mode: "routed",
      },
      {
        id: "x-b",
        fromWaypointId: "x",
        toWaypointId: "b",
        mode: "routed",
      },
    ]);
  });

  it("places search results at the start or before the destination", () => {
    let history = initialPlannerHistory;
    history = routePlannerReducer(history, {
      type: "add-waypoint",
      waypoint: { id: "a", position: { lon: 7.4, lat: 46.9 } },
    });
    history = routePlannerReducer(history, {
      type: "add-waypoint",
      segmentMode: "straight",
      waypoint: { id: "b", position: { lon: 7.6, lat: 47.0 } },
    });
    history = routePlannerReducer(history, {
      type: "add-waypoint-at-start",
      waypoint: { id: "start", position: { lon: 7.3, lat: 46.8 } },
    });
    history = routePlannerReducer(history, {
      type: "add-waypoint-before-end",
      waypoint: { id: "via", position: { lon: 7.5, lat: 46.95 } },
    });

    expect(history.present.waypoints.map((waypoint) => waypoint.id)).toEqual([
      "start",
      "a",
      "via",
      "b",
    ]);
    expect(history.present.segments).toEqual([
      expect.objectContaining({
        fromWaypointId: "start",
        toWaypointId: "a",
        mode: "routed",
      }),
      expect.objectContaining({
        fromWaypointId: "a",
        toWaypointId: "via",
        mode: "straight",
      }),
      expect.objectContaining({
        fromWaypointId: "via",
        toWaypointId: "b",
        mode: "straight",
      }),
    ]);
  });
});
