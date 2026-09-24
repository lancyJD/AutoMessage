"""Playwright state machine for one irreversible Instagram Feed publish."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Sequence

from .media import PreparedMedia


class PostStatus(str, Enum):
    SUCCESS = "success"
    FAILED = "failed"
    NEEDS_HUMAN = "needs_human"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class PostResult:
    status: PostStatus
    stage: str
    message: str
    post_url: str | None
    media_count: int
    share_clicked: bool


class InstagramPostService:
    def __init__(self, driver_factory: Callable | None = None, timeout_ms=30_000):
        self.driver_factory = driver_factory or (lambda page: PlaywrightPostDriver(page, timeout_ms))

    async def publish(self, page, media: Sequence[PreparedMedia], caption: str) -> PostResult:
        driver = self.driver_factory(page)
        count = len(media)
        share_clicked = False
        stage = "create"
        try:
            await driver.open_create()
            stage = "upload"
            await driver.upload([str(item.path) for item in media])
            stage = "crop"
            await driver.next_crop()
            stage = "edit"
            await driver.next_edit()
            stage = "compose"
            await driver.fill_caption(caption)
            stage = "publish"
            share_clicked = True
            await driver.share()
            stage = "confirm"
            post_url = await driver.wait_success()
            return PostResult(PostStatus.SUCCESS, "complete", "Post published", post_url, count, True)
        except Exception as exc:
            if share_clicked:
                return PostResult(PostStatus.UNKNOWN, stage, f"Publish result could not be confirmed: {exc}", None, count, True)
            return PostResult(PostStatus.FAILED, stage, f"Post failed during {stage}: {exc}", None, count, False)


class PlaywrightPostDriver:
    CREATE = re.compile(r"^(新帖子|创建|Create|New post)$", re.I)
    NEXT = re.compile(r"^(继续|Next)$", re.I)
    SHARE = re.compile(r"^(分享|Share)$", re.I)
    SUCCESS = re.compile(r"(帖子已分享|Your post has been shared|Post shared)", re.I)

    def __init__(self, page, timeout_ms=30_000):
        self.page = page
        self.timeout_ms = timeout_ms

    async def open_create(self):
        await self._dismiss_overlays()
        trigger = self.page.get_by_role("button", name=self.CREATE)
        if await trigger.count() == 0:
            trigger = self.page.get_by_label(self.CREATE)
        await trigger.first.click(timeout=self.timeout_ms)
        await self.page.get_by_role("heading", name=re.compile(r"创建新帖子|Create new post", re.I)).wait_for(timeout=self.timeout_ms)

    async def _dismiss_overlays(self):
        dismiss = self.page.get_by_role("button", name=re.compile(r"^(以后再说|Not Now)$", re.I))
        if await dismiss.count():
            await dismiss.click(timeout=5_000)

    async def upload(self, paths):
        file_input = self.page.locator('input[type="file"][multiple]')
        await file_input.set_input_files(paths, timeout=self.timeout_ms)
        await self.page.get_by_role("heading", name=re.compile(r"裁剪|Crop", re.I)).wait_for(timeout=self.timeout_ms)

    async def _next(self):
        await self.page.get_by_role("button", name=self.NEXT).last.click(timeout=self.timeout_ms)

    async def next_crop(self):
        await self._next()
        await self.page.get_by_role("heading", name=re.compile(r"编辑|Edit", re.I)).wait_for(timeout=self.timeout_ms)

    async def next_edit(self):
        await self._next()
        await self._caption_box().wait_for(timeout=self.timeout_ms)

    def _caption_box(self):
        return self.page.locator('div[contenteditable="true"][role="textbox"], textarea[aria-label*="配文"], textarea[aria-label*="caption" i]').first

    async def fill_caption(self, caption):
        if caption:
            await self._caption_box().fill(caption, timeout=self.timeout_ms)

    async def share(self):
        await self.page.get_by_role("button", name=self.SHARE).last.click(timeout=self.timeout_ms)

    async def wait_success(self):
        await self.page.get_by_text(self.SUCCESS).first.wait_for(timeout=self.timeout_ms)
        return None
