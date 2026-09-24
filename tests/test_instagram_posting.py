import asyncio
from pathlib import Path

from instagram.media import PreparedMedia
from instagram.posting import InstagramPostService, PlaywrightPostDriver, PostStatus


class FakeDriver:
    def __init__(self, fail_stage=None, language="zh"):
        self.fail_stage = fail_stage
        self.language = language
        self.trace = []
        self.share_click_count = 0

    async def open_create(self):
        self.trace.append("click:create")

    async def upload(self, paths):
        if self.fail_stage == "upload":
            raise TimeoutError("upload timeout")
        self.trace.append("set_files:" + ",".join(Path(path).name for path in paths))

    async def next_crop(self):
        self.trace.append("click:next:crop")

    async def next_edit(self):
        self.trace.append("click:next:edit")

    async def fill_caption(self, caption):
        self.trace.append("fill:caption:" + caption)

    async def share(self):
        if self.fail_stage == "share_click":
            raise RuntimeError("share unavailable")
        self.share_click_count += 1
        self.trace.append("click:share")
        if self.fail_stage == "share_dispatched_then_error":
            raise RuntimeError("browser disconnected after dispatch")

    async def wait_success(self):
        if self.fail_stage == "success_wait":
            raise TimeoutError("success missing")
        self.trace.append("wait:success")
        return "https://www.instagram.com/p/example/"


def media_items():
    return [
        PreparedMedia("one.png", Path("one.png"), "image/png", False),
        PreparedMedia("two.mp4", Path("two.mp4"), "video/mp4", False),
    ]


def test_publishes_ordered_carousel_once():
    driver = FakeDriver()
    result = asyncio.run(InstagramPostService(driver_factory=lambda _: driver).publish(object(), media_items(), "제목\n\n내용"))
    assert result.status is PostStatus.SUCCESS
    assert result.post_url == "https://www.instagram.com/p/example/"
    assert driver.trace == [
        "click:create", "set_files:one.png,two.mp4", "click:next:crop",
        "click:next:edit", "fill:caption:제목\n\n내용", "click:share", "wait:success",
    ]
    assert driver.share_click_count == 1


def test_upload_timeout_returns_failure_without_share():
    driver = FakeDriver("upload")
    result = asyncio.run(InstagramPostService(driver_factory=lambda _: driver).publish(object(), media_items(), "caption"))
    assert (result.status, result.stage, result.share_clicked) == (PostStatus.FAILED, "upload", False)
    assert driver.share_click_count == 0


def test_missing_success_after_share_returns_unknown_and_never_reclicks():
    driver = FakeDriver("success_wait")
    result = asyncio.run(InstagramPostService(driver_factory=lambda _: driver).publish(object(), media_items(), "caption"))
    assert (result.status, result.share_clicked) == (PostStatus.UNKNOWN, True)
    assert driver.share_click_count == 1


def test_share_click_failure_is_unknown_because_dispatch_is_ambiguous():
    driver = FakeDriver("share_click")
    result = asyncio.run(InstagramPostService(driver_factory=lambda _: driver).publish(object(), media_items(), "caption"))
    assert (result.status, result.stage, result.share_clicked) == (PostStatus.UNKNOWN, "publish", True)


def test_share_dispatch_error_is_unknown_to_prevent_retry():
    driver = FakeDriver("share_dispatched_then_error")
    result = asyncio.run(InstagramPostService(driver_factory=lambda _: driver).publish(object(), media_items(), "caption"))
    assert result.status is PostStatus.UNKNOWN
    assert result.share_clicked is True
    assert driver.share_click_count == 1


def test_english_page_uses_same_state_machine():
    driver = FakeDriver(language="en")
    result = asyncio.run(InstagramPostService(driver_factory=lambda _: driver).publish(object(), media_items(), "caption"))
    assert result.status is PostStatus.SUCCESS


class OverlayLocator:
    def __init__(self):
        self.clicks = 0

    async def count(self):
        return 1

    async def click(self, **kwargs):
        self.clicks += 1


class OverlayPage:
    def __init__(self):
        self.not_now = OverlayLocator()

    def get_by_role(self, role, name):
        assert role == "button"
        return self.not_now


def test_dismisses_notification_overlay_before_create():
    page = OverlayPage()
    driver = PlaywrightPostDriver(page)
    asyncio.run(driver._dismiss_overlays())
    assert page.not_now.clicks == 1
