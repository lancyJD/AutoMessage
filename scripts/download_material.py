"""Command line entry point for persistent yt-dlp material downloads."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from instagram.material_downloader import (
    DEFAULT_OUTPUT_DIR,
    BatchSummary,
    MaterialDownloader,
    MaterialInputError,
    read_batch_urls,
)


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("必须是大于0的整数")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="使用 yt-dlp 下载并记录素材")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    commands = parser.add_subparsers(dest="command", required=True)

    url = commands.add_parser("url", help="下载一个帖子或视频链接")
    url.add_argument("value")

    batch = commands.add_parser("batch", help="从文本文件批量读取链接")
    batch.add_argument("file", type=Path)

    search = commands.add_parser("search", help="搜索并下载 YouTube 结果")
    search.add_argument("query")
    search.add_argument("--count", type=positive_int, default=3)
    return parser


def console_text(value: object, encoding: str | None = None) -> str:
    target_encoding = encoding or getattr(sys.stdout, "encoding", None) or "utf-8"
    return str(value).encode(target_encoding, errors="backslashreplace").decode(target_encoding)


def console_print(value: object) -> None:
    print(console_text(value))


def _print_summary(summary: BatchSummary) -> int:
    for result in summary.results:
        target = result.record.metadata_path if result.record else result.source
        suffix = f" {result.message}" if result.message else ""
        console_print(f"[{result.status}] {target}{suffix}")
    console_print(
        f"总数={len(summary.results)} 成功={summary.succeeded} "
        f"跳过={summary.skipped} 失败={summary.failed}"
    )
    return 1 if summary.failed else 0


def run(args, downloader=None) -> int:
    try:
        downloader = downloader or MaterialDownloader(args.output_dir)
        if args.command == "url":
            summary = BatchSummary(downloader.download_url(args.value))
        elif args.command == "batch":
            summary = downloader.download_batch(read_batch_urls(args.file))
        else:
            summary = downloader.search_youtube(args.query, args.count)
        return _print_summary(summary)
    except ImportError as exc:
        console_print(f"[dependency] yt-dlp 依赖不可用: {exc}")
        return 2
    except (MaterialInputError, OSError, ValueError) as exc:
        console_print(f"[input] {exc}")
        return 2
    except Exception as exc:
        console_print(f"[failed] {exc}")
        return 1


def main(argv=None) -> int:
    return run(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
