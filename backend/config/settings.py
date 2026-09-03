from __future__ import annotations

import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

DJANGO_ENV = os.environ.get("DJANGO_ENV", "development").lower()
DEBUG = os.environ.get("DJANGO_DEBUG", str(DJANGO_ENV != "production")).lower() == "true"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if DJANGO_ENV != "production":
        SECRET_KEY = "development-only-secret-key"
    else:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set in production.")

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "DJANGO_CSRF_TRUSTED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.messages",
    "django.contrib.sessions",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "planner",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES: list[dict[str, object]] = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]
WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": Path(os.environ.get("DJANGO_DATABASE_PATH", BASE_DIR / "db.sqlite3")),
    }
}

LANGUAGE_CODE = "de-ch"
TIME_ZONE = "Europe/Zurich"
USE_I18N = True
USE_TZ = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

STATIC_URL = "/static/"
STATIC_ROOT = Path(os.environ.get("DJANGO_STATIC_ROOT", BASE_DIR / "staticfiles"))

SESSION_COOKIE_NAME = "nightsky_sessionid"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_AGE = int(os.environ.get("DJANGO_SESSION_COOKIE_AGE_SECONDS", "1209600"))
CSRF_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SAMESITE = "Lax"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

EMAIL_BACKEND = os.environ.get(
    "DJANGO_EMAIL_BACKEND",
    "django.core.mail.backends.console.EmailBackend"
    if DEBUG
    else "django.core.mail.backends.smtp.EmailBackend",
)
EMAIL_HOST = os.environ.get("BREVO_SMTP_HOST", "smtp-relay.brevo.com")
EMAIL_PORT = int(os.environ.get("BREVO_SMTP_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("BREVO_SMTP_LOGIN", "")
EMAIL_HOST_PASSWORD = os.environ.get("BREVO_SMTP_KEY", "")
EMAIL_USE_TLS = os.environ.get("BREVO_SMTP_USE_TLS", "true").lower() == "true"
EMAIL_TIMEOUT = int(os.environ.get("BREVO_SMTP_TIMEOUT_SECONDS", "10"))
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "noreply@nightskytrail.ch")
SERVER_EMAIL = DEFAULT_FROM_EMAIL
PUBLIC_APP_URL = os.environ.get("PUBLIC_APP_URL", "http://localhost:5173").rstrip("/")
PASSWORD_RESET_TIMEOUT = int(os.environ.get("AUTH_TOKEN_TIMEOUT_SECONDS", "1800"))
MONITORING_REPORT_RECIPIENTS = [
    address.strip()
    for address in os.environ.get("MONITORING_REPORT_RECIPIENTS", "").split(",")
    if address.strip()
]
MONITORING_REPORT_LOOKBACK_HOURS = int(os.environ.get("MONITORING_REPORT_LOOKBACK_HOURS", "24"))
DATABASE_BACKUP_DIR = Path(
    os.environ.get(
        "DATABASE_BACKUP_DIR",
        Path(DATABASES["default"]["NAME"]).parent / "backups",
    )
)
DATABASE_BACKUP_KEEP = int(os.environ.get("DATABASE_BACKUP_KEEP", "14"))
TRUST_PROXY_CLIENT_IP = (
    os.environ.get(
        "DJANGO_TRUST_PROXY_CLIENT_IP",
        str(DJANGO_ENV == "production"),
    ).lower()
    == "true"
)

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

AUTH_LOGIN_RATE_LIMIT = int(os.environ.get("AUTH_LOGIN_RATE_LIMIT", "8"))
AUTH_LOGIN_RATE_WINDOW_SECONDS = int(os.environ.get("AUTH_LOGIN_RATE_WINDOW_SECONDS", "300"))
AUTH_REGISTER_RATE_LIMIT = int(os.environ.get("AUTH_REGISTER_RATE_LIMIT", "5"))
AUTH_REGISTER_RATE_WINDOW_SECONDS = int(os.environ.get("AUTH_REGISTER_RATE_WINDOW_SECONDS", "3600"))
AUTH_PASSWORD_RESET_RATE_LIMIT = int(os.environ.get("AUTH_PASSWORD_RESET_RATE_LIMIT", "5"))
AUTH_PASSWORD_RESET_RATE_WINDOW_SECONDS = int(
    os.environ.get("AUTH_PASSWORD_RESET_RATE_WINDOW_SECONDS", "3600")
)
AUTH_VERIFICATION_EMAIL_RATE_LIMIT = int(os.environ.get("AUTH_VERIFICATION_EMAIL_RATE_LIMIT", "3"))
AUTH_VERIFICATION_EMAIL_RATE_WINDOW_SECONDS = int(
    os.environ.get("AUTH_VERIFICATION_EMAIL_RATE_WINDOW_SECONDS", "3600")
)
PUBLIC_API_RATE_WINDOW_SECONDS = int(os.environ.get("PUBLIC_API_RATE_WINDOW_SECONDS", "300"))
ROUTE_RATE_LIMIT = int(os.environ.get("ROUTE_RATE_LIMIT", "180"))
ELEVATION_RATE_LIMIT = int(os.environ.get("ELEVATION_RATE_LIMIT", "120"))
SEARCH_RATE_LIMIT = int(os.environ.get("SEARCH_RATE_LIMIT", "180"))
ELEVATION_CACHE_TIMEOUT_SECONDS = int(os.environ.get("ELEVATION_CACHE_TIMEOUT_SECONDS", "86400"))
SEARCH_CACHE_TIMEOUT_SECONDS = int(os.environ.get("SEARCH_CACHE_TIMEOUT_SECONDS", "86400"))

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
