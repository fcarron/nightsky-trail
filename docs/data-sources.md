# Data Sources

nightsky trail is Switzerland-first and planning-first. Data sources must be visible to users together with their limitations.

## License / Fair Use

This project uses multiple data and tile sources. The app must keep source attribution visible in the map UI and must keep these source notes current in this document. This section is a project implementation note, not legal advice.

User-facing attribution:

```text
© swisstopo
© OpenStreetMap contributors
© OpenTopoMap (CC-BY-SA)      when the OSM Topo layer is active
```

swisstopo requires source indication when swisstopo data or geoservices are published or distributed. For dynamic map applications, swisstopo allows attribution next to the data or in a central source list linked from the application. Project reference:

```text
https://www.swisstopo.admin.ch/en/source-reference-ogd-swisstopo
```

OpenStreetMap data is licensed under the Open Database License. The app must credit OpenStreetMap and link users to the OSM copyright/license information whenever OSM-derived routing, trail difficulty, or OSM-based map layers are used. Project reference:

```text
https://www.openstreetmap.org/copyright
```

OpenTopoMap raster tiles combine OSM data, SRTM elevation data, and the OpenTopoMap cartographic style. When the `OSM Topo` base layer is active, the UI must additionally show `© OpenTopoMap (CC-BY-SA)`. For larger or public deployments, tile usage should be clarified or replaced with self-hosted tiles. Project references:

```text
https://www.opentopomap.org/about
https://wiki.openstreetmap.org/wiki/OpenTopoMap
```

Operational rules:

- cache elevation profiles and trail-overlay responses;
- do not make unnecessary repeated swisstopo profile requests for unchanged route geometry;
- use public Overpass only for development or low-volume fallback;
- for public production use, prefer local/imported OSM data and self-hosted derived services;
- before public growth or heavy traffic, clarify swisstopo fair-use and service-load expectations.

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

Selectable Wanderland route overlay through geo.admin WMS:

```text
ch.astra.wanderland
```

Selectable cycling route overlay through geo.admin WMS:

```text
ch.astra.veloland
```

Selectable hiking closure and detour overlay through geo.admin WMS:

