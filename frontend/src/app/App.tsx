import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FormEvent, MutableRefObject } from "react";

import { ElevationPanel } from "../features/elevation/ElevationPanel";
import {
  estimatePersonalRunningMinutes,
  calculateKilometreSplits,
  detectClimbs,
  formatDurationMinutes,
  toElevationProfile,
  toElevationProfileRequest,
} from "../features/elevation/elevationModel";
import type { AnalysisTab } from "../features/elevation/RouteAnalysis";
import type { ElevationProfile } from "../features/elevation/elevationModel";
import type {
  ElevationPanelSize,
  ElevationSurfaceSegment,
} from "../features/elevation/ElevationPanel";
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
import { SharedTourPage } from "../features/route/SharedTourPage";
import {
  createPlannerHistory,
  initialPlannerHistory,
  routePlansEqual,
  routePlannerReducer,
} from "../features/route/routePlanner";
import type {
  ComputedRoute,
  LonLat,
  RoutePlan,
  SegmentMode,
} from "../features/route/routeModel";
import {
  loadStoredRoute,
  parseRoutePlan,
  saveStoredRoute,
} from "../features/route/routeStorage";
import {
  ApiRequestError,
  confirmPasswordReset,
  computeElevationProfile,
  computeRoute,
  deleteAccount,
  deleteSavedTour,
  createSavedTour,
  getAuthSession,
  getHealth,
  listSavedTours,
  loginAccount,
  logoutAccount,
  registerAccount,
  requestPasswordReset,
  resendVerificationEmail as requestVerificationEmailResend,
  searchLocations,
  updateSavedTour,
  verifyAccountEmail,
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
type MobileSheetState = "collapsed" | "half" | "full";
type AuthMode = "forgot" | "login" | "register" | "reset";
type TopMenu = "account" | "files" | "tours" | "about";
type AuthLink = {
  action: "reset-password" | "verify-email";
  uid: string;
  token: string;
};
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
  const sharedTourId = sharedTourIdFromPath(window.location.pathname);
  if (sharedTourId) {
    return <SharedTourPage shareId={sharedTourId} />;
  }

  return <PlannerApp />;
}

