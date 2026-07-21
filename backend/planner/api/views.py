from __future__ import annotations

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from planner.api.exceptions import Unauthorized, UnprocessableEntity
from planner.api.serializers import (
    AuthLoginSerializer,
    AuthRegisterSerializer,
    ElevationProfileRequestSerializer,
    RouteComputeRequestSerializer,
    SavedTourSerializer,
    TrailsQuerySerializer,
)
from planner.domain.elevation import ElevationValidationError, build_elevation_profile
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
    LineStringGeometry,
    SwisstopoClient,
    SwisstopoUnavailableError,
)
from planner.models import SavedTour
from planner.services.routing import compute_route
from planner.services.trails import build_trails_response


class HealthView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="health",
        responses={200: dict[str, str]},
    )
    def get(self, request: object) -> Response:
        return Response({"status": "ok"})


class AuthSessionView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="auth_session",
        responses={200: dict[str, object]},
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
                    "username": user.get_username(),
                },
            }
        )


class AuthRegisterView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="auth_register",
        request=AuthRegisterSerializer,
        responses={200: dict[str, object]},
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
        user_model = get_user_model()
        if user_model.objects.filter(username=data["username"]).exists():
            raise UnprocessableEntity(
                "username_unavailable",
                "This username is already used.",
                {},
            )

        user = user_model.objects.create_user(
            username=data["username"],
            password=data["password"],
        )
        login(django_request(request), user)
        return Response(
            {
                "authenticated": True,
                "user": {
                    "id": user.id,
                    "username": user.get_username(),
                },
            }
        )


class AuthLoginView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="auth_login",
        request=AuthLoginSerializer,
        responses={200: dict[str, object]},
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
        user = authenticate(
            django_request(request),
            username=data["username"],
            password=data["password"],
        )
        if user is None:
            raise Unauthorized("invalid_credentials", "Username or password is invalid.", {})

        login(django_request(request), user)
        return Response(
            {
                "authenticated": True,
                "user": {
                    "id": user.id,
                    "username": user.get_username(),
                },
            }
        )


class AuthLogoutView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="auth_logout",
        responses={200: dict[str, object]},
    )
    def post(self, request: object) -> Response:
        logout(django_request(request))
        return Response({"authenticated": False, "user": None})


class SavedTourListView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="tour_list",
        responses={200: dict[str, object]},
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
        responses={200: dict[str, object]},
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
        return Response({"tour": SavedTourSerializer(tour).data})


class SavedTourDetailView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="tour_detail",
        responses={200: dict[str, object]},
    )
    def get(self, request: object, tour_id: str) -> Response:
        tour = tour_for_user(request, tour_id)
        return Response({"tour": SavedTourSerializer(tour).data})

    @extend_schema(
        operation_id="tour_update",
        request=SavedTourSerializer,
        responses={200: dict[str, object]},
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

        for field, value in serializer.validated_data.items():
            setattr(tour, field, value)
        tour.save(update_fields=[*serializer.validated_data.keys(), "updated_at"])
        return Response({"tour": SavedTourSerializer(tour).data})

    @extend_schema(
        operation_id="tour_delete",
        responses={200: dict[str, str]},
    )
    def delete(self, request: object, tour_id: str) -> Response:
        tour = tour_for_user(request, tour_id)
        tour.delete()
        return Response({"status": "deleted"})


class RouteComputeView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="route_compute",
        request=RouteComputeRequestSerializer,
        responses={200: dict[str, object]},
    )
    def post(self, request: object) -> Response:
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
        responses={200: dict[str, object]},
    )
    def post(self, request: object) -> Response:
        serializer = ElevationProfileRequestSerializer(data=getattr(request, "data", {}))
        if not serializer.is_valid():
            raise UnprocessableEntity(
                "invalid_elevation_request",
                "Elevation request validation failed.",
                {"fields": serializer.errors},
            )

        geometry = serializer.validated_data["geometry"]
        coordinates = geometry["coordinates"]
        sample_count = max(2, min(500, round(estimate_sample_count(coordinates))))

        try:
            samples = SwisstopoClient(
                settings.SWISSTOPO_BASE_URL,
                timeout_seconds=settings.SWISSTOPO_TIMEOUT_SECONDS,
            ).elevation_profile(
                LineStringGeometry(coordinates=coordinates),
                sample_count=sample_count,
            )
            profile = build_elevation_profile(samples)
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


class TrailsView(APIView):
    authentication_classes: list[type[object]] = []
    permission_classes: list[type[object]] = []

    @extend_schema(
        operation_id="trails",
        responses={200: dict[str, object]},
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


def estimate_sample_count(coordinates: list[list[float]]) -> int:
    # The frontend keeps route distance separately; this heuristic keeps requests bounded
    # until elevation caching and geometry resampling are implemented.
    return max(50, len(coordinates) * 25)


def django_request(request: object) -> object:
    return getattr(request, "_request", request)


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
