# Data Sources

Swiss Route Planner is Switzerland-first and planning-first. Data sources must be visible to users together with their limitations.

## swisstopo Map

Preferred vector tile style:

```text
https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json
```

Selectable standard map layer:

```text
ch.swisstopo.pixelkarte-farbe
```

Selectable hiking trail overlay:

```text
ch.swisstopo.swisstlm3d-wanderwege
```

The UI must display `© swisstopo`.

Optional OSM topo base map:

```text
https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png
```

Display `© OpenStreetMap contributors` and `© OpenTopoMap` when this layer is active.

Deprecated style names such as `ch.swisstopo.leichte-basiskarte.vt` must not be used.

## swisstopo Elevation

Elevation profiles use:

```text
POST https://api3.geo.admin.ch/rest/services/profile.json
```

The frontend sends public GeoJSON `LineString` geometry in EPSG:4326. The backend validates the coordinates, converts the LineString to EPSG:2056, calls swisstopo, validates the response, and returns normalized distance/elevation/gradient data.

## GraphHopper Routing

Routing uses a self-hosted GraphHopper instance with an OpenStreetMap extract for Switzerland. It is accessed only through Django. The backend keeps `GRAPHHOPPER_BASE_URL` and `GRAPHHOPPER_PROFILE` configurable, defaults to the `hike` profile, requests unencoded point geometry, asks for `hike_rating` details, and normalizes responses before returning them to the frontend.

The local Docker GraphHopper is configured in:

```text
docker/graphhopper/config.yml
```

It imports a `hike` profile using GraphHopper's built-in `hike.json` model. Compared with the built-in `foot.json` model, this is important for Swiss hiking routes because `foot.json` blocks routes at lower `hike_rating` values, while `hike.json` is meant for hiking paths.

The first project-specific custom model is stored in:

```text
backend/planner/integrations/graphhopper_models/hiking.json
```

It is intentionally permissive for the MVP. It prefers mapped foot/hiking networks, path-like road classes, and ways with known `hike_rating`, but it does not exclude high T-levels or unknown difficulty. Difficulty restrictions will be added as explicit route options later, because missing OSM difficulty is unknown and must not be treated as T1.

For route debugging the backend currently requests:

```text
hike_rating, foot_network, road_class
```

Raw GraphHopper responses and credentials must not be exposed to clients.

## OSM Hiking Difficulty

OSM `sac_scale` values are normalized as:

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

Missing difficulty is unknown, never T1.

The UI must display `© OpenStreetMap contributors` and state that OSM data is community-maintained and may be incomplete or incorrect.

## Overpass Prototype

The optional trail overlay may use Overpass only through Django during development or low-volume prototype use. Requests must be debounced, zoom-limited, bounded by area and timeout, and cached by rounded viewport cells.

The current OSM debug mode uses:

```http
GET /api/v1/trails?bbox=minLon,minLat,maxLon,maxLat&zoom=14
```

It loads path-like OSM ways through Django and returns only normalized geometry plus selected tags such as `highway`, `foot`, `access`, `sac_scale`, `trail_visibility`, `informal`, `bridge`, `ford`, `surface`, and `incline`. It is a diagnostic layer for comparing visible OSM paths with GraphHopper routing, not a routing source.
