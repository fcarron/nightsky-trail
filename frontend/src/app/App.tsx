import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import { ElevationPanel } from "../features/elevation/ElevationPanel";
import {
  formatDurationMinutes,
  toElevationProfile,
  toElevationProfileRequest,
} from "../features/elevation/elevationModel";
import type { ElevationProfile } from "../features/elevation/elevationModel";
import { MapPanel } from "../features/map/MapPanel";
import {
  distanceMetersBetween,
  formatDistance,
  summarizeRoute,
} from "../features/route/routeGeometry";
import {
  toComputedRoute,
  toRouteComputeRequest,
} from "../features/route/routeApi";
import {
  createPlannerHistory,
  initialPlannerHistory,
  routePlannerReducer,
} from "../features/route/routePlanner";
import type { ComputedRoute, LonLat } from "../features/route/routeModel";
import {
  loadStoredRoute,
  saveStoredRoute,
} from "../features/route/routeStorage";
import {
  ApiRequestError,
  computeElevationProfile,
  computeRoute,
  getHealth,
} from "../services/api";
import "./App.css";
import { ENABLE_DEV_TOOLS } from "./config";

type HealthState = "checking" | "ok" | "unavailable";
type RouteComputeStatus = "idle" | "loading" | "ready" | "error";
type ElevationStatus = "idle" | "loading" | "ready" | "error";

interface RouteComputeState {
  route: ComputedRoute | null;
  status: RouteComputeStatus;
  message: string | null;
}

type RouteComputeAction =
  | { type: "started" }
  | { type: "succeeded"; route: ComputedRoute }
  | { type: "failed"; message: string };

interface ElevationState {
  profile: ElevationProfile | null;
  status: ElevationStatus;
  message: string | null;
}

type ElevationAction =
  | { type: "cleared" }
  | { type: "started" }
  | { type: "succeeded"; profile: ElevationProfile }
  | { type: "failed"; message: string };

const initialRouteComputeState: RouteComputeState = {
  route: null,
  status: "idle",
  message: null,
};

const initialElevationState: ElevationState = {
  profile: null,
  status: "idle",
  message: null,
};
const DEFAULT_BASE_PACE_MIN_PER_KM = 6.5;
const SWISS_HIKING_FLAT_PACE_MIN_PER_KM = 14.271;
const BASE_PACE_STORAGE_KEY = "swiss-route-planner.base-pace-min-per-km.v1";
const CALIBRATED_TIME_STORAGE_KEY = "swiss-route-planner.calibrated-time-enabled.v1";

