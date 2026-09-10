import json

import pytest

from bitbrowser import ApiError, BitBrowserClient, BrowserService, GroupService, ProtocolError


class FakeTransport:
    def __init__(self, status=200, body=None):
        self.status = status
        self.body = body or {"success": True, "data": {"id": "x"}}
        self.calls = []

    def post(self, url, payload, timeout):
        self.calls.append((url, payload, timeout))
        return self.status, json.dumps(self.body).encode()


def test_client_returns_data_and_builds_url():
    transport = FakeTransport()
    client = BitBrowserClient("http://127.0.0.1:54345/", 3, transport)
    assert client.request("/health") == {"id": "x"}
    assert transport.calls == [("http://127.0.0.1:54345/health", {}, 3)]


def test_client_rejects_business_failure_without_leaking_payload():
    transport = FakeTransport(body={"success": False, "msg": "bad proxy"})
    with pytest.raises(ApiError, match="bad proxy") as error:
        BitBrowserClient(transport=transport).request("/browser/update", {"proxyPassword": "secret"})
    assert "secret" not in str(error.value)


def test_client_rejects_invalid_json():
    class InvalidTransport:
        def post(self, url, payload, timeout):
            return 200, b"not-json"
    with pytest.raises(ProtocolError):
        BitBrowserClient(transport=InvalidTransport()).request("/health")


def test_group_and_browser_services_send_official_payloads():
    transport = FakeTransport()
    client = BitBrowserClient(transport=transport)
    groups = GroupService(client)
    browsers = BrowserService(client)
    groups.move_browsers("g1", ["b1", "b2"])
    browsers.update_proxy(["b1"], {"proxyType": "http", "host": "h", "port": 80})
    assert transport.calls[-2][0].endswith("/browser/group/update")
    assert transport.calls[-2][1] == {"groupId": "g1", "browserIds": ["b1", "b2"]}
    assert transport.calls[-1][1]["proxyMethod"] == 2


def test_group_create_uses_documented_group_name_field():
    transport = FakeTransport()
    GroupService(BitBrowserClient(transport=transport)).create("Facebook")
    assert transport.calls[-1][1] == {"groupName": "Facebook"}
