from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.core.validators import validate_email
from django.utils import timezone

from planner.models import SavedTour


class Command(BaseCommand):
    help = "Send a privacy-conscious nightsky trail usage report by email."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--hours",
            type=int,
            default=settings.MONITORING_REPORT_LOOKBACK_HOURS,
            help="Reporting window in hours.",
        )
        parser.add_argument(
            "--recipient",
            action="append",
            dest="recipients",
            help="Override configured recipients; may be passed more than once.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print the report without sending email.",
        )

    def handle(self, *args: object, **options: object) -> None:
        hours = options["hours"]
        if not isinstance(hours, int) or not 1 <= hours <= 24 * 31:
            raise CommandError("--hours must be between 1 and 744.")

        recipients = options.get("recipients") or settings.MONITORING_REPORT_RECIPIENTS
        if not recipients and not options["dry_run"]:
            raise CommandError("Configure MONITORING_REPORT_RECIPIENTS or pass --recipient.")
        _validate_recipients(recipients)

        now = timezone.now()
        since = now - timedelta(hours=hours)
        user_model = get_user_model()
        users = user_model.objects.all()
        tours = SavedTour.objects.all()

        subject = f"[nightsky trail] Bericht {timezone.localtime(now):%Y-%m-%d}"
        body = "\n".join(
            [
                "nightsky trail – täglicher Bericht",
                "",
                f"Zeitraum: letzte {hours} Stunden",
                f"Stand: {timezone.localtime(now):%Y-%m-%d %H:%M %Z}",
                f"App: {settings.PUBLIC_APP_URL}",
                "",
                "Konten",
                f"- Gesamt: {users.count()}",
                f"- Bestätigt: {users.filter(is_active=True).count()}",
                f"- Bestätigung ausstehend: {users.filter(is_active=False).count()}",
                f"- Neu im Zeitraum: {users.filter(date_joined__gte=since).count()}",
                f"- Angemeldet im Zeitraum: {users.filter(last_login__gte=since).count()}",
                "",
                "Gespeicherte Touren",
                f"- Gesamt: {tours.count()}",
                f"- Neu im Zeitraum: {tours.filter(created_at__gte=since).count()}",
                f"- Bearbeitet im Zeitraum: {tours.filter(updated_at__gte=since).count()}",
                f"- Konten mit Touren: {tours.values('owner_id').distinct().count()}",
                "",
                "Status: Django und Datenbankabfragen erfolgreich.",
                "Der Bericht enthält keine E-Mail-Adressen oder Routendaten.",
            ]
        )

        if options["dry_run"]:
            self.stdout.write(subject)
            self.stdout.write(body)
            return

        send_mail(
            subject,
            body,
            settings.DEFAULT_FROM_EMAIL,
            recipients,
            fail_silently=False,
        )
        self.stdout.write(
            self.style.SUCCESS(f"Monitoring report sent to {len(recipients)} recipient(s).")
        )


def _validate_recipients(recipients: list[str]) -> None:
    for recipient in recipients:
        try:
            validate_email(recipient)
        except ValidationError as error:
            raise CommandError(f"Invalid monitoring recipient: {recipient}") from error
