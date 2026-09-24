# 自动素材下载模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用 `yt-dlp` Python API实现单链接、批量链接和 YouTube 关键词搜索下载，并为每条内容生成可供后续流程读取的 `.text` 元数据文件。

**Architecture:** `instagram.material_downloader` 负责输入校验、路径安全、`YoutubeDL` 适配、结果归一化和元数据原子落盘；`scripts.download_material` 只负责解析命令行、输出日志与退出码。通过可注入的 `ydl_factory` 隔离网络依赖，使单元测试不访问真实平台。

**Tech Stack:** Python 3.10+、`yt-dlp` Python API、`pathlib`、`dataclasses`、`argparse`、pytest

**Spec:** `docs/superpowers/specs/2026-09-24-material-downloader-design.md`

## Global Constraints

- 默认输出目录必须是 `C:\Users\DELL\Pictures\sucai`。
- YouTube 支持单链接、批量链接和关键词搜索；TikTok、Instagram 仅支持单链接和批量链接。
- 关键词搜索必须使用 `ytsearch{count}:关键词`，默认数量必须是 `3`。
- 每条内容必须使用独立的 `平台_标题_素材ID` 目录，并生成同名 `.text` 文件。
- `.text` 必须使用 UTF-8，严格包含 `标题:`、`内容:`、`素材:` 三行；多个素材路径使用英文逗号分隔。
- 只允许 HTTP/HTTPS 输入；所有生成和发现的输出路径必须位于配置的输出根目录内。
- 不读取用户全局 yt-dlp 配置，不记录 Cookie、Authorization 或其他认证数据。
- 单元测试不得访问真实网络；真实平台验证单独手动执行。

## Review Focus

- 上游标题含 Windows 保留名、非法字符、尾随点或极长 Unicode 时，仍必须生成可创建且不逃逸根目录的路径；Task 1 覆盖。
- yt-dlp 返回播放列表、requested_downloads 或 requested_formats 等不同形状时，必须只收集真实存在的媒体文件；Task 2 覆盖。
- 下载成功回调包含根目录外路径时必须拒绝，不可写入元数据；Task 2 覆盖。
- 批量文件含 BOM、空行、首尾空格、重复链接和非法协议时，合法项应保持顺序处理且失败项不阻断后续项；Task 3 覆盖。
- CLI 遇到部分失败、空搜索词、无效 count 或依赖缺失时，必须返回稳定的非零退出码并保留批量汇总；Task 4 覆盖。

---

### Task 1: 领域模型、输入校验和安全命名

**Files:**
- Create: `instagram/material_downloader.py`
- Create: `tests/test_material_downloader.py`
- Modify: `requirements.txt`

**Interfaces:**
- Consumes: Python 标准库 `dataclasses.Path`、`hashlib.sha256`、`urllib.parse.urlparse`
- Produces: `DEFAULT_OUTPUT_DIR: Path`、`MaterialInputError`、`MaterialRecord`、`DownloadResult`、`sanitize_component(value, fallback, max_length) -> str`、`validate_http_url(value) -> str`、`build_item_key(info, source_url) -> str`

- [ ] **Step 1: 写入安全命名、URL校验和领域模型的失败测试**

```python
from pathlib import Path

import pytest

from instagram.material_downloader import (
    DEFAULT_OUTPUT_DIR,
    MaterialInputError,
    build_item_key,
    sanitize_component,
    validate_http_url,
)


def test_default_output_directory_is_fixed_windows_path():
    assert DEFAULT_OUTPUT_DIR == Path(r"C:\Users\DELL\Pictures\sucai")


@pytest.mark.parametrize("value", ["file:///etc/passwd", "ftp://example.test/a", "javascript:alert(1)", "not-a-url"])
def test_validate_http_url_rejects_non_http_inputs(value):
    with pytest.raises(MaterialInputError, match="HTTP/HTTPS"):
        validate_http_url(value)


def test_sanitize_component_handles_windows_names_and_long_unicode():
    assert sanitize_component('a<b>:c"d/e\\f|g?h*.', "untitled", 80) == "a_b__c_d_e_f_g_h_"
    assert sanitize_component("CON", "untitled", 80) == "_CON"
    assert sanitize_component("旅行" * 100, "untitled", 20) == "旅行" * 10
    assert sanitize_component("   ... ", "untitled", 80) == "untitled"


def test_build_item_key_uses_platform_title_and_stable_fallback_id():
    assert build_item_key({"extractor_key": "TikTok", "title": "旅行/风景", "id": "748"}, "https://t.test/748") == "TikTok_旅行_风景_748"
    first = build_item_key({"extractor_key": "", "title": "", "id": ""}, "https://example.test/a")
    second = build_item_key({"extractor_key": "", "title": "", "id": ""}, "https://example.test/a")
    assert first == second
    assert first.startswith("unknown_untitled_")
```

