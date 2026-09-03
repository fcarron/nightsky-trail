from __future__ import annotations

import logging

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.tokens import default_token_generator
from django.utils.decorators import method_decorator
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from planner.api.exceptions import (
    ResourceNotFound,
    ServiceUnavailable,
    TooManyRequests,
    Unauthorized,
    UnprocessableEntity,
)
from planner.api.serializers import (
    AccountDeleteSerializer,
    AuthLoginSerializer,
    AuthRegisterSerializer,
    ElevationProfileRequestSerializer,
    EmailTokenSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RouteComputeRequestSerializer,
    SavedTourSerializer,
    SearchQuerySerializer,
    SharedTourSerializer,
    TrailsQuerySerializer,
    VerificationEmailResendSerializer,
)
from planner.domain.elevation import ElevationValidationError
from planner.domain.route import (
    RouteValidationError,
    SegmentRequest,
    Waypoint,
)
from planner.integrations.graphhopper import GraphHopperClient
from planner.integrations.overpass import (
    OverpassUnavailableError,
)
from planner.integrations.swisstopo import (
    SwisstopoClient,
    SwisstopoSearchUnavailableError,
    SwisstopoUnavailableError,
)
from planner.models import SavedTour
from planner.services.account_email import (
    AccountEmailUnavailableError,
    email_verification_token_generator,
    send_password_reset_email,
    send_verification_email,
)
from planner.services.auth import (
    login_attempt_allowed,
    password_reset_attempt_allowed,
    registration_attempt_allowed,
    verification_email_attempt_allowed,
)
from planner.services.elevation import get_elevation_profile
from planner.services.rate_limit import request_rate_limit_allowed
from planner.services.routing import compute_route
from planner.services.search import search_locations
from planner.services.trails import build_trails_response

logger = logging.getLogger(__name__)


class HealthView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="health",
        responses={200: dict[str, str]},
    )
    def get(self, request: object) -> Response:
        return Response({"status": "ok"})


@method_decorator(ensure_csrf_cookie, name="dispatch")
class AuthSessionView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="auth_session",
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request: object) -> Response:
        user = request_user(request)
        if not user.is_authenticated:
            return Response({"authenticated": False, "user": None})

        return Response(
            {
                "authenticated": True,
                "user": {
                    "id": user.id,
                    "email": user.email or user.get_username(),
                },
            }
        )


