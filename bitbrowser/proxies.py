import ipaddress
from urllib.parse import unquote, urlsplit

from .exceptions import ProxyBindingError
from .models import AllocationMode, ProxyEndpoint


class ProxyPool:
    def __init__(self, storage, checker):
        self.storage = storage
        self.checker = checker

    @staticmethod
    def parse(value: str) -> ProxyEndpoint:
        parsed = urlsplit(value.strip())
        if parsed.scheme not in {"http", "https", "socks5", "ssh"}:
            raise ProxyBindingError(f"Unsupported proxy scheme: {parsed.scheme or 'missing'}")
        if not parsed.hostname or parsed.port is None:
            raise ProxyBindingError("Proxy must include host and port")
        return ProxyEndpoint(parsed.scheme, parsed.hostname, parsed.port, unquote(parsed.username or ""), unquote(parsed.password or ""))

    def import_lines(self, lines):
        ids = []
        for value in lines:
            if not value.strip():
                continue
            endpoint = self.parse(value)
            try:
                exit_ip = str(ipaddress.ip_address(self.checker.check(endpoint)))
            except Exception as exc:
                raise ProxyBindingError(f"Could not determine exit IP for {endpoint.scheme}://{endpoint.host}:{endpoint.port}") from exc
            ids.append(self.storage.add_proxy(endpoint, exit_ip))
        return ids

    def validate(self, proxy_id):
        proxy = self.storage.get_proxy(proxy_id)
        actual = str(ipaddress.ip_address(self.checker.check(proxy.endpoint)))
        if actual != proxy.exit_ip:
            raise ProxyBindingError(f"Proxy exit IP changed from {proxy.exit_ip} to {actual}")
        return actual

    def allocate(self, group_id, browser_key, mode, proxy_id=None):
        return self.storage.reserve_proxy(group_id, browser_key, mode, proxy_id)

    def disable(self, proxy_id):
        self.storage.set_proxy_enabled(proxy_id, False)

    @staticmethod
    def to_bitbrowser_payload(proxy):
        endpoint = proxy.endpoint
        return {"proxyMethod": 2, "proxyType": endpoint.scheme, "host": endpoint.host,
                "port": endpoint.port, "proxyUserName": endpoint.username,
                "proxyPassword": endpoint.password, "isIpv6": ":" in proxy.exit_ip}
