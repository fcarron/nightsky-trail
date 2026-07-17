# Architecture

Swiss Route Planner is split into a Django API and a React frontend. The active route stays in frontend state for the MVP; no account system or server-side route storage is part of the scaffold.

## Backend

The backend exposes versioned API routes under `/api/v1/`.

Implemented endpoints:

- `GET /api/v1/health` returns API health.
- `POST /api/v1/route/compute` validates a route and returns normalized segment geometry and distance. `straight` segments are calculated locally; `routed` segments call GraphHopper through the backend.
- `POST /api/v1/elevation/profile` validates GeoJSON LineString geometry, converts it to EPSG:2056, calls swisstopo profile data, and returns distance, ascent/descent, min/max elevation, smoothed gradient points, and Swiss hiking-time metadata.
- `GET /api/v1/trails` validates a viewport bbox and returns OSM difficulty summary counts plus compact warning-overlay geometries. Official swisstopo trail geometries are used internally for matching and are returned only when explicitly requested for debugging.

- `config/` contains Django settings, WSGI, and root URLs.
- `planner/api/` contains thin HTTP views, serializers, URL routing, and API error handling.
- `planner/domain/` is reserved for pure route, coordinate, elevation, and difficulty calculations.
- `planner/services/` coordinates domain code and adapters.
- `planner/integrations/` contains external API clients and upstream response formats.

External services are never called directly from React components. GraphHopper access goes through `planner/integrations/graphhopper.py` with a fixed configurable base URL, timeout, response validation, normalized exceptions, and fixture-based tests. swisstopo profile access follows the same adapter boundary in `planner/integrations/swisstopo.py`. OSM trail difficulty is served primarily from `planner/integrations/local_osm.py`, which builds a SQLite index from the configured Switzerland PBF extract. Official swisstopo hiking-trail categories are read through `planner/integrations/swisstopo_trails.py` from the configured GeoPackage. `planner/integrations/overpass.py` remains a bounded fallback when the local OSM extract is unavailable.

The `/api/v1/trails` orchestration lives in `planner/services/trails.py`, keeping `planner/api/views.py` thin. The segment-level combination lives in `planner/domain/trail_matching.py`. OSM ways are split into short segments, matched to candidate swisstopo trail geometries in EPSG:2056, scored by coverage, distance, and direction, and then normalized to `matched`, `ambiguous`, or `osm_only`. The user-facing map displays official hiking trails through the fast swisstopo WMTS layer; backend GeoPackage geometries are not sent for that base display. Warning overlays are emitted only for the explicit configured combinations and only on the matched OSM segment geometry.

The frontend's Match Debug toggle is a development tool behind `VITE_DEV_TOOLS=true`. It requests and renders matched, ambiguous, and OSM-only combined segments with their score/status available on click. The backend also limits Match Debug to small high-zoom viewports through `TRAILS_DEBUG_MIN_ZOOM` and `TRAILS_DEBUG_MAX_BBOX_AREA`. The normal user-facing overlay stays limited to the black warning marker geometry.

## Frontend

The frontend is a strict TypeScript React app served by Vite.

- `src/app/` contains the app entry point and top-level shell.
- `src/services/` contains typed API wrappers.
- `src/features/` is split by product area: map, route, elevation, and trail difficulty.
- `src/types/` contains shared TypeScript DTOs and domain types.

OpenLayers lifecycle code is isolated in the map feature. The map object is kept in a component ref, while serializable route state stays in React reducer state and is persisted to browser local storage. Map styling and trail overlay display helpers live in focused map feature modules so the OpenLayers lifecycle component remains manageable. Route geometry is requested from `/api/v1/route/compute`; elevation is requested from `/api/v1/elevation/profile` once a computed route is available. Request IDs and `AbortController` prevent stale responses from overwriting newer edits. The last valid computed route and elevation profile remain visible when later requests fail.

## Coordinates

Public API geometry uses GeoJSON in EPSG:4326 as `[longitude, latitude]`. OpenLayers displays EPSG:3857. swisstopo elevation requests require EPSG:2056. Coordinate conversion is centralized in `planner/domain/coordinates.py` and tested with round-trip coverage.

## Segment Model

Routes are represented as independently editable segments between consecutive waypoints. Each segment stores its mode: `straight` or `routed`. Straight segments use endpoint geometry and haversine distance and are drawn dashed. Routed segments use GraphHopper geometry and distance and are drawn solid. Failed routing is reported as an error and is not silently replaced by a straight line.

## Elevation Algorithm

The elevation implementation uses swisstopo profile data as the source of truth. The backend requests bounded samples from swisstopo, smooths elevation with a small window, calculates gradient over about 50 metres, and computes ascent/descent from the smoothed series. Swiss hiking time is calculated separately from the smoothed elevation profile: samples are resampled into fixed 50-metre segments, each segment slope is passed through the Swiss polynomial method, and unrounded segment times are summed before final rounding. The calculation intentionally does not apply trail difficulty, surface, visibility, weather, or fitness corrections. The frontend displays distance, ascent, descent, min/max elevation, maximum absolute gradient, hiking time, and an ECharts elevation/gradient profile. Synthetic profile tests cover the backend algorithm.

## Caching

Use Django's cache interface first. Planned cache keys include elevation by geometry hash. OSM trail overlay data is cached in a local SQLite index derived from the configured Switzerland PBF extract. The official swisstopo GeoPackage is cached under `data/swisstopo/`. Redis is not part of the scaffold.
