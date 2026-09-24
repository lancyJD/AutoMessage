"""Persist public media with yt-dlp and write simple posting metadata."""

from __future__ import annotations

import hashlib
import os
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import urlparse
from urllib.parse import urlsplit, urlunsplit

DEFAULT_OUTPUT_DIR = Path(r"C:\Users\DELL\Pictures\sucai")
_INVALID_WINDOWS_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVED_WINDOWS_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


class MaterialInputError(ValueError):
    """Raised for unsafe or unsupported material input."""


@dataclass(frozen=True)
class MaterialRecord:
    title: str
    content: str
    platform: str
    material_id: str
    source_url: str
    directory: Path
    media_paths: tuple[Path, ...]
    metadata_path: Path


@dataclass(frozen=True)
class DownloadResult:
    status: str
    source: str
    record: MaterialRecord | None = None
    message: str = ""


@dataclass
class BatchSummary:
    results: list[DownloadResult] = field(default_factory=list)

    @property
    def succeeded(self) -> int:
        return sum(result.status == "success" for result in self.results)

    @property
    def skipped(self) -> int:
        return sum(result.status == "skipped" for result in self.results)

    @property
    def failed(self) -> int:
        return sum(result.status == "failed" for result in self.results)


def validate_http_url(value: str) -> str:
    normalized = str(value).strip()
    parsed = urlparse(normalized)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        raise MaterialInputError("素材地址只支持 HTTP/HTTPS URL")
    return normalized


def sanitize_component(value: object, fallback: str, max_length: int) -> str:
    text = _INVALID_WINDOWS_CHARS.sub("_", str(value or "").replace(",", "_").strip()).rstrip(" .")
    text = text[:max_length].rstrip(" .") or fallback
    if text.upper() in _RESERVED_WINDOWS_NAMES:
        text = f"_{text}"
    return text


def build_item_key(info: dict, source_url: str) -> str:
    platform = sanitize_component(info.get("extractor_key") or info.get("extractor"), "unknown", 32)
    title = sanitize_component(info.get("title"), "untitled", 80)
    fallback_id = hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:16]
    material_id = sanitize_component(info.get("id"), fallback_id, 64)
    return f"{platform}_{title}_{material_id}"


def read_batch_urls(path: Path) -> list[str]:
    values = Path(path).read_text(encoding="utf-8-sig").splitlines()
    return list(dict.fromkeys(value.strip() for value in values if value.strip()))


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _flatten_entries(info: dict) -> list[dict]:
    entries = info.get("entries")
    if entries is None:
        return [info]
    return [entry for entry in entries if isinstance(entry, dict)]


def _one_line(value: object) -> str:
    return " ".join(str(value or "").splitlines()).strip()


def redact_text(value: object) -> str:
    text = str(value)
    text = re.sub(r"(?i)(sessionid|cookie|authorization|token)(\s*[:=]\s*)[^\s;&]+", r"\1\2[REDACTED]", text)
    text = re.sub(r"(https?://)([^/@\s]+)@", r"\1[REDACTED]@", text)
    try:
        parsed = urlsplit(text)
        if parsed.scheme in {"http", "https"} and parsed.query:
            text = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", parsed.fragment))
    except ValueError:
        pass
    return text


