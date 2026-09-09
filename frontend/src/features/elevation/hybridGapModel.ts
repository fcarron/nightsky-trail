import { reverseGapPaceMinutesPerKilometre } from "./gapModel";
import { stravaGapPaceMinutesPerKilometre } from "./stravaGapModel";

export function hybridGapPaceMinutesPerKilometre(
  flatRunningPaceMinPerKm: number,
  gradePercent: number,
): number {
  const runningWritingsPace = reverseGapPaceMinutesPerKilometre(
    flatRunningPaceMinPerKm,
    gradePercent,
  );

  if (gradePercent >= 0) {
    return runningWritingsPace;
  }

  const stravaPace = stravaGapPaceMinutesPerKilometre(
    flatRunningPaceMinPerKm,
    gradePercent,
  );
  return Math.max(runningWritingsPace, stravaPace);
}
