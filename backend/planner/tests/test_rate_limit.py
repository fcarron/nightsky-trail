from __future__ import annotations

from types import SimpleNamespace

from django.test import override_settings

from planner.services.rate_limit import request_client_ip


@override_settings(TRUST_PROXY_CLIENT_IP=False)
def test_direct_request_ignores_untrusted_proxy_header() -> None:
    request = SimpleNamespace(META={"REMOTE_ADDR": "127.0.0.1", "HTTP_X_REAL_IP": "203.0.113.5"})

    assert request_client_ip(request) == "127.0.0.1"


@override_settings(TRUST_PROXY_CLIENT_IP=True)
def test_production_proxy_header_provides_client_ip() -> None:
    request = SimpleNamespace(META={"REMOTE_ADDR": "172.18.0.4", "HTTP_X_REAL_IP": "203.0.113.5"})

    assert request_client_ip(request) == "203.0.113.5"
