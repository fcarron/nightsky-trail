from __future__ import annotations

from rest_framework import serializers

from planner.domain.route import coordinate_is_in_supported_bounds


class WaypointSerializer(serializers.Serializer):
    id = serializers.CharField(max_length=80)
    longitude = serializers.FloatField()
    latitude = serializers.FloatField()


class SegmentRequestSerializer(serializers.Serializer):
    fromWaypointId = serializers.CharField(max_length=80)
    toWaypointId = serializers.CharField(max_length=80)
    mode = serializers.ChoiceField(choices=["straight", "routed"])


class RouteComputeRequestSerializer(serializers.Serializer):
    waypoints = WaypointSerializer(many=True)
    segments = SegmentRequestSerializer(many=True, required=False)
    profile = serializers.ChoiceField(choices=["hike"], default="hike")


class AuthRegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(min_length=8, max_length=128, trim_whitespace=False)


class AuthLoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class SavedTourSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(max_length=160)
    routeData = serializers.JSONField(source="route_data")
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)

    def validate_routeData(self, value: object) -> object:
        if not isinstance(value, dict):
            raise serializers.ValidationError("Route data must be an object.")

        waypoints = value.get("waypoints")
        segments = value.get("segments")
        if not isinstance(waypoints, list) or not isinstance(segments, list):
            raise serializers.ValidationError("Route data must contain waypoints and segments.")

        if len(waypoints) > 200 or len(segments) > 250:
            raise serializers.ValidationError("Route data is too large.")

        return value


class LineStringGeometrySerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=["LineString"])
    coordinates = serializers.ListField(
        child=serializers.ListField(
            child=serializers.FloatField(),
            min_length=2,
            max_length=2,
        ),
        min_length=2,
    )

    def validate_coordinates(self, value: list[list[float]]) -> list[list[float]]:
        for index, coordinate in enumerate(value):
            longitude, latitude = coordinate
            if not coordinate_is_in_supported_bounds(longitude, latitude):
                raise serializers.ValidationError(
                    f"Coordinate {index} is outside the supported Switzerland planning area."
                )
        return value


class ElevationProfileRequestSerializer(serializers.Serializer):
    geometry = LineStringGeometrySerializer()


class TrailsQuerySerializer(serializers.Serializer):
    bbox = serializers.CharField()
    zoom = serializers.IntegerField(min_value=0, max_value=22)
    include_osm = serializers.BooleanField(default=True)
    include_official = serializers.BooleanField(default=True)
    include_debug = serializers.BooleanField(default=False)

    def validate_bbox(self, value: str) -> tuple[float, float, float, float]:
        parts = value.split(",")
        if len(parts) != 4:
            raise serializers.ValidationError("BBox must contain minLon,minLat,maxLon,maxLat.")

        try:
            min_lon, min_lat, max_lon, max_lat = (float(part) for part in parts)
        except ValueError as error:
            raise serializers.ValidationError("BBox values must be numeric.") from error

        if min_lon >= max_lon or min_lat >= max_lat:
            raise serializers.ValidationError("BBox minimum values must be below maximum values.")

        if not (
            coordinate_is_in_supported_bounds(min_lon, min_lat)
            and coordinate_is_in_supported_bounds(max_lon, max_lat)
        ):
            raise serializers.ValidationError(
                "BBox is outside the supported Switzerland planning area."
            )

        if (max_lon - min_lon) * (max_lat - min_lat) > 0.08:
            raise serializers.ValidationError("BBox is too large for trail overlay loading.")

        return min_lon, min_lat, max_lon, max_lat


class SearchQuerySerializer(serializers.Serializer):
    q = serializers.CharField(min_length=2, max_length=120, trim_whitespace=True)
    limit = serializers.IntegerField(min_value=1, max_value=12, default=8)
