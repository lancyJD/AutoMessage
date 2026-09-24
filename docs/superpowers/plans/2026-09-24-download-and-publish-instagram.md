# 素材下载后自动发布 Instagram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 输入一个素材页面URL后自动下载或复用本地素材，并在无需再次确认的情况下立即发布一个 Instagram Feed 帖子。

**Architecture:** 保持 `MaterialDownloader` 和现有发帖入口独立，新增 `scripts.download_and_publish_instagram` 作为编排层。下载器统一写 `.txt` 并兼容读取旧 `.text`；发帖入口增加可注入结果回调，让编排层汇总下载与发布结果而不解析控制台文本。

**Tech Stack:** Python 3.10+、yt-dlp、Playwright、BitBrowser、argparse、asyncio、pytest

**Spec:** `docs/superpowers/specs/2026-09-24-download-and-publish-instagram-design.md`

## Global Constraints

- 下载完成后立即发帖，下载与发帖之间不询问用户。
- 新元数据后缀统一为 `.txt`；读取时优先 `.txt`，没有时兼容一个旧 `.text`。
- 素材和元数据在成功、失败、需要人工处理和结果不确定时都必须保留。
- 重复来源可复用下载结果，但每次显式执行编排命令仍允许创建一次新帖子。
- 标题与内容完全相同时 Caption 只保留一份；不同时使用两个换行连接。
- 编排入口一次只接受一个来源链接，且下载结果必须对应一个可发布内容记录。
- 不实现数据库、任务队列、定时发布、Reels 或 Story。
- 不泄露密码、Cookie、2FA密钥、URL认证信息或查询令牌。
- 按用户要求不创建任何 Git commit；任务完成使用测试结果和变更清单作为检查点。

## Review Focus

- 下载器返回空列表、失败结果或两个独立内容时，发帖入口不得被调用；Task 3 覆盖。
- `.txt` 与旧 `.text` 同时存在、损坏或引用丢失文件时，必须优先有效 `.txt`，不可误用损坏记录；Task 1 覆盖。
- 发帖结果回调在输入、依赖、登录和运行时异常路径也必须收到且只收到一个最终结果；Task 2 覆盖。
- 标题与内容仅空白差异、换行差异或完全相同时，Caption 不得重复；Task 3 覆盖。
- 编排流程输出遇到韩文、Emoji或GBK控制台时不得中断，并且敏感信息必须脱敏；Task 3 覆盖。

---

### Task 1: 统一 `.txt` 元数据并兼容旧 `.text`

**Files:**
- Modify: `instagram/material_downloader.py`
- Modify: `tests/test_material_downloader.py`

**Interfaces:**
- Consumes: `MaterialRecord`、`write_metadata(record)`、`MaterialDownloader._existing_result(info, source_url)`
- Produces: 新记录 `metadata_path` 以 `.txt` 结尾；已有记录解析顺序为有效 `.txt` 后有效 `.text`

- [ ] **Step 1: 将新记录和兼容读取测试改为期望 `.txt`**

在 `tests/test_material_downloader.py` 中把新写入场景改为 `.txt`，并新增：

```python
def test_new_download_writes_txt_metadata(tmp_path):
    media = tmp_path / "TikTok_trip_748" / "trip.mp4"
    info = {
        "id": "748", "title": "trip", "description": "hello",
        "extractor_key": "TikTok", "webpage_url": "https://t.test/748",
        "test_paths": [media], "filepath": str(media),
    }
    result = MaterialDownloader(tmp_path, factory_for(info), log=lambda _m: None).download_url("https://t.test/748")
    assert result[0].record.metadata_path.suffix == ".txt"
    assert not list(tmp_path.rglob("*.text"))


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
    result = downloader.download_url("https://t.test/748")
    assert result[0].record.metadata_path == modern
    modern.write_text("broken", encoding="utf-8")
    result = downloader.download_url("https://t.test/748")
    assert result[0].record.metadata_path == legacy
```

- [ ] **Step 2: 运行测试并确认旧 `.text` 写入行为导致失败**

Run: `D:\soft\anaconda\envs\bitbrowser_platform\python.exe -m pytest tests/test_material_downloader.py -q -p no:cacheprovider`

Expected: FAIL because new records still use `.text` or selection does not prioritize valid `.txt`.

- [ ] **Step 3: 实现 `.txt` 写入和确定性的兼容查找**

在 `_record_entry` 中改为：

```python
metadata_path=directory / f"{key}.txt"
```