- [ ] **Step 2: 运行测试，确认因模块不存在而失败**

Run: `python -m pytest tests/test_material_downloader.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'instagram.material_downloader'`.

- [ ] **Step 3: 实现模型、校验和命名函数，并添加依赖**

在 `requirements.txt` 追加：

```text
yt-dlp
```

在 `instagram/material_downloader.py` 建立以下骨架并实现命名清理：

```python
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_OUTPUT_DIR = Path(r"C:\Users\DELL\Pictures\sucai")
_INVALID_WINDOWS_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVED_WINDOWS_NAMES = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}


class MaterialInputError(ValueError):
    pass


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
    text = _INVALID_WINDOWS_CHARS.sub("_", str(value or "").strip()).rstrip(" .")
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
```

- [ ] **Step 4: 运行 Task 1 测试并确认通过**

Run: `python -m pytest tests/test_material_downloader.py -v`

Expected: all Task 1 tests PASS.

- [ ] **Step 5: 提交 Task 1**

```bash
git add requirements.txt instagram/material_downloader.py tests/test_material_downloader.py
git commit -m "feat: add material downloader domain model"
```

### Task 2: yt-dlp 单链接下载、路径收集和元数据原子写入

**Files:**
- Modify: `instagram/material_downloader.py`
- Modify: `tests/test_material_downloader.py`

**Interfaces:**
- Consumes: Task 1 的 `MaterialRecord`、`DownloadResult`、`build_item_key`、`validate_http_url`
- Produces: `MaterialDownloader(output_dir=DEFAULT_OUTPUT_DIR, ydl_factory=None, log=print)`、`MaterialDownloader.download_url(url) -> list[DownloadResult]`、`write_metadata(record) -> Path`

- [ ] **Step 1: 写入单链接、播放列表、多路径形状、越界路径、重复和失败的测试替身**

```python
class FakeYoutubeDL:
    def __init__(self, options, info, create_files=True):
        self.options = options
        self.info = info
        self.create_files = create_files

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def extract_info(self, source, download=True):
        if self.create_files:
            entries = self.info.get("entries") or [self.info]
            for entry in entries:
                for path in entry.get("test_paths", []):
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(b"media")
        return self.info


def factory_for(info, create_files=True, capture=None):
    def factory(options):
        if capture is not None:
            capture.append(options)
        return FakeYoutubeDL(options, info, create_files)
    return factory


def test_download_url_writes_three_line_metadata_atomically(tmp_path):
    media = tmp_path / "TikTok_trip_748" / "trip.mp4"
    info = {
        "id": "748", "title": "trip", "description": "hello", "extractor_key": "TikTok",
        "webpage_url": "https://t.test/748", "test_paths": [media], "requested_downloads": [{"filepath": str(media)}],
    }
    captured = []
    result = MaterialDownloader(tmp_path, factory_for(info, capture=captured), log=lambda _message: None).download_url("https://t.test/748")
    record = result[0].record
    assert result[0].status == "success"
    assert record.media_paths == (media.resolve(),)
    assert record.metadata_path.read_text(encoding="utf-8") == f"标题:trip\n内容:hello\n素材:{media.resolve()}\n"
    assert captured[0]["ignoreconfig"] is True
    assert not list(tmp_path.rglob("*.tmp"))


def test_download_url_normalizes_playlist_and_requested_formats(tmp_path):
    first = tmp_path / "one" / "one.mp4"
    second = tmp_path / "two" / "two.webm"
    info = {"entries": [
        {"id": "1", "title": "one", "extractor_key": "Youtube", "webpage_url": "https://y.test/1", "test_paths": [first], "requested_formats": [{"filepath": str(first)}]},
        {"id": "2", "title": "two", "extractor_key": "Youtube", "webpage_url": "https://y.test/2", "test_paths": [second], "filepath": str(second)},
    ]}
    results = MaterialDownloader(tmp_path, factory_for(info), log=lambda _message: None).download_url("https://y.test/list")
    assert [result.status for result in results] == ["success", "success"]


def test_download_url_rejects_discovered_path_outside_root(tmp_path):
    outside = tmp_path.parent / "escape.mp4"
    info = {"id": "1", "title": "x", "extractor_key": "Youtube", "requested_downloads": [{"filepath": str(outside)}]}
    with pytest.raises(MaterialInputError, match="输出目录"):
        MaterialDownloader(tmp_path, factory_for(info, create_files=False), log=lambda _message: None).download_url("https://y.test/1")


def test_download_url_skips_complete_existing_record(tmp_path):
    directory = tmp_path / "Youtube_same_1"
    media = directory / "same.mp4"
    metadata = directory / "Youtube_same_1.text"
    directory.mkdir()
    media.write_bytes(b"media")
    metadata.write_text(f"标题:same\n内容:\n素材:{media.resolve()}\n", encoding="utf-8")
    info = {"id": "1", "title": "same", "extractor_key": "Youtube", "webpage_url": "https://y.test/1", "requested_downloads": [{"filepath": str(media)}]}
    result = MaterialDownloader(tmp_path, factory_for(info, create_files=False), log=lambda _message: None).download_url("https://y.test/1")
    assert result[0].status == "skipped"
```

