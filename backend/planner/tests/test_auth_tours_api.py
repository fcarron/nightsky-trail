from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APIClient


@pytest.fixture(autouse=True)
def clear_auth_rate_limit_cache() -> None:
    cache.clear()


@pytest.mark.django_db
@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
def test_register_requires_email_verification() -> None:
    client = APIClient()

    response = client.post(
        reverse("auth-register"),
        {"email": "Runner@example.com", "password": "correct-horse"},
        format="json",
    )

    assert response.status_code == 202
    assert response.json() == {"authenticated": False, "user": None}
    user = get_user_model().objects.get(username="runner@example.com")
    assert user.email == "runner@example.com"
    assert user.is_active is False
    assert len(mail.outbox) == 1
    assert "auth_action=verify-email" in mail.outbox[0].body

    session_response = client.get(reverse("auth-session"))
    assert session_response.status_code == 200
    assert session_response.json()["authenticated"] is False


@pytest.mark.django_db
@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
def test_email_verification_activates_and_logs_in_user() -> None:
    client = APIClient()
    client.post(
        reverse("auth-register"),
        {"email": "runner@example.com", "password": "correct-horse"},
        format="json",
    )
    query = mail.outbox[0].body.split("?", maxsplit=1)[1].splitlines()[0]
    parameters = dict(item.split("=", maxsplit=1) for item in query.split("&"))

    response = client.post(
        reverse("auth-verify-email"),
        {"uid": parameters["uid"], "token": parameters["token"]},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["authenticated"] is True
    assert response.json()["user"]["email"] == "runner@example.com"
    assert get_user_model().objects.get(username="runner@example.com").is_active is True


@pytest.mark.django_db
@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
def test_unverified_account_cannot_log_in() -> None:
    client = APIClient()
    client.post(
        reverse("auth-register"),
        {"email": "runner@example.com", "password": "correct-horse"},
        format="json",
    )

    response = client.post(
        reverse("auth-login"),
        {"email": "runner@example.com", "password": "correct-horse"},
        format="json",
    )

    assert response.status_code == 401
    assert response.json()["code"] == "invalid_credentials"


@pytest.mark.django_db
@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
def test_password_reset_uses_neutral_response_and_one_time_token() -> None:
    user = get_user_model().objects.create_user(
        username="runner@example.com",
        email="runner@example.com",
        password="correct-horse",
    )
    client = APIClient()

    missing_response = client.post(
        reverse("auth-password-reset-request"),
        {"email": "missing@example.com"},
        format="json",
    )
    response = client.post(
        reverse("auth-password-reset-request"),
        {"email": "runner@example.com"},
        format="json",
    )

    assert missing_response.json() == response.json() == {"sent": True}
    assert len(mail.outbox) == 1
    query = mail.outbox[0].body.split("?", maxsplit=1)[1].splitlines()[0]
    parameters = dict(item.split("=", maxsplit=1) for item in query.split("&"))
    payload = {
        "uid": parameters["uid"],
        "token": parameters["token"],
        "password": "new-correct-horse",
    }

    confirm_response = client.post(reverse("auth-password-reset-confirm"), payload, format="json")
    repeated_response = client.post(reverse("auth-password-reset-confirm"), payload, format="json")

    assert confirm_response.status_code == 200
    assert repeated_response.status_code == 422
    user.refresh_from_db()
    assert user.check_password("new-correct-horse")


@pytest.mark.django_db
def test_tours_require_login() -> None:
    client = APIClient()

    response = client.get(reverse("tour-list"))

    assert response.status_code == 401
    assert response.json()["code"] == "authentication_required"


@pytest.mark.django_db
def test_user_can_create_list_update_and_delete_tour() -> None:
    client = authenticated_client("runner@example.com")
    route_data = {
        "waypoints": [
            {"id": "a", "position": {"lon": 7.4, "lat": 46.9}},
            {"id": "b", "position": {"lon": 7.5, "lat": 47.0}},
        ],
        "segments": [
            {
                "id": "a-b",
                "fromWaypointId": "a",
                "toWaypointId": "b",
                "mode": "routed",
            }
        ],
    }

    create_response = client.post(
        reverse("tour-list"),
        {"name": "Lunch loop", "routeData": route_data},
        format="json",
    )

    assert create_response.status_code == 200
    tour = create_response.json()["tour"]
    assert tour["name"] == "Lunch loop"
    assert tour["routeData"] == route_data

    list_response = client.get(reverse("tour-list"))

    assert list_response.status_code == 200
    assert [item["name"] for item in list_response.json()["tours"]] == ["Lunch loop"]

    update_response = client.patch(
        reverse("tour-detail", kwargs={"tour_id": tour["id"]}),
        {"name": "Evening loop"},
        format="json",
    )

    assert update_response.status_code == 200
    assert update_response.json()["tour"]["name"] == "Evening loop"

    delete_response = client.delete(reverse("tour-detail", kwargs={"tour_id": tour["id"]}))

    assert delete_response.status_code == 200
    assert client.get(reverse("tour-list")).json()["tours"] == []


@pytest.mark.django_db
def test_user_cannot_read_another_users_tour() -> None:
    owner = authenticated_client("owner@example.com")
    create_response = owner.post(
        reverse("tour-list"),
        {"name": "Private", "routeData": {"waypoints": [], "segments": []}},
        format="json",
    )
    tour_id = create_response.json()["tour"]["id"]

    other = authenticated_client("other@example.com")
    response = other.get(reverse("tour-detail", kwargs={"tour_id": tour_id}))

    assert response.status_code == 422
    assert response.json()["code"] == "tour_not_found"


@pytest.mark.django_db
def test_register_and_login_require_csrf_token() -> None:
    client = APIClient(enforce_csrf_checks=True)
    blocked_response = client.post(
        reverse("auth-register"),
        {"email": "runner@example.com", "password": "correct-horse"},
        format="json",
    )
    assert blocked_response.status_code == 403

    client.get(reverse("auth-session"))
    csrf_token = client.cookies["csrftoken"].value

    response = client.post(
        reverse("auth-register"),
        {"email": "runner@example.com", "password": "correct-horse"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf_token,
        HTTP_ORIGIN="http://127.0.0.1:5173",
    )

    assert response.status_code == 202


@pytest.mark.django_db
def test_login_is_rate_limited() -> None:
    client = APIClient()
    for _ in range(8):
        response = client.post(
            reverse("auth-login"),
            {"email": "runner@example.com", "password": "wrong-password"},
            format="json",
        )
        assert response.status_code == 401

    response = client.post(
        reverse("auth-login"),
        {"email": "runner@example.com", "password": "wrong-password"},
        format="json",
    )

    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited"


@pytest.mark.django_db
def test_account_deletion_requires_password_and_deletes_owned_tours() -> None:
    client = authenticated_client("runner@example.com")
    client.post(
        reverse("tour-list"),
        {"name": "Private", "routeData": {"waypoints": [], "segments": []}},
        format="json",
    )

    failed_response = client.post(
        reverse("auth-account-delete"),
        {"password": "wrong-password"},
        format="json",
    )
    assert failed_response.status_code == 401

    response = client.post(
        reverse("auth-account-delete"),
        {"password": "correct-horse"},
        format="json",
    )

    assert response.status_code == 200
    assert response.json() == {"deleted": True}
    assert client.get(reverse("tour-list")).status_code == 401


def authenticated_client(email: str) -> APIClient:
    get_user_model().objects.create_user(
        username=email,
        email=email,
        password="correct-horse",
    )
    client = APIClient()
    response = client.post(
        reverse("auth-login"),
        {"email": email, "password": "correct-horse"},
        format="json",
    )
    assert response.status_code == 200
    return client