在 `_existing_result` 对每个候选目录依次检查：

```python
metadata_files = [
    *sorted(directory.glob("*.txt")),
    *sorted(directory.glob("*.text")),
]
for metadata_path in metadata_files:
    record = self._read_complete_record(info, source_url, directory, metadata_path)
    if record is not None:
        return DownloadResult("skipped", redact_text(source_url), record, "已存在")
```

不得使用“文件数量必须等于1”的判断，因为迁移期允许两个后缀同时存在；损坏 `.txt` 必须继续尝试旧 `.text`。

- [ ] **Step 4: 运行下载器测试并记录检查点**

Run: `D:\soft\anaconda\envs\bitbrowser_platform\python.exe -m pytest tests/test_material_downloader.py -q -p no:cacheprovider`

Expected: all downloader tests PASS；不创建 Git commit。

### Task 2: 给现有发帖入口增加结构化结果回调

**Files:**
- Modify: `scripts/publish_instagram_post.py`
- Modify: `tests/test_publish_instagram_post_script.py`

**Interfaces:**
- Consumes: 现有 `run(args, ...) -> int` 和 `_report(...) -> int`
- Produces: `run(..., reporter: Callable[[dict], None] | None = None) -> int`；每次执行最多调用一次 `reporter(payload)`

- [ ] **Step 1: 写入成功与异常路径的结果回调测试**

在现有脚本测试中新增：

```python
@pytest.mark.asyncio
async def test_run_reports_one_structured_final_payload(successful_dependencies, tmp_path):
    payloads = []
    args = make_args(tmp_path)
    code = await run(args, reporter=payloads.append, **successful_dependencies)
    assert code == 0
    assert len(payloads) == 1
    assert payloads[0]["status"] == "success"
    assert payloads[0]["stage"] == "publish"
    assert payloads[0]["post_url"]


@pytest.mark.asyncio
async def test_run_reports_one_payload_on_input_failure(tmp_path):
    payloads = []
    args = make_args(tmp_path)
    preparer = RaisingPreparer(MediaInputError("bad media"))
    code = await run(args, media_preparer=preparer, reporter=payloads.append)
    assert code == 2
    assert len(payloads) == 1
    assert payloads[0]["stage"] == "input"
```

测试应复用文件已有的 fake account、preparer、login 和 post service，不能访问真实 BitBrowser。

- [ ] **Step 2: 运行两个新增测试并确认 `reporter` 参数不存在**

Run: `D:\soft\anaconda\envs\bitbrowser_platform\python.exe -m pytest tests/test_publish_instagram_post_script.py -q -p no:cacheprovider`

Expected: FAIL with unexpected keyword argument `reporter`.

- [ ] **Step 3: 将 reporter 贯穿所有 `_report` 路径**

修改签名：

```python
async def run(
    args, *, browser_service=None, connect=None, media_preparer=None,
    login_service=None, post_service=None, reporter=None,
) -> int:
```

修改 `_report`：

```python
def _report(code, status, stage, username, media_count, post_url, message, secrets, reporter=None):
    safe_message = redact_secrets(message, secrets)
    payload = {
        "status": status,
        "stage": stage,
        "username": username,
        "media_count": media_count,
        "post_url": post_url,
        "message": safe_message,
    }
    if reporter is not None:
        reporter(dict(payload))
    print(f"[{status}] stage={stage} media={media_count} {safe_message}")
    print(json.dumps(payload, ensure_ascii=False))
    return code
```

每个 `_report(...)` 调用都必须显式传 `reporter`。保持未传 reporter 时的现有输出和退出码不变。

- [ ] **Step 4: 运行发帖脚本测试并记录检查点**

Run: `D:\soft\anaconda\envs\bitbrowser_platform\python.exe -m pytest tests/test_publish_instagram_post_script.py -q -p no:cacheprovider`

Expected: all publisher CLI tests PASS；不创建 Git commit。

### Task 3: 新增下载后立即发帖编排命令

**Files:**
- Create: `scripts/download_and_publish_instagram.py`
- Create: `tests/test_download_and_publish_instagram_script.py`

**Interfaces:**
- Consumes: `MaterialDownloader.download_url(source_url) -> list[DownloadResult]`、`publish_instagram_post.run(args, reporter=...) -> int`
- Produces: `build_parser()`、`build_caption(title, content) -> str`、`async run(args, downloader=None, publisher=None) -> int`、`main(argv=None) -> int`