@method_decorator(csrf_protect, name="dispatch")
class AuthRegisterView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="auth_register",
        request=AuthRegisterSerializer,
        responses={202: OpenApiTypes.OBJECT},
    )
    def post(self, request: object) -> Response:
        serializer = AuthRegisterSerializer(data=getattr(request, "data", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_register_request",
                "Register request validation failed.",
                {"fields": serializer.errors},
            )

        data = serializer.validated_data
        email = get_user_model().objects.normalize_email(data["email"]).casefold()
        if not registration_attempt_allowed(django_request(request), email):
            raise TooManyRequests()
        user_model = get_user_model()
        existing_user = user_model.objects.filter(username__iexact=email).first()
        if existing_user and existing_user.is_active:
            raise UnprocessableEntity(
                "email_unavailable",
                "This email address is already registered.",
                {},
            )

        user = existing_user or user_model.objects.create_user(
            username=email,
            email=email,
            password=data["password"],
            is_active=False,
        )
        if existing_user:
            user.email = email
            user.set_password(data["password"])
            user.save(update_fields=["email", "password"])
        try:
            send_verification_email(user)
        except AccountEmailUnavailableError as error:
            if not existing_user:
                user.delete()
            raise ServiceUnavailable(
                "verification_email_unavailable",
                "Verification email could not be sent. Please try again later.",
            ) from error
        return Response(
            {"authenticated": False, "user": None},
            status=202,
        )


@method_decorator(csrf_protect, name="dispatch")
class AuthLoginView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="auth_login",
        request=AuthLoginSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def post(self, request: object) -> Response:
        serializer = AuthLoginSerializer(data=getattr(request, "data", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_login_request",
                "Login request validation failed.",
                {"fields": serializer.errors},
            )

        data = serializer.validated_data
        identifier = data["email"].strip().casefold()
        if not login_attempt_allowed(django_request(request), identifier):
            raise TooManyRequests()
        user = authenticate(
            django_request(request),
            username=identifier,
            password=data["password"],
        )
        if user is None:
            raise Unauthorized("invalid_credentials", "Email or password is invalid.", {})

        login(django_request(request), user)
        return Response(
            {
                "authenticated": True,
                "user": {
                    "id": user.id,
                    "email": user.email or user.get_username(),
                },
            }
        )


@method_decorator(csrf_protect, name="dispatch")
class EmailVerificationView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="auth_verify_email",
        request=EmailTokenSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def post(self, request: object) -> Response:
        serializer = EmailTokenSerializer(data=getattr(request, "data", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_verification_link",
                "The verification link is invalid or expired.",
                {},
            )
        user = user_from_uid(serializer.validated_data["uid"])
        token = serializer.validated_data["token"]
        if user is None or not email_verification_token_generator.check_token(user, token):
            raise UnprocessableEntity(
                "invalid_verification_link",
                "The verification link is invalid or expired.",
                {},
            )
        user.is_active = True
        user.save(update_fields=["is_active"])
        login(django_request(request), user)
        return Response(
            {
                "authenticated": True,
                "user": {"id": user.id, "email": user.email or user.get_username()},
            }
        )


@method_decorator(csrf_protect, name="dispatch")
class VerificationEmailResendView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="auth_resend_verification_email",
        request=VerificationEmailResendSerializer,
        responses={200: dict[str, bool]},
    )
    def post(self, request: object) -> Response:
        serializer = VerificationEmailResendSerializer(data=getattr(request, "data", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_verification_email_request",
                "Verification email request validation failed.",
                {"fields": serializer.errors},
            )

        email = (
            get_user_model().objects.normalize_email(serializer.validated_data["email"]).casefold()
        )
        if not verification_email_attempt_allowed(django_request(request), email):
            raise TooManyRequests()

        user = get_user_model().objects.filter(email__iexact=email, is_active=False).first()
        if user:
            try:
                send_verification_email(user)
            except AccountEmailUnavailableError:
                logger.exception("Verification email could not be resent")
        return Response({"sent": True})


@method_decorator(csrf_protect, name="dispatch")
class PasswordResetRequestView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="auth_password_reset_request",
        request=PasswordResetRequestSerializer,
        responses={200: dict[str, bool]},
    )
    def post(self, request: object) -> Response:
        serializer = PasswordResetRequestSerializer(data=getattr(request, "data", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_password_reset_request",
                "Password reset request validation failed.",
                {"fields": serializer.errors},
            )
        email = (
            get_user_model().objects.normalize_email(serializer.validated_data["email"]).casefold()
        )
        if not password_reset_attempt_allowed(django_request(request), email):
            raise TooManyRequests()
        user = get_user_model().objects.filter(email__iexact=email, is_active=True).first()
        if user:
            try:
                send_password_reset_email(user)
            except AccountEmailUnavailableError:
                logger.exception("Password reset email could not be sent")
        return Response({"sent": True})


@method_decorator(csrf_protect, name="dispatch")
class PasswordResetConfirmView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="auth_password_reset_confirm",
        request=PasswordResetConfirmSerializer,
        responses={200: dict[str, bool]},
    )
    def post(self, request: object) -> Response:
        serializer = PasswordResetConfirmSerializer(data=getattr(request, "data", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_password_reset",
                "Password reset validation failed.",
                {"fields": serializer.errors},
            )
        user = user_from_uid(serializer.validated_data["uid"])
        token = serializer.validated_data["token"]
        if user is None or not default_token_generator.check_token(user, token):
            raise UnprocessableEntity(
                "invalid_password_reset_link",
                "The password reset link is invalid or expired.",
                {},
            )
        user.set_password(serializer.validated_data["password"])
        user.save(update_fields=["password"])
        return Response({"reset": True})


@method_decorator(csrf_protect, name="dispatch")
class AuthLogoutView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="auth_logout",
        request=None,
        responses={200: OpenApiTypes.OBJECT},
    )
    def post(self, request: object) -> Response:
        logout(django_request(request))
        return Response({"authenticated": False, "user": None})


@method_decorator(csrf_protect, name="dispatch")
class AccountDeleteView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="account_delete",
        request=AccountDeleteSerializer,
        responses={200: dict[str, bool]},
    )
    def post(self, request: object) -> Response:
        serializer = AccountDeleteSerializer(data=getattr(request, "data", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_account_delete_request",
                "Account deletion request validation failed.",
                {"fields": serializer.errors},
            )

        user = authenticated_user(request)
        if not user.check_password(serializer.validated_data["password"]):
            raise Unauthorized("invalid_credentials", "Password is incorrect.", {})

        logout(django_request(request))
        user.delete()
        return Response({"deleted": True})


@method_decorator(csrf_protect, name="dispatch")
class SavedTourListView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="tour_list",
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request: object) -> Response:
        user = authenticated_user(request)
        serializer = SavedTourSerializer(
            SavedTour.objects.filter(owner=user),
            many=True,
        )
        return Response({"tours": serializer.data})

    @extend_schema(
        operation_id="tour_create",
        request=SavedTourSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def post(self, request: object) -> Response:
        user = authenticated_user(request)
        serializer = SavedTourSerializer(data=getattr(request, "data", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_tour_request",
                "Tour request validation failed.",
                {"fields": serializer.errors},
            )

        tour = SavedTour.objects.create(
            owner=user,
            name=serializer.validated_data["name"],
            route_data=serializer.validated_data["route_data"],
        )
        if serializer.validated_data.get("share_enabled", False):
            tour.set_sharing_enabled(True)
            tour.save(update_fields=["share_enabled", "share_token", "updated_at"])
        return Response({"tour": SavedTourSerializer(tour).data})


@method_decorator(csrf_protect, name="dispatch")
class SavedTourDetailView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="tour_detail",
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request: object, tour_id: str) -> Response:
        tour = tour_for_user(request, tour_id)
        return Response({"tour": SavedTourSerializer(tour).data})

    @extend_schema(
        operation_id="tour_update",
        request=SavedTourSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def patch(self, request: object, tour_id: str) -> Response:
        tour = tour_for_user(request, tour_id)
        serializer = SavedTourSerializer(tour, data=getattr(request, "data", {}), partial=True)
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_tour_request",
                "Tour request validation failed.",
                {"fields": serializer.errors},
            )

        share_enabled = serializer.validated_data.pop("share_enabled", None)
        for field, value in serializer.validated_data.items():
            setattr(tour, field, value)
        if share_enabled is not None:
            tour.set_sharing_enabled(share_enabled)
        tour.save()
        return Response({"tour": SavedTourSerializer(tour).data})

    @extend_schema(
        operation_id="tour_delete",
        responses={200: dict[str, str]},
    )
    def delete(self, request: object, tour_id: str) -> Response:
        tour = tour_for_user(request, tour_id)
        tour.delete()
        return Response({"status": "deleted"})


class SharedTourView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="shared_tour_detail",
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request: object, share_token: str) -> Response:
        try:
            tour = SavedTour.objects.get(
                share_enabled=True,
                share_token=share_token,
            )
        except SavedTour.DoesNotExist as error:
            raise ResourceNotFound(
                "shared_tour_not_found",
                "Shared tour was not found.",
                {},
            ) from error
        return Response({"tour": SharedTourSerializer(tour).data})


class RouteComputeView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="route_compute",
        request=RouteComputeRequestSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def post(self, request: object) -> Response:
        enforce_public_api_rate_limit(
            "route",
            request,
            settings.ROUTE_RATE_LIMIT,
            "Too many routing requests. Please try again shortly.",
        )
        serializer = RouteComputeRequestSerializer(data=getattr(request, "data", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_route_request",
                "Route request validation failed.",
                {"fields": serializer.errors},
            )

        data = serializer.validated_data
        waypoints = [
            Waypoint(
                id=waypoint["id"],
                longitude=waypoint["longitude"],
                latitude=waypoint["latitude"],
            )
            for waypoint in data["waypoints"]
        ]
        segments = [
            SegmentRequest(
                from_waypoint_id=segment["fromWaypointId"],
                to_waypoint_id=segment["toWaypointId"],
                mode=segment["mode"],
            )
            for segment in data.get("segments", [])
        ]

        try:
            route = compute_route(
                waypoints,
                segments or None,
                GraphHopperClient(
                    settings.GRAPHHOPPER_BASE_URL,
                    profile=settings.GRAPHHOPPER_PROFILE,
                    timeout_seconds=settings.GRAPHHOPPER_TIMEOUT_SECONDS,
                ),
                profile=data["profile"],
            )
        except RouteValidationError as error:
            raise UnprocessableEntity(error.code, error.message, error.details) from error

        return Response(
            {
                "geometry": route.geometry,
                "distanceMeters": round(route.distance_meters, 3),
                "segments": [
                    {
                        "id": segment.id,
                        "fromWaypointId": segment.from_waypoint_id,
                        "toWaypointId": segment.to_waypoint_id,
                        "mode": segment.mode,
                        "distanceMeters": round(segment.distance_meters, 3),
                        "geometry": segment.geometry,
                        "details": segment.details or {},
                    }
                    for segment in route.segments
                ],
                "warnings": route.warnings,
            }
        )


class ElevationProfileView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="elevation_profile",
        request=ElevationProfileRequestSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def post(self, request: object) -> Response:
        enforce_public_api_rate_limit(
            "elevation",
            request,
            settings.ELEVATION_RATE_LIMIT,
            "Too many elevation requests. Please try again shortly.",
        )
        serializer = ElevationProfileRequestSerializer(data=getattr(request, "data", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_elevation_request",
                "Elevation request validation failed.",
                {"fields": serializer.errors},
            )

        geometry = serializer.validated_data["geometry"]
        coordinates = geometry["coordinates"]
        try:
            profile = get_elevation_profile(
                SwisstopoClient(
                    settings.SWISSTOPO_BASE_URL,
                    timeout_seconds=settings.SWISSTOPO_TIMEOUT_SECONDS,
                ),
                coordinates,
                cache_timeout_seconds=settings.ELEVATION_CACHE_TIMEOUT_SECONDS,
            )
        except SwisstopoUnavailableError as error:
            raise UnprocessableEntity(error.code, error.message, {}) from error
        except ElevationValidationError as error:
            raise UnprocessableEntity(error.code, error.message, error.details) from error

        return Response(
            {
                "distanceMeters": round(profile.distance_meters, 3),
                "ascentMeters": round(profile.ascent_meters, 3),
                "descentMeters": round(profile.descent_meters, 3),
                "minElevationMeters": round(profile.min_elevation_meters, 3),
                "maxElevationMeters": round(profile.max_elevation_meters, 3),
                "hikingTime": {
                    "duration_minutes": profile.hiking_time.duration_minutes,
                    "method": profile.hiking_time.method,
                    "segment_length_m": profile.hiking_time.segment_length_m,
                    "smoothing_window_m": profile.hiking_time.smoothing_window_m,
                    "segment_count": profile.hiking_time.segment_count,
                },
                "points": [
                    {
                        "distanceMeters": round(point.distance_meters, 3),
                        "elevationMeters": round(point.elevation_meters, 3),
                        "smoothedElevationMeters": round(point.smoothed_elevation_meters, 3),
                        "gradientPercent": round(point.gradient_percent, 3),
                        "longitude": point.longitude,
                        "latitude": point.latitude,
                    }
                    for point in profile.points
                ],
            }
        )


class SearchView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="search",
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request: object) -> Response:
        enforce_public_api_rate_limit(
            "search",
            request,
            settings.SEARCH_RATE_LIMIT,
            "Too many search requests. Please try again shortly.",
        )
        serializer = SearchQuerySerializer(data=getattr(request, "query_params", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_search_request",
                "Search request validation failed.",
                {"fields": serializer.errors},
            )

        data = serializer.validated_data
        try:
            results = search_locations(
                SwisstopoClient(
                    settings.SWISSTOPO_BASE_URL,
                    timeout_seconds=settings.SWISSTOPO_TIMEOUT_SECONDS,
                ),
                data["q"],
                limit=data["limit"],
                cache_timeout_seconds=settings.SEARCH_CACHE_TIMEOUT_SECONDS,
            )
        except SwisstopoSearchUnavailableError as error:
            raise UnprocessableEntity(error.code, error.message, {}) from error

        return Response(
            {
                "results": [
                    {
                        "id": result.id,
                        "label": result.label,
                        "origin": result.origin,
                        "longitude": result.longitude,
                        "latitude": result.latitude,
                        "zoom": result.zoom,
                    }
                    for result in results
                ]
            }
        )


class TrailsView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="trails",
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request: object) -> Response:
        serializer = TrailsQuerySerializer(data=getattr(request, "query_params", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_trails_request",
                "OSM difficulty request validation failed.",
                {"fields": serializer.errors},
            )

        zoom = serializer.validated_data["zoom"]
        include_osm = serializer.validated_data["include_osm"]
        include_official = serializer.validated_data["include_official"]
        include_debug = serializer.validated_data["include_debug"]
        bbox = serializer.validated_data["bbox"]

        try:
            return Response(
                build_trails_response(
                    bbox,
                    zoom,
                    include_osm=include_osm,
                    include_official=include_official,
                    include_debug=include_debug,
                )
            )
        except OverpassUnavailableError as error:
            raise UnprocessableEntity(error.code, error.message, error.details) from error


def django_request(request: object) -> object:
    return getattr(request, "_request", request)


def enforce_public_api_rate_limit(
    action: str,
    request: object,
    limit: int,
    message: str,
) -> None:
    if not request_rate_limit_allowed(
        action,
        django_request(request),
        limit=limit,
        window_seconds=settings.PUBLIC_API_RATE_WINDOW_SECONDS,
    ):
        raise TooManyRequests(message)


def request_user(request: object) -> object:
    raw_user = getattr(django_request(request), "user", None)
    if getattr(raw_user, "is_authenticated", False):
        return raw_user

    user_id = getattr(django_request(request), "session", {}).get("_auth_user_id")
    if user_id is None:
        return AnonymousUserLike()

    try:
        return get_user_model().objects.get(pk=user_id)
    except get_user_model().DoesNotExist:
        return AnonymousUserLike()


def user_from_uid(uid: str) -> object | None:
    try:
        user_id = force_str(urlsafe_base64_decode(uid))
        return get_user_model().objects.get(pk=user_id)
    except (ValueError, TypeError, OverflowError, get_user_model().DoesNotExist):
        return None


def authenticated_user(request: object) -> object:
    user = request_user(request)
    if not getattr(user, "is_authenticated", False):
        raise Unauthorized()
    return user


def tour_for_user(request: object, tour_id: str) -> SavedTour:
    user = authenticated_user(request)
    try:
        return SavedTour.objects.get(id=tour_id, owner=user)
    except (SavedTour.DoesNotExist, ValueError) as error:
        raise UnprocessableEntity("tour_not_found", "Tour was not found.", {}) from error


class AnonymousUserLike:
    is_authenticated = False
