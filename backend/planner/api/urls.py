from __future__ import annotations

from django.urls import path

from planner.api.views import ElevationProfileView, HealthView, RouteComputeView, TrailsView

urlpatterns = [
    path("health", HealthView.as_view(), name="health"),
    path("route/compute", RouteComputeView.as_view(), name="route-compute"),
    path("elevation/profile", ElevationProfileView.as_view(), name="elevation-profile"),
    path("trails", TrailsView.as_view(), name="trails"),
]
