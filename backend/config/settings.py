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
    "rest_framework",
    "drf_spectacular",
    "planner",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
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
    "TITLE": "Swiss Route Planner API",
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
