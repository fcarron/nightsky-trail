#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

compose=(sudo docker compose --env-file .env.production -f compose.production.yaml)

if "${compose[@]}" ps --status running -q nightsky_backend | grep -q .; then
  echo "Creating database backup..."
  "${compose[@]}" exec -T nightsky_backend python manage.py backup_database
else
  echo "Backend is not running; skipping database backup."
fi

echo "Updating source..."
git pull --ff-only

echo "Building application images..."
"${compose[@]}" build nightsky_backend nightsky_gateway

echo "Applying database migrations..."
"${compose[@]}" run --rm nightsky_backend python manage.py migrate --noinput

echo "Collecting static files..."
"${compose[@]}" run --rm nightsky_backend python manage.py collectstatic --noinput

echo "Starting updated services..."
"${compose[@]}" up -d --wait --wait-timeout 180

echo "Checking Django configuration..."
"${compose[@]}" exec -T nightsky_backend python manage.py check
"${compose[@]}" ps
