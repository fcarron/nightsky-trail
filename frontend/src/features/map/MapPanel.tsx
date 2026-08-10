import "ol/ol.css";

import Feature from "ol/Feature.js";
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
import TileWMS from "ol/source/TileWMS.js";
import VectorSource from "ol/source/Vector.js";
import { apply } from "ol-mapbox-style";
import { useEffect, useRef, useState } from "react";

import { ENABLE_DEV_TOOLS } from "../../app/config";
import { getTrailDifficultyWays } from "../../services/api";
import type { CombinedTrailSegmentDto } from "../../types/api";
import type {
  ComputedRouteSegment,
  LonLat,
  RouteSegment,
  Waypoint,
} from "../route/routeModel";
import {
  HIKING_TRAIL_OVERLAY_MIN_ZOOM,
  OPEN_TOPO_MAP_URL,
  SWISSTOPO_CYCLING_ROUTES_LAYER,
  SWISSTOPO_HIKING_CLOSURES_LAYER,
  SWISSTOPO_HIKING_ROUTES_LAYER,
  SWISSTOPO_HIKING_TRAILS_WMTS_URL,
  SWISSTOPO_SATELLITE_WMTS_URL,
  SWISSTOPO_STANDARD_WMTS_URL,
  SWISSTOPO_STYLE_URL,
  SWISSTOPO_WMS_URL,
  SWITZERLAND_CENTER,
} from "./mapConstants";
import {
  difficultyStyle,
  elevationHoverStyle,
  graphhopperDebugStyle,
  routeStyle,
  waypointStyle,
} from "./mapStyles";
import { DifficultyPanel, TrailLegend } from "./TrailOverlayInfo";
import {
  EMPTY_DIFFICULTY_SUMMARY,
  type DifficultySummary,
  toDifficultySummary,
} from "./trailDifficulty";
import {
  parseClosureFeatureInfo,
  type MapFeatureInfo,
} from "./mapFeatureInfo";

const DIFFICULTY_MIN_ZOOM = HIKING_TRAIL_OVERLAY_MIN_ZOOM;
// Permit the first viewport in which the official swisstopo trail layer is
// visible. The backend applies the same limit.
const DIFFICULTY_MAX_BBOX_AREA = 0.12;

type BaseLayerId = "light" | "standard" | "satellite" | "osm-topo";
type MapInteractionMode = "explore" | "draw";
type LayerRole =
  | "base-light"
  | "base-standard"
  | "base-satellite"
  | "base-osm-topo"
  | "overlay"
  | "trail-overlay";

interface MapPanelProps {
  waypoints: Waypoint[];
  segments: RouteSegment[];
  computedSegments: ComputedRouteSegment[] | null;
  graphhopperDebugVisible: boolean;
  elevationHoverPoint: LonLat | null;
  fitGeometry?: LonLat[];
  fitRequestId: number;
  searchFocus: {
    lon: number;
    lat: number;
    zoom: number;
    requestId: number;
  } | null;
  selectedWaypointId: string | null;
  interactionMode: MapInteractionMode;
  onInteractionModeChange: (mode: MapInteractionMode) => void;
  onAddWaypoint: (position: LonLat) => void;
  onInsertWaypoint: (segmentId: string, position: LonLat) => string;
  onMoveWaypoint: (id: string, position: LonLat) => void;
  onSelectWaypoint: (id: string | null) => void;
  onDeleteWaypoint: (id: string) => void;
}

