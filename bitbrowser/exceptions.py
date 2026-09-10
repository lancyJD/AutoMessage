class BitBrowserError(Exception):
    """Base error for managed BitBrowser operations."""


class TransportError(BitBrowserError):
    pass


class ProtocolError(BitBrowserError):
    pass


class ApiError(BitBrowserError):
    pass


class ProxyExhaustedError(BitBrowserError):
    pass


class ProxyBindingError(BitBrowserError):
    pass
