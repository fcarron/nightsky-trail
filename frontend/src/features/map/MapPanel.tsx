import "ol/ol.css";

import Feature from "ol/Feature.js";
import type { FeatureLike } from "ol/Feature.js";
import Map from "ol/Map.js";
import { unByKey } from "ol/Observable.js";
import View from "ol/View.js";
import { defaults as defaultControls } from "ol/control/defaults.js";
import { LineString, MultiPoint, Point } from "ol/geom.js";
import Modify from "ol/interaction/Modify.js";
import Select from "ol/interaction/Select.js";
import TileLayer from "ol/layer/Tile.js";
import VectorLayer from "ol/layer/Vector.js";
import { fromLonLat, toLonLat, transformExtent } from "ol/proj.js";
import XYZ from "ol/source/XYZ.js";
import VectorSource from "ol/source/Vector.js";
import { Circle, Fill, Stroke, Style, Text } from "ol/style.js";
import { apply } from "ol-mapbox-style";
import { useEffect, useRef, useState } from "react";

import { getTrailDifficultyWays } from "../../services/api";
import type { CombinedTrailSegmentDto, TrailSummaryDto } from "../../types/api";
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
  const difficultyLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const pointSourceRef = useRef<VectorSource>(new VectorSource());
  const routeSourceRef = useRef<VectorSource>(new VectorSource());
  const graphhopperDebugSourceRef = useRef<VectorSource>(new VectorSource());
  const difficultySourceRef = useRef<VectorSource>(new VectorSource());
  const difficultyRequestIdRef = useRef(0);
  const difficultyRequestInFlightRef = useRef(false);
  const difficultyQueuedLoadRef = useRef(false);
  const difficultyTimerRef = useRef<number | null>(null);
  const callbacksRef = useRef({
    onAddWaypoint,
    onInsertWaypoint,
    onMoveWaypoint,
    onSelectWaypoint,
  });
  const selectedWaypointIdRef = useRef(selectedWaypointId);
  const baseLayerIdRef = useRef<BaseLayerId>("light");
  const difficultyVisibleRef = useRef(false);
  const trailMatchDebugVisibleRef = useRef(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [baseLayerId, setBaseLayerId] = useState<BaseLayerId>("light");
  const [hikingTrailsVisible, setHikingTrailsVisible] = useState(true);
  const [difficultyVisible, setDifficultyVisible] = useState(false);
  const [trailMatchDebugVisible, setTrailMatchDebugVisible] = useState(false);
  const [difficultyStatus, setDifficultyStatus] = useState("OSM Zusatz aus");
  const [difficultyLimitedToKnown, setDifficultyLimitedToKnown] = useState(false);
  const [difficultySummary, setDifficultySummary] = useState<DifficultySummary>(
    EMPTY_DIFFICULTY_SUMMARY,
  );
  const [selectedDifficultyWay, setSelectedDifficultyWay] = useState<{
    segment: CombinedTrailSegmentDto;
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
    difficultyVisibleRef.current = difficultyVisible;
  }, [difficultyVisible]);

  useEffect(() => {
    trailMatchDebugVisibleRef.current = trailMatchDebugVisible;
  }, [trailMatchDebugVisible]);

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
      minZoom: 13,
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
    const difficultyLayer = new VectorLayer({
      source: difficultySourceRef.current,
      style: difficultyStyle,
      visible: false,
      zIndex: 24,
    });
    difficultyLayer.set("layerRole", "overlay" satisfies LayerRole);
    graphhopperDebugLayerRef.current = graphhopperDebugLayer;
    difficultyLayerRef.current = difficultyLayer;
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
    map.addLayer(difficultyLayer);
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
        setSelectedDifficultyWay({ segment: combinedSegment });
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
    setMapReady(true);

    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
      setMapReady(false);
      standardLayerRef.current = null;
      osmTopoLayerRef.current = null;
      hikingTrailsLayerRef.current = null;
      graphhopperDebugLayerRef.current = null;
      difficultyLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    baseLayerIdRef.current = baseLayerId;
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }

    updateBaseLayerVisibility(map, baseLayerId);
  }, [baseLayerId, mapReady]);

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
    hikingTrailsLayerRef.current?.setVisible(hikingTrailsVisible);
    difficultyLayerRef.current?.setVisible(
      difficultyVisible || trailMatchDebugVisible,
    );

    if (!difficultyVisible && !hikingTrailsVisible && !trailMatchDebugVisible) {
      difficultyRequestIdRef.current += 1;
      difficultyRequestInFlightRef.current = false;
      difficultyQueuedLoadRef.current = false;
      difficultySourceRef.current.clear();
      return;
    }

    if (!difficultyVisible && !trailMatchDebugVisible) {
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
      difficultyTimerRef.current = window.setTimeout(loadDifficultyWays, delayMs);
    }

    function loadDifficultyWays() {
      const currentMap = mapRef.current;
      if (!currentMap) {
        return;
      }

      const zoom = currentMap.getView().getZoom() ?? 0;
      if (zoom < 13) {
        difficultyRequestIdRef.current += 1;
        difficultyRequestInFlightRef.current = false;
        difficultyQueuedLoadRef.current = false;
        setDifficultyStatus("OSM Zusatz ab Zoom 13");
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
      if (bboxArea > 0.02) {
        difficultyRequestIdRef.current += 1;
        difficultyRequestInFlightRef.current = false;
        difficultyQueuedLoadRef.current = false;
        setDifficultyStatus("OSM Zusatz: bitte weiter hineinzoomen");
        return;
      }

      if (difficultyRequestInFlightRef.current) {
        difficultyQueuedLoadRef.current = true;
        setDifficultyStatus("OSM Zusatz lädt · neuer Ausschnitt vorgemerkt");
        return;
      }

      const requestId = difficultyRequestIdRef.current + 1;
      difficultyRequestIdRef.current = requestId;
      difficultyRequestInFlightRef.current = true;
      difficultyQueuedLoadRef.current = false;
      setDifficultyStatus("OSM Zusatz lädt");

      getTrailDifficultyWays(
        bbox,
        zoom,
        true,
        false,
        trailMatchDebugVisible,
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
          setDifficultySummary(toDifficultySummary(response.trailSummary));
          setDifficultyLimitedToKnown(response.warnings.length > 0);
          response.combinedSegments
            .filter(
              (segment) => segment.warningOverlay || trailMatchDebugVisible,
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
          if (!trailMatchDebugVisible) {
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
              ? "OSM Zusatz nicht verfügbar · letzter Stand"
              : "OSM Zusatz nicht verfügbar",
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
  }, [difficultyVisible, hikingTrailsVisible, mapReady, trailMatchDebugVisible]);

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
          Offizielle Wanderwege
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
                enabled ? "OSM Zusatz lädt" : "OSM Zusatz aus",
              );
              setDifficultyVisible(enabled);
            }}
          />
          OSM Zusatz
        </label>
        <label className="mapOverlayToggle">
          <input
            type="checkbox"
            checked={trailMatchDebugVisible}
            onChange={(event) => {
              setSelectedDifficultyWay(null);
              setTrailMatchDebugVisible(event.target.checked);
            }}
          />
          Match Debug
        </label>
      </div>
      {difficultyVisible || trailMatchDebugVisible ? (
        <div className="difficultyPanel" aria-live="polite">
          <strong>{difficultyStatus}</strong>
          {selectedDifficultyWay ? (
            <>
              <div className="difficultySelectedTitle">
                {formatOfficialCategory(
                  selectedDifficultyWay.segment.officialCategory,
                )}{" "}
                + OSM {formatSacScale(selectedDifficultyWay.segment.osmSacScale)}
              </div>
              <dl>
                <div>
                  <dt>Official category</dt>
                  <dd>
                    {formatOfficialCategory(
                      selectedDifficultyWay.segment.officialCategory,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>OSM difficulty</dt>
                  <dd>{formatSacScale(selectedDifficultyWay.segment.osmSacScale)}</dd>
                </div>
                <div>
                  <dt>Match quality</dt>
                  <dd>{formatMatchQuality(selectedDifficultyWay.segment.matchScore)}</dd>
                </div>
                <div>
                  <dt>Match status</dt>
                  <dd>{selectedDifficultyWay.segment.matchStatus}</dd>
                </div>
                <div>
                  <dt>Quelle</dt>
                  <dd>OpenStreetMap way {selectedDifficultyWay.segment.osmWayId}</dd>
                </div>
              </dl>
            </>
          ) : (
            <>
              <div className="difficultySummaryGrid" aria-label="OSM T-Level im Ausschnitt">
                {DIFFICULTY_LEGEND.map((item) => (
                  <div key={item.label}>
                    <span
                      className="difficultySwatch"
                      style={{ background: item.color }}
                    />
                    <span>{item.label}</span>
                    <strong>{difficultySummary.byLabel[item.label] ?? 0}</strong>
                  </div>
                ))}
              </div>
              {difficultySummary.commonTags.length ? (
                <dl>
                  {difficultySummary.commonTags.map(([key, value], index) => (
                    <div key={`${key}=${value}:${index}`}>
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <span>
                  {difficultyStatus.includes("nicht verfügbar")
                    ? "OSM-Datenquelle nicht verfügbar."
                    : difficultyLimitedToKnown
                      ? "Keine bekannten OSM-Zusatzhinweise im Ausschnitt geladen. Weiter hineinzoomen für OSM-Wege ohne T-Angabe."
                      : "Keine OSM-Wege im Ausschnitt geladen."}
                </span>
              )}
            </>
          )}
        </div>
      ) : null}
      {hikingTrailsVisible || difficultyVisible ? (
        <div
          className="trailLegend"
          aria-label="Weg- und Zusatzlegende"
        >
          {hikingTrailsVisible ? (
            <section>
              <strong>swisstopo offiziell</strong>
              <div>
                <span className="officialLine officialLineHiking" />
                Wanderweg
              </div>
              <div>
                <span className="officialLine officialLineMountain" />
                Bergwanderweg
              </div>
              <div>
                <span className="officialLine officialLineAlpine" />
                Alpinwanderweg
              </div>
            </section>
          ) : null}
          {difficultyVisible ? (
            <section>
              <strong>OSM Zusatz</strong>
              {SUPPLEMENT_LEGEND.map((item) => (
                <div key={item.label}>
                  <span
                    className="difficultySwatch"
                    style={{ background: item.color }}
                  />
                  {item.label}
                </div>
              ))}
            </section>
          ) : null}
          {trailMatchDebugVisible ? (
            <section>
              <strong>Match Debug</strong>
              <div>
                <span className="debugLine debugLineMatched" />
                matched
              </div>
              <div>
                <span className="debugLine debugLineAmbiguous" />
                ambiguous
              </div>
              <div>
                <span className="debugLine debugLineOsmOnly" />
                osm_only
              </div>
            </section>
          ) : null}
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

function difficultyStyle(feature: FeatureLike, resolution: number): Style[] {
  if (feature.get("warningOverlay") !== true) {
    const segment = feature.get("combinedSegment");
    const status = isCombinedTrailSegmentRecord(segment)
      ? segment.matchStatus
      : "unknown";
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

interface DifficultySummary {
  byLabel: Record<string, number>;
  commonTags: [string, string][];
}

const EMPTY_DIFFICULTY_SUMMARY: DifficultySummary = {
  byLabel: {},
  commonTags: [],
};

const DIFFICULTY_LEGEND = [
  { label: "?", color: "#6b7280" },
  { label: "<T1", color: "#6b7280" },
  { label: "T1", color: "#6b7280" },
  { label: "T2", color: "#6b7280" },
  { label: "T3", color: "#05070a" },
  { label: "T4", color: "#6b7280" },
  { label: "T5", color: "#05070a" },
  { label: "T6", color: "#05070a" },
];

const SUPPLEMENT_LEGEND = [
  { label: "T3 auf rot", color: "#05070a" },
  { label: "T5/T6 auf blau", color: "#05070a" },
];

const SAC_SCALE_BY_OSM_VALUE: Record<string, { label: string }> = {
  strolling: { label: "<T1" },
  hiking: { label: "T1" },
  mountain_hiking: { label: "T2" },
  demanding_mountain_hiking: { label: "T3" },
  alpine_hiking: { label: "T4" },
  demanding_alpine_hiking: { label: "T5" },
  difficult_alpine_hiking: { label: "T6" },
};

function formatSacScale(value: string | null | undefined): string {
  if (!value) {
    return "?";
  }
  return SAC_SCALE_BY_OSM_VALUE[value]?.label ?? value;
}

function formatOfficialCategory(category: string | null): string {
  if (category === "hiking_trail") {
    return "Wanderweg";
  }
  if (category === "mountain_hiking_trail") {
    return "Bergwanderweg";
  }
  if (category === "alpine_hiking_trail") {
    return "Alpinwanderweg";
  }
  return "Unbekannt";
}

function formatMatchQuality(score: number): string {
  if (score >= 0.9) {
    return "high";
  }
  if (score >= 0.78) {
    return "medium";
  }
  return "low";
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

function toDifficultySummary(summary: TrailSummaryDto): DifficultySummary {
  return {
    byLabel: summary.byLabel,
    commonTags: summary.commonTags.map((tag) => [tag.key, tag.value]),
  };
}