def write_metadata(record: MaterialRecord) -> Path:
    record.directory.mkdir(parents=True, exist_ok=True)
    content = (
        f"标题:{_one_line(record.title)}\n"
        f"内容:{_one_line(record.content)}\n"
        f"素材:{','.join(str(path) for path in record.media_paths)}\n"
    )
    temporary = record.metadata_path.with_suffix(record.metadata_path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8", newline="\n")
    os.replace(temporary, record.metadata_path)
    return record.metadata_path


class _YdlLogger:
    def __init__(self, emit: Callable[[str], None]):
        self.emit = emit

    def debug(self, message: str) -> None:
        self.emit(message)

    info = debug

    def warning(self, message: str) -> None:
        self.emit(f"[warning] {message}")

    def error(self, message: str) -> None:
        self.emit(f"[error] {message}")


class MaterialDownloader:
    def __init__(self, output_dir=DEFAULT_OUTPUT_DIR, ydl_factory=None, log: Callable[[str], None] = print):
        self.output_dir = Path(output_dir).resolve()
        if "," in str(self.output_dir):
            raise MaterialInputError("输出目录不能包含英文逗号")
        self.log = log
        if ydl_factory is None:
            try:
                from yt_dlp import YoutubeDL
            except ImportError as exc:
                raise ImportError("缺少 yt-dlp，请先执行: python -m pip install yt-dlp") from exc
            ydl_factory = YoutubeDL
        self.ydl_factory = ydl_factory

    def _options(self) -> dict:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        return {
            "ignoreconfig": True,
            "continuedl": True,
            "retries": 3,
            "noplaylist": False,
            "windowsfilenames": True,
            "logger": _YdlLogger(self._emit),
            "outtmpl": str(self.output_dir / "%(extractor_key)s_%(title).80B_%(id)s" / "%(title).80B_%(id)s.%(ext)s"),
            "progress_hooks": [self._progress_hook],
        }

    def _progress_hook(self, event: dict) -> None:
        status = event.get("status")
        if status == "finished":
            self._emit(f"[downloaded] {event.get('filename', '')}")
        elif status == "downloading" and event.get("_percent_str"):
            self._emit(f"[downloading] {event['_percent_str'].strip()}")

    def _emit(self, message: str) -> None:
        try:
            self.log(redact_text(message))
        except UnicodeEncodeError:
            # A Windows console may use GBK while titles contain Korean or emoji.
            return

    def download_url(self, url: str) -> list[DownloadResult]:
        return self._download_source(validate_http_url(url), validate_url=False)

    def _download_source(self, source: str, validate_url: bool) -> list[DownloadResult]:
        if validate_url:
            source = validate_http_url(source)
        with self.ydl_factory(self._options()) as ydl:
            preview = ydl.extract_info(source, download=False)
            if not isinstance(preview, dict):
                raise MaterialInputError("下载器没有返回有效的素材信息")
            preview_entries = _flatten_entries(preview)
            if self._is_instagram_carousel(preview):
                existing_parent = self._existing_result(preview, preview.get("webpage_url") or source)
                if existing_parent is not None:
                    return [existing_parent]
                info = ydl.extract_info(source, download=True)
                return [self._record_group(info, source)]
            existing = [
                self._existing_result(entry, entry.get("webpage_url") or source)
                for entry in preview_entries
            ]
            if len(preview_entries) > 1:
                results: list[DownloadResult] = []
                for entry, completed in zip(preview_entries, existing):
                    if completed is not None:
                        results.append(completed)
                        continue
                    entry_source = entry.get("webpage_url") or entry.get("url")
                    if not entry_source:
                        results.append(DownloadResult("failed", redact_text(source), message="列表条目缺少链接"))
                        continue
                    downloaded = ydl.extract_info(entry_source, download=True)
                    results.append(self._record_entry(downloaded, entry_source))
                return results
            if existing and existing[0] is not None:
                return [existing[0]]
            info = ydl.extract_info(source, download=True)
            if not isinstance(info, dict):
                raise MaterialInputError("下载器没有返回有效的素材信息")
            return [self._record_entry(info, info.get("webpage_url") or source)]

    @staticmethod
    def _is_instagram_carousel(info: dict) -> bool:
        platform = str(info.get("extractor_key") or info.get("extractor") or "").lower()
        return info.get("_type") == "playlist" and "instagram" in platform and bool(info.get("id"))

    def _existing_result(self, info: dict, source_url: str) -> DownloadResult | None:
        key = build_item_key(info, source_url)
        platform = sanitize_component(info.get("extractor_key") or info.get("extractor"), "unknown", 32)
        fallback_id = hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:16]
        material_id = sanitize_component(info.get("id"), fallback_id, 64)
        candidates = [self.output_dir / key]
        candidates.extend(
            path for path in self.output_dir.iterdir()
            if path.is_dir() and path.name.startswith(f"{platform}_") and path.name.endswith(f"_{material_id}")
        ) if self.output_dir.is_dir() else None
        for directory in dict.fromkeys(path.resolve() for path in candidates):
            metadata_files = list(directory.glob("*.text")) if directory.is_dir() else []
            if len(metadata_files) != 1:
                continue
            record = self._read_complete_record(info, source_url, directory, metadata_files[0])
            if record is not None:
                self._emit(f"[skipped] {directory.name} 已存在")
                return DownloadResult("skipped", redact_text(source_url), record, "已存在")
        return None

    def _read_complete_record(self, info: dict, source_url: str, directory: Path, metadata_path: Path) -> MaterialRecord | None:
        if not _is_within(directory, self.output_dir) or not metadata_path.is_file():
            return None
        try:
            lines = metadata_path.read_text(encoding="utf-8").splitlines()
            if len(lines) != 3 or not lines[0].startswith("标题:") or not lines[1].startswith("内容:") or not lines[2].startswith("素材:"):
                return None
            media_line = lines[2]
            media_paths = tuple(Path(value).resolve() for value in media_line[3:].split(",") if value)
        except (OSError, StopIteration, UnicodeError):
            return None
        if not media_paths or any(not _is_within(path, self.output_dir) or not path.is_file() for path in media_paths):
            return None
        return MaterialRecord(
            title=lines[0][3:],
            content=lines[1][3:],
            platform=sanitize_component(info.get("extractor_key") or info.get("extractor"), "unknown", 32),
            material_id=sanitize_component(info.get("id"), hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:16], 64),
            source_url=source_url,
            directory=directory,
            media_paths=media_paths,
            metadata_path=metadata_path,
        )

    def _record_group(self, info: dict, source_url: str) -> DownloadResult:
        entries = _flatten_entries(info)
        combined = dict(info)
        combined.pop("entries", None)
        combined["requested_downloads"] = [
            {"filepath": str(path)} for entry in entries for path in self._collect_paths(entry)
        ]
        return self._record_entry(combined, info.get("webpage_url") or source_url)

    def _record_entry(self, info: dict, source_url: str) -> DownloadResult:
        key = build_item_key(info, source_url)
        directory = (self.output_dir / key).resolve()
        if not _is_within(directory, self.output_dir):
            raise MaterialInputError("生成的任务目录超出输出目录")
        paths = self._collect_paths(info)
        if not paths:
            raise MaterialInputError("下载完成但没有找到本地素材文件")
        if any(not _is_within(path, self.output_dir) for path in paths):
            raise MaterialInputError("素材路径超出输出目录")

        directory.mkdir(parents=True, exist_ok=True)
        normalized_paths: list[Path] = []
        for path in paths:
            if path.parent.resolve() == directory:
                normalized_paths.append(path.resolve())
                continue
            target = directory / path.name
            if target.exists() and target.resolve() != path.resolve():
                target = directory / f"{path.stem}_{len(normalized_paths) + 1}{path.suffix}"
            shutil.move(str(path), str(target))
            normalized_paths.append(target.resolve())

        platform = sanitize_component(info.get("extractor_key") or info.get("extractor"), "unknown", 32)
        fallback_id = hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:16]
        material_id = sanitize_component(info.get("id"), fallback_id, 64)
        record = MaterialRecord(
            title=_one_line(info.get("title")),
            content=_one_line(info.get("description")),
            platform=platform,
            material_id=material_id,
            source_url=source_url,
            directory=directory,
            media_paths=tuple(dict.fromkeys(normalized_paths)),
            metadata_path=directory / f"{key}.text",
        )
        write_metadata(record)
        self._emit(f"[success] {record.metadata_path}")
        return DownloadResult("success", redact_text(source_url), record)

    def _collect_paths(self, info: dict) -> list[Path]:
        values: list[str] = []
        for collection_name in ("requested_downloads", "requested_formats"):
            for item in info.get(collection_name) or []:
                if isinstance(item, dict) and item.get("filepath"):
                    values.append(item["filepath"])
        for name in ("filepath", "_filename"):
            if info.get(name):
                values.append(info[name])
        return [path for path in (Path(value).resolve() for value in dict.fromkeys(values)) if path.is_file()]

    @staticmethod
    def _is_complete(record: MaterialRecord) -> bool:
        return record.metadata_path.is_file() and all(path.is_file() for path in record.media_paths)

    def download_batch(self, urls: Iterable[str]) -> BatchSummary:
        summary = BatchSummary()
        for source in dict.fromkeys(str(value).strip() for value in urls if str(value).strip()):
            try:
                summary.results.extend(self.download_url(source))
            except Exception as exc:
                safe_source = redact_text(source)
                safe_message = redact_text(exc)
                self._emit(f"[failed] {safe_source} {safe_message}")
                summary.results.append(DownloadResult("failed", safe_source, message=safe_message))
        return summary

    def search_youtube(self, query: str, count: int = 3) -> BatchSummary:
        normalized = str(query).strip()
        if not normalized:
            raise MaterialInputError("搜索关键词不能为空")
        if not isinstance(count, int) or isinstance(count, bool) or count <= 0:
            raise MaterialInputError("搜索数量必须是大于0的整数")
        source = f"ytsearch{count}:{normalized}"
        try:
            return BatchSummary(self._download_source(source, validate_url=False))
        except Exception as exc:
            return BatchSummary([DownloadResult("failed", source, message=str(exc))])
