import { useState, type CSSProperties, type ReactNode } from "react";

import { useI18n, type Locale } from "../../app/i18n";
import { formatDistance } from "../route/routeGeometry";

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

export type AnalysisTab =
  "profile" | "splits" | "climbs" | "gradient" | "route";
export interface RouteBreakdownItem {
  color: string;
  distanceMeters: number;
  id: string;
  label: string;
}
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
  routeDistanceMeters?: number;
  surfaceBreakdown?: RouteBreakdownItem[];
  difficultyBreakdown?: RouteBreakdownItem[];
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
  routeDistanceMeters = 0,
  surfaceBreakdown = [],
  difficultyBreakdown = [],
  onTabChange,
  onRangeChange,
  profileOverview,
}: RouteAnalysisProps) {
  const { t } = useI18n();
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
      aria-label={t("routeAnalysis")}
    >
      <div
        className="analysisTabs"
        role="tablist"
        aria-label={t("showRouteAnalysis")}
      >
        {(["profile", "splits", "climbs", "gradient", "route"] as const).map(
          (tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => onTabChange(tab)}
            >
              {tab === "profile"
                ? t("profile")
                : tab === "splits"
                  ? t("kilometreSplits")
                  : tab === "climbs"
                    ? t("climbs")
                    : tab === "gradient"
                      ? t("gradient")
                      : t("surface")}
            </button>
          ),
        )}
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
      {activeTab === "route" ? (
        <RouteDetailsAnalysis
          difficultyBreakdown={difficultyBreakdown}
          routeDistanceMeters={routeDistanceMeters}
          surfaceBreakdown={surfaceBreakdown}
        />
      ) : null}
    </section>
  );
}

function RouteDetailsAnalysis({
  difficultyBreakdown,
  routeDistanceMeters,
  surfaceBreakdown,
}: {
  difficultyBreakdown: RouteBreakdownItem[];
  routeDistanceMeters: number;
  surfaceBreakdown: RouteBreakdownItem[];
}) {
  const { t, tx } = useI18n();
  return (
    <section className="routeDetailsAnalysis" aria-label={tx("Wegdetails")}>
      <p>{tx("Anteile beziehen sich auf die gesamte Route.")}</p>
      <RouteBreakdown
        emptyMessage={tx(
          "Für diese Route liegen keine OSM-Oberflächenangaben vor.",
        )}
        items={surfaceBreakdown}
        routeDistanceMeters={routeDistanceMeters}
        title={t("surface")}
      />
      <RouteBreakdown
        emptyMessage={tx(
          "Für diese Route liegen keine OSM-Schwierigkeitsangaben vor.",
        )}
        items={
          difficultyBreakdown.some((item) => !isUnknownDifficulty(item))
            ? difficultyBreakdown
            : []
        }
        routeDistanceMeters={routeDistanceMeters}
        title={t("difficulty")}
      />
      <small>
        {tx(
          "Technische Schwierigkeit stammt aus OSM und ist unabhängig von der körperlichen Anstiegsbewertung. Unbekannt bedeutet: keine nutzbare OSM-Angabe.",
        )}
      </small>
    </section>
  );
}

