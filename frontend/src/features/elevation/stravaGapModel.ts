// Approximation of the published Strava GAP curve, not an official Strava formula.
export function stravaPaceFactor(gradePercent: number): number {
  const grade = Number(gradePercent);

  if (!Number.isFinite(grade)) {
    throw new RangeError("Grade must be finite.");
  }

  if (grade < -30) {
    const factorAtThirtyPercentDown = downhillPolynomial(-30);
    const slopeAtThirtyPercentDown = -0.0452252523;
    return factorAtThirtyPercentDown + slopeAtThirtyPercentDown * (grade + 30);
  }

  if (grade < 0) {
    return downhillPolynomial(grade);
  }

  if (grade <= 30) {
    return uphillPolynomial(grade);
  }

  return (uphillPolynomial(30) * grade) / 30;
}

export function stravaGapPaceMinutesPerKilometre(
  flatRunningPaceMinPerKm: number,
  gradePercent: number,
): number {
  if (
    !Number.isFinite(flatRunningPaceMinPerKm) ||
    flatRunningPaceMinPerKm <= 0
  ) {
    throw new RangeError("Pace must be finite and positive.");
  }
  return flatRunningPaceMinPerKm * stravaPaceFactor(gradePercent);
}

function downhillPolynomial(gradePercent: number): number {
  return (
    1 +
    2.13463433e-2 * gradePercent -
    3.5535174e-4 * gradePercent ** 2 -
    1.79897244e-4 * gradePercent ** 3 -
    6.31126345e-6 * gradePercent ** 4 -
    7.00707639e-8 * gradePercent ** 5
  );
}

function uphillPolynomial(gradePercent: number): number {
  return (
    1 +
    2.03535411e-2 * gradePercent +
    3.10959322e-3 * gradePercent ** 2 -
    4.63663554e-5 * gradePercent ** 3
  );
}
