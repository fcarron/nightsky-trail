import "ol/ol.css";

import Feature from "ol/Feature.js";
import type { FeatureLike } from "ol/Feature.js";
import Map from "ol/Map.js";
import { unByKey } from "ol/Observable.js";
import View from "ol/View.js";
import { defaults as defaultControls } from "ol/control/defaults.js";
import { LineString, Point } from "ol/geom.js";
import Modify from "ol/interaction/Modify.js";
import Select from "ol/interaction/Select.js";
import TileLayer from "ol/layer/Tile.js";
import VectorLayer from "ol/layer/Vector.js";
import { fromLonLat, toLonLat, transformExtent } from "ol/proj.js";
import XYZ from "ol/source/XYZ.js";
import VectorSource from "ol/source/Vector.js";
import { Circle, Fill, Stroke, Style } from "ol/style.js";
import { apply } from "ol-mapbox-style";
import { useEffect, useRef, useState } from "react";

import { getOsmDebugTrails } from "../../services/api";
import type {
  ComputedRouteSegment,
  LonLat,
  RouteSegment,
  Waypoint,
} from "../route/routeModel";
import {
  OPEN_TOPO_MAP_URL,
  SWISSTOPO_HIKING_TRAILS_WMTS_URL,
  SWISSTOPO_STANDARD_WMTS_URL,
  SWISSTOPO_STYLE_URL,
  SWITZERLAND_CENTER,
} from "./mapConstants";

type BaseLayerId = "light" | "standard" | "osm-topo";
type LayerRole =
  | "base-light"
  | "base-standard"
  | "base-osm-topo"
  | "overlay"
  | "trail-overlay";

interface MapPanelProps {
  waypoints: Waypoint[];
  segments: RouteSegment[];
  computedSegments: ComputedRouteSegment[] | null;
  graphhopperDebugVisible: boolean;
  selectedWaypointId: string | null;
  onAddWaypoint: (position: LonLat) => void;
  onInsertWaypoint: (segmentId: string, position: LonLat) => void;
  onMoveWaypoint: (id: string, position: LonLat) => void;
  onSelectWaypoint: (id: string | null) => void;
}

