import type {
  ApiErrorResponse,
  ComputedRouteSegmentDto,
  ElevationProfilePointDto,
  ElevationProfileRequest,
  ElevationProfileResponse,
  HealthResponse,
  LineStringGeometryDto,
  OsmWayDto,
  RouteComputeRequest,
  RouteComputeResponse,
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
  signal?: AbortSignal,
): Promise<TrailsResponse> {
  const params = new URLSearchParams({
    bbox: bbox.map((value) => value.toFixed(7)).join(","),
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

function isHealthResponse(payload: unknown): payload is HealthResponse {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "status" in payload &&
    payload.status === "ok"
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
    Array.isArray(payload.points) &&
    payload.points.every(isElevationProfilePoint)
  );
}

function isTrailsResponse(payload: unknown): payload is TrailsResponse {
  return (
    isRecord(payload) &&
    Array.isArray(payload.ways) &&
    payload.ways.every(isOsmWay) &&
    Array.isArray(payload.warnings) &&
    payload.warnings.every((warning) => typeof warning === "string")
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
