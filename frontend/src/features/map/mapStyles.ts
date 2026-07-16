import type { FeatureLike } from "ol/Feature.js";
import { LineString, MultiPoint } from "ol/geom.js";
import { Circle, Fill, Stroke, Style, Text } from "ol/style.js";

const routedRouteStyle = new Style({
  stroke: new Stroke({
    color: "#1967d2",
    width: 4,
  }),
});

const straightRouteStyle = new Style({
  stroke: new Stroke({
    color: "#1967d2",
    lineDash: [10, 10],
    width: 4,
  }),
});

const graphhopperDebugLineStyle = new Style({
  stroke: new Stroke({
    color: "#ff4fd8",
    lineDash: [4, 8],
    width: 3,
  }),
});

const graphhopperDebugPointStyle = new Style({
  image: new Circle({
    radius: 3,
    fill: new Fill({ color: "#ff4fd8" }),
    stroke: new Stroke({ color: "#250018", width: 1 }),
  }),
});

export function routeStyle(mode: "straight" | "routed"): Style {
  return mode === "routed" ? routedRouteStyle : straightRouteStyle;
}

export function waypointStyle(selected: boolean): Style {
  return new Style({
    image: new Circle({
      radius: selected ? 8 : 6,
      fill: new Fill({ color: selected ? "#d93025" : "#1967d2" }),
      stroke: new Stroke({ color: "#ffffff", width: 2 }),
    }),
  });
}

export function graphhopperDebugStyle(feature: FeatureLike): Style {
  if (feature.get("debugKind") === "graphhopper-point") {
    return graphhopperDebugPointStyle;
  }
  return graphhopperDebugLineStyle;
}

export function difficultyStyle(feature: FeatureLike, resolution: number): Style[] {
  if (feature.get("warningOverlay") !== true) {
    const status = matchStatusFromFeature(feature);
    return [
      new Style({
        stroke: new Stroke({
          color: debugMatchColor(status),
          lineCap: "round",
          lineDash: status === "matched" ? undefined : [6, 8],
          width: 2,
        }),
      }),
    ];
  }

  return [
    new Style({
      geometry: (styleFeature) =>
        warningPlusMarkerGeometry(styleFeature, resolution),
      text: new Text({
        fill: new Fill({ color: "rgba(5, 7, 10, 0.78)" }),
        font: "700 13px sans-serif",
        stroke: new Stroke({ color: "rgba(255, 255, 255, 0.55)", width: 2 }),
        text: "+",
      }),
    }),
  ];
}

function matchStatusFromFeature(feature: FeatureLike): string {
  const segment = feature.get("combinedSegment");
  if (
    typeof segment === "object" &&
    segment !== null &&
    "matchStatus" in segment &&
    typeof segment.matchStatus === "string"
  ) {
    return segment.matchStatus;
  }
  return "unknown";
}

function warningPlusMarkerGeometry(
  feature: FeatureLike,
  resolution: number,
): MultiPoint {
  const geometry = feature.getGeometry();
  if (!(geometry instanceof LineString)) {
    return new MultiPoint([]);
  }

  const length = geometry.getLength();
  if (length <= 0) {
    return new MultiPoint([]);
  }

  const spacing = Math.max(26 * resolution, 14);
  const coordinates = [];
  for (let distance = spacing / 2; distance < length; distance += spacing) {
    coordinates.push(geometry.getCoordinateAt(distance / length));
  }
  return new MultiPoint(coordinates);
}

function debugMatchColor(status: string): string {
  if (status === "matched") {
    return "rgba(22, 163, 74, 0.72)";
  }
  if (status === "ambiguous") {
    return "rgba(245, 158, 11, 0.82)";
  }
  if (status === "osm_only") {
    return "rgba(168, 85, 247, 0.72)";
  }
  return "rgba(148, 163, 184, 0.72)";
}
