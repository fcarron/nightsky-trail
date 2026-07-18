import type {
  ApiErrorResponse,
  AuthSessionResponse,
  CombinedTrailSegmentDto,
  ComputedRouteSegmentDto,
  ElevationProfilePointDto,
  ElevationProfileRequest,
  ElevationProfileResponse,
  HealthResponse,
  LineStringGeometryDto,
  OfficialTrailSegmentDto,
  OsmWayDto,
  RouteComputeRequest,
  RouteComputeResponse,
  SavedTourListResponse,
  SavedTourResponse,
  TrailsResponse,
} from "../types/api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/health`, { signal });

  if (!response.ok) {
    throw new Error(`Health check failed with HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!isHealthResponse(payload)) {
    throw new Error("Health check returned an invalid response.");
  }

  return payload;
}

export async function getAuthSession(
  signal?: AbortSignal,
): Promise<AuthSessionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/session`, {
    credentials: "include",
    signal,
  });
  const payload: unknown = await response.json();

  if (!response.ok || !isAuthSessionResponse(payload)) {
    throw new Error("Auth session returned an invalid response.");
  }

  return payload;
}

export async function registerAccount(
  username: string,
  password: string,
): Promise<AuthSessionResponse> {
  return submitAuthRequest("/api/v1/auth/register", username, password);
}

export async function loginAccount(
  username: string,
  password: string,
): Promise<AuthSessionResponse> {
  return submitAuthRequest("/api/v1/auth/login", username, password);
}

export async function logoutAccount(): Promise<AuthSessionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
    credentials: "include",
    method: "POST",
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new ApiRequestError(toApiError(payload, "Logout failed", response.status));
  }
  if (!isAuthSessionResponse(payload)) {
    throw new Error("Logout returned an invalid response.");
  }
  return payload;
}

export async function listSavedTours(
  signal?: AbortSignal,
): Promise<SavedTourListResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/tours`, {
    credentials: "include",
    signal,
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new ApiRequestError(toApiError(payload, "Tour list failed", response.status));
  }
  if (!isSavedTourListResponse(payload)) {
    throw new Error("Tour list returned an invalid response.");
  }
  return payload;
}

export async function createSavedTour(
  name: string,
  routeData: unknown,
): Promise<SavedTourResponse> {
  return submitTourRequest("/api/v1/tours", "POST", { name, routeData });
}

export async function updateSavedTour(
  id: string,
  data: { name?: string; routeData?: unknown },
): Promise<SavedTourResponse> {
  return submitTourRequest(`/api/v1/tours/${id}`, "PATCH", data);
}

export async function deleteSavedTour(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/tours/${id}`, {
    credentials: "include",
    method: "DELETE",
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new ApiRequestError(toApiError(payload, "Tour delete failed", response.status));
  }
}

export async function computeRoute(
  request: RouteComputeRequest,
  signal?: AbortSignal,
): Promise<RouteComputeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/route/compute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal,
  });

  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new ApiRequestError(
      isApiErrorResponse(payload)
        ? payload
        : {
            code: "request_failed",
            message: `Route compute failed with HTTP ${response.status}`,
            details: {},
          },
    );
  }

  if (!isRouteComputeResponse(payload)) {
    throw new Error("Route compute returned an invalid response.");
  }

  return payload;
}

export async function computeElevationProfile(
  request: ElevationProfileRequest,
  signal?: AbortSignal,
): Promise<ElevationProfileResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/elevation/profile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal,
  });

  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new ApiRequestError(
      isApiErrorResponse(payload)
        ? payload
        : {
            code: "request_failed",
            message: `Elevation profile failed with HTTP ${response.status}`,
            details: {},
          },
    );
  }

  if (!isElevationProfileResponse(payload)) {
    throw new Error("Elevation profile returned an invalid response.");
  }

  return payload;
}

export async function getTrailDifficultyWays(
  bbox: [number, number, number, number],
  zoom: number,
  includeOsm: boolean,
  includeOfficial: boolean,
  includeDebug: boolean,
  signal?: AbortSignal,
): Promise<TrailsResponse> {
  const params = new URLSearchParams({
    bbox: bbox.map((value) => value.toFixed(7)).join(","),
    include_debug: includeDebug ? "true" : "false",
    include_official: includeOfficial ? "true" : "false",
    include_osm: includeOsm ? "true" : "false",
    zoom: String(Math.round(zoom)),
  });
  const response = await fetch(`${API_BASE_URL}/api/v1/trails?${params}`, {
    signal,
  });

  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new ApiRequestError(
      isApiErrorResponse(payload)
        ? payload
        : {
            code: "request_failed",
            message: `Trail difficulty loading failed with HTTP ${response.status}`,
            details: {},
          },
    );
  }

  if (!isTrailsResponse(payload)) {
    throw new Error("Trail difficulty loading returned an invalid response.");
  }

  return payload;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(response: ApiErrorResponse) {
    super(response.message);
    this.name = "ApiRequestError";
    this.code = response.code;
    this.details = response.details;
  }
}

