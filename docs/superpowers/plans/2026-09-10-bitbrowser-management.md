# BitBrowser Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tested Python package that manages BitBrowser groups, browser profiles, and a persistent proxy pool with manual, sequential, and random allocation.

**Architecture:** A typed HTTP client wraps BitBrowser Local API endpoints. A SQLite repository owns local proxy inventory and binding constraints, while `BitBrowserManager` coordinates database reservations with remote browser mutations. Facebook and Instagram remain separate importable package boundaries for later automation.

**Tech Stack:** Python 3.10+, standard library (`sqlite3`, `urllib`, `dataclasses`, `enum`, `concurrent.futures`), pytest.

**Spec:** `docs/superpowers/specs/2026-09-10-bitbrowser-design.md`

## Global Constraints

- Every managed browser has exactly one proxy binding.
- The same observed exit IP may be used once per group and may be reused across different groups.
- Ungrouped browsers share one reserved default group key.
- Allocation modes are `manual`, `sequential`, and `random`.
- Random allocation persists its result; reopening does not choose again.
- Failed exit-IP checks are ineligible for allocation.
- Closing a browser retains its binding; deletion or explicit unbinding releases it.
- Secrets and cookies must not be logged.
- Git operations are user-only. The implementation agent must not run commands that modify Git state or remotes, including add, commit, push, pull, merge, rebase, checkout, switch, reset, branch, tag, or worktree.

---

### Task 1: Package foundation and HTTP client

**Files:**
- Create: `bitbrowser/__init__.py`
- Create: `bitbrowser/exceptions.py`
- Create: `bitbrowser/models.py`
- Create: `bitbrowser/client.py`
- Test: `tests/test_client.py`

**Interfaces:**
- Produces: `BitBrowserClient(base_url: str, timeout: float, transport: Transport | None)` and `request(path: str, payload: dict | None) -> dict`.
- Produces: `BitBrowserError`, `TransportError`, `ProtocolError`, `ApiError`.
- Produces: `ProxyEndpoint`, `ProxyRecord`, `ProxyBinding`, `AllocationMode`.

- [ ] Write tests using an injected fake transport for successful JSON, non-2xx HTTP responses, invalid JSON, `success=False`, and URL construction.
- [ ] Run `python -m pytest tests/test_client.py -v`; expect import failure.
- [ ] Implement models, exceptions, redacted error messages, and the JSON POST client using `urllib.request` by default.
- [ ] Run `python -m pytest tests/test_client.py -v`; expect all tests to pass.

### Task 2: Official group and browser endpoint wrappers

**Files:**
- Create: `bitbrowser/groups.py`
- Create: `bitbrowser/browsers.py`
- Test: `tests/test_groups.py`
- Test: `tests/test_browsers.py`

**Interfaces:**
- Consumes: `BitBrowserClient.request`.
- Produces: `GroupService.create(name)`, `update(group_id, name)`, `delete(group_id)`, `list(page, page_size)` and `move_browsers(group_id, browser_ids)`.
- Produces: `BrowserService.create(payload)`, `update_partial(ids, changes)`, `get(browser_id)`, `list(...)`, `open(browser_id)`, `close(browser_id)`, `delete(browser_id)`, `delete_many(ids)`, `update_proxy(ids, proxy)`, and bounded-concurrency batch open/close results.

- [ ] Write endpoint-contract tests that assert exact paths and payloads, including pagination and the required empty fingerprint object during creation.
- [ ] Run the two test modules; expect missing service failures.
- [ ] Implement thin wrappers with input validation and per-browser batch result objects.
- [ ] Run the two test modules; expect all tests to pass.

### Task 3: SQLite proxy inventory and uniqueness rules

**Files:**
- Create: `bitbrowser/storage.py`
- Test: `tests/test_storage.py`

**Interfaces:**
- Consumes: `ProxyEndpoint`, `ProxyRecord`, `ProxyBinding`, `AllocationMode`.
- Produces: `Storage(db_path)`, `initialize()`, `add_proxy()`, `list_proxies()`, `set_proxy_enabled()`, `reserve_proxy(group_id, browser_key, mode, proxy_id=None)`, `confirm_binding()`, `mark_binding_uncertain()`, `release_binding()`, and `get_binding()`.

