import pytest

from bitbrowser import AllocationMode, ProxyEndpoint, ProxyExhaustedError, Storage


def endpoint(host, port=8000):
    return ProxyEndpoint("http", host, port, "u", "p")


def test_same_exit_ip_is_unique_in_group_but_reusable_across_groups(tmp_path):
    store = Storage(tmp_path / "pool.db")
    p1 = store.add_proxy(endpoint("a"), "1.2.3.4")
    p2 = store.add_proxy(endpoint("b"), "1.2.3.4")
    store.reserve_proxy("g1", "b1", AllocationMode.MANUAL, p1)
    with pytest.raises(ProxyExhaustedError):
        store.reserve_proxy("g1", "b2", AllocationMode.MANUAL, p2)
    assert store.reserve_proxy("g2", "b3", AllocationMode.MANUAL, p2).proxy_id == p2


def test_sequential_and_random_choose_only_free_enabled_proxy(tmp_path):
    store = Storage(tmp_path / "pool.db", random_choice=lambda values: values[-1])
    p1 = store.add_proxy(endpoint("a"), "1.1.1.1")
    p2 = store.add_proxy(endpoint("b"), "2.2.2.2")
    assert store.reserve_proxy("g", "b1", AllocationMode.SEQUENTIAL).proxy_id == p1
    assert store.reserve_proxy("g", "b2", AllocationMode.RANDOM).proxy_id == p2


def test_ungrouped_windows_share_default_group_and_close_does_not_release(tmp_path):
    store = Storage(tmp_path / "pool.db")
    p1 = store.add_proxy(endpoint("a"), "1.1.1.1")
    store.reserve_proxy(None, "b1", AllocationMode.MANUAL, p1)
    store.confirm_binding("b1", "remote1")
    with pytest.raises(ProxyExhaustedError):
        store.reserve_proxy(None, "b2", AllocationMode.MANUAL, p1)
    assert store.get_binding("remote1").proxy_id == p1


def test_move_binding_rejects_target_group_exit_ip_conflict(tmp_path):
    store = Storage(tmp_path / "pool.db")
    p1 = store.add_proxy(endpoint("a"), "1.1.1.1")
    p2 = store.add_proxy(endpoint("b"), "1.1.1.1")
    store.reserve_proxy("g1", "b1", AllocationMode.MANUAL, p1)
    store.confirm_binding("b1", "remote1")
    store.reserve_proxy("g2", "b2", AllocationMode.MANUAL, p2)
    store.confirm_binding("b2", "remote2")
    with pytest.raises(Exception, match="already used"):
        store.move_binding("remote1", "g2")