function PlannerApp() {
  const authLinkRef = useRef<AuthLink | null>(readAuthLink());
  const [health, setHealth] = useState<HealthState>("checking");
  const [authState, setAuthState] = useState<AuthState>({
    authenticated: false,
    status: "checking",
    user: null,
  });
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPasswordConfirmation, setAuthPasswordConfirmation] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>(
    authLinkRef.current?.action === "reset-password" ? "reset" : "login",
  );
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [passwordResetToken, setPasswordResetToken] = useState<{
    uid: string;
    token: string;
  } | null>(
    authLinkRef.current?.action === "reset-password"
      ? { token: authLinkRef.current.token, uid: authLinkRef.current.uid }
      : null,
  );
  const [authFeedback, setAuthFeedback] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<
    string | null
  >(null);
  const [accountDeletePassword, setAccountDeletePassword] = useState("");
  const [accountDeleting, setAccountDeleting] = useState(false);
  const [savedTours, setSavedTours] = useState<SavedTourDto[]>([]);
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [savedRoutePlan, setSavedRoutePlan] = useState<RoutePlan | null>(null);
  const [tourName, setTourName] = useState(defaultTourName);
  const [tourActionPending, setTourActionPending] = useState(false);
  const [editingTourId, setEditingTourId] = useState<string | null>(null);
  const [editingTourName, setEditingTourName] = useState("");
  const [routeFitRequestId, setRouteFitRequestId] = useState(0);
  const [openTopMenu, setOpenTopMenu] = useState<TopMenu | null>(
    authLinkRef.current ? "account" : null,
  );
  const [mobileHeaderOpen, setMobileHeaderOpen] = useState(
    authLinkRef.current !== null,
  );
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileSheetState, setMobileSheetState] =
    useState<MobileSheetState>("collapsed");
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
  const [elevationPanelSize, setElevationPanelSize] =
    useState<ElevationPanelSize>("compact");
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("profile");
  const [analysisHighlightRange, setAnalysisHighlightRange] = useState<{
    startDistanceMeters: number;
    endDistanceMeters: number;
  } | null>(null);
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
  const topMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileSheetPointerRef = useRef<{
    pointerId: number;
    startY: number;
  } | null>(null);
  const mobileSheetSwipedRef = useRef(false);
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
  const kilometreSplits = useMemo(
    () =>
      elevationState.profile
        ? calculateKilometreSplits(
            elevationState.profile,
            calibratedTimeEnabled ? basePaceMinPerKm : undefined,
          )
        : [],
    [basePaceMinPerKm, calibratedTimeEnabled, elevationState.profile],
  );
  const climbs = useMemo(
    () =>
      elevationState.profile
        ? detectClimbs(
            elevationState.profile,
            calibratedTimeEnabled ? basePaceMinPerKm : undefined,
          )
        : [],
    [basePaceMinPerKm, calibratedTimeEnabled, elevationState.profile],
  );
  const analysisRangeGeometry = useMemo(() => {
    if (!analysisHighlightRange || !elevationState.profile) {
      return [];
    }
    return elevationState.profile.points
      .filter(
        (point) =>
          point.distanceMeters >= analysisHighlightRange.startDistanceMeters &&
          point.distanceMeters <= analysisHighlightRange.endDistanceMeters,
      )
      .map((point) => ({ lon: point.longitude, lat: point.latitude }));
  }, [analysisHighlightRange, elevationState.profile]);
  const activeTour =
    savedTours.find((tour) => tour.id === activeTourId) ?? null;
  const hasUnsavedRouteChanges =
    history.present.waypoints.length > 0 &&
    (!savedRoutePlan || !routePlansEqual(history.present, savedRoutePlan));
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
    const authLink = authLinkRef.current;
    if (authLink?.action === "verify-email") {
      authLinkRef.current = null;
    }

    const sessionRequest =
      authLink?.action === "verify-email"
        ? verifyAccountEmail(authLink.uid, authLink.token)
        : getAuthSession(controller.signal);

    sessionRequest
      .then((session) => {
        setAuthState({ ...session, status: "ready" });
        if (authLink?.action === "verify-email") {
          setOpenTopMenu("account");
          setMobileHeaderOpen(true);
          setAuthFeedback({
            tone: "success",
            message: "E-Mail bestätigt. Du bist jetzt angemeldet.",
          });
        }
      })
      .catch((error: unknown) => {
        setAuthState({ authenticated: false, status: "error", user: null });
        if (authLink?.action === "verify-email") {
          setOpenTopMenu("account");
          setMobileHeaderOpen(true);
          setAuthFeedback({ tone: "error", message: errorMessage(error) });
        }
      })
      .finally(() => {
        if (authLink?.action === "verify-email") {
          removeAuthParametersFromUrl();
        }
      });
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
    if (!openTopMenu) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && topMenuRef.current?.contains(target)) {
        return;
      }
      setOpenTopMenu(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenTopMenu(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [openTopMenu]);

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

  function setElevationPanelDisplay(size: ElevationPanelSize) {
    setElevationPanelSize(size);
    setElevationHoverPoint(null);
    setMobileSheetState(size === "large" ? "half" : "collapsed");
  }

  function closeMobileProfile() {
    setElevationPanelDisplay("compact");
  }

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

  function confirmDiscardUnsavedRoute(action: string) {
    return (
      !hasUnsavedRouteChanges ||
      window.confirm(
        `Die aktuelle Route enthält ungespeicherte Änderungen. ${action}`,
      )
    );
  }

  function startNewRoute() {
    if (
      !confirmDiscardUnsavedRoute(
        "Neue Route beginnen und Änderungen verwerfen?",
      )
    ) {
      return;
    }

    dispatch({
      type: "reset",
      plan: {
        routingProfile: history.present.routingProfile,
        waypoints: [],
        segments: [],
      },
    });
    setActiveTourId(null);
    setSavedRoutePlan(null);
    setTourName(defaultTourName());
    setSelectedWaypointId(null);
    setDrawingMode("routed");
    setMapInteractionMode("draw");
    setElevationPanelDisplay("compact");
    setMobileSheetState("half");
    setTourMessage("Neue Route: Startpunkt auf der Karte setzen.");
  }

  function clearRoute() {
    if (
      hasWaypoints &&
      !window.confirm(
        hasUnsavedRouteChanges
          ? "Route leeren? Ungespeicherte Änderungen gehen verloren."
          : "Route leeren? Die gespeicherte Tour bleibt erhalten.",
      )
    ) {
      return;
    }

    dispatch({ type: "clear" });
    setActiveTourId(null);
    setSavedRoutePlan(null);
    setTourName(defaultTourName());
    setSelectedWaypointId(null);
    setTourMessage(
      "Route geleert. Mit Rückgängig kann sie wiederhergestellt werden.",
    );
  }

  function selectAuthMode(mode: AuthMode) {
    setAuthMode(mode);
    setAuthFeedback(null);
    setPendingVerificationEmail(null);
    setAuthPassword("");
    setAuthPasswordConfirmation("");
  }

  async function submitAuthentication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = authEmail.trim();
    if (!email || !authPassword) {
      setAuthFeedback({
        tone: "error",
        message: "E-Mail und Passwort ausfüllen.",
      });
      return;
    }
    if (authMode === "register" && authPassword !== authPasswordConfirmation) {
      setAuthFeedback({
        tone: "error",
        message: "Die beiden Passwörter stimmen nicht überein.",
      });
      return;
    }

    setAuthFeedback(null);
    try {
      setAuthSubmitting(true);
      const session =
        authMode === "login"
          ? await loginAccount(email, authPassword)
          : await registerAccount(email, authPassword);
      setAuthState({ ...session, status: "ready" });
      setAuthPassword("");
      setAuthPasswordConfirmation("");
      setPendingVerificationEmail(authMode === "register" ? email : null);
      setAuthFeedback({
        tone: "success",
        message:
          authMode === "login"
            ? `Angemeldet als ${session.user?.email ?? email}.`
            : "Fast geschafft: Bitte bestätige deine E-Mail über den zugesandten Link.",
      });
    } catch (error: unknown) {
      setAuthFeedback({ tone: "error", message: errorMessage(error) });
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function resendVerificationEmail() {
    if (!pendingVerificationEmail) {
      return;
    }

    setAuthFeedback(null);
    try {
      setAuthSubmitting(true);
      await requestVerificationEmailResend(pendingVerificationEmail);
      setAuthFeedback({
        tone: "success",
        message:
          "Falls ein unbestätigtes Konto zu dieser E-Mail existiert, wurde ein neuer Bestätigungs-Link versendet.",
      });
    } catch (error: unknown) {
      setAuthFeedback({ tone: "error", message: errorMessage(error) });
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function submitPasswordResetRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = authEmail.trim();
    if (!email) {
      setAuthFeedback({ tone: "error", message: "E-Mail ausfüllen." });
      return;
    }
    setAuthFeedback(null);
    try {
      setAuthSubmitting(true);
      await requestPasswordReset(email);
      setAuthFeedback({
        tone: "success",
        message:
          "Falls ein Konto zu dieser E-Mail existiert, wurde ein Reset-Link versendet.",
      });
    } catch (error: unknown) {
      setAuthFeedback({ tone: "error", message: errorMessage(error) });
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function submitPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordResetToken) {
      setAuthFeedback({ tone: "error", message: "Der Reset-Link fehlt." });
      return;
    }
    if (authPassword !== authPasswordConfirmation) {
      setAuthFeedback({
        tone: "error",
        message: "Die beiden Passwörter stimmen nicht überein.",
      });
      return;
    }
    setAuthFeedback(null);
    try {
      setAuthSubmitting(true);
      await confirmPasswordReset(
        passwordResetToken.uid,
        passwordResetToken.token,
        authPassword,
      );
      setPasswordResetToken(null);
      setAuthPassword("");
      setAuthPasswordConfirmation("");
      setAuthMode("login");
      removeAuthParametersFromUrl();
      setAuthFeedback({
        tone: "success",
        message: "Passwort geändert. Du kannst dich jetzt anmelden.",
      });
    } catch (error: unknown) {
      setAuthFeedback({ tone: "error", message: errorMessage(error) });
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function submitLogout() {
    setTourMessage(null);
    setAuthFeedback(null);
    try {
      const session = await logoutAccount();
      setAuthState({ ...session, status: "ready" });
      setSavedTours([]);
      setActiveTourId(null);
      setSavedRoutePlan(null);
      setTourName(defaultTourName());
      setOpenTopMenu(null);
    } catch (error: unknown) {
      setTourMessage(errorMessage(error));
    }
  }

  async function saveTour() {
    if (!authState.authenticated || history.present.waypoints.length === 0) {
      return;
    }

    const name = tourName.trim();
    if (!name) {
      setTourMessage("Bitte einen Namen für die Tour eingeben.");
      return;
    }

    const planToSave = history.present;
    setTourMessage(null);
    try {
      setTourActionPending(true);
      const response = activeTourId
        ? await updateSavedTour(activeTourId, {
            name,
            routeData: planToSave,
          })
        : await createSavedTour(name, planToSave);
      setActiveTourId(response.tour.id);
      setSavedRoutePlan(planToSave);
      const list = await listSavedTours();
      setSavedTours(list.tours);
      setTourName(response.tour.name);
      setTourMessage("Tour gespeichert.");
    } catch (error: unknown) {
      setTourMessage(errorMessage(error));
    } finally {
      setTourActionPending(false);
    }
  }

  function loadTour(tour: SavedTourDto) {
    if (
      !confirmDiscardUnsavedRoute(
        `Tour „${tour.name}“ laden und Änderungen verwerfen?`,
      )
    ) {
      return;
    }

    try {
      const plan = parseRoutePlan(tour.routeData);
      dispatch({ type: "replace", plan });
      setSelectedWaypointId(null);
      setActiveTourId(tour.id);
      setSavedRoutePlan(plan);
      setTourName(tour.name);
      setRouteFitRequestId((requestId) => requestId + 1);
      setTourMessage(`Tour geladen: ${tour.name}`);
    } catch {
      setTourMessage("Diese Tour kann nicht geladen werden.");
    }
  }

  async function renameTour(tour: SavedTourDto) {
    const name = editingTourName.trim();
    if (!name) {
      setTourMessage("Bitte einen Namen für die Tour eingeben.");
      return;
    }

    setTourMessage(null);
    try {
      setTourActionPending(true);
      const response = await updateSavedTour(tour.id, { name });
      const list = await listSavedTours();
      setSavedTours(list.tours);
      if (response.tour.id === activeTourId) {
        setTourName(response.tour.name);
      }
      setEditingTourId(null);
      setEditingTourName("");
      setTourMessage("Tour umbenannt.");
    } catch (error: unknown) {
      setTourMessage(errorMessage(error));
    } finally {
      setTourActionPending(false);
    }
  }

  async function setTourSharing(tour: SavedTourDto, shareEnabled: boolean) {
    setTourMessage(null);
    try {
      setTourActionPending(true);
      const response = await updateSavedTour(tour.id, { shareEnabled });
      const list = await listSavedTours();
      setSavedTours(list.tours);
      setTourMessage(
        response.tour.shareEnabled
          ? "Freigabe aktiviert. Der Link ist nur mit diesem Token erreichbar."
          : "Freigabe beendet. Der bisherige Link funktioniert nicht mehr.",
      );
    } catch (error: unknown) {
      setTourMessage(errorMessage(error));
    } finally {
      setTourActionPending(false);
    }
  }

  async function copyTourShareLink(tour: SavedTourDto) {
    if (!tour.shareId) {
      return;
    }

    const link = sharedTourUrl(tour.shareId);
    try {
      await navigator.clipboard.writeText(link);
      setTourMessage("Freigabe-Link kopiert.");
    } catch {
      window.prompt("Freigabe-Link kopieren:", link);
    }
  }

  async function removeTour(tour: SavedTourDto) {
    if (!window.confirm(`Tour "${tour.name}" endgültig löschen?`)) {
      return;
    }

    setTourMessage(null);
    try {
      setTourActionPending(true);
      await deleteSavedTour(tour.id);
      const list = await listSavedTours();
      setSavedTours(list.tours);
      if (tour.id === activeTourId) {
        setActiveTourId(null);
        setSavedRoutePlan(null);
        setTourName(defaultTourName());
      }
      setTourMessage("Tour gelöscht.");
    } catch (error: unknown) {
      setTourMessage(errorMessage(error));
    } finally {
      setTourActionPending(false);
    }
  }

  async function removeAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountDeletePassword) {
      setAuthFeedback({
        tone: "error",
        message: "Passwort zur Bestätigung eingeben.",
      });
      return;
    }
    if (
      !window.confirm(
        "Konto endgültig löschen? Alle gespeicherten Touren und ihre Freigabelinks werden unwiderruflich gelöscht.",
      )
    ) {
      return;
    }

    setAuthFeedback(null);
    try {
      setAccountDeleting(true);
      await deleteAccount(accountDeletePassword);
      setAuthState({ authenticated: false, status: "ready", user: null });
      setAccountDeletePassword("");
      setSavedTours([]);
      setActiveTourId(null);
      setSavedRoutePlan(null);
      setTourName(defaultTourName());
      setAuthFeedback({ tone: "success", message: "Konto wurde gelöscht." });
    } catch (error: unknown) {
      setAuthFeedback({ tone: "error", message: errorMessage(error) });
    } finally {
      setAccountDeleting(false);
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
    setOpenTopMenu(null);
  }

  async function importGpxFile(file: File) {
    if (
      !confirmDiscardUnsavedRoute("GPX importieren und Änderungen verwerfen?")
    ) {
      return;
    }

    setTourMessage(null);
    try {
      const plan = importRoutePlanFromGpx(await file.text());
      dispatch({ type: "replace", plan });
      setActiveTourId(null);
      setSavedRoutePlan(null);
      setSelectedWaypointId(null);
      setRouteFitRequestId((requestId) => requestId + 1);
      setTourMessage("GPX importiert. Original-Track bleibt erhalten.");
      setOpenTopMenu(null);
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
    setMobileHeaderOpen(false);
    setMobileSearchOpen(false);
    setSearchFocus((currentFocus) => ({
      lat: result.latitude,
      lon: result.longitude,
      requestId: (currentFocus?.requestId ?? 0) + 1,
      zoom: result.zoom,
    }));
  }

  const topMenus = (
    <div className="topMenuGroup" ref={topMenuRef}>
      <div className="manageMenu topManageMenu">
        <button
          type="button"
          aria-expanded={openTopMenu === "tours"}
          onClick={() =>
            setOpenTopMenu((menu) => (menu === "tours" ? null : "tours"))
          }
        >
          <span className="visuallyHidden">Meine Touren</span>
          <span className="topMenuDesktopLabel" aria-hidden="true">
            Meine Touren
          </span>
          <span className="topMenuMobileLabel" aria-hidden="true">
            Touren
          </span>
        </button>
        {openTopMenu === "tours" ? (
          <div className="managePanel" aria-label="Meine Touren">
            {authState.authenticated ? (
              <>
                <div className="tourSaveForm">
                  <label className="authField">
                    <span>Tourname</span>
                    <input
                      aria-label="Tourname"
                      value={tourName}
                      onChange={(event) =>
                        setTourName(event.currentTarget.value)
                      }
                    />
                  </label>
                  <button
                    type="button"
                    disabled={
                      tourActionPending ||
                      history.present.waypoints.length === 0
                    }
                    onClick={saveTour}
                  >
                    {activeTourId ? "Änderungen speichern" : "Tour speichern"}
                  </button>
                </div>
                <div className="savedTourList" aria-label="Gespeicherte Touren">
                  <div className="savedTourListHeader">
                    <strong>Gespeicherte Touren</strong>
                    <span>{savedTours.length}</span>
                  </div>
                  {savedTours.length ? (
                    savedTours.map((tour) => (
                      <div className="savedTourRow" key={tour.id}>
                        {editingTourId === tour.id ? (
                          <form
                            className="savedTourRenameForm"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void renameTour(tour);
                            }}
                          >
                            <input
                              aria-label={`Name von ${tour.name}`}
                              value={editingTourName}
                              onChange={(event) =>
                                setEditingTourName(event.currentTarget.value)
                              }
                            />
                            <button type="submit" disabled={tourActionPending}>
                              Speichern
                            </button>
                            <button
                              type="button"
                              disabled={tourActionPending}
                              onClick={() => {
                                setEditingTourId(null);
                                setEditingTourName("");
                              }}
                            >
                              Abbrechen
                            </button>
                          </form>
                        ) : (
                          <>
                            <button
                              className="savedTourLoadButton"
                              type="button"
                              aria-pressed={tour.id === activeTourId}
                              onClick={() => loadTour(tour)}
                            >
                              {tour.name}
                            </button>
                            <div className="savedTourActions">
                              <button
                                type="button"
                                disabled={tourActionPending}
                                onClick={() => {
                                  setEditingTourId(tour.id);
                                  setEditingTourName(tour.name);
                                }}
                              >
                                Umbenennen
                              </button>
                              <button
                                type="button"
                                disabled={tourActionPending}
                                onClick={() =>
                                  void setTourSharing(tour, !tour.shareEnabled)
                                }
                              >
                                {tour.shareEnabled
                                  ? "Freigabe beenden"
                                  : "Freigeben"}
                              </button>
                              {tour.shareEnabled && tour.shareId ? (
                                <>
                                  <a
                                    className="savedTourShareLink"
                                    href={sharedTourUrl(tour.shareId)}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Öffnen
                                  </a>
                                  <button
                                    type="button"
                                    disabled={tourActionPending}
                                    onClick={() => void copyTourShareLink(tour)}
                                  >
                                    Link kopieren
                                  </button>
                                </>
                              ) : null}
                              <button
                                className="dangerAction"
                                type="button"
                                disabled={tourActionPending}
                                onClick={() => void removeTour(tour)}
                              >
                                Löschen
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="savedTourEmpty">
                      Noch keine Tour gespeichert.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="menuEmptyState">
                <strong>Touren speichern</strong>
                <span>
                  Mit einem Konto bleiben deine Touren auf diesem Gerät
                  verfügbar.
                </span>
                <button type="button" onClick={() => setOpenTopMenu("account")}>
                  Anmelden
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="manageMenu topManageMenu">
        <button
          type="button"
          aria-expanded={openTopMenu === "files"}
          onClick={() =>
            setOpenTopMenu((menu) => (menu === "files" ? null : "files"))
          }
        >
          Datei
        </button>
        {openTopMenu === "files" ? (
          <div className="managePanel filePanel" aria-label="Dateiaktionen">
            <button
              type="button"
              onClick={() => {
                setOpenTopMenu(null);
                gpxInputRef.current?.click();
              }}
            >
              GPX importieren
            </button>
            <button
              type="button"
              disabled={history.present.waypoints.length < 2}
              onClick={exportGpx}
            >
              GPX exportieren
            </button>
          </div>
        ) : null}
      </div>

      <div className="manageMenu topManageMenu">
        <button
          type="button"
          aria-expanded={openTopMenu === "about"}
          onClick={() =>
            setOpenTopMenu((menu) => (menu === "about" ? null : "about"))
          }
        >
          Info
        </button>
        {openTopMenu === "about" ? (
          <div
            className="managePanel aboutPanel"
            aria-label="Über nightsky trail"
          >
            <strong>nightsky trail</strong>
            <p>
              Plane deine nächste Runde einfach und ohne Umwege. Kostenlos und
              ohne Konto kannst du am PC oder Handy Wege zeichnen, automatisch
              routen lassen und das Höhenprofil übersichtlich prüfen.
            </p>
            <p>
              Hochwertige Schweizer Karten und Höhenprofile auf Basis von
              swisstopo-Daten unterstützen dich bei der Planung. Zusätzlich
              zeigen wir vorhandene T3-Hinweise auf offiziellen Bergwanderwegen
              und T5-Hinweise auf offiziellen Alpinwanderwegen aus
              OpenStreetMap.
            </p>
            <div className="aboutNotice">
              <strong>Planungshinweis</strong>
              <span>
                Schwierigkeit, Sperrungen und Wegzustand können fehlen, veraltet
                oder falsch sein. Prüfe die Route und aktuelle Bedingungen vor
                Ort und plane passend zu deiner Erfahrung.
              </span>
            </div>
            <div className="aboutInstall">
              <strong>Auf dem Handy nutzen</strong>
              <span>
                Für eine bessere Nutzung kannst du nightsky trail zum
                Startbildschirm hinzufügen.
              </span>
              <span>
                Android: Browser-Menü öffnen und „App installieren“ oder „Zum
                Startbildschirm hinzufügen“ wählen.
              </span>
              <span>
                iPhone: in Safari auf „Teilen“ und danach „Zum Home-Bildschirm“
                tippen.
              </span>
            </div>
            <div className="aboutPrivacy">
              <strong>Tracker-frei &amp; werbefrei</strong>
              <span>
                Keine Webanalyse · keine Werbe-Tracker · keine Werbung
              </span>
            </div>
            <div className="aboutOpenSource">
              <strong>Open Source</strong>
              <span>Veröffentlicht unter der MIT License.</span>
              <a
                href="https://github.com/fcarron/nightsky-trail"
                target="_blank"
                rel="noreferrer"
              >
                Projekt auf GitHub
              </a>
            </div>
          </div>
        ) : null}
      </div>

      <div className="manageMenu topManageMenu">
        <button
          type="button"
          aria-expanded={openTopMenu === "account"}
          onClick={() =>
            setOpenTopMenu((menu) => (menu === "account" ? null : "account"))
          }
        >
          Konto
        </button>
        {openTopMenu === "account" ? (
          <div className="managePanel" aria-label="Konto">
            <section className="accountPanel">
              {authState.authenticated ? (
                <>
                  <div className="accountIdentity">
                    <span>Angemeldet</span>
                    <strong>{authState.user?.email}</strong>
                  </div>
                  <div className="accountActions">
                    <button type="button" onClick={submitLogout}>
                      Logout
                    </button>
                    <details className="accountDelete">
                      <summary>Konto löschen</summary>
                      <form onSubmit={removeAccount}>
                        <p>
                          Diese Aktion kann nicht rückgängig gemacht werden.
                          Alle gespeicherten Touren und ihre Freigabelinks
                          werden endgültig gelöscht.
                        </p>
                        <label className="authField">
                          <span>Passwort zur Bestätigung</span>
                          <input
                            autoComplete="current-password"
                            type="password"
                            value={accountDeletePassword}
                            onChange={(event) =>
                              setAccountDeletePassword(
                                event.currentTarget.value,
                              )
                            }
                          />
                        </label>
                        <button type="submit" disabled={accountDeleting}>
                          {accountDeleting
                            ? "Bitte warten"
                            : "Konto endgültig löschen"}
                        </button>
                      </form>
                    </details>
                  </div>
                </>
              ) : authMode === "forgot" ? (
                <form
                  className="authForm"
                  onSubmit={submitPasswordResetRequest}
                >
                  <strong>Passwort zurücksetzen</strong>
                  <p className="authHint">
                    Wir senden dir einen zeitlich begrenzten Reset-Link.
                  </p>
                  <label className="authField">
                    <span>E-Mail</span>
                    <input
                      autoComplete="email"
                      inputMode="email"
                      type="email"
                      value={authEmail}
                      onChange={(event) => {
                        setAuthEmail(event.currentTarget.value);
                        setPendingVerificationEmail(null);
                      }}
                    />
                  </label>
                  <button
                    className="authSubmit"
                    type="submit"
                    disabled={authSubmitting}
                  >
                    {authSubmitting ? "Bitte warten" : "Reset-Link senden"}
                  </button>
                  <button
                    className="authLinkButton"
                    type="button"
                    onClick={() => selectAuthMode("login")}
                  >
                    Zurück zum Login
                  </button>
                </form>
              ) : authMode === "reset" ? (
                <form className="authForm" onSubmit={submitPasswordReset}>
                  <strong>Neues Passwort setzen</strong>
                  <label className="authField">
                    <span>Neues Passwort</span>
                    <input
                      autoComplete="new-password"
                      type="password"
                      value={authPassword}
                      onChange={(event) =>
                        setAuthPassword(event.currentTarget.value)
                      }
                    />
                  </label>
                  <label className="authField">
                    <span>Passwort bestätigen</span>
                    <input
                      autoComplete="new-password"
                      type="password"
                      value={authPasswordConfirmation}
                      onChange={(event) =>
                        setAuthPasswordConfirmation(event.currentTarget.value)
                      }
                    />
                  </label>
                  <button
                    className="authSubmit"
                    type="submit"
                    disabled={authSubmitting}
                  >
                    {authSubmitting ? "Bitte warten" : "Passwort ändern"}
                  </button>
                </form>
              ) : (
                <form className="authForm" onSubmit={submitAuthentication}>
                  <div
                    className="authModeToggle"
                    role="group"
                    aria-label="Kontoaktion"
                  >
                    <button
                      type="button"
                      aria-pressed={authMode === "login"}
                      onClick={() => selectAuthMode("login")}
                    >
                      Login
                    </button>
                    <button
                      type="button"
                      aria-pressed={authMode === "register"}
                      onClick={() => selectAuthMode("register")}
                    >
                      Registrieren
                    </button>
                  </div>
                  <label className="authField">
                    <span>E-Mail</span>
                    <input
                      autoComplete={authMode === "login" ? "username" : "email"}
                      inputMode="email"
                      type={authMode === "register" ? "email" : "text"}
                      value={authEmail}
                      onChange={(event) =>
                        setAuthEmail(event.currentTarget.value)
                      }
                    />
                  </label>
                  <label className="authField">
                    <span>Passwort</span>
                    <input
                      autoComplete={
                        authMode === "login"
                          ? "current-password"
                          : "new-password"
                      }
                      type="password"
                      value={authPassword}
                      onChange={(event) =>
                        setAuthPassword(event.currentTarget.value)
                      }
                    />
                  </label>
                  {authMode === "register" ? (
                    <label className="authField">
                      <span>Passwort bestätigen</span>
                      <input
                        autoComplete="new-password"
                        type="password"
                        value={authPasswordConfirmation}
                        onChange={(event) =>
                          setAuthPasswordConfirmation(event.currentTarget.value)
                        }
                      />
                    </label>
                  ) : null}
                  <p className="authHint">
                    {authMode === "register"
                      ? "Kostenlos. Deine E-Mail wird nur für Anmeldung und Kontosicherheit verwendet."
                      : "Mit E-Mail und Passwort anmelden."}
                  </p>
                  <button
                    className="authSubmit"
                    type="submit"
                    disabled={authSubmitting}
                  >
                    {authSubmitting
                      ? "Bitte warten"
                      : authMode === "login"
                        ? "Anmelden"
                        : "Konto erstellen"}
                  </button>
                  {authMode === "login" ? (
                    <button
                      className="authLinkButton"
                      type="button"
                      onClick={() => selectAuthMode("forgot")}
                    >
                      Passwort vergessen?
                    </button>
                  ) : null}
                  {authMode === "register" && pendingVerificationEmail ? (
                    <button
                      className="authLinkButton"
                      type="button"
                      disabled={authSubmitting}
                      onClick={resendVerificationEmail}
                    >
                      Bestätigungs-E-Mail erneut senden
                    </button>
                  ) : null}
                </form>
              )}
              {authFeedback ? (
                <p
                  className={`authFeedback authFeedback-${authFeedback.tone}`}
                  role="status"
                >
                  {authFeedback.message}
                </p>
              ) : null}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <main className="appShell">
      <header
        className={`topBar ${mobileHeaderOpen ? "mobileHeaderOpen" : ""}`}
      >
        <button
          type="button"
          className="mobileHeaderToggle"
          aria-expanded={mobileHeaderOpen}
          aria-label={
            mobileHeaderOpen ? "Navigation schließen" : "Navigation öffnen"
          }
          onClick={() => {
            setMobileHeaderOpen((open) => {
              if (open) {
                setMobileSearchOpen(false);
                setOpenTopMenu(null);
              }
              return !open;
            });
          }}
        >
          <span aria-hidden="true">{mobileHeaderOpen ? "×" : "N"}</span>
        </button>
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
          className={`topSearch ${mobileSearchOpen ? "topSearch-mobileOpen" : ""}`}
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
          <button
            type="button"
            className="mobileSearchToggle"
            aria-label={mobileSearchOpen ? "Suche schliessen" : "Suche öffnen"}
            aria-expanded={mobileSearchOpen}
            onClick={() => {
              setOpenTopMenu(null);
              setMobileSearchOpen((open) => !open);
            }}
          >
            <span aria-hidden="true" />
          </button>
          {topMenus}
        </div>
      </header>

      <section
        className={`plannerLayout ${elevationPanelSize === "large" ? "plannerProfileMode" : ""}`}
        aria-label="Routenplaner"
      >
        <aside
          id="route-panel"
          aria-label="Routeninformationen"
          className={`sidebar routeDock mobileSheet-${mobileSheetState} ${elevationPanelSize === "large" ? "mobileProfileMode" : ""}`}
        >
          <button
            type="button"
            className="mobileSheetHandle"
            aria-controls="route-panel"
            aria-expanded={mobileSheetState !== "collapsed"}
            aria-label={mobileSheetActionLabel(
              mobileSheetState,
              elevationPanelSize === "large",
            )}
            onPointerDown={(event) => {
              mobileSheetPointerRef.current = {
                pointerId: event.pointerId,
                startY: event.clientY,
              };
              mobileSheetSwipedRef.current = false;
            }}
            onPointerUp={(event) => {
              const gesture = mobileSheetPointerRef.current;
              mobileSheetPointerRef.current = null;
              if (!gesture || gesture.pointerId !== event.pointerId) {
                return;
              }

              const distance = event.clientY - gesture.startY;
              if (Math.abs(distance) < 36) {
                return;
              }

              mobileSheetSwipedRef.current = true;
              if (elevationPanelSize === "large") {
                if (distance > 0) {
                  closeMobileProfile();
                }
                return;
              }
              setMobileSheetState((state) =>
                distance < 0
                  ? expandMobileSheet(state)
                  : collapseMobileSheet(state),
              );
            }}
            onPointerCancel={() => {
              mobileSheetPointerRef.current = null;
              mobileSheetSwipedRef.current = false;
            }}
            onClick={() => {
              if (mobileSheetSwipedRef.current) {
                mobileSheetSwipedRef.current = false;
                return;
              }
              if (elevationPanelSize === "large") {
                closeMobileProfile();
                return;
              }
              setMobileSheetState(nextMobileSheetState(mobileSheetState));
            }}
          >
            <span className="mobileSheetGrip" aria-hidden="true" />
            <strong>
              {elevationPanelSize === "large"
                ? "Höhenprofil"
                : selectedWaypoint
                  ? `Punkt ${selectedWaypointIndex + 1}`
                  : hasRoute
                    ? "Tour"
                    : "Route planen"}
            </strong>
            <span className="mobileSheetChevron" aria-hidden="true" />
          </button>
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
            <div className="drawModeHeader">
              <div>
                <strong>
                  {mapInteractionMode === "draw"
                    ? "Zeichnen"
                    : "Karte erkunden"}
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
                  Zeichnen
                </button>
              </div>
            </div>
            {mapInteractionMode === "draw" ? (
              <div className="drawToolSettings">
                <label className="routeProfileSelect">
                  <span>Routing</span>
                  <select
                    aria-label="Routing-Profil"
                    value={history.present.routingProfile}
                    onChange={(event) => {
                      const profile = event.currentTarget.value;
                      if (
                        profile === "foot" ||
                        profile === "hike" ||
                        profile === "bike"
                      ) {
                        dispatch({ type: "set-routing-profile", profile });
                      }
                    }}
                  >
                    <option value="hike">Trail</option>
                    <option value="foot">Strasse</option>
                    <option value="bike">Velo</option>
                  </select>
                </label>
                <div className="segmentModeControl">
                  <span>Neue Abschnitte</span>
                  <div role="group" aria-label="Neue Abschnitte zeichnen">
                    <button
                      type="button"
                      aria-pressed={drawingMode === "routed"}
                      onClick={() => setDrawingMode("routed")}
                    >
                      Wegen folgen
                    </button>
                    <button
                      type="button"
                      aria-pressed={drawingMode === "straight"}
                      onClick={() => setDrawingMode("straight")}
                    >
                      Gerade
                    </button>
                  </div>
                </div>
                <small className="routingProfileEffect">
                  {hasRoute
                    ? "Profilwechsel berechnet bestehende Abschnitte mit Wegen folgen neu."
                    : "Das Profil gilt für die gesamte Route."}
                </small>
              </div>
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
                  <small>
                    {Math.round(climbMetersPerKilometer)} Hm+/km ·{" "}
                    {routeTerrainLabel(climbMetersPerKilometer)}
                  </small>
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
            <button type="button" onClick={startNewRoute}>
              Neue Route
            </button>
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
                Route leeren
              </button>
            </details>
          </div>

          {selectedWaypoint ? (
            <section
              className="contextPanel"
              aria-label="Ausgewählter Wegpunkt"
            >
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
                <small>
                  Wegen folgen nutzt das gewählte Routingprofil. GPX-Import ist
                  im Datei-Menü.
                </small>
              </div>
            </section>
          ) : null}

          <details
            className={`detailDrawer ${elevationPanelSize === "large" ? "detailDrawer-profileOpen" : ""}`}
            open={elevationPanelSize === "large" ? true : undefined}
          >
            <summary>
              <span>Routendetails</span>
              <small>Runde · Weg · Wegpunkte</small>
            </summary>

            <ElevationPanel
              profile={elevationState.profile}
              surfaceSegments={elevationSurfaceSegments}
              status={elevationState.status}
              message={elevationState.message}
              onHoverPointChange={setElevationHoverPoint}
              onSizeChange={setElevationPanelDisplay}
              size={elevationPanelSize}
              analysisTab={analysisTab}
              splits={kilometreSplits}
              climbs={climbs}
              onAnalysisTabChange={setAnalysisTab}
              onAnalysisRangeChange={(range) => {
                setAnalysisHighlightRange(range);
                if (!range || !elevationState.profile) {
                  setElevationHoverPoint(null);
                  return;
                }
                const midpoint =
                  (range.startDistanceMeters + range.endDistanceMeters) / 2;
                const point = elevationState.profile.points.reduce(
                  (nearest, current) =>
                    Math.abs(current.distanceMeters - midpoint) <
                    Math.abs(nearest.distanceMeters - midpoint)
                      ? current
                      : nearest,
                );
                setElevationHoverPoint({
                  lon: point.longitude,
                  lat: point.latitude,
                });
              }}
              highlightedRange={analysisHighlightRange}
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
                          {segmentModeLabel(segment.mode)}
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
              <span>Wegen folgen</span>
            </div>
          </details>
        </aside>

        {effectiveComputedRoute && elevationPanelSize !== "large" ? (
          <button
            type="button"
            className={`profileDockTrigger profileDockTrigger-${mobileSheetState}`}
            aria-label="Höhenprofil öffnen"
            onClick={() => setElevationPanelDisplay("large")}
          >
            <span>Höhenprofil</span>
            <small>
              {elevationState.status === "loading"
                ? "Wird berechnet"
                : elevationState.status === "error"
                  ? "Fehler anzeigen"
                  : "Anzeigen"}
            </small>
          </button>
        ) : null}

        <button
          type="button"
          className={`mobileDrawAction mobileDrawAction-${mobileSheetState}`}
          aria-label="Route zeichnen und Routenpanel öffnen"
          aria-pressed={mapInteractionMode === "draw"}
          onClick={() => {
            setMapInteractionMode("draw");
            setMobileSheetState("half");
          }}
        >
          Route zeichnen
        </button>

        <MapPanel
          waypoints={history.present.waypoints}
          segments={history.present.segments}
          computedSegments={effectiveComputedRoute?.segments ?? null}
          graphhopperDebugVisible={ENABLE_DEV_TOOLS && graphhopperDebugVisible}
          elevationHoverPoint={elevationHoverPoint}
          analysisRangeGeometry={analysisRangeGeometry}
          elevationMarkerAutoPan={elevationPanelSize === "large"}
          elevationMarkerBottomPadding={
            elevationPanelSize === "large" ? 310 : 40
          }
          fitGeometry={history.present.importedGeometry}
          fitRequestId={routeFitRequestId}
          searchFocus={searchFocus}
          selectedWaypointId={selectedWaypointId}
          interactionMode={mapInteractionMode}
          onInteractionModeChange={setMapInteractionMode}
          onAddWaypoint={addWaypoint}
          onInsertWaypoint={insertWaypoint}
          onMoveWaypoint={moveWaypoint}
          onSelectWaypoint={(waypointId) => {
            setSelectedWaypointId(waypointId);
            if (waypointId) {
              setMobileSheetState("half");
            }
          }}
          onDeleteWaypoint={deleteWaypoint}
        />
      </section>
    </main>
  );
}

function sharedTourUrl(shareId: string): string {
  return new URL(`/t/${shareId}`, window.location.origin).toString();
}

function sharedTourIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/t\/([A-Za-z0-9_-]{20,})\/?$/);
  return match?.[1] ?? null;
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

function routeTerrainLabel(climbMetersPerKilometer: number): string {
  if (climbMetersPerKilometer < 15) return "flach";
  if (climbMetersPerKilometer < 30) return "leicht hügelig";
  if (climbMetersPerKilometer < 50) return "hügelig";
  if (climbMetersPerKilometer < 80) return "bergig";
  return "sehr bergig";
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
    return friendlyRouteError(message);
  }
  if (hasComputedRoute) {
    return "Route berechnet";
  }
  return "Startpunkt setzen";
}

function friendlyRouteError(message: string | null): string {
  if (message && /cannot find point|point not found/i.test(message)) {
    return "Kein routbarer Weg gefunden. Punkt verschieben oder Abschnitt auf Gerade setzen.";
  }
  return message ?? "Route konnte nicht berechnet werden.";
}

function expandMobileSheet(state: MobileSheetState): MobileSheetState {
  if (state === "collapsed") {
    return "half";
  }
  return "full";
}

function collapseMobileSheet(state: MobileSheetState): MobileSheetState {
  if (state === "full") {
    return "half";
  }
  return "collapsed";
}

function nextMobileSheetState(state: MobileSheetState): MobileSheetState {
  if (state === "collapsed") {
    return "half";
  }
  if (state === "half") {
    return "full";
  }
  return "collapsed";
}

function mobileSheetActionLabel(
  state: MobileSheetState,
  profileModeActive = false,
): string {
  if (profileModeActive) {
    return "Höhenprofil schließen";
  }
  if (state === "collapsed") {
    return "Routenpanel öffnen";
  }
  if (state === "half") {
    return "Routenpanel vollständig öffnen";
  }
  return "Routenpanel einklappen";
}

function segmentModeLabel(mode: SegmentMode): string {
  return mode === "routed" ? "Wegen folgen" : "Gerade";
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

function removeAuthParametersFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("auth_action");
  url.searchParams.delete("uid");
  url.searchParams.delete("token");
  window.history.replaceState(
    {},
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

function readAuthLink(): AuthLink | null {
  const parameters = new URLSearchParams(window.location.search);
  const action = parameters.get("auth_action");
  const uid = parameters.get("uid");
  const token = parameters.get("token");
  if (
    (action !== "verify-email" && action !== "reset-password") ||
    !uid ||
    !token
  ) {
    return null;
  }
  return { action, token, uid };
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const messages: Record<string, string> = {
      email_unavailable: "Diese E-Mail-Adresse ist bereits registriert.",
      invalid_credentials: "E-Mail oder Passwort ist nicht korrekt.",
      invalid_password_reset_link:
        "Der Passwort-Reset-Link ist ungültig oder abgelaufen.",
      invalid_verification_link:
        "Der Bestätigungslink ist ungültig oder abgelaufen.",
      rate_limited: "Zu viele Versuche. Bitte später erneut versuchen.",
      verification_email_unavailable:
        "Die Bestätigungs-E-Mail konnte nicht versendet werden. Bitte später erneut versuchen.",
    };
    return messages[error.code] ?? error.message;
  }
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
