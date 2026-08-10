import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import { ElevationPanel } from "../features/elevation/ElevationPanel";
import {
  estimatePersonalRunningMinutes,
  formatDurationMinutes,
  toElevationProfile,
  toElevationProfileRequest,
} from "../features/elevation/elevationModel";
import type { ElevationProfile } from "../features/elevation/elevationModel";
import type { ElevationSurfaceSegment } from "../features/elevation/ElevationPanel";
import { MapPanel } from "../features/map/MapPanel";
import {
  distanceMetersBetween,
  formatDistance,
  summarizeRoute,
} from "../features/route/routeGeometry";
import {
  toComputedRoute,
  toImportedComputedRoute,
  toRouteComputeRequest,
} from "../features/route/routeApi";
import {
  exportPointsToGpx,
  importRoutePlanFromGpx,
} from "../features/route/gpx";
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
  searchLocations,
  updateSavedTour,
} from "../services/api";
import type {
  AuthSessionResponse,
  SavedTourDto,
  SearchResultDto,
} from "../types/api";
import "./App.css";
import { ENABLE_DEV_TOOLS } from "./config";

type HealthState = "checking" | "ok" | "unavailable";
type RouteComputeStatus = "idle" | "loading" | "ready" | "error";
type RouteStatusKind = "idle" | "loading" | "ready" | "error" | "imported";
type ElevationStatus = "idle" | "loading" | "ready" | "error";
type SearchStatus = "idle" | "loading" | "ready" | "error";
type SurfaceCategory = "paved" | "gravel" | "natural" | "unknown";
type MapInteractionMode = "explore" | "draw";
type AuthState = AuthSessionResponse & {
  status: "checking" | "ready" | "error";
};

interface SurfaceSummaryItem {
  category: SurfaceCategory;
  label: string;
  distanceMeters: number;
}

interface RouteSurfaceSegment {
  category: SurfaceCategory;
  startDistanceMeters: number;
  endDistanceMeters: number;
  label: string;
}

interface DetailRange {
  from: number;
  to: number;
  value: string | null;
}

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
const SEARCH_DEBOUNCE_MS = 250;
const BASE_PACE_STORAGE_KEY = "swiss-route-planner.base-pace-min-per-km.v1";
const CALIBRATED_TIME_STORAGE_KEY =
  "swiss-route-planner.calibrated-time-enabled.v1";
