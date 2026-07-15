.PHONY: bootstrap dev graphhopper test lint format build backend-test backend-lint frontend-test frontend-lint

bootstrap:
	cd backend && uv sync
	cd frontend && npm install

dev:
	$(MAKE) -j2 backend-dev frontend-dev

graphhopper:
	mkdir -p data/osm data/graphhopper
	test -f data/osm/switzerland-latest.osm.pbf || curl -L --fail -o data/osm/switzerland-latest.osm.pbf https://download.geofabrik.de/europe/switzerland-latest.osm.pbf
	docker compose up -d graphhopper

backend-dev:
	cd backend && uv run python manage.py runserver 127.0.0.1:8000

frontend-dev:
	cd frontend && npm run dev -- --host 127.0.0.1

test: backend-test frontend-test

backend-test:
	cd backend && uv run pytest

frontend-test:
	cd frontend && npm run test -- --run

lint: backend-lint frontend-lint

backend-lint:
	cd backend && uv run ruff check .
	cd backend && uv run ruff format --check .

frontend-lint:
	cd frontend && npm run lint
	cd frontend && npm run typecheck
	cd frontend && npm run format:check

format:
	cd backend && uv run ruff format .
	cd frontend && npm run format

build:
	cd frontend && npm run build
