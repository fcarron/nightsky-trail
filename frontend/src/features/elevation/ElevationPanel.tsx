import { useEffect, useMemo, useRef, useState } from "react";

import { BarChart, LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

import { formatDistance } from "../route/routeGeometry";
import type { ElevationProfile } from "./elevationModel";
import {
  formatElevationMeters,
  formatDurationMinutes,
  formatGradientPercent,
  gradientGroupForPercent,
} from "./elevationModel";

echarts.use([
  BarChart,
  LineChart,
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
  CanvasRenderer,
]);

type ElevationPanelSize = "compact" | "large";

interface ElevationHoverPoint {
  lon: number;
  lat: number;
}

interface ElevationPanelProps {
  profile: ElevationProfile | null;
  status: "idle" | "loading" | "ready" | "error";
  message: string | null;
  onHoverPointChange?: (point: ElevationHoverPoint | null) => void;
}

export function ElevationPanel({
  profile,
  status,
  message,
  onHoverPointChange,
}: ElevationPanelProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [panelSize, setPanelSize] = useState<ElevationPanelSize>("compact");
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
      base: profile.points.map((point) => [
        point.distanceMeters / 1000,
        elevationFloor,
      ]),
      gradient: profile.points.map((point) => [
        point.distanceMeters / 1000,
        point.smoothedElevationMeters - elevationFloor,
      ]),
      line: profile.points.map((point) => [
        point.distanceMeters / 1000,
        point.smoothedElevationMeters,
      ]),
    };
  }, [elevationFloor, profile]);

  useEffect(() => {
    if (!chartRef.current || !profile || !chartData || profile.points.length === 0) {
      onHoverPointChange?.(null);
      return;
    }

    const chart = echarts.init(chartRef.current);
    let hoverFrame: number | null = null;
    let pendingHoverEvent: { offsetX: number; offsetY: number } | null = null;
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
        top: 18,
        bottom: 42,
      },
      tooltip: {
        backgroundColor: "#101923",
        borderColor: "#334657",
        borderWidth: 1,
        confine: true,
        formatter: (params: unknown) => formatElevationTooltip(params, profile),
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
          height: 16,
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
        },
        axisLine: { lineStyle: { color: "#334657" } },
        splitLine: { lineStyle: { color: "rgba(143, 161, 173, 0.14)" } },
        type: "value",
      },
      yAxis: {
        axisLabel: {
          color: "#8fa1ad",
          formatter: (value: number) => `${Math.round(value)} m`,
        },
        axisLine: { lineStyle: { color: "#334657" } },
        max: Math.ceil((profile.maxElevationMeters + elevationRange * 0.08) / 20) * 20,
        min: elevationFloor,
        splitLine: { lineStyle: { color: "rgba(143, 161, 173, 0.16)" } },
        type: "value",
      },
      series: [
        {
          data: chartData.base,
          itemStyle: { color: "rgba(0, 0, 0, 0)" },
          large: true,
          name: "Basis",
          stack: "profile",
          type: "bar",
          tooltip: { show: false },
        },
        {
          data: chartData.gradient,
          barCategoryGap: "0%",
          barGap: "0%",
          barMinWidth: 1,
          barWidth: gradientBarWidth(profile),
          barMaxWidth: gradientBarWidth(profile),
          coordinateSystem: "cartesian2d",
          encode: { x: 0, y: 1 },
          itemStyle: {
            color: (params: { dataIndex: number }) =>
              gradientGroupForPercent(
                profile.points[params.dataIndex]?.gradientPercent ?? 0,
              ).color,
            opacity: 0.94,
          },
          name: "Steigung",
          showBackground: false,
          stack: "profile",
          type: "bar",
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
        },
      ],
    });

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

    const updateHoverPoint = (event: { offsetX: number; offsetY: number }) => {
      if (!chart.containPixel({ gridIndex: 0 }, [event.offsetX, event.offsetY])) {
        onHoverPointChange?.(null);
        return;
      }
      const value = chart.convertFromPixel({ gridIndex: 0 }, [
        event.offsetX,
        event.offsetY,
      ]);
      if (!Array.isArray(value) || typeof value[0] !== "number") {
        onHoverPointChange?.(null);
        return;
      }
      const point = nearestElevationPoint(profile, value[0] * 1000);
      onHoverPointChange?.({
        lon: point.longitude,
        lat: point.latitude,
      });
    };
    const handleMouseOut = () => {
      pendingHoverEvent = null;
      if (hoverFrame !== null) {
        window.cancelAnimationFrame(hoverFrame);
        hoverFrame = null;
      }
      onHoverPointChange?.(null);
    };
    chart.getZr().on("mousemove", handleMouseMove);
    chart.getZr().on("mouseout", handleMouseOut);

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartRef.current);

    return () => {
      if (hoverFrame !== null) {
        window.cancelAnimationFrame(hoverFrame);
      }
      chart.getZr().off("mousemove", handleMouseMove);
      chart.getZr().off("mouseout", handleMouseOut);
      resizeObserver.disconnect();
      chart.dispose();
      onHoverPointChange?.(null);
    };
  }, [chartData, elevationFloor, onHoverPointChange, profile, panelSize]);

  return (
    <section
      className={`elevationPanel elevationPanel-${panelSize}`}
      aria-label="Höhenprofil"
    >
      <div className="panelHeader">
        <h2>Höhenprofil</h2>
        <span aria-live="polite">
          {status === "loading"
            ? "Wird berechnet"
            : status === "error"
              ? message
              : profile
                ? "Bereit"
                : "Keine Route"}
        </span>
      </div>

      {profile ? (
        <>
          <dl className="elevationStats">
            <div>
              <dt>Distanz</dt>
              <dd>{formatDistance(profile.distanceMeters)}</dd>
            </div>
            <div>
              <dt>Aufstieg</dt>
              <dd>{formatElevationMeters(profile.ascentMeters)}</dd>
            </div>
            <div>
              <dt>Abstieg</dt>
              <dd>{formatElevationMeters(profile.descentMeters)}</dd>
            </div>
            <div>
              <dt>Wanderzeit</dt>
              <dd>{formatDurationMinutes(profile.hikingTime.durationMinutes)}</dd>
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
          <div className="elevationPanelControls" aria-label="Profilgrösse">
            <button
              type="button"
              aria-pressed={panelSize === "compact"}
              onClick={() => setPanelSize("compact")}
            >
              Klein
            </button>
            <button
              type="button"
              aria-pressed={panelSize === "large"}
              onClick={() => setPanelSize("large")}
            >
              Gross
            </button>
          </div>
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
}

function gradientBarWidth(profile: ElevationProfile): number {
  if (profile.points.length < 2) {
    return 2;
  }
  return Math.max(2.8, Math.min(12, 840 / profile.points.length));
}

function nearestElevationPoint(
  profile: ElevationProfile,
  distanceMeters: number,
) {
  return profile.points.reduce((nearest, point) =>
    Math.abs(point.distanceMeters - distanceMeters) <
    Math.abs(nearest.distanceMeters - distanceMeters)
      ? point
      : nearest,
  );
}

function formatElevationTooltip(
  params: unknown,
  profile: ElevationProfile,
): string {
  const point = pointFromTooltipParams(params, profile);
  if (!point) {
    return "";
  }
  return [
    `<strong>${formatDistance(point.distanceMeters)}</strong>`,
    `${formatElevationMeters(point.smoothedElevationMeters)}`,
    `${formatGradientPercent(point.gradientPercent)}`,
  ].join("<br />");
}

function pointFromTooltipParams(
  params: unknown,
  profile: ElevationProfile,
) {
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