async function submitAuthRequest(
  path: string,
  username: string,
  password: string,
): Promise<AuthSessionResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    body: JSON.stringify({ password, username }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new ApiRequestError(toApiError(payload, "Authentication failed", response.status));
  }
  if (!isAuthSessionResponse(payload)) {
    throw new Error("Authentication returned an invalid response.");
  }
  return payload;
}

async function submitTourRequest(
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<SavedTourResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    body: JSON.stringify(body),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method,
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new ApiRequestError(toApiError(payload, "Tour request failed", response.status));
  }
  if (!isSavedTourResponse(payload)) {
    throw new Error("Tour request returned an invalid response.");
  }
  return payload;
}

function toApiError(payload: unknown, message: string, status: number): ApiErrorResponse {
  return isApiErrorResponse(payload)
    ? payload
    : {
        code: "request_failed",
        message: `${message} with HTTP ${status}`,
        details: {},
      };
}

function isHealthResponse(payload: unknown): payload is HealthResponse {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "status" in payload &&
    payload.status === "ok"
  );
}

function isAuthSessionResponse(
  payload: unknown,
): payload is AuthSessionResponse {
  return (
    isRecord(payload) &&
    typeof payload.authenticated === "boolean" &&
    (payload.user === null ||
      (isRecord(payload.user) &&
        typeof payload.user.id === "number" &&
        Number.isFinite(payload.user.id) &&
        typeof payload.user.username === "string"))
  );
}

function isSavedTourListResponse(
  payload: unknown,
): payload is SavedTourListResponse {
  return (
    isRecord(payload) &&
    Array.isArray(payload.tours) &&
    payload.tours.every(isSavedTour)
  );
}

function isSavedTourResponse(payload: unknown): payload is SavedTourResponse {
  return isRecord(payload) && isSavedTour(payload.tour);
}

function isSavedTour(payload: unknown): boolean {
  return (
    isRecord(payload) &&
    typeof payload.id === "string" &&
    typeof payload.name === "string" &&
    "routeData" in payload &&
    typeof payload.createdAt === "string" &&
    typeof payload.updatedAt === "string"
  );
}

function isRouteComputeResponse(
  payload: unknown,
): payload is RouteComputeResponse {
  return (
    isRecord(payload) &&
    isLineStringGeometry(payload.geometry) &&
    typeof payload.distanceMeters === "number" &&
    Number.isFinite(payload.distanceMeters) &&
    Array.isArray(payload.segments) &&
    payload.segments.every(isComputedRouteSegment) &&
    Array.isArray(payload.warnings) &&
    payload.warnings.every((warning) => typeof warning === "string")
  );
}

function isElevationProfileResponse(
  payload: unknown,
): payload is ElevationProfileResponse {
  return (
    isRecord(payload) &&
    typeof payload.distanceMeters === "number" &&
    Number.isFinite(payload.distanceMeters) &&
    typeof payload.ascentMeters === "number" &&
    Number.isFinite(payload.ascentMeters) &&
    typeof payload.descentMeters === "number" &&
    Number.isFinite(payload.descentMeters) &&
    typeof payload.minElevationMeters === "number" &&
    Number.isFinite(payload.minElevationMeters) &&
    typeof payload.maxElevationMeters === "number" &&
    Number.isFinite(payload.maxElevationMeters) &&
    isHikingTime(payload.hikingTime) &&
    Array.isArray(payload.points) &&
    payload.points.every(isElevationProfilePoint)
  );
}

function isHikingTime(payload: unknown): boolean {
  return (
    isRecord(payload) &&
    typeof payload.duration_minutes === "number" &&
    Number.isFinite(payload.duration_minutes) &&
    payload.method === "swiss_hiking_polynomial" &&
    typeof payload.segment_length_m === "number" &&
    Number.isFinite(payload.segment_length_m) &&
    typeof payload.smoothing_window_m === "number" &&
    Number.isFinite(payload.smoothing_window_m) &&
    typeof payload.segment_count === "number" &&
    Number.isFinite(payload.segment_count)
  );
}

function isTrailsResponse(payload: unknown): payload is TrailsResponse {
  return (
    isRecord(payload) &&
    Array.isArray(payload.ways) &&
    payload.ways.every(isOsmWay) &&
    isTrailSummary(payload.trailSummary) &&
    Array.isArray(payload.officialSegments) &&
    payload.officialSegments.every(isOfficialTrailSegment) &&
    Array.isArray(payload.combinedSegments) &&
    payload.combinedSegments.every(isCombinedTrailSegment) &&
    Array.isArray(payload.warnings) &&
    payload.warnings.every((warning) => typeof warning === "string")
  );
}