- [ ] **Step 2: 运行新增测试，确认因 `MaterialDownloader` 不存在而失败**

Run: `python -m pytest tests/test_material_downloader.py -v`

Expected: FAIL with import or name error for `MaterialDownloader`.

- [ ] **Step 3: 实现 `MaterialDownloader` 和路径归一化**

实现以下关键结构；`_collect_paths` 必须依次读取 `requested_downloads[*].filepath`、`requested_formats[*].filepath`、`filepath`、`_filename`，去重后只保留存在的文件：

```python
import os
from collections.abc import Callable


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


class MaterialDownloader:
    def __init__(self, output_dir=DEFAULT_OUTPUT_DIR, ydl_factory=None, log=print):
        self.output_dir = Path(output_dir).resolve()
        self.log = log
        if ydl_factory is None:
            from yt_dlp import YoutubeDL
            ydl_factory = YoutubeDL
        self.ydl_factory = ydl_factory

    def _options(self) -> dict:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        return {
            "ignoreconfig": True,
            "continuedl": True,
            "retries": 3,
            "noplaylist": False,
            "outtmpl": str(self.output_dir / "%(extractor_key,extractor)s_%(title).80B_%(id)s" / "%(title).80B_%(id)s.%(ext)s"),
            "progress_hooks": [self._progress_hook],
        }

    def download_url(self, url: str) -> list[DownloadResult]:
        source = validate_http_url(url)
        with self.ydl_factory(self._options()) as ydl:
            info = ydl.extract_info(source, download=True)
        return [self._record_entry(entry, entry.get("webpage_url") or source) for entry in _flatten_entries(info)]
```

`_record_entry` 必须通过 `build_item_key` 确定最终目录，校验收集路径均在 `output_dir` 内，把标题、描述和文件路径构造成不可变 `MaterialRecord`。如果同名 `.text` 已存在且其中列出的素材均存在，返回 `status="skipped"`；否则执行原子写入并返回 `status="success"`。

- [ ] **Step 4: 实现严格三行的原子元数据写入**

```python
def write_metadata(record: MaterialRecord) -> Path:
    record.directory.mkdir(parents=True, exist_ok=True)
    content = (
        f"标题:{record.title}\n"
        f"内容:{record.content}\n"
        f"素材:{','.join(str(path) for path in record.media_paths)}\n"
    )
    temporary = record.metadata_path.with_suffix(record.metadata_path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8", newline="\n")
    os.replace(temporary, record.metadata_path)
    return record.metadata_path
```

- [ ] **Step 5: 运行 Task 2 测试并确认通过**

