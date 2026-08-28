# nightsky trail

nightsky trail is a lightweight route-planning web app for Switzerland, focused on trail running and hiking.

It is intentionally smaller than Komoot, Strava, OpenRunner, or SchweizMobil: draw a route, follow the path network, inspect distance and elevation, estimate time, and import or export GPX files.

This is an independent project. It is not operated, endorsed, verified, or supported by swisstopo, OpenStreetMap, SchweizMobil, ASTRA, or GraphHopper. Those services and datasets are used as external data sources and are credited accordingly.

## Features

- swisstopo maps as the primary map source
- click, drag, insert, delete, undo, and redo waypoints
- routed segments via GraphHopper on Swiss OpenStreetMap data
- optional straight-line route segments
- GPX import and export
- elevation profile with gradient colouring
- Swiss hiking-time estimate based on the segment polynomial method
- optional personal running-time estimate based on a configured flat pace
- official swisstopo hiking trail categories
- optional OSM `sac_scale` difficulty hints
- trail surface summary from OSM details where available
- lightweight Django session login and saved tours
- installable as a PWA

No social feed, public profiles, activity recording, training analytics, recommendations, payments, or cloud sync are planned for the MVP.

## Status

The project is a local MVP/prototype. The core planning workflow works, including routing, elevation profiles, GPX import/export, saved tours, and optional trail overlays.

Some parts are still prototype-level:

- larger-scale trail overlay performance
- production data import/update workflows
- mobile polish

## Quick Start

Recommended setup uses Docker Compose.

```bash
cp .env.example .env
make graphhopper
docker compose up backend frontend
docker compose exec backend uv run python manage.py migrate
```

Open:

```text
http://127.0.0.1:5173
```

API documentation:

```text
http://127.0.0.1:8000/api/docs/
```

`make graphhopper` downloads the Swiss OSM extract if needed and builds the local GraphHopper graph cache. OSM extracts, graph caches, databases, generated indexes, `.env`, and build artifacts are ignored by git.

## Development

Install local dependencies:

```bash
make bootstrap
```

Run the development stack:

```bash
make dev
```

Run checks:

```bash
make test
make lint
make build
```

Useful direct commands:

```bash
cd backend
uv run pytest
uv run ruff check .

cd frontend
npm run lint
npm run typecheck
npm run test -- --run
npm run build
```

If your local Node version is too old for the frontend toolchain, run the frontend checks inside Docker.

## Production deployment

Production uses a separate Compose stack with three services:

- a small Nginx gateway serving the React build and proxying `/api/`;
- Django running with Gunicorn;
- GraphHopper with persistent Swiss OSM data and graph cache.

The gateway can join an existing external Docker network, allowing an existing TLS Nginx to
proxy the complete site without exposing additional host ports. See
[docs/deployment.md](docs/deployment.md) for the `/opt/nightsky-trail` installation, Nginx
example, migrations, updates, and backups.

## Data Sources

nightsky trail combines several external data sources:

- swisstopo maps and elevation profile API
- swisstopo official hiking trail categories
- swisstopo/ASTRA overlays such as Wanderland, Veloland, and trail closures
- GraphHopper for routing on local Swiss OpenStreetMap data
- OpenStreetMap for path data, `sac_scale`, surface, and related tags

Attribution shown in the app is a source notice, not a sponsorship or publisher statement.

External data and map services have their own licenses, terms, attribution requirements, and usage limits. A code license for this repository does not change the licenses of swisstopo, OpenStreetMap, GraphHopper, or other third-party data.

More detail:

- [docs/data-sources.md](docs/data-sources.md)
- [docs/architecture.md](docs/architecture.md)

## Architecture

```text
React / Vite / OpenLayers / ECharts
        |
        | /api/v1/*
        v
Django REST Framework
        |
        +-- GraphHopper for routing
        +-- swisstopo for elevation and official map data
        +-- local OSM/trail indexes for overlays and metadata
```

The backend keeps external-service adapters isolated and returns normalized API responses to the frontend.

## Configuration

Important variables are documented in `.env.example`.

Common local values:

```bash
DJANGO_ENV=development
DJANGO_DEBUG=true
DJANGO_SECRET_KEY=change-me-in-development
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1
DJANGO_CSRF_TRUSTED_ORIGINS=http://localhost:5173

GRAPHHOPPER_BASE_URL=http://localhost:8989
GRAPHHOPPER_PROFILE=hike

SWISSTOPO_BASE_URL=https://api3.geo.admin.ch
```

For Docker Compose, the backend talks to GraphHopper through:

```bash
GRAPHHOPPER_BASE_URL=http://graphhopper:8989
```

### Production accounts and email

Set `DJANGO_ENV=production`, a long random `DJANGO_SECRET_KEY`, the public host name, and the public HTTPS origin in `DJANGO_CSRF_TRUSTED_ORIGINS` before deploying. In production the app refuses to start without that secret. Sessions use secure, HTTP-only, same-site cookies and unsafe API requests are protected with Django CSRF tokens.

Planning remains available without an account. Server-side saved tours use optional accounts with a required, verified email address. Login, registration, email verification, and password reset use Django sessions and time-limited one-time links. Authentication endpoints are rate-limited in Django's cache. For more than one backend process, configure Django's cache with a shared backend before scaling out.

Transactional email uses Brevo SMTP when an email feature is added. Create an SMTP key in Brevo, verify the sending domain, and configure these values outside git:

```bash
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_LOGIN=your-brevo-smtp-login
BREVO_SMTP_KEY=your-brevo-smtp-key
BREVO_SMTP_USE_TLS=true
DEFAULT_FROM_EMAIL=noreply@your-domain.example
PUBLIC_APP_URL=https://trail.your-domain.example
AUTH_TOKEN_TIMEOUT_SECONDS=1800
MONITORING_REPORT_RECIPIENTS=admin@your-domain.example
MONITORING_REPORT_LOOKBACK_HOURS=24
```

Brevo's SMTP key is distinct from its API key. Verify the sending domain in Brevo and configure SPF, DKIM, and DMARC before enabling production registrations. `PUBLIC_APP_URL` must be the public HTTPS origin because verification and password-reset links point back to the React app.

A configurable Django management command can send a daily, aggregate usage report through the
same SMTP account. Scheduling and server commands are documented in
[docs/deployment.md](docs/deployment.md#daily-monitoring-report).

## License

nightsky trail is released under the [MIT License](LICENSE).

The MIT license applies to this repository's source code and documentation unless stated otherwise.

Third-party datasets, map tiles, APIs, and routing data are not relicensed by this repository. swisstopo, OpenStreetMap, GraphHopper, ASTRA/SchweizMobil, and other data sources keep their own licenses, terms, attribution requirements, and usage limits.
