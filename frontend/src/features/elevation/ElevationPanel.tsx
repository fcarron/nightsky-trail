import { useEffect, useMemo, useRef, useState } from "react";

import { CustomChart, LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { graphic, init, use as registerEChartsModules } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

import { formatDistance } from "../route/routeGeometry";
import type { ElevationProfile } from "./elevationModel";
import {
  formatElevationMeters,
  formatGradientPercent,
  gradientGroupForPercent,
} from "./elevationModel";

registerEChartsModules([
  CustomChart,
  LineChart,
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export type ElevationPanelSize = "compact" | "large";

type ProfileBandDatum = [
  centerKm: number,
  startKm: number,
  endKm: number,
  baseMeters: number,
  startTopMeters: number,
  endTopMeters: number,
  gradientPercent: number,
];

type SurfaceBandDatum = [
  centerKm: number,
  startKm: number,
  endKm: number,
  lane: number,
  color: string,
  label: string,
];

export interface ElevationSurfaceSegment {
  startDistanceMeters: number;
  endDistanceMeters: number;
  label: string;
  color: string;
}

interface CustomRenderParams {
  coordSys?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface CustomRenderApi {
  value: (dimension: number) => number | string;
  coord: (data: [number, number]) => [number, number];
  style: (extra?: Record<string, unknown>) => Record<string, unknown>;
}

interface ElevationHoverPoint {
  lon: number;
  lat: number;
}

interface ElevationPanelProps {
  profile: ElevationProfile | null;
  surfaceSegments?: ElevationSurfaceSegment[];
  status: "idle" | "loading" | "ready" | "error";
  message: string | null;
  onHoverPointChange?: (point: ElevationHoverPoint | null) => void;
  onSizeChange?: (size: ElevationPanelSize) => void;
  size?: ElevationPanelSize;
}

export function ElevationPanel({
  profile,
  surfaceSegments = [],
  status,
  message,
  onHoverPointChange,
  onSizeChange,
  size = "compact",
}: ElevationPanelProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [activePoint, setActivePoint] = useState<
    ElevationProfile["points"][number] | null
  >(null);
  const panelSize = size;
  const elevationFloor = useMemo(() => {
    if (!profile) {
      return 0;
    }
    return Math.floor(profile.minElevationMeters / 50) * 50;
  }, [profile]);
  const chartData = useMemo(() => {
    if (!profile) {
      return null;
    }

    return {
      bands: createProfileBands(profile, elevationFloor),
      line: profile.points.map((point) => [
        point.distanceMeters / 1000,
        point.smoothedElevationMeters,
      ]),
      surfaceBands: createSurfaceBands(surfaceSegments, profile.distanceMeters),
    };
  }, [elevationFloor, profile, surfaceSegments]);

  useEffect(() => {
    if (
      !chartRef.current ||
      !profile ||
      !chartData ||
      profile.points.length === 0
    ) {
      onHoverPointChange?.(null);
      return;
    }

    const chartElement = chartRef.current;
    const chart = init(chartElement);
    let hoverFrame: number | null = null;
    let pendingHoverEvent: { offsetX: number; offsetY: number } | null = null;
    let touchPointerId: number | null = null;
    let touchSelectionActive = false;
    const elevationRange = Math.max(
      80,
      profile.maxElevationMeters - elevationFloor,
    );
    chart.setOption({
      animation: false,
      backgroundColor: "transparent",
      grid: {
        left: 44,
        right: 14,
        top: panelSize === "large" ? 18 : 8,
        bottom: panelSize === "large" ? 58 : 38,
      },
      tooltip: {
        backgroundColor: "#101923",
        borderColor: "#334657",
        borderWidth: 1,
        confine: true,
        formatter: (params: unknown) =>
          formatElevationTooltip(params, profile, surfaceSegments),
        textStyle: { color: "#f4f8fb" },
        trigger: "axis",
      },
      dataZoom: [
        {
          debounce: 30,
          filterMode: "none",
          moveOnMouseMove: false,
          moveOnMouseWheel: true,
          show: false,
          throttle: 40,
          type: "inside",
          zoomLock: false,
          zoomOnMouseWheel: true,
        },
        {
          bottom: 0,
          borderColor: "rgba(143, 161, 173, 0.18)",
          brushSelect: true,
          dataBackground: {
            areaStyle: { color: "rgba(79, 140, 255, 0.1)" },
            lineStyle: { color: "rgba(244, 248, 251, 0.25)" },
          },
          realtime: false,
          fillerColor: "rgba(79, 140, 255, 0.16)",
          handleStyle: { color: "#8fa1ad" },
          height: panelSize === "large" ? 14 : 9,
          labelFormatter: (value: number) => `${value.toFixed(1)} km`,
          selectedDataBackground: {
            areaStyle: { color: "rgba(79, 140, 255, 0.18)" },
            lineStyle: { color: "rgba(244, 248, 251, 0.35)" },
          },
          textStyle: { color: "#8fa1ad" },
          type: "slider",
        },
      ],
      xAxis: {
        axisLabel: {
          color: "#8fa1ad",
          formatter: (value: number) => `${value.toFixed(1)} km`,
          margin: panelSize === "large" ? 8 : 10,
        },
        axisLine: { lineStyle: { color: "#334657" } },
        splitLine: { lineStyle: { color: "rgba(143, 161, 173, 0.14)" } },
        type: "value",
      },
      yAxis: [
        {
          axisLabel: {
            color: "#8fa1ad",
            formatter: (value: number) => `${Math.round(value)} m`,
          },
          axisLine: { lineStyle: { color: "#334657" } },
          max:
            Math.ceil(
              (profile.maxElevationMeters + elevationRange * 0.08) / 20,
            ) * 20,
          min: elevationFloor,
          splitLine: { lineStyle: { color: "rgba(143, 161, 173, 0.16)" } },
          type: "value",
        },
        {
          axisLabel: { show: false },
          axisLine: { show: false },
          axisTick: { show: false },
          max: 1,
          min: 0,
          splitLine: { show: false },
          type: "value",
        },
      ],
      series: [
        {
          data: chartData.bands,
          coordinateSystem: "cartesian2d",
          dimensions: [
            "distance",
            "start",
            "end",
            "base",
            "startElevation",
            "endElevation",
            "gradient",
          ],
          encode: { x: 0, y: 5 },
          itemStyle: {
            borderWidth: 0,
            color: (params: { dataIndex: number }) =>
              gradientGroupForPercent(
                profile.points[params.dataIndex]?.gradientPercent ?? 0,
              ).color,
            opacity: 0.96,
          },
          name: "Steigung",
          renderItem: (params: CustomRenderParams, api: CustomRenderApi) =>
            renderProfileBand(params, api),
          type: "custom",
          yAxisIndex: 0,
        },
        {
          data: chartData.line,
          lineStyle: { color: "rgba(244, 248, 251, 0.82)", width: 1.5 },
          name: "Höhe",
          showSymbol: false,
          silent: true,
          smooth: 0.15,
          progressive: 300,
          type: "line",
          yAxisIndex: 0,
        },
        ...(panelSize === "large" && chartData.surfaceBands.length
          ? [
              {
                data: chartData.surfaceBands,
                coordinateSystem: "cartesian2d",
                dimensions: [
                  "distance",
                  "start",
                  "end",
                  "lane",
                  "color",
                  "label",
                ],
                encode: { x: 0, y: 3 },
                name: "Weg",
                renderItem: (
                  params: CustomRenderParams,
                  api: CustomRenderApi,
                ) => renderSurfaceBand(params, api),
                silent: true,
                type: "custom",
                yAxisIndex: 1,
              },
            ]
          : []),
      ],
    });

    const updateHoverPoint = (event: { offsetX: number; offsetY: number }) => {
      if (
        !chart.containPixel({ gridIndex: 0 }, [event.offsetX, event.offsetY])
      ) {
        if (!touchSelectionActive) {
          setActivePoint(null);
          onHoverPointChange?.(null);
        }
        return;
      }
      const value = chart.convertFromPixel({ gridIndex: 0 }, [
        event.offsetX,
        event.offsetY,
      ]);
      if (!Array.isArray(value) || typeof value[0] !== "number") {
        return;
      }
      const pointIndex = nearestElevationPointIndex(profile, value[0] * 1000);
      const point = profile.points[pointIndex];
      if (!point) {
        return;
      }
      setActivePoint(point);
      onHoverPointChange?.({
        lon: point.longitude,
        lat: point.latitude,
      });
      chart.dispatchAction({
        type: "showTip",
        seriesIndex: 0,
        dataIndex: pointIndex,
      });
    };

    const handleMouseMove = (event: { offsetX: number; offsetY: number }) => {
      pendingHoverEvent = event;
      if (hoverFrame !== null) {
        return;
      }
      hoverFrame = window.requestAnimationFrame(() => {
        hoverFrame = null;
        const currentEvent = pendingHoverEvent;
        if (!currentEvent) {
          return;
        }
        updateHoverPoint(currentEvent);
      });
    };

    const handleMouseOut = () => {
      pendingHoverEvent = null;
      if (hoverFrame !== null) {
        window.cancelAnimationFrame(hoverFrame);
        hoverFrame = null;
      }
      if (!touchSelectionActive) {
        setActivePoint(null);
        onHoverPointChange?.(null);
      }
    };
    const pointerOffset = (event: PointerEvent) => {
      const bounds = chartElement.getBoundingClientRect();
      return {
        offsetX: event.clientX - bounds.left,
        offsetY: event.clientY - bounds.top,
      };
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") {
        return;
      }
      if (touchPointerId !== null) {
        return;
      }
      touchPointerId = event.pointerId;
      touchSelectionActive = true;
      const offset = pointerOffset(event);
      if (offset) {
        updateHoverPoint(offset);
      }
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== touchPointerId) {
        return;
      }
      const offset = pointerOffset(event);
      if (offset) {
        updateHoverPoint(offset);
      }
    };
    const finishTouchPointer = (event: PointerEvent) => {
      if (event.pointerId === touchPointerId) {
        touchPointerId = null;
      }
    };
    chart.getZr().on("mousemove", handleMouseMove);
    chart.getZr().on("mouseout", handleMouseOut);
    chartElement.addEventListener("pointerdown", handlePointerDown);
    chartElement.addEventListener("pointermove", handlePointerMove);
    chartElement.addEventListener("pointerup", finishTouchPointer);
    chartElement.addEventListener("pointercancel", finishTouchPointer);

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartElement);

    return () => {
      if (hoverFrame !== null) {
        window.cancelAnimationFrame(hoverFrame);
      }
      chart.getZr().off("mousemove", handleMouseMove);
      chart.getZr().off("mouseout", handleMouseOut);
      chartElement.removeEventListener("pointerdown", handlePointerDown);
      chartElement.removeEventListener("pointermove", handlePointerMove);
      chartElement.removeEventListener("pointerup", finishTouchPointer);
      chartElement.removeEventListener("pointercancel", finishTouchPointer);
      resizeObserver.disconnect();
      chart.dispose();
      onHoverPointChange?.(null);
    };
  }, [
    chartData,
    elevationFloor,
    onHoverPointChange,
    profile,
    panelSize,
    surfaceSegments,
  ]);

  const statusLabel =
    status === "loading"
      ? "Wird berechnet"
      : status === "error"
        ? message
        : profile
          ? "Bereit"
          : "Keine Route";

  const panel = (
    <section
      className={`elevationPanel elevationPanel-${panelSize}`}
      aria-label="Höhenprofil"
    >
      <div className="panelHeader">
        <h2>Höhenprofil</h2>
        <span aria-live="polite">{statusLabel}</span>
      </div>

      {profile ? (
        <>
          {panelSize === "large" ? (
            <dl className="elevationStats">
              <div>
                <dt>Abstieg</dt>
                <dd>{formatElevationMeters(profile.descentMeters)}</dd>
              </div>
              <div>
                <dt>Höhe</dt>
                <dd>
                  {formatElevationMeters(profile.minElevationMeters)}-
                  {formatElevationMeters(profile.maxElevationMeters)}
                </dd>
              </div>
              <div>
                <dt>Max. Gradient</dt>
                <dd>{formatGradientPercent(profile.maxAbsGradientPercent)}</dd>
              </div>
            </dl>
          ) : null}
          <div className="elevationPanelControls" aria-label="Profilgrösse">
            <button
              type="button"
              aria-pressed={panelSize === "compact"}
              onClick={() => onSizeChange?.("compact")}
            >
              Klein
            </button>
            <button
              type="button"
              aria-pressed={panelSize === "large"}
              onClick={() => onSizeChange?.("large")}
            >
              Gross
            </button>
          </div>
          {panelSize === "large" && activePoint ? (
            <div className="elevationScrubReadout" aria-live="polite">
              <strong>{formatDistance(activePoint.distanceMeters)}</strong>
              <span>
                {formatElevationMeters(activePoint.smoothedElevationMeters)}
              </span>
              <span>{formatGradientPercent(activePoint.gradientPercent)}</span>
              <span>
                {surfaceSegmentAtDistance(
                  surfaceSegments,
                  activePoint.distanceMeters,
                )?.label ?? "Weg unbekannt"}
              </span>
            </div>
          ) : null}
          <div ref={chartRef} className="elevationChart" />
        </>
      ) : (
        <p className="panelEmpty">
          Zeichne mindestens zwei Wegpunkte, um Distanz, Höhe und Gradient zu
          berechnen.
        </p>
      )}
    </section>
  );

  if (panelSize === "large") {
    return (
      <>
        <section className="elevationPanel elevationPanel-compact elevationPanelDockControl">
          <div className="panelHeader">
            <h2>Höhenprofil</h2>
            <span aria-live="polite">{statusLabel}</span>
          </div>
          <div className="elevationPanelControls" aria-label="Profilgrösse">
            <button
              type="button"
              aria-pressed={false}
              onClick={() => onSizeChange?.("compact")}
            >
              Klein
            </button>
            <button type="button" aria-pressed={true}>
              Gross
            </button>
          </div>
        </section>
        {panel}
      </>
    );
  }

  return panel;
}

function createProfileBands(
  profile: ElevationProfile,
  elevationFloor: number,
): ProfileBandDatum[] {
  const routeEndKm = profile.distanceMeters / 1000;

  return profile.points.map((point, index) => {
    const distanceKm = point.distanceMeters / 1000;
    const previousDistanceKm =
      index > 0 ? profile.points[index - 1].distanceMeters / 1000 : distanceKm;
    const nextDistanceKm =
      index < profile.points.length - 1
        ? profile.points[index + 1].distanceMeters / 1000
        : distanceKm;

    const startKm =
      index === 0 ? 0 : distanceKm - (distanceKm - previousDistanceKm) / 2;
    const endKm =
      index === profile.points.length - 1
        ? routeEndKm
        : distanceKm + (nextDistanceKm - distanceKm) / 2;

    return [
      distanceKm,
      Math.max(0, startKm),
      Math.max(distanceKm, endKm),
      elevationFloor,
      interpolatedBandElevation(profile, index, "start"),
      interpolatedBandElevation(profile, index, "end"),
      point.gradientPercent,
    ];
  });
}

function interpolatedBandElevation(
  profile: ElevationProfile,
  index: number,
  side: "start" | "end",
): number {
  const point = profile.points[index];
  if (!point) {
    return 0;
  }

  if (side === "start") {
    const previousPoint = profile.points[index - 1];
    if (!previousPoint) {
      return point.smoothedElevationMeters;
    }
    return (
      (previousPoint.smoothedElevationMeters + point.smoothedElevationMeters) /
      2
    );
  }

  const nextPoint = profile.points[index + 1];
  if (!nextPoint) {
    return point.smoothedElevationMeters;
  }
  return (
    (point.smoothedElevationMeters + nextPoint.smoothedElevationMeters) / 2
  );
}

function createSurfaceBands(
  segments: ElevationSurfaceSegment[],
  routeDistanceMeters: number,
): SurfaceBandDatum[] {
  if (routeDistanceMeters <= 0) {
    return [];
  }

  return segments
    .map((segment): SurfaceBandDatum | null => {
      const startMeters = Math.max(0, segment.startDistanceMeters);
      const endMeters = Math.min(
        routeDistanceMeters,
        segment.endDistanceMeters,
      );
      if (endMeters <= startMeters) {
        return null;
      }
      const startKm = startMeters / 1000;
      const endKm = endMeters / 1000;
      return [
        (startKm + endKm) / 2,
        startKm,
        endKm,
        0.5,
        segment.color,
        segment.label,
      ];
    })
    .filter((segment): segment is SurfaceBandDatum => segment !== null);
}

function renderProfileBand(params: CustomRenderParams, api: CustomRenderApi) {
  if (!params.coordSys) {
    return null;
  }

  const startKm = Number(api.value(1));
  const endKm = Number(api.value(2));
  const baseMeters = Number(api.value(3));
  const startTopMeters = Number(api.value(4));
  const endTopMeters = Number(api.value(5));
  const gradientPercent = Number(api.value(6));
  const bottomLeft = api.coord([startKm, baseMeters]);
  const bottomRight = api.coord([endKm, baseMeters]);
  const topLeft = api.coord([startKm, startTopMeters]);
  const topRight = api.coord([endKm, endTopMeters]);
  const points = graphic.clipPointsByRect(
    [
      [bottomLeft[0] - 0.25, bottomLeft[1]],
      [topLeft[0] - 0.25, topLeft[1]],
      [topRight[0] + 0.25, topRight[1]],
      [bottomRight[0] + 0.25, bottomRight[1]],
    ],
    params.coordSys,
  );

  if (points.length < 3) {
    return null;
  }

  return {
    shape: { points },
    style: api.style({
      fill: gradientGroupForPercent(gradientPercent).color,
      opacity: 0.96,
      stroke: "transparent",
    }),
    type: "polygon",
  };
}

function renderSurfaceBand(params: CustomRenderParams, api: CustomRenderApi) {
  if (!params.coordSys) {
    return null;
  }

  const startKm = Number(api.value(1));
  const endKm = Number(api.value(2));
  const color = String(api.value(4));
  const startX = api.coord([startKm, 0.5])[0];
  const endX = api.coord([endKm, 0.5])[0];

  return {
    shape: {
      height: 7,
      width: Math.max(1, endX - startX + 0.75),
      x: startX,
      y: params.coordSys.y + params.coordSys.height + 26,
    },
    style: {
      fill: color,
      opacity: 0.72,
    },
    type: "rect",
  };
}

function nearestElevationPointIndex(
  profile: ElevationProfile,
  distanceMeters: number,
): number {
  return profile.points.reduce(
    (nearestIndex, point, index) =>
      Math.abs(point.distanceMeters - distanceMeters) <
      Math.abs(
        (profile.points[nearestIndex]?.distanceMeters ?? 0) - distanceMeters,
      )
        ? index
        : nearestIndex,
    0,
  );
}

function formatElevationTooltip(
  params: unknown,
  profile: ElevationProfile,
  surfaceSegments: ElevationSurfaceSegment[],
): string {
  const point = pointFromTooltipParams(params, profile);
  if (!point) {
    return "";
  }
  const surfaceSegment = surfaceSegmentAtDistance(
    surfaceSegments,
    point.distanceMeters,
  );
  return [
    `<strong>${formatDistance(point.distanceMeters)}</strong>`,
    `${formatElevationMeters(point.smoothedElevationMeters)}`,
    `${formatGradientPercent(point.gradientPercent)}`,
    surfaceSegment ? `Weg: ${surfaceSegment.label}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("<br />");
}

function surfaceSegmentAtDistance(
  segments: ElevationSurfaceSegment[],
  distanceMeters: number,
): ElevationSurfaceSegment | null {
  return (
    segments.find(
      (segment) =>
        distanceMeters >= segment.startDistanceMeters &&
        distanceMeters <= segment.endDistanceMeters,
    ) ?? null
  );
}

function pointFromTooltipParams(params: unknown, profile: ElevationProfile) {
  const firstParam = Array.isArray(params) ? params[0] : params;
  if (
    typeof firstParam === "object" &&
    firstParam !== null &&
    "dataIndex" in firstParam &&
    typeof firstParam.dataIndex === "number"
  ) {
    return profile.points[firstParam.dataIndex] ?? null;
  }
  return null;
}
