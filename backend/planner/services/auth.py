from __future__ import annotations

from hashlib import sha256

from django.conf import settings
from django.core.cache import cache


def login_attempt_allowed(request: object, identifier: str) -> bool:
    return _attempt_allowed(
        "login",
        request,
        identifier,
        settings.AUTH_LOGIN_RATE_LIMIT,
        settings.AUTH_LOGIN_RATE_WINDOW_SECONDS,
    )


def registration_attempt_allowed(request: object, identifier: str) -> bool:
    return _attempt_allowed(
        "register",
        request,
        identifier,
        settings.AUTH_REGISTER_RATE_LIMIT,
        settings.AUTH_REGISTER_RATE_WINDOW_SECONDS,
    )


def password_reset_attempt_allowed(request: object, identifier: str) -> bool:
    return _attempt_allowed(
        "password-reset",
        request,
        identifier,
        settings.AUTH_PASSWORD_RESET_RATE_LIMIT,
        settings.AUTH_PASSWORD_RESET_RATE_WINDOW_SECONDS,
    )


def _attempt_allowed(
    action: str,
    request: object,
    identifier: str,
    limit: int,
    window_seconds: int,
) -> bool:
    if limit <= 0:
        return True

    request_meta = getattr(request, "META", {})
    remote_address = str(request_meta.get("REMOTE_ADDR", "unknown"))
    keys = (
        _rate_limit_key(action, "ip", remote_address),
        _rate_limit_key(action, "identifier", identifier.casefold()),
    )
    return all(_consume(key, limit, window_seconds) for key in keys)


def _consume(key: str, limit: int, window_seconds: int) -> bool:
    if cache.add(key, 1, timeout=window_seconds):
        return True

    try:
        attempts = cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=window_seconds)
        return True
    return attempts <= limit


def _rate_limit_key(action: str, scope: str, value: str) -> str:
    identifier = sha256(value.encode("utf-8")).hexdigest()
    return f"auth-rate-limit:{action}:{scope}:{identifier}"
