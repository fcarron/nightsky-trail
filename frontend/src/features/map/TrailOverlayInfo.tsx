import { SUPPLEMENT_LEGEND } from "./trailDifficulty";

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
              <span
                className="difficultySwatch"
                style={{ background: item.color }}
              />
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
