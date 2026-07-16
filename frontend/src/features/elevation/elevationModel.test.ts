import { describe, expect, it } from "vitest";

import type { ComputedRoute } from "../route/routeModel";
import {
  resampleGeometryForElevation,
  toElevationProfileRequest,
} from "./elevationModel";

describe("elevation profile request geometry", () => {
  it("keeps short route geometry unchanged", () => {
    const route = buildRoute([
      { lon: 7.4, lat: 46.9 },
      { lon: 7.41, lat: 46.91 },
    ]);

    expect(toElevationProfileRequest(route).geometry.coordinates).toEqual([
      [7.4, 46.9],
      [7.41, 46.91],
    ]);
  });

  it("limits dense route geometry before requesting elevation", () => {
    const geometry = Array.from({ length: 2_000 }, (_, index) => ({
      lon: 7.4 + index * 0.00001,
      lat: 46.9 + index * 0.00001,
    }));

    const sampled = resampleGeometryForElevation(geometry);

    expect(sampled.length).toBeLessThanOrEqual(800);
    expect(sampled[0]).toEqual(geometry[0]);
    expect(sampled[sampled.length - 1]).toEqual(geometry[geometry.length - 1]);
  });
});

function buildRoute(geometry: ComputedRoute["geometry"]): ComputedRoute {
  return {
    distanceMeters: 0,
    geometry,
    segments: [],
    warnings: [],
  };
}
