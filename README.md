# Swiss Route Planner

Swiss Route Planner is a focused route-planning web app for Switzerland. The MVP is planning-first: no accounts, activity recording, training analytics, recommendations, payments, or cloud route storage.

## Current Milestone

Milestone 0 is complete. The current app includes Milestone 1 route editing, the first Milestone 2 routing slice, and the first Milestone 3 elevation slice: an OpenLayers map shell using official swisstopo basemaps, waypoint add/move/select/delete controls, undo/redo, keyboard delete/undo/redo, reverse/clear, browser-local route restoration, explicit segment modes, a segment legend, backend-computed distance, and a swisstopo-backed elevation/gradient panel. The frontend calls `/api/v1/route/compute` and `/api/v1/elevation/profile`, ignores stale responses, and keeps the last valid computed route/elevation visible after failures. New segments are routed by default. Clicking an existing route line inserts a waypoint into that segment, then the waypoint can be dragged like any other point. Segments can still be toggled between straight and routed; routed segments call GraphHopper through Django. Straight segments are dashed on the map, routed segments are solid.

## Stack

- Backend: Python 3.13-compatible Django 5.2 LTS, Django REST Framework, drf-spectacular, pytest, Ruff.
- Frontend: React 19, strict TypeScript, Vite 8, ECharts, Vitest, React Testing Library.
- Maps and route data: swisstopo vector tiles are wired in the frontend; GraphHopper routing and swisstopo elevation profiles go through Django adapters. OSM trail difficulty data is planned for a later milestone.

## Setup

Copy environment defaults:

```bash
cp .env.example .env
```

Install dependencies:

```bash
make bootstrap
```

Run both development servers:

```bash
make dev
```

Backend API:

```text
GET http://127.0.0.1:8000/api/v1/health
POST http://127.0.0.1:8000/api/v1/route/compute
POST http://127.0.0.1:8000/api/v1/elevation/profile
GET http://127.0.0.1:8000/api/schema/
GET http://127.0.0.1:8000/api/docs/
```

Frontend:

```text
http://127.0.0.1:5173
```

The frontend toolchain requires Node `^20.19.0 || >=22.12.0`. The checked CI configuration uses Node 24.

For routed segments, run a GraphHopper server with a Swiss OSM extract:

```bash
make graphhopper
```

This downloads `data/osm/switzerland-latest.osm.pbf` from Geofabrik when missing and starts GraphHopper on port `8989` with its graph cache under `data/graphhopper/`. Both paths are ignored by git. For the local `make dev` flow, keep:

```bash
GRAPHHOPPER_BASE_URL=http://localhost:8989
```

When running the backend through Docker Compose, `compose.yaml` points the backend at `http://graphhopper:8989`.

Elevation uses the public swisstopo profile service by default:

```bash
SWISSTOPO_BASE_URL=https://api3.geo.admin.ch
```

## Commands

```bash
make test
make lint
make format
make build
```

## Data Sources

The planned production data sources are documented in [docs/data-sources.md](docs/data-sources.md). All external services must be accessed through backend adapters, with explicit timeouts, response validation, and tests that do not make live network calls.
