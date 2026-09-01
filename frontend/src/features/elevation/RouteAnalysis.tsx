import type { Climb, KilometreSplit } from "./elevationModel";
import {
  formatDurationMinutes,
  formatElevationMeters,
  formatGradientPercent,
} from "./elevationModel";

export type AnalysisTab = "profile" | "splits" | "climbs";

interface RouteAnalysisProps {
  activeTab: AnalysisTab;
  splits: KilometreSplit[];
  climbs: Climb[];
  onTabChange: (tab: AnalysisTab) => void;
  onRangeChange: (
    range: { startDistanceMeters: number; endDistanceMeters: number } | null,
  ) => void;
}

export function RouteAnalysis({
  activeTab,
  splits,
  climbs,
  onTabChange,
  onRangeChange,
}: RouteAnalysisProps) {
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
      {activeTab === "splits" ? (
        <SplitList splits={splits} onRangeChange={onRangeChange} />
      ) : null}
      {activeTab === "climbs" ? (
        <ClimbList climbs={climbs} onRangeChange={onRangeChange} />
      ) : null}
    </section>
  );
}

function SplitList({
  splits,
  onRangeChange,
}: Pick<RouteAnalysisProps, "splits" | "onRangeChange">) {
  return (
    <div className="analysisList splitList">
      {splits.map((split) => (
        <button
          key={split.index}
          type="button"
          className="analysisRow"
          onMouseEnter={() => onRangeChange(split)}
          onFocus={() => onRangeChange(split)}
          onMouseLeave={() => onRangeChange(null)}
          onBlur={() => onRangeChange(null)}
          onClick={() => onRangeChange(split)}
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
  onRangeChange,
}: Pick<RouteAnalysisProps, "climbs" | "onRangeChange">) {
  return (
    <div className="analysisList">
      {climbs.length ? (
        climbs.map((climb) => (
          <button
            key={climb.index}
            type="button"
            className="analysisRow climbRow"
            onMouseEnter={() => onRangeChange(climb)}
            onFocus={() => onRangeChange(climb)}
            onMouseLeave={() => onRangeChange(null)}
            onBlur={() => onRangeChange(null)}
            onClick={() => onRangeChange(climb)}
          >
            <strong>Anstieg {climb.index}</strong>
            <span>
              {(
                (climb.endDistanceMeters - climb.startDistanceMeters) /
                1000
              ).toFixed(1)}{" "}
              km
            </span>
            <span>+{formatElevationMeters(climb.elevationGainMeters)}</span>
            <span>Ø {formatGradientPercent(climb.averageGradientPercent)}</span>
            <span>Score {climb.score.toFixed(1)}</span>
            <span>
              {formatDurationMinutes(
                climb.runningMinutes ?? climb.hikingMinutes,
              )}
            </span>
          </button>
        ))
      ) : (
        <p className="panelEmpty">
          Keine markanten Anstiege nach den aktuellen Schwellenwerten.
        </p>
      )}
    </div>
  );
}
