from __future__ import annotations

from typing import Any

from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.views import exception_handler


class UnprocessableEntity(APIException):
    status_code = 422
    default_code = "unprocessable_entity"
    default_detail = "The request could not be processed."

    def __init__(
        self,
        code: str,
        message: str,
        details: dict[str, object] | None = None,
    ) -> None:
        self.default_code = code
        self.detail = {
            "code": code,
            "message": message,
            "details": details or {},
        }


class Unauthorized(APIException):
    status_code = 401
    default_code = "authentication_required"
    default_detail = "Authentication is required."

    def __init__(
        self,
        code: str = "authentication_required",
        message: str = "Login is required.",
        details: dict[str, object] | None = None,
    ) -> None:
        self.default_code = code
        self.detail = {
            "code": code,
            "message": message,
            "details": details or {},
        }


def api_exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    response = exception_handler(exc, context)
    if response is None:
        return None

    message = "Request failed."
    details: object = response.data
    code = getattr(exc, "default_code", "request_failed")

    if isinstance(response.data, dict):
        if all(key in response.data for key in ("code", "message", "details")):
            return response

        detail = response.data.get("detail")
        if isinstance(detail, str):
            message = detail

    response.data = {
        "code": code,
        "message": message,
        "details": details,
    }
    return response