export function MapPanel({
  waypoints,
  segments,
  computedSegments,
  graphhopperDebugVisible,
  selectedWaypointId,
  onAddWaypoint,
  onInsertWaypoint,
  onMoveWaypoint,
  onSelectWaypoint,
}: MapPanelProps) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const standardLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const osmTopoLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const hikingTrailsLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const graphhopperDebugLayerRef = useRef<VectorLayer<VectorSource> | null>(
    null,
  );
  const osmDebugLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const pointSourceRef = useRef<VectorSource>(new VectorSource());
  const routeSourceRef = useRef<VectorSource>(new VectorSource());
  const graphhopperDebugSourceRef = useRef<VectorSource>(new VectorSource());
  const osmDebugSourceRef = useRef<VectorSource>(new VectorSource());
  const osmDebugRequestIdRef = useRef(0);
  const osmDebugAbortRef = useRef<AbortController | null>(null);
  const osmDebugTimerRef = useRef<number | null>(null);
  const callbacksRef = useRef({
    onAddWaypoint,
    onInsertWaypoint,
    onMoveWaypoint,
    onSelectWaypoint,
  });
  const selectedWaypointIdRef = useRef(selectedWaypointId);
  const baseLayerIdRef = useRef<BaseLayerId>("light");
  const osmDebugVisibleRef = useRef(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [baseLayerId, setBaseLayerId] = useState<BaseLayerId>("light");
  const [hikingTrailsVisible, setHikingTrailsVisible] = useState(true);
  const [osmDebugVisible, setOsmDebugVisible] = useState(false);
  const [osmDebugStatus, setOsmDebugStatus] = useState("OSM Debug aus");
  const [selectedOsmWay, setSelectedOsmWay] = useState<{
    id: number;
    tags: Record<string, string>;
  } | null>(null);

  useEffect(() => {
    callbacksRef.current = {
      onAddWaypoint,
      onInsertWaypoint,
      onMoveWaypoint,
      onSelectWaypoint,
    };
  }, [onAddWaypoint, onInsertWaypoint, onMoveWaypoint, onSelectWaypoint]);

  useEffect(() => {
    selectedWaypointIdRef.current = selectedWaypointId;
  }, [selectedWaypointId]);

  useEffect(() => {
    osmDebugVisibleRef.current = osmDebugVisible;
  }, [osmDebugVisible]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target || mapRef.current) {
      return;
    }

    const standardLayer = new TileLayer({
      source: new XYZ({
        attributions: "© swisstopo",
        crossOrigin: "anonymous",
        maxZoom: 19,
        url: SWISSTOPO_STANDARD_WMTS_URL,
      }),
      visible: false,
      zIndex: 0,
    });
    standardLayer.set("layerRole", "base-standard" satisfies LayerRole);
    const osmTopoLayer = new TileLayer({
      source: new XYZ({
        attributions:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a>',
        crossOrigin: "anonymous",
        maxZoom: 17,
        url: OPEN_TOPO_MAP_URL,
      }),
      visible: false,
      zIndex: 0,
    });
    osmTopoLayer.set("layerRole", "base-osm-topo" satisfies LayerRole);
    const hikingTrailsLayer = new TileLayer({
      opacity: 0.92,
      source: new XYZ({
        attributions: "© swisstopo",
        crossOrigin: "anonymous",
        maxZoom: 19,
        url: SWISSTOPO_HIKING_TRAILS_WMTS_URL,
      }),
      visible: true,
      zIndex: 10,
    });
    hikingTrailsLayer.set("layerRole", "trail-overlay" satisfies LayerRole);
    const routeLayer = new VectorLayer({
      source: routeSourceRef.current,
      style: (feature) =>
        routeStyle(
          feature.get("segmentMode") === "routed" ? "routed" : "straight",
        ),
      zIndex: 20,
    });
    routeLayer.set("layerRole", "overlay" satisfies LayerRole);
    const graphhopperDebugLayer = new VectorLayer({
      source: graphhopperDebugSourceRef.current,
      style: graphhopperDebugStyle,
      visible: false,
      zIndex: 25,
    });
    graphhopperDebugLayer.set("layerRole", "overlay" satisfies LayerRole);
    const osmDebugLayer = new VectorLayer({
      source: osmDebugSourceRef.current,
      style: osmDebugStyle,
      visible: false,
      zIndex: 18,
    });
    osmDebugLayer.set("layerRole", "overlay" satisfies LayerRole);
    graphhopperDebugLayerRef.current = graphhopperDebugLayer;
    osmDebugLayerRef.current = osmDebugLayer;
    standardLayerRef.current = standardLayer;
    osmTopoLayerRef.current = osmTopoLayer;
    hikingTrailsLayerRef.current = hikingTrailsLayer;
    const pointLayer = new VectorLayer({
      source: pointSourceRef.current,
      style: (feature) =>
        waypointStyle(
          feature.get("waypointId") === selectedWaypointIdRef.current,
        ),
      zIndex: 30,
    });
    pointLayer.set("layerRole", "overlay" satisfies LayerRole);

    const map = new Map({
      target,
      controls: defaultControls({ attribution: true, zoom: true }),
      view: new View({
        center: fromLonLat(SWITZERLAND_CENTER),
        zoom: 8,
      }),
    });
    map.addLayer(standardLayer);
    map.addLayer(osmTopoLayer);
    map.addLayer(hikingTrailsLayer);
    map.addLayer(osmDebugLayer);
    map.addLayer(routeLayer);
    map.addLayer(graphhopperDebugLayer);
    map.addLayer(pointLayer);
    mapRef.current = map;

    apply(map, SWISSTOPO_STYLE_URL)
      .then(() => {
        tagUntypedBaseLayers(map, "base-light");
        updateBaseLayerVisibility(map, baseLayerIdRef.current);
      })
      .catch(() => {
        setMapError("swisstopo-Karte konnte nicht geladen werden.");
      });

    map.on("singleclick", (event) => {
      const pointFeatures = map.getFeaturesAtPixel(event.pixel, {
        layerFilter: (layer) => layer === pointLayer,
      });

      if (pointFeatures.length > 0) {
        return;
      }

      const osmDebugFeatures = map.getFeaturesAtPixel(event.pixel, {
        hitTolerance: 5,
        layerFilter: (layer) => layer === osmDebugLayer,
      });
      const osmWayId = osmDebugFeatures[0]?.get("osmWayId");
      const osmTags = osmDebugFeatures[0]?.get("osmTags");
      if (
        osmDebugVisibleRef.current &&
        typeof osmWayId === "number" &&
        isStringRecord(osmTags)
      ) {
        setSelectedOsmWay({ id: osmWayId, tags: osmTags });
        return;
      }

      const routeFeatures = map.getFeaturesAtPixel(event.pixel, {
        hitTolerance: 8,
        layerFilter: (layer) => layer === routeLayer,
      });
      const routeFeature = routeFeatures[0];
      const segmentId = routeFeature?.get("segmentId");
      const geometry = routeFeature?.getGeometry();
      if (typeof segmentId === "string" && geometry instanceof LineString) {
        const [lon, lat] = toLonLat(geometry.getClosestPoint(event.coordinate));
        callbacksRef.current.onInsertWaypoint(segmentId, { lon, lat });
        return;
      }

      const [lon, lat] = toLonLat(event.coordinate);
      callbacksRef.current.onAddWaypoint({ lon, lat });
    });

    const select = new Select({
      layers: [pointLayer],
      style: (feature) =>
        waypointStyle(
          feature.get("waypointId") === selectedWaypointIdRef.current,
        ),
    });
    select.on("select", (event) => {
      const feature = event.selected[0];
      const waypointId = feature?.get("waypointId");
      callbacksRef.current.onSelectWaypoint(
        typeof waypointId === "string" ? waypointId : null,
      );
    });
    map.addInteraction(select);

    const modify = new Modify({ source: pointSourceRef.current });
    modify.on("modifyend", (event) => {
      event.features.forEach((feature) => {
        const id = feature.get("waypointId");
        const geometry = feature.getGeometry();
        if (typeof id !== "string" || !(geometry instanceof Point)) {
          return;
        }

        const [lon, lat] = toLonLat(geometry.getCoordinates());
        callbacksRef.current.onMoveWaypoint(id, { lon, lat });
      });
    });
    map.addInteraction(modify);

    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
      standardLayerRef.current = null;
      osmTopoLayerRef.current = null;
      hikingTrailsLayerRef.current = null;
      graphhopperDebugLayerRef.current = null;
      osmDebugLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    baseLayerIdRef.current = baseLayerId;
    const map = mapRef.current;
    if (!map) {
      return;
    }

    updateBaseLayerVisibility(map, baseLayerId);
  }, [baseLayerId]);

  useEffect(() => {
    const pointSource = pointSourceRef.current;
    const routeSource = routeSourceRef.current;
    const graphhopperDebugSource = graphhopperDebugSourceRef.current;
    pointSource.clear();
    routeSource.clear();
    graphhopperDebugSource.clear();

    const waypointById = new globalThis.Map(
      waypoints.map((waypoint) => [waypoint.id, waypoint]),
    );

    const segmentsToRender = computedSegments ?? segments;

    segmentsToRender.forEach((segment) => {
      const from = waypointById.get(segment.fromWaypointId);
      const to = waypointById.get(segment.toWaypointId);
      const geometry = isComputedRouteSegment(segment)
        ? segment.geometry.map((position) =>
            fromLonLat([position.lon, position.lat]),
          )
        : from && to
          ? [
              fromLonLat([from.position.lon, from.position.lat]),
              fromLonLat([to.position.lon, to.position.lat]),
            ]
          : null;

      if (!geometry) {
        return;
      }

      const feature = new Feature(new LineString(geometry));
      feature.set("segmentId", segment.id);
      feature.set("segmentMode", segment.mode);
      routeSource.addFeature(feature);

      if (isComputedRouteSegment(segment) && segment.mode === "routed") {
        const debugLine = new Feature(new LineString(geometry));
        debugLine.set("debugKind", "graphhopper-line");
        graphhopperDebugSource.addFeature(debugLine);

        geometry.forEach((coordinate, index) => {
          if (index % 8 !== 0 && index !== geometry.length - 1) {
            return;
          }
          const point = new Feature(new Point(coordinate));
          point.set("debugKind", "graphhopper-point");
          graphhopperDebugSource.addFeature(point);
        });
      }
    });

    waypoints.forEach((waypoint, index) => {
      const feature = new Feature(
        new Point(fromLonLat([waypoint.position.lon, waypoint.position.lat])),
      );
      feature.set("waypointId", waypoint.id);
      feature.set("waypointIndex", index);
      pointSource.addFeature(feature);
    });
  }, [waypoints, segments, computedSegments]);

  useEffect(() => {
    pointSourceRef.current.changed();
  }, [selectedWaypointId]);

  useEffect(() => {
    hikingTrailsLayerRef.current?.setVisible(hikingTrailsVisible);
  }, [hikingTrailsVisible]);

  useEffect(() => {
    graphhopperDebugLayerRef.current?.setVisible(graphhopperDebugVisible);
  }, [graphhopperDebugVisible]);

  useEffect(() => {
    osmDebugLayerRef.current?.setVisible(osmDebugVisible);

    if (!osmDebugVisible) {
      osmDebugAbortRef.current?.abort();
      osmDebugSourceRef.current.clear();
      return;
    }

    const map = mapRef.current;
    if (!map) {
      return;
    }

    function scheduleLoad(delayMs = 250) {
      if (osmDebugTimerRef.current !== null) {
        window.clearTimeout(osmDebugTimerRef.current);
      }
      osmDebugTimerRef.current = window.setTimeout(loadDebugWays, delayMs);
    }

    function loadDebugWays() {
      const currentMap = mapRef.current;
      if (!currentMap) {
        return;
      }

      const zoom = currentMap.getView().getZoom() ?? 0;
      if (zoom < 13) {
        osmDebugAbortRef.current?.abort();
        osmDebugSourceRef.current.clear();
        setOsmDebugStatus("OSM Debug ab Zoom 13");
        return;
      }

      const size = currentMap.getSize();
      if (!size) {
        return;
      }

      const extent = transformExtent(
        currentMap.getView().calculateExtent(size),
        "EPSG:3857",
        "EPSG:4326",
      );
      const bbox: [number, number, number, number] = [
        extent[0],
        extent[1],
        extent[2],
        extent[3],
      ];

      if ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) > 0.02) {
        osmDebugAbortRef.current?.abort();
        osmDebugSourceRef.current.clear();
        setOsmDebugStatus("OSM Debug: Ausschnitt zu gross");
        return;
      }

      const requestId = osmDebugRequestIdRef.current + 1;
      osmDebugRequestIdRef.current = requestId;
      osmDebugAbortRef.current?.abort();
      const controller = new AbortController();
      osmDebugAbortRef.current = controller;
      setOsmDebugStatus("OSM Debug lädt");

      getOsmDebugTrails(bbox, zoom, controller.signal)
        .then((response) => {
          if (osmDebugRequestIdRef.current !== requestId) {
            return;
          }

          const source = osmDebugSourceRef.current;
          source.clear();
          response.ways.forEach((way) => {
            const feature = new Feature(
              new LineString(
                way.geometry.coordinates.map(([lon, lat]) =>
                  fromLonLat([lon, lat]),
                ),
              ),
            );
            feature.set("osmWayId", way.id);
            feature.set("osmTags", way.tags);
            source.addFeature(feature);
          });
          setOsmDebugStatus(`OSM Debug: ${response.ways.length} Wege`);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          if (osmDebugRequestIdRef.current !== requestId) {
            return;
          }

          osmDebugSourceRef.current.clear();
          setOsmDebugStatus("OSM Debug nicht verfügbar");
        });
    }

    scheduleLoad(0);
    const moveEndListener = map.on("moveend", () => scheduleLoad());

    return () => {
      if (osmDebugTimerRef.current !== null) {
        window.clearTimeout(osmDebugTimerRef.current);
      }
      osmDebugAbortRef.current?.abort();
      unByKey(moveEndListener);
    };
  }, [osmDebugVisible]);

  return (
    <section className="mapSurface" aria-label="Karte">
      <div ref={targetRef} className="mapTarget" />
      <div className="mapLayerSelector" aria-label="Kartenauswahl">
        <label htmlFor="base-layer-select">Karte</label>
        <select
          id="base-layer-select"
          value={baseLayerId}
          onChange={(event) =>
            setBaseLayerId(toBaseLayerId(event.target.value))
          }
        >
          <option value="light">swisstopo Light</option>
          <option value="standard">swisstopo Standard</option>
          <option value="osm-topo">OSM Topo</option>
        </select>
        <label className="mapOverlayToggle">
          <input
            type="checkbox"
            checked={hikingTrailsVisible}
            onChange={(event) => setHikingTrailsVisible(event.target.checked)}
          />
          Wanderwege
        </label>
        <label className="mapOverlayToggle">
          <input
            type="checkbox"
            checked={osmDebugVisible}
            onChange={(event) => {
              const enabled = event.target.checked;
              setSelectedOsmWay(null);
              setOsmDebugStatus(enabled ? "OSM Debug lädt" : "OSM Debug aus");
              setOsmDebugVisible(enabled);
            }}
          />
          OSM Debug
        </label>
      </div>
      {osmDebugVisible ? (
        <div className="osmDebugPanel" aria-live="polite">
          <strong>{osmDebugStatus}</strong>
          {selectedOsmWay ? (
            <>
              <div>way {selectedOsmWay.id}</div>
              <dl>
                {Object.entries(selectedOsmWay.tags).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <span>OSM-Linie anklicken für Tags.</span>
          )}
        </div>
      ) : null}
      {mapError ? <div className="mapNotice">{mapError}</div> : null}
      <div className="attribution">
        © swisstopo · © OpenStreetMap contributors
      </div>
    </section>
  );
}

