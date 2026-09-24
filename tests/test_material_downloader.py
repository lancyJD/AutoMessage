from pathlib import Path

import pytest

from instagram.material_downloader import (
    DEFAULT_OUTPUT_DIR,
    DownloadResult,
    MaterialDownloader,
    MaterialInputError,
    build_item_key,
    read_batch_urls,
    sanitize_component,
    validate_http_url,
)


class FakeYoutubeDL:
    def __init__(self, options, info, create_files=True, calls=None):
        self.options = options
        self.info = info
        self.create_files = create_files
        self.calls = calls

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def extract_info(self, source, download=True):
        if self.calls is not None:
            self.calls.append(download)
        result = self.info
        for entry in self.info.get("entries") or []:
            if entry.get("webpage_url") == source:
                result = entry
                break
        if download and self.create_files:
            for entry in result.get("entries") or [result]:
                for path in entry.get("test_paths", []):
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(b"media")
        return result


def factory_for(info, *, create_files=True, capture=None, calls=None):
    def factory(options):
        if capture is not None:
            capture.append(options)
        return FakeYoutubeDL(options, info, create_files, calls)

    return factory


def test_default_output_directory_and_url_validation():
    assert DEFAULT_OUTPUT_DIR == Path(r"C:\Users\DELL\Pictures\sucai")
    assert validate_http_url(" https://example.test/a ") == "https://example.test/a"
    with pytest.raises(MaterialInputError, match="HTTP/HTTPS"):
        validate_http_url("file:///etc/passwd")


def test_sanitize_component_handles_windows_names_and_unicode():
    assert sanitize_component('a<b>:c"d/e\\f|g?h*.', "untitled", 80) == "a_b__c_d_e_f_g_h_"
    assert sanitize_component("CON", "untitled", 80) == "_CON"
    assert sanitize_component("旅行" * 100, "untitled", 20) == "旅行" * 10
    assert sanitize_component(" ... ", "untitled", 80) == "untitled"


def test_build_item_key_has_stable_fallback_id():
    assert build_item_key(
        {"extractor_key": "TikTok", "title": "旅行/风景", "id": "748"},
        "https://t.test/748",
    ) == "TikTok_旅行_风景_748"
    first = build_item_key({}, "https://example.test/a")
    assert first == build_item_key({}, "https://example.test/a")
    assert first.startswith("unknown_untitled_")


def test_download_writes_metadata_and_uses_safe_options(tmp_path):
    media = tmp_path / "TikTok_trip_748" / "trip.mp4"
    info = {
        "id": "748",
        "title": "trip",
        "description": "hello",
        "extractor_key": "TikTok",
        "webpage_url": "https://t.test/748",
        "test_paths": [media],
        "requested_downloads": [{"filepath": str(media)}],
    }
    captured = []
    results = MaterialDownloader(tmp_path, factory_for(info, capture=captured), log=lambda _message: None).download_url(
        "https://t.test/748"
    )
    record = results[0].record
    assert results[0].status == "success"
    assert record is not None
    assert record.media_paths == (media.resolve(),)
    assert record.metadata_path.read_text(encoding="utf-8") == (
        f"标题:trip\n内容:hello\n素材:{media.resolve()}\n"
    )
    assert captured[0]["ignoreconfig"] is True
    assert not list(tmp_path.rglob("*.tmp"))


def test_download_normalizes_playlist_and_multiple_path_shapes(tmp_path):
    first = tmp_path / "Youtube_one_1" / "one.mp4"
    second = tmp_path / "Youtube_two_2" / "two.webm"
    info = {
        "entries": [
            {
                "id": "1",
                "title": "one",
                "extractor_key": "Youtube",
                "webpage_url": "https://y.test/1",
                "test_paths": [first],
                "requested_formats": [{"filepath": str(first)}],
            },
            {
                "id": "2",
                "title": "two",
                "extractor_key": "Youtube",
                "webpage_url": "https://y.test/2",
                "test_paths": [second],
                "filepath": str(second),
            },
        ]
    }
    results = MaterialDownloader(tmp_path, factory_for(info), log=lambda _message: None).download_url(
        "https://y.test/list"
    )
    assert [result.status for result in results] == ["success", "success"]


def test_download_rejects_path_outside_root(tmp_path):
    outside = tmp_path.parent / "escape.mp4"
    outside.write_bytes(b"media")
    info = {
        "id": "1",
        "title": "x",
        "extractor_key": "Youtube",
        "requested_downloads": [{"filepath": str(outside)}],
    }
    with pytest.raises(MaterialInputError, match="输出目录"):
        MaterialDownloader(tmp_path, factory_for(info, create_files=False), log=lambda _message: None).download_url(
            "https://y.test/1"
        )


