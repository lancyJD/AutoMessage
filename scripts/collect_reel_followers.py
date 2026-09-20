import argparse
import asyncio
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bitbrowser import BitBrowserClient, BrowserService
from instagram.followers import collect_profile_followers
from instagram.login import InstagramLoginService


async def main_async(args):
    from playwright.async_api import async_playwright
    service = BrowserService(BitBrowserClient())
    async with async_playwright() as playwright:
        async def connect(url): return await playwright.chromium.connect_over_cdp(url)
        login = InstagramLoginService(service, connect)
        result = await login.login_first(args.account_file, relogin=args.relogin)
        if result.status.value not in {"success", "already_open"}:
            print(f"登录未完成：{result.status.value}")
            return 1
        opened = service.open(result.browser_id)
        browser = await connect(opened.get("ws") or f"http://{opened['http']}")
        page = browser.contexts[0].pages[0]
        count = await collect_profile_followers(page, args.profile_username)
        print(f"采集完成：{count} 位粉丝")
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("profile_username", help="博主用户名，例如 bangguseok.news 或 @bangguseok.news")
    parser.add_argument("--relogin", action="store_true")
    parser.add_argument("--account-file", type=Path, default=Path(__file__).resolve().parents[1] / "instagram" / "ins_account.md")
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
