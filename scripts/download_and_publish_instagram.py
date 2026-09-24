"""Download one public media page and immediately publish it to Instagram."""

from __future__ import annotations

import argparse
import asyncio
import json
from argparse import Namespace
from pathlib import Path

from instagram.material_downloader import (
    DEFAULT_OUTPUT_DIR,
    MaterialDownloader,
    MaterialInputError,
    redact_text,
    validate_http_url,
)
from scripts.download_material import console_print
from scripts.publish_instagram_post import run as publish_instagram

ROOT = Path(__file__).resolve().parents[1]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="下载素材后立即发布 Instagram Feed")
    parser.add_argument("source_url")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--account-file", type=Path, default=ROOT / "instagram" / "ins_account.md")
    parser.add_argument("--relogin", action="store_true")
    return parser


def build_caption(title: str, content: str) -> str:
    normalized_title = " ".join(str(title or "").split()).strip()
    normalized_content = " ".join(str(content or "").split()).strip()
    if normalized_title == normalized_content:
        return normalized_title
    return "\n\n".join(value for value in (normalized_title, normalized_content) if value)


def _within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _output(code: int, **payload) -> int:
    safe = {key: redact_text(value) if isinstance(value, str) else value for key, value in payload.items()}
    console_print(json.dumps(safe, ensure_ascii=False))
    return code


async def run(args, *, downloader=None, publisher=None) -> int:
    publisher = publisher or publish_instagram
    try:
        source_url = validate_http_url(args.source_url)
        downloader = downloader or MaterialDownloader(args.output_dir)
        results = downloader.download_url(source_url)
    except (MaterialInputError, ValueError, ImportError, OSError) as exc:
        return _output(2, status="failed", stage="download", source_url=redact_text(args.source_url), message=str(exc))
    except Exception as exc:
        return _output(1, status="failed", stage="download", source_url=redact_text(args.source_url), message=str(exc))

    if len(results) != 1:
        return _output(2, status="failed", stage="metadata", source_url=redact_text(source_url), message="来源必须对应一个可发布内容")
    download_result = results[0]
    record = download_result.record
    if download_result.status not in {"success", "skipped"} or record is None:
        return _output(1, status="failed", stage="download", source_url=redact_text(source_url), download_status=download_result.status, message=download_result.message)
    if record.metadata_path.suffix.lower() not in {".txt", ".text"} or not record.metadata_path.is_file():
        return _output(2, status="failed", stage="metadata", source_url=redact_text(source_url), message="元数据文件不存在或后缀不受支持")
    root = Path(args.output_dir).resolve()
    media_paths = tuple(Path(path).resolve() for path in record.media_paths)
    if not media_paths or any(not path.is_file() or not _within(path, root) for path in media_paths):
        return _output(2, status="failed", stage="media", source_url=redact_text(source_url), message="素材不存在或超出输出目录")

    publish_args = Namespace(
        media=[str(path) for path in media_paths],
        title=build_caption(record.title, record.content),
        content="",
        account_file=args.account_file,
        relogin=args.relogin,
    )
    captured: list[dict] = []
    code = await publisher(publish_args, reporter=captured.append)
    publish_payload = captured[-1] if captured else {}
    return _output(
        code,
        status=publish_payload.get("status", "failed" if code else "success"),
        stage=publish_payload.get("stage", "publish"),
        source_url=redact_text(source_url),
        download_status=download_result.status,
        metadata_path=str(record.metadata_path),
        media_count=len(media_paths),
        username=publish_payload.get("username", ""),
        post_url=publish_payload.get("post_url"),
        message=publish_payload.get("message", ""),
    )


def main(argv=None) -> int:
    return asyncio.run(run(build_parser().parse_args(argv)))


if __name__ == "__main__":
    raise SystemExit(main())
