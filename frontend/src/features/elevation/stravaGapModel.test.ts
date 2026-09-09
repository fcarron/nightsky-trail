import { describe, expect, it } from "vitest";

import {
  stravaGapPaceMinutesPerKilometre,
  stravaPaceFactor,
} from "./stravaGapModel";

describe("approximated Strava GAP", () => {
  it.each([
    [-30, 1.48761489127],
    [-10, 0.87479307889],
    [0, 1],
    [10, 1.4681283776],
    [30, 3.1573485352],
    [50, 5.26224755867],
  ])("returns the expected factor at %s percent", (grade, expectedFactor) => {
    expect(stravaPaceFactor(grade)).toBeCloseTo(expectedFactor, 9);
  });

  it("applies the factor directly to the configured flat pace", () => {
    expect(stravaGapPaceMinutesPerKilometre(5, 10)).toBeCloseTo(
      5 * stravaPaceFactor(10),
      10,
    );
  });
});
