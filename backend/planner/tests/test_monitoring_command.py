from __future__ import annotations

from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings

from planner.models import SavedTour


@pytest.mark.django_db
@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    MONITORING_REPORT_RECIPIENTS=["monitor@example.com"],
    PUBLIC_APP_URL="https://trail.example.com",
)
def test_sends_privacy_conscious_monitoring_report() -> None:
    user_model = get_user_model()
    active_user = user_model.objects.create_user(
        username="runner@example.com",
        email="runner@example.com",
        password="strong-test-password",
    )
    user_model.objects.create_user(
        username="pending@example.com",
        email="pending@example.com",
        password="strong-test-password",
        is_active=False,
    )
    SavedTour.objects.create(
        owner=active_user,
        name="Private route name",
        route_data={"waypoints": [], "segments": []},
    )

    call_command("send_monitoring_report")

    assert len(mail.outbox) == 1
    report = mail.outbox[0]
    assert report.to == ["monitor@example.com"]
    assert "Gesamt: 2" in report.body
    assert "Bestätigt: 1" in report.body
    assert "Gesamt: 1" in report.body
    assert "https://trail.example.com" in report.body
    assert "runner@example.com" not in report.body
    assert "Private route name" not in report.body


@pytest.mark.django_db
@override_settings(MONITORING_REPORT_RECIPIENTS=[])
def test_requires_a_recipient_unless_dry_run() -> None:
    with pytest.raises(CommandError, match="MONITORING_REPORT_RECIPIENTS"):
        call_command("send_monitoring_report")

    output = StringIO()
    call_command("send_monitoring_report", dry_run=True, stdout=output)
    assert "täglicher Bericht" in output.getvalue()
