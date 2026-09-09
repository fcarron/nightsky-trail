import { describe, expect, it } from "vitest";
import Feature from "ol/Feature.js";
import { LineString } from "ol/geom.js";
import { fromLonLat } from "ol/proj.js";
import VectorSource from "ol/source/Vector.js";

import { parseClosureFeatureInfo } from "./mapFeatureInfo";
import { updateRouteCategoryFeatures } from "./routeCategory";

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

describe("active route hiking categories", () => {
  it("keeps only official trail geometry close to the active route", () => {
    const routeSource = new VectorSource();
    routeSource.addFeature(
      new Feature(
        new LineString([fromLonLat([7.4, 46.9]), fromLonLat([7.41, 46.9])]),
      ),
    );
    const categorySource = new VectorSource();

    updateRouteCategoryFeatures(
      categorySource,
      routeSource,
      [
        {
          id: "near",
          officialCategory: "mountain_hiking_trail",
          geometry: {
            type: "LineString",
            coordinates: [
              [7.4, 46.9],
              [7.41, 46.9],
            ],
          },
        },
        {
          id: "far",
          officialCategory: "alpine_hiking_trail",
          geometry: {
            type: "LineString",
            coordinates: [
              [7.4, 47],
              [7.41, 47],
            ],
          },
        },
      ],
      true,
    );

    expect(categorySource.getFeatures()).toHaveLength(1);
    expect(categorySource.getFeatures()[0].get("officialCategory")).toBe(
      "mountain_hiking_trail",
    );
  });

  it("hides category geometry with the official trail layer", () => {
    const routeSource = new VectorSource();
    routeSource.addFeature(
      new Feature(
        new LineString([fromLonLat([7.4, 46.9]), fromLonLat([7.41, 46.9])]),
      ),
    );
    const categorySource = new VectorSource();

    updateRouteCategoryFeatures(
      categorySource,
      routeSource,
      [
        {
          id: "near",
          officialCategory: "hiking_trail",
          geometry: {
            type: "LineString",
            coordinates: [
              [7.4, 46.9],
              [7.41, 46.9],
            ],
          },
        },
      ],
      false,
    );

    expect(categorySource.getFeatures()).toHaveLength(0);
  });

  it("groups disconnected parts of the same category into one feature", () => {
    const routeSource = new VectorSource();
    routeSource.addFeature(
      new Feature(
        new LineString([fromLonLat([7.4, 46.9]), fromLonLat([7.43, 46.9])]),
      ),
    );
    const categorySource = new VectorSource();

    updateRouteCategoryFeatures(
      categorySource,
      routeSource,
      [
        {
          id: "first",
          officialCategory: "mountain_hiking_trail",
          geometry: {
            type: "LineString",
            coordinates: [
              [7.4, 46.9],
              [7.41, 46.9],
            ],
          },
        },
        {
          id: "second",
          officialCategory: "mountain_hiking_trail",
          geometry: {
            type: "LineString",
            coordinates: [
              [7.42, 46.9],
              [7.43, 46.9],
            ],
          },
        },
      ],
      true,
    );

    const features = categorySource.getFeatures();
    expect(features).toHaveLength(1);
    expect(features[0].getGeometry()?.getType()).toBe("MultiLineString");
  });
});
