import { describe, expect, it } from "vitest";

import type { ElevationProfile } from "../elevation/elevationModel";
import {
  buildRoutePdfDocument,
  createRouteQrCodeSvg,
  kilometreMarkerInterval,
} from "./routePdf";

describe("route PDF report", () => {
  it.each([
    [10_000, 1],
    [24_000, 2],
    [60_000, 5],
    [100_000, 10],
  ])(
    "uses a readable kilometre interval for %s metres",
    (distance, interval) => {
      expect(kilometreMarkerInterval(distance)).toBe(interval);
    },
  );

  it("builds a printable route sheet with map, profile and safe labels", () => {
    const document = buildRoutePdfDocument({
      generatedLabel: "Created with nightsky trail",
      gradientLabel: "Gradient",
      language: "en",
      profile: buildProfile(),
      sourceLabel: "Map: © swisstopo",
      statistics: [{ label: "Distance", value: "24.0 km" }],
      subtitle: "Route sheet",
      title: "Ridge <Run>",
    });

    expect(document).toContain("Ridge &lt;Run&gt;");
    expect(document).toContain("size: A4 portrait");
    expect(document).not.toContain("size: A4 landscape");
    expect(document).toContain("ch.swisstopo.pixelkarte-farbe");
    expect(document).toContain("Distance");
    expect(document).toContain("24.0 km");
    expect(document).toContain('aria-label="Elevation profile"');
    expect(document).toContain("gradientLegend");
    expect(document).toContain('class="brandMark"');
    expect(document).toContain("M5.5 23.5c4.8-5.2");
    expect(document).toContain("&lt;5%");
    expect(document).toContain("#b91c1c");
    expect(document).toContain(">2</text>");
    expect(document).not.toContain("Ridge <Run>");
  });

  it("adds a generated QR code and escaped public URL when requested", async () => {
    const url = "https://trail.nightsky.ch/t/public?a=1&b=2";
    const qrCodeSvg = await createRouteQrCodeSvg(url);
    const document = buildRoutePdfDocument({
      generatedLabel: "Created with nightsky trail",
      gradientLabel: "Gradient",
      language: "en",
      profile: buildProfile(),
      share: { label: "Open online", qrCodeSvg, url },
      sourceLabel: "Map: © swisstopo",
      statistics: [{ label: "Distance", value: "24.0 km" }],
      subtitle: "Route sheet",
      title: "Shared route",
    });

    expect(qrCodeSvg).toContain("<svg");
    expect(document).toContain("Open online");
    expect(document).toContain(
      "https://trail.nightsky.ch/t/public?a=1&amp;b=2",
    );
  });
});

function buildProfile(): ElevationProfile {
  return {
    ascentMeters: 800,
    descentMeters: 800,
    distanceMeters: 24_000,
    gradientBands: [
      {
        endDistanceMeters: 24_000,
        gradientPercent: 8,
        group: { color: "#f4d35e", id: "moderate", label: "5-10%" },
        startDistanceMeters: 0,
      },
    ],
    hikingTime: {
      durationMinutes: 300,
      method: "swiss_hiking_polynomial",
      segmentCount: 480,
      segmentLengthMeters: 50,
      smoothingWindowMeters: 40,
    },
    maxAbsGradientPercent: 8,
    maxElevationMeters: 1_400,
    minElevationMeters: 600,
    points: [
      elevationPoint(0, 600, 7.4, 46.9),
      elevationPoint(12_000, 1_400, 7.5, 47),
      elevationPoint(24_000, 600, 7.6, 46.9),
    ],
  };
}

function elevationPoint(
  distanceMeters: number,
  elevationMeters: number,
  longitude: number,
  latitude: number,
) {
  return {
    distanceMeters,
    elevationMeters,
    gradientPercent: 8,
    latitude,
    longitude,
    smoothedElevationMeters: elevationMeters,
  };
}
