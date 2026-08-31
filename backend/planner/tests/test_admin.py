from __future__ import annotations

import pytest
from django.contrib import admin
from django.urls import reverse
from rest_framework.test import APIClient

from planner.models import SavedTour


@pytest.mark.django_db
def test_admin_login_route_is_available() -> None:
    client = APIClient()

    response = client.get(reverse("admin:index"))

    assert response.status_code == 302
    assert response.url == f"{reverse('admin:login')}?next={reverse('admin:index')}"


def test_saved_tours_are_registered_in_admin() -> None:
    assert SavedTour in admin.site._registry
