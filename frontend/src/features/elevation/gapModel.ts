// Black et al. flat-running cost GAM values, sampled from the MIT-licensed
// gap-app reference implementation. Speeds are implicit 0.05 m/s steps.
const BLACK_SPEED_STEP_METERS_PER_SECOND = 0.05;
const BLACK_FLAT_COST_JOULES_PER_KG_METER = [
  6.0976, 6.0592, 6.0208, 5.9824, 5.944, 5.9056, 5.8672, 5.8289, 5.7905, 5.7521,
  5.7137, 5.6753, 5.6369, 5.5985, 5.5601, 5.5217, 5.4833, 5.4449, 5.4066,
  5.3682, 5.3298, 5.2914, 5.253, 5.2146, 5.1762, 5.1378, 5.0994, 5.061, 5.0227,
  4.9843, 4.9459, 4.9075, 4.8691, 4.8307, 4.7923, 4.7539, 4.7155, 4.6771,
  4.6387, 4.6004, 4.562, 4.5236, 4.4852, 4.4468, 4.4084, 4.37, 4.3317, 4.2936,
  4.2559, 4.2187, 4.1821, 4.1463, 4.1115, 4.0777, 4.0451, 4.0139, 3.9841, 3.956,
  3.9297, 3.9053, 3.883, 3.8628, 3.845, 3.8294, 3.816, 3.8046, 3.795, 3.7872,
  3.7811, 3.7764, 3.7732, 3.7713, 3.7704, 3.7707, 3.7718, 3.7737, 3.7763,
  3.7794, 3.783, 3.7868, 3.791, 3.7955, 3.8002, 3.8051, 3.8103, 3.8157, 3.8213,
  3.827, 3.8329, 3.8389, 3.845, 3.8512, 3.8575, 3.8638, 3.8701, 3.8765, 3.8828,
  3.8892, 3.8955, 3.9019, 3.9082, 3.9146, 3.9209, 3.9273, 3.9336, 3.94, 3.9463,
  3.9527, 3.959, 3.9654, 3.9717, 3.9781, 3.9844, 3.9908, 3.9971, 4.0035, 4.0098,
  4.0162, 4.0225, 4.0289, 4.0352, 4.0416, 4.0479, 4.0543, 4.0606, 4.067, 4.0733,
  4.0797, 4.086, 4.0924, 4.0987, 4.1051, 4.1114, 4.1178, 4.1241, 4.1305, 4.1368,
  4.1432, 4.1495, 4.1559, 4.1622, 4.1686, 4.1749, 4.1813, 4.1876, 4.194, 4.2003,
  4.2067, 4.213, 4.2194, 4.2257, 4.2321, 4.2384, 4.2448, 4.2511, 4.2575, 4.2638,
  4.2702, 4.2765, 4.2829, 4.2892, 4.2956, 4.3019, 4.3083, 4.3146, 4.321, 4.3273,
  4.3337, 4.34, 4.3464, 4.3527, 4.3591, 4.3654, 4.3718, 4.3781, 4.3845, 4.3908,
  4.3972, 4.4035, 4.4099, 4.4162, 4.4226, 4.4289, 4.4353, 4.4416, 4.448, 4.4543,
  4.4607, 4.467, 4.4734, 4.4797, 4.4861, 4.4924, 4.4988, 4.5051, 4.5115, 4.5178,
  4.5242, 4.5305, 4.5369, 4.5432,
] as const;

const REVERSE_GAP_ITERATIONS = 10;

export function minettiGradeCostDelta(slopePercent: number): number {
  const grade = slopePercent / 100;
  return (
    155.4 * grade ** 5 -
    30.4 * grade ** 4 -
    43.3 * grade ** 3 +
    46.3 * grade ** 2 +
    19.5 * grade
  );
}

export function reverseGapSpeedMetersPerSecond(
  flatRunningPaceMinPerKm: number,
  slopePercent: number,
): number {
  if (
    !Number.isFinite(flatRunningPaceMinPerKm) ||
    flatRunningPaceMinPerKm <= 0 ||
    !Number.isFinite(slopePercent)
  ) {
    throw new RangeError(
      "Pace and slope must be finite, and pace must be positive.",
    );
  }

  const flatSpeed = paceToSpeed(flatRunningPaceMinPerKm);
  if (slopePercent === 0) {
    return flatSpeed;
  }

  const targetPower = flatSpeed * interpolateBlackFlatCost(flatSpeed);
  const gradeCostDelta = minettiGradeCostDelta(slopePercent);
  let speed =
    targetPower / (interpolateBlackFlatCost(flatSpeed) + gradeCostDelta);

  for (let index = 0; index < REVERSE_GAP_ITERATIONS; index += 1) {
    speed = targetPower / (interpolateBlackFlatCost(speed) + gradeCostDelta);
  }

  if (!Number.isFinite(speed) || speed <= 0) {
    throw new RangeError(
      "Reverse GAP has no positive solution for this slope.",
    );
  }
  return speed;
}

export function reverseGapPaceMinutesPerKilometre(
  flatRunningPaceMinPerKm: number,
  slopePercent: number,
): number {
  if (slopePercent === 0) {
    return flatRunningPaceMinPerKm;
  }
  return (
    1000 /
    (reverseGapSpeedMetersPerSecond(flatRunningPaceMinPerKm, slopePercent) * 60)
  );
}

function paceToSpeed(paceMinutesPerKilometre: number): number {
  return 1000 / (paceMinutesPerKilometre * 60);
}

function interpolateBlackFlatCost(speedMetersPerSecond: number): number {
  const maximumIndex = BLACK_FLAT_COST_JOULES_PER_KG_METER.length - 1;
  const rawIndex = speedMetersPerSecond / BLACK_SPEED_STEP_METERS_PER_SECOND;
  const lowerIndex = Math.max(
    0,
    Math.min(maximumIndex - 1, Math.floor(rawIndex)),
  );
  const ratio = rawIndex - lowerIndex;
  const lower = BLACK_FLAT_COST_JOULES_PER_KG_METER[lowerIndex];
  const upper = BLACK_FLAT_COST_JOULES_PER_KG_METER[lowerIndex + 1];
  return lower + (upper - lower) * ratio;
}
