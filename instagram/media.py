"""Prepare local and remote media for Instagram Feed posting."""

from __future__ import annotations

import mimetypes
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen


class MediaInputError(ValueError):
    """Raised when a media source cannot safely be prepared."""


ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".avif", ".heic", ".heif", ".mp4", ".mov"}
ALLOWED_MIME_TYPES = {
    "image/jpeg", "image/png", "image/avif", "image/heic", "image/heif",
    "video/mp4", "video/quicktime",
}


@dataclass(frozen=True)
class PreparedMedia:
    source: str
    path: Path
    mime_type: str
    downloaded: bool


@dataclass
class PreparedMediaBatch:
    items: list[PreparedMedia]
    temporary_directory: tempfile.TemporaryDirectory | None = None

    def __enter__(self) -> "PreparedMediaBatch":
        return self

    def __exit__(self, *_args) -> None:
        if self.temporary_directory is not None:
            self.temporary_directory.cleanup()


def compose_caption(title: str | None, content: str | None) -> str:
    parts = [str(value).strip() for value in (title, content) if value and str(value).strip()]
    return "\n\n".join(parts)


def classify_source(source: str) -> str:
    value = str(source).strip()
    parsed = urlparse(value)
    if parsed.scheme.lower() in {"http", "https"}:
        return "remote"
    path = Path(value)
    if path.is_file():
        return "local"
    if parsed.scheme:
        raise MediaInputError("素材地址只支持本地路径或 HTTP/HTTPS URL")
    raise MediaInputError(f"本地素材不存在或不是文件: {value}")


def _sniff_mime(path: Path) -> str | None:
    with path.open("rb") as handle:
        head = handle.read(32)
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(head) >= 12 and head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in {b"avif", b"avis"}:
            return "image/avif"
        if brand in {b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"}:
            return "image/heic"
        if brand == b"qt  ":
            return "video/quicktime"
        return "video/mp4"
    return None


def _validate_file(path: Path, declared_mime: str | None = None) -> str:
    extension = path.suffix.lower()
    sniffed = _sniff_mime(path)
    guessed = (declared_mime or "").split(";", 1)[0].strip().lower() or mimetypes.guess_type(path.name)[0]
    if extension not in ALLOWED_EXTENSIONS or sniffed not in ALLOWED_MIME_TYPES:
        raise MediaInputError(f"素材类型不受支持或文件签名无效: {path.name}")
    if guessed and guessed not in ALLOWED_MIME_TYPES:
        raise MediaInputError(f"素材 MIME 类型不受支持: {guessed}")
    if guessed and guessed.split("/", 1)[0] != sniffed.split("/", 1)[0]:
        raise MediaInputError(f"素材声明类型与文件内容类型不一致: {path.name}")
    return sniffed


class MediaPreparer:
    def __init__(self, session=None, timeout=(10, 60), max_bytes=200 * 1024 * 1024, max_items=20):
        self.session = session or _UrlSession()
        self.timeout = timeout
        self.max_bytes = max_bytes
        self.max_items = max_items

    def prepare(self, sources: Sequence[str]) -> PreparedMediaBatch:
        if not sources:
            raise MediaInputError("至少需要一个素材")
        if len(sources) > self.max_items:
            raise MediaInputError(f"素材数量超过限制: 最多 {self.max_items} 个")
        temporary_directory = tempfile.TemporaryDirectory(prefix="instagram-post-")
        items: list[PreparedMedia] = []
        try:
            for index, source in enumerate(sources, start=1):
                kind = classify_source(source)
                if kind == "local":
                    path = Path(source).resolve()
                    if path.stat().st_size > self.max_bytes:
                        raise MediaInputError("本地素材大小超过限制")
                    mime = _validate_file(path)
                    items.append(PreparedMedia(source, path, mime, False))
                    continue
                items.append(self._download(index, source, Path(temporary_directory.name)))
            return PreparedMediaBatch(items, temporary_directory)
        except Exception:
            temporary_directory.cleanup()
            raise

    def _download(self, index: int, source: str, directory: Path) -> PreparedMedia:
        response = self.session.get(source, stream=True, timeout=self.timeout, allow_redirects=True)
        try:
            response.raise_for_status()
            if urlparse(response.url).scheme.lower() not in {"http", "https"}:
                raise MediaInputError("重定向后的素材地址必须仍为 HTTP/HTTPS")
            declared_length = response.headers.get("Content-Length")
            if declared_length and int(declared_length) > self.max_bytes:
                raise MediaInputError("远程素材大小超过限制")
            name = Path(unquote(urlparse(response.url).path)).name or "media"
            suffix = Path(name).suffix.lower()
            if suffix not in ALLOWED_EXTENSIONS:
                content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
                suffix = mimetypes.guess_extension(content_type) or ""
            target = directory / f"{index:03d}-{Path(name).stem or 'media'}{suffix}"
            written = 0
            with target.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=64 * 1024):
                    if not chunk:
                        continue
                    written += len(chunk)
                    if written > self.max_bytes:
                        raise MediaInputError("远程素材大小超过限制")
                    handle.write(chunk)
            mime = _validate_file(target, response.headers.get("Content-Type"))
            return PreparedMedia(source, target, mime, True)
        finally:
            response.close()


class _UrlResponse:
    def __init__(self, response):
        self._response = response
        self.url = response.geturl()
        self.headers = response.headers

    def raise_for_status(self):
        return None

    def iter_content(self, chunk_size=64 * 1024):
        while True:
            chunk = self._response.read(chunk_size)
            if not chunk:
                return
            yield chunk

    def close(self):
        self._response.close()


class _UrlSession:
    def get(self, url, *, timeout, **_kwargs):
        request = Request(url, headers={"User-Agent": "AutoMessage/1.0"})
        return _UrlResponse(urlopen(request, timeout=max(timeout)))
