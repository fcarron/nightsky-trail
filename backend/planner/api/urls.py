from __future__ import annotations

from django.urls import path

from planner.api.views import (
    AuthLoginView,
    AuthLogoutView,
    AuthRegisterView,
    AuthSessionView,
    ElevationProfileView,
    HealthView,
    RouteComputeView,
    SavedTourDetailView,
    SavedTourListView,
    SearchView,
    TrailsView,
)

urlpatterns = [
    path("health", HealthView.as_view(), name="health"),
    path("auth/session", AuthSessionView.as_view(), name="auth-session"),
    path("auth/register", AuthRegisterView.as_view(), name="auth-register"),
    path("auth/login", AuthLoginView.as_view(), name="auth-login"),
    path("auth/logout", AuthLogoutView.as_view(), name="auth-logout"),
    path("route/compute", RouteComputeView.as_view(), name="route-compute"),
    path("elevation/profile", ElevationProfileView.as_view(), name="elevation-profile"),
    path("search", SearchView.as_view(), name="search"),
    path("trails", TrailsView.as_view(), name="trails"),
    path("tours", SavedTourListView.as_view(), name="tour-list"),
    path("tours/<uuid:tour_id>", SavedTourDetailView.as_view(), name="tour-detail"),
]
