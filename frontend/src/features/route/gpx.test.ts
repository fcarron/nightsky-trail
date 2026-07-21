import { describe, expect, it } from "vitest";

import { exportPointsToGpx, importRoutePlanFromGpx } from "./gpx";

describe("GPX route import and export", () => {
  it("exports route points as GPX track points", () => {
    const gpx = exportPointsToGpx(
      [
        { lon: 7.4474, lat: 46.948 },
        { lon: 7.4481, lat: 46.9492 },
      ],
      "A&B Tour",
    );

    expect(gpx).toContain("<name>A&amp;B Tour</name>");
    expect(gpx).toContain('<trkpt lat="46.9480000" lon="7.4474000" />');
    expect(gpx).toContain('<trkpt lat="46.9492000" lon="7.4481000" />');
  });

  it("imports GPX track points as exact imported geometry with editable endpoints", () => {
    const plan = importRoutePlanFromGpx(`<?xml version="1.0"?>
<gpx version="1.1">
  <trk>
    <trkseg>
      <trkpt lat="46.9480" lon="7.4474" />
      <trkpt lat="46.9492" lon="7.4481" />
      <trkpt lat="46.9500" lon="7.4490" />
    </trkseg>
  </trk>
</gpx>`);

    expect(plan.waypoints).toEqual([
      { id: "gpx-1", position: { lat: 46.948, lon: 7.4474 } },
      { id: "gpx-2", position: { lat: 46.95, lon: 7.449 } },
    ]);
    expect(plan.segments).toEqual([
      {
        fromWaypointId: "gpx-1",
        id: "gpx-1-gpx-2",
        mode: "straight",
        toWaypointId: "gpx-2",
      },
    ]);
    expect(plan.importedGeometry).toEqual([
      { lat: 46.948, lon: 7.4474 },
      { lat: 46.9492, lon: 7.4481 },
      { lat: 46.95, lon: 7.449 },
    ]);
  });

  it("rejects GPX files without a route", () => {
    expect(() => importRoutePlanFromGpx("<gpx />")).toThrow(
      "GPX enthält zu wenige Punkte.",
    );
  });

  it("preserves long GPX geometry without turning every point into a waypoint", () => {
    const trackPoints = Array.from(
      { length: 120 },
      (_, index) =>
        `<trkpt lat="${46.8 + index * 0.001}" lon="${7.4 + index * 0.001}" />`,
    ).join("");

    const plan = importRoutePlanFromGpx(`<gpx><trk><trkseg>${trackPoints}</trkseg></trk></gpx>`);

    expect(plan.waypoints).toHaveLength(2);
    expect(plan.segments).toHaveLength(1);
    expect(plan.importedGeometry).toHaveLength(120);
    expect(plan.waypoints[0].position).toEqual({ lat: 46.8, lon: 7.4 });
    expect(plan.waypoints.at(-1)?.position).toEqual({
      lat: 46.919,
      lon: 7.519,
    });
  });
});
