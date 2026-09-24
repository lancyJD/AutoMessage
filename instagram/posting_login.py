"""BitBrowser login session retained for Instagram posting automation."""

from __future__ import annotations

import re
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable

from .login import LoginResult, LoginStatus, parse_cookie
from .login_state import LoginState
from .totp import generate_totp


@dataclass(frozen=True)
class PostingAccount:
    username: str
    password: str
    cookie: str = ""
    two_factor_secret: str = ""


@dataclass(frozen=True)
class LoginSession:
    result: LoginResult
    browser: object
    context: object
    page: object


def _cells(line: str) -> list[str]:
    return [cell.strip().replace("\\|", "|") for cell in re.split(r"(?<!\\)\|", line.strip().strip("|"))]


def read_posting_account(path: str | Path) -> PostingAccount:
    lines = Path(path).read_text(encoding="utf-8-sig").splitlines()
    header_index = next((i for i, line in enumerate(lines) if "| username |" in line), None)
    if header_index is not None:
        fields = dict(zip(_cells(lines[header_index]), _cells(lines[header_index + 2]), strict=True))
    else:
        aliases = {"账号": "username", "密码": "password", "2FA": "two_factor_secret", "Cookie": "cookie"}
        fields = {}
        for line in lines:
            key, separator, value = line.strip().partition("=")
            if separator and key in aliases:
                fields[aliases[key]] = value.split(",", 1)[0].strip()
        if "username" not in fields or "password" not in fields:
            raise ValueError("账号文件缺少 username/password 或 账号/密码 字段")
    return PostingAccount(
        username=fields["username"],
        password=fields["password"],
        cookie=fields.get("cookie", ""),
        two_factor_secret=fields.get("two_factor_secret", ""),
    )


def redact_secrets(text: object, secrets) -> str:
    result = str(text)
    for secret in secrets:
        if secret:
            result = result.replace(str(secret), "[REDACTED]")
    result = re.sub(r"(?<!\d)\d{6}(?!\d)", "[REDACTED]", result)
    return result


