# AGENTS.md

## Goal

Build **nightsky trail**, a focused route-planning web app for Switzerland.

Required features:

* official swisstopo map;
* add, move, delete, undo, and redo waypoints;
* automatically follow roads and paths;
* optional straight-line segments;
* distance, ascent, descent, elevation, and gradient;
* optional OSM hiking difficulty (`sac_scale`, T1–T6);
* GPX import and export;
* lightweight login and saved tours.

Keep it smaller than OpenRunner, Komoot, or Strava.

Do not add social features, activity recording, training analysis, recommendations, payments, or cloud synchronization unless explicitly requested.

## Principles

* Planning first; Switzerland first.
* Keep accounts and server-side storage limited to lightweight session login and user-owned saved tours.
* No social graph, public profiles, sharing feed, activity recording, or cloud synchronization for the MVP.
* Build small complete milestones.
* Keep data sources and limitations visible.
* Missing OSM difficulty is unknown, never T1.
* Never silently replace failed routing with a straight line.
* Avoid unnecessary frameworks, dependencies, and abstractions.

## Stack

### Backend

* Python 3.13 or another supported Python release.
* Django 5.2 LTS.
* Django REST Framework and `drf-spectacular`.
* `httpx`, `pyproj`, `pytest`, `pytest-django`, and Ruff.
* SQLite initially; PostgreSQL only when required by a requested feature.

### Frontend

* React 19 with strict TypeScript.
* Vite 8.
* OpenLayers 10 with `ol-mapbox-style`.
* ECharts for elevation/gradient.
* Vitest and React Testing Library.
* Playwright after the core flow works.
* CSS Modules or plain CSS.

Do not introduce Next.js, SSR, Redux, Tailwind, Material UI, or another large UI framework without a concrete requirement.

Pin exact versions in dependency files.

## Layout

```text
.
├── AGENTS.md
├── README.md
├── Makefile
├── compose.yaml
├── .env.example
├── backend/
│   ├── manage.py
│   ├── pyproject.toml
│   ├── config/
│   └── planner/
│       ├── api/
│       ├── domain/
│       ├── services/
│       ├── integrations/
│       │   ├── graphhopper.py
│       │   ├── swisstopo.py
│       │   └── overpass.py
│       └── tests/
├── frontend/
│   └── src/
│       ├── app/
│       ├── components/
│       ├── features/
│       │   ├── map/
│       │   ├── route/
│       │   ├── elevation/
│       │   └── trail-difficulty/
│       ├── services/
│       └── types/
└── docs/
    ├── architecture.md
    └── data-sources.md
```

Keep upstream formats inside `backend/planner/integrations/`. Expose normalized domain models to the rest of the app.

## Data sources

### swisstopo map

Preferred style:

```text
https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json
```

Optional classic WMTS layer:

```text
ch.swisstopo.pixelkarte-farbe
```

Do not use deprecated names such as `ch.swisstopo.leichte-basiskarte.vt`.

Always display `© swisstopo`.

### Elevation

Use:

```text
POST https://api3.geo.admin.ch/rest/services/profile.json
```

Send a GeoJSON `LineString` in EPSG:2056.

### Routing

Use GraphHopper with an OpenStreetMap extract for Switzerland.

* Prefer self-hosted GraphHopper.
* Access it only through Django.
* Keep its URL configurable.
* Use a hiking/foot profile.
* Request `hike_rating` path details.
* Do not expose credentials or raw GraphHopper responses.
* Do not commit `.osm.pbf` files or graph caches.

### OSM difficulty

Normalize:

```text
strolling                         -> below T1
hiking                            -> T1
mountain_hiking                   -> T2
demanding_mountain_hiking         -> T3
alpine_hiking                     -> T4
demanding_alpine_hiking           -> T5
difficult_alpine_hiking           -> T6
missing/unknown                    -> ?
```

Preserve when available:

```text
assisted_trail, trail_visibility, surface, highway,
ford, bridge, tunnel, incline
```

Always display `© OpenStreetMap contributors`.

State that OSM data is community-maintained and may be incomplete or incorrect.

## Coordinates

* Public GeoJSON: EPSG:4326, `[longitude, latitude]`.
* OpenLayers display: EPSG:3857.
* swisstopo elevation: EPSG:2056.
* Convert EPSG:4326 ↔ EPSG:2056 in one tested backend module using `pyproj`.
* Reject invalid coordinates and routes clearly outside Switzerland, with a small border tolerance.