def test_existing_complete_record_is_skipped_before_real_download(tmp_path):
    directory = tmp_path / "TikTok_trip_748"
    media = directory / "trip.mp4"
    metadata = directory / "TikTok_trip_748.txt"
    directory.mkdir()
    media.write_bytes(b"media")
    metadata.write_text(f"标题:trip\n内容:hello\n素材:{media.resolve()}\n", encoding="utf-8")
    info = {
        "id": "748",
        "title": "trip",
        "description": "hello",
        "extractor_key": "TikTok",
        "webpage_url": "https://t.test/748",
    }
    calls = []
    result = MaterialDownloader(
        tmp_path,
        factory_for(info, create_files=False, calls=calls),
        log=lambda _message: None,
    ).download_url("https://t.test/748")
    assert result[0].status == "skipped"
    assert calls == [False]


def test_batch_file_and_batch_failures_preserve_order(tmp_path):
    source = tmp_path / "links.txt"
    source.write_text(
        "\ufeff https://a.test/1 \n\nhttps://a.test/1\nftp://bad.test/2\nhttps://b.test/3\n",
        encoding="utf-8",
    )
    assert read_batch_urls(source) == ["https://a.test/1", "ftp://bad.test/2", "https://b.test/3"]

    downloader = MaterialDownloader(tmp_path, factory_for({}), log=lambda _message: None)
    seen = []

    def fake_download(url):
        seen.append(url)
        if url.startswith("ftp:"):
            raise MaterialInputError("素材地址只支持 HTTP/HTTPS URL")
        return [DownloadResult("success", url)]

    downloader.download_url = fake_download
    summary = downloader.download_batch(read_batch_urls(source))
    assert seen == ["https://a.test/1", "ftp://bad.test/2", "https://b.test/3"]
    assert (summary.succeeded, summary.failed) == (2, 1)


def test_search_uses_default_three_and_custom_count(tmp_path):
    seen = []
    downloader = MaterialDownloader(tmp_path, factory_for({}), log=lambda _message: None)
    downloader._download_source = lambda source, validate_url: seen.append((source, validate_url)) or [
        DownloadResult("success", source)
    ]
    downloader.search_youtube("旅行 风景")
    downloader.search_youtube("夜景", count=5)
    assert seen == [("ytsearch3:旅行 风景", False), ("ytsearch5:夜景", False)]


@pytest.mark.parametrize(("query", "count"), [("", 3), ("   ", 3), ("旅行", 0), ("旅行", -1)])
def test_search_rejects_empty_query_or_invalid_count(tmp_path, query, count):
    with pytest.raises(MaterialInputError):
        MaterialDownloader(tmp_path, factory_for({}), log=lambda _message: None).search_youtube(query, count)


def test_non_ascii_progress_log_cannot_abort_download(tmp_path):
    def gbk_only(message):
        message.encode("gbk")

    downloader = MaterialDownloader(tmp_path, factory_for({}), log=gbk_only)
    downloader._progress_hook({"status": "finished", "filename": "맛있는영상.mp4"})


def test_sanitize_component_removes_metadata_separator_commas():
    assert sanitize_component("A, B", "untitled", 80) == "A_ B"


def test_duplicate_lookup_uses_platform_and_id_when_title_changes(tmp_path):
    directory = tmp_path / "TikTok_old-title_748"
    media = directory / "old.mp4"
    directory.mkdir()
    media.write_bytes(b"media")
    (directory / "TikTok_old-title_748.txt").write_text(
        f"标题:old-title\n内容:\n素材:{media.resolve()}\n", encoding="utf-8"
    )
    info = {"id": "748", "title": "new-title", "extractor_key": "TikTok", "webpage_url": "https://t.test/748"}
    calls = []
    result = MaterialDownloader(tmp_path, factory_for(info, create_files=False, calls=calls), log=lambda _m: None).download_url("https://t.test/748")
    assert result[0].status == "skipped"
    assert calls == [False]


def test_corrupt_existing_metadata_is_rewritten_after_download(tmp_path):
    directory = tmp_path / "TikTok_trip_748"
    media = directory / "trip.mp4"
    directory.mkdir()
    (directory / "TikTok_trip_748.txt").write_text("broken", encoding="utf-8")
    info = {"id": "748", "title": "trip", "description": "fixed", "extractor_key": "TikTok", "webpage_url": "https://t.test/748", "test_paths": [media], "filepath": str(media)}
    result = MaterialDownloader(tmp_path, factory_for(info), log=lambda _m: None).download_url("https://t.test/748")
    assert result[0].status == "success"
    assert "内容:fixed" in result[0].record.metadata_path.read_text(encoding="utf-8")