function RouteBreakdown({
  emptyMessage,
  items,
  routeDistanceMeters,
  title,
}: {
  emptyMessage: string;
  items: RouteBreakdownItem[];
  routeDistanceMeters: number;
  title: string;
}) {
  if (!items.length) {
    return (
      <section className="routeBreakdown">
        <h3>{title}</h3>
        <p>{emptyMessage}</p>
      </section>
    );
  }

  const shares = routeShares(items, routeDistanceMeters);

  return (
    <section className="routeBreakdown">
      <h3>{title}</h3>
      <div className="routeBreakdownBar" aria-hidden="true">
        {items.map((item) => (
          <span
            key={item.id}
            style={{
              backgroundColor: item.color,
              flexGrow: Math.max(1, item.distanceMeters),
            }}
          />
        ))}
      </div>
      <dl>
        {items.map((item) => {
          const percentage = shares.get(item.id) ?? "0 %";
          return (
            <div key={item.id}>
              <dt>
                <span style={{ backgroundColor: item.color }} />
                {item.label}
              </dt>
              <dd>
                {percentage} · {formatDistance(item.distanceMeters)}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function isUnknownDifficulty(item: RouteBreakdownItem): boolean {
  return item.id === "?" || item.id === "unknown" || item.label === "?";
}

function routeShares(
  items: RouteBreakdownItem[],
  routeDistanceMeters: number,
): Map<string, string> {
  if (routeDistanceMeters <= 0) {
    return new Map(items.map((item) => [item.id, "0 %"]));
  }

  const exactShares = items.map(
    (item) => (item.distanceMeters / routeDistanceMeters) * 100,
  );
  const roundedShares = exactShares.map(Math.floor);
  const targetTotal = Math.round(
    exactShares.reduce((total, share) => total + share, 0),
  );
  let remainder =
    targetTotal - roundedShares.reduce((total, share) => total + share, 0);

  [...exactShares.keys()]
    .sort((left, right) => {
      const fractionDifference =
        exactShares[right] -
        Math.floor(exactShares[right]) -
        (exactShares[left] - Math.floor(exactShares[left]));
      return fractionDifference || left - right;
    })
    .forEach((index) => {
      if (remainder <= 0) return;
      roundedShares[index] += 1;
      remainder -= 1;
    });

  return new Map(
    items.map((item, index) => [item.id, `${roundedShares[index]} %`]),
  );
}

function GradientAnalysis({
  distribution,
  sustainedGradients,
  ...interactions
}: Pick<RouteAnalysisProps, "sustainedGradients"> & {
  distribution: GradientDistributionBin[];
} & RangeInteractions) {
  const { t } = useI18n();
  const [activeBin, setActiveBin] = useState<GradientDistributionBin | null>(
    null,
  );
  const [selectedBinLabels, setSelectedBinLabels] = useState<string[]>([]);
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
  const selectedBins = distribution.filter((bin) =>
    selectedBinLabels.includes(bin.label),
  );
  const selectedTotals = selectedBins.reduce(
    (totals, bin) => ({
      ascentMeters: totals.ascentMeters + bin.ascentMeters,
      descentMeters: totals.descentMeters + bin.descentMeters,
      distanceMeters: totals.distanceMeters + bin.distanceMeters,
    }),
    { ascentMeters: 0, descentMeters: 0, distanceMeters: 0 },
  );
  const toggleBin = (label: string) => {
    setSelectedBinLabels((current) =>
      current.includes(label)
        ? current.filter((selectedLabel) => selectedLabel !== label)
        : [...current, label],
    );
  };

  return (
    <section
      className="gradientAnalysis"
      aria-label={t("gradientDistribution")}
    >
      <div className="gradientHistogramHeader">
        <span>{t("downhill")}</span>
        <strong>{t("shareOfRoute")}</strong>
        <span>{t("uphill")}</span>
      </div>
      <div className="gradientHistogramFrame">
        <div className="gradientHistogramYAxis" aria-hidden="true">
          <span>{formatHistogramPercentage(yAxisMaximumPercentage)}</span>
          <span>{formatHistogramPercentage(yAxisMaximumPercentage / 2)}</span>
          <span>0 %</span>
        </div>
        <div
          className="gradientHistogram"
          role="group"
          aria-label={t("selectGradientRanges")}
        >
          {distribution.map((bin) => {
            const percentage =
              totalDistanceMeters > 0
                ? (bin.distanceMeters / totalDistanceMeters) * 100
                : 0;
            return (
              <button
                key={bin.label}
                type="button"
                className={gradientBinClassName(
                  bin === activeBin,
                  selectedBinLabels.includes(bin.label),
                  selectedBinLabels.length > 0,
                )}
                aria-label={`${bin.label}: ${formatGradientDistance(bin.distanceMeters)}, ${percentage.toFixed(1)} Prozent der Route, ${formatBinElevation(bin)}`}
                aria-pressed={selectedBinLabels.includes(bin.label)}
                onBlur={() => setActiveBin(null)}
                onFocus={() => setActiveBin(bin)}
                onMouseEnter={() => setActiveBin(bin)}
                onMouseLeave={() => setActiveBin(null)}
                onClick={() => toggleBin(bin.label)}
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
                  <span>{formatBinElevation(bin)}</span>
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
        {t("gradientPercent")}
      </p>
      {selectedBins.length > 0 ? (
        <section
          className="gradientSelectionSummary"
          aria-label={t("selectedGradientAreas")}
        >
          <div className="gradientSelectionHeading">
            <strong>
              {t("selectedGradientAreas")} ·{" "}
              {formatSelectedBinCount(selectedBins.length)}
            </strong>
            <button type="button" onClick={() => setSelectedBinLabels([])}>
              {t("reset")}
            </button>
          </div>
          <dl>
            <div>
              <dt>{t("distance")}</dt>
              <dd>{formatGradientDistance(selectedTotals.distanceMeters)}</dd>
            </div>
            <div>
              <dt>{t("shareOfRoute")}</dt>
              <dd>
                {formatSelectionPercentage(
                  selectedTotals.distanceMeters,
                  totalDistanceMeters,
                )}
              </dd>
            </div>
            <div>
              <dt>{t("elevationMeters")}</dt>
              <dd>
                +{Math.round(selectedTotals.ascentMeters)} m · -
                {Math.round(selectedTotals.descentMeters)} m
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
      <div className="sustainedGradientSummary">
        <div className="sustainedGradientTitle">
          <h3>{t("steepestPassages")}</h3>
          <small>{t("averageOverDistance")}</small>
        </div>
        <div className="sustainedGradientHeader" aria-hidden="true">
          <span>{t("distance")}</span>
          <span>{t("uphill")}</span>
          <span>{t("downhill")}</span>
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
  const { locale, t, tx } = useI18n();
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
          ? formatSustainedGradientAria(
              locale,
              tx(direction),
              formatGradientWindow(windowMeters),
              formatSustainedGradient(gradientPercent),
              startKilometer ?? "",
            )
          : `${t("noSteepPassage")} ${tx(direction)} ${formatGradientWindow(windowMeters)}`
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
      {startKilometer ? (
        <small>
          {t("fromKm")} {startKilometer}
        </small>
      ) : null}
    </button>
  );
}

function SplitList({
  splits,
  ...interactions
}: Pick<RouteAnalysisProps, "splits"> & RangeInteractions) {
  const { t } = useI18n();
  return (
    <div className="analysisList splitList">
      <div className="analysisTableHeader" aria-hidden="true">
        <span>{t("section")}</span>
        <span>{t("up")}</span>
        <span>{t("down")}</span>
        <span>Ø {t("gradient")}</span>
        <span>{t("maxUp")}</span>
        <span>{t("time")}</span>
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
  const { t, tx } = useI18n();
  return (
    <div className="analysisList">
      <p className="analysisMeaningHint">{t("climbEffortHint")}</p>
      {climbs.length ? (
        <>
          <div className="analysisTableHeader" aria-hidden="true">
            <span>{t("climbs")}</span>
            <span>{t("distance")}</span>
            <span>{t("up")}</span>
            <span>Ø {t("gradient")}</span>
            <span>Score</span>
            <span>{t("time")}</span>
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
                <strong className="climbEffort" title={t("climbEffortHint")}>
                  {translateEffortCategory(tx, climb.category)}
                </strong>
                <span>
                  {t("climbs")} {climb.index}
                </span>
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
              <span className="climbScore" title={t("climbEffortHint")}>
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
        <p className="panelEmpty">{t("noSignificantClimbs")}</p>
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

function translateEffortCategory(
  tx: (text: string) => string,
  category: string,
): string {
  return tx(category);
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

function formatBinElevation(bin: GradientDistributionBin): string {
  return `+${Math.round(bin.ascentMeters)} m · -${Math.round(bin.descentMeters)} m`;
}

function gradientBinClassName(
  isActive: boolean,
  isSelected: boolean,
  hasSelection: boolean,
): string {
  return [
    "gradientHistogramBin",
    isActive ? "is-active" : "",
    isSelected ? "is-selected" : "",
    hasSelection && !isSelected ? "is-muted" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function formatSelectedBinCount(count: number): string {
  return count === 1 ? "1 Bereich" : `${count} Bereiche`;
}

function formatSelectionPercentage(
  selectedDistanceMeters: number,
  totalDistanceMeters: number,
): string {
  if (totalDistanceMeters <= 0) return "0.0 %";
  return `${((selectedDistanceMeters / totalDistanceMeters) * 100).toFixed(1)} %`;
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

function formatSustainedGradientAria(
  locale: Locale,
  direction: string,
  window: string,
  gradient: string,
  startKilometer: string,
): string {
  if (locale === "fr") {
    return `Passage le plus raide en ${direction.toLowerCase()} sur ${window} : ${gradient}, à partir du km ${startKilometer}`;
  }
  if (locale === "it") {
    return `Tratto più ripido in ${direction.toLowerCase()} su ${window}: ${gradient}, dal km ${startKilometer}`;
  }
  if (locale === "en") {
    return `Steepest ${direction.toLowerCase()} section over ${window}: ${gradient}, from km ${startKilometer}`;
  }
  return `Steilste ${direction}-Passage über ${window}: ${gradient}, ab Kilometer ${startKilometer}`;
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
