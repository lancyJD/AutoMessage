import argparse
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bitbrowser import BitBrowserClient, BitBrowserError


def check(client):
    return {"ok": True, "data": client.request("/health")}


def main(argv=None):
    parser = argparse.ArgumentParser(description="检查比特浏览器 Local API")
    parser.add_argument("--base-url", default="http://127.0.0.1:54345")
    args = parser.parse_args(argv)
    try:
        result = check(BitBrowserClient(args.base_url))
    except BitBrowserError as exc:
        print(f"连接失败: {exc}")
        return 1
    print(f"连接成功: {result['data']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