const SURFACE_CATEGORY_ORDER: SurfaceCategory[] = [
  "paved",
  "gravel",
  "natural",
  "unknown",
];
const SURFACE_CATEGORY_LABELS: Record<SurfaceCategory, string> = {
  gravel: "Kies/Forstweg",
  natural: "Trail/Natur",
  paved: "Strasse",
  unknown: "Unbekannt",
};
const SURFACE_CATEGORY_COLORS: Record<SurfaceCategory, string> = {
  gravel: "#c8923f",
  natural: "#3f9b68",
  paved: "#8fa1ad",
  unknown: "#d8dee5",
};
const PAVED_SURFACES = new Set([
  "asphalt",
  "chipseal",
  "concrete",
  "concrete:lanes",
  "concrete:plates",
  "cycleway",
  "living_street",
  "paved",
  "paving_stones",
  "primary",
  "residential",
  "road",
  "secondary",
  "service",
  "sett",
  "tertiary",
  "trunk",
  "unclassified",
]);
const GRAVEL_SURFACES = new Set([
  "compacted",
  "fine_gravel",
  "grade1",
  "grade2",
  "grade3",
  "gravel",
  "pebblestone",
  "track",
  "unpaved",
]);
const NATURAL_SURFACES = new Set([
  "dirt",
  "earth",
  "footway",
  "grade4",
  "grade5",
  "grass",
  "grass_paver",
  "ground",
  "mud",
  "path",
  "rock",
  "sand",
  "steps",
  "wood",
]);

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
  const [routeFitRequestId, setRouteFitRequestId] = useState(0);
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  const [tourMessage, setTourMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [searchResults, setSearchResults] = useState<SearchResultDto[]>([]);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [searchFocus, setSearchFocus] = useState<{
    lon: number;
    lat: number;
    zoom: number;
    requestId: number;
  } | null>(null);
  const [graphhopperDebugVisible, setGraphhopperDebugVisible] = useState(false);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(
    null,
  );
  const [elevationHoverPoint, setElevationHoverPoint] = useState<LonLat | null>(
    null,
  );
  const [basePaceMinPerKm, setBasePaceMinPerKm] =
    useState(loadBasePaceMinPerKm);
  const [basePaceInput, setBasePaceInput] = useState(() =>
    formatPaceInput(loadBasePaceMinPerKm()),
  );
  const [calibratedTimeEnabled, setCalibratedTimeEnabled] = useState(
    loadCalibratedTimeEnabled,
  );
  const [effortInfoOpen, setEffortInfoOpen] = useState(false);
  const [drawingMode, setDrawingMode] = useState<SegmentMode>("routed");
  const [mapInteractionMode, setMapInteractionMode] =
    useState<MapInteractionMode>("explore");
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
  const searchRequestIdRef = useRef(0);
  const searchControllerRef = useRef<AbortController | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const gpxInputRef = useRef<HTMLInputElement | null>(null);
  const manageMenuRef = useRef<HTMLDivElement | null>(null);
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
  const hasWaypoints = history.present.waypoints.length > 0;
  const hasRoute = history.present.waypoints.length >= 2;
  const selectedWaypoint =
    history.present.waypoints.find(
      (waypoint) => waypoint.id === selectedWaypointId,
    ) ?? null;
  const selectedWaypointIndex = selectedWaypoint
    ? history.present.waypoints.indexOf(selectedWaypoint)
    : -1;
  const previousSelectedSegment =
    selectedWaypointIndex > 0
      ? history.present.segments[selectedWaypointIndex - 1]
      : null;
  const nextSelectedSegment =
    selectedWaypointIndex >= 0
      ? history.present.segments[selectedWaypointIndex]
      : null;
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
  const descentMeters = elevationState.profile?.descentMeters ?? null;
  const climbMetersPerKilometer =
    ascentMeters !== null && routeSummary.distanceMeters > 0
      ? ascentMeters / (routeSummary.distanceMeters / 1000)
      : null;
  const effortKilometers =
    ascentMeters !== null && routeSummary.distanceMeters > 0
      ? routeSummary.distanceMeters / 1000 + ascentMeters / 100
      : null;
  const estimatedEffortMinutes = elevationState.profile
    ? estimatePersonalRunningMinutes(elevationState.profile, basePaceMinPerKm)
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
  const surfaceSummary = useMemo(
    () => summarizeSurface(effectiveComputedRoute),
    [effectiveComputedRoute],
  );
  const elevationSurfaceSegments = useMemo(
    () => surfaceSegmentsForElevation(effectiveComputedRoute),
    [effectiveComputedRoute],
  );
  const activeTour =
    savedTours.find((tour) => tour.id === activeTourId) ?? null;
  const importedGpxActive = Boolean(history.present.importedGeometry);
  const routeStatusKind = routeStatusClassName(
    effectiveRouteComputeStatus,
    importedGpxActive,
  );
  const routeStatusText = routeStatusLabel(
    effectiveRouteComputeStatus,
    importedGpxActive,
    routeComputeState.message,
    effectiveComputedRoute !== null,
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
    if (!manageMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && manageMenuRef.current?.contains(target)) {
        return;
      }
      setManageMenuOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setManageMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [manageMenuOpen]);

  useEffect(() => {
    window.localStorage.setItem(
      BASE_PACE_STORAGE_KEY,
      String(basePaceMinPerKm),
    );
  }, [basePaceMinPerKm]);

  useEffect(() => {
    window.localStorage.setItem(
      CALIBRATED_TIME_STORAGE_KEY,
      calibratedTimeEnabled ? "true" : "false",
    );
  }, [calibratedTimeEnabled]);

  useEffect(
    () => () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
      }
      searchControllerRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (history.present.waypoints.length < 2) {
      routeRequestIdRef.current += 1;
      return;
    }

    const importedRoute = toImportedComputedRoute(history.present);
    if (importedRoute) {
      routeRequestIdRef.current += 1;
      dispatchRouteCompute({ type: "succeeded", route: importedRoute });
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

  function deleteWaypoint(id: string) {
    dispatch({ type: "delete-waypoint", id });
    if (selectedWaypointId === id) {
      setSelectedWaypointId(null);
    }
  }

  function deleteSelectedWaypoint() {
    if (selectedWaypointId) {
      deleteWaypoint(selectedWaypointId);
    }
  }

  function deleteLastWaypoint() {
    const waypoint = history.present.waypoints.at(-1);
    if (!waypoint) {
      return;
    }

    deleteWaypoint(waypoint.id);
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
      setManageMenuOpen(false);
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
      setManageMenuOpen(false);
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
      setManageMenuOpen(false);
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
      setRouteFitRequestId((requestId) => requestId + 1);
      setTourMessage(`Tour geladen: ${tour.name}`);
      setManageMenuOpen(false);
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
    setManageMenuOpen(false);
  }

  async function importGpxFile(file: File) {
    setTourMessage(null);
    try {
      const plan = importRoutePlanFromGpx(await file.text());
      dispatch({ type: "replace", plan });
      setActiveTourId(null);
      setSelectedWaypointId(null);
      setRouteFitRequestId((requestId) => requestId + 1);
      setTourMessage("GPX importiert. Original-Track bleibt erhalten.");
      setManageMenuOpen(false);
    } catch (error: unknown) {
      setTourMessage(errorMessage(error));
    }
  }

  function closeLoop() {
    if (
      !firstWaypoint ||
      history.present.waypoints.length < 2 ||
      isClosedLoop
    ) {
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

  function setSegmentMode(segmentId: string, mode: SegmentMode) {
    dispatch({ type: "set-segment-mode", id: segmentId, mode });
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

  function scheduleSearch(value: string) {
    setSearchQuery(value);
    searchRequestIdRef.current += 1;
    searchControllerRef.current?.abort();
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }

    const query = value.trim();
    if (query.length < 2) {
      setSearchStatus("idle");
      setSearchResults([]);
      setSearchMessage(null);
      return;
    }

    setSearchStatus("idle");
    setSearchResults([]);
    setSearchMessage(null);
    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = null;
      void submitSearch(query);
    }, SEARCH_DEBOUNCE_MS);
  }

  async function submitSearch(queryInput = searchQuery) {
    const query = queryInput.trim();
    if (query.length < 2) {
      return;
    }

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    setSearchStatus("loading");
    setSearchMessage(null);

    try {
      const response = await searchLocations(query, controller.signal);
      if (searchRequestIdRef.current !== requestId) {
        return;
      }
      setSearchResults(response.results);
      setSearchStatus("ready");
      setSearchMessage(
        response.results.length ? null : "Keine Treffer gefunden.",
      );
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      if (searchRequestIdRef.current !== requestId) {
        return;
      }
      setSearchResults([]);
      setSearchStatus("error");
      setSearchMessage(errorMessage(error));
    } finally {
      if (searchControllerRef.current === controller) {
        searchControllerRef.current = null;
      }
    }
  }

  function selectSearchResult(result: SearchResultDto) {
    searchRequestIdRef.current += 1;
    searchControllerRef.current?.abort();
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    setSearchQuery(result.label);
    setSearchResults([]);
    setSearchStatus("idle");
    setSearchMessage(null);
    setSearchFocus((currentFocus) => ({
      lat: result.latitude,
      lon: result.longitude,
      requestId: (currentFocus?.requestId ?? 0) + 1,
      zoom: result.zoom,
    }));
  }

  const tourMenu = (
    <div className="manageMenu topManageMenu" ref={manageMenuRef}>
      <button
        type="button"
        aria-expanded={manageMenuOpen}
        onClick={() => setManageMenuOpen((open) => !open)}
      >
        Tour
      </button>
      {manageMenuOpen ? (
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
                  onChange={(event) =>
                    setAuthUsername(event.currentTarget.value)
                  }
                />
                <input
                  aria-label="Passwort"
                  placeholder="Passwort"
                  type="password"
                  value={authPassword}
                  onChange={(event) =>
                    setAuthPassword(event.currentTarget.value)
                  }
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
            <button
              type="button"
              onClick={() => {
                setManageMenuOpen(false);
                gpxInputRef.current?.click();
              }}
            >
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
      ) : null}
    </div>
  );

  return (
    <main className="appShell">
      <header className="topBar">
        <div className="brand">
          <span className="brandMark" aria-hidden="true">
            N
          </span>
          <div>
            <strong>nightsky trail</strong>
            <span>Routenplaner Schweiz</span>
          </div>
        </div>
        <form
          className="topSearch"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            if (searchTimerRef.current !== null) {
              window.clearTimeout(searchTimerRef.current);
              searchTimerRef.current = null;
            }
            void submitSearch();
          }}
        >
          <div className="topSearchField">
            <input
              aria-label="Ort, Adresse oder Route suchen"
              aria-controls="search-results"
              aria-expanded={searchResults.length > 0}
              placeholder="Ort, Adresse, Gipfel suchen"
              value={searchQuery}
              onChange={(event) => scheduleSearch(event.currentTarget.value)}
            />
            <button type="submit" disabled={searchStatus === "loading"}>
              {searchStatus === "loading" ? "Sucht" : "Suchen"}
            </button>
          </div>
          {searchResults.length || searchMessage ? (
            <div className="searchResults" id="search-results">
              {searchMessage ? <p>{searchMessage}</p> : null}
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => selectSearchResult(result)}
                >
                  <strong>{result.label}</strong>
                  <span>{formatSearchOrigin(result.origin)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </form>
        <div className="topBarActions">
          {health === "unavailable" ? (
            <span className="status" aria-live="polite">
              {healthLabel}
            </span>
          ) : null}
          {tourMenu}
        </div>
      </header>

      <section className="plannerLayout" aria-label="Routenplaner">
        <aside className="sidebar routeDock">
          <div className="dockTop">
            <div className="sidebarHeader">
              <h1>
                {selectedWaypoint
                  ? `Punkt ${selectedWaypointIndex + 1}`
                  : hasWaypoints
                    ? "Tour bearbeiten"
                    : "Tour zeichnen"}
              </h1>
              <p>
                {selectedWaypoint
                  ? "Punkt-Aktionen ohne Dialog"
                  : (activeTour?.name ??
                    (mapInteractionMode === "draw"
                      ? "Klick setzt Punkte. Linie ziehen verfeinert die Runde."
                      : "Klick auf Kartenobjekte zeigt Details."))}
              </p>
            </div>
          </div>

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
              <strong>
                {mapInteractionMode === "draw" ? "Zeichnen" : "Karte erkunden"}
              </strong>
              <span>
                {mapInteractionMode === "draw"
                  ? "Klick setzt Punkte. Linie ziehen verfeinert die Runde."
                  : "Klick auf Kartenobjekte zeigt Details."}
              </span>
            </div>
            <div
              className="mapInteractionButtons"
              role="group"
              aria-label="Kartenwerkzeug"
            >
              <button
                type="button"
                aria-pressed={mapInteractionMode === "explore"}
                onClick={() => setMapInteractionMode("explore")}
              >
                Erkunden
              </button>
              <button
                type="button"
                aria-pressed={mapInteractionMode === "draw"}
                onClick={() => setMapInteractionMode("draw")}
              >
                Route zeichnen
              </button>
            </div>
            {mapInteractionMode === "draw" ? (
              <>
                <div
                  className="routeProfileButtons"
                  role="group"
                  aria-label="Routing-Profil"
                >
                  <button
                    type="button"
                    aria-pressed={history.present.routingProfile === "foot"}
                    onClick={() =>
                      dispatch({ type: "set-routing-profile", profile: "foot" })
                    }
                  >
                    Strasse
                  </button>
                  <button
                    type="button"
                    aria-pressed={history.present.routingProfile === "hike"}
                    onClick={() =>
                      dispatch({ type: "set-routing-profile", profile: "hike" })
                    }
                  >
                    Trail
                  </button>
                  <button
                    type="button"
                    aria-pressed={history.present.routingProfile === "bike"}
                    onClick={() =>
                      dispatch({ type: "set-routing-profile", profile: "bike" })
                    }
                  >
                    Velo
                  </button>
                </div>
                <div
                  className="drawModeButtons"
                  role="group"
                  aria-label="Zeichenmodus"
                >
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
              </>
            ) : null}
          </section>

          <dl className="runSummaryGrid" aria-label="Trailrunning Kennzahlen">
            <div>
              <dt>Distanz</dt>
              <dd>{formatDistance(routeSummary.distanceMeters)}</dd>
            </div>
            <div className="runSummaryTimeCard">
              <dt>Zeit</dt>
              <dd>
                <span>
                  {displayedDurationMinutes !== null
                    ? formatDurationMinutes(displayedDurationMinutes)
                    : "-"}
                </span>
                <details className="summaryPaceSettings">
                  <summary aria-label="Zeit-Schätzung einstellen">Pace</summary>
                  <div className="paceCalibration" aria-label="Zeit-Schätzung">
                    <div
                      className="paceModeToggle"
                      role="group"
                      aria-label="Zeitberechnung"
                    >
                      <button
                        type="button"
                        aria-pressed={!calibratedTimeEnabled}
                        onClick={() => setCalibratedTimeEnabled(false)}
                      >
                        Wandern
                      </button>
                      <button
                        type="button"
                        aria-pressed={calibratedTimeEnabled}
                        onClick={() => setCalibratedTimeEnabled(true)}
                      >
                        Meine Pace
                      </button>
                    </div>
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
                      onChange={(event) =>
                        updateBasePaceInput(event.currentTarget.value)
                      }
                      onBlur={() =>
                        setBasePaceInput(formatPaceInput(basePaceMinPerKm))
                      }
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
                    <details className="paceInfo">
                      <summary aria-label="Zeitberechnung erklären">i</summary>
                      <p>
                        Wanderzeit nutzt Distanz und Höhenprofil. Meine Pace
                        behält deine flache Grundpace bei und passt die Zeit pro
                        Höhenprofil-Abschnitt an.
                      </p>
                    </details>
                  </div>
                </details>
              </dd>
            </div>
            <div>
              <dt>Aufstieg</dt>
              <dd>
                {ascentMeters !== null ? formatMeters(ascentMeters) : "-"}
                {descentMeters !== null ? (
                  <small>{formatMeters(descentMeters)} Abstieg</small>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="metricLabel">
                Effort km
                <button
                  type="button"
                  className="metricInfo"
                  aria-expanded={effortInfoOpen}
                  aria-label="Effort km erklären"
                  onClick={() => setEffortInfoOpen((open) => !open)}
                >
                  i
                </button>
                {effortInfoOpen ? (
                  <span className="metricInfoPopover" role="tooltip">
                    Distanz in km plus Aufstieg in m geteilt durch 100. Ein
                    Vergleichswert für die körperliche Belastung.
                  </span>
                ) : null}
              </dt>
              <dd>
                {effortKilometers !== null
                  ? `${formatKilometers(effortKilometers)} km`
                  : "-"}
                {climbMetersPerKilometer !== null ? (
                  <small>{Math.round(climbMetersPerKilometer)} hm/km</small>
                ) : null}
              </dd>
            </div>
          </dl>

          <div
            className={`routeStatus routeStatus-${routeStatusKind}`}
            aria-live="polite"
          >
            {routeStatusText}
          </div>

          <div className="quickToolbar" aria-label="Schnelle Routenaktionen">
            <button
              type="button"
              className="quietAction"
              disabled={history.past.length === 0}
              onClick={() => dispatch({ type: "undo" })}
            >
              Rückgängig
            </button>
            <button
              type="button"
              disabled={!hasRoute}
              onClick={() => dispatch({ type: "reverse" })}
            >
              Umkehren
            </button>
            <button
              type="button"
              className={selectedWaypointId ? "primaryAction" : undefined}
              disabled={!selectedWaypointId}
              onClick={deleteSelectedWaypoint}
            >
              Punkt löschen
            </button>
            <button
              type="button"
              disabled={!hasWaypoints}
              onClick={deleteLastWaypoint}
            >
              Letzten löschen
            </button>
            <details className="routeActionMenu">
              <summary>Weitere Aktionen</summary>
              <button
                type="button"
                disabled={history.future.length === 0}
                onClick={() => dispatch({ type: "redo" })}
              >
                Wiederholen
              </button>
              <button
                type="button"
                className="dangerAction"
                disabled={!hasWaypoints}
                onClick={clearRoute}
              >
                Route löschen
              </button>
            </details>
          </div>

          {selectedWaypoint ? (
            <section
              className="contextPanel"
              aria-label="Ausgewählter Wegpunkt"
            >
              <div>
                <span>Ausgewählt</span>
                <strong>Punkt {selectedWaypointIndex + 1}</strong>
                <small>{formatCoordinate(selectedWaypoint.position)}</small>
              </div>
              <div className="contextActions">
                {previousSelectedSegment ? (
                  <button
                    type="button"
                    onClick={() =>
                      toggleSegmentMode(previousSelectedSegment.id)
                    }
                  >
                    Vorher: {segmentModeLabel(previousSelectedSegment.mode)}
                  </button>
                ) : null}
                {nextSelectedSegment ? (
                  <button
                    type="button"
                    onClick={() => toggleSegmentMode(nextSelectedSegment.id)}
                  >
                    Nachher: {segmentModeLabel(nextSelectedSegment.mode)}
                  </button>
                ) : null}
                {previousSelectedSegment ? (
                  <button
                    type="button"
                    onClick={() =>
                      setSegmentMode(previousSelectedSegment.id, "routed")
                    }
                  >
                    Vorher neu routen
                  </button>
                ) : null}
                {nextSelectedSegment ? (
                  <button
                    type="button"
                    onClick={() =>
                      setSegmentMode(nextSelectedSegment.id, "routed")
                    }
                  >
                    Nachher neu routen
                  </button>
                ) : null}
              </div>
            </section>
          ) : !hasWaypoints ? (
            <section
              className="contextPanel emptyRoutePanel"
              aria-label="Route starten"
            >
              <div>
                <span>Bereit</span>
                <strong>Startpunkt auf der Karte setzen</strong>
                <small>Magnet folgt Wegen. GPX Import ist im Tour-Menü.</small>
              </div>
            </section>
          ) : null}

          <details className="detailDrawer">
            <summary>
              <span>Details</span>
              <small>
                {elevationState.status === "ready"
                  ? "Profil bereit"
                  : "Profil · Wegpunkte · Abschnitte"}
              </small>
            </summary>

            <ElevationPanel
              profile={elevationState.profile}
              surfaceSegments={elevationSurfaceSegments}
              status={elevationState.status}
              message={elevationState.message}
              onHoverPointChange={setElevationHoverPoint}
            />

            <details className="compactDetails">
              <summary>
                <span>Runde</span>
                <small>
                  {isClosedLoop ? "geschlossen" : "offen"} ·{" "}
                  {loopGapMeters !== null
                    ? formatDistance(loopGapMeters)
                    : "Start setzen"}
                </small>
              </summary>
              <div className="loopCard" aria-label="Rundenstatus">
                <div>
                  <span
                    className={
                      isClosedLoop ? "loopStateClosed" : "loopStateOpen"
                    }
                  >
                    {isClosedLoop ? "Runde geschlossen" : "Runde offen"}
                  </span>
                  <strong>
                    {loopGapMeters !== null
                      ? formatDistance(loopGapMeters)
                      : "Start setzen"}
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
            </details>
            {effectiveComputedRoute?.warnings.length ? (
              <ul className="routeWarnings" aria-label="Routenwarnungen">
                {effectiveComputedRoute.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}

            {surfaceSummary.length ? (
              <details
                className="surfacePanel compactDetails"
                aria-label="Wegbeschaffenheit"
              >
                <summary>
                  <span>Weg</span>
                  <small>{formatSurfaceSummary(surfaceSummary)}</small>
                </summary>
                <div className="surfaceBar" aria-hidden="true">
                  {surfaceSummary.map((item) => (
                    <span
                      key={item.category}
                      className={`surfaceBarPart surfaceBarPart-${item.category}`}
                      style={{
                        flexGrow: Math.max(1, Math.round(item.distanceMeters)),
                      }}
                    />
                  ))}
                </div>
                <dl className="surfaceList">
                  {surfaceSummary.map((item) => (
                    <div key={item.category}>
                      <dt>
                        <span
                          className={`surfaceDot surfaceDot-${item.category}`}
                          aria-hidden="true"
                        />
                        {item.label}
                      </dt>
                      <dd>{formatDistance(item.distanceMeters)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}

            <details
              className="waypointPanel routeEditorPanel compactDetails"
              aria-label="Wegpunkte"
            >
              <summary>
                <span>Wegpunkte</span>
                <small>
                  {routeSummary.waypointCount} Punkte ·{" "}
                  {routeSummary.segmentCount} Abschnitte
                </small>
              </summary>

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
                <p className="emptyState">
                  Klick auf die Karte setzt den Start.
                </p>
              )}
            </details>

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
                        <dl
                          className="debugSummary"
                          aria-label="GraphHopper Debug"
                        >
                          <div>
                            <dt>Routed</dt>
                            <dd>
                              {graphhopperDebugSummary.routedSegmentCount}
                            </dd>
                          </div>
                          <div>
                            <dt>Stützpunkte</dt>
                            <dd>
                              {graphhopperDebugSummary.geometryPointCount}
                            </dd>
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
              <span
                className="legendLine legendLineRouted"
                aria-hidden="true"
              />
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
          fitGeometry={history.present.importedGeometry}
          fitRequestId={routeFitRequestId}
          searchFocus={searchFocus}
          selectedWaypointId={selectedWaypointId}
          interactionMode={mapInteractionMode}
          onInteractionModeChange={setMapInteractionMode}
          onAddWaypoint={addWaypoint}
          onInsertWaypoint={insertWaypoint}
          onMoveWaypoint={moveWaypoint}
          onSelectWaypoint={setSelectedWaypointId}
          onDeleteWaypoint={deleteWaypoint}
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

function formatSurfaceSummary(items: SurfaceSummaryItem[]): string {
  const totalMeters = items.reduce(
    (total, item) => total + item.distanceMeters,
    0,
  );
  if (totalMeters <= 0) {
    return "Keine Angaben";
  }

  return items
    .filter((item) => item.category !== "unknown")
    .slice(0, 3)
    .map((item) => {
      const percent = Math.round((item.distanceMeters / totalMeters) * 100);
      return `${percent}% ${item.label}`;
    })
    .join(" · ");
}

function summarizeSurface(route: ComputedRoute | null): SurfaceSummaryItem[] {
  if (!route) {
    return [];
  }

  const distances = new Map<SurfaceCategory, number>();
  for (const segment of route.segments) {
    if (segment.mode !== "routed") {
      addSurfaceDistance(distances, "unknown", segment.distanceMeters);
      continue;
    }

    const details =
      firstDetailRanges(segment.details.surface, segment.details.track_type) ??
      readDetailRanges(segment.details.road_class);
    if (!details.length) {
      addSurfaceDistance(distances, "unknown", segment.distanceMeters);
      continue;
    }

    for (const detail of details) {
      addSurfaceDistance(
        distances,
        surfaceCategoryFor(detail.value),
        detailDistanceMeters(segment.geometry, detail.from, detail.to),
      );
    }
  }

  const hasKnownSurface = SURFACE_CATEGORY_ORDER.some(
    (category) => category !== "unknown" && (distances.get(category) ?? 0) > 1,
  );
  if (!hasKnownSurface) {
    return [];
  }

  return SURFACE_CATEGORY_ORDER.map((category) => ({
    category,
    distanceMeters: distances.get(category) ?? 0,
    label: SURFACE_CATEGORY_LABELS[category],
  })).filter((item) => item.distanceMeters > 1);
}

function surfaceSegmentsForElevation(
  route: ComputedRoute | null,
): ElevationSurfaceSegment[] {
  if (!route) {
    return [];
  }

  let routeOffsetMeters = 0;
  const segments: RouteSurfaceSegment[] = [];

  for (const segment of route.segments) {
    if (segment.mode !== "routed") {
      segments.push(
        createSurfaceSegment(
          "unknown",
          routeOffsetMeters,
          segment.distanceMeters,
        ),
      );
      routeOffsetMeters += segment.distanceMeters;
      continue;
    }

    const details =
      firstDetailRanges(segment.details.surface, segment.details.track_type) ??
      readDetailRanges(segment.details.road_class);
    if (!details.length) {
      segments.push(
        createSurfaceSegment(
          "unknown",
          routeOffsetMeters,
          segment.distanceMeters,
        ),
      );
      routeOffsetMeters += segment.distanceMeters;
      continue;
    }

    for (const detail of details) {
      const category = surfaceCategoryFor(detail.value);
      const startDistanceMeters =
        routeOffsetMeters +
        detailDistanceFromStart(segment.geometry, detail.from);
      const endDistanceMeters =
        routeOffsetMeters +
        detailDistanceFromStart(segment.geometry, detail.to);
      if (endDistanceMeters <= startDistanceMeters) {
        continue;
      }
      segments.push({
        category,
        endDistanceMeters,
        label: SURFACE_CATEGORY_LABELS[category],
        startDistanceMeters,
      });
    }
    routeOffsetMeters += segment.distanceMeters;
  }

  const hasKnownSurface = segments.some(
    (segment) =>
      segment.category !== "unknown" &&
      segment.endDistanceMeters > segment.startDistanceMeters,
  );
  if (!hasKnownSurface) {
    return [];
  }

  return mergeRouteSurfaceSegments(segments).map((segment) => ({
    color: SURFACE_CATEGORY_COLORS[segment.category],
    endDistanceMeters: segment.endDistanceMeters,
    label: segment.label,
    startDistanceMeters: segment.startDistanceMeters,
  }));
}

function createSurfaceSegment(
  category: SurfaceCategory,
  offsetMeters: number,
  distanceMeters: number,
): RouteSurfaceSegment {
  return {
    category,
    endDistanceMeters: offsetMeters + distanceMeters,
    label: SURFACE_CATEGORY_LABELS[category],
    startDistanceMeters: offsetMeters,
  };
}

function mergeRouteSurfaceSegments(
  segments: RouteSurfaceSegment[],
): RouteSurfaceSegment[] {
  const merged: RouteSurfaceSegment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.category === segment.category &&
      Math.abs(previous.endDistanceMeters - segment.startDistanceMeters) < 1
    ) {
      previous.endDistanceMeters = segment.endDistanceMeters;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

function readDetailRanges(value: unknown): DetailRange[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      Array.isArray(entry) &&
      entry.length >= 3 &&
      Number.isInteger(entry[0]) &&
      Number.isInteger(entry[1])
    ) {
      return [
        {
          from: Math.max(0, Number(entry[0])),
          to: Math.max(0, Number(entry[1])),
          value: typeof entry[2] === "string" ? entry[2] : null,
        },
      ];
    }
    return [];
  });
}

function firstDetailRanges(...values: unknown[]): DetailRange[] | null {
  for (const value of values) {
    const ranges = readDetailRanges(value);
    if (ranges.length) {
      return ranges;
    }
  }
  return null;
}

function detailDistanceFromStart(geometry: LonLat[], index: number): number {
  if (geometry.length < 2) {
    return 0;
  }

  const to = Math.min(Math.max(index, 0), geometry.length - 1);
  let distance = 0;
  for (let pointIndex = 0; pointIndex < to; pointIndex += 1) {
    distance += distanceMetersBetween(
      geometry[pointIndex],
      geometry[pointIndex + 1],
    );
  }
  return distance;
}

function detailDistanceMeters(
  geometry: LonLat[],
  fromIndex: number,
  toIndex: number,
): number {
  if (geometry.length < 2) {
    return 0;
  }

  const from = Math.min(fromIndex, geometry.length - 1);
  const to = Math.min(Math.max(toIndex, from + 1), geometry.length - 1);
  let distance = 0;
  for (let index = from; index < to; index += 1) {
    distance += distanceMetersBetween(geometry[index], geometry[index + 1]);
  }
  return distance;
}

function addSurfaceDistance(
  distances: Map<SurfaceCategory, number>,
  category: SurfaceCategory,
  distanceMeters: number,
) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return;
  }
  distances.set(category, (distances.get(category) ?? 0) + distanceMeters);
}

function surfaceCategoryFor(value: string | null): SurfaceCategory {
  if (!value) {
    return "unknown";
  }

  const normalizedValue = value.toLowerCase();
  if (PAVED_SURFACES.has(normalizedValue)) {
    return "paved";
  }
  if (GRAVEL_SURFACES.has(normalizedValue)) {
    return "gravel";
  }
  if (NATURAL_SURFACES.has(normalizedValue)) {
    return "natural";
  }
  return "unknown";
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

function formatKilometers(value: number): string {
  return value.toLocaleString("de-CH", {
    maximumFractionDigits: 1,
    minimumFractionDigits: value < 10 ? 1 : 0,
  });
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

function formatSearchOrigin(origin: string): string {
  const labels: Record<string, string> = {
    address: "Adresse",
    district: "Ortsteil",
    gazetteer: "Ort",
    parcel: "Parzelle",
    sn25: "Karte",
  };
  return labels[origin] ?? origin;
}

function routeStatusClassName(
  status: RouteComputeStatus,
  imported: boolean,
): RouteStatusKind {
  if (imported) {
    return "imported";
  }
  if (status === "loading") {
    return "loading";
  }
  if (status === "error") {
    return "error";
  }
  if (status === "ready") {
    return "ready";
  }
  return "idle";
}

function routeStatusLabel(
  status: RouteComputeStatus,
  imported: boolean,
  message: string | null,
  hasComputedRoute: boolean,
): string {
  if (imported) {
    return "GPX importiert";
  }
  if (status === "loading") {
    return "Route wird berechnet";
  }
  if (status === "error") {
    return message ?? "Route konnte nicht berechnet werden.";
  }
  if (hasComputedRoute) {
    return "Route berechnet";
  }
  return "Startpunkt setzen";
}

function segmentModeLabel(mode: SegmentMode): string {
  return mode === "routed" ? "Routing" : "Gerade";
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
