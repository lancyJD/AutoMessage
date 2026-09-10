from dataclasses import dataclass, field
from enum import Enum


class AllocationMode(str, Enum):
    MANUAL = "manual"
    SEQUENTIAL = "sequential"
    RANDOM = "random"


@dataclass(frozen=True)
class ProxyEndpoint:
    scheme: str
    host: str
    port: int
    username: str = field(default="", repr=False)
    password: str = field(default="", repr=False)


@dataclass(frozen=True)
class ProxyRecord:
    id: int
    endpoint: ProxyEndpoint
    exit_ip: str
    enabled: bool = True


@dataclass(frozen=True)
class ProxyBinding:
    id: int
    group_key: str
    browser_key: str
    browser_id: str | None
    proxy_id: int
    exit_ip: str
    status: str