export function MapPanel({
  waypoints,
  segments,
  computedSegments,
  graphhopperDebugVisible,
  elevationHoverPoint,
  fitGeometry,
  fitRequestId,
  searchFocus,
  selectedWaypointId,
  interactionMode,
  onInteractionModeChange,
  onAddWaypoint,
  onInsertWaypoint,
  onMoveWaypoint,
  onSelectWaypoint,
  onDeleteWaypoint,
}: MapPanelProps) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const standardLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const osmTopoLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const hikingTrailsLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const hikingRoutesLayerRef = useRef<TileLayer<TileWMS> | null>(null);
  const cyclingRoutesLayerRef = useRef<TileLayer<TileWMS> | null>(null);
  const hikingClosuresLayerRef = useRef<TileLayer<TileWMS> | null>(null);
  const graphhopperDebugLayerRef = useRef<VectorLayer<VectorSource> | null>(
    null,
  );
  const difficultyLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const modifyInteractionRef = useRef<Modify | null>(null);
  const pointSourceRef = useRef<VectorSource>(new VectorSource());
  const routeSourceRef = useRef<VectorSource>(new VectorSource());
  const graphhopperDebugSourceRef = useRef<VectorSource>(new VectorSource());
  const difficultySourceRef = useRef<VectorSource>(new VectorSource());
  const elevationHoverSourceRef = useRef<VectorSource>(new VectorSource());
  const difficultyRequestIdRef = useRef(0);
  const difficultyRequestInFlightRef = useRef(false);
  const difficultyQueuedLoadRef = useRef(false);
  const difficultyTimerRef = useRef<number | null>(null);
  const mapFeatureRequestIdRef = useRef(0);
  const lastHandledFitRequestIdRef = useRef(0);
  const lastHandledSearchRequestIdRef = useRef(0);
  const callbacksRef = useRef({
    onAddWaypoint,
    onInsertWaypoint,
    onMoveWaypoint,
    onSelectWaypoint,
    onDeleteWaypoint,
  });
  const selectedWaypointIdRef = useRef(selectedWaypointId);
  const interactionModeRef = useRef<MapInteractionMode>(interactionMode);
  const onInteractionModeChangeRef = useRef(onInteractionModeChange);
  const baseLayerIdRef = useRef<BaseLayerId>("standard");
  const loadLightBaseLayerRef = useRef<(map: Map) => void>(() => undefined);
  const lightBaseLayerLoadedRef = useRef(false);
  const lightBaseLayerLoadingRef = useRef(false);
  const difficultyVisibleRef = useRef(false);
  const trailMatchDebugVisibleRef = useRef(false);
  const routeDragInsertRef = useRef<{ waypointId: string } | null>(null);
  const suppressNextSingleClickRef = useRef(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [baseLayerId, setBaseLayerId] = useState<BaseLayerId>("standard");
  const [hikingTrailsVisible, setHikingTrailsVisible] = useState(true);
  const [hikingRoutesVisible, setHikingRoutesVisible] = useState(false);
  const [hikingClosuresVisible, setHikingClosuresVisible] = useState(false);
  const [cyclingRoutesVisible, setCyclingRoutesVisible] = useState(false);
  const [difficultyVisible, setDifficultyVisible] = useState(false);
  const [trailMatchDebugVisible, setTrailMatchDebugVisible] = useState(false);
  const [difficultyStatus, setDifficultyStatus] = useState(
    "Schwierigkeitshinweise aus",
  );
  const [difficultyLimitedToKnown, setDifficultyLimitedToKnown] =
    useState(false);
  const [difficultySummary, setDifficultySummary] = useState<DifficultySummary>(
    EMPTY_DIFFICULTY_SUMMARY,
  );
  const [mapLayerMenuOpen, setMapLayerMenuOpen] = useState(false);
  const [selectedWaypointPixel, setSelectedWaypointPixel] = useState<
    [number, number] | null
  >(null);
  const [selectedDifficultyWay, setSelectedDifficultyWay] = useState<{
    segment: CombinedTrailSegmentDto;
  } | null>(null);
  const [selectedMapFeature, setSelectedMapFeature] = useState<MapFeatureInfo | null>(
    null,
  );
  const selectedWaypointIndex = waypoints.findIndex(
    (waypoint) => waypoint.id === selectedWaypointId,
  );
  const selectedWaypoint =
    selectedWaypointIndex >= 0 ? waypoints[selectedWaypointIndex] : null;
  const trailMatchDebugEnabled = ENABLE_DEV_TOOLS && trailMatchDebugVisible;
  const showDifficultyPanel =
    (difficultyVisible || trailMatchDebugEnabled) &&
    (selectedDifficultyWay !== null ||
      trailMatchDebugEnabled ||
      difficultyLimitedToKnown ||
      isAttentionDifficultyStatus(difficultyStatus));

  useEffect(() => {
    callbacksRef.current = {
      onAddWaypoint,
      onInsertWaypoint,
      onMoveWaypoint,
      onSelectWaypoint,
      onDeleteWaypoint,
    };
  }, [
    onAddWaypoint,
    onDeleteWaypoint,
    onInsertWaypoint,
    onMoveWaypoint,
    onSelectWaypoint,
  ]);

  useEffect(() => {
    selectedWaypointIdRef.current = selectedWaypointId;
  }, [selectedWaypointId]);

  useEffect(() => {
    interactionModeRef.current = interactionMode;
    onInteractionModeChangeRef.current = onInteractionModeChange;
    modifyInteractionRef.current?.setActive(interactionMode === "draw");
  }, [interactionMode, onInteractionModeChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !selectedWaypoint) {
      setSelectedWaypointPixel(null);
      return;
    }

    const updatePixel = () => {
      const pixel = map.getPixelFromCoordinate(
        fromLonLat([
          selectedWaypoint.position.lon,
          selectedWaypoint.position.lat,
        ]),
      );
      setSelectedWaypointPixel([
        Math.round(pixel[0]),
        Math.round(pixel[1]),
      ]);
    };

    updatePixel();
    const view = map.getView();
    const listeners = [
      map.on("moveend", updatePixel),
      view.on("change:center", updatePixel),
      view.on("change:resolution", updatePixel),
    ];

    return () => {
      unByKey(listeners);
    };
  }, [
    mapReady,
    selectedWaypoint,
    selectedWaypoint?.position.lat,
    selectedWaypoint?.position.lon,
  ]);

  useEffect(() => {
    difficultyVisibleRef.current = difficultyVisible;
  }, [difficultyVisible]);

  useEffect(() => {
    trailMatchDebugVisibleRef.current = trailMatchDebugEnabled;
  }, [trailMatchDebugEnabled]);

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
      visible: baseLayerIdRef.current === "standard",
      zIndex: 0,
    });
    standardLayer.set("layerRole", "base-standard" satisfies LayerRole);
    const satelliteLayer = new TileLayer({
      source: new XYZ({
        attributions: "© swisstopo",
        crossOrigin: "anonymous",
        maxZoom: 19,
        url: SWISSTOPO_SATELLITE_WMTS_URL,
      }),
      visible: false,
      zIndex: 0,
    });
    satelliteLayer.set("layerRole", "base-satellite" satisfies LayerRole);
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
      minZoom: HIKING_TRAIL_OVERLAY_MIN_ZOOM,
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
    const hikingRoutesLayer = new TileLayer({
      minZoom: 10,
      opacity: 0.9,
      source: new TileWMS({
        attributions: "© swisstopo",
        crossOrigin: "anonymous",
        params: {
          FORMAT: "image/png",
          LAYERS: SWISSTOPO_HIKING_ROUTES_LAYER,
          TRANSPARENT: true,
        },
        url: SWISSTOPO_WMS_URL,
      }),
      visible: false,
      zIndex: 11,
    });
    hikingRoutesLayer.set("layerRole", "trail-overlay" satisfies LayerRole);
    const cyclingRoutesLayer = new TileLayer({
      minZoom: 10,
      opacity: 0.9,
      source: new TileWMS({
        attributions: "© swisstopo",
        crossOrigin: "anonymous",
        params: {
          FORMAT: "image/png",
          LAYERS: SWISSTOPO_CYCLING_ROUTES_LAYER,
          TRANSPARENT: true,
        },
        url: SWISSTOPO_WMS_URL,
      }),
      visible: false,
      zIndex: 11,
    });
    cyclingRoutesLayer.set("layerRole", "trail-overlay" satisfies LayerRole);
    const hikingClosuresLayer = new TileLayer({
      minZoom: 10,
      opacity: 0.95,
      source: new TileWMS({
        attributions: "© swisstopo",
        crossOrigin: "anonymous",
        params: {
          FORMAT: "image/png",
          LAYERS: SWISSTOPO_HIKING_CLOSURES_LAYER,
          TRANSPARENT: true,
        },
        url: SWISSTOPO_WMS_URL,
      }),
      visible: false,
      zIndex: 12,
    });
    hikingClosuresLayer.set("layerRole", "trail-overlay" satisfies LayerRole);
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
    const difficultyLayer = new VectorLayer({
      source: difficultySourceRef.current,
      style: difficultyStyle,
      minZoom: HIKING_TRAIL_OVERLAY_MIN_ZOOM,
      visible: false,
      zIndex: 24,
    });
    difficultyLayer.set("layerRole", "overlay" satisfies LayerRole);
    const elevationHoverLayer = new VectorLayer({
      source: elevationHoverSourceRef.current,
      style: elevationHoverStyle,
      zIndex: 28,
    });
    elevationHoverLayer.set("layerRole", "overlay" satisfies LayerRole);
    graphhopperDebugLayerRef.current = graphhopperDebugLayer;
    difficultyLayerRef.current = difficultyLayer;
    standardLayerRef.current = standardLayer;
    osmTopoLayerRef.current = osmTopoLayer;
    hikingTrailsLayerRef.current = hikingTrailsLayer;
    hikingRoutesLayerRef.current = hikingRoutesLayer;
    cyclingRoutesLayerRef.current = cyclingRoutesLayer;
    hikingClosuresLayerRef.current = hikingClosuresLayer;
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
      controls: defaultControls({ attribution: false, zoom: true }),
      view: new View({
        center: fromLonLat(SWITZERLAND_CENTER),
        zoom: 8,
      }),
    });
    map.addLayer(standardLayer);
    map.addLayer(satelliteLayer);
    map.addLayer(osmTopoLayer);
    map.addLayer(hikingTrailsLayer);
    map.addLayer(hikingRoutesLayer);
    map.addLayer(cyclingRoutesLayer);
    map.addLayer(hikingClosuresLayer);
    map.addLayer(difficultyLayer);
    map.addLayer(routeLayer);
    map.addLayer(elevationHoverLayer);
    map.addLayer(graphhopperDebugLayer);
    map.addLayer(pointLayer);
    mapRef.current = map;

    const layerAddListener = map.getLayers().on("add", (event) => {
      const layer = event.element;
      if (layer && !layer.get("layerRole")) {
        layer.set("layerRole", "base-light" satisfies LayerRole);
        updateBaseLayerVisibility(map, baseLayerIdRef.current);
      }
    });

    loadLightBaseLayerRef.current = (targetMap) => {
      if (lightBaseLayerLoadedRef.current || lightBaseLayerLoadingRef.current) {
        return;
      }

      lightBaseLayerLoadingRef.current = true;
      apply(targetMap, SWISSTOPO_STYLE_URL)
        .then(() => {
          lightBaseLayerLoadedRef.current = true;
          tagUntypedBaseLayers(targetMap, "base-light");
          updateBaseLayerVisibility(targetMap, baseLayerIdRef.current);
        })
        .catch(() => {
          standardLayer.setVisible(true);
          setMapError("swisstopo-Karte konnte nicht geladen werden.");
        })
        .finally(() => {
          lightBaseLayerLoadingRef.current = false;
        });
    };

    map.on("singleclick", (event) => {
      if (suppressNextSingleClickRef.current) {
        suppressNextSingleClickRef.current = false;
        return;
      }

      if (routeDragInsertRef.current) {
        return;
      }

      const pointFeatures = map.getFeaturesAtPixel(event.pixel, {
        layerFilter: (layer) => layer === pointLayer,
      });

      if (pointFeatures.length > 0) {
        return;
      }

      if (interactionModeRef.current === "explore") {
        const difficultyFeatures = map.getFeaturesAtPixel(event.pixel, {
          hitTolerance: 5,
          layerFilter: (layer) => layer === difficultyLayer,
        });
        const osmWayId = difficultyFeatures[0]?.get("osmWayId");
        const combinedSegment = difficultyFeatures[0]?.get("combinedSegment");
        if (
          (difficultyVisibleRef.current || trailMatchDebugVisibleRef.current) &&
          typeof osmWayId === "number" &&
          isCombinedTrailSegmentRecord(combinedSegment)
        ) {
          setSelectedMapFeature(null);
          setSelectedDifficultyWay({ segment: combinedSegment });
          return;
        }

        const requestId = ++mapFeatureRequestIdRef.current;
        void inspectVisibleWmsFeatures({
          coordinate: event.coordinate,
          resolution: map.getView().getResolution() ?? 1,
          closuresLayer: hikingClosuresLayerRef.current,
          closuresVisible: hikingClosuresLayerRef.current?.getVisible() === true,
          routesLayer: hikingRoutesLayerRef.current,
          routesVisible: hikingRoutesLayerRef.current?.getVisible() === true,
        }).then((featureInfo) => {
          if (requestId !== mapFeatureRequestIdRef.current) {
            return;
          }
          setSelectedDifficultyWay(null);
          setSelectedMapFeature(featureInfo);
        });
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

    const pointerMoveListener = map.on("pointermove", (event) => {
      const target = map.getTargetElement();
      if (event.dragging || interactionModeRef.current !== "explore") {
        target.style.cursor = "";
        return;
      }

      const difficultyFeatures = map.getFeaturesAtPixel(event.pixel, {
        hitTolerance: 5,
        layerFilter: (layer) => layer === difficultyLayer,
      });
      const hasDifficultyInfo =
        (difficultyVisibleRef.current || trailMatchDebugVisibleRef.current) &&
        difficultyFeatures.some((feature) =>
          isCombinedTrailSegmentRecord(feature.get("combinedSegment")),
        );
      const hasWmsInfo =
        hasVisibleLayerPixel(hikingClosuresLayer, event.pixel) ||
        hasVisibleLayerPixel(hikingRoutesLayer, event.pixel);

      target.style.cursor = hasDifficultyInfo || hasWmsInfo ? "help" : "";
    });

    const handleRoutePointerDown = (event: PointerEvent) => {
      if (interactionModeRef.current !== "draw") {
        return;
      }
      const pixel = map.getEventPixel(event);
      const coordinate = map.getCoordinateFromPixel(pixel);
      const pointFeatures = map.getFeaturesAtPixel(pixel, {
        layerFilter: (layer) => layer === pointLayer,
      });
      if (pointFeatures.length > 0) {
        return;
      }

      const routeFeatures = map.getFeaturesAtPixel(pixel, {
        hitTolerance: 8,
        layerFilter: (layer) => layer === routeLayer,
      });
      const routeFeature = routeFeatures[0];
      const segmentId = routeFeature?.get("segmentId");
      const geometry = routeFeature?.getGeometry();
      if (typeof segmentId !== "string" || !(geometry instanceof LineString)) {
        return;
      }

      const [lon, lat] = toLonLat(geometry.getClosestPoint(coordinate));
      const waypointId = callbacksRef.current.onInsertWaypoint(segmentId, {
        lon,
        lat,
      });
      callbacksRef.current.onSelectWaypoint(waypointId);
      routeDragInsertRef.current = { waypointId };
      suppressNextSingleClickRef.current = true;
      event.preventDefault();
    };

    const handleRoutePointerUp = () => {
      routeDragInsertRef.current = null;
    };

    const viewport = map.getViewport();
    viewport.addEventListener("pointerdown", handleRoutePointerDown);
    window.addEventListener("pointerup", handleRoutePointerUp);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        interactionModeRef.current !== "draw" ||
        isTextEntryTarget(event.target)
      ) {
        return;
      }
      onInteractionModeChangeRef.current("explore");
    };

    window.addEventListener("keydown", handleKeyDown);

    map.on("pointerdrag", (event) => {
      const dragInsert = routeDragInsertRef.current;
      if (!dragInsert) {
        return;
      }

      const [lon, lat] = toLonLat(event.coordinate);
      callbacksRef.current.onMoveWaypoint(dragInsert.waypointId, { lon, lat });
      event.preventDefault();
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
    modify.setActive(interactionModeRef.current === "draw");
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
    modifyInteractionRef.current = modify;
    setMapReady(true);

    return () => {
      map.setTarget(undefined);
      unByKey(layerAddListener);
      unByKey(pointerMoveListener);
      viewport.removeEventListener("pointerdown", handleRoutePointerDown);
      window.removeEventListener("pointerup", handleRoutePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
      mapRef.current = null;
      setMapReady(false);
      standardLayerRef.current = null;
      osmTopoLayerRef.current = null;
      hikingTrailsLayerRef.current = null;
      hikingRoutesLayerRef.current = null;
      cyclingRoutesLayerRef.current = null;
      hikingClosuresLayerRef.current = null;
      graphhopperDebugLayerRef.current = null;
      difficultyLayerRef.current = null;
      modifyInteractionRef.current = null;
      loadLightBaseLayerRef.current = () => undefined;
      lightBaseLayerLoadedRef.current = false;
      lightBaseLayerLoadingRef.current = false;
    };
  }, []);

  useEffect(() => {
    baseLayerIdRef.current = baseLayerId;
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }

    if (baseLayerId === "light") {
      loadLightBaseLayerRef.current(map);
    }
    updateBaseLayerVisibility(map, baseLayerId);
  }, [baseLayerId, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const target = map?.getTargetElement();
    if (!target) {
      return;
    }

    target.style.cursor = "";

    return () => {
      target.style.cursor = "";
    };
  }, [difficultyVisible, hikingClosuresVisible, hikingRoutesVisible, interactionMode, mapReady]);

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

      const isImportedGpxSegment =
        isComputedRouteSegment(segment) && segment.details.importedGpx === true;
      const feature = new Feature(new LineString(geometry));
      feature.set("segmentId", segment.id);
      feature.set(
        "segmentMode",
        isImportedGpxSegment ? "routed" : segment.mode,
      );
      routeSource.addFeature(feature);

      if (
        isComputedRouteSegment(segment) &&
        segment.mode === "routed" &&
        !isImportedGpxSegment
      ) {
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
    if (
      !mapReady ||
      fitRequestId === 0 ||
      fitRequestId === lastHandledFitRequestIdRef.current ||
      (!fitGeometry?.length && waypoints.length === 0)
    ) {
      return;
    }

    const map = mapRef.current;
    const size = map?.getSize();
    if (!map || !size) {
      return;
    }
    lastHandledFitRequestIdRef.current = fitRequestId;

    const positions =
      fitGeometry && fitGeometry.length >= 2
        ? fitGeometry
        : waypoints.map((waypoint) => waypoint.position);
    const coordinates = positions.map((position) =>
      fromLonLat([position.lon, position.lat]),
    );
    if (coordinates.length === 1) {
      map.getView().animate({
        center: coordinates[0],
        duration: 300,
        zoom: Math.max(map.getView().getZoom() ?? 0, 14),
      });
      return;
    }

    const extent = coordinates.reduce(
      (currentExtent, coordinate) => [
        Math.min(currentExtent[0], coordinate[0]),
        Math.min(currentExtent[1], coordinate[1]),
        Math.max(currentExtent[2], coordinate[0]),
        Math.max(currentExtent[3], coordinate[1]),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    map.getView().fit(extent, {
      duration: 350,
      maxZoom: 15,
      padding: [90, 90, 180, 90],
      size,
    });
  }, [fitGeometry, fitRequestId, mapReady, waypoints]);

  useEffect(() => {
    const source = elevationHoverSourceRef.current;
    source.clear();
    if (!elevationHoverPoint) {
      return;
    }
    source.addFeature(
      new Feature(
        new Point(
          fromLonLat([elevationHoverPoint.lon, elevationHoverPoint.lat]),
        ),
      ),
    );
  }, [elevationHoverPoint]);

  useEffect(() => {
    if (
      !mapReady ||
      !searchFocus ||
      searchFocus.requestId === lastHandledSearchRequestIdRef.current
    ) {
      return;
    }

    const map = mapRef.current;
    if (!map) {
      return;
    }
    lastHandledSearchRequestIdRef.current = searchFocus.requestId;
    map.getView().animate({
      center: fromLonLat([searchFocus.lon, searchFocus.lat]),
      duration: 350,
      zoom: searchFocus.zoom,
    });
  }, [mapReady, searchFocus]);

  useEffect(() => {
    hikingTrailsLayerRef.current?.setVisible(hikingTrailsVisible);
  }, [hikingTrailsVisible]);

  useEffect(() => {
    hikingRoutesLayerRef.current?.setVisible(hikingRoutesVisible);
  }, [hikingRoutesVisible]);

  useEffect(() => {
    hikingClosuresLayerRef.current?.setVisible(hikingClosuresVisible);
  }, [hikingClosuresVisible]);

  useEffect(() => {
    cyclingRoutesLayerRef.current?.setVisible(cyclingRoutesVisible);
  }, [cyclingRoutesVisible]);

  useEffect(() => {
    graphhopperDebugLayerRef.current?.setVisible(graphhopperDebugVisible);
  }, [graphhopperDebugVisible]);

  useEffect(() => {
    hikingTrailsLayerRef.current?.setVisible(hikingTrailsVisible);
    difficultyLayerRef.current?.setVisible(
      difficultyVisible || trailMatchDebugEnabled,
    );

    if (!difficultyVisible && !hikingTrailsVisible && !trailMatchDebugEnabled) {
      difficultyRequestIdRef.current += 1;
      difficultyRequestInFlightRef.current = false;
      difficultyQueuedLoadRef.current = false;
      difficultySourceRef.current.clear();
      return;
    }

    if (!difficultyVisible && !trailMatchDebugEnabled) {
      difficultyRequestIdRef.current += 1;
      difficultyRequestInFlightRef.current = false;
      difficultyQueuedLoadRef.current = false;
      difficultySourceRef.current.clear();
      return;
    }

    const map = mapRef.current;
    if (!map) {
      return;
    }

    let disposed = false;

    function scheduleLoad(delayMs = 400) {
      if (difficultyTimerRef.current !== null) {
        window.clearTimeout(difficultyTimerRef.current);
      }
      difficultyTimerRef.current = window.setTimeout(
        loadDifficultyWays,
        delayMs,
      );
    }

    function loadDifficultyWays() {
      const currentMap = mapRef.current;
      if (!currentMap) {
        return;
      }

      const zoom = currentMap.getView().getZoom() ?? 0;
      if (zoom < DIFFICULTY_MIN_ZOOM) {
        difficultyRequestIdRef.current += 1;
        difficultyRequestInFlightRef.current = false;
        difficultyQueuedLoadRef.current = false;
        setDifficultyStatus(
          `Schwierigkeitshinweise ab Zoom ${DIFFICULTY_MIN_ZOOM}`,
        );
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

      const bboxArea = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
      if (bboxArea > DIFFICULTY_MAX_BBOX_AREA) {
        difficultyRequestIdRef.current += 1;
        difficultyRequestInFlightRef.current = false;
        difficultyQueuedLoadRef.current = false;
        setDifficultyStatus(
          "Schwierigkeitshinweise: bitte weiter hineinzoomen",
        );
        return;
      }

      if (difficultyRequestInFlightRef.current) {
        difficultyQueuedLoadRef.current = true;
        setDifficultyStatus(
          "Schwierigkeitshinweise laden · neuer Ausschnitt vorgemerkt",
        );
        return;
      }

      const requestId = difficultyRequestIdRef.current + 1;
      difficultyRequestIdRef.current = requestId;
      difficultyRequestInFlightRef.current = true;
      difficultyQueuedLoadRef.current = false;
      setDifficultyStatus("Schwierigkeitshinweise laden");

      getTrailDifficultyWays(bbox, zoom, true, true, trailMatchDebugEnabled)
        .then((response) => {
          if (difficultyRequestIdRef.current !== requestId) {
            return;
          }
          if (difficultyQueuedLoadRef.current) {
            return;
          }

          const source = difficultySourceRef.current;
          source.clear();
          setDifficultySummary(toDifficultySummary(response.trailSummary));
          setDifficultyLimitedToKnown(response.warnings.length > 0);
          response.combinedSegments
            .filter(
              (segment) => segment.warningOverlay || trailMatchDebugEnabled,
            )
            .forEach((segment) => {
              const feature = new Feature(
                new LineString(
                  segment.geometry.coordinates.map(([lon, lat]) =>
                    fromLonLat([lon, lat]),
                  ),
                ),
              );
              feature.set("osmWayId", segment.osmWayId);
              feature.set("combinedSegment", segment);
              feature.set("warningOverlay", segment.warningOverlay);
              source.addFeature(feature);
            });
          if (!trailMatchDebugEnabled) {
            source
              .getFeatures()
              .filter((feature) => feature.get("warningOverlay") !== true)
              .forEach((feature) => source.removeFeature(feature));
          }
          const warningCount = response.combinedSegments.filter(
            (segment) => segment.warningOverlay,
          ).length;
          setDifficultyStatus(
            response.warnings.length
              ? `OSM-Wege: ${response.trailSummary.totalWays} · Warnungen: ${warningCount} · nur T-Daten`
              : `OSM-Wege: ${response.trailSummary.totalWays} · Warnungen: ${warningCount}`,
          );
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          if (difficultyRequestIdRef.current !== requestId) {
            return;
          }

          setDifficultyStatus(
            difficultySourceRef.current.getFeatures().length
              ? "Schwierigkeitshinweise nicht verfügbar · letzter Stand"
              : "Schwierigkeitshinweise nicht verfügbar",
          );
        })
        .finally(() => {
          if (disposed) {
            return;
          }
          if (difficultyRequestIdRef.current !== requestId) {
            return;
          }

          difficultyRequestInFlightRef.current = false;
          if (difficultyQueuedLoadRef.current) {
            difficultyQueuedLoadRef.current = false;
            scheduleLoad(0);
          }
        });
    }

    scheduleLoad(0);
    const moveEndListener = map.on("moveend", () => scheduleLoad());

    return () => {
      disposed = true;
      if (difficultyTimerRef.current !== null) {
        window.clearTimeout(difficultyTimerRef.current);
      }
      difficultyRequestIdRef.current += 1;
      difficultyRequestInFlightRef.current = false;
      difficultyQueuedLoadRef.current = false;
      unByKey(moveEndListener);
    };
  }, [
    difficultyVisible,
    hikingTrailsVisible,
    mapReady,
    trailMatchDebugEnabled,
  ]);

  return (
    <section className="mapSurface" aria-label="Karte">
      <div ref={targetRef} className="mapTarget" />
      {selectedWaypoint && selectedWaypointPixel ? (
        <button
          type="button"
          className="mapWaypointDelete"
          style={{
            left: selectedWaypointPixel[0],
            top: selectedWaypointPixel[1],
          }}
          aria-label={`Wegpunkt ${selectedWaypointIndex + 1} löschen`}
          title={`Wegpunkt ${selectedWaypointIndex + 1} löschen`}
          onClick={(event) => {
            event.stopPropagation();
            callbacksRef.current.onDeleteWaypoint(selectedWaypoint.id);
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
        >
          <span className="mapWaypointDeleteIcon" aria-hidden="true" />
        </button>
      ) : null}
      <details
        className="mapLayerSelector"
        aria-label="Kartenauswahl"
        open={mapLayerMenuOpen}
        onToggle={(event) =>
          setMapLayerMenuOpen(event.currentTarget.open)
        }
      >
        <summary>
          Karte
          <span>{baseLayerLabel(baseLayerId)}</span>
        </summary>
        <div className="mapLayerContent">
          <label htmlFor="base-layer-select">Basiskarte</label>
          <select
            id="base-layer-select"
            value={baseLayerId}
            onChange={(event) => {
              setBaseLayerId(toBaseLayerId(event.target.value));
              setMapLayerMenuOpen(false);
            }}
          >
          <option value="light">swisstopo Light</option>
          <option value="standard">swisstopo Standard</option>
          <option value="satellite">swisstopo Satellit</option>
          <option value="osm-topo">OSM Topo</option>
          </select>
          <label className="mapOverlayToggle">
            <input
              type="checkbox"
              checked={hikingTrailsVisible}
              onChange={(event) => {
                setHikingTrailsVisible(event.target.checked);
                setMapLayerMenuOpen(false);
              }}
            />
            Offizielle Wanderwege
          </label>
          <label className="mapOverlayToggle">
            <input
              type="checkbox"
              checked={hikingRoutesVisible}
              onChange={(event) => {
                if (!event.target.checked) {
                  setSelectedMapFeature((feature) =>
                    feature?.kind === "wanderland" ? null : feature,
                  );
                }
                setHikingRoutesVisible(event.target.checked);
                setMapLayerMenuOpen(false);
              }}
            />
            Wanderland
          </label>
          <label className="mapOverlayToggle">
            <input
              type="checkbox"
              checked={hikingClosuresVisible}
              onChange={(event) => {
                if (!event.target.checked) {
                  setSelectedMapFeature((feature) =>
                    feature?.kind === "closure" ? null : feature,
                  );
                }
                setHikingClosuresVisible(event.target.checked);
                setMapLayerMenuOpen(false);
              }}
            />
            Sperrungen
          </label>
          <label className="mapOverlayToggle">
            <input
              type="checkbox"
              checked={cyclingRoutesVisible}
              onChange={(event) => {
                setCyclingRoutesVisible(event.target.checked);
                setMapLayerMenuOpen(false);
              }}
            />
            Veloland
          </label>
          <label className="mapOverlayToggle">
            <input
              type="checkbox"
              checked={difficultyVisible}
              onChange={(event) => {
                const enabled = event.target.checked;
                setSelectedDifficultyWay(null);
                setDifficultySummary(EMPTY_DIFFICULTY_SUMMARY);
                setDifficultyLimitedToKnown(false);
                setDifficultyStatus(
                  enabled
                    ? "Schwierigkeitshinweise laden"
                    : "Schwierigkeitshinweise aus",
                );
                setDifficultyVisible(enabled);
                setMapLayerMenuOpen(false);
              }}
            />
            Schwierigkeit
          </label>
          {ENABLE_DEV_TOOLS ? (
            <label className="mapOverlayToggle">
              <input
                type="checkbox"
                checked={trailMatchDebugVisible}
                onChange={(event) => {
                setSelectedDifficultyWay(null);
                setTrailMatchDebugVisible(event.target.checked);
                setMapLayerMenuOpen(false);
              }}
              />
              Match Debug
            </label>
          ) : null}
        </div>
      </details>
      {showDifficultyPanel ? (
        <DifficultyPanel
          difficultyLimitedToKnown={difficultyLimitedToKnown}
          difficultyStatus={difficultyStatus}
          difficultySummary={difficultySummary}
          selectedDifficultyWay={
            interactionMode === "explore" ? selectedDifficultyWay : null
          }
        />
      ) : null}
      {selectedMapFeature &&
      interactionMode === "explore" &&
      (selectedMapFeature.kind === "closure"
        ? hikingClosuresVisible
        : hikingRoutesVisible) ? (
        <MapFeaturePanel
          feature={selectedMapFeature}
          onClose={() => setSelectedMapFeature(null)}
        />
      ) : null}
      {hikingTrailsVisible || difficultyVisible ? (
        <TrailLegend
          difficultyVisible={difficultyVisible}
          hikingTrailsVisible={hikingTrailsVisible}
          trailMatchDebugEnabled={trailMatchDebugEnabled}
        />
      ) : null}
      {mapError ? <div className="mapNotice">{mapError}</div> : null}
      <div className="attribution" aria-label="Datenquellen">
        <span>Datenquellen:</span>
        <a
          href="https://www.swisstopo.admin.ch/"
          target="_blank"
          rel="noreferrer"
        >
          © swisstopo
        </a>
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap contributors
        </a>
        {baseLayerId === "osm-topo" ? (
          <a
            href="https://opentopomap.org/about"
            target="_blank"
            rel="noreferrer"
          >
            © OpenTopoMap (CC-BY-SA)
          </a>
        ) : null}
      </div>
    </section>
  );
}

function MapFeaturePanel({
  feature,
  onClose,
}: {
  feature: MapFeatureInfo;
  onClose: () => void;
}) {
  return (
    <aside className="mapFeaturePanel" aria-label={`${feature.kind} Details`}>
      <div className="mapFeaturePanelHeader">
        <div>
          <span>{feature.kind === "closure" ? "Sperrung" : "Wanderland"}</span>
          <strong>{feature.title}</strong>
        </div>
        <button type="button" aria-label="Karteninformation schliessen" onClick={onClose}>
          ×
        </button>
      </div>
      {feature.details.length ? (
        <dl>
          {feature.details.map(([label, value]) => (
            <div key={`${label}:${value}`}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>Keine weiteren Angaben verfügbar.</p>
      )}
      {feature.schweizMobilUrl ? (
        <a href={feature.schweizMobilUrl} target="_blank" rel="noreferrer">
          Auf SchweizMobil öffnen
        </a>
      ) : null}
    </aside>
  );
}

async function inspectVisibleWmsFeatures({
  coordinate,
  resolution,
  closuresLayer,
  closuresVisible,
  routesLayer,
  routesVisible,
}: {
  coordinate: number[];
  resolution: number;
  closuresLayer: TileLayer<TileWMS> | null;
  closuresVisible: boolean;
  routesLayer: TileLayer<TileWMS> | null;
  routesVisible: boolean;
}): Promise<MapFeatureInfo | null> {
  if (closuresVisible) {
    const closure = await getWmsFeatureInfo(
      closuresLayer,
      coordinate,
      resolution,
      "closure",
    );
    if (closure) {
      return closure;
    }
  }

  if (routesVisible) {
    return getWmsFeatureInfo(routesLayer, coordinate, resolution, "wanderland");
  }
  return null;
}

async function getWmsFeatureInfo(
  layer: TileLayer<TileWMS> | null,
  coordinate: number[],
  resolution: number,
  kind: MapFeatureInfo["kind"],
): Promise<MapFeatureInfo | null> {
  const source = layer?.getSource();
  const infoFormat = kind === "closure" ? "text/plain" : "application/json";
  const url = source?.getFeatureInfoUrl(coordinate, resolution, "EPSG:3857", {
    FEATURE_COUNT: 1,
    INFO_FORMAT: infoFormat,
  });
  if (!url) {
    return null;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    if (kind === "closure") {
      return parseClosureFeatureInfo(await response.text());
    }
    return toMapFeatureInfo(kind, await response.json());
  } catch {
    return null;
  }
}

function toMapFeatureInfo(
  kind: MapFeatureInfo["kind"],
  payload: unknown,
): MapFeatureInfo | null {
  if (!isRecord(payload) || !Array.isArray(payload.features)) {
    return null;
  }
  const firstFeature = payload.features[0];
  if (!isRecord(firstFeature) || !isRecord(firstFeature.properties)) {
    return null;
  }

  const properties = firstFeature.properties;
  const title = featureProperty(properties, [
    "chmobil_title",
    "name",
    "bezeichnung",
    "titel",
    "route_name",
    "routenname",
  ]);
  const routeNumber = featureProperty(properties, [
    "chmobil_route_number",
    "nummer",
    "route_nr",
    "routennummer",
    "number",
  ]);
  const details = mapFeatureDetails(kind, properties, routeNumber);

  return {
    details,
    kind,
    schweizMobilUrl:
      kind === "wanderland"
        ? toSchweizMobilRouteUrl(routeNumber)
        : undefined,
    title:
      title ??
      (routeNumber
        ? `Route ${routeNumber}`
        : kind === "closure"
          ? "Wanderweg-Sperrung"
          : "Wanderland-Route"),
  };
}

function mapFeatureDetails(
  kind: MapFeatureInfo["kind"],
  properties: Record<string, unknown>,
  routeNumber: string | null,
): Array<[string, string]> {
  const preferredDetails: Array<[string, string]> = [];
  const usedKeys = new Set([
    "chmobil_title",
    "name",
    "bezeichnung",
    "titel",
    "route_name",
    "routenname",
  ]);

  const addProperty = (label: string, keys: string[]) => {
    const key = keys.find((candidate) => featureProperty(properties, [candidate]));
    if (!key) {
      return;
    }
    const value = featureProperty(properties, [key]);
    if (value) {
      preferredDetails.push([label, value]);
      usedKeys.add(key);
    }
  };

  if (kind === "wanderland") {
    if (routeNumber) {
      preferredDetails.push(["Routennummer", routeNumber]);
      usedKeys.add("chmobil_route_number");
    }
    preferredDetails.push(["Netz", "Wanderland Schweiz"]);
    const segmentId = featureProperty(properties, ["id"]);
    if (segmentId) {
      preferredDetails.push(["Abschnitt", segmentId]);
      usedKeys.add("id");
    }
    const hasSegment = featureProperty(properties, ["chmobil_has_segment"]);
    if (hasSegment && !segmentId) {
      preferredDetails.push([
        "Abschnitt",
        hasSegment === "true" ? "verfügbar" : hasSegment,
      ]);
      usedKeys.add("chmobil_has_segment");
    }
  } else {
    addProperty("Status", ["status", "closure_status", "sperrung", "zustand"]);
    addProperty("Zeitraum", ["zeitraum", "validity", "gueltigkeit"]);
    addProperty("Von", ["start_date", "startdatum", "von", "begin"]);
    addProperty("Bis", ["end_date", "enddatum", "bis", "ende"]);
    addProperty("Quelle", ["source", "quelle", "provider", "organisation"]);
  }

  return [
    ...preferredDetails,
    ...Object.entries(properties)
      .filter(
        ([key, value]) =>
          !usedKeys.has(key) && isDisplayableFeatureProperty(key, value),
      )
      .slice(0, Math.max(0, 5 - preferredDetails.length))
      .map(
        ([key, value]): [string, string] => [
          formatFeaturePropertyName(key),
          String(value),
        ],
      ),
  ];
}

function toSchweizMobilRouteUrl(routeNumber: string | null): string {
  if (!routeNumber || !/^\d+$/.test(routeNumber)) {
    return "https://schweizmobil.ch/de/wanderland";
  }
  return `https://schweizmobil.ch/de/wanderland/routen/route-${routeNumber}`;
}

function hasVisibleLayerPixel(
  layer: TileLayer<TileWMS>,
  pixel: number[],
): boolean {
  if (!layer.getVisible()) {
    return false;
  }
  const data = layer.getData(pixel);
  if (data instanceof DataView) {
    return data.byteLength >= 4 && data.getUint8(3) > 0;
  }
  return data !== null && data.length >= 4 && data[3] > 0;
}

function featureProperty(
  properties: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return null;
}

function isDisplayableFeatureProperty(key: string, value: unknown): boolean {
  return (
    !["geometry", "geom", "the_geom"].includes(key.toLowerCase()) &&
    (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
  );
}

function formatFeaturePropertyName(key: string): string {
  const labels: Record<string, string> = {
    chmobil_has_segment: "Aktueller Abschnitt",
    chmobil_route_number: "Routennummer",
    chmobil_title: "Route",
  };
  if (labels[key]) {
    return labels[key];
  }
  return key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
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
      if (role === "base-satellite") {
        layer.setVisible(activeBaseLayerId === "satellite");
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
  if (value === "satellite") {
    return "satellite";
  }
  return value === "standard" ? "standard" : "light";
}

function baseLayerLabel(value: BaseLayerId): string {
  if (value === "standard") {
    return "Standard";
  }
  if (value === "osm-topo") {
    return "OSM Topo";
  }
  if (value === "satellite") {
    return "Satellit";
  }
  return "Light";
}

function isComputedRouteSegment(
  segment: RouteSegment | ComputedRouteSegment,
): segment is ComputedRouteSegment {
  return "geometry" in segment;
}

function isCombinedTrailSegmentRecord(
  value: unknown,
): value is CombinedTrailSegmentDto {
  return (
    typeof value === "object" &&
    value !== null &&
    "osmWayId" in value &&
    "matchScore" in value &&
    "matchStatus" in value
  );
}

function isAttentionDifficultyStatus(status: string): boolean {
  return (
    status.includes("lädt") ||
    status.includes("laden") ||
    status.includes("vorgemerkt") ||
    status.includes("nicht verfügbar") ||
    status.includes("Zoom") ||
    status.includes("zoomen")
  );
}