Do not scatter coordinate conversion across views or React components.

## UI and behaviour

Use a full-page map with a compact toolbar, route summary, optional bottom elevation panel, layer selector, legend, and visible attribution.

Required interactions:

1. click to add a waypoint;
2. route between consecutive waypoints;
3. drag a waypoint and recalculate affected segments only;
4. select/delete a waypoint;
5. undo/redo;
6. reverse/clear;
7. switch individual segments between routed and straight;
8. import/export GPX.

Keep the last valid route visible while recalculating.

Use `AbortController` and request IDs so stale responses cannot overwrite newer edits.

Allow one route colour mode at a time:

```text
uniform | gradient | T difficulty
```

Do not communicate difficulty only by colour.

Suggested gradient groups:

```text
<5%, 5–10%, 10–15%, 15–20%, 20–30%, >30%
```

Keep thresholds, legends, and colours in centralized constants.

## Elevation and gradient

Do not calculate displayed gradient directly between adjacent raw samples.

Default approach:

1. sample every 20–30 metres;
2. respect swisstopo limits;
3. preserve original route geometry;
4. smooth elevation with a small distance-based window;
5. calculate gradient over about 50 metres;
6. calculate ascent/descent from the smoothed series;
7. centralize constants and test synthetic profiles;
8. document the algorithm.

Use swisstopo elevation as the source of truth.

## API

Use `/api/v1/`.

```http
GET  /api/v1/health
POST /api/v1/route/compute
POST /api/v1/elevation/profile
GET  /api/v1/trails?bbox=minLon,minLat,maxLon,maxLat&zoom=14
GET  /api/v1/auth/session
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/tours
POST /api/v1/tours
GET  /api/v1/tours/{id}
PATCH /api/v1/tours/{id}
DELETE /api/v1/tours/{id}
```

Route requests contain waypoints, profile, optional maximum T level, and the policy for unknown difficulty.

Normalized route responses contain:

* GeoJSON geometry;
* total distance;
* independently editable segments;
* T-level details;
* distance per T level and unknown distance;
* warnings.

Rules:

* validate coordinates, geometry, and waypoint count;
* return HTTP 422 when constraints make routing impossible;
* distinguish “no route” from “routing unavailable”;
* never disguise a straight segment as routed;
* preserve segment metadata.

Elevation responses contain distance, ascent/descent, min/max elevation, and points with distance, elevation, smoothed elevation, gradient, longitude, and latitude.

Saved-tour responses contain the route name, timestamps, and normalized route plan JSON for the authenticated user. A user must never be able to read, update, or delete another user's tours.

Use a consistent error format:

```json
{
  "code": "routing_unavailable",
  "message": "The routing service is currently unavailable.",
  "details": {}
}
```

Never expose stack traces or raw upstream responses.

## T-level routing

* A selected maximum T level excludes higher levels.
* If no valid route exists, return a clear error.
* Unknown difficulty is a separate policy.
* Default may allow unknown segments, but must report their distance.
* Missing difficulty is never T1.

Store GraphHopper custom models as versioned JSON, for example:

```text
backend/planner/integrations/graphhopper_models/hiking.json
```

## Optional trail overlay

For the prototype, query Overpass only through Django.

* Load only at zoom 13 or higher.
* Debounce viewport requests.
* Round bounding boxes into cache cells.
* Limit bbox area, timeout, and response size.
* Never query on every pan frame.
* Use public Overpass only for development or low-volume use.

For public deployment, replace Overpass with imported Swiss OSM data and vector tiles while keeping the frontend interface stable.

## GPX and persistence

GPX export writes the active route geometry when available, otherwise the waypoint line.

GPX import reads local track, route, or waypoint coordinates and creates an editable manual route. Re-routing is an explicit action.

For the MVP:

* keep the active route in frontend state;
* save the latest route to browser local storage;
* support lightweight Django session login;
* support user-owned saved tours in SQLite;
* do not add cloud synchronization or public sharing;
* add Django models only when required by requested persistence features.

## Integration rules

Every external-service adapter needs:

* fixed configurable base URL;
* explicit timeouts;
* limited safe retries;
* response validation;
* normalized exceptions;
* structured logging;
* fixture-based tests.

Never make live network calls in unit tests.

Never accept arbitrary upstream URLs from clients.

## Quality

### Performance