function isTrailSummary(payload: unknown): payload is TrailsResponse["trailSummary"] {
  return (
    isRecord(payload) &&
    typeof payload.totalWays === "number" &&
    Number.isFinite(payload.totalWays) &&
    isNumberRecord(payload.byLabel) &&
    Array.isArray(payload.commonTags) &&
    payload.commonTags.every(isTrailSummaryTag)
  );
}

function isTrailSummaryTag(payload: unknown): boolean {
  return (
    isRecord(payload) &&
    typeof payload.key === "string" &&
    typeof payload.value === "string" &&
    typeof payload.count === "number" &&
    Number.isFinite(payload.count)
  );
}

function isOsmWay(payload: unknown): payload is OsmWayDto {
  return (
    isRecord(payload) &&
    typeof payload.id === "number" &&
    Number.isFinite(payload.id) &&
    isLineStringGeometry(payload.geometry) &&
    isStringRecord(payload.tags)
  );
}

function isOfficialTrailSegment(payload: unknown): payload is OfficialTrailSegmentDto {
  return (
    isRecord(payload) &&
    typeof payload.id === "string" &&
    typeof payload.officialCategory === "string" &&
    isLineStringGeometry(payload.geometry)
  );
}

function isCombinedTrailSegment(payload: unknown): payload is CombinedTrailSegmentDto {
  return (
    isRecord(payload) &&
    typeof payload.osmWayId === "number" &&
    Number.isFinite(payload.osmWayId) &&
    (typeof payload.swisstopoId === "string" || payload.swisstopoId === null) &&
    (typeof payload.officialCategory === "string" || payload.officialCategory === null) &&
    (typeof payload.osmSacScale === "string" || payload.osmSacScale === null) &&
    (typeof payload.tLevel === "number" || payload.tLevel === null) &&
    typeof payload.matchScore === "number" &&
    Number.isFinite(payload.matchScore) &&
    typeof payload.matchStatus === "string" &&
    typeof payload.warningOverlay === "boolean" &&
    isLineStringGeometry(payload.geometry)
  );
}

function isElevationProfilePoint(
  payload: unknown,
): payload is ElevationProfilePointDto {
  return (
    isRecord(payload) &&
    typeof payload.distanceMeters === "number" &&
    Number.isFinite(payload.distanceMeters) &&
    typeof payload.elevationMeters === "number" &&
    Number.isFinite(payload.elevationMeters) &&
    typeof payload.smoothedElevationMeters === "number" &&
    Number.isFinite(payload.smoothedElevationMeters) &&
    typeof payload.gradientPercent === "number" &&
    Number.isFinite(payload.gradientPercent) &&
    typeof payload.longitude === "number" &&
    Number.isFinite(payload.longitude) &&
    typeof payload.latitude === "number" &&
    Number.isFinite(payload.latitude)
  );
}

function isComputedRouteSegment(
  payload: unknown,
): payload is ComputedRouteSegmentDto {
  return (
    isRecord(payload) &&
    typeof payload.id === "string" &&
    typeof payload.fromWaypointId === "string" &&
    typeof payload.toWaypointId === "string" &&
    (payload.mode === "straight" || payload.mode === "routed") &&
    typeof payload.distanceMeters === "number" &&
    Number.isFinite(payload.distanceMeters) &&
    isLineStringGeometry(payload.geometry) &&
    isRecord(payload.details)
  );
}

function isLineStringGeometry(
  payload: unknown,
): payload is LineStringGeometryDto {
  return (
    isRecord(payload) &&
    payload.type === "LineString" &&
    Array.isArray(payload.coordinates) &&
    payload.coordinates.every(
      (coordinate) =>
        Array.isArray(coordinate) &&
        coordinate.length === 2 &&
        coordinate.every(
          (value) => typeof value === "number" && Number.isFinite(value),
        ),
    )
  );
}

function isApiErrorResponse(payload: unknown): payload is ApiErrorResponse {
  return (
    isRecord(payload) &&
    typeof payload.code === "string" &&
    typeof payload.message === "string" &&
    isRecord(payload.details)
  );
}

function isRecord(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === "object" && payload !== null;
}

function isStringRecord(payload: unknown): payload is Record<string, string> {
  return (
    isRecord(payload) &&
    Object.values(payload).every((value) => typeof value === "string")
  );
}

function isNumberRecord(payload: unknown): payload is Record<string, number> {
  return (
    isRecord(payload) &&
    Object.values(payload).every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  );
}
