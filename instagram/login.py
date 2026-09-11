"""First-account Instagram login through a BitBrowser profile."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Awaitable, Callable
from .login_state import LoginState


@dataclass(frozen=True)
class Account:
    username: str
    password: str
    cookie: str


class LoginStatus(str, Enum):
    SUCCESS = "success"
    FAILED = "failed"
    NEEDS_HUMAN = "needs_human"
    ALREADY_OPEN = "already_open"


@dataclass(frozen=True)
class LoginResult:
    browser_id: str
    username: str
    status: LoginStatus
    message: str


def _markdown_cells(line: str) -> list[str]:
    return [cell.strip().replace("\\|", "|") for cell in re.split(r"(?<!\\)\|", line.strip().strip("|"))]


def read_first_account(path: str | Path) -> Account:
    lines = Path(path).read_text(encoding="utf-8-sig").splitlines()
    header_index = next(i for i, line in enumerate(lines) if "| username |" in line)
    headers = _markdown_cells(lines[header_index])
    values = _markdown_cells(lines[header_index + 2])
    fields = dict(zip(headers, values, strict=True))
    return Account(fields["username"], fields["password"], fields["cookie"])


def parse_cookie(cookie: str) -> list[dict[str, str | bool]]:
    items = []
    for part in cookie.split(";"):
        name, separator, value = part.strip().partition("=")
        if separator and name:
            items.append({"name": name, "value": value, "domain": ".instagram.com", "path": "/", "secure": True})
    return items


class InstagramLoginService:
    def __init__(self, browser_service, connect: Callable[[str], Awaitable[object]], log: Callable[[str], None] = print, state_path=None):
        self.browser_service = browser_service
        self.connect = connect
        self.log = log
        self.state = LoginState(state_path or Path(__file__).with_name("login_state.db"))

    async def login_first(self, account_file: str | Path, relogin=False) -> LoginResult:
        account = read_first_account(account_file)
        saved = self.state.get(account.username)
        browser_id = None
        if saved:
            browser_id = saved[0]
            alive = bool(self.browser_service.pids([browser_id]))
            if alive and not relogin:
                return LoginResult(browser_id, account.username, LoginStatus.ALREADY_OPEN, "Existing browser is already open")
            if alive and relogin:
                self.browser_service.close(browser_id)
        if browser_id is None:
            profile = self.browser_service.create({
            "name": f"instagram-{account.username}",
            "remark": "Instagram first-login test",
            "proxyMethod": 2,
            "proxyType": "noproxy",
            "browserFingerPrint": {},
            })
            browser_id = profile["id"]
        self.log(f"created browser_id={browser_id} username={account.username}")
        opened = self.browser_service.open(browser_id)
        cdp_url = opened.get("ws") or f"http://{opened['http']}"
        browser = await self.connect(cdp_url)
        context = browser.contexts[0] if browser.contexts else await browser.new_context()
        page = context.pages[0] if context.pages else await context.new_page()
        await context.add_cookies(parse_cookie(account.cookie))
        await page.goto("https://www.instagram.com/", wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)

        if await self._is_logged_in(page):
            await self._close_notification(page)
            result = LoginResult(browser_id, account.username, LoginStatus.SUCCESS, "Cookie login succeeded")
            self.state.save(account.username, browser_id, result.status.value)
            return result
        if await self._needs_human(page):
            return LoginResult(browser_id, account.username, LoginStatus.NEEDS_HUMAN, "Instagram requires verification")

        try:
            await page.locator('input[name="username"]').fill(account.username)
            await page.locator('input[name="password"]').fill(account.password)
            await page.locator('button[type="submit"]').click()
            await page.wait_for_timeout(3000)
        except Exception as exc:
            return LoginResult(browser_id, account.username, LoginStatus.FAILED, f"Password form unavailable: {exc}")

        if await self._is_logged_in(page):
            await self._close_notification(page)
            result = LoginResult(browser_id, account.username, LoginStatus.SUCCESS, "Password login succeeded")
            self.state.save(account.username, browser_id, result.status.value)
            return result
        if await self._needs_human(page):
            return LoginResult(browser_id, account.username, LoginStatus.NEEDS_HUMAN, "Instagram requires verification")
        return LoginResult(browser_id, account.username, LoginStatus.FAILED, "Instagram did not confirm login")

    async def _is_logged_in(self, page) -> bool:
        if "/accounts/login" in page.url or "/challenge" in page.url:
            return False
        return await page.locator('a[href="/"]').count() >= 2

    async def _needs_human(self, page) -> bool:
        url = page.url.lower()
        return "/challenge" in url or "/two_factor" in url or "/accounts/login/two_factor" in url

    async def _close_notification(self, page):
        try:
            dialog = page.get_by_role("dialog")
            if await dialog.count():
                button = dialog.get_by_role("button", name="以后再说")
                if await button.count():
                    await button.click()
                    self.log("notification popup closed")
        except Exception:
            pass