- [ ] **Step 1: 写入 Caption、成功编排和前置失败测试**

创建测试文件，核心用例如下：

```python
def test_build_caption_deduplicates_equal_normalized_text():
    assert build_caption("同一内容", "同一内容") == "同一内容"
    assert build_caption("同一内容\n", " 同一内容 ") == "同一内容"
    assert build_caption("标题", "正文") == "标题\n\n正文"


@pytest.mark.asyncio
async def test_download_then_immediately_publishes_all_media(tmp_path):
    first = tmp_path / "a.mp4"
    second = tmp_path / "b.jpg"
    first.write_bytes(MP4_BYTES)
    second.write_bytes(JPEG_BYTES)
    metadata = tmp_path / "record.txt"
    metadata.write_text(f"标题:标题\n内容:正文\n素材:{first},{second}\n", encoding="utf-8")
    record = MaterialRecord("标题", "正文", "TikTok", "1", "https://t.test/1", tmp_path, (first, second), metadata)
    downloader = FakeDownloader([DownloadResult("success", record.source_url, record)])
    calls = []
    async def publisher(namespace, reporter=None):
        calls.append(namespace)
        reporter({"status": "success", "stage": "publish", "username": "demo", "media_count": 2, "post_url": "https://www.instagram.com/p/ok/", "message": "ok"})
        return 0
    code = await run(make_args("https://t.test/1", tmp_path), downloader=downloader, publisher=publisher)
    assert code == 0
    assert calls[0].media == [str(first.resolve()), str(second.resolve())]
    assert calls[0].title == "标题\n\n正文"
    assert calls[0].content == ""


@pytest.mark.asyncio
@pytest.mark.parametrize("results", [[], [DownloadResult("failed", "x", message="bad")], [success_one, success_two]])
async def test_invalid_download_result_never_calls_publisher(tmp_path, results):
    called = False
    async def publisher(*_args, **_kwargs):
        nonlocal called
        called = True
    code = await run(make_args("https://t.test/1", tmp_path), downloader=FakeDownloader(results), publisher=publisher)
    assert code in {1, 2}
    assert called is False
```

再分别覆盖 `skipped` 仍发布、元数据不存在、素材不存在、发布退出码 `3` 和 `4`、敏感信息脱敏以及包含韩文/Emoji的JSON输出。

- [ ] **Step 2: 运行编排测试并确认模块不存在**

Run: `D:\soft\anaconda\envs\bitbrowser_platform\python.exe -m pytest tests/test_download_and_publish_instagram_script.py -q -p no:cacheprovider`

Expected: FAIL with `ModuleNotFoundError: scripts.download_and_publish_instagram`.

- [ ] **Step 3: 实现参数、Caption和编排前置校验**

新脚本包含：

```python
def build_caption(title: str, content: str) -> str:
    normalized_title = " ".join(str(title or "").split()).strip()
    normalized_content = " ".join(str(content or "").split()).strip()
    if normalized_title == normalized_content:
        return normalized_title
    return "\n\n".join(value for value in (normalized_title, normalized_content) if value)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="下载素材后立即发布 Instagram Feed")
    parser.add_argument("source_url")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--account-file", type=Path, default=ROOT / "instagram" / "ins_account.md")
    parser.add_argument("--relogin", action="store_true")
    return parser
```

`run` 必须：

1. 创建或使用注入的 downloader。
2. 调用一次 `download_url`。
3. 只有一个 `success` 或 `skipped` 且含 record 时继续。
4. 校验 `.txt` 或兼容 `.text` 元数据真实存在。
5. 校验全部素材存在且解析后位于 `args.output_dir`。
6. 先调用 `build_caption(record.title, record.content)`，再构造发帖 Namespace：`media` 使用全部路径，`title` 使用完整 Caption，`content` 固定为空字符串，另含 `account_file`、`relogin`。这样现有发帖入口再次调用 `compose_caption` 时不会重复内容。
7. `await publisher(publish_args, reporter=capture.append)`，不得加入确认步骤。

- [ ] **Step 4: 实现统一结果与退出码**

最终输出使用现有 `console_text` 和下载器的 `redact_text`：

```python
payload = {
    "status": publish_payload.get("status", "failed"),
    "stage": publish_payload.get("stage", "publish"),
    "source_url": redact_text(args.source_url),
    "download_status": download_result.status,
    "metadata_path": str(record.metadata_path),
    "media_count": len(record.media_paths),
    "username": publish_payload.get("username", ""),
    "post_url": publish_payload.get("post_url"),
    "message": redact_text(publish_payload.get("message", "")),
}
console_print(json.dumps(payload, ensure_ascii=False))
```

