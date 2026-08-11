from __future__ import annotations

import pytest
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APIClient


@pytest.fixture(autouse=True)
def clear_auth_rate_limit_cache() -> None:
    cache.clear()


@pytest.mark.django_db
def test_register_logs_user_in_and_reports_session() -> None:
    client = APIClient()

    response = client.post(
        reverse("auth-register"),
        {"username": "runner", "password": "correct-horse"},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["authenticated"] is True
    assert response.json()["user"]["username"] == "runner"

    session_response = client.get(reverse("auth-session"))

    assert session_response.status_code == 200
    assert session_response.json()["authenticated"] is True
    assert session_response.json()["user"]["username"] == "runner"


@pytest.mark.django_db
def test_tours_require_login() -> None:
    client = APIClient()

    response = client.get(reverse("tour-list"))

    assert response.status_code == 401
    assert response.json()["code"] == "authentication_required"


@pytest.mark.django_db
def test_user_can_create_list_update_and_delete_tour() -> None:
    client = authenticated_client("runner")
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
    owner = authenticated_client("owner")
    create_response = owner.post(
        reverse("tour-list"),
        {"name": "Private", "routeData": {"waypoints": [], "segments": []}},
        format="json",
    )
    tour_id = create_response.json()["tour"]["id"]

    other = authenticated_client("other")
    response = other.get(reverse("tour-detail", kwargs={"tour_id": tour_id}))

    assert response.status_code == 422
    assert response.json()["code"] == "tour_not_found"


@pytest.mark.django_db
def test_register_and_login_require_csrf_token() -> None:
    client = APIClient(enforce_csrf_checks=True)
    blocked_response = client.post(
        reverse("auth-register"),
        {"username": "runner", "password": "correct-horse"},
        format="json",
    )
    assert blocked_response.status_code == 403

    client.get(reverse("auth-session"))
    csrf_token = client.cookies["csrftoken"].value

    response = client.post(
        reverse("auth-register"),
        {"username": "runner", "password": "correct-horse"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf_token,
        HTTP_ORIGIN="http://127.0.0.1:5173",
    )

    assert response.status_code == 200


@pytest.mark.django_db
def test_login_is_rate_limited() -> None:
    client = APIClient()
    for _ in range(8):
        response = client.post(
            reverse("auth-login"),
            {"username": "runner", "password": "wrong-password"},
            format="json",
        )
        assert response.status_code == 401

    response = client.post(
        reverse("auth-login"),
        {"username": "runner", "password": "wrong-password"},
        format="json",
    )

    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited"


@pytest.mark.django_db
def test_account_deletion_requires_password_and_deletes_owned_tours() -> None:
    client = authenticated_client("runner")
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


def authenticated_client(username: str) -> APIClient:
    client = APIClient()
    response = client.post(
        reverse("auth-register"),
        {"username": username, "password": "correct-horse"},
        format="json",
    )
    assert response.status_code == 200
    return client