def test_batch_failure_redacts_url_credentials_and_cookie(tmp_path):
    logs = []
    downloader = MaterialDownloader(tmp_path, factory_for({}), log=logs.append)
    downloader.download_url = lambda _url: (_ for _ in ()).throw(RuntimeError("Cookie: sessionid=demo-secret"))
    summary = downloader.download_batch(["https://user:demo-password@example.test/a?token=abc"])
    combined = " ".join(logs + [summary.results[0].source, summary.results[0].message])
    assert "demo-password" not in combined
    assert "demo-secret" not in combined
    assert "token=abc" not in combined


def test_instagram_carousel_creates_one_record_with_all_media(tmp_path):
    first = tmp_path / "raw" / "1.jpg"
    second = tmp_path / "raw" / "2.jpg"
    info = {"_type": "playlist", "id": "99", "title": "carousel", "description": "caption", "extractor_key": "Instagram", "webpage_url": "https://i.test/p/99", "entries": [
        {"id": "99-1", "test_paths": [first], "filepath": str(first)},
        {"id": "99-2", "test_paths": [second], "filepath": str(second)},
    ]}
    results = MaterialDownloader(tmp_path, factory_for(info), log=lambda _m: None).download_url("https://i.test/p/99")
    assert len(results) == 1
    assert len(results[0].record.media_paths) == 2
    assert results[0].record.title == "carousel"


def test_partial_playlist_downloads_only_missing_entry(tmp_path):
    existing_dir = tmp_path / "Youtube_one_1"
    existing_media = existing_dir / "one.mp4"
    existing_dir.mkdir()
    existing_media.write_bytes(b"media")
    (existing_dir / "Youtube_one_1.txt").write_text(f"标题:one\n内容:\n素材:{existing_media.resolve()}\n", encoding="utf-8")
    missing = tmp_path / "Youtube_two_2" / "two.mp4"
    playlist = {"_type": "playlist", "entries": [
        {"id": "1", "title": "one", "extractor_key": "Youtube", "webpage_url": "https://y.test/1"},
        {"id": "2", "title": "two", "extractor_key": "Youtube", "webpage_url": "https://y.test/2", "test_paths": [missing], "filepath": str(missing)},
    ]}
    calls = []
    downloader = MaterialDownloader(tmp_path, factory_for(playlist, calls=calls), log=lambda _m: None)
    downloader.download_url("https://y.test/list")
    assert calls.count(True) == 1


def test_yt_dlp_logger_redacts_sensitive_values(tmp_path):
    logs = []
    captured = []
    downloader = MaterialDownloader(tmp_path, factory_for({}, capture=captured), log=logs.append)
    downloader._options()
    captured_logger = downloader._options()["logger"]
    captured_logger.error("Cookie: sessionid=demo-secret https://user:password@example.test/a?token=abc")
    combined = " ".join(logs)
    assert "demo-secret" not in combined
    assert "password" not in combined
    assert "token=abc" not in combined


def test_output_root_with_comma_is_rejected(tmp_path):
    with pytest.raises(MaterialInputError, match="逗号"):
        MaterialDownloader(tmp_path / "a,b", factory_for({}), log=lambda _m: None)


def test_redact_text_removes_credentials_from_url_embedded_in_message():
    from instagram.material_downloader import redact_text

    value = "ERROR downloading https://user:password@example.test/video?api_key=secret&sig=hidden retrying"
    safe = redact_text(value)
    assert "password" not in safe
    assert "secret" not in safe
    assert "hidden" not in safe
    assert "https://[REDACTED]@example.test/video" in safe


def test_new_download_writes_txt_metadata(tmp_path):
    media = tmp_path / "TikTok_trip_748" / "trip.mp4"
    info = {"id": "748", "title": "trip", "extractor_key": "TikTok", "webpage_url": "https://t.test/748", "test_paths": [media], "filepath": str(media)}
    result = MaterialDownloader(tmp_path, factory_for(info), log=lambda _m: None).download_url("https://t.test/748")
    assert result[0].record.metadata_path.suffix == ".txt"


def test_existing_prefers_valid_txt_then_falls_back_to_legacy_text(tmp_path):
    directory = tmp_path / "TikTok_trip_748"
    media = directory / "trip.mp4"
    directory.mkdir()
    media.write_bytes(b"media")
    legacy = directory / "TikTok_trip_748.text"
    modern = directory / "TikTok_trip_748.txt"
    legacy.write_text(f"标题:legacy\n内容:\n素材:{media.resolve()}\n", encoding="utf-8")
    modern.write_text(f"标题:modern\n内容:\n素材:{media.resolve()}\n", encoding="utf-8")
    info = {"id": "748", "title": "trip", "extractor_key": "TikTok", "webpage_url": "https://t.test/748"}
    downloader = MaterialDownloader(tmp_path, factory_for(info, create_files=False), log=lambda _m: None)
    assert downloader.download_url("https://t.test/748")[0].record.metadata_path == modern
    modern.write_text("broken", encoding="utf-8")
    assert downloader.download_url("https://t.test/748")[0].record.metadata_path == legacy
