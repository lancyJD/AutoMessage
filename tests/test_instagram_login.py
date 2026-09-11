import asyncio
import subprocess
import sys
from pathlib import Path

from instagram.login import Account, InstagramLoginService, LoginStatus, parse_cookie, read_first_account


def test_reads_first_account_from_markdown_table(tmp_path):
    source = tmp_path / "accounts.md"
    source.write_text(
        "| username | password | cookie |\n|---|---|---|\n| demo_user | demo_pass | mid=device; sessionid=token |\n",
        encoding="utf-8",
    )
    account = read_first_account(source)
    assert account == Account("demo_user", "demo_pass", "mid=device; sessionid=token")


def test_reads_first_real_account_without_splitting_escaped_name_pipe():
    account = read_first_account(Path(__file__).resolve().parents[1] / "instagram" / "ins_account.md")
    assert account.username
    assert account.password
    assert "sessionid=" in account.cookie


def test_parses_cookie_for_instagram_domain():
    assert parse_cookie("mid=device; sessionid=token") == [
        {"name": "mid", "value": "device", "domain": ".instagram.com", "path": "/", "secure": True},
        {"name": "sessionid", "value": "token", "domain": ".instagram.com", "path": "/", "secure": True},
    ]


class FakeLocator:
    async def count(self):
        return 2


class FakePage:
    url = "https://www.instagram.com/"

    def locator(self, selector):
        return FakeLocator()

    async def goto(self, url, wait_until):
        self.url = url

    async def wait_for_timeout(self, milliseconds):
        pass


class FakeContext:
    def __init__(self):
        self.pages = [FakePage()]
        self.cookies = []

    async def add_cookies(self, cookies):
        self.cookies.extend(cookies)


class FakeBrowser:
    def __init__(self):
        self.contexts = [FakeContext()]


class FakeBitBrowser:
    def __init__(self):
        self.payload = None

    def create(self, payload):
        self.payload = payload
        return {"id": "bit-profile-1"}

    def open(self, browser_id):
        return {"ws": "ws://127.0.0.1:12345"}

    def pids(self, ids):
        return []


def test_creates_direct_profile_and_reports_cookie_login(tmp_path):
    source = tmp_path / "accounts.md"
    source.write_text(
        "| username | password | cookie |\n|---|---|---|\n| demo_user | demo_pass | mid=device; sessionid=token |\n",
        encoding="utf-8",
    )
    bit = FakeBitBrowser()

    async def connect(url):
        assert url == "ws://127.0.0.1:12345"
        return FakeBrowser()

    result = asyncio.run(InstagramLoginService(bit, connect, log=lambda _: None, state_path=tmp_path / "state.db").login_first(source))
    assert result.status is LoginStatus.SUCCESS
    assert result.browser_id == "bit-profile-1"
    assert bit.payload["proxyType"] == "noproxy"


def test_login_script_exposes_help_without_starting_browser():
    result = subprocess.run(
        [sys.executable, "scripts/login_first_instagram.py", "--help"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "account-file" in result.stdout
