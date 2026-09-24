"""Publish one Instagram Feed post through a BitBrowser profile."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bitbrowser import BitBrowserClient, BrowserService
from instagram.login import LoginStatus
from instagram.media import MediaInputError, MediaPreparer, compose_caption
from instagram.posting import InstagramPostService, PostStatus
from instagram.posting_login import PostingLoginService, read_posting_account, redact_secrets


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="通过 BitBrowser 全自动发布一个 Instagram Feed 帖子")
    parser.add_argument("--media", action="append", required=True, help="本地文件路径或 HTTP/HTTPS URL；多素材可重复传入")
    parser.add_argument("--title", default="", help="配文标题，支持文字和表情")
    parser.add_argument("--content", default="", help="配文正文，支持文字和表情")
    parser.add_argument(
        "--account-file",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "instagram" / "ins_account.md",
        help="Instagram 账号 Markdown 文件",
    )
    parser.add_argument("--relogin", action="store_true", help="关闭程序记录的该账号窗口后重新登录")
    return parser


async def run(args, *, browser_service=None, connect=None, media_preparer=None, login_service=None, post_service=None) -> int:
    secrets: list[str] = []
    playwright = None
    try:
        account = read_posting_account(args.account_file)
        secrets = [account.password, account.cookie, account.two_factor_secret]
        preparer = media_preparer or MediaPreparer()
        service = browser_service or BrowserService(BitBrowserClient())
        with preparer.prepare(args.media) as batch:
            if connect is None:
                from playwright.async_api import async_playwright

                playwright = await async_playwright().start()
                connect = playwright.chromium.connect_over_cdp
            login = login_service or PostingLoginService(service, connect, log=lambda message: print(redact_secrets(message, secrets)))
            poster = post_service or InstagramPostService()
            session = await login.open_session(args.account_file, relogin=args.relogin)
            username = session.result.username
            if session.result.status is LoginStatus.NEEDS_HUMAN:
                return _report(3, "needs_human", "login", username, len(batch.items), None, session.result.message, secrets)
            if session.result.status is LoginStatus.FAILED:
                return _report(1, "failed", "login", username, len(batch.items), None, session.result.message, secrets)
            result = await poster.publish(session.page, batch.items, compose_caption(args.title, args.content))
            code = {PostStatus.SUCCESS: 0, PostStatus.FAILED: 1, PostStatus.NEEDS_HUMAN: 3, PostStatus.UNKNOWN: 4}[result.status]
            return _report(code, result.status.value, result.stage, username, result.media_count, result.post_url, result.message, secrets)
    except (MediaInputError, ValueError) as exc:
        return _report(2, "failed", "input", "", len(args.media or []), None, str(exc), secrets)
    except ImportError as exc:
        return _report(2, "failed", "dependency", "", len(args.media or []), None, str(exc), secrets)
    except Exception as exc:
        return _report(1, "failed", "runtime", "", len(args.media or []), None, str(exc), secrets)
    finally:
        if playwright is not None:
            await playwright.stop()


def _report(code, status, stage, username, media_count, post_url, message, secrets):
    safe_message = redact_secrets(message, secrets)
    payload = {
        "status": status,
        "stage": stage,
        "username": username,
        "media_count": media_count,
        "post_url": post_url,
        "message": safe_message,
    }
    print(f"[{status}] stage={stage} media={media_count} {safe_message}")
    print(json.dumps(payload, ensure_ascii=False))
    return code


def main(argv=None) -> int:
    return asyncio.run(run(build_parser().parse_args(argv)))


if __name__ == "__main__":
    raise SystemExit(main())