Run: `python -m pytest tests/test_material_downloader.py -v`

Expected: all Task 1 and Task 2 tests PASS.

- [ ] **Step 6: 提交 Task 2**

```bash
git add instagram/material_downloader.py tests/test_material_downloader.py
git commit -m "feat: download and record material with yt-dlp"
```

### Task 3: 批量输入、顺序去重、独立失败和 YouTube 搜索

**Files:**
- Modify: `instagram/material_downloader.py`
- Modify: `tests/test_material_downloader.py`

**Interfaces:**
- Consumes: Task 2 的 `MaterialDownloader.download_url`
- Produces: `read_batch_urls(path) -> list[str]`、`MaterialDownloader.download_batch(urls) -> BatchSummary`、`MaterialDownloader.search_youtube(query, count=3) -> BatchSummary`

- [ ] **Step 1: 写入 BOM批量文件、独立失败、默认搜索数和无效搜索参数测试**

```python
def test_read_batch_urls_handles_bom_whitespace_duplicates_and_invalid_lines(tmp_path):
    source = tmp_path / "links.txt"
    source.write_text("\ufeff https://a.test/1 \n\nhttps://a.test/1\nftp://bad.test/2\nhttps://b.test/3\n", encoding="utf-8")
    assert read_batch_urls(source) == ["https://a.test/1", "ftp://bad.test/2", "https://b.test/3"]


def test_download_batch_keeps_processing_after_invalid_url(tmp_path):
    downloader = MaterialDownloader(tmp_path, factory_for({}), log=lambda _message: None)
    seen = []
    def fake_download(url):
        seen.append(url)
        if url.startswith("ftp:"):
            raise MaterialInputError("素材地址只支持 HTTP/HTTPS URL")
        return [DownloadResult("success", url)]
    downloader.download_url = fake_download
    summary = downloader.download_batch(["https://a.test/1", "ftp://bad.test/2", "https://b.test/3"])
    assert seen == ["https://a.test/1", "ftp://bad.test/2", "https://b.test/3"]
    assert (summary.succeeded, summary.failed) == (2, 1)


def test_search_youtube_uses_default_three_and_custom_count(tmp_path):
    seen = []
    downloader = MaterialDownloader(tmp_path, factory_for({}), log=lambda _message: None)
    downloader._download_source = lambda source, validate_url: seen.append((source, validate_url)) or [DownloadResult("success", source)]
    downloader.search_youtube("旅行 风景")
    downloader.search_youtube("夜景", count=5)
    assert seen == [("ytsearch3:旅行 风景", False), ("ytsearch5:夜景", False)]


@pytest.mark.parametrize(("query", "count"), [("", 3), ("   ", 3), ("旅行", 0), ("旅行", -1)])
def test_search_youtube_rejects_empty_query_or_invalid_count(tmp_path, query, count):
    with pytest.raises(MaterialInputError):
        MaterialDownloader(tmp_path, factory_for({}), log=lambda _message: None).search_youtube(query, count)
```

- [ ] **Step 2: 运行新增测试，确认批量和搜索接口尚未实现**

Run: `python -m pytest tests/test_material_downloader.py -v`

Expected: FAIL for missing `read_batch_urls`, `download_batch`, and `search_youtube`.

- [ ] **Step 3: 实现批量读取、去重和独立失败汇总**

```python
def read_batch_urls(path: Path) -> list[str]:
    values = Path(path).read_text(encoding="utf-8-sig").splitlines()
    return list(dict.fromkeys(value.strip() for value in values if value.strip()))


def download_batch(self, urls) -> BatchSummary:
    summary = BatchSummary()
    for source in dict.fromkeys(str(value).strip() for value in urls if str(value).strip()):
        try:
            summary.results.extend(self.download_url(source))
        except Exception as exc:
            self.log(f"[failed] {source} {exc}")
            summary.results.append(DownloadResult("failed", source, message=str(exc)))
    return summary
```

只在批量边界把单项异常转换为失败结果；单链接接口继续抛出明确异常，便于调用方区分输入、依赖和运行错误。

- [ ] **Step 4: 允许 ytsearch 伪URL并实现搜索**