class PostingLoginService:
    def __init__(self, browser_service, connect: Callable[[str], Awaitable[object]], log=print, state_path=None, random_uniform=None):
        self.browser_service = browser_service
        self.connect = connect
        self.log = log
        self.random_uniform = random_uniform or random.uniform
        self.state = LoginState(state_path or Path(__file__).with_name("login_state.db"))

    async def open_session(self, account_file: str | Path, relogin=False, totp_factory=generate_totp) -> LoginSession:
        account = read_posting_account(account_file)
        browser_id = None
        saved = self.state.get(account.username)
        if saved:
            browser_id = saved[0]
            alive = bool(self.browser_service.pids([browser_id]))
            if alive and relogin:
                self.browser_service.close(browser_id)
        if browser_id is None:
            browser_id = self._resolve_browser_id(account.username)
        opened = self.browser_service.open(browser_id)
        browser, context, page = await self._connect(opened)
        secrets = (account.password, account.cookie, account.two_factor_secret)
        try:
            if account.cookie:
                await context.add_cookies(parse_cookie(account.cookie))
            await page.goto("https://www.instagram.com/", wait_until="domcontentloaded")
            await page.wait_for_timeout(1500)
            if await self._logged_in(page):
                if await self._account_matches(page, account.username):
                    return self._success(browser_id, account.username, browser, context, page, "Existing session login succeeded")
                return self._result(browser_id, account.username, LoginStatus.NEEDS_HUMAN, "The active Instagram account does not match the requested account", browser, context, page)
            if await self._needs_human(page):
                return self._result(browser_id, account.username, LoginStatus.NEEDS_HUMAN, "Instagram requires human verification", browser, context, page)
            if await self._two_factor(page):
                auth_state = "two_factor"
            else:
                await self._submit_credentials(page, account.username, account.password)
                auth_state = await self._wait_auth_state(page)
            if auth_state == "two_factor":
                if not account.two_factor_secret:
                    return self._result(browser_id, account.username, LoginStatus.NEEDS_HUMAN, "Instagram requires two-factor authentication", browser, context, page)
                await self._wait_and_submit_two_factor(page, account.two_factor_secret, totp_factory)
                auth_state = await self._wait_auth_state(page, accept_two_factor=False)
            if await self._logged_in(page):
                if await self._account_matches(page, account.username):
                    return self._success(browser_id, account.username, browser, context, page, "Password login succeeded")
                return self._result(browser_id, account.username, LoginStatus.NEEDS_HUMAN, "The active Instagram account does not match the requested account", browser, context, page)
            status = LoginStatus.NEEDS_HUMAN if await self._needs_human(page) or await self._two_factor(page) else LoginStatus.FAILED
            return self._result(browser_id, account.username, status, "Instagram did not confirm login", browser, context, page)
        except Exception as exc:
            message = redact_secrets(f"Instagram login failed: {exc}", secrets)
            return self._result(browser_id, account.username, LoginStatus.FAILED, message, browser, context, page)

    def _resolve_browser_id(self, username: str) -> str:
        listing = self.browser_service.list(page=0, page_size=100, name=f"instagram-{username}")
        profiles = list(listing.get("list") or [])
        if profiles:
            with_sequence = [item for item in profiles if isinstance(item.get("seq"), int)]
            selected = max(with_sequence, key=lambda item: item["seq"]) if with_sequence else profiles[-1]
            browser_id = selected["id"]
        else:
            browser_id = self.browser_service.create({
                "name": f"instagram-{username}",
                "remark": "Instagram auto post",
                "proxyMethod": 2,
                "proxyType": "noproxy",
                "browserFingerPrint": {},
            })["id"]
        self.state.save(username, browser_id, "profile_ready")
        return browser_id

    async def _connect_existing(self, browser_id, username):
        opened = self.browser_service.open(browser_id)
        browser, context, page = await self._connect(opened)
        result = LoginResult(browser_id, username, LoginStatus.ALREADY_OPEN, "Existing browser is already open")
        return LoginSession(result, browser, context, page)

    async def _account_matches(self, page, username: str) -> bool:
        normalized = username.strip().lstrip("@").lower()
        return await page.locator(f'a[href="/{normalized}/"]').count() > 0

    async def _submit_credentials(self, page, username: str, password: str) -> None:
        await page.locator('input[name="email"]').fill(username)
        await self._random_delay(page, 0.9, 2.0)
        await page.locator('input[name="pass"]').fill(password)
        await page.get_by_role("button", name=re.compile(r"^(登录|Log in)$", re.I)).click()

    async def _random_delay(self, page, minimum: float, maximum: float) -> None:
        seconds = self.random_uniform(minimum, maximum)
        await page.wait_for_timeout(round(seconds * 1000))

    async def _wait_and_submit_two_factor(self, page, secret: str, totp_factory) -> None:
        await self._random_delay(page, 2.0, 6.0)
        try:
            code = totp_factory(secret, log=None)
        except TypeError:
            code = totp_factory(secret)
        await self._submit_two_factor(page, code)

    async def _submit_two_factor(self, page, code: str) -> None:
        await page.locator('input[name="verificationCode"]').fill(code)
        await page.get_by_role("button", name=re.compile(r"^(确认|Confirm)$", re.I)).click()

    async def _wait_auth_state(self, page, attempts=20, accept_two_factor=True) -> str:
        for _ in range(attempts):
            if await self._logged_in(page):
                return "logged_in"
            if await self._needs_human(page):
                return "needs_human"
            if accept_two_factor and await self._two_factor(page):
                return "two_factor"
            await page.wait_for_timeout(500)
        return "unknown"

    async def _connect(self, opened):
        cdp_url = opened.get("ws") or f"http://{opened['http']}"
        browser = await self.connect(cdp_url)
        context = browser.contexts[0] if browser.contexts else await browser.new_context()
        page = context.pages[0] if context.pages else await context.new_page()
        return browser, context, page

    def _result(self, browser_id, username, status, message, browser, context, page):
        return LoginSession(LoginResult(browser_id, username, status, message), browser, context, page)

    def _success(self, browser_id, username, browser, context, page, message):
        self.state.save(username, browser_id, LoginStatus.SUCCESS.value)
        return self._result(browser_id, username, LoginStatus.SUCCESS, message, browser, context, page)

    async def _logged_in(self, page) -> bool:
        url = page.url.lower()
        if "/accounts/login" in url or "/challenge" in url:
            return False
        return await page.locator('a[href="/"]').count() >= 2

    async def _two_factor(self, page) -> bool:
        url = page.url.lower()
        return "/two_factor" in url or await page.locator('input[name="verificationCode"]').count() > 0

    async def _needs_human(self, page) -> bool:
        url = page.url.lower()
        if "/challenge" in url:
            return True
        return await page.locator('iframe[src*="captcha"], input[name*="captcha"]').count() > 0
