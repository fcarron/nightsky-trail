import { describe, expect, it } from "vitest";

import { reverseGapPaceMinutesPerKilometre } from "./gapModel";
import { hybridGapPaceMinutesPerKilometre } from "./hybridGapModel";
import { stravaGapPaceMinutesPerKilometre } from "./stravaGapModel";

describe("hybrid GAP", () => {
  it.each([0, 5, 10, 20, 40])(
    "uses pure RunningWritings GAP at %s percent",
    (grade) => {
      expect(hybridGapPaceMinutesPerKilometre(5, grade)).toBeCloseTo(
        reverseGapPaceMinutesPerKilometre(5, grade),
        10,
      );
    },
  );

  it.each([-5, -10, -20, -30, -40])(
    "uses the slower downhill prediction at %s percent",
    (grade) => {
      const runningWritingsPace = reverseGapPaceMinutesPerKilometre(5, grade);
      const stravaPace = stravaGapPaceMinutesPerKilometre(5, grade);

      expect(hybridGapPaceMinutesPerKilometre(5, grade)).toBeCloseTo(
        Math.max(runningWritingsPace, stravaPace),
        10,
      );
    },
  );
});