function tagUntypedBaseLayers(map: Map, role: LayerRole) {
  map
    .getLayers()
    .getArray()
    .forEach((layer) => {
      if (!layer.get("layerRole")) {
        layer.set("layerRole", role);
      }
    });
}

function updateBaseLayerVisibility(map: Map, activeBaseLayerId: BaseLayerId) {
  map
    .getLayers()
    .getArray()
    .forEach((layer) => {
      const role = layer.get("layerRole");
      if (role === "base-light") {
        layer.setVisible(activeBaseLayerId === "light");
      }
      if (role === "base-standard") {
        layer.setVisible(activeBaseLayerId === "standard");
      }
      if (role === "base-osm-topo") {
        layer.setVisible(activeBaseLayerId === "osm-topo");
      }
    });
}

function toBaseLayerId(value: string): BaseLayerId {
  if (value === "osm-topo") {
    return "osm-topo";
  }
  return value === "standard" ? "standard" : "light";
}

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

function graphhopperDebugStyle(feature: FeatureLike): Style {
  if (feature.get("debugKind") === "graphhopper-point") {
    return graphhopperDebugPointStyle;
  }
  return graphhopperDebugLineStyle;
}

function osmDebugStyle(feature: FeatureLike): Style {
  const tags = feature.get("osmTags");
  const highway = isStringRecord(tags) ? tags.highway : undefined;
  const hasDifficulty = isStringRecord(tags) && typeof tags.sac_scale === "string";

  return new Style({
    stroke: new Stroke({
      color: hasDifficulty ? "#ff9f1c" : "#ffd166",
      lineDash: highway === "track" ? [10, 6] : undefined,
      width: 3,
    }),
  });
}

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

function routeStyle(mode: "straight" | "routed"): Style {
  return mode === "routed" ? routedRouteStyle : straightRouteStyle;
}

function waypointStyle(selected: boolean): Style {
  return new Style({
    image: new Circle({
      radius: selected ? 8 : 6,
      fill: new Fill({ color: selected ? "#d93025" : "#1967d2" }),
      stroke: new Stroke({ color: "#ffffff", width: 2 }),
    }),
  });
}

function isComputedRouteSegment(
  segment: RouteSegment | ComputedRouteSegment,
): segment is ComputedRouteSegment {
  return "geometry" in segment;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((item) => typeof item === "string")
  );
}
