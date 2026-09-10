import json
from typing import Protocol
from urllib import error, request

from .exceptions import ApiError, ProtocolError, TransportError


class Transport(Protocol):
    def post(self, url: str, payload: dict, timeout: float) -> tuple[int, bytes]: ...


class UrlLibTransport:
    def post(self, url: str, payload: dict, timeout: float) -> tuple[int, bytes]:
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(url, body, {"Content-Type": "application/json"}, method="POST")
        try:
            with request.urlopen(req, timeout=timeout) as response:
                return response.status, response.read()
        except error.HTTPError as exc:
            return exc.code, exc.read()
        except (error.URLError, TimeoutError, OSError) as exc:
            raise TransportError(f"BitBrowser Local API connection failed: {exc}") from exc


class BitBrowserClient:
    def __init__(self, base_url="http://127.0.0.1:54345", timeout=15.0, transport=None):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.transport = transport or UrlLibTransport()

    def request(self, path: str, payload: dict | None = None) -> dict:
        status, raw = self.transport.post(f"{self.base_url}/{path.lstrip('/')}", payload or {}, self.timeout)
        if not 200 <= status < 300:
            raise ProtocolError(f"BitBrowser Local API returned HTTP {status}")
        try:
            result = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ProtocolError("BitBrowser Local API returned invalid JSON") from exc
        if not isinstance(result, dict):
            raise ProtocolError("BitBrowser Local API returned a non-object response")
        if result.get("success") is False:
            raise ApiError(str(result.get("msg") or result.get("message") or "BitBrowser API request failed"))
        return result.get("data", result)
