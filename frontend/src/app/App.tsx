import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import { ElevationPanel } from "../features/elevation/ElevationPanel";
import {
  toElevationProfile,
  toElevationProfileRequest,
} from "../features/elevation/elevationModel";
import type { ElevationProfile } from "../features/elevation/elevationModel";
import { MapPanel } from "../features/map/MapPanel";
import {
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

export function App() {
  const [health, setHealth] = useState<HealthState>("checking");
  const [graphhopperDebugVisible, setGraphhopperDebugVisible] = useState(false);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(
    null,
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
  const intermediateWaypointCount = Math.max(
    0,
    history.present.waypoints.length - 2,
  );
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
            <h1>Route planen</h1>
            <p>Routing ist Standard. Linie anklicken, Punkt einfügen.</p>
          </div>
          <dl className="summaryGrid" aria-label="Routenzusammenfassung">
            <div>
              <dt>Wegpunkte</dt>
              <dd>{routeSummary.waypointCount}</dd>
            </div>
            <div>
              <dt>Distanz</dt>
              <dd>{formatDistance(routeSummary.distanceMeters)}</dd>
            </div>
            <div>
              <dt>Segmente</dt>
              <dd>{routeSummary.segmentCount}</dd>
            </div>
          </dl>
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

          <section className="waypointPanel" aria-label="Wegpunkte">
            <div className="sectionHeader">
              <h2>Wegpunkte</h2>
              <span>{routeSummary.waypointCount}</span>
            </div>

            {firstWaypoint ? (
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
            ) : (
              <p className="emptyState">Klick auf die Karte setzt den Start.</p>
            )}

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
          </section>

          {history.present.segments.length ? (
            <section className="segmentPanel" aria-label="Segmente">
              <div className="sectionHeader">
                <h2>Abschnitte</h2>
                <span>{history.present.segments.length}</span>
              </div>
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
            </section>
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

          <ElevationPanel
            profile={elevationState.profile}
            status={elevationState.status}
            message={elevationState.message}
          />
        </aside>

        <MapPanel
          waypoints={history.present.waypoints}
          segments={history.present.segments}
          computedSegments={effectiveComputedRoute?.segments ?? null}
          graphhopperDebugVisible={graphhopperDebugVisible}
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
