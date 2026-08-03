from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "development-only-secret-key")
DEBUG = os.environ.get("DJANGO_DEBUG", "false").lower() == "true"
ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "rest_framework",
    "drf_spectacular",
    "planner",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES: list[dict[str, object]] = []
WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

LANGUAGE_CODE = "de-ch"
TIME_ZONE = "Europe/Zurich"
USE_I18N = True
USE_TZ = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "EXCEPTION_HANDLER": "planner.api.exceptions.api_exception_handler",
    "UNAUTHENTICATED_TOKEN": None,
    "UNAUTHENTICATED_USER": None,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "nightsky trail API",
    "DESCRIPTION": "Planning-first route API for Switzerland.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

GRAPHHOPPER_BASE_URL = os.environ.get("GRAPHHOPPER_BASE_URL", "http://localhost:8989")
GRAPHHOPPER_PROFILE = os.environ.get("GRAPHHOPPER_PROFILE", "hike")
GRAPHHOPPER_TIMEOUT_SECONDS = float(os.environ.get("GRAPHHOPPER_TIMEOUT_SECONDS", "10"))
SWISSTOPO_BASE_URL = os.environ.get("SWISSTOPO_BASE_URL", "https://api3.geo.admin.ch")
SWISSTOPO_TIMEOUT_SECONDS = float(os.environ.get("SWISSTOPO_TIMEOUT_SECONDS", "10"))
OVERPASS_BASE_URL = os.environ.get("OVERPASS_BASE_URL", "https://overpass-api.de/api")
OVERPASS_TIMEOUT_SECONDS = float(os.environ.get("OVERPASS_TIMEOUT_SECONDS", "12"))
OSM_PBF_PATH = Path(
    os.environ.get("OSM_PBF_PATH", BASE_DIR.parent / "data/osm/switzerland-latest.osm.pbf")
)
OSM_TRAIL_INDEX_PATH = Path(
    os.environ.get("OSM_TRAIL_INDEX_PATH", BASE_DIR.parent / "data/osm/trails.sqlite3")
)
SWISSTOPO_TRAILS_URL = os.environ.get(
    "SWISSTOPO_TRAILS_URL",
    "https://data.geo.admin.ch/ch.swisstopo.swisstlm3d-wanderwege/swisstlm3d-wanderwege/swisstlm3d-wanderwege_2056_5728.gpkg.zip",
)
SWISSTOPO_TRAILS_ZIP_PATH = Path(
    os.environ.get(
        "SWISSTOPO_TRAILS_ZIP_PATH",
        BASE_DIR.parent / "data/swisstopo/swisstlm3d-wanderwege_2056_5728.gpkg.zip",
    )
)
SWISSTOPO_TRAILS_GPKG_PATH = Path(
    os.environ.get(
        "SWISSTOPO_TRAILS_GPKG_PATH",
        BASE_DIR.parent / "data/swisstopo/swisstlm3d-wanderwege_2056_5728.gpkg",
    )
)
SWISSTOPO_TRAILS_TIMEOUT_SECONDS = float(os.environ.get("SWISSTOPO_TRAILS_TIMEOUT_SECONDS", "60"))
TRAILS_CACHE_TIMEOUT_SECONDS = int(os.environ.get("TRAILS_CACHE_TIMEOUT_SECONDS", "300"))
TRAILS_CACHE_BBOX_DECIMALS = int(os.environ.get("TRAILS_CACHE_BBOX_DECIMALS", "3"))
TRAILS_DEBUG_MIN_ZOOM = int(os.environ.get("TRAILS_DEBUG_MIN_ZOOM", "15"))
TRAILS_DEBUG_MAX_BBOX_AREA = float(os.environ.get("TRAILS_DEBUG_MAX_BBOX_AREA", "0.004"))

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
        },
    },
    "loggers": {
        "planner": {
            "handlers": ["console"],
            "level": os.environ.get("PLANNER_LOG_LEVEL", "INFO"),
            "propagate": False,
        },
    },
}
