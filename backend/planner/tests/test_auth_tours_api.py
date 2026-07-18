from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework.test import APIClient


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


def authenticated_client(username: str) -> APIClient:
    client = APIClient()
    response = client.post(
        reverse("auth-register"),
        {"username": username, "password": "correct-horse"},
        format="json",
    )
    assert response.status_code == 200
    return client
