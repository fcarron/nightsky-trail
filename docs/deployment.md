# Production deployment

This deployment keeps nightsky trail separate from other applications on the server. Its
gateway joins the existing edge network, while Django and GraphHopper remain on a private
application network.

```text
Internet
  -> existing bantiger nginx (TLS)
  -> nightsky_gateway (React and /api proxy)
  -> nightsky_backend
  -> nightsky_graphhopper
```

Only the existing edge Nginx publishes ports 80 and 443. The nightsky trail Compose stack
does not publish host ports.

## Server requirements

- Docker Engine with the Compose plugin
- an existing external Docker network shared with the edge Nginx
- at least 4 GB RAM; GraphHopper is the largest consumer
- enough disk space for the Swiss OSM extract and graph cache
- a DNS name pointing to the server

Confirm the real edge-network name before configuring the app:

```bash
docker network ls
```

For the existing `/opt/bantigerjersey` Compose project it will normally be
`bantigerjersey_webnet`.

## Initial installation

Clone the repository and create the production configuration:

```bash
cd /opt
git clone https://github.com/fcarron/nightsky-trail.git nightsky-trail
cd /opt/nightsky-trail
cp .env.production.example .env.production
```

Edit `.env.production` and set at least:

- `NIGHTSKY_EDGE_NETWORK`
- `DJANGO_SECRET_KEY`
- `DJANGO_ALLOWED_HOSTS` (public domain plus `nightsky_backend,127.0.0.1,localhost`)
- `DJANGO_CSRF_TRUSTED_ORIGINS`
- the Brevo SMTP credentials and sender address

Generate a Django secret without storing it in shell history:

```bash
docker run --rm python:3.13-slim python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Create persistent directories. UID 10001 is the non-root Django user in the backend image:

```bash
install -d -o 10001 -g 10001 /opt/nightsky-trail/data/app
install -d -o 10001 -g 10001 /opt/nightsky-trail/data/osm
install -d -o 10001 -g 10001 /opt/nightsky-trail/data/swisstopo
install -d /opt/nightsky-trail/data/graphhopper
```

Download the Switzerland OSM extract:

```bash
curl -L --fail \
  -o /opt/nightsky-trail/data/osm/switzerland-latest.osm.pbf \
  https://download.geofabrik.de/europe/switzerland-latest.osm.pbf
chown 10001:10001 /opt/nightsky-trail/data/osm/switzerland-latest.osm.pbf
```

Build the application images and start GraphHopper first:

```bash
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml up -d nightsky_graphhopper
docker compose --env-file .env.production -f compose.production.yaml logs -f nightsky_graphhopper
```

The first GraphHopper import takes several minutes. Wait until it is healthy, then apply the
database migrations and start the complete stack:

```bash
docker compose --env-file .env.production -f compose.production.yaml run --rm nightsky_backend python manage.py migrate
docker compose --env-file .env.production -f compose.production.yaml up -d
docker compose --env-file .env.production -f compose.production.yaml ps
```

The swisstopo hiking-trail GeoPackage and local OSM trail index are created lazily in the
persistent data directories on first use.

## Connect the existing edge Nginx

For the first certificate, copy `deploy/nginx/nightsky-trail-http.conf.example` to the existing
server's Nginx `conf.d` directory. Open the copied file and replace every occurrence of
`trail.example.com` with the real hostname:

```bash
cp /opt/nightsky-trail/deploy/nginx/nightsky-trail-http.conf.example \
  /opt/bantigerjersey/nginx/conf.d/nightsky-trail.conf
nano /opt/bantigerjersey/nginx/conf.d/nightsky-trail.conf
```

Test and reload Nginx so that the ACME challenge location is active:

```bash
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

Obtain the certificate using the existing certbot service. From `/opt/bantigerjersey`, the
command will usually look like this:

```bash
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d trail.example.com
```

After certbot succeeds, replace the temporary file with the HTTPS template. This copy contains
the placeholders again, so open the copied file and replace every `trail.example.com`, including
the certificate paths:

```bash
cp /opt/nightsky-trail/deploy/nginx/nightsky-trail.conf.example \
  /opt/bantigerjersey/nginx/conf.d/nightsky-trail.conf
nano /opt/bantigerjersey/nginx/conf.d/nightsky-trail.conf
```

The upstream name is the Compose service `nightsky_gateway`, which is resolvable because both
containers share the external edge network. Validate and reload the existing Nginx:

```bash
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

The exact paths and Compose file name may differ in the existing server project. Keep its
certificate renewal process unchanged.

## Updates

```bash
cd /opt/nightsky-trail
git pull --ff-only
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml run --rm nightsky_backend python manage.py migrate
docker compose --env-file .env.production -f compose.production.yaml up -d
```

Old images can be removed later with the server's normal Docker maintenance process. Do not
delete the persistent `data` directory during an update.

## Backup and restore

The user accounts and saved tours are stored in `data/app/db.sqlite3`. For a simple consistent
backup, briefly stop the backend, copy the database, and start it again:

```bash
cd /opt/nightsky-trail
docker compose --env-file .env.production -f compose.production.yaml stop nightsky_backend
cp data/app/db.sqlite3 /srv/backups/nightsky-trail-db.sqlite3
docker compose --env-file .env.production -f compose.production.yaml start nightsky_backend
```

Back up `.env.production` in the server's secret-management or encrypted backup system. It
must never be committed. The OSM extract, GraphHopper cache, swisstopo dataset, and OSM index
can be regenerated and do not need the same backup priority.

To restore, stop the backend, replace `data/app/db.sqlite3`, ensure ownership is `10001:10001`,
and start the backend again.

## Operations

Useful commands:

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs -f nightsky_backend
docker compose --env-file .env.production -f compose.production.yaml logs -f nightsky_graphhopper
docker compose --env-file .env.production -f compose.production.yaml restart nightsky_backend
```

Do not scale the Django backend above one process yet. Authentication rate limits use the
in-process Django cache, and SQLite is intentionally retained for this lightweight deployment.
A shared cache and PostgreSQL should be introduced together only when actual load requires it.
