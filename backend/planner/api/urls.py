from __future__ import annotations

from django.urls import path

from planner.api.views import (
    AccountDeleteView,
    AuthLoginView,
    AuthLogoutView,
    AuthRegisterView,
    AuthSessionView,
    DrinkingWaterView,
    ElevationProfileView,
    EmailVerificationView,
    HealthView,
    MapFeatureInfoView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RouteComputeView,
    SacHutsView,
    SavedTourDetailView,
    SavedTourListView,
    SearchView,
    SharedTourView,
    ToiletsView,
    TrailsView,
    VerificationEmailResendView,
)

urlpatterns = [
    path("health", HealthView.as_view(), name="health"),
    path("auth/session", AuthSessionView.as_view(), name="auth-session"),
    path("auth/register", AuthRegisterView.as_view(), name="auth-register"),
    path("auth/login", AuthLoginView.as_view(), name="auth-login"),
    path("auth/logout", AuthLogoutView.as_view(), name="auth-logout"),
    path("auth/verify-email", EmailVerificationView.as_view(), name="auth-verify-email"),
    path(
        "auth/verify-email/resend",
        VerificationEmailResendView.as_view(),
        name="auth-verify-email-resend",
    ),
    path(
        "auth/password-reset/request",
        PasswordResetRequestView.as_view(),
        name="auth-password-reset-request",
    ),
    path(
        "auth/password-reset/confirm",
        PasswordResetConfirmView.as_view(),
        name="auth-password-reset-confirm",
    ),
    path("auth/account", AccountDeleteView.as_view(), name="auth-account-delete"),
    path("route/compute", RouteComputeView.as_view(), name="route-compute"),
    path("elevation/profile", ElevationProfileView.as_view(), name="elevation-profile"),
    path("search", SearchView.as_view(), name="search"),
    path("trails", TrailsView.as_view(), name="trails"),
    path("map/feature-info", MapFeatureInfoView.as_view(), name="map-feature-info"),
    path("drinking-water", DrinkingWaterView.as_view(), name="drinking-water"),
    path("toilets", ToiletsView.as_view(), name="toilets"),
    path("sac-huts", SacHutsView.as_view(), name="sac-huts"),
    path("tours", SavedTourListView.as_view(), name="tour-list"),
    path("tours/<uuid:tour_id>", SavedTourDetailView.as_view(), name="tour-detail"),
    path("public/tours/<str:share_token>", SharedTourView.as_view(), name="shared-tour"),
]
