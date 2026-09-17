import "ol/ol.css";

import Feature from "ol/Feature.js";
import Map from "ol/Map.js";
import { unByKey } from "ol/Observable.js";
import View from "ol/View.js";
import { defaults as defaultControls } from "ol/control/defaults.js";
import { click as clickCondition } from "ol/events/condition.js";
import { LineString, Point } from "ol/geom.js";
import DoubleClickZoom from "ol/interaction/DoubleClickZoom.js";
import Modify from "ol/interaction/Modify.js";
import Select from "ol/interaction/Select.js";
import TileLayer from "ol/layer/Tile.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorImageLayer from "ol/layer/VectorImage.js";
import { fromLonLat, toLonLat, transformExtent } from "ol/proj.js";
import XYZ from "ol/source/XYZ.js";
import TileWMS from "ol/source/TileWMS.js";
import VectorSource from "ol/source/Vector.js";
import { apply } from "ol-mapbox-style";
import { useEffect, useRef, useState } from "react";

import { ENABLE_DEV_TOOLS } from "../../app/config";
import { useI18n } from "../../app/i18n";
import {
  getDrinkingWater,
  getMapFeatureInfo,
  getSacHuts,
  getTrailDifficultyWays,
  getToilets,
} from "../../services/api";
import type {
  CombinedTrailSegmentDto,
  OfficialTrailSegmentDto,
} from "../../types/api";
import type {
  ComputedRouteSegment,
  LonLat,
  RouteSegment,
  Waypoint,
} from "../route/routeModel";
import {
  HIKING_TRAIL_OVERLAY_MIN_ZOOM,
  OPEN_TOPO_MAP_URL,
  SWISSTOPO_CYCLING_ROUTES_WMTS_URL,
  SWISSTOPO_HIKING_CLOSURES_LAYER,
  SWISSTOPO_HIKING_ROUTES_WMTS_URL,
  SWISSTOPO_HIKING_TRAILS_WMTS_URL,
  SWISSTOPO_SATELLITE_WMTS_URL,
  SWISSTOPO_STANDARD_WMTS_URL,
  SWISSTOPO_STYLE_URL,
  SWISSTOPO_WMS_URL,
  SWITZERLAND_CENTER,
} from "./mapConstants";
import {
  difficultyStyle,
  drinkingWaterStyle,
  sacHutStyle,
  toiletStyle,
  analysisRangeStyle,
  elevationHoverStyle,
  graphhopperDebugStyle,
  routeCategoryStyle,
  routeStyle,
  waypointStyle,
} from "./mapStyles";
import { TrailLegend } from "./TrailOverlayInfo";
import { parseClosureFeatureInfo, type MapFeatureInfo } from "./mapFeatureInfo";
import { updateRouteCategoryFeatures } from "./routeCategory";

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
  analysisRangeGeometry?: LonLat[];
  elevationMarkerAutoPan?: boolean;
  elevationMarkerBottomPadding?: number;
  fitGeometry?: LonLat[];
  fitRequestId: number;
  searchFocus: {
    lon: number;
    lat: number;
    zoom: number;
    requestId: number;
  } | null;
  selectedWaypointId: string | null;
  panelOpen?: boolean;
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
  analysisRangeGeometry = [],
  elevationMarkerAutoPan = false,
  elevationMarkerBottomPadding = 40,
  fitGeometry,
  fitRequestId,
  searchFocus,
  selectedWaypointId,
  panelOpen = false,
  interactionMode,
  onInteractionModeChange,
  onAddWaypoint,
  onInsertWaypoint,
  onMoveWaypoint,
  onSelectWaypoint,
  onDeleteWaypoint,
}: MapPanelProps) {
  const { t, tx } = useI18n();
  const targetRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const standardLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const osmTopoLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const hikingTrailsLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const hikingRoutesLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const cyclingRoutesLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const hikingClosuresLayerRef = useRef<TileLayer<TileWMS> | null>(null);
  const graphhopperDebugLayerRef = useRef<VectorLayer<VectorSource> | null>(
    null,
  );
  const difficultyLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const drinkingWaterLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const toiletsLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sacHutsLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const modifyInteractionRef = useRef<Modify | null>(null);
  const doubleClickZoomInteractionRef = useRef<DoubleClickZoom | null>(null);
  const pointSourceRef = useRef<VectorSource>(new VectorSource());
  const routeSourceRef = useRef<VectorSource>(new VectorSource());
  const routeCategorySourceRef = useRef<VectorSource>(new VectorSource());
  const graphhopperDebugSourceRef = useRef<VectorSource>(new VectorSource());
  const difficultySourceRef = useRef<VectorSource>(new VectorSource());
  const drinkingWaterSourceRef = useRef<VectorSource>(new VectorSource());
  const toiletsSourceRef = useRef<VectorSource>(new VectorSource());
  const sacHutsSourceRef = useRef<VectorSource>(new VectorSource());
  const elevationHoverSourceRef = useRef<VectorSource>(new VectorSource());
  const analysisRangeSourceRef = useRef<VectorSource>(new VectorSource());
  const difficultyRequestIdRef = useRef(0);
  const officialTrailSegmentsRef = useRef<OfficialTrailSegmentDto[]>([]);
  const difficultyRequestInFlightRef = useRef(false);
  const difficultyQueuedLoadRef = useRef(false);
  const difficultyTimerRef = useRef<number | null>(null);
  const mapFeatureRequestIdRef = useRef(0);
  const sacHutsRequestIdRef = useRef(0);
  const lastHandledFitRequestIdRef = useRef<number | null>(null);
  const lastHandledFitSizeKeyRef = useRef<string | null>(null);
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
  const routeInsertCandidateDragRef = useRef<{
    moved: boolean;
    pointerId: number;
    position: LonLat;
    segmentId: string;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressRouteCandidateClickRef = useRef(false);
  const lastTouchMapClickRef = useRef<{
    pixel: [number, number];
    time: number;
  } | null>(null);
  const suppressNextSingleClickRef = useRef(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [poiLayerError, setPoiLayerError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapSizeKey, setMapSizeKey] = useState("");
  const [mapTilesLoaded, setMapTilesLoaded] = useState(false);
  const [baseLayerId, setBaseLayerId] = useState<BaseLayerId>("standard");
  const [hikingTrailsVisible, setHikingTrailsVisible] = useState(true);
  const [hikingRoutesVisible, setHikingRoutesVisible] = useState(false);
  const [hikingClosuresVisible, setHikingClosuresVisible] = useState(false);
  const [cyclingRoutesVisible, setCyclingRoutesVisible] = useState(false);
  const [difficultyVisible, setDifficultyVisible] = useState(false);
  const [drinkingWaterVisible, setDrinkingWaterVisible] = useState(true);
  const [toiletsVisible, setToiletsVisible] = useState(true);
  const [sacHutsVisible, setSacHutsVisible] = useState(true);
  const [trailMatchDebugVisible, setTrailMatchDebugVisible] = useState(false);
  const [mapLayerMenuOpen, setMapLayerMenuOpen] = useState(false);
  const [poiInfoOpen, setPoiInfoOpen] = useState(false);
  const [selectedWaypointPixel, setSelectedWaypointPixel] = useState<
    [number, number] | null
  >(null);
  const [searchFocusPixel, setSearchFocusPixel] = useState<
    [number, number] | null
  >(null);
  const [routeInsertCandidate, setRouteInsertCandidate] = useState<{
    segmentId: string;
    position: LonLat;
  } | null>(null);
  const [routeInsertCandidatePixel, setRouteInsertCandidatePixel] = useState<
    [number, number] | null
  >(null);
  const [selectedMapFeature, setSelectedMapFeature] =
    useState<MapFeatureInfo | null>(null);
  const [selectedDrinkingWater, setSelectedDrinkingWater] = useState<{
    name: string | null;
    seasonal: boolean;
    osmId: number;
    osmType: string;
  } | null>(null);
  const [selectedToilet, setSelectedToilet] = useState<{
    name: string | null;
    wheelchair: string | null;
    fee: boolean | null;
    osmId: number;
    osmType: string;
  } | null>(null);
  const [selectedSacHut, setSelectedSacHut] = useState<{
    name: string;
    ele?: number;
    sacId: string;
  } | null>(null);
  const selectedWaypointIndex = waypoints.findIndex(
    (waypoint) => waypoint.id === selectedWaypointId,
  );
  const selectedWaypoint =
    selectedWaypointIndex >= 0 ? waypoints[selectedWaypointIndex] : null;
  const canContinueFromSelectedWaypoint =
    interactionMode === "draw" &&
    selectedWaypoint !== null &&
    selectedWaypoint.id !== waypoints.at(-1)?.id;
  const activeRouteInsertCandidate =
    interactionMode === "draw" &&
    routeInsertCandidate &&
    segments.some((segment) => segment.id === routeInsertCandidate.segmentId)
      ? routeInsertCandidate
      : null;
  const trailMatchDebugEnabled = ENABLE_DEV_TOOLS && trailMatchDebugVisible;
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
    const map = mapRef.current;
    const target = targetRef.current;
    if (!mapReady || !map || !target) {
      return;
    }

    function updateMapSize() {
      if (!map) {
        return;
      }
      map.updateSize();
      const size = map.getSize();
      if (size && size[0] > 0 && size[1] > 0) {
        setMapSizeKey(`${Math.round(size[0])}x${Math.round(size[1])}`);
      }
    }

    const observer = new ResizeObserver(updateMapSize);
    observer.observe(target);
    updateMapSize();
    return () => observer.disconnect();
  }, [mapReady]);

  useEffect(() => {
    interactionModeRef.current = interactionMode;
    onInteractionModeChangeRef.current = onInteractionModeChange;
    modifyInteractionRef.current?.setActive(interactionMode === "draw");
    doubleClickZoomInteractionRef.current?.setActive(
      interactionMode !== "draw" || !hasCoarsePointer(),
    );
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
      setSelectedWaypointPixel([Math.round(pixel[0]), Math.round(pixel[1])]);
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
    const map = mapRef.current;
    if (!mapReady || !map || !searchFocus) {
      setSearchFocusPixel(null);
      return;
    }

    const coordinate = fromLonLat([searchFocus.lon, searchFocus.lat]);
    const updatePixel = () => {
      const pixel = map.getPixelFromCoordinate(coordinate);
      setSearchFocusPixel([Math.round(pixel[0]), Math.round(pixel[1])]);
    };

    updatePixel();
    const view = map.getView();
    const listeners = [
      map.on("moveend", updatePixel),
      view.on("change:center", updatePixel),
      view.on("change:resolution", updatePixel),
    ];
    return () => unByKey(listeners);
  }, [mapReady, searchFocus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !activeRouteInsertCandidate) {
      setRouteInsertCandidatePixel(null);
      return;
    }

    const updatePixel = () => {
      const pixel = map.getPixelFromCoordinate(
        fromLonLat([
          activeRouteInsertCandidate.position.lon,
          activeRouteInsertCandidate.position.lat,
        ]),
      );
      setRouteInsertCandidatePixel([
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
    return () => unByKey(listeners);
  }, [activeRouteInsertCandidate, mapReady]);

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
        // ch.swisstopo.swisstlm3d-wanderwege ends at WMTS matrix 18.
        // OpenLayers reuses that last tile level when the map itself is closer.
        maxZoom: 18,
        url: SWISSTOPO_HIKING_TRAILS_WMTS_URL,
      }),
      visible: true,
      zIndex: 10,
    });
    hikingTrailsLayer.set("layerRole", "trail-overlay" satisfies LayerRole);
    const hikingRoutesLayer = new TileLayer({
      minZoom: 10,
      opacity: 0.9,
      source: new XYZ({
        attributions: "© swisstopo",
        crossOrigin: "anonymous",
        url: SWISSTOPO_HIKING_ROUTES_WMTS_URL,
      }),
      visible: false,
      zIndex: 11,
    });
    hikingRoutesLayer.set("layerRole", "trail-overlay" satisfies LayerRole);
    const cyclingRoutesLayer = new TileLayer({
      minZoom: 10,
      opacity: 0.9,
      source: new XYZ({
        attributions: "© swisstopo",
        crossOrigin: "anonymous",
        url: SWISSTOPO_CYCLING_ROUTES_WMTS_URL,
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
    const routeCategoryLayer = new VectorImageLayer({
      imageRatio: 1.2,
      source: routeCategorySourceRef.current,
      style: routeCategoryStyle,
      minZoom: HIKING_TRAIL_OVERLAY_MIN_ZOOM,
      visible: true,
      zIndex: 19,
    });
    routeCategoryLayer.set("layerRole", "overlay" satisfies LayerRole);
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
    const drinkingWaterLayer = new VectorLayer({
      source: drinkingWaterSourceRef.current,
      style: drinkingWaterStyle,
      minZoom: 13,
      visible: false,
      zIndex: 26,
    });
    drinkingWaterLayer.set("layerRole", "overlay" satisfies LayerRole);
    const toiletsLayer = new VectorLayer({
      source: toiletsSourceRef.current,
      style: toiletStyle,
      minZoom: 13,
      visible: false,
      zIndex: 26,
    });
    toiletsLayer.set("layerRole", "overlay" satisfies LayerRole);
    const sacHutsLayer = new VectorLayer({
      source: sacHutsSourceRef.current,
      style: sacHutStyle,
      minZoom: 11,
      visible: false,
      zIndex: 26,
    });
    sacHutsLayer.set("layerRole", "overlay" satisfies LayerRole);
    const elevationHoverLayer = new VectorLayer({
      source: elevationHoverSourceRef.current,
      style: elevationHoverStyle,
      zIndex: 28,
    });
    elevationHoverLayer.set("layerRole", "overlay" satisfies LayerRole);
    const analysisRangeLayer = new VectorLayer({
      source: analysisRangeSourceRef.current,
      style: analysisRangeStyle,
      zIndex: 27,
    });
    analysisRangeLayer.set("layerRole", "overlay" satisfies LayerRole);
    graphhopperDebugLayerRef.current = graphhopperDebugLayer;
    difficultyLayerRef.current = difficultyLayer;
    drinkingWaterLayerRef.current = drinkingWaterLayer;
    toiletsLayerRef.current = toiletsLayer;
    sacHutsLayerRef.current = sacHutsLayer;
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
    const renderCompleteListener = map.once("rendercomplete", () =>
      setMapTilesLoaded(true),
    );
    const doubleClickZoomInteraction = map
      .getInteractions()
      .getArray()
      .find(
        (mapInteraction): mapInteraction is DoubleClickZoom =>
          mapInteraction instanceof DoubleClickZoom,
      );
    doubleClickZoomInteractionRef.current = doubleClickZoomInteraction ?? null;
    doubleClickZoomInteractionRef.current?.setActive(
      interactionModeRef.current !== "draw" || !hasCoarsePointer(),
    );
    map.addLayer(standardLayer);
    map.addLayer(satelliteLayer);
    map.addLayer(osmTopoLayer);
    map.addLayer(hikingTrailsLayer);
    map.addLayer(hikingRoutesLayer);
    map.addLayer(cyclingRoutesLayer);
    map.addLayer(hikingClosuresLayer);
    map.addLayer(difficultyLayer);
    map.addLayer(drinkingWaterLayer);
    map.addLayer(toiletsLayer);
    map.addLayer(sacHutsLayer);
    map.addLayer(routeCategoryLayer);
    map.addLayer(routeLayer);
    map.addLayer(analysisRangeLayer);
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

    // The regular click event is more reliable than singleclick for touch.
    // Mouse route dragging inserts on pointerdown and suppresses its click.
    map.on("click", (event) => {
      const touchLikeInput = isTouchLikeEvent(event.originalEvent);
      if (touchLikeInput) {
        if (interactionModeRef.current === "draw") {
          doubleClickZoomInteractionRef.current?.setActive(false);
        }
        const previousClick = lastTouchMapClickRef.current;
        const currentClick = {
          pixel: [event.pixel[0], event.pixel[1]] as [number, number],
          time: Date.now(),
        };
        lastTouchMapClickRef.current = currentClick;
        if (
          previousClick &&
          currentClick.time - previousClick.time < 350 &&
          Math.hypot(
            currentClick.pixel[0] - previousClick.pixel[0],
            currentClick.pixel[1] - previousClick.pixel[1],
          ) < 24
        ) {
          return;
        }
      }
      if (suppressNextSingleClickRef.current) {
        suppressNextSingleClickRef.current = false;
        return;
      }

      if (routeDragInsertRef.current) {
        return;
      }

      const pointFeatures = map.getFeaturesAtPixel(event.pixel, {
        hitTolerance: touchLikeInput ? 14 : 0,
        layerFilter: (layer) => layer === pointLayer,
      });

      if (pointFeatures.length > 0) {
        setRouteInsertCandidate(null);
        return;
      }

      if (interactionModeRef.current === "explore") {
        setRouteInsertCandidate(null);
        const sacHut = map
          .getFeaturesAtPixel(event.pixel, {
            hitTolerance: touchLikeInput ? 14 : 8,
            layerFilter: (layer) => layer === sacHutsLayer,
          })[0]
          ?.get("sacHut");
        if (isSacHutRecord(sacHut)) {
          setSelectedDrinkingWater(null);
          setSelectedToilet(null);
          setSelectedSacHut({
            name: sacHut.name,
            ele: sacHut.ele,
            sacId: sacHut.sac_id,
          });
          return;
        }
        const drinkingWaterFeature = map.getFeaturesAtPixel(event.pixel, {
          hitTolerance: touchLikeInput ? 14 : 8,
          layerFilter: (layer) => layer === drinkingWaterLayer,
        })[0];
        const drinkingWater = drinkingWaterFeature?.get("drinkingWater");
        if (isDrinkingWaterRecord(drinkingWater)) {
          setSelectedSacHut(null);
          setSelectedToilet(null);
          setSelectedDrinkingWater({
            name: drinkingWater.name,
            seasonal: drinkingWater.seasonal,
            osmId: drinkingWater.osm_id,
            osmType: drinkingWater.osm_type,
          });
          return;
        }
        const toiletFeature = map.getFeaturesAtPixel(event.pixel, {
          hitTolerance: touchLikeInput ? 14 : 8,
          layerFilter: (layer) => layer === toiletsLayer,
        })[0];
        const toilet = toiletFeature?.get("toilet");
        if (isToiletRecord(toilet)) {
          setSelectedSacHut(null);
          setSelectedDrinkingWater(null);
          setSelectedToilet({
            name: toilet.name,
            wheelchair: toilet.wheelchair,
            fee: toilet.fee,
            osmId: toilet.osm_id,
            osmType: toilet.osm_type,
          });
          return;
        }
        const requestId = ++mapFeatureRequestIdRef.current;
        void inspectVisibleWmsFeatures({
          coordinate: event.coordinate,
          resolution: map.getView().getResolution() ?? 1,
          closuresLayer: hikingClosuresLayerRef.current,
          closuresVisible:
            hikingClosuresLayerRef.current?.getVisible() === true,
          cyclingRoutesVisible:
            cyclingRoutesLayerRef.current?.getVisible() === true,
          routesVisible: hikingRoutesLayerRef.current?.getVisible() === true,
        }).then((featureInfo) => {
          if (requestId !== mapFeatureRequestIdRef.current) {
            return;
          }
          setSelectedMapFeature(featureInfo);
        });
        return;
      }

      const routeFeatures = map.getFeaturesAtPixel(event.pixel, {
        hitTolerance: touchLikeInput ? 16 : 8,
        layerFilter: (layer) => layer === routeLayer,
      });
      const routeFeature = routeFeatures[0];
      const segmentId = routeFeature?.get("segmentId");
      const geometry = routeFeature?.getGeometry();
      if (typeof segmentId === "string" && geometry instanceof LineString) {
        const [lon, lat] = toLonLat(geometry.getClosestPoint(event.coordinate));
        if (touchLikeInput) {
          setRouteInsertCandidate({ segmentId, position: { lon, lat } });
          callbacksRef.current.onSelectWaypoint(null);
          return;
        }
        callbacksRef.current.onInsertWaypoint(segmentId, { lon, lat });
        return;
      }

      setRouteInsertCandidate(null);
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
        hasVisibleLayerPixel(hikingRoutesLayer, event.pixel) ||
        hasVisibleLayerPixel(cyclingRoutesLayer, event.pixel);

      target.style.cursor = hasDifficultyInfo || hasWmsInfo ? "help" : "";
    });

    const handleRoutePointerDown = (event: PointerEvent) => {
      if (
        interactionModeRef.current === "draw" &&
        event.pointerType !== "mouse"
      ) {
        doubleClickZoomInteractionRef.current?.setActive(false);
      }
      if (
        interactionModeRef.current !== "draw" ||
        event.pointerType !== "mouse"
      ) {
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
      condition: clickCondition,
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

    const modify = new Modify({
      pixelTolerance: 16,
      source: pointSourceRef.current,
    });
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
      unByKey(renderCompleteListener);
      unByKey(pointerMoveListener);
      viewport.removeEventListener("pointerdown", handleRoutePointerDown);
      window.removeEventListener("pointerup", handleRoutePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
      mapRef.current = null;
      setMapReady(false);
      setMapSizeKey("");
      setMapTilesLoaded(false);
      standardLayerRef.current = null;
      osmTopoLayerRef.current = null;
      hikingTrailsLayerRef.current = null;
      hikingRoutesLayerRef.current = null;
      cyclingRoutesLayerRef.current = null;
      hikingClosuresLayerRef.current = null;
      graphhopperDebugLayerRef.current = null;
      difficultyLayerRef.current = null;
      drinkingWaterLayerRef.current = null;
      toiletsLayerRef.current = null;
      sacHutsLayerRef.current = null;
      modifyInteractionRef.current = null;
      doubleClickZoomInteractionRef.current = null;
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
  }, [
    difficultyVisible,
    hikingClosuresVisible,
    hikingRoutesVisible,
    interactionMode,
    mapReady,
  ]);

  useEffect(() => {
    const pointSource = pointSourceRef.current;
    const routeSource = routeSourceRef.current;
    const routeCategorySource = routeCategorySourceRef.current;
    const graphhopperDebugSource = graphhopperDebugSourceRef.current;
    pointSource.clear();
    routeSource.clear();
    routeCategorySource.clear();
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

    updateRouteCategoryFeatures(
      routeCategorySource,
      routeSource,
      officialTrailSegmentsRef.current,
      hikingTrailsVisible,
    );

    waypoints.forEach((waypoint, index) => {
      const feature = new Feature(
        new Point(fromLonLat([waypoint.position.lon, waypoint.position.lat])),
      );
      feature.set("waypointId", waypoint.id);
      feature.set("waypointIndex", index);
      pointSource.addFeature(feature);
    });
  }, [waypoints, segments, computedSegments, hikingTrailsVisible]);

  useEffect(() => {
    pointSourceRef.current.changed();
  }, [selectedWaypointId]);

  useEffect(() => {
    if (
      !mapReady ||
      !mapSizeKey ||
      (!fitGeometry?.length && waypoints.length === 0)
    ) {
      return;
    }

    const map = mapRef.current;
    const size = map?.getSize();
    if (!map || !size || size[0] <= 0 || size[1] <= 0) {
      return;
    }

    const positions =
      fitGeometry && fitGeometry.length >= 2
        ? fitGeometry
        : waypoints.map((waypoint) => waypoint.position);
    const isExplicitFit = fitRequestId !== lastHandledFitRequestIdRef.current;
    const layoutChanged = mapSizeKey !== lastHandledFitSizeKeyRef.current;
    if (!isExplicitFit && !layoutChanged) {
      return;
    }
    lastHandledFitRequestIdRef.current = fitRequestId;
    lastHandledFitSizeKeyRef.current = mapSizeKey;
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
  }, [fitGeometry, fitRequestId, mapReady, mapSizeKey, waypoints]);

  useEffect(() => {
    const source = analysisRangeSourceRef.current;
    source.clear();
    if (analysisRangeGeometry.length < 2) {
      return;
    }
    source.addFeature(
      new Feature(
        new LineString(
          analysisRangeGeometry.map((point) =>
            fromLonLat([point.lon, point.lat]),
          ),
        ),
      ),
    );
  }, [analysisRangeGeometry]);

  useEffect(() => {
    const source = elevationHoverSourceRef.current;
    source.clear();
    if (!elevationHoverPoint) {
      return;
    }
    const coordinate = fromLonLat([
      elevationHoverPoint.lon,
      elevationHoverPoint.lat,
    ]);
    source.addFeature(new Feature(new Point(coordinate)));

    if (!elevationMarkerAutoPan) {
      return;
    }
    const map = mapRef.current;
    const size = map?.getSize();
    if (!map || !size) {
      return;
    }
    const markerPixel = map.getPixelFromCoordinate(coordinate);
    const topEdge = 70;
    const leftEdge = 40;
    const rightEdge = Math.max(leftEdge, size[0] - 40);
    const bottomEdge = Math.max(
      topEdge,
      size[1] - Math.min(elevationMarkerBottomPadding, size[1] / 2),
    );
    const targetPixel = [
      Math.min(rightEdge, Math.max(leftEdge, markerPixel[0])),
      Math.min(bottomEdge, Math.max(topEdge, markerPixel[1])),
    ];
    if (
      targetPixel[0] === markerPixel[0] &&
      targetPixel[1] === markerPixel[1]
    ) {
      return;
    }
    const center = map.getView().getCenter();
    if (!center) {
      return;
    }
    const centerPixel = map.getPixelFromCoordinate(center);
    const nextCenter = map.getCoordinateFromPixel([
      centerPixel[0] + markerPixel[0] - targetPixel[0],
      centerPixel[1] + markerPixel[1] - targetPixel[1],
    ]);
    map.getView().animate({ center: nextCenter, duration: 180 });
  }, [
    elevationHoverPoint,
    elevationMarkerAutoPan,
    elevationMarkerBottomPadding,
  ]);

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
    const target = fromLonLat([searchFocus.lon, searchFocus.lat]);
    map.getView().animate({
      center: target,
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
    const layer = drinkingWaterLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) {
      return;
    }
    layer.setVisible(drinkingWaterVisible);
    if (!drinkingWaterVisible) {
      drinkingWaterSourceRef.current.clear();
      return;
    }
    let requestId = 0;
    let controller: AbortController | null = null;
    let timer: number | null = null;
    const load = () => {
      controller?.abort();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      const zoom = map.getView().getZoom() ?? 0;
      const size = map.getSize();
      if (zoom < 13 || !size) {
        drinkingWaterSourceRef.current.clear();
        return;
      }
      const extent = transformExtent(
        map.getView().calculateExtent(size),
        "EPSG:3857",
        "EPSG:4326",
      );
      const currentRequestId = ++requestId;
      timer = window.setTimeout(() => {
        controller = new AbortController();
        void getDrinkingWater(
          [extent[0], extent[1], extent[2], extent[3]],
          zoom,
          controller.signal,
        )
          .then((collection) => {
            if (requestId !== currentRequestId) return;
            const source = drinkingWaterSourceRef.current;
            source.clear();
            collection.features.forEach((place) => {
              const feature = new Feature(
                new Point(fromLonLat(place.geometry.coordinates)),
              );
              feature.set("drinkingWater", place.properties);
              source.addFeature(feature);
            });
            setPoiLayerError(null);
          })
          .catch((error: unknown) => {
            if (!isAbortError(error) && requestId === currentRequestId) {
              setPoiLayerError(
                "Trinkwasserstellen konnten nicht geladen werden.",
              );
            }
          });
      }, 150);
    };
    load();
    const listener = map.on("moveend", load);
    return () => {
      controller?.abort();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      unByKey(listener);
    };
  }, [drinkingWaterVisible, mapReady]);

  useEffect(() => {
    const layer = toiletsLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) {
      return;
    }
    layer.setVisible(toiletsVisible);
    if (!toiletsVisible) {
      toiletsSourceRef.current.clear();
      return;
    }
    let requestId = 0;
    let controller: AbortController | null = null;
    let timer: number | null = null;
    const load = () => {
      controller?.abort();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      const zoom = map.getView().getZoom() ?? 0;
      const size = map.getSize();
      if (zoom < 13 || !size) {
        toiletsSourceRef.current.clear();
        return;
      }
      const extent = transformExtent(
        map.getView().calculateExtent(size),
        "EPSG:3857",
        "EPSG:4326",
      );
      const currentRequestId = ++requestId;
      timer = window.setTimeout(() => {
        controller = new AbortController();
        void getToilets(
          [extent[0], extent[1], extent[2], extent[3]],
          zoom,
          controller.signal,
        )
          .then((collection) => {
            if (requestId !== currentRequestId) return;
            const source = toiletsSourceRef.current;
            source.clear();
            collection.features.forEach((toilet) => {
              const feature = new Feature(
                new Point(fromLonLat(toilet.geometry.coordinates)),
              );
              feature.set("toilet", toilet.properties);
              source.addFeature(feature);
            });
            setPoiLayerError(null);
          })
          .catch((error: unknown) => {
            if (!isAbortError(error) && requestId === currentRequestId) {
              setPoiLayerError("WCs konnten nicht geladen werden.");
            }
          });
      }, 150);
    };
    load();
    const listener = map.on("moveend", load);
    return () => {
      controller?.abort();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      unByKey(listener);
    };
  }, [mapReady, toiletsVisible]);

  useEffect(() => {
    const layer = sacHutsLayerRef.current;
    if (!layer) return;
    layer.setVisible(sacHutsVisible);
    if (!sacHutsVisible || sacHutsSourceRef.current.getFeatures().length)
      return;
    const controller = new AbortController();
    const requestId = ++sacHutsRequestIdRef.current;
    void getSacHuts(controller.signal)
      .then((collection) => {
        if (requestId !== sacHutsRequestIdRef.current) return;
        const source = sacHutsSourceRef.current;
        source.clear();
        collection.features.forEach((hut) => {
          const feature = new Feature(
            new Point(fromLonLat(hut.geometry.coordinates)),
          );
          feature.set("sacHut", hut.properties);
          source.addFeature(feature);
        });
        setPoiLayerError(null);
      })
      .catch((error: unknown) => {
        if (!isAbortError(error) && requestId === sacHutsRequestIdRef.current) {
          setPoiLayerError("SAC-Hütten konnten nicht geladen werden.");
        }
      });
    return () => controller.abort();
  }, [mapReady, sacHutsVisible]);

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
      officialTrailSegmentsRef.current = [];
      routeCategorySourceRef.current.clear();
      return;
    }

    if (!difficultyVisible && !trailMatchDebugEnabled) {
      difficultySourceRef.current.clear();
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
        officialTrailSegmentsRef.current = [];
        routeCategorySourceRef.current.clear();
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
        officialTrailSegmentsRef.current = [];
        routeCategorySourceRef.current.clear();
        return;
      }

      if (difficultyRequestInFlightRef.current) {
        difficultyQueuedLoadRef.current = true;
        return;
      }

      const requestId = difficultyRequestIdRef.current + 1;
      difficultyRequestIdRef.current = requestId;
      difficultyRequestInFlightRef.current = true;
      difficultyQueuedLoadRef.current = false;
      getTrailDifficultyWays(
        bbox,
        zoom,
        difficultyVisible || trailMatchDebugEnabled,
        true,
        trailMatchDebugEnabled,
      )
        .then((response) => {
          if (difficultyRequestIdRef.current !== requestId) {
            return;
          }
          if (difficultyQueuedLoadRef.current) {
            return;
          }

          const source = difficultySourceRef.current;
          source.clear();
          officialTrailSegmentsRef.current = response.officialSegments;
          updateRouteCategoryFeatures(
            routeCategorySourceRef.current,
            routeSourceRef.current,
            response.officialSegments,
            hikingTrailsVisible,
          );
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
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          if (difficultyRequestIdRef.current !== requestId) {
            return;
          }
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
    <section className="mapSurface" aria-label={tx("Karte")}>
      <div ref={targetRef} className="mapTarget" />
      {!mapTilesLoaded ? (
        <div className="mapLoadingPlaceholder" aria-live="polite">
          <span aria-hidden="true" />
          {tx("Karte wird geladen")}
        </div>
      ) : null}
      {activeRouteInsertCandidate && routeInsertCandidatePixel ? (
        <button
          type="button"
          className="mapRouteInsert"
          style={{
            left: routeInsertCandidatePixel[0],
            top: routeInsertCandidatePixel[1],
          }}
          aria-label={tx("Zwischenpunkt hier einfügen")}
          title={tx("Zwischenpunkt hier einfügen")}
          onClick={(event) => {
            event.stopPropagation();
            if (suppressRouteCandidateClickRef.current) {
              suppressRouteCandidateClickRef.current = false;
              return;
            }
            callbacksRef.current.onInsertWaypoint(
              activeRouteInsertCandidate.segmentId,
              activeRouteInsertCandidate.position,
            );
            setRouteInsertCandidate(null);
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            routeInsertCandidateDragRef.current = {
              moved: false,
              pointerId: event.pointerId,
              position: activeRouteInsertCandidate.position,
              segmentId: activeRouteInsertCandidate.segmentId,
              startX: event.clientX,
              startY: event.clientY,
            };
          }}
          onPointerMove={(event) => {
            const drag = routeInsertCandidateDragRef.current;
            const map = mapRef.current;
            if (!drag || drag.pointerId !== event.pointerId || !map) {
              return;
            }
            if (
              !drag.moved &&
              Math.hypot(
                event.clientX - drag.startX,
                event.clientY - drag.startY,
              ) < 6
            ) {
              return;
            }
            const coordinate = map.getCoordinateFromPixel(
              map.getEventPixel(event.nativeEvent),
            );
            const [lon, lat] = toLonLat(coordinate);
            drag.moved = true;
            drag.position = { lon, lat };
            setRouteInsertCandidate({
              segmentId: drag.segmentId,
              position: drag.position,
            });
          }}
          onPointerUp={(event) => {
            const drag = routeInsertCandidateDragRef.current;
            routeInsertCandidateDragRef.current = null;
            event.stopPropagation();
            if (!drag?.moved) {
              return;
            }
            event.preventDefault();
            suppressRouteCandidateClickRef.current = true;
            window.setTimeout(() => {
              suppressRouteCandidateClickRef.current = false;
            }, 0);
            callbacksRef.current.onInsertWaypoint(
              drag.segmentId,
              drag.position,
            );
            setRouteInsertCandidate(null);
          }}
          onPointerCancel={() => {
            routeInsertCandidateDragRef.current = null;
          }}
        >
          <span aria-hidden="true">+</span>
        </button>
      ) : null}
      {!panelOpen && selectedWaypoint && selectedWaypointPixel ? (
        <div
          className="mapWaypointActions"
          style={{
            left: selectedWaypointPixel[0],
            top: selectedWaypointPixel[1],
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
        >
          {canContinueFromSelectedWaypoint ? (
            <button
              type="button"
              className="mapWaypointAction mapWaypointContinue"
              aria-label={`${tx("Route hier fortsetzen")} · ${tx("Punkt")} ${selectedWaypointIndex + 1}`}
              title={tx("Route hier fortsetzen")}
              onClick={(event) => {
                event.stopPropagation();
                callbacksRef.current.onAddWaypoint({
                  ...selectedWaypoint.position,
                });
              }}
            >
              <span className="mapWaypointContinueIcon" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="mapWaypointAction mapWaypointDelete"
            aria-label={`${tx("Wegpunkt löschen")} ${selectedWaypointIndex + 1}`}
            title={`${tx("Wegpunkt löschen")} ${selectedWaypointIndex + 1}`}
            onClick={(event) => {
              event.stopPropagation();
              callbacksRef.current.onDeleteWaypoint(selectedWaypoint.id);
            }}
          >
            <span className="mapWaypointDeleteIcon" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {searchFocusPixel ? (
        <div
          className="mapSearchTarget"
          aria-label={tx("Suchziel")}
          style={{ left: searchFocusPixel[0], top: searchFocusPixel[1] }}
        >
          <span aria-hidden="true" />
        </div>
      ) : null}
      <details
        className="mapLayerSelector"
        aria-label={tx("Kartenauswahl")}
        open={mapLayerMenuOpen}
        onToggle={(event) => setMapLayerMenuOpen(event.currentTarget.open)}
      >
        <summary>
          {tx("Karte")}
          <span>{baseLayerLabel(baseLayerId)}</span>
        </summary>
        <div className="mapLayerContent">
          <label htmlFor="base-layer-select">{tx("Basiskarte")}</label>
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
            {tx("Offizielle Wanderwege")}
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
            {tx("Sperrungen")}
          </label>
          {hikingClosuresVisible ? (
            <small className="mapLayerDataHint">
              {tx(
                "Der Layer zeigt gemeldete Sperrungen und Umleitungen. Keine sichtbare Meldung bestätigt nicht, dass die Route frei ist.",
              )}
            </small>
          ) : null}
          <label className="mapOverlayToggle">
            <input
              type="checkbox"
              checked={cyclingRoutesVisible}
              onChange={(event) => {
                if (!event.target.checked) {
                  setSelectedMapFeature((feature) =>
                    feature?.kind === "veloland" ? null : feature,
                  );
                }
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
                setDifficultyVisible(enabled);
                setMapLayerMenuOpen(false);
              }}
            />
            {t("difficulty")}
          </label>
          <div className="mapPoiLayerControl">
            <label className="mapOverlayToggle">
              <input
                type="checkbox"
                checked={drinkingWaterVisible && toiletsVisible}
                onChange={(event) => {
                  const visible = event.target.checked;
                  setDrinkingWaterVisible(visible);
                  setToiletsVisible(visible);
                  if (!visible) {
                    setSelectedDrinkingWater(null);
                    setSelectedToilet(null);
                  }
                  setMapLayerMenuOpen(false);
                }}
              />
              Wasser &amp; WCs
            </label>
            <button
              type="button"
              className="mapPoiInfoButton"
              aria-label="Informationen zu Wasser- und WC-Daten"
              aria-expanded={poiInfoOpen}
              aria-controls="poi-layer-info"
              onClick={() => setPoiInfoOpen((open) => !open)}
            >
              i
            </button>
          </div>
          {poiInfoOpen ? (
            <small id="poi-layer-info" className="mapLayerDataHint">
              Trinkwasserstellen und WCs stammen aus OpenStreetMap. Die Daten
              werden von der Community gepflegt und können fehlen, veraltet oder
              falsch sein. Prüfe die Situation vor Ort.
            </small>
          ) : null}
          <label className="mapOverlayToggle">
            <input
              type="checkbox"
              checked={sacHutsVisible}
              onChange={(event) => {
                const visible = event.target.checked;
                setSacHutsVisible(visible);
                if (!visible) {
                  setSelectedSacHut(null);
                }
                setMapLayerMenuOpen(false);
              }}
            />
            SAC-Hütten
          </label>
          {ENABLE_DEV_TOOLS ? (
            <label className="mapOverlayToggle">
              <input
                type="checkbox"
                checked={trailMatchDebugVisible}
                onChange={(event) => {
                  setTrailMatchDebugVisible(event.target.checked);
                  setMapLayerMenuOpen(false);
                }}
              />
              Match Debug
            </label>
          ) : null}
        </div>
      </details>
      {!panelOpen &&
      sacHutsVisible &&
      selectedSacHut &&
      interactionMode === "explore" ? (
        <aside className="mapFeaturePanel" aria-label="SAC-Hütte Details">
          <div className="mapFeaturePanelHeader">
            <div>
              <span>⌂ SAC-Hütte</span>
              <strong>{selectedSacHut.name}</strong>
            </div>
            <button
              type="button"
              onClick={() => setSelectedSacHut(null)}
              aria-label="Schliessen"
            >
              ×
            </button>
          </div>
          {selectedSacHut.ele ? <p>{selectedSacHut.ele} m ü. M.</p> : null}
          <a
            href={`https://www.sac-cas.ch/de/huetten-und-touren/sac-tourenportal/${selectedSacHut.sacId}/`}
            target="_blank"
            rel="noreferrer"
          >
            SAC-Tourenportal
          </a>
        </aside>
      ) : null}
      {!panelOpen &&
      drinkingWaterVisible &&
      selectedDrinkingWater &&
      interactionMode === "explore" ? (
        <aside className="mapFeaturePanel" aria-label="Trinkwasser Details">
          <div className="mapFeaturePanelHeader">
            <div>
              <span>💧 Trinkwasser</span>
              <strong>{selectedDrinkingWater.name ?? "Trinkwasser"}</strong>
            </div>
            <button
              type="button"
              onClick={() => setSelectedDrinkingWater(null)}
              aria-label="Schliessen"
            >
              ×
            </button>
          </div>
          <p>
            {selectedDrinkingWater.seasonal
              ? "Saisonal verfügbar"
              : "Ganzjährig"}
          </p>
          <a
            href={`https://www.openstreetmap.org/${selectedDrinkingWater.osmType}/${selectedDrinkingWater.osmId}`}
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap
          </a>
        </aside>
      ) : null}
      {!panelOpen &&
      toiletsVisible &&
      selectedToilet &&
      interactionMode === "explore" ? (
        <aside className="mapFeaturePanel" aria-label="WC Details">
          <div className="mapFeaturePanelHeader">
            <div>
              <span>WC</span>
              <strong>{selectedToilet.name ?? "Öffentliches WC"}</strong>
            </div>
            <button
              type="button"
              onClick={() => setSelectedToilet(null)}
              aria-label="Schliessen"
            >
              ×
            </button>
          </div>
          <p>Öffentlich zugänglich (laut OSM)</p>
          {selectedToilet.wheelchair === "yes" ? <p>Rollstuhlgängig</p> : null}
          {selectedToilet.fee === true ? <p>Kostenpflichtig</p> : null}
          <a
            href={`https://www.openstreetmap.org/${selectedToilet.osmType}/${selectedToilet.osmId}`}
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap
          </a>
        </aside>
      ) : null}
      {!panelOpen &&
      selectedMapFeature &&
      interactionMode === "explore" &&
      (selectedMapFeature.kind === "closure"
        ? hikingClosuresVisible
        : selectedMapFeature.kind === "wanderland"
          ? hikingRoutesVisible
          : cyclingRoutesVisible) ? (
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
      {mapError || poiLayerError ? (
        <div className="mapNotice">{mapError ?? poiLayerError}</div>
      ) : null}
      <div className="attribution" aria-label={tx("Datenquellen")}>
        <span>{tx("Datenquellen")}:</span>
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
  const { tx } = useI18n();
  return (
    <aside className="mapFeaturePanel" aria-label={`${feature.kind} Details`}>
      <div className="mapFeaturePanelHeader">
        <div>
          <span>
            {feature.kind === "closure"
              ? tx("Sperrung")
              : feature.kind === "veloland"
                ? "Veloland"
                : "Wanderland"}
          </span>
          <strong>{feature.title}</strong>
        </div>
        <button
          type="button"
          aria-label={tx("Karteninformation schliessen")}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {feature.details.length ? (
        <dl>
          {feature.details.map(([label, value]) => (
            <div key={`${label}:${value}`}>
              <dt>{tx(label)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>{tx("Keine weiteren Angaben verfügbar.")}</p>
      )}
      {feature.schweizMobilUrl ? (
        <a href={feature.schweizMobilUrl} target="_blank" rel="noreferrer">
          {tx("Auf SchweizMobil öffnen")}
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
  routesVisible,
  cyclingRoutesVisible,
}: {
  coordinate: number[];
  resolution: number;
  closuresLayer: TileLayer<TileWMS> | null;
  closuresVisible: boolean;
  routesVisible: boolean;
  cyclingRoutesVisible: boolean;
}): Promise<MapFeatureInfo | null> {
  if (closuresVisible) {
    const closure = await getWmsFeatureInfo(
      closuresLayer,
      coordinate,
      resolution,
    );
    if (closure) {
      return closure;
    }
  }

  // Wanderland and Veloland use CORS-safe WMTS tiles. Their details are
  // fetched through Django's fixed swisstopo adapter, not directly from WMS.
  for (const layer of [
    ...(cyclingRoutesVisible ? (["veloland"] as const) : []),
    ...(routesVisible ? (["wanderland"] as const) : []),
  ]) {
    try {
      const response = await getMapFeatureInfo(
        layer,
        [coordinate[0], coordinate[1]],
        resolution,
      );
      if (response.feature) {
        return response.feature;
      }
    } catch {
      // Map details are supplementary; the WMTS route overlay remains usable.
    }
  }

  return null;
}

async function getWmsFeatureInfo(
  layer: TileLayer<TileWMS> | null,
  coordinate: number[],
  resolution: number,
): Promise<MapFeatureInfo | null> {
  const source = layer?.getSource();
  const url = source?.getFeatureInfoUrl(coordinate, resolution, "EPSG:3857", {
    FEATURE_COUNT: 1,
    INFO_FORMAT: "text/plain",
  });
  if (!url) {
    return null;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return parseClosureFeatureInfo(await response.text());
  } catch {
    return null;
  }
}

function isDrinkingWaterRecord(value: unknown): value is {
  name: string | null;
  seasonal: boolean;
  osm_id: number;
  osm_type: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    (typeof value.name === "string" || value.name === null) &&
    "seasonal" in value &&
    typeof value.seasonal === "boolean" &&
    "osm_id" in value &&
    typeof value.osm_id === "number" &&
    "osm_type" in value &&
    typeof value.osm_type === "string"
  );
}

function isToiletRecord(value: unknown): value is {
  name: string | null;
  wheelchair: string | null;
  fee: boolean | null;
  osm_id: number;
  osm_type: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    (typeof value.name === "string" || value.name === null) &&
    "wheelchair" in value &&
    (typeof value.wheelchair === "string" || value.wheelchair === null) &&
    "fee" in value &&
    (typeof value.fee === "boolean" || value.fee === null) &&
    "osm_id" in value &&
    typeof value.osm_id === "number" &&
    "osm_type" in value &&
    typeof value.osm_type === "string"
  );
}

function isSacHutRecord(
  value: unknown,
): value is { name: string; ele?: number; sac_id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "sac_id" in value &&
    typeof value.sac_id === "string"
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function hasVisibleLayerPixel(
  layer: TileLayer<TileWMS> | TileLayer<XYZ>,
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

function hasCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

function isTouchLikeEvent(event: Event): boolean {
  if ("pointerType" in event) {
    return event.pointerType === "touch" || event.pointerType === "pen";
  }
  return hasCoarsePointer();
}
