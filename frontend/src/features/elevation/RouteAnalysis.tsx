import { useState, type CSSProperties, type ReactNode } from "react";

import type {
  Climb,
  GradientDistributionBin,
  KilometreSplit,
  SustainedGradient,
} from "./elevationModel";
import {
  GRADIENT_DISTRIBUTION_BIN_WIDTH_PERCENT,
  GRADIENT_DISTRIBUTION_LIMIT_PERCENT,
  formatDurationMinutes,
  formatElevationMeters,
  formatGradientPercent,
} from "./elevationModel";

export type AnalysisTab = "profile" | "splits" | "climbs" | "gradient";
type AnalysisRange = {
  startDistanceMeters: number;
  endDistanceMeters: number;
};

interface RouteAnalysisProps {
  activeTab: AnalysisTab;
  splits: KilometreSplit[];
  climbs: Climb[];
  gradientDistribution: GradientDistributionBin[];
  sustainedGradients: SustainedGradient[];
  onTabChange: (tab: AnalysisTab) => void;
  onRangeChange: (range: AnalysisRange | null) => void;
  profileOverview?: ReactNode;
}

export function RouteAnalysis({
  activeTab,
  splits,
  climbs,
  gradientDistribution,
  sustainedGradients,
  onTabChange,
  onRangeChange,
  profileOverview,
}: RouteAnalysisProps) {
  const [selectedRange, setSelectedRange] = useState<AnalysisRange | null>(
    null,
  );
  const selectRange = (range: AnalysisRange) => {
    const nextRange = rangesEqual(selectedRange, range) ? null : range;
    setSelectedRange(nextRange);
    onRangeChange(nextRange);
  };
  const rangeInteractions = {
    onRangeEnter: onRangeChange,
    onRangeLeave: () => onRangeChange(selectedRange),
    onRangeSelect: selectRange,
    selectedRange,
  };

  return (
    <section
      className={`routeAnalysis routeAnalysis-${activeTab}`}
      aria-label="Routenanalyse"
    >
      <div
        className="analysisTabs"
        role="tablist"
        aria-label="Routenanalyse anzeigen"
      >
        {(["profile", "splits", "climbs", "gradient"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => onTabChange(tab)}
          >
            {tab === "profile"
              ? "Profil"
              : tab === "splits"
                ? "Km splits"
                : tab === "climbs"
                  ? "Anstiege"
                  : "Gradient"}
          </button>
        ))}
      </div>
      {activeTab === "splits" || activeTab === "climbs"
        ? profileOverview
        : null}
      {activeTab === "splits" ? (
        <SplitList splits={splits} {...rangeInteractions} />
      ) : null}
      {activeTab === "climbs" ? (
        <ClimbList climbs={climbs} {...rangeInteractions} />
      ) : null}
      {activeTab === "gradient" ? (
        <GradientAnalysis
          distribution={gradientDistribution}
          sustainedGradients={sustainedGradients}
          {...rangeInteractions}
        />
      ) : null}
    </section>
  );
}

