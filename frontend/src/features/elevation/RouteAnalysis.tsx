import { useState, type ReactNode } from "react";

import type { Climb, KilometreSplit } from "./elevationModel";
import {
  formatDurationMinutes,
  formatElevationMeters,
  formatGradientPercent,
} from "./elevationModel";

export type AnalysisTab = "profile" | "splits" | "climbs";
type AnalysisRange = {
  startDistanceMeters: number;
  endDistanceMeters: number;
};

interface RouteAnalysisProps {
  activeTab: AnalysisTab;
  splits: KilometreSplit[];
  climbs: Climb[];
  onTabChange: (tab: AnalysisTab) => void;
  onRangeChange: (range: AnalysisRange | null) => void;
  profileOverview?: ReactNode;
}

export function RouteAnalysis({
  activeTab,
  splits,
  climbs,
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
        {(["profile", "splits", "climbs"] as const).map((tab) => (
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
                : "Anstiege"}
          </button>
        ))}
      </div>
      {activeTab !== "profile" ? profileOverview : null}
      {activeTab === "splits" ? (
        <SplitList splits={splits} {...rangeInteractions} />
      ) : null}
      {activeTab === "climbs" ? (
        <ClimbList climbs={climbs} {...rangeInteractions} />
      ) : null}
    </section>
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
            <span>Aufwand</span>
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
