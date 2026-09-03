from __future__ import annotations

from django.conf import settings

from planner.services.rate_limit import consume_rate_limit, request_client_ip


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


def verification_email_attempt_allowed(request: object, identifier: str) -> bool:
    return _attempt_allowed(
        "verification-email",
        request,
        identifier,
        settings.AUTH_VERIFICATION_EMAIL_RATE_LIMIT,
        settings.AUTH_VERIFICATION_EMAIL_RATE_WINDOW_SECONDS,
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

    return consume_rate_limit(
        action,
        "ip",
        request_client_ip(request),
        limit=limit,
        window_seconds=window_seconds,
    ) and consume_rate_limit(
        action,
        "identifier",
        identifier.casefold(),
        limit=limit,
        window_seconds=window_seconds,
    )
