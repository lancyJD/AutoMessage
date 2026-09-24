import asyncio
from pathlib import Path

from instagram.posting_login import PostingLoginService, read_posting_account


class FakeBitBrowser:
    def pids(self, ids):
        return []


def test_reads_two_factor_secret_without_logging_it(tmp_path, capsys):
    source = tmp_path / "accounts.md"
    source.write_text(
        "| username | password | cookie | two_factor_secret |\n|---|---|---|---|\n"
        "| demo_user | demo_pass |  | JBSWY3DPEHPK3PXP |\n",
        encoding="utf-8",
    )
    account = read_posting_account(source)
    assert account.two_factor_secret == "JBSWY3DPEHPK3PXP"
    assert "JBSWY3DPEHPK3PXP" not in capsys.readouterr().out


def test_login_service_exposes_open_session_for_posting(tmp_path):
    service = PostingLoginService(FakeBitBrowser(), lambda _: None, log=lambda _: None, state_path=tmp_path / "state.db")
    assert callable(service.open_session)


def test_reads_legacy_key_value_account_document(tmp_path):
    source = tmp_path / "requirements.md"
    source.write_text(
        "## 账号信息\n账号=demo_user\n密码=demo_pass\n2FA=JBSWY3DPEHPK3PXP,调用工具生成验证码\n",
        encoding="utf-8",
    )
    account = read_posting_account(source)
    assert account.username == "demo_user"
    assert account.password == "demo_pass"
    assert account.cookie == ""
    assert account.two_factor_secret == "JBSWY3DPEHPK3PXP"


class RecordingLocator:
    def __init__(self):
        self.value = None
        self.clicks = 0

    async def fill(self, value):
        self.value = value

    async def click(self):
        self.clicks += 1


class MetaLoginPage:
    def __init__(self):
        self.username = RecordingLocator()
        self.password = RecordingLocator()
        self.submit = RecordingLocator()
        self.visible_login = RecordingLocator()
        self.waits = []

    def locator(self, selector):
        return {
            'input[name="email"]': self.username,
            'input[name="pass"]': self.password,
            'input[type="submit"]': self.submit,
        }[selector]

    def get_by_role(self, role, name):
        assert role == "button"
        return self.visible_login

    async def wait_for_timeout(self, milliseconds):
        self.waits.append(milliseconds)


def test_submits_credentials_using_current_meta_login_fields_and_visible_button(tmp_path):
    page = MetaLoginPage()
    service = PostingLoginService(
        FakeBitBrowser(), lambda _: None, log=lambda _: None,
        state_path=tmp_path / "state.db", random_uniform=lambda low, high: 1.25,
    )
    asyncio.run(service._submit_credentials(page, "demo_user", "demo_pass"))
    assert page.username.value == "demo_user"
    assert page.password.value == "demo_pass"
    assert page.visible_login.clicks == 1
    assert page.submit.clicks == 0
    assert page.waits == [1250]


class ExistingProfileBrowser(FakeBitBrowser):
    def __init__(self):
        self.created = False

    def list(self, page=0, page_size=100, **filters):
        assert filters["name"] == "instagram-demo_user"
        return {"list": [{"id": "older"}, {"id": "newest"}]}

    def create(self, payload):
        self.created = True
        return {"id": "created"}


def test_resolves_existing_named_profile_before_creating(tmp_path):
    browser = ExistingProfileBrowser()
    service = PostingLoginService(browser, lambda _: None, log=lambda _: None, state_path=tmp_path / "state.db")
    assert service._resolve_browser_id("demo_user") == "newest"
    assert browser.created is False
    assert service.state.get("demo_user")[0] == "newest"


class TwoFactorPage:
    def __init__(self):
        self.code = RecordingLocator()
        self.confirm = RecordingLocator()
        self.waits = []
        self.events = []

    def locator(self, selector):
        assert selector == 'input[name="verificationCode"]'
        return self.code

    def get_by_role(self, role, name):
        assert role == "button"
        return self.confirm

    async def wait_for_timeout(self, milliseconds):
        self.waits.append(milliseconds)
        self.events.append("wait")


def test_submits_two_factor_code_with_visible_confirm_button(tmp_path):
    page = TwoFactorPage()
    service = PostingLoginService(FakeBitBrowser(), lambda _: None, log=lambda _: None, state_path=tmp_path / "state.db")
    asyncio.run(service._submit_two_factor(page, "123456"))
    assert page.code.value == "123456"
    assert page.confirm.clicks == 1


def test_two_factor_waits_random_2_to_6_seconds_before_generating_code(tmp_path):
    page = TwoFactorPage()

    def totp_factory(secret, log=None):
        assert page.waits == [4250]
        page.events.append("generate")
        return "123456"

    service = PostingLoginService(
        FakeBitBrowser(), lambda _: None, log=lambda _: None,
        state_path=tmp_path / "state.db", random_uniform=lambda low, high: 4.25,
    )
    asyncio.run(service._wait_and_submit_two_factor(page, "SECRET", totp_factory))
    assert page.waits == [4250]
    assert page.events == ["wait", "generate"]
    assert page.code.value == "123456"


class TransitionPage:
    def __init__(self):
        self.waits = 0

    async def wait_for_timeout(self, milliseconds):
        self.waits += 1


class TransitionService(PostingLoginService):
    async def _logged_in(self, page):
        return page.waits >= 2

    async def _two_factor(self, page):
        return page.waits < 2

    async def _needs_human(self, page):
        return False


def test_wait_after_totp_ignores_stale_two_factor_page(tmp_path):
    page = TransitionPage()
    service = TransitionService(FakeBitBrowser(), lambda _: None, log=lambda _: None, state_path=tmp_path / "state.db")
    state = asyncio.run(service._wait_auth_state(page, attempts=4, accept_two_factor=False))
    assert state == "logged_in"
    assert page.waits == 2


class ChallengeFirstService(TransitionService):
    async def _two_factor(self, page):
        return True

    async def _needs_human(self, page):
        return True


def test_challenge_takes_priority_over_two_factor_field(tmp_path):
    service = ChallengeFirstService(FakeBitBrowser(), lambda _: None, log=lambda _: None, state_path=tmp_path / "state.db")
    assert asyncio.run(service._wait_auth_state(TransitionPage(), attempts=1)) == "needs_human"


class AccountPage:
    def __init__(self, matches):
        self.matches = matches

    def locator(self, selector):
        matches = self.matches

        class Result:
            async def count(self):
                return int(matches)

        return Result()


def test_active_account_must_match_requested_username(tmp_path):
    service = PostingLoginService(FakeBitBrowser(), lambda _: None, log=lambda _: None, state_path=tmp_path / "state.db")
    assert asyncio.run(service._account_matches(AccountPage(True), "demo_user")) is True
    assert asyncio.run(service._account_matches(AccountPage(False), "demo_user")) is False
