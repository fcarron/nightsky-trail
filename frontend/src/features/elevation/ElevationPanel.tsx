import { useEffect, useRef } from "react";

import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

import { formatDistance } from "../route/routeGeometry";
import type { ElevationProfile } from "./elevationModel";
import {
  GRADIENT_GROUPS,
  formatElevationMeters,
  formatGradientPercent,
} from "./elevationModel";

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface ElevationPanelProps {
  profile: ElevationProfile | null;
  status: "idle" | "loading" | "ready" | "error";
  message: string | null;
}

export function ElevationPanel({
  profile,
  status,
  message,
}: ElevationPanelProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current || !profile || profile.points.length === 0) {
      return;
    }

    const chart = echarts.init(chartRef.current);
    chart.setOption({
      animation: false,
      backgroundColor: "transparent",
      color: ["#4f8cff", "#ff5c7a"],
      grid: {
        left: 38,
        right: 20,
        top: 22,
        bottom: 30,
      },
      legend: {
        bottom: 0,
        itemWidth: 18,
        itemHeight: 8,
        textStyle: { color: "#8fa1ad", fontSize: 11 },
      },
      tooltip: {
        backgroundColor: "#101923",
        borderColor: "#334657",
        textStyle: { color: "#f4f8fb" },
        trigger: "axis",
        valueFormatter: (value: unknown) =>
          typeof value === "number" ? value.toFixed(1) : String(value),
      },
      xAxis: {
        axisLabel: {
          color: "#8fa1ad",
          formatter: (value: number) => `${value.toFixed(1)} km`,
        },
        axisLine: { lineStyle: { color: "#334657" } },
        splitLine: { lineStyle: { color: "#223140" } },
        type: "value",
      },
      yAxis: [
        {
          axisLabel: { color: "#8fa1ad" },
          axisLine: { lineStyle: { color: "#334657" } },
          name: "m",
          nameTextStyle: { color: "#8fa1ad" },
          scale: true,
          splitLine: { lineStyle: { color: "#223140" } },
          type: "value",
        },
        {
          axisLabel: { color: "#8fa1ad" },
          axisLine: { lineStyle: { color: "#334657" } },
          name: "%",
          nameTextStyle: { color: "#8fa1ad" },
          scale: true,
          splitLine: { show: false },
          type: "value",
        },
      ],
      series: [
        {
          data: profile.points.map((point) => [
            point.distanceMeters / 1000,
            point.smoothedElevationMeters,
          ]),
          lineStyle: { width: 2 },
          name: "Höhe",
          showSymbol: false,
          smooth: true,
          type: "line",
        },
        {
          data: profile.points.map((point) => [
            point.distanceMeters / 1000,
            point.gradientPercent,
          ]),
          lineStyle: { width: 1.5 },
          name: "Gradient",
          showSymbol: false,
          type: "line",
          yAxisIndex: 1,
        },
      ],
    });

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, [profile]);

  return (
    <section className="elevationPanel" aria-label="Höhenprofil">
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
          <div ref={chartRef} className="elevationChart" />
          <div className="gradientStrip" aria-label="Steigungsklassen">
            {profile.gradientBands.map((band) => (
              <span
                key={`${band.startDistanceMeters}-${band.endDistanceMeters}`}
                style={{
                  backgroundColor: band.group.color,
                  flexGrow: Math.max(
                    1,
                    band.endDistanceMeters - band.startDistanceMeters,
                  ),
                }}
                title={`${formatDistance(band.startDistanceMeters)}-${formatDistance(
                  band.endDistanceMeters,
                )}: ${formatGradientPercent(band.gradientPercent)}`}
              />
            ))}
          </div>
          <ol className="gradientLegend" aria-label="Steigungslegende">
            {GRADIENT_GROUPS.map((group) => (
              <li key={group.id}>
                <span
                  className="gradientSwatch"
                  style={{ backgroundColor: group.color }}
                  aria-hidden="true"
                />
                {group.label}
              </li>
            ))}
          </ol>
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