- [ ] Write temporary-database tests for manual selection, stable sequential selection, injectable random choice, same-group exit-IP conflict, cross-group reuse, the default group key, disabled proxies, exhaustion, and two-connection contention.
- [ ] Run `python -m pytest tests/test_storage.py -v`; expect missing repository failures.
- [ ] Implement migrations for `proxies` and `bindings`; store credentials but exclude them from `repr`; add a partial unique index on `(group_key, exit_ip)` for active/reserved/uncertain bindings.
- [ ] Use `BEGIN IMMEDIATE` around candidate selection and insertion so concurrent allocators cannot select the same group/IP pair.
- [ ] Run the storage tests; expect all tests to pass.

### Task 4: Proxy validation and BitBrowser proxy payloads

**Files:**
- Create: `bitbrowser/proxies.py`
- Test: `tests/test_proxies.py`

**Interfaces:**
- Consumes: `Storage`, `ProxyEndpoint`, injected `ExitIpChecker`.
- Produces: `ProxyPool.import_lines(lines)`, `validate(proxy_id)`, `allocate(group_id, browser_key, mode, proxy_id=None)`, `disable(proxy_id)`, and `to_bitbrowser_payload(proxy)`.

- [ ] Write tests for `http://user:pass@host:port`, `socks5://host:port`, duplicate endpoint import, IPv4/IPv6 normalized exit IPs, failed checks, and secret-free exception strings.
- [ ] Run `python -m pytest tests/test_proxies.py -v`; expect missing proxy pool failures.
- [ ] Implement strict proxy parsing, injectable checking, exit-IP normalization with `ipaddress.ip_address`, and payload mapping to `proxyMethod=2`.
- [ ] Run the proxy tests; expect all tests to pass.

### Task 5: Coordinated browser lifecycle manager

**Files:**
- Create: `bitbrowser/manager.py`
- Test: `tests/test_manager.py`

**Interfaces:**
- Consumes: `Storage`, `ProxyPool`, `BrowserService`, `GroupService`.
- Produces: `BitBrowserManager.create_browser(name, group_id, allocation_mode, proxy_id=None, fingerprint=None, remark='')`, `open_browser(browser_id)`, `close_browser(browser_id)`, `delete_browser(browser_id)`, `move_browser(browser_id, target_group_id)`, and `replace_proxy(browser_id, allocation_mode, proxy_id=None)`.

- [ ] Write tests for reservation-before-create, confirmation after success, rollback after definite failure, uncertain state after timeout, persistent random binding, proxy drift rejection on open, close retaining binding, delete releasing it, disabled proxy rejection, group-move conflicts, and rejection of proxy replacement while open.
- [ ] Run `python -m pytest tests/test_manager.py -v`; expect missing manager failures.
- [ ] Implement the orchestration state machine and remote reconciliation hooks without retrying mutating calls automatically.
- [ ] Run the manager tests; expect all tests to pass.

### Task 6: Public API, social package boundaries, and usage guide

**Files:**
- Modify: `bitbrowser/__init__.py`
- Create: `facebook/__init__.py`
- Create: `instagram/__init__.py`
- Create: `.gitignore`
- Create: `README.md`
- Test: `tests/test_public_api.py`

**Interfaces:**
- Consumes: all implemented services and manager.
- Produces: stable imports from `bitbrowser`; importable `facebook` and `instagram` namespaces with scope documentation.

- [ ] Write a smoke test importing every public symbol and constructing a manager against a temporary database with fake services.
- [ ] Run `python -m pytest tests/test_public_api.py -v`; expect missing exports/packages.
- [ ] Export the public API, ignore SQLite databases and Python secrets/caches, and document proxy import plus manual/sequential/random browser creation examples.
- [ ] Run `python -m pytest -v`; expect the full suite to pass.
- [ ] Run `python -m compileall bitbrowser facebook instagram`; expect successful compilation.

### Task 7: Local BitBrowser integration probe

**Files:**
- Create: `scripts/check_bitbrowser.py`
- Create: `tests/test_check_script.py`

**Interfaces:**
- Consumes: `BitBrowserClient` and read-only health/list services.
- Produces: a command that checks Local API health and lists the first page without creating, opening, changing, or deleting browser profiles.

- [ ] Write a test invoking the script entry function with a fake client and asserting a concise health summary.
- [ ] Run `python -m pytest tests/test_check_script.py -v`; expect missing script failure.
- [ ] Implement `python scripts/check_bitbrowser.py --base-url http://127.0.0.1:54345` with nonzero exit status on connection or API failure.
- [ ] Run the script only when a local BitBrowser service is available; report connection failure separately from unit-test results.
- [ ] Run the complete test suite again and record the result in the handoff.
