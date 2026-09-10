import pytest

from bitbrowser import AllocationMode, BitBrowserManager, ProxyEndpoint, ProxyPool, Storage


class FakeChecker:
    def check(self, endpoint):
        return {"a": "1.1.1.1", "b": "2.2.2.2"}[endpoint.host]


class FakeBrowsers:
    def __init__(self, fail=False):
        self.fail = fail
        self.created = []
        self.opened = []

    def create(self, payload):
        if self.fail:
            raise ValueError("remote rejected")
        self.created.append(payload)
        return {"id": "remote-1"}

    def open(self, browser_id):
        self.opened.append(browser_id)
        return {"ws": "ws://x"}

    def close(self, browser_id):
        return {}

    def delete(self, browser_id):
        return {}

    def update_proxy(self, ids, payload):
        return {}

    def pids(self, ids):
        return []


class FakeGroups:
    def __init__(self):
        self.moves = []

    def move_browsers(self, group_id, browser_ids):
        self.moves.append((group_id, browser_ids))
        return {}


def test_proxy_pool_imports_and_redacts_credentials(tmp_path):
    store = Storage(tmp_path / "pool.db")
    pool = ProxyPool(store, FakeChecker())
    ids = pool.import_lines(["http://u:p@a:8000", "socks5://b:9000"])
    assert len(ids) == 2
    representation = repr(store.get_proxy(ids[0]).endpoint)
    assert "username" not in representation
    assert "password" not in representation


def test_manager_allocates_proxy_before_remote_create_and_persists_binding(tmp_path):
    store = Storage(tmp_path / "pool.db")
    pool = ProxyPool(store, FakeChecker())
    pool.import_lines(["http://u:p@a:8000"])
    browsers = FakeBrowsers()
    manager = BitBrowserManager(store, pool, browsers)
    result = manager.create_browser("fb-1", "facebook", AllocationMode.SEQUENTIAL)
    assert result["id"] == "remote-1"
    assert browsers.created[0]["groupId"] == "facebook"
    assert browsers.created[0]["host"] == "a"
    assert store.get_binding("remote-1").status == "active"
    assert manager.open_browser("remote-1") == {"ws": "ws://x"}


def test_manager_releases_reservation_after_definite_create_failure(tmp_path):
    store = Storage(tmp_path / "pool.db")
    pool = ProxyPool(store, FakeChecker())
    proxy_id = pool.import_lines(["http://a:8000"])[0]
    manager = BitBrowserManager(store, pool, FakeBrowsers(fail=True))
    with pytest.raises(ValueError, match="remote rejected"):
        manager.create_browser("fb-1", "g", AllocationMode.MANUAL, proxy_id)
    assert store.list_bindings() == []


def test_manager_moves_binding_only_after_remote_group_move(tmp_path):
    store = Storage(tmp_path / "pool.db")
    pool = ProxyPool(store, FakeChecker())
    pool.import_lines(["http://a:8000"])
    groups = FakeGroups()
    manager = BitBrowserManager(store, pool, FakeBrowsers(), groups)
    manager.create_browser("x", "g1", AllocationMode.SEQUENTIAL)
    manager.move_browser("remote-1", "g2")
    assert groups.moves == [("g2", ["remote-1"])]
    assert store.get_binding("remote-1").group_key == "g2"


def test_manager_replaces_proxy_for_closed_browser(tmp_path):
    store = Storage(tmp_path / "pool.db")
    pool = ProxyPool(store, FakeChecker())
    first, second = pool.import_lines(["http://a:8000", "http://b:8000"])
    browsers = FakeBrowsers()
    manager = BitBrowserManager(store, pool, browsers)
    manager.create_browser("x", "g1", AllocationMode.MANUAL, first)
    manager.replace_proxy("remote-1", AllocationMode.MANUAL, second)
    assert store.get_binding("remote-1").proxy_id == second
