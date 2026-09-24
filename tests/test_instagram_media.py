from pathlib import Path

import pytest

from instagram.media import MediaInputError, MediaPreparer, classify_source, compose_caption


PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 24


class FakeResponse:
    def __init__(self, *, url="https://example.test/photo.png", content=PNG, content_type="image/png"):
        self.url = url
        self.content = content
        self.headers = {"Content-Type": content_type, "Content-Length": str(len(content))}

    def raise_for_status(self):
        return None

    def iter_content(self, chunk_size=65536):
        yield self.content

    def close(self):
        return None


class FakeSession:
    def __init__(self, response=None):
        self.response = response or FakeResponse()

    def get(self, url, **kwargs):
        return self.response


def test_compose_caption_preserves_unicode_and_spacing():
    assert compose_caption("산 여행 ⛰️", "저는 산과 강도 좋아합니다.") == "산 여행 ⛰️\n\n저는 산과 강도 좋아합니다."
    assert compose_caption("", "내용") == "내용"
    assert compose_caption("제목", None) == "제목"
    assert compose_caption(None, None) == ""


def test_classifies_only_local_http_and_https(tmp_path):
    local = tmp_path / "photo.png"
    local.write_bytes(PNG)
    assert classify_source(str(local)) == "local"
    assert classify_source("https://example.test/a.jpg") == "remote"
    with pytest.raises(MediaInputError):
        classify_source("file:///etc/passwd")


def test_prepare_preserves_order_and_unique_names_for_collisions(tmp_path):
    local = tmp_path / "photo.png"
    local.write_bytes(PNG)
    with MediaPreparer(session=FakeSession()).prepare([str(local), "https://example.test/photo.png"]) as batch:
        assert [item.source for item in batch.items] == [str(local), "https://example.test/photo.png"]
        assert batch.items[0].path.name != batch.items[1].path.name


def test_rejects_redirect_ending_in_non_http_scheme():
    session = FakeSession(FakeResponse(url="file:///tmp/photo.png"))
    with pytest.raises(MediaInputError, match="HTTP/HTTPS"):
        MediaPreparer(session=session).prepare(["https://example.test/photo.png"])


def test_rejects_response_larger_than_configured_limit():
    with pytest.raises(MediaInputError, match="大小"):
        MediaPreparer(session=FakeSession(), max_bytes=10).prepare(["https://example.test/photo.png"])


def test_temporary_downloads_are_removed_after_context_exit():
    with MediaPreparer(session=FakeSession()).prepare(["https://example.test/photo.png"]) as batch:
        downloaded = batch.items[0].path
        assert downloaded.exists()
    assert not downloaded.exists()


def test_rejects_mime_and_file_signature_mismatch():
    response = FakeResponse(content=b"not-a-png", content_type="image/png")
    with pytest.raises(MediaInputError, match="类型"):
        MediaPreparer(session=FakeSession(response)).prepare(["https://example.test/photo.png"])


def test_rejects_local_file_larger_than_limit(tmp_path):
    local = tmp_path / "large.png"
    local.write_bytes(PNG)
    with pytest.raises(MediaInputError, match="大小"):
        MediaPreparer(max_bytes=10).prepare([str(local)])


def test_rejects_more_than_configured_media_count():
    with pytest.raises(MediaInputError, match="数量"):
        MediaPreparer(max_items=2).prepare(["a.png", "b.png", "c.png"])