下载异常返回 `1`，输入/元数据/素材错误返回 `2`；发帖返回码 `0/1/2/3/4` 原样保留。无论任何结果，不调用删除或清理下载目录。

- [ ] **Step 5: 运行编排测试并记录检查点**

Run: `D:\soft\anaconda\envs\bitbrowser_platform\python.exe -m pytest tests/test_download_and_publish_instagram_script.py -q -p no:cacheprovider`

Expected: all orchestration tests PASS；不创建 Git commit。

### Task 4: 文档、回归和真实验收准备

**Files:**
- Modify: `README.md`
- Modify: `docs/instagram-auto-post.md`
- Test: `tests/test_material_downloader.py`
- Test: `tests/test_publish_instagram_post_script.py`
- Test: `tests/test_download_and_publish_instagram_script.py`

**Interfaces:**
- Consumes: Tasks 1–3 的公开命令和退出码
- Produces: 用户可直接复制的运行命令、完整验证记录和真实验收入口

- [ ] **Step 1: 补充 README 使用命令**

新增：

```markdown
### 下载后立即发布 Instagram

```powershell
D:\soft\anaconda\envs\bitbrowser_platform\python.exe -m scripts.download_and_publish_instagram "素材页面地址"
```

程序下载或复用 `C:\Users\DELL\Pictures\sucai` 中的素材，生成 `.txt` 后立即发布，不会再次询问。发布完成或失败后本地文件都会保留。
```

- [ ] **Step 2: 更新自动发帖文档的输入和保留规则**

在 `docs/instagram-auto-post.md` 明确区分：

- `publish_instagram_post`：直接使用本地路径或媒体直链。
- `download_and_publish_instagram`：接收平台帖子页面URL，先通过 yt-dlp 下载，再立即发布。
- 新元数据使用 `.txt`，读取兼容旧 `.text`。
- 结果不确定时禁止自动重试。

- [ ] **Step 3: 运行专项测试**

Run: `D:\soft\anaconda\envs\bitbrowser_platform\python.exe -m pytest tests/test_material_downloader.py tests/test_publish_instagram_post_script.py tests/test_download_and_publish_instagram_script.py -q -p no:cacheprovider`

Expected: all targeted tests PASS.

- [ ] **Step 4: 运行完整回归测试**

Run: `D:\soft\anaconda\envs\bitbrowser_platform\python.exe -m pytest -q -p no:cacheprovider`

Expected: 本功能新增测试全部通过；已知旧失败 `tests/test_instagram_login.py::test_reads_first_real_account_without_splitting_escaped_name_pipe` 仍可能因账号 Cookie 为空而失败，必须如实报告且不得修改账号数据来迎合测试。

- [ ] **Step 5: 运行命令帮助烟雾测试**

Run: `D:\soft\anaconda\envs\bitbrowser_platform\python.exe -m scripts.download_and_publish_instagram --help`

Expected: exit code `0`，出现 `source_url`、`--output-dir`、`--account-file` 和 `--relogin`。

- [ ] **Step 6: 请求最终代码审查**

独立审查重点：下载后是否存在任何确认分支、`.txt/.text` 优先级、多个下载结果误发、路径越界、素材保留、发布结果不确定时的退出码、凭据泄露和重复发帖风险。重要问题通过新增失败测试后修复。

- [ ] **Step 7: 使用用户明确提供的链接执行一次真实发布**

真实命令：

```powershell
D:\soft\anaconda\envs\bitbrowser_platform\python.exe -m scripts.download_and_publish_instagram "用户本次明确提供的素材页面地址"
```

这是一次真实 Instagram 发帖外部副作用。用户提供本次链接即授权该次执行；下载完成后不得再次询问。验证 `.txt`、本地素材、返回帖子URL和文件保留情况。

- [ ] **Step 8: 输出工作区变更清单但不提交**

Run: `git status --short -- instagram/material_downloader.py scripts/publish_instagram_post.py scripts/download_and_publish_instagram.py tests/test_material_downloader.py tests/test_publish_instagram_post_script.py tests/test_download_and_publish_instagram_script.py README.md docs/instagram-auto-post.md`

Expected: 仅展示计划内文件；不运行 `git commit`、`git push` 或创建PR。
