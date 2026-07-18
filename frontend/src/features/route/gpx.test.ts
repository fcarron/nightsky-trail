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

  it("imports GPX track points as a straight manual route", () => {
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
      { id: "gpx-2", position: { lat: 46.9492, lon: 7.4481 } },
      { id: "gpx-3", position: { lat: 46.95, lon: 7.449 } },
    ]);
    expect(plan.segments).toEqual([
      {
        fromWaypointId: "gpx-1",
        id: "gpx-1-gpx-2",
        mode: "straight",
        toWaypointId: "gpx-2",
      },
      {
        fromWaypointId: "gpx-2",
        id: "gpx-2-gpx-3",
        mode: "straight",
        toWaypointId: "gpx-3",
      },
    ]);
  });

  it("rejects GPX files without a route", () => {
    expect(() => importRoutePlanFromGpx("<gpx />")).toThrow(
      "GPX enthält zu wenige Punkte.",
    );
  });
});