`download_url` 的公开URL校验不能接受 `ytsearch3:`，因此新增私有 `_download_source(source, validate_url)`：单链接调用时 `validate_url=True`，搜索调用时 `False`。搜索实现为：

```python
def search_youtube(self, query: str, count: int = 3) -> BatchSummary:
    normalized = str(query).strip()
    if not normalized:
        raise MaterialInputError("搜索关键词不能为空")
    if not isinstance(count, int) or isinstance(count, bool) or count <= 0:
        raise MaterialInputError("搜索数量必须是大于0的整数")
    source = f"ytsearch{count}:{normalized}"
    try:
        results = self._download_source(source, validate_url=False)
        return BatchSummary(results)
    except Exception as exc:
        return BatchSummary([DownloadResult("failed", source, message=str(exc))])
```

- [ ] **Step 5: 运行全部模块测试并确认通过**

Run: `python -m pytest tests/test_material_downloader.py -v`

Expected: all tests PASS.

- [ ] **Step 6: 提交 Task 3**

```bash
git add instagram/material_downloader.py tests/test_material_downloader.py
git commit -m "feat: add batch and keyword material downloads"
```

### Task 4: 命令行入口、退出码、文档和整体回归

**Files:**
- Create: `scripts/download_material.py`
- Create: `tests/test_download_material_script.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: `MaterialDownloader`、`read_batch_urls`、`DEFAULT_OUTPUT_DIR`
- Produces: `build_parser() -> argparse.ArgumentParser`、`run(args, downloader=None) -> int`、`main(argv=None) -> int`

- [ ] **Step 1: 写入三个子命令、部分失败退出码、无效参数和依赖缺失测试**

```python
from pathlib import Path

import pytest

from instagram.material_downloader import BatchSummary, DownloadResult
from scripts.download_material import build_parser, run


class FakeDownloader:
    def __init__(self):
        self.calls = []

    def download_url(self, value):
        self.calls.append(("url", value))
        return [DownloadResult("success", value)]

    def download_batch(self, values):
        self.calls.append(("batch", values))
        return BatchSummary([DownloadResult("success", values[0]), DownloadResult("failed", values[-1], message="boom")])

    def search_youtube(self, query, count=3):
        self.calls.append(("search", query, count))
        return BatchSummary([DownloadResult("success", query)])


def test_url_command_dispatches_and_returns_zero(capsys):
    fake = FakeDownloader()
    args = build_parser().parse_args(["url", "https://example.test/1"])
    assert run(args, fake) == 0
    assert fake.calls == [("url", "https://example.test/1")]
    assert "成功=1" in capsys.readouterr().out


def test_batch_partial_failure_returns_one(tmp_path):
    links = tmp_path / "links.txt"
    links.write_text("https://a.test/1\nhttps://b.test/2\n", encoding="utf-8")
    fake = FakeDownloader()
    assert run(build_parser().parse_args(["batch", str(links)]), fake) == 1


def test_search_defaults_to_three_and_accepts_custom_count():
    fake = FakeDownloader()
    assert run(build_parser().parse_args(["search", "旅行"]), fake) == 0
    assert fake.calls[-1] == ("search", "旅行", 3)
    assert run(build_parser().parse_args(["search", "旅行", "--count", "5"]), fake) == 0
    assert fake.calls[-1] == ("search", "旅行", 5)


def test_parser_rejects_zero_count():
    with pytest.raises(SystemExit):
        build_parser().parse_args(["search", "旅行", "--count", "0"])


def test_run_returns_dependency_code_when_yt_dlp_is_missing(monkeypatch, capsys):
    class MissingDependency:
        def download_url(self, _value):
            raise ImportError("No module named yt_dlp")
    code = run(build_parser().parse_args(["url", "https://example.test/1"]), MissingDependency())
    assert code == 2
    assert "yt-dlp" in capsys.readouterr().out
```

- [ ] **Step 2: 运行脚本测试，确认入口尚不存在**

Run: `python -m pytest tests/test_download_material_script.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.download_material'`.

- [ ] **Step 3: 实现 CLI 解析、正整数校验、日志和退出码**

```python
from __future__ import annotations

import argparse
from pathlib import Path

from instagram.material_downloader import DEFAULT_OUTPUT_DIR, BatchSummary, MaterialDownloader, read_batch_urls


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
```

