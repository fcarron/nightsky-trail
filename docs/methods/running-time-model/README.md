# Personal running-time model

Technical note describing the gradient-dependent personal running-time
estimates retained in NightSky Trail. The interface uses `gap_hybrid` whenever
the user selects **Meine Pace**; the other models remain available internally
for comparison and testing.

The legacy Swiss model uses the Swiss hiking-time function as a terrain-response
curve and scales it to a user's flat running pace, with an additional
provisional uphill correction.

The optional GAP model treats the configured flat pace as a reference
performance. For every existing elevation segment it combines Minetti's
grade-cost difference with the speed-dependent flat-running cost model from
Black et al., solves for the speed at the same metabolic power, and integrates
the resulting unrounded segment times. It intentionally adds no fatigue,
altitude, surface, technical-difficulty, or trail correction.

The GAP implementation and its third-party attribution are documented in
[`docs/third-party.md`](../../third-party.md).

For comparison, the `gap_strava` option applies an approximation of the
published Strava GAP curve directly to the same flat reference pace for every
segment. It is not an official Strava formula and receives no additional
correction factors.

The `gap_hybrid` model uses the smoothed elevation profile and splits it into
the fixed distance segments supplied by the profile (currently 50 metres). It
calculates an unrounded pace for each segment and sums the segment times. It
keeps the RunningWritings result for flat and uphill segments. On downhill
segments it uses the slower pace from RunningWritings GAP and the Strava
approximation, limiting the energetic model's optimistic downhill speed without
applying another correction.

The estimate assumes constant personal performance capacity and does not
attempt to predict fatigue, weather, altitude effects, or race-day performance.
