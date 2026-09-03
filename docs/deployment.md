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
sudo docker network ls
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
- `PUBLIC_APP_URL` (the public HTTPS origin used in account emails)

Generate a Django secret without storing it in shell history:

```bash
sudo docker run --rm python:3.13-slim python -c "import secrets; print(secrets.token_urlsafe(64))"
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
sudo docker compose --env-file .env.production -f compose.production.yaml build
sudo docker compose --env-file .env.production -f compose.production.yaml up -d nightsky_graphhopper
sudo docker compose --env-file .env.production -f compose.production.yaml logs -f nightsky_graphhopper
```

The first GraphHopper import takes several minutes. Wait until it is healthy, then apply the
database migrations and start the complete stack:

```bash
sudo docker compose --env-file .env.production -f compose.production.yaml run --rm nightsky_backend python manage.py migrate
sudo docker compose --env-file .env.production -f compose.production.yaml run --rm nightsky_backend python manage.py collectstatic --noinput
sudo docker compose --env-file .env.production -f compose.production.yaml up -d
sudo docker compose --env-file .env.production -f compose.production.yaml ps
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
sudo docker compose exec nginx nginx -t
sudo docker compose exec nginx nginx -s reload
```

Obtain the certificate using the existing certbot service. From `/opt/bantigerjersey`, the
command will usually look like this:

```bash
sudo docker compose run --rm certbot certonly \
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
sudo docker compose exec nginx nginx -t
sudo docker compose exec nginx nginx -s reload
```

The exact paths and Compose file name may differ in the existing server project. Keep its
certificate renewal process unchanged.

## Django Admin

Django Admin is available at `/admin/` for operational tasks such as inspecting accounts and
saved tours. It is not part of the public application UI.

For local development, apply migrations, create a separate superuser, and open
`http://127.0.0.1:8000/admin/`:

```bash
cd backend
uv run python manage.py migrate
uv run python manage.py createsuperuser
```

In production, the edge Nginx template deliberately denies all access to `/admin/` until its
`allow` directive is replaced with your fixed public IP address or VPN egress IP. Keep the
following structure in `/opt/bantigerjersey/nginx/conf.d/nightsky-trail.conf`:

```nginx
location ^~ /admin/ {
    allow 203.0.113.42; # Replace with your own fixed IP or VPN egress IP.
    deny all;
    # Existing proxy settings follow here.
}
```

Do not remove `deny all`, and do not use a broad office or mobile-provider range. After changing
the IP, validate and reload the existing edge Nginx:

```bash
cd /opt/bantigerjersey
sudo docker compose exec nginx nginx -t
sudo docker compose exec nginx nginx -s reload
```

Create the production superuser inside the application stack:

```bash
cd /opt/nightsky-trail
sudo docker compose --env-file .env.production -f compose.production.yaml run --rm \
  nightsky_backend python manage.py createsuperuser
```

The edge Nginx must receive the real client IP directly. If a CDN or a further reverse proxy is
placed in front of it, configure Nginx's trusted real-IP handling before relying on this allowlist.

## Updates

The repository includes an update script. It creates an online SQLite backup when the backend is
running, pulls only fast-forward changes, builds the two application images, applies migrations,
collects static files, waits for the stack health checks, and runs Django's configuration check.

```bash
cd /opt/nightsky-trail
./deploy/update.sh
```

Run it as the normal repository user, not with `sudo`. The script itself uses `sudo` for Docker.
`migrate --noinput` is safe to run on every update: it exits without changing the database when
there are no pending migrations.

Old images can be removed later with the server's normal Docker maintenance process. Do not
delete the persistent `data` directory during an update.

## Backup and restore

The user accounts and saved tours are stored in `data/app/db.sqlite3`. The backup command uses
SQLite's online backup API, verifies the copy, and removes old generations. The backend does not
need to be stopped. `DATABASE_BACKUP_KEEP` defaults to 14 backups.

```bash
cd /opt/nightsky-trail
sudo docker compose --env-file .env.production -f compose.production.yaml exec -T \
  nightsky_backend python manage.py backup_database
ls -lh data/app/backups/
```

Back up `.env.production` in the server's secret-management or encrypted backup system. It
must never be committed. The OSM extract, GraphHopper cache, swisstopo dataset, and OSM index
can be regenerated and do not need the same backup priority.

To restore a selected backup, stop the backend and remove stale SQLite WAL files before starting
it again:

```bash
cd /opt/nightsky-trail
sudo docker compose --env-file .env.production -f compose.production.yaml stop nightsky_backend
cp data/app/backups/nightsky-trail-YYYYMMDD-HHMMSS.sqlite3 data/app/db.sqlite3
rm -f data/app/db.sqlite3-wal data/app/db.sqlite3-shm
chown 10001:10001 data/app/db.sqlite3
sudo docker compose --env-file .env.production -f compose.production.yaml start nightsky_backend
```

## Operations

Useful commands:

```bash
sudo docker compose --env-file .env.production -f compose.production.yaml ps
sudo docker compose --env-file .env.production -f compose.production.yaml logs -f nightsky_backend
sudo docker compose --env-file .env.production -f compose.production.yaml logs -f nightsky_graphhopper
sudo docker compose --env-file .env.production -f compose.production.yaml restart nightsky_backend
```

### Daily monitoring report

Set `MONITORING_REPORT_RECIPIENTS` in `.env.production` to one or more comma-separated
addresses. `MONITORING_REPORT_LOOKBACK_HOURS` controls the statistics window and defaults to
24 hours. The report contains aggregate account and saved-tour counts only; it does not include
email addresses or route data.

Test the report manually:

```bash
sudo docker compose --env-file .env.production -f compose.production.yaml exec -T \
  nightsky_backend python manage.py send_monitoring_report --dry-run
sudo docker compose --env-file .env.production -f compose.production.yaml exec -T \
  nightsky_backend python manage.py send_monitoring_report
```

Schedule both commands on the host with `sudo crontab -e`. This example creates a database
backup at 06:00 and sends the report, including the backup status, at 06:15:

```cron
0 6 * * * cd /opt/nightsky-trail && /usr/bin/docker compose --env-file .env.production -f compose.production.yaml exec -T nightsky_backend python manage.py backup_database >> /var/log/nightsky-trail-backup.log 2>&1
15 6 * * * cd /opt/nightsky-trail && /usr/bin/docker compose --env-file .env.production -f compose.production.yaml exec -T nightsky_backend python manage.py send_monitoring_report >> /var/log/nightsky-trail-monitoring.log 2>&1
```

Do not add `sudo` inside these cron lines: `sudo crontab -e` installs them in root's crontab,
so they already run with the required Docker permissions.

Change the cron expression to change the delivery schedule. Because this command runs inside
the application container, it cannot report a stopped container; retain a separate external
HTTP uptime check for availability alerts.

These backups remain on the same server and protect against accidental deletion or database
corruption. Copy the backup directory to another machine or storage provider if protection
against complete server or disk loss is required.

Do not scale the Django backend above one process yet. Rate limits plus elevation and search
results use the in-process Django cache, and SQLite is intentionally retained for this lightweight deployment.
A shared cache and PostgreSQL should be introduced together only when actual load requires it.
