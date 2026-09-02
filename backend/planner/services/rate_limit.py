from __future__ import annotations

from hashlib import sha256
from ipaddress import ip_address

from django.conf import settings
from django.core.cache import cache


def request_rate_limit_allowed(
    action: str,
    request: object,
    *,
    limit: int,
    window_seconds: int,
) -> bool:
    return consume_rate_limit(
        action,
        "ip",
        request_client_ip(request),
        limit=limit,
        window_seconds=window_seconds,
    )


def consume_rate_limit(
    action: str,
    scope: str,
    value: str,
    *,
    limit: int,
    window_seconds: int,
) -> bool:
    if limit <= 0:
        return True

    key = rate_limit_key(action, scope, value)
    if cache.add(key, 1, timeout=window_seconds):
        return True

    try:
        attempts = cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=window_seconds)
        return True
    return attempts <= limit


def request_client_ip(request: object) -> str:
    request_meta = getattr(request, "META", {})
    if settings.TRUST_PROXY_CLIENT_IP:
        forwarded_address = validated_ip(request_meta.get("HTTP_X_REAL_IP"))
        if forwarded_address:
            return forwarded_address
    return validated_ip(request_meta.get("REMOTE_ADDR")) or "unknown"


def validated_ip(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        return str(ip_address(value.strip()))
    except ValueError:
        return None


def rate_limit_key(action: str, scope: str, value: str) -> str:
    identifier = sha256(value.encode("utf-8")).hexdigest()
    return f"rate-limit:{action}:{scope}:{identifier}"
