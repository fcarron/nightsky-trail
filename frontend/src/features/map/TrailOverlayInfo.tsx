import type { CombinedTrailSegmentDto } from "../../types/api";
import {
  DIFFICULTY_LEGEND,
  type DifficultySummary,
  SUPPLEMENT_LEGEND,
  formatMatchQuality,
  formatOfficialCategory,
  formatSacScale,
} from "./trailDifficulty";

interface DifficultyPanelProps {
  difficultyLimitedToKnown: boolean;
  difficultyStatus: string;
  difficultySummary: DifficultySummary;
  selectedDifficultyWay: { segment: CombinedTrailSegmentDto } | null;
}

export function DifficultyPanel({
  difficultyLimitedToKnown,
  difficultyStatus,
  difficultySummary,
  selectedDifficultyWay,
}: DifficultyPanelProps) {
  return (
    <div className="difficultyPanel" aria-live="polite">
      <strong>{difficultyStatus}</strong>
      {selectedDifficultyWay ? (
        <>
          <div className="difficultySelectedTitle">
            {formatOfficialCategory(selectedDifficultyWay.segment.officialCategory)} + OSM{" "}
            {formatSacScale(selectedDifficultyWay.segment.osmSacScale)}
          </div>
          <dl>
            <div>
              <dt>Official category</dt>
              <dd>{formatOfficialCategory(selectedDifficultyWay.segment.officialCategory)}</dd>
            </div>
            <div>
              <dt>OSM difficulty</dt>
              <dd>{formatSacScale(selectedDifficultyWay.segment.osmSacScale)}</dd>
            </div>
            <div>
              <dt>Match quality</dt>
              <dd>{formatMatchQuality(selectedDifficultyWay.segment.matchScore)}</dd>
            </div>
            <div>
              <dt>Match status</dt>
              <dd>{selectedDifficultyWay.segment.matchStatus}</dd>
            </div>
            <div>
              <dt>Quelle</dt>
              <dd>OpenStreetMap way {selectedDifficultyWay.segment.osmWayId}</dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          <div className="difficultySummaryGrid" aria-label="OSM T-Level im Ausschnitt">
            {DIFFICULTY_LEGEND.map((item) => (
              <div key={item.label}>
                <span className="difficultySwatch" style={{ background: item.color }} />
                <span>{item.label}</span>
                <strong>{difficultySummary.byLabel[item.label] ?? 0}</strong>
              </div>
            ))}
          </div>
          {difficultySummary.commonTags.length ? (
            <dl>
              {difficultySummary.commonTags.map(([key, value], index) => (
                <div key={`${key}=${value}:${index}`}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <span>
              {difficultyStatus.includes("nicht verfügbar")
                ? "OSM-Datenquelle nicht verfügbar."
                : difficultyLimitedToKnown
                  ? "Keine bekannten OSM-Zusatzhinweise im Ausschnitt geladen. Weiter hineinzoomen für OSM-Wege ohne T-Angabe."
                  : "Keine OSM-Wege im Ausschnitt geladen."}
            </span>
          )}
        </>
      )}
    </div>
  );
}

interface TrailLegendProps {
  difficultyVisible: boolean;
  hikingTrailsVisible: boolean;
  trailMatchDebugEnabled: boolean;
}

export function TrailLegend({
  difficultyVisible,
  hikingTrailsVisible,
  trailMatchDebugEnabled,
}: TrailLegendProps) {
  return (
    <div className="trailLegend" aria-label="Weg- und Zusatzlegende">
      {hikingTrailsVisible ? (
        <section>
          <strong>swisstopo offiziell</strong>
          <div>
            <span className="officialLine officialLineHiking" />
            Wanderweg
          </div>
          <div>
            <span className="officialLine officialLineMountain" />
            Bergwanderweg
          </div>
          <div>
            <span className="officialLine officialLineAlpine" />
            Alpinwanderweg
          </div>
        </section>
      ) : null}
      {difficultyVisible ? (
        <section>
          <strong>Schwierigkeit</strong>
          {SUPPLEMENT_LEGEND.map((item) => (
            <div key={item.label}>
              <span className="difficultySwatch" style={{ background: item.color }} />
              {item.label}
            </div>
          ))}
        </section>
      ) : null}
      {trailMatchDebugEnabled ? (
        <section>
          <strong>Match Debug</strong>
          <div>
            <span className="debugLine debugLineMatched" />
            matched
          </div>
          <div>
            <span className="debugLine debugLineAmbiguous" />
            ambiguous
          </div>
          <div>
            <span className="debugLine debugLineOsmOnly" />
            osm_only
          </div>
        </section>
      ) : null}
    </div>
  );
}
