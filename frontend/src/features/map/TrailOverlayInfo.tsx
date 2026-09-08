import { SUPPLEMENT_LEGEND } from "./trailDifficulty";
import { useI18n } from "../../app/i18n";

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
  const { t } = useI18n();
  return (
    <div className="trailLegend" aria-label={t("routeDetails")}>
      {hikingTrailsVisible ? (
        <section>
          <strong>{t("officialSwissTopo")}</strong>
          <div>
            <span className="officialLine officialLineHiking" />
            {t("hikingTrail")}
          </div>
          <div>
            <span className="officialLine officialLineMountain" />
            {t("mountainHikingTrail")}
          </div>
          <div>
            <span className="officialLine officialLineAlpine" />
            {t("alpineHikingTrail")}
          </div>
        </section>
      ) : null}
      {difficultyVisible ? (
        <section>
          <strong>{t("difficulty")}</strong>
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