function GradientAnalysis({
  distribution,
  sustainedGradients,
  ...interactions
}: Pick<RouteAnalysisProps, "sustainedGradients"> & {
  distribution: GradientDistributionBin[];
} & RangeInteractions) {
  const [activeBin, setActiveBin] = useState<GradientDistributionBin | null>(
    null,
  );
  const totalDistanceMeters = distribution.reduce(
    (total, bin) => total + bin.distanceMeters,
    0,
  );
  const maxDistanceMeters = Math.max(
    1,
    ...distribution.map((bin) => bin.distanceMeters),
  );
  const yAxisMaximumPercentage = histogramAxisMaximum(
    (maxDistanceMeters / Math.max(totalDistanceMeters, 1)) * 100,
  );

  return (
    <section className="gradientAnalysis" aria-label="Gradient-Verteilung">
      <div className="gradientHistogramHeader">
        <span>Gefälle</span>
        <strong>Streckenanteil</strong>
        <span>Steigung</span>
      </div>
      <div className="gradientHistogramFrame">
        <div className="gradientHistogramYAxis" aria-hidden="true">
          <span>{formatHistogramPercentage(yAxisMaximumPercentage)}</span>
          <span>{formatHistogramPercentage(yAxisMaximumPercentage / 2)}</span>
          <span>0 %</span>
        </div>
        <div className="gradientHistogram" role="list">
          {distribution.map((bin) => {
            const percentage =
              totalDistanceMeters > 0
                ? (bin.distanceMeters / totalDistanceMeters) * 100
                : 0;
            return (
              <button
                key={bin.label}
                type="button"
                role="listitem"
                className={
                  bin === activeBin
                    ? "gradientHistogramBin is-active"
                    : "gradientHistogramBin"
                }
                aria-label={`${bin.label}: ${formatGradientDistance(bin.distanceMeters)}, ${percentage.toFixed(1)} Prozent der Route`}
                onBlur={() => setActiveBin(null)}
                onFocus={() => setActiveBin(bin)}
                onMouseEnter={() => setActiveBin(bin)}
                onMouseLeave={() => setActiveBin(null)}
                style={
                  {
                    "--gradient-bar-height": `${Math.max(
                      bin.distanceMeters > 0 ? 2 : 0,
                      (percentage / yAxisMaximumPercentage) * 100,
                    )}%`,
                  } as CSSProperties
                }
              >
                <span className="gradientHistogramBar" aria-hidden="true" />
                <span className="gradientBarTooltip" aria-hidden="true">
                  <strong>{bin.label}</strong>
                  <span>{formatGradientDistance(bin.distanceMeters)}</span>
                  <span>{percentage.toFixed(1)} %</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="gradientHistogramAxis" aria-hidden="true">
        {GRADIENT_AXIS_TICKS.map((value) => (
          <span
            key={value}
            style={
              {
                "--gradient-axis-position": `${gradientAxisPosition(value)}%`,
              } as CSSProperties
            }
          >
            {formatGradientAxisTick(value)}
          </span>
        ))}
      </div>
      <p className="gradientHistogramUnit" aria-hidden="true">
        Gradient (%)
      </p>
      <div className="sustainedGradientSummary">
        <div className="sustainedGradientTitle">
          <h3>Steilste Passagen</h3>
          <small>Durchschnitt über feste Distanz</small>
        </div>
        <div className="sustainedGradientHeader" aria-hidden="true">
          <span>Distanz</span>
          <span>Bergauf</span>
          <span>Bergab</span>
        </div>
        {sustainedGradients.map((gradient) => (
          <div className="sustainedGradientRow" key={gradient.windowMeters}>
            <strong>{formatGradientWindow(gradient.windowMeters)}</strong>
            <SustainedGradientValue
              direction="Bergauf"
              gradientPercent={gradient.uphillGradientPercent}
              range={gradient.uphillRange}
              windowMeters={gradient.windowMeters}
              {...interactions}
            />
            <SustainedGradientValue
              direction="Bergab"
              gradientPercent={gradient.downhillGradientPercent}
              range={gradient.downhillRange}
              windowMeters={gradient.windowMeters}
              {...interactions}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function SustainedGradientValue({
  direction,
  gradientPercent,
  range,
  windowMeters,
  ...interactions
}: {
  direction: "Bergauf" | "Bergab";
  gradientPercent: number | null;
  range: AnalysisRange | null;
  windowMeters: number;
} & RangeInteractions) {
  const isAvailable = gradientPercent !== null && range !== null;
  const startKilometer = range
    ? formatRouteKilometer(range.startDistanceMeters)
    : null;

  return (
    <button
      type="button"
      className="sustainedGradientValue"
      disabled={!isAvailable}
      aria-label={
        isAvailable
          ? `Steilste ${direction}-Passage über ${formatGradientWindow(windowMeters)}: ${formatSustainedGradient(gradientPercent)}, ab Kilometer ${startKilometer}`
          : `Keine ${direction}-Passage über ${formatGradientWindow(windowMeters)}`
      }
      aria-pressed={
        range ? rangesEqual(interactions.selectedRange, range) : false
      }
      onMouseEnter={() => range && interactions.onRangeEnter(range)}
      onFocus={() => range && interactions.onRangeEnter(range)}
      onMouseLeave={interactions.onRangeLeave}
      onBlur={interactions.onRangeLeave}
      onClick={() => range && interactions.onRangeSelect(range)}
    >
      <strong>{formatSustainedGradient(gradientPercent)}</strong>
      {startKilometer ? <small>ab km {startKilometer}</small> : null}
    </button>
  );
}

function SplitList({
  splits,
  ...interactions
}: Pick<RouteAnalysisProps, "splits"> & RangeInteractions) {
  return (
    <div className="analysisList splitList">
      <div className="analysisTableHeader" aria-hidden="true">
        <span>Abschnitt</span>
        <span>Auf</span>
        <span>Ab</span>
        <span>Ø Gradient</span>
        <span>Max. auf</span>
        <span>Zeit</span>
      </div>
      {splits.map((split) => (
        <button
          key={split.index}
          type="button"
          className="analysisRow"
          aria-pressed={rangesEqual(interactions.selectedRange, split)}
          onMouseEnter={() => interactions.onRangeEnter(split)}
          onFocus={() => interactions.onRangeEnter(split)}
          onMouseLeave={interactions.onRangeLeave}
          onBlur={interactions.onRangeLeave}
          onClick={() => interactions.onRangeSelect(split)}
        >
          <strong>KM {split.index}</strong>
          <span>+{Math.round(split.ascentMeters)} m</span>
          <span>-{Math.round(split.descentMeters)} m</span>
          <span>Ø {formatGradientPercent(split.netGradientPercent)}</span>
          <span>
            max +{formatGradientPercent(split.maxUphillGradientPercent)}
          </span>
          <span>
            {formatDurationMinutes(split.runningMinutes ?? split.hikingMinutes)}
          </span>
        </button>
      ))}
    </div>
  );
}

function ClimbList({
  climbs,
  ...interactions
}: Pick<RouteAnalysisProps, "climbs"> & RangeInteractions) {
  return (
    <div className="analysisList">
      {climbs.length ? (
        <>
          <div className="analysisTableHeader" aria-hidden="true">
            <span>Anstieg</span>
            <span>Distanz</span>
            <span>Auf</span>
            <span>Ø Gradient</span>
            <span>Score</span>
            <span>Zeit</span>
          </div>
          {climbs.map((climb) => (
            <button
              key={climb.index}
              type="button"
              className="analysisRow climbRow"
              aria-pressed={rangesEqual(interactions.selectedRange, climb)}
              onMouseEnter={() => interactions.onRangeEnter(climb)}
              onFocus={() => interactions.onRangeEnter(climb)}
              onMouseLeave={interactions.onRangeLeave}
              onBlur={interactions.onRangeLeave}
              onClick={() => interactions.onRangeSelect(climb)}
            >
              <span className="climbLabel">
                <strong
                  className="climbEffort"
                  title="Körperlicher Aufwand des Anstiegs, keine technische Schwierigkeit"
                >
                  {climb.category}
                </strong>
                <span>Anstieg {climb.index}</span>
              </span>
              <span>
                {(
                  (climb.endDistanceMeters - climb.startDistanceMeters) /
                  1000
                ).toFixed(1)}{" "}
                km
              </span>
              <span>+{formatElevationMeters(climb.elevationGainMeters)}</span>
              <span>
                Ø {formatGradientPercent(climb.averageGradientPercent)}
              </span>
              <span
                className="climbScore"
                title="Zusätzliche Wanderzeit gegenüber derselben Distanz flach"
              >
                <strong>{climb.score.toFixed(1)}</strong>
                <small>+{Math.round(climb.timePenaltyMinutes)} min</small>
              </span>
              <span>
                {formatDurationMinutes(
                  climb.runningMinutes ?? climb.hikingMinutes,
                )}
              </span>
            </button>
          ))}
        </>
      ) : (
        <p className="panelEmpty">
          Keine markanten Anstiege nach den aktuellen Schwellenwerten.
        </p>
      )}
    </div>
  );
}

interface RangeInteractions {
  selectedRange: AnalysisRange | null;
  onRangeEnter: (range: AnalysisRange) => void;
  onRangeLeave: () => void;
  onRangeSelect: (range: AnalysisRange) => void;
}

function rangesEqual(first: AnalysisRange | null, second: AnalysisRange) {
  return (
    first?.startDistanceMeters === second.startDistanceMeters &&
    first.endDistanceMeters === second.endDistanceMeters
  );
}

function formatGradientDistance(distanceMeters: number): string {
  return distanceMeters >= 1_000
    ? `${(distanceMeters / 1_000).toFixed(2)} km`
    : `${Math.round(distanceMeters)} m`;
}

function formatGradientWindow(windowMeters: number): string {
  return windowMeters >= 1_000 ? "1 km" : `${windowMeters} m`;
}

function formatSustainedGradient(gradientPercent: number | null): string {
  return gradientPercent === null
    ? "-"
    : `${gradientPercent > 0 ? "+" : ""}${formatGradientPercent(gradientPercent)}`;
}

function formatRouteKilometer(distanceMeters: number): string {
  return (distanceMeters / 1_000).toLocaleString("de-CH", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function histogramAxisMaximum(maximumPercentage: number): number {
  if (maximumPercentage <= 10) return 10;
  if (maximumPercentage <= 20) return 20;
  if (maximumPercentage <= 40) return 40;
  if (maximumPercentage <= 60) return 60;
  return 100;
}

function formatHistogramPercentage(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} %`;
}

const GRADIENT_AXIS_TICKS = [-30, -20, -10, 0, 10, 20, 30] as const;

function gradientAxisPosition(gradientPercent: number): number {
  const regularBinCount =
    (GRADIENT_DISTRIBUTION_LIMIT_PERCENT * 2) /
    GRADIENT_DISTRIBUTION_BIN_WIDTH_PERCENT;
  return (
    (((gradientPercent + GRADIENT_DISTRIBUTION_LIMIT_PERCENT) /
      GRADIENT_DISTRIBUTION_BIN_WIDTH_PERCENT +
      1) /
      (regularBinCount + 2)) *
    100
  );
}

function formatGradientAxisTick(value: number): string {
  return `${value > 0 ? "+" : ""}${value} %`;
}