`run` 将单链接结果包装成 `BatchSummary`，批量调用 `read_batch_urls`，搜索调用 `search_youtube`；逐条打印 `[success]`、`[skipped]` 或 `[failed]`，最后打印 `总数=N 成功=N 跳过=N 失败=N`。无失败返回 `0`，存在任务失败返回 `1`，输入/依赖问题返回 `2`。

- [ ] **Step 4: 在 README 写入安装与使用方法**

新增“自动素材下载”章节，包含：

```markdown
### 自动素材下载

安装依赖：

```powershell
python -m pip install -r requirements.txt
```

下载结果默认保存到 `C:\Users\DELL\Pictures\sucai`：

```powershell
python -m scripts.download_material url "帖子链接"
python -m scripts.download_material batch "links.txt"
python -m scripts.download_material search "旅行风景"
python -m scripts.download_material search "旅行风景" --count 5
```

YouTube 支持关键词搜索；TikTok 和 Instagram 需要提供具体帖子链接。部分视频格式需要系统已安装 FFmpeg。
```

- [ ] **Step 5: 运行新增模块与脚本测试**

Run: `python -m pytest tests/test_material_downloader.py tests/test_download_material_script.py -v`

Expected: all tests PASS.

- [ ] **Step 6: 运行完整 Python 回归测试并记录既有失败**

Run: `python -m pytest -v`

Expected: 新增测试全部通过；如出现既有测试失败，必须确认失败不由本次文件变更引起，并在交付报告中逐项列出，不能宣称完整套件全部通过。

- [ ] **Step 7: 执行不联网的 CLI 帮助烟雾测试**

Run: `python -m scripts.download_material --help`

Expected: exit code `0`，帮助中出现 `url`、`batch`、`search`。

- [ ] **Step 8: 经用户允许后执行真实公开内容验收**

使用用户提供或明确授权的公开 YouTube、TikTok、Instagram 链接运行三个 `url` 命令，再运行一次 `search`。逐项检查真实媒体文件、三行 `.text`、绝对素材路径和重复执行跳过行为。不得自行选择或下载可能受版权限制的内容作为测试样本。

- [ ] **Step 9: 提交 Task 4**

```bash
git add scripts/download_material.py tests/test_download_material_script.py README.md
git commit -m "feat: add material downloader command line"
```

### Task 5: 交付前规格核对与代码审查

**Files:**
- Review: `docs/superpowers/specs/2026-09-24-material-downloader-design.md`
- Review: `instagram/material_downloader.py`
- Review: `scripts/download_material.py`
- Review: `tests/test_material_downloader.py`
- Review: `tests/test_download_material_script.py`

**Interfaces:**
- Consumes: Task 1–4 的全部公开接口和测试结果
- Produces: 经审查且符合规格的最终实现与验证报告

- [ ] **Step 1: 对照规格逐项检查功能覆盖**

确认单链接、批量、YouTube搜索、固定输出目录、独立目录、三行元数据、路径安全、去重、日志、错误分类和 FFmpeg提示均有实现或测试证据。

- [ ] **Step 2: 检查工作区改动范围**

Run: `git diff -- requirements.txt instagram/material_downloader.py scripts/download_material.py tests/test_material_downloader.py tests/test_download_material_script.py README.md`

Expected: 只包含本计划范围内的改动，不覆盖用户已有的无关修改。

- [ ] **Step 3: 再次运行最终验证命令**

Run: `python -m pytest tests/test_material_downloader.py tests/test_download_material_script.py -v`

Expected: all tests PASS with fresh output captured for the final report.

- [ ] **Step 4: 请求最终代码审查并修复确认的问题**

审查重点是路径穿越、不同 yt-dlp 返回结构、重复任务判断、临时文件残留、错误日志泄密和 CLI 退出码。修复任何确认的问题后，重新运行 Step 3。

- [ ] **Step 5: 提交审查修复（仅在存在修复时）**

```bash
git add requirements.txt instagram/material_downloader.py scripts/download_material.py tests/test_material_downloader.py tests/test_download_material_script.py README.md
git commit -m "fix: harden material downloader"
```
