from __future__ import annotations

from typing import Protocol
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth.tokens import PasswordResetTokenGenerator, default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode


class AccountEmailUnavailableError(Exception):
    pass


class AccountEmailUser(Protocol):
    pk: object
    email: str
    is_active: bool


class EmailVerificationTokenGenerator(PasswordResetTokenGenerator):
    def _make_hash_value(self, user: AccountEmailUser, timestamp: int) -> str:
        return f"{super()._make_hash_value(user, timestamp)}{user.is_active}"


email_verification_token_generator = EmailVerificationTokenGenerator()


def send_verification_email(user: AccountEmailUser) -> None:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = email_verification_token_generator.make_token(user)
    link = _frontend_link("verify-email", uid, token)
    try:
        send_mail(
            "E-Mail für nightsky trail bestätigen",
            (
                "Bestätige deine E-Mail-Adresse für nightsky trail:\n\n"
                f"{link}\n\n"
                "Der Link ist zeitlich begrenzt. Falls du kein Konto erstellt hast, "
                "kannst du diese Nachricht ignorieren."
            ),
            settings.DEFAULT_FROM_EMAIL,
            [user.email],
            fail_silently=False,
        )
    except Exception as error:
        raise AccountEmailUnavailableError from error


def send_password_reset_email(user: AccountEmailUser) -> None:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    link = _frontend_link("reset-password", uid, token)
    try:
        send_mail(
            "Passwort für nightsky trail zurücksetzen",
            (
                "Über diesen Link kannst du dein Passwort für nightsky trail zurücksetzen:\n\n"
                f"{link}\n\n"
                "Der Link ist zeitlich begrenzt. Falls du keinen Reset angefordert hast, "
                "kannst du diese Nachricht ignorieren."
            ),
            settings.DEFAULT_FROM_EMAIL,
            [user.email],
            fail_silently=False,
        )
    except Exception as error:
        raise AccountEmailUnavailableError from error


def _frontend_link(action: str, uid: str, token: str) -> str:
    query = urlencode({"auth_action": action, "uid": uid, "token": token})
    return f"{settings.PUBLIC_APP_URL}/?{query}"
