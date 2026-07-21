import { describe, expect, it } from "vitest";

import { loadStoredRoute, saveStoredRoute } from "./routeStorage";

describe("route storage", () => {
  it("saves and loads a route plan", () => {
    const storage = window.localStorage;
    storage.clear();

    saveStoredRoute(
      {
        routingProfile: "hike",
        waypoints: [
          { id: "a", position: { lon: 7.4, lat: 46.9 } },
          { id: "b", position: { lon: 8.5, lat: 47.3 } },
        ],
        segments: [
          {
            id: "a-b",
            fromWaypointId: "a",
            toWaypointId: "b",
            mode: "straight",
          },
        ],
      },
      storage,
    );

    expect(loadStoredRoute(storage)).toEqual({
      routingProfile: "hike",
      waypoints: [
        { id: "a", position: { lon: 7.4, lat: 46.9 } },
        { id: "b", position: { lon: 8.5, lat: 47.3 } },
      ],
      segments: [
        {
          id: "a-b",
          fromWaypointId: "a",
          toWaypointId: "b",
          mode: "straight",
        },
      ],
    });
  });

  it("returns an empty route for invalid stored data", () => {
    const storage = window.localStorage;
    storage.clear();
    storage.setItem("swiss-route-planner.active-route.v1", "bad json");

    expect(loadStoredRoute(storage)).toEqual({
      routingProfile: "hike",
      waypoints: [],
      segments: [],
    });
  });
});
