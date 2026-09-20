import argparse
import asyncio
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bitbrowser import BitBrowserClient, BrowserService
from instagram.login import InstagramLoginService

# python.exe scripts\login_first_instagram.py --relogin
# python.exe login_first_instagram.py --relogin
async def run(account_file: Path, relogin=False) -> int:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("缺少 Playwright。请先运行: pip install -r requirements.txt")
        return 2

    service = BrowserService(BitBrowserClient())
    async with async_playwright() as playwright:
        async def connect(cdp_url):
            return await playwright.chromium.connect_over_cdp(cdp_url)

        result = await InstagramLoginService(service, connect).login_first(account_file, relogin=relogin)
    print(f"browser_id={result.browser_id} username={result.username} status={result.status.value} message={result.message}")
    return 0 if result.status.value == "success" else 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="使用新建 BitBrowser 窗口登录 ins_account.md 的第一条 Instagram 账号")
    parser.add_argument(
        "--account-file",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "instagram" / "ins_account.md",
        help="Instagram 账号 Markdown 文件路径",
    )
    parser.add_argument("--relogin", action="store_true", help="自动关闭该账号已打开的窗口后重新登录")
    args = parser.parse_args(argv)
    return asyncio.run(run(args.account_file, args.relogin))


if __name__ == "__main__":
    raise SystemExit(main())
