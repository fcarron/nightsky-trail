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
import { exportPointsToGpx, importRoutePlanFromGpx } from "../features/route/gpx";
import {
  createPlannerHistory,
  initialPlannerHistory,
  routePlannerReducer,
} from "../features/route/routePlanner";
import type {
  ComputedRoute,
  LonLat,
  SegmentMode,
} from "../features/route/routeModel";
import {
  loadStoredRoute,
  parseRoutePlan,
  saveStoredRoute,
} from "../features/route/routeStorage";
import {
  ApiRequestError,
  computeElevationProfile,
  computeRoute,
  createSavedTour,
  getAuthSession,
  getHealth,
  listSavedTours,
  loginAccount,
  logoutAccount,
  registerAccount,
  updateSavedTour,
} from "../services/api";
import type { AuthSessionResponse, SavedTourDto } from "../types/api";
import "./App.css";
import { ENABLE_DEV_TOOLS } from "./config";

type HealthState = "checking" | "ok" | "unavailable";
type RouteComputeStatus = "idle" | "loading" | "ready" | "error";
type ElevationStatus = "idle" | "loading" | "ready" | "error";
type AuthState = AuthSessionResponse & { status: "checking" | "ready" | "error" };

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
  const [authState, setAuthState] = useState<AuthState>({
    authenticated: false,
    status: "checking",
    user: null,
  });
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [savedTours, setSavedTours] = useState<SavedTourDto[]>([]);
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [tourMessage, setTourMessage] = useState<string | null>(null);
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
  const [drawingMode, setDrawingMode] = useState<SegmentMode>("routed");
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
  const gpxInputRef = useRef<HTMLInputElement | null>(null);
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
  const activeTour = savedTours.find((tour) => tour.id === activeTourId) ?? null;

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
    const controller = new AbortController();
    getAuthSession(controller.signal)
      .then((session) => setAuthState({ ...session, status: "ready" }))
      .catch(() =>
        setAuthState({ authenticated: false, status: "error", user: null }),
      );
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!authState.authenticated) {
      return;
    }

    const controller = new AbortController();
    listSavedTours(controller.signal)
      .then((response) => setSavedTours(response.tours))
      .catch((error: unknown) => setTourMessage(errorMessage(error)));
    return () => controller.abort();
  }, [authState.authenticated]);

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
    dispatch({
      type: "add-waypoint",
      segmentMode: drawingMode,
      waypoint: { id, position },
    });
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
    setActiveTourId(null);
    setSelectedWaypointId(null);
  }

  async function submitLogin(mode: "login" | "register") {
    setTourMessage(null);
    try {
      const session =
        mode === "login"
          ? await loginAccount(authUsername, authPassword)
          : await registerAccount(authUsername, authPassword);
      setAuthState({ ...session, status: "ready" });
      setAuthPassword("");
    } catch (error: unknown) {
      setTourMessage(errorMessage(error));
    }
  }

  async function submitLogout() {
    setTourMessage(null);
    try {
      const session = await logoutAccount();
      setAuthState({ ...session, status: "ready" });
      setSavedTours([]);
      setActiveTourId(null);
    } catch (error: unknown) {
      setTourMessage(errorMessage(error));
    }
  }

  async function saveTour() {
    if (!authState.authenticated || history.present.waypoints.length === 0) {
      return;
    }

    setTourMessage(null);
    try {
      const name = defaultTourName();
      const response = activeTourId
        ? await updateSavedTour(activeTourId, { routeData: history.present })
        : await createSavedTour(name, history.present);
      setActiveTourId(response.tour.id);
      const list = await listSavedTours();
      setSavedTours(list.tours);
      setTourMessage("Tour gespeichert.");
    } catch (error: unknown) {
      setTourMessage(errorMessage(error));
    }
  }

  function loadTour(tour: SavedTourDto) {
    try {
      const plan = parseRoutePlan(tour.routeData);
      dispatch({ type: "replace", plan });
      setSelectedWaypointId(null);
      setActiveTourId(tour.id);
      setTourMessage(`Tour geladen: ${tour.name}`);
    } catch {
      setTourMessage("Diese Tour kann nicht geladen werden.");
    }
  }

  function exportGpx() {
    const routePoints = currentRoutePoints(
      effectiveComputedRoute,
      history.present.waypoints.map((waypoint) => waypoint.position),
    );
    if (routePoints.length < 2) {
      setTourMessage("Für GPX Export braucht es mindestens zwei Punkte.");
      return;
    }

    const blob = new Blob([exportPointsToGpx(routePoints, defaultTourName())], {
      type: "application/gpx+xml",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${defaultTourName().replaceAll(/[^\dA-Za-z-]+/g, "-")}.gpx`;
    link.click();
    URL.revokeObjectURL(url);
    setTourMessage("GPX exportiert.");
  }

  async function importGpxFile(file: File) {
    setTourMessage(null);
    try {
      const plan = importRoutePlanFromGpx(await file.text());
      dispatch({ type: "replace", plan });
      setActiveTourId(null);
      setSelectedWaypointId(null);
      setTourMessage("GPX importiert. Abschnitte sind vorerst gerade.");
    } catch (error: unknown) {
      setTourMessage(errorMessage(error));
    }
  }

  function closeLoop() {
    if (!firstWaypoint || history.present.waypoints.length < 2 || isClosedLoop) {
      return;
    }

    const id = nextWaypointId(waypointCounterRef);
    dispatch({
      type: "add-waypoint",
      segmentMode: drawingMode,
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
        <aside className="sidebar routeDock">
          <div className="sidebarHeader">
            <h1>Tour zeichnen</h1>
            <p>
              {activeTour?.name ?? "Klick setzt Punkte. Linie ziehen verfeinert die Runde."}
            </p>
          </div>

          <details className="manageMenu">
            <summary>Tour</summary>
            <div className="managePanel">
              <section className="accountPanel" aria-label="Konto und Touren">
                {authState.authenticated ? (
                  <>
                    <div className="accountIdentity">
                      <span>Angemeldet</span>
                      <strong>{authState.user?.username}</strong>
                    </div>
                    <button type="button" onClick={saveTour}>
                      Speichern
                    </button>
                    <select
                      aria-label="Gespeicherte Tour laden"
                      value={activeTourId ?? ""}
                      onChange={(event) => {
                        const tour = savedTours.find(
                          (item) => item.id === event.currentTarget.value,
                        );
                        if (tour) {
                          loadTour(tour);
                        }
                      }}
                    >
                      <option value="">Tour laden</option>
                      {savedTours.map((tour) => (
                        <option key={tour.id} value={tour.id}>
                          {tour.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={submitLogout}>
                      Logout
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      aria-label="Benutzername"
                      placeholder="Benutzername"
                      value={authUsername}
                      onChange={(event) => setAuthUsername(event.currentTarget.value)}
                    />
                    <input
                      aria-label="Passwort"
                      placeholder="Passwort"
                      type="password"
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.currentTarget.value)}
                    />
                    <button type="button" onClick={() => submitLogin("login")}>
                      Login
                    </button>
                    <button type="button" onClick={() => submitLogin("register")}>
                      Registrieren
                    </button>
                  </>
                )}
              </section>
              <div className="fileActions" aria-label="Dateiaktionen">
                <button type="button" onClick={() => gpxInputRef.current?.click()}>
                  GPX Import
                </button>
                <button
                  type="button"
                  disabled={history.present.waypoints.length < 2}
                  onClick={exportGpx}
                >
                  GPX Export
                </button>
              </div>
            </div>
          </details>

          {tourMessage ? (
            <div className="tourMessage" aria-live="polite">
              {tourMessage}
            </div>
          ) : null}
          <input
            ref={gpxInputRef}
            className="hiddenFileInput"
            type="file"
            accept=".gpx,application/gpx+xml,application/xml,text/xml"
            aria-label="GPX importieren"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              event.currentTarget.value = "";
              if (file) {
                void importGpxFile(file);
              }
            }}
          />

          <section className="drawModePanel" aria-label="Zeichnen">
            <div>
              <strong>Zeichnen</strong>
              <span>
                {drawingMode === "routed"
                  ? "Magnet folgt Wegen"
                  : "Neue Abschnitte gerade"}
              </span>
            </div>
            <div className="drawModeButtons" role="group" aria-label="Zeichenmodus">
              <button
                type="button"
                aria-pressed={drawingMode === "routed"}
                onClick={() => setDrawingMode("routed")}
              >
                Magnet
              </button>
              <button
                type="button"
                aria-pressed={drawingMode === "straight"}
                onClick={() => setDrawingMode("straight")}
              >
                Gerade
              </button>
            </div>
          </section>

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

          <div className="quickToolbar" aria-label="Schnelle Routenaktionen">
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

          <details className="detailDrawer">
            <summary>
              <span>Details</span>
              <small>Profil · Wegpunkte · Abschnitte</small>
            </summary>

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

          </details>

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

function currentRoutePoints(
  computedRoute: ComputedRoute | null,
  waypointPositions: LonLat[],
): LonLat[] {
  if (computedRoute && computedRoute.geometry.length >= 2) {
    return computedRoute.geometry;
  }
  return waypointPositions;
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

function defaultTourName(): string {
  return `Tour ${new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date())}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Aktion fehlgeschlagen.";
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
