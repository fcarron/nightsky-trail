import type { FeatureLike } from "ol/Feature.js";
import { Circle, Fill, Stroke, Style, Text } from "ol/style.js";

const routedRouteStyle = [
  new Style({
    stroke: new Stroke({
      color: "rgba(255, 255, 255, 0.9)",
      lineCap: "round",
      lineJoin: "round",
      width: 7,
    }),
  }),
  new Style({
    stroke: new Stroke({
      color: "#1967d2",
      lineCap: "round",
      lineJoin: "round",
      width: 4.5,
    }),
  }),
];

const straightRouteStyle = [
  new Style({
    stroke: new Stroke({
      color: "rgba(255, 255, 255, 0.9)",
      lineCap: "round",
      lineDash: [10, 10],
      width: 7,
    }),
  }),
  new Style({
    stroke: new Stroke({
      color: "#1967d2",
      lineCap: "round",
      lineDash: [10, 10],
      width: 4.5,
    }),
  }),
];

const routeCategoryStyles: Record<string, Style> = {
  hiking_trail: new Style({
    stroke: new Stroke({
      color: "rgba(238, 190, 0, 0.95)",
      lineCap: "round",
      lineJoin: "round",
      width: 11,
    }),
  }),
  mountain_hiking_trail: new Style({
    stroke: new Stroke({
      color: "rgba(210, 47, 47, 0.95)",
      lineCap: "round",
      lineJoin: "round",
      width: 11,
    }),
  }),
  alpine_hiking_trail: new Style({
    stroke: new Stroke({
      color: "rgba(0, 78, 156, 0.95)",
      lineCap: "round",
      lineJoin: "round",
      width: 11,
    }),
  }),
};

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

const selectedWaypointStyle = new Style({
  image: new Circle({
    radius: 8,
    fill: new Fill({ color: "#d93025" }),
    stroke: new Stroke({ color: "#ffffff", width: 2 }),
  }),
});

const defaultWaypointStyle = new Style({
  image: new Circle({
    radius: 6,
    fill: new Fill({ color: "#1967d2" }),
    stroke: new Stroke({ color: "#ffffff", width: 2 }),
  }),
});

const drinkingWaterMarkerStyle = new Style({
  image: new Circle({
    radius: 8,
    fill: new Fill({ color: "rgba(255, 255, 255, 0.92)" }),
    stroke: new Stroke({ color: "#1677b8", width: 1.5 }),
  }),
  text: new Text({
    fill: new Fill({ color: "#1677b8" }),
    font: "700 12px sans-serif",
    text: "💧",
  }),
});
const sacHutMarkerStyle = new Style({
  image: new Circle({ radius: 8, fill: new Fill({ color: "rgba(255,255,255,.92)" }), stroke: new Stroke({ color: "#7b4b20", width: 1.5 }) }),
  text: new Text({ text: "⌂", font: "700 15px sans-serif", fill: new Fill({ color: "#7b4b20" }) }),
});

const elevationHoverMarkerStyle = new Style({
  image: new Circle({
    radius: 7,
    fill: new Fill({ color: "#f4f8fb" }),
    stroke: new Stroke({ color: "#05070a", width: 3 }),
  }),
});

const analysisRangeLineStyle = [
  new Style({
    stroke: new Stroke({
      color: "rgba(255, 255, 255, 0.94)",
      lineCap: "round",
      lineJoin: "round",
      width: 13,
    }),
  }),
  new Style({
    stroke: new Stroke({
      color: "#0d263f",
      lineCap: "round",
      lineJoin: "round",
      width: 9,
    }),
  }),
  new Style({
    stroke: new Stroke({
      color: "#00b8d4",
      lineCap: "round",
      lineJoin: "round",
      width: 4.5,
    }),
  }),
];

const matchedDifficultyStyle = [
  new Style({
    stroke: new Stroke({
      color: "rgba(22, 163, 74, 0.72)",
      lineCap: "round",
      width: 2,
    }),
  }),
];

const ambiguousDifficultyStyle = [
  new Style({
    stroke: new Stroke({
      color: "rgba(245, 158, 11, 0.82)",
      lineCap: "round",
      lineDash: [6, 8],
      width: 2,
    }),
  }),
];

const osmOnlyDifficultyStyle = [
  new Style({
    stroke: new Stroke({
      color: "rgba(168, 85, 247, 0.72)",
      lineCap: "round",
      lineDash: [6, 8],
      width: 2,
    }),
  }),
];

const unknownDifficultyStyle = [
  new Style({
    stroke: new Stroke({
      color: "rgba(148, 163, 184, 0.72)",
      lineCap: "round",
      lineDash: [6, 8],
      width: 2,
    }),
  }),
];

const warningOverlayLineStyle = new Style({
  stroke: new Stroke({
    color: "rgba(5, 7, 10, 0.8)",
    lineCap: "butt",
    lineDash: [8, 8],
    width: 3.5,
  }),
});

export function routeStyle(mode: "straight" | "routed"): Style[] {
  return mode === "routed" ? routedRouteStyle : straightRouteStyle;
}

export function routeCategoryStyle(feature: FeatureLike): Style | undefined {
  const category = feature.get("officialCategory");
  return typeof category === "string"
    ? routeCategoryStyles[category]
    : undefined;
}

export function waypointStyle(selected: boolean): Style {
  return selected ? selectedWaypointStyle : defaultWaypointStyle;
}

export function drinkingWaterStyle(): Style {
  return drinkingWaterMarkerStyle;
}

export function sacHutStyle(): Style { return sacHutMarkerStyle; }

export function graphhopperDebugStyle(feature: FeatureLike): Style {
  if (feature.get("debugKind") === "graphhopper-point") {
    return graphhopperDebugPointStyle;
  }
  return graphhopperDebugLineStyle;
}

export function elevationHoverStyle(): Style {
  return elevationHoverMarkerStyle;
}

export function analysisRangeStyle(): Style[] {
  return analysisRangeLineStyle;
}

export function difficultyStyle(feature: FeatureLike): Style[] {
  if (feature.get("warningOverlay") !== true) {
    const status = matchStatusFromFeature(feature);
    return difficultyDebugStyle(status);
  }

  return [warningOverlayLineStyle];
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

function difficultyDebugStyle(status: string): Style[] {
  if (status === "matched") {
    return matchedDifficultyStyle;
  }
  if (status === "ambiguous") {
    return ambiguousDifficultyStyle;
  }
  if (status === "osm_only") {
    return osmOnlyDifficultyStyle;
  }
  return unknownDifficultyStyle;
}