* Keep the OpenLayers map outside serializable React state.
* Isolate imperative map lifecycle code.
* Recalculate only affected segments.
* Cache elevation by geometry hash.
* Cache trail-overlay cells.
* Simplify geometry only for display, never for saved/exported data.
* Use Django’s cache interface; do not add Redis prematurely.

### Security

* Limit waypoints, geometry size, and bbox area.
* Validate GeoJSON types and ranges.
* Keep secrets in environment variables.
* Commit `.env.example`, never `.env`.
* Restrict development CORS.
* Do not proxy arbitrary URLs.
* Do not log GPX contents, secrets, or unnecessary precise route history.

### Accessibility

* Give actions visible labels or accessible names.
* Support keyboard delete, undo, and redo.
* Show a legend for the active route style.
* Centralize German UI strings for later translation.
* Use metric units initially.

## Testing

Backend tests cover coordinate conversion, validation, GraphHopper normalization, T mapping, missing difficulty, maximum-T failures, elevation calculations, upstream errors, and caching.

Frontend tests cover waypoint editing, stale-request cancellation, summaries, legends, display-mode switching, chart/map synchronization, and preservation of the previous route after failures.

After the core flow works, add one Playwright flow for route creation, elevation, T display, and GPX export.

Prefer behavioural tests over large snapshots.

## Commands

Maintain:

```bash
make bootstrap
make dev
make test
make lint
make format
make build
```

Expected checks:

```bash
uv run ruff check .
uv run ruff format --check .
uv run pytest

npm run lint
npm run typecheck
npm run test
npm run build
```

Use one Python dependency workflow.

## Milestones

Implement only the requested milestone.

0. **Scaffold:** Django, React, health, OpenAPI, lint, tests, commands, CI.
1. **Manual route:** swisstopo map, waypoint editing, straight lines, distance, undo/redo.
2. **Routing:** GraphHopper, routed/straight segments, cancellation, partial recalculation.
3. **Elevation:** swisstopo profile, ascent/descent, chart, gradient styling.
4. **T on route:** `hike_rating`, T colouring, distances, unknowns, maximum-T routing.
5. **T overlay:** cached Overpass prototype with zoom restriction.
6. **GPX/local:** import/export, reverse, local restoration.
7. **Persistence:** lightweight session login, saved tours, load/update/delete.

## Code style

### Python

* Type public functions.
* Keep API views thin.
* Put calculations in pure domain functions.
* Put external I/O in adapters.
* Avoid broad exception handling outside adapter boundaries.
* Do not mix HTTP, projection conversion, and calculations in one function.
* Keep Django models free of external-service calls.

### TypeScript

* Strict mode; avoid `any`.
* Separate API DTOs from internal models.
* Use focused components and hooks.
* Isolate OpenLayers lifecycle code.
* Avoid one oversized map component.
* Prefer native `fetch` through a small typed wrapper.
* Add global state only when local state/context is insufficient.

## Documentation

Keep current:

* `README.md`: purpose, setup, commands, environment, current milestone.
* `docs/architecture.md`: components, coordinates, segment model, elevation algorithm, caching.
* `docs/data-sources.md`: swisstopo, OSM, GraphHopper, attribution, limitations.

## Agent workflow

Before coding:

1. Read this file and any nearer nested `AGENTS.md`.
2. Read relevant documentation.
3. Inspect the repository and `git status`.
4. Choose the smallest complete change.
5. Reuse existing patterns unless clearly broken.

While coding:

* stay within the requested feature;
* preserve user changes;
* avoid unrelated refactors;
* verify external API contracts against official documentation;
* isolate uncertainty behind adapters instead of guessing;
* add tests and update documentation.

Before finishing:

1. Run relevant formatting, linting, tests, and build.
2. Fix failures caused by the change.
3. Review the diff for secrets and unrelated edits.
4. Report changes, checks run, and known limitations.

Do not claim a check passed unless it actually ran successfully.

## References

* https://developers.openai.com/codex/guides/agents-md
* https://docs.geo.admin.ch/visualize-data/vector-tiles.html
* https://docs.geo.admin.ch/visualize-data/wmts.html
* https://docs.geo.admin.ch/access-data/get-elevation-profile.html
* https://www.swisstopo.admin.ch/en/source-reference-ogd-swisstopo
* https://openlayers.org/doc/
* https://github.com/graphhopper/graphhopper/blob/master/docs/core/custom-models.md
* https://wiki.openstreetmap.org/wiki/Key:sac_scale
* https://www.openstreetmap.org/copyright
  ::: 
