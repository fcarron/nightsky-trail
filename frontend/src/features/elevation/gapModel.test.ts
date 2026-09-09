import { describe, expect, it } from "vitest";

import {
  minettiGradeCostDelta,
  reverseGapPaceMinutesPerKilometre,
} from "./gapModel";

describe("reverse GAP", () => {
  it("keeps flat pace unchanged", () => {
    expect(reverseGapPaceMinutesPerKilometre(5, 0)).toBe(5);
    expect(minettiGradeCostDelta(0)).toBe(0);
  });

  it.each([
    [5, 7.1],
    [10, 9.37],
    [15, 11.6],
    [20, 13.97],
  ])("calculates uphill pace at %s percent", (slope, expectedPace) => {
    expect(reverseGapPaceMinutesPerKilometre(5, slope)).toBeCloseTo(
      expectedPace,
      1,
    );
  });

  it.each([
    [-5, 3.91],
    [-10, 3.26],
    [-20, 2.91],
  ])("calculates downhill pace at %s percent", (slope, expectedPace) => {
    expect(reverseGapPaceMinutesPerKilometre(5, slope)).toBeCloseTo(
      expectedPace,
      1,
    );
  });

  it("uses the configured pace as the reference performance", () => {
    const fast = reverseGapPaceMinutesPerKilometre(4, 10);
    const steady = reverseGapPaceMinutesPerKilometre(6, 10);

    expect(fast).toBeLessThan(steady);
  });
});
