import asyncio
from argparse import Namespace
from pathlib import Path

from instagram.material_downloader import DownloadResult, MaterialRecord
from scripts.download_and_publish_instagram import build_caption, build_parser, run


class FakeDownloader:
    def __init__(self, results=None, error=None):
        self.results = results or []
        self.error = error
        self.sources = []

    def download_url(self, source):
        self.sources.append(source)
        if self.error:
            raise self.error
        return self.results


def make_args(source, output_dir):
    return Namespace(
        source_url=source,
        output_dir=Path(output_dir),
        account_file=Path("account.md"),
        relogin=False,
    )


def make_record(tmp_path, title="标题", content="正文", suffix=".txt"):
    tmp_path.mkdir(parents=True, exist_ok=True)
    media = tmp_path / "video.mp4"
    media.write_bytes(b"media")
    metadata = tmp_path / f"record{suffix}"
    metadata.write_text(f"标题:{title}\n内容:{content}\n素材:{media.resolve()}\n", encoding="utf-8")
    return MaterialRecord(title, content, "TikTok", "1", "https://t.test/1", tmp_path, (media.resolve(),), metadata)


def test_parser_accepts_source_and_automation_options(tmp_path):
    args = build_parser().parse_args(["https://t.test/1", "--output-dir", str(tmp_path), "--relogin"])
    assert args.source_url == "https://t.test/1"
    assert args.output_dir == tmp_path
    assert args.relogin is True


def test_build_caption_deduplicates_equal_normalized_text():
    assert build_caption("同一内容", "同一内容") == "同一内容"
    assert build_caption("同一内容\n", " 同一内容 ") == "同一内容"
    assert build_caption("标题", "正文") == "标题\n\n正文"


def test_download_then_immediately_publishes_without_confirmation(tmp_path):
    record = make_record(tmp_path)
    downloader = FakeDownloader([DownloadResult("success", record.source_url, record)])
    calls = []

    async def publisher(args, reporter=None):
        calls.append(args)
        reporter({"status": "success", "stage": "publish", "username": "demo", "media_count": 1, "post_url": "https://www.instagram.com/p/ok/", "message": "ok"})
        return 0

    code = asyncio.run(run(make_args(record.source_url, tmp_path), downloader=downloader, publisher=publisher))
    assert code == 0
    assert len(calls) == 1
    assert calls[0].media == [str(record.media_paths[0])]
    assert calls[0].title == "标题\n\n正文"
    assert calls[0].content == ""


def test_skipped_download_still_publishes(tmp_path):
    record = make_record(tmp_path)
    downloader = FakeDownloader([DownloadResult("skipped", record.source_url, record)])
    called = []

    async def publisher(_args, reporter=None):
        called.append(True)
        reporter({"status": "success", "stage": "publish", "username": "demo", "media_count": 1, "post_url": None, "message": "ok"})
        return 0

    assert asyncio.run(run(make_args(record.source_url, tmp_path), downloader=downloader, publisher=publisher)) == 0
    assert called == [True]


def test_invalid_download_results_never_publish(tmp_path):
    called = []

    async def publisher(*_args, **_kwargs):
        called.append(True)
        return 0

    cases = [
        [],
        [DownloadResult("failed", "https://t.test/1", message="bad")],
        [
            DownloadResult("success", "one", make_record(tmp_path / "one")),
            DownloadResult("success", "two", make_record(tmp_path / "two")),
        ],
    ]
    for results in cases:
        code = asyncio.run(run(make_args("https://t.test/1", tmp_path), downloader=FakeDownloader(results), publisher=publisher))
        assert code in {1, 2}
    assert called == []


def test_missing_metadata_or_media_never_publishes(tmp_path):
    record = make_record(tmp_path)
    record.metadata_path.unlink()
    called = []

    async def publisher(*_args, **_kwargs):
        called.append(True)
        return 0

    code = asyncio.run(run(make_args(record.source_url, tmp_path), downloader=FakeDownloader([DownloadResult("success", record.source_url, record)]), publisher=publisher))
    assert code == 2
    assert called == []
