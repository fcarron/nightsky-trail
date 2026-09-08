import { useEffect, useMemo, useState } from "react";

import { useI18n } from "../../app/i18n";

import { ElevationPanel } from "../elevation/ElevationPanel";
import {
  calculateKilometreSplits,
  detectClimbs,
  formatDurationMinutes,
  toElevationProfile,
  toElevationProfileRequest,
  type ElevationProfile,
} from "../elevation/elevationModel";
import type { AnalysisTab } from "../elevation/RouteAnalysis";
import { MapPanel } from "../map/MapPanel";
import {
  ApiRequestError,
  computeElevationProfile,
  computeRoute,
  getSharedTour,
} from "../../services/api";
import type { SharedTourDto } from "../../types/api";
import { formatDistance } from "./routeGeometry";
import {
  toComputedRoute,
  toImportedComputedRoute,
  toRouteComputeRequest,
} from "./routeApi";
import type { ComputedRoute, LonLat, RoutePlan } from "./routeModel";
import { parseRoutePlan } from "./routeStorage";

type LoadStatus = "loading" | "ready" | "error";

export function SharedTourPage({ shareId }: { shareId: string }) {
  const { t } = useI18n();
  const [tour, setTour] = useState<SharedTourDto | null>(null);
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [route, setRoute] = useState<ComputedRoute | null>(null);
  const [profile, setProfile] = useState<ElevationProfile | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [routeStatus, setRouteStatus] = useState<LoadStatus>("loading");
  const [elevationStatus, setElevationStatus] = useState<LoadStatus>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [elevationHoverPoint, setElevationHoverPoint] = useState<LonLat | null>(
    null,
  );
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("profile");
  const [analysisHighlightRange, setAnalysisHighlightRange] = useState<{
    startDistanceMeters: number;
    endDistanceMeters: number;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    getSharedTour(shareId, controller.signal)
      .then((response) => {
        const nextPlan = parseRoutePlan(response.tour.routeData);
        setTour(response.tour);
        setPlan(nextPlan);
        setLoadStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setLoadStatus("error");
        setMessage(sharedTourErrorMessage(error));
      });

    return () => controller.abort();
  }, [shareId]);

  useEffect(() => {
    const importedRoute = plan ? toImportedComputedRoute(plan) : null;
    if (!plan || plan.waypoints.length < 2 || importedRoute) {
      return;
    }

    const controller = new AbortController();
    computeRoute(toRouteComputeRequest(plan), controller.signal)
      .then((response) => {
        setRoute(toComputedRoute(response));
        setRouteStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setRouteStatus("error");
        setMessage(sharedTourErrorMessage(error));
      });

    return () => controller.abort();
  }, [plan]);

  const importedRoute = useMemo(
    () => (plan ? toImportedComputedRoute(plan) : null),
    [plan],
  );
  const effectiveRoute = importedRoute ?? route;

  useEffect(() => {
    if (!effectiveRoute) {
      return;
    }

    const controller = new AbortController();
    computeElevationProfile(
      toElevationProfileRequest(effectiveRoute),
      controller.signal,
    )
      .then((response) => {
        setProfile(toElevationProfile(response));
        setElevationStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setElevationStatus("error");
        setMessage(sharedTourErrorMessage(error));
      });

    return () => controller.abort();
  }, [effectiveRoute]);

  const fitGeometry = effectiveRoute?.geometry ?? plan?.importedGeometry;
  const fitRequestId = fitGeometry?.length ? 1 : 0;
  const routeDistanceMeters = effectiveRoute?.distanceMeters ?? 0;
  const kilometreSplits = useMemo(
    () => (profile ? calculateKilometreSplits(profile) : []),
    [profile],
  );
  const climbs = useMemo(
    () => (profile ? detectClimbs(profile) : []),
    [profile],
  );
  const analysisRangeGeometry = useMemo(() => {
    if (!analysisHighlightRange || !profile) {
      return [];
    }
    return profile.points
      .filter(
        (point) =>
          point.distanceMeters >= analysisHighlightRange.startDistanceMeters &&
          point.distanceMeters <= analysisHighlightRange.endDistanceMeters,
      )
      .map((point) => ({ lon: point.longitude, lat: point.latitude }));
  }, [analysisHighlightRange, profile]);
  const effectiveRouteStatus =
    loadStatus === "error" || (plan && plan.waypoints.length < 2)
      ? "error"
      : importedRoute
        ? "ready"
        : routeStatus;
  const effectiveElevationStatus =
    effectiveRouteStatus === "error" ? "error" : elevationStatus;
  const effectiveMessage =
    plan && plan.waypoints.length < 2 ? t("routeShareNotDisplayable") : message;

  const summary = useMemo(
    () => ({
      ascent: profile ? `${Math.round(profile.ascentMeters)} m` : "-",
      descent: profile ? `${Math.round(profile.descentMeters)} m` : "-",
      distance: effectiveRoute ? formatDistance(routeDistanceMeters) : "-",
      duration: profile
        ? formatDurationMinutes(profile.hikingTime.durationMinutes)
        : "-",
    }),
    [effectiveRoute, profile, routeDistanceMeters],
  );

  return (
    <main className="publicTourShell">
      <header className="publicTourTopBar">
        <a className="brand" href="/" aria-label="nightsky trail">
          <span className="brandMark" aria-hidden="true">
            N
          </span>
          <span>
            <strong>nightsky trail</strong>
            <span>{t("routeShare")}</span>
          </span>
        </a>
        <a className="publicTourPlanLink" href="/">
          {t("ownTour")}
        </a>
      </header>

      <section className="publicTourMapArea" aria-label={t("routeShare")}>
        <MapPanel
          waypoints={plan?.waypoints ?? []}
          segments={effectiveRoute ? (plan?.segments ?? []) : []}
          computedSegments={effectiveRoute?.segments ?? null}
          graphhopperDebugVisible={false}
          elevationHoverPoint={elevationHoverPoint}
          analysisRangeGeometry={analysisRangeGeometry}
          fitGeometry={fitGeometry}
          fitRequestId={fitRequestId}
          searchFocus={null}
          selectedWaypointId={null}
          interactionMode="explore"
          onInteractionModeChange={() => undefined}
          onAddWaypoint={() => undefined}
          onInsertWaypoint={() => ""}
          onMoveWaypoint={() => undefined}
          onSelectWaypoint={() => undefined}
          onDeleteWaypoint={() => undefined}
        />
        <aside className="publicTourSummary" aria-live="polite">
          <span>{t("routeShare")}</span>
          <h1>{tour?.name ?? t("routeShareLoading")}</h1>
          <dl className="runSummaryGrid" aria-label={t("routeDetails")}>
            <div>
              <dt>{t("distance")}</dt>
              <dd>{summary.distance}</dd>
            </div>
            <div>
              <dt>{t("ascent")}</dt>
              <dd>
                {summary.ascent}
                {profile ? (
                  <small>
                    {summary.descent} {t("descent")}
                  </small>
                ) : null}
              </dd>
            </div>
            <div className="runSummaryTimeCard">
              <dt>{t("hikingTime")}</dt>
              <dd>{summary.duration}</dd>
            </div>
          </dl>
          {loadStatus === "loading" || effectiveRouteStatus === "loading" ? (
            <p>{t("tourLoaded")}</p>
          ) : null}
          {effectiveMessage ? (
            <p className="publicTourError">{effectiveMessage}</p>
          ) : null}
        </aside>
      </section>

      <section className="publicTourProfile" aria-label={t("elevationProfile")}>
        <ElevationPanel
          profile={profile}
          status={effectiveElevationStatus}
          message={effectiveMessage}
          onHoverPointChange={setElevationHoverPoint}
          size="large"
          analysisTab={analysisTab}
          splits={kilometreSplits}
          climbs={climbs}
          onAnalysisTabChange={setAnalysisTab}
          onAnalysisRangeChange={(range) => {
            setAnalysisHighlightRange(range);
            if (!range || !profile) {
              setElevationHoverPoint(null);
              return;
            }
            const midpoint =
              (range.startDistanceMeters + range.endDistanceMeters) / 2;
            const point = profile.points.reduce((nearest, current) =>
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
      </section>
    </main>
  );
}

function sharedTourErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }
  return "Geteilte Tour konnte nicht geladen werden.";
}
