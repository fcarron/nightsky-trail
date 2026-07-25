# GitHub Preparation

This checklist keeps repository publication separate from production deployment.

## Ready To Publish

- Source code, tests, docs, and dependency lock files are kept in git.
- Local data files are ignored: OSM extracts, GraphHopper graph cache, swisstopo GeoPackages, SQLite databases, `.env`, and build outputs.
- CI is configured in `.github/workflows/ci.yml` for backend and frontend checks.
- Public documentation explains the MVP scope, local setup, API endpoints, data sources, and known operational limitations.

## Before Public Push

- Choose and add a code license, for example `MIT`, `Apache-2.0`, or another explicit license.
- Decide whether the repository should include issue templates, PR templates, or contribution guidelines.
- Review screenshots, examples, and docs for private routes, usernames, hostnames, or credentials.
- Confirm that no `.env`, database, OSM extract, GraphHopper cache, or downloaded swisstopo dataset is staged.

Useful commands:

```bash
git status --short
git ls-files | rg '(^data/|\.env$|\.sqlite3$|\.osm\.pbf$|\.gpkg|node_modules|dist/)'
git diff --check
```

## Before Public Deployment

- Set `DJANGO_DEBUG=false`.
- Use a strong `DJANGO_SECRET_KEY` from the deployment environment.
- Configure `DJANGO_ALLOWED_HOSTS` and CORS for the real domain.
- Serve the app over HTTPS.
- Persist and back up the Django database if saved tours are used.
- Rebuild the GraphHopper cache whenever routing profiles or the OSM extract change.
- Avoid relying on public Overpass for production traffic; use local/imported OSM data.
- Keep swisstopo, OpenStreetMap, and OpenTopoMap attribution visible.
- Clarify swisstopo service-load expectations before heavy public usage.
