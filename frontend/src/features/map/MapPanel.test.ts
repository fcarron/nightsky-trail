import { describe, expect, it } from "vitest";

import { parseClosureFeatureInfo } from "./mapFeatureInfo";

describe("parseClosureFeatureInfo", () => {
  it("normalizes the German fields returned by the swisstopo closure layer", () => {
    const feature = parseClosureFeatureInfo(`GetFeatureInfo results:

Layer 'ch.astra.wanderland-sperrungen_umleitungen_line'
  Feature 1946050:
    ch.astra.wanderland-sperrungen_umleitungen.duration_de.name = 'unbestimmt'
    ch.astra.wanderland-sperrungen_umleitungen.title_de.name = 'Nebental II'
    ch.astra.wanderland-sperrungen_umleitungen.abstract_de.name = 'Befall mit Eichenprozessionsspinner.'
    ch.astra.wanderland-sperrungen_umleitungen.type_de.name = 'Sperrung und Umleitung'
    ch.astra.wanderland-sperrungen_umleitungen.reason_de.name = 'Andere'
    ch.astra.wanderland-sperrungen_umleitungen.content_provider_de.name = 'Schweizer Wanderwege'`);

    expect(feature).toEqual({
      details: [
        ["Status", "Sperrung und Umleitung"],
        ["Dauer", "unbestimmt"],
        ["Grund", "Andere"],
        ["Hinweis", "Befall mit Eichenprozessionsspinner."],
        ["Quelle", "Schweizer Wanderwege"],
      ],
      kind: "closure",
      title: "Nebental II",
    });
  });

  it("does not create an info card without a closure title", () => {
    expect(
      parseClosureFeatureInfo(
        "GetFeatureInfo results:\n\n  Search returned no results.",
      ),
    ).toBeNull();
  });
});