```text
ch.astra.wanderland-sperrungen_umleitungen
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

The frontend sends public GeoJSON `LineString` geometry in EPSG:4326. The backend validates the coordinates, converts the LineString to EPSG:2056, calls swisstopo, validates the response, and returns normalized distance/elevation/gradient data plus Swiss hiking-time metadata.

Swiss hiking time is derived only from the swisstopo elevation profile and route distance. The calculation smooths elevation, resamples into 50-metre segments, calculates segment slope, and applies the official polynomial pace model within +/-40% slope with linear steep-section handling outside that range. It does not correct for trail difficulty, surface, trail visibility, weather, or user fitness.

## GraphHopper Routing

Routing uses a self-hosted GraphHopper instance with an OpenStreetMap extract for Switzerland. It is accessed only through Django. The backend keeps `GRAPHHOPPER_BASE_URL` and `GRAPHHOPPER_PROFILE` configurable, defaults to the `hike` profile, requests unencoded point geometry, asks for route details, and normalizes responses before returning them to the frontend.

The local Docker GraphHopper is configured in:

```text
docker/graphhopper/config.yml
```

It imports a `hike` profile using GraphHopper's built-in `hike.json` model. Compared with the built-in `foot.json` model, this is important for Swiss hiking routes because `foot.json` blocks routes at lower `hike_rating` values, while `hike.json` is meant for hiking paths. It also imports a `bike` profile using GraphHopper's built-in `bike.json` model for bicycle routing.

The swisstopo/ASTRA `ch.astra.wanderland` layer is a visual official Wanderland route overlay. It shows the SwitzerlandMobility hiking routes and is separate from the `ch.swisstopo.swisstlm3d-wanderwege` trail-category layer.

The swisstopo/ASTRA `ch.astra.veloland` layer is a visual official cycling-route overlay. Current bicycle route finding uses the GraphHopper `bike` profile on OSM data; it does not snap specifically to the swisstopo Veloland overlay.

The swisstopo/ASTRA `ch.astra.wanderland-sperrungen_umleitungen` layer is a visual overlay for reported closures and detours on the hiking trail network and Wanderland routes. It is provided by ASTRA, swisstopo, Swiss Hiking Trails, SchweizMobil, and cantons. It is a planning aid; local signage and current conditions remain authoritative.

After changing GraphHopper profiles or encoded values, the local graph cache must be rebuilt. Stop GraphHopper, remove the generated `data/graphhopper/` cache, and start GraphHopper again so it imports the Switzerland extract with the current `hike` and `bike` profiles.

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

## OSM Difficulty Overlay

The trail difficulty overlay is served through Django. The preferred local development source is the Switzerland OSM PBF extract at `OSM_PBF_PATH`. The backend builds a SQLite cache at `OSM_TRAIL_INDEX_PATH` on the first trail request and then serves viewport queries from that local index. The cache contains relevant foot and trail ways plus selected public tags only.

If the local extract is missing or the index cannot be built, the backend falls back to Overpass. Overpass is only a development or low-volume fallback and remains bounded by zoom, bbox area, timeout, and response validation.

Official hiking-trail categories are read from the swisstopo OGD GeoPackage for `ch.swisstopo.swisstlm3d-wanderwege`, configured by `SWISSTOPO_TRAILS_URL`, `SWISSTOPO_TRAILS_ZIP_PATH`, and `SWISSTOPO_TRAILS_GPKG_PATH`. The relevant field is `wanderwege`; values are normalized to:

```text
Wanderweg       -> hiking_trail
Bergwanderweg  -> mountain_hiking_trail
Alpinwanderweg -> alpine_hiking_trail
other/null      -> unknown/other
```

The current OSM difficulty layer uses:

```http
GET /api/v1/trails?bbox=minLon,minLat,maxLon,maxLat&zoom=14
```

It loads relevant OSM foot and trail ways through Django and returns normalized summary counts plus combined matching segments. The normal frontend request sets `include_official=false` and `include_debug=false`, so only compact black warning-overlay marker geometries are sent. Match Debug sets `include_debug=true` to inspect all matched, ambiguous, and OSM-only segments; it is intended for development, hidden unless `VITE_DEV_TOOLS=true`, and limited by `TRAILS_DEBUG_MIN_ZOOM` plus `TRAILS_DEBUG_MAX_BBOX_AREA`. Ways without `sac_scale` are counted as unknown (`?`) rather than hidden or treated as T1. This is a difficulty visualization layer, not a routing source.

The official swisstopo hiking trail layer remains visible through the fast swisstopo WMTS layer as the source for Swiss hiking categories such as hiking trail, mountain hiking trail, and alpine hiking trail. The backend still reads the official GeoPackage for spatial matching, but does not send the complete official network to the browser during normal use. These official categories are related to, but not identical with, OSM `sac_scale`, so the UI presents them as separate visual dimensions.

## Trail Matching

The API splits OSM ways into short matching segments and matches each segment against nearby official swisstopo hiking-trail geometries in EPSG:2056. Difficulty is never propagated to a complete swisstopo feature.

Initial thresholds are centralized in `TrailMatchingThresholds`:

```text
candidate distance: 12 m
OSM matching segment length: 35 m
minimum reliable match score: 0.72
ambiguity score delta: 0.08
```

The match score combines covered or parallel length, average distance, and direction similarity. Ambiguous or unmatched OSM segments do not produce warning overlays.

Warning rules are intentionally limited:

```text
Bergwanderweg + T3  -> warning overlay
Alpinwanderweg + T5 -> warning overlay
Alpinwanderweg + T6 -> warning overlay
all other cases     -> no warning overlay
```

The warning overlay is rendered as small black `+` markers along the affected OSM segment so the official swisstopo colour remains visible underneath.

## GPX Files

GPX import/export is a local browser file operation. Export writes a GPX 1.1 track from the active route geometry. Import reads track, route, or waypoint coordinates and preserves the imported geometry as the displayed route. Only editable start/end waypoints are created initially. Imported files are not sent to an external routing service and are not automatically re-routed.