export function App() {
  const [health, setHealth] = useState<HealthState>("checking");
  const [graphhopperDebugVisible, setGraphhopperDebugVisible] = useState(false);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(
    null,
  );
  const [elevationHoverPoint, setElevationHoverPoint] = useState<LonLat | null>(
    null,
  );
  const [basePaceMinPerKm, setBasePaceMinPerKm] = useState(
    loadBasePaceMinPerKm,
  );
  const [basePaceInput, setBasePaceInput] = useState(() =>
    formatPaceInput(loadBasePaceMinPerKm()),
  );
  const [calibratedTimeEnabled, setCalibratedTimeEnabled] = useState(
    loadCalibratedTimeEnabled,
  );
  const [routeComputeState, dispatchRouteCompute] = useReducer(
    routeComputeReducer,
    initialRouteComputeState,
  );
  const [elevationState, dispatchElevation] = useReducer(
    elevationReducer,
    initialElevationState,
  );
  const [history, dispatch] = useReducer(
    routePlannerReducer,
    initialPlannerHistory,
    () => createPlannerHistory(loadStoredRoute()),
  );
  const waypointCounterRef = useRef(0);
  const routeRequestIdRef = useRef(0);
  const elevationRequestIdRef = useRef(0);
  const effectiveComputedRoute =
    history.present.waypoints.length >= 2 ? routeComputeState.route : null;
  const effectiveRouteComputeStatus =
    history.present.waypoints.length >= 2 ? routeComputeState.status : "idle";
  const routeSummary = useMemo(
    () =>
      effectiveComputedRoute
        ? {
            waypointCount: history.present.waypoints.length,
            segmentCount: effectiveComputedRoute.segments.length,
            distanceMeters: effectiveComputedRoute.distanceMeters,
          }
        : summarizeRoute(history.present),
    [effectiveComputedRoute, history.present],
  );
  const firstWaypoint = history.present.waypoints[0] ?? null;
  const lastWaypoint = history.present.waypoints.at(-1) ?? null;
  const selectedWaypoint =
    history.present.waypoints.find((waypoint) => waypoint.id === selectedWaypointId) ??
    null;
  const intermediateWaypointCount = Math.max(
    0,
    history.present.waypoints.length - 2,
  );
  const loopGapMeters =
    firstWaypoint && lastWaypoint && history.present.waypoints.length >= 2
      ? distanceMetersBetween(firstWaypoint.position, lastWaypoint.position)
      : null;
  const isClosedLoop =
    loopGapMeters !== null &&
    history.present.waypoints.length >= 3 &&
    loopGapMeters <= 30;
  const ascentMeters = elevationState.profile?.ascentMeters ?? null;
  const climbMetersPerKilometer =
    ascentMeters !== null && routeSummary.distanceMeters > 0
      ? ascentMeters / (routeSummary.distanceMeters / 1000)
      : null;
  const estimatedEffortMinutes = elevationState.profile
    ? estimateEffortMinutes(
        elevationState.profile.hikingTime.durationMinutes,
        basePaceMinPerKm,
      )
    : null;
  const displayedDurationMinutes = elevationState.profile
    ? calibratedTimeEnabled
      ? estimatedEffortMinutes
      : elevationState.profile.hikingTime.durationMinutes
    : null;
  const graphhopperDebugSummary = useMemo(
    () => summarizeGraphhopperDebug(effectiveComputedRoute),
    [effectiveComputedRoute],
  );

  useEffect(() => {
    const controller = new AbortController();

    getHealth(controller.signal)
      .then(() => setHealth("ok"))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setHealth("unavailable");
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    saveStoredRoute(history.present);
  }, [history.present]);

  useEffect(() => {
    window.localStorage.setItem(BASE_PACE_STORAGE_KEY, String(basePaceMinPerKm));
  }, [basePaceMinPerKm]);

  useEffect(() => {
    window.localStorage.setItem(
      CALIBRATED_TIME_STORAGE_KEY,
      calibratedTimeEnabled ? "true" : "false",
    );
  }, [calibratedTimeEnabled]);

  useEffect(() => {
    if (history.present.waypoints.length < 2) {
      routeRequestIdRef.current += 1;
      return;
    }

    const requestId = routeRequestIdRef.current + 1;
    routeRequestIdRef.current = requestId;
    const controller = new AbortController();

    dispatchRouteCompute({ type: "started" });

    computeRoute(toRouteComputeRequest(history.present), controller.signal)
      .then((response) => {
        if (routeRequestIdRef.current !== requestId) {
          return;
        }

        dispatchRouteCompute({
          type: "succeeded",
          route: toComputedRoute(response),
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (routeRequestIdRef.current !== requestId) {
          return;
        }

        dispatchRouteCompute({
          type: "failed",
          message:
            error instanceof ApiRequestError
              ? error.message
              : "Route konnte nicht berechnet werden.",
        });
      });

    return () => controller.abort();
  }, [history.present]);

  useEffect(() => {
    if (!effectiveComputedRoute) {
      elevationRequestIdRef.current += 1;
      dispatchElevation({ type: "cleared" });
      return;
    }

    const requestId = elevationRequestIdRef.current + 1;
    elevationRequestIdRef.current = requestId;
    const controller = new AbortController();

    dispatchElevation({ type: "started" });

    computeElevationProfile(
      toElevationProfileRequest(effectiveComputedRoute),
      controller.signal,
    )
      .then((response) => {
        if (elevationRequestIdRef.current !== requestId) {
          return;
        }

        dispatchElevation({
          type: "succeeded",
          profile: toElevationProfile(response),
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (elevationRequestIdRef.current !== requestId) {
          return;
        }

        dispatchElevation({
          type: "failed",
          message:
            error instanceof ApiRequestError
              ? error.message
              : "Höhenprofil konnte nicht berechnet werden.",
        });
      });

    return () => controller.abort();
  }, [effectiveComputedRoute]);

  useEffect(() => {
    waypointCounterRef.current = Math.max(
      waypointCounterRef.current,
      highestWaypointNumber(
        history.present.waypoints.map((waypoint) => waypoint.id),
      ),
    );
  }, [history.present.waypoints]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      const modifierPressed = event.metaKey || event.ctrlKey;
      if (
        modifierPressed &&
        event.key.toLowerCase() === "z" &&
        event.shiftKey
      ) {
        event.preventDefault();
        dispatch({ type: "redo" });
        return;
      }

      if (modifierPressed && event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatch({ type: "undo" });
        return;
      }

      if (modifierPressed && event.key.toLowerCase() === "y") {
        event.preventDefault();
        dispatch({ type: "redo" });
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selectedWaypointId) {
          return;
        }

        event.preventDefault();
        dispatch({ type: "delete-waypoint", id: selectedWaypointId });
        setSelectedWaypointId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedWaypointId]);

  const healthLabel =
    health === "ok"
      ? "API bereit"
      : health === "checking"
        ? "API wird geprüft"
        : "API nicht erreichbar";

  function addWaypoint(position: LonLat) {
    const id = nextWaypointId(waypointCounterRef);
    dispatch({ type: "add-waypoint", waypoint: { id, position } });
    setSelectedWaypointId(id);
  }

  function insertWaypoint(segmentId: string, position: LonLat) {
    const id = nextWaypointId(waypointCounterRef);
    dispatch({
      type: "insert-waypoint",
      segmentId,
      waypoint: { id, position },
    });
    setSelectedWaypointId(id);
    return id;
  }

  function moveWaypoint(id: string, position: LonLat) {
    dispatch({ type: "move-waypoint", id, position });
  }

  function deleteSelectedWaypoint() {
    if (!selectedWaypointId) {
      return;
    }

    dispatch({ type: "delete-waypoint", id: selectedWaypointId });
    setSelectedWaypointId(null);
  }

  function clearRoute() {
    dispatch({ type: "clear" });
    setSelectedWaypointId(null);
  }

  function closeLoop() {
    if (!firstWaypoint || history.present.waypoints.length < 2 || isClosedLoop) {
      return;
    }

    const id = nextWaypointId(waypointCounterRef);
    dispatch({
      type: "add-waypoint",
      waypoint: { id, position: firstWaypoint.position },
    });
    setSelectedWaypointId(id);
  }

  function updateBasePaceInput(value: string) {
    setBasePaceInput(value);
    const parsedValue = parsePaceInput(value);
    if (parsedValue === null) {
      return;
    }
    setBasePaceMinPerKm(parsedValue);
  }

  function stepBasePace(deltaSeconds: number) {
    const nextValue = clampPaceMinutes(basePaceMinPerKm + deltaSeconds / 60);
    setBasePaceMinPerKm(nextValue);
    setBasePaceInput(formatPaceInput(nextValue));
  }

  function toggleSegmentMode(segmentId: string) {
    const segment = history.present.segments.find(
      (item) => item.id === segmentId,
    );
    if (!segment) {
      return;
    }

    dispatch({
      type: "set-segment-mode",
      id: segmentId,
      mode: segment.mode === "straight" ? "routed" : "straight",
    });
  }

  return (
    <main className="appShell">
      <header className="topBar">
        <div className="brand">
          <strong>Swiss Route Planner</strong>
          <span>Planung für Schweizer Wege</span>
        </div>
        <span className="status" aria-live="polite">
          {healthLabel}
        </span>
      </header>

      <section className="plannerLayout" aria-label="Routenplaner">
        <aside className="sidebar">
          <div className="sidebarHeader">
            <h1>Trailrunde planen</h1>
            <p>Klick setzt Punkte. Linie ziehen verfeinert die Runde.</p>
          </div>
          <dl className="runSummaryGrid" aria-label="Trailrunning Kennzahlen">
            <div>
              <dt>Distanz</dt>
              <dd>{formatDistance(routeSummary.distanceMeters)}</dd>
            </div>
            <div>
              <dt>Aufstieg</dt>
              <dd>{ascentMeters !== null ? formatMeters(ascentMeters) : "-"}</dd>
            </div>
            <div>
              <dt>Zeit</dt>
              <dd>
                {displayedDurationMinutes !== null
                  ? formatDurationMinutes(displayedDurationMinutes)
                  : "-"}
              </dd>
            </div>
            <div>
              <dt>hm/km</dt>
              <dd>
                {climbMetersPerKilometer !== null
                  ? Math.round(climbMetersPerKilometer)
                  : "-"}
              </dd>
            </div>
          </dl>

          <div className="paceCalibration" aria-label="Zeit-Schätzung">
            <label className="paceModeToggle">
              <input
                type="checkbox"
                checked={calibratedTimeEnabled}
                onChange={(event) => setCalibratedTimeEnabled(event.currentTarget.checked)}
              />
              <span>Zeit</span>
              <strong>{calibratedTimeEnabled ? "Meine Pace" : "Wanderzeit"}</strong>
            </label>
            <label htmlFor="base-pace-input">Pace</label>
            <button
              type="button"
              aria-label="Basispace 10 Sekunden schneller"
              onClick={() => stepBasePace(-10)}
            >
              -10s
            </button>
            <input
              id="base-pace-input"
              type="text"
              inputMode="decimal"
              value={basePaceInput}
              onChange={(event) => updateBasePaceInput(event.currentTarget.value)}
              onBlur={() => setBasePaceInput(formatPaceInput(basePaceMinPerKm))}
            />
            <button
              type="button"
              aria-label="Basispace 10 Sekunden langsamer"
              onClick={() => stepBasePace(10)}
            >
              +10s
            </button>
            <span>min/km</span>
            <strong>{formatSpeedKmh(basePaceMinPerKm)}</strong>
          </div>

          <ElevationPanel
            profile={elevationState.profile}
            status={elevationState.status}
            message={elevationState.message}
            onHoverPointChange={setElevationHoverPoint}
          />

          <div className="loopCard" aria-label="Rundenstatus">
            <div>
              <span className={isClosedLoop ? "loopStateClosed" : "loopStateOpen"}>
                {isClosedLoop ? "Runde geschlossen" : "Runde offen"}
              </span>
              <strong>
                {loopGapMeters !== null ? formatDistance(loopGapMeters) : "Start setzen"}
              </strong>
            </div>
            <button
              type="button"
              disabled={
                !firstWaypoint ||
                history.present.waypoints.length < 2 ||
                isClosedLoop
              }
              onClick={closeLoop}
            >
              Schliessen
            </button>
          </div>
          <div className="toolbar" aria-label="Routenaktionen">
            <button
              type="button"
              disabled={history.past.length === 0}
              onClick={() => dispatch({ type: "undo" })}
            >
              Rückgängig
            </button>
            <button
              type="button"
              disabled={history.future.length === 0}
              onClick={() => dispatch({ type: "redo" })}
            >
              Wiederholen
            </button>
            <button
              type="button"
              disabled={history.present.waypoints.length < 2}
              onClick={() => dispatch({ type: "reverse" })}
            >
              Umkehren
            </button>
            <button
              type="button"
              disabled={!selectedWaypointId}
              onClick={deleteSelectedWaypoint}
            >
              Löschen
            </button>
            <button
              type="button"
              disabled={history.present.waypoints.length === 0}
              onClick={clearRoute}
            >
              Leeren
            </button>
          </div>

          <div className="routeStatus" aria-live="polite">
            {effectiveRouteComputeStatus === "loading"
              ? "Route wird berechnet"
              : effectiveRouteComputeStatus === "error"
                ? routeComputeState.message
                : effectiveComputedRoute
                  ? "Route berechnet"
                  : "Manuelle Route"}
          </div>

          {effectiveComputedRoute?.warnings.length ? (
            <ul className="routeWarnings" aria-label="Routenwarnungen">
              {effectiveComputedRoute.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          <section className="waypointPanel routeEditorPanel" aria-label="Wegpunkte">
            <div className="sectionHeader">
              <h2>Wegpunkte</h2>
              <span>
                {routeSummary.waypointCount} Punkte · {routeSummary.segmentCount} Abschnitte
              </span>
            </div>

            {firstWaypoint ? (
              <>
                <ol className="waypointDots" aria-label="Wegpunkte auswählen">
                  {history.present.waypoints.map((waypoint, index) => (
                    <li key={waypoint.id}>
                      <button
                        type="button"
                        className={
                          waypoint.id === selectedWaypointId
                            ? "selectedWaypoint"
                            : undefined
                        }
                        aria-label={`Wegpunkt ${index + 1}: ${formatCoordinate(
                          waypoint.position,
                        )}`}
                        onClick={() => setSelectedWaypointId(waypoint.id)}
                      >
                        {index + 1}
                      </button>
                    </li>
                  ))}
                </ol>

                {selectedWaypoint ? (
                  <div className="selectedPointCard compactSelectedPoint" aria-label="Ausgewählter Wegpunkt">
                    <div>
                      <span>Ausgewählt</span>
                      <strong>
                        Punkt {history.present.waypoints.indexOf(selectedWaypoint) + 1}
                      </strong>
                    </div>
                    <button type="button" onClick={deleteSelectedWaypoint}>
                      Löschen
                    </button>
                  </div>
                ) : null}

                <details className="waypointDetails">
                  <summary>Koordinaten anzeigen</summary>
                  <dl className="waypointEndpoints">
                    <div>
                      <dt>Start</dt>
                      <dd>{formatCoordinate(firstWaypoint.position)}</dd>
                    </div>
                    <div>
                      <dt>Via</dt>
                      <dd>{intermediateWaypointCount}</dd>
                    </div>
                    <div>
                      <dt>Ziel</dt>
                      <dd>
                        {lastWaypoint
                          ? formatCoordinate(lastWaypoint.position)
                          : "offen"}
                      </dd>
                    </div>
                  </dl>
                </details>
              </>
            ) : (
              <p className="emptyState">Klick auf die Karte setzt den Start.</p>
            )}
          </section>

          {history.present.segments.length ? (
            <details className="segmentPanel editorDetails">
              <summary>
                <span>Abschnitte</span>
                <small>{history.present.segments.length}</small>
              </summary>
              <div className="editorDetailsContent">
                {ENABLE_DEV_TOOLS ? (
                  <>
                    <label className="debugToggle">
                      <input
                        type="checkbox"
                        checked={graphhopperDebugVisible}
                        disabled={!graphhopperDebugSummary.routedSegmentCount}
                        onChange={(event) =>
                          setGraphhopperDebugVisible(event.target.checked)
                        }
                      />
                      GraphHopper anzeigen
                    </label>
                    {graphhopperDebugSummary.routedSegmentCount ? (
                      <dl className="debugSummary" aria-label="GraphHopper Debug">
                        <div>
                          <dt>Routed</dt>
                          <dd>{graphhopperDebugSummary.routedSegmentCount}</dd>
                        </div>
                        <div>
                          <dt>Stützpunkte</dt>
                          <dd>{graphhopperDebugSummary.geometryPointCount}</dd>
                        </div>
                        <div>
                          <dt>hike_rating</dt>
                          <dd>{graphhopperDebugSummary.hikeRatingCount}</dd>
                        </div>
                      </dl>
                    ) : null}
                  </>
                ) : null}
                <ol className="segmentList">
                  {history.present.segments.map((segment, index) => (
                    <li key={segment.id}>
                      <span>{index + 1}</span>
                      <button
                        type="button"
                        onClick={() => toggleSegmentMode(segment.id)}
                      >
                        {segment.mode === "straight" ? "Gerade" : "Routing"}
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            </details>
          ) : null}

          <div className="routeLegend" aria-label="Legende">
            <span
              className="legendLine legendLineStraight"
              aria-hidden="true"
            />
            <span>Gerade</span>
            <span className="legendLine legendLineRouted" aria-hidden="true" />
            <span>Routing</span>
          </div>

        </aside>

        <MapPanel
          waypoints={history.present.waypoints}
          segments={history.present.segments}
          computedSegments={effectiveComputedRoute?.segments ?? null}
          graphhopperDebugVisible={ENABLE_DEV_TOOLS && graphhopperDebugVisible}
          elevationHoverPoint={elevationHoverPoint}
          selectedWaypointId={selectedWaypointId}
          onAddWaypoint={addWaypoint}
          onInsertWaypoint={insertWaypoint}
          onMoveWaypoint={moveWaypoint}
          onSelectWaypoint={setSelectedWaypointId}
        />
      </section>
    </main>
  );
}

function summarizeGraphhopperDebug(route: ComputedRoute | null) {
  if (!route) {
    return {
      geometryPointCount: 0,
      hikeRatingCount: 0,
      routedSegmentCount: 0,
    };
  }

  const routedSegments = route.segments.filter(
    (segment) => segment.mode === "routed",
  );
  return {
    geometryPointCount: routedSegments.reduce(
      (total, segment) => total + segment.geometry.length,
      0,
    ),
    hikeRatingCount: routedSegments.reduce(
      (total, segment) =>
        total + countDetailEntries(segment.details.hike_rating),
      0,
    ),
    routedSegmentCount: routedSegments.length,
  };
}

function countDetailEntries(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function nextWaypointId(counterRef: MutableRefObject<number>): string {
  const nextNumber = counterRef.current + 1;
  counterRef.current = nextNumber;
  return `waypoint-${nextNumber}`;
}

function formatCoordinate(position: LonLat): string {
  return `${position.lat.toFixed(4)}, ${position.lon.toFixed(4)}`;
}

function formatMeters(value: number): string {
  return `${Math.round(value).toLocaleString("de-CH")} m`;
}

function estimateEffortMinutes(
  hikingDurationMinutes: number,
  basePaceMinPerKm: number,
): number {
  return hikingDurationMinutes * (basePaceMinPerKm / SWISS_HIKING_FLAT_PACE_MIN_PER_KM);
}

function loadBasePaceMinPerKm(): number {
  const storedValue = window.localStorage.getItem(BASE_PACE_STORAGE_KEY);
  if (!storedValue) {
    return DEFAULT_BASE_PACE_MIN_PER_KM;
  }

  const parsedValue = Number(storedValue);
  if (!Number.isFinite(parsedValue) || parsedValue < 2 || parsedValue > 20) {
    return DEFAULT_BASE_PACE_MIN_PER_KM;
  }
  return roundToNearestTenSeconds(parsedValue);
}

function roundToNearestTenSeconds(value: number): number {
  return Math.round(value * 6) / 6;
}

function loadCalibratedTimeEnabled(): boolean {
  return window.localStorage.getItem(CALIBRATED_TIME_STORAGE_KEY) === "true";
}

function clampPaceMinutes(value: number): number {
  return Math.min(20, Math.max(2, roundToNearestTenSeconds(value)));
}

function parsePaceInput(value: string): number | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  const timeMatch = /^(\d{1,2})(?::([0-5]?\d))?$/.exec(trimmedValue);
  if (timeMatch) {
    const minutes = Number(timeMatch[1]);
    const seconds = Number(timeMatch[2] ?? 0);
    const pace = minutes + seconds / 60;
    return pace >= 2 && pace <= 20 ? roundToNearestTenSeconds(pace) : null;
  }

  const decimalValue = Number(trimmedValue.replace(",", "."));
  if (!Number.isFinite(decimalValue) || decimalValue < 2 || decimalValue > 20) {
    return null;
  }
  return roundToNearestTenSeconds(decimalValue);
}

function formatPaceInput(minPerKm: number): string {
  const totalSeconds = Math.round(minPerKm * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatSpeedKmh(minPerKm: number): string {
  return `${(60 / minPerKm).toFixed(1)} km/h`;
}

function highestWaypointNumber(ids: string[]): number {
  return ids.reduce((highest, id) => {
    const match = /^waypoint-(\d+)$/.exec(id);
    if (!match) {
      return highest;
    }

    return Math.max(highest, Number(match[1]));
  }, 0);
}

function routeComputeReducer(
  state: RouteComputeState,
  action: RouteComputeAction,
): RouteComputeState {
  switch (action.type) {
    case "started":
      return {
        ...state,
        status: "loading",
        message: null,
      };
    case "succeeded":
      return {
        route: action.route,
        status: "ready",
        message: null,
      };
    case "failed":
      return {
        ...state,
        status: "error",
        message: action.message,
      };
  }
}

function elevationReducer(
  state: ElevationState,
  action: ElevationAction,
): ElevationState {
  switch (action.type) {
    case "cleared":
      return initialElevationState;
    case "started":
      return {
        ...state,
        status: "loading",
        message: null,
      };
    case "succeeded":
      return {
        profile: action.profile,
        status: "ready",
        message: null,
      };
    case "failed":
      return {
        ...state,
        status: "error",
        message: action.message,
      };
  }
}
