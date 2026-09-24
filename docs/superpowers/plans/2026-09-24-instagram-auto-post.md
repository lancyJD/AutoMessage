# Instagram Auto Post Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a command that logs into Instagram through BitBrowser and publicly publishes one Feed post from one or more local or HTTP/HTTPS media sources.

**Architecture:** Keep media acquisition, login/session acquisition, and the Playwright posting state machine as separate units. The CLI composes those units, and the posting state machine treats the first Share click as an irreversible boundary after which it never retries.

**Tech Stack:** Python 3, Playwright async API, requests, pytest, BitBrowser local API

**Spec:** `docs/superpowers/specs/2026-09-24-instagram-auto-post-design.md`

## Global Constraints

- Feed posts only; Reels and Story are out of scope.
- Support a single image/video and ordered multi-media carousel posts.
- Support Windows local paths and HTTP/HTTPS media URLs.
- Caption is `title + "\n\n" + content`; if either side is empty, use the non-empty side.
- Do not log passwords, cookies, 2FA secrets, generated TOTP codes, or complete authenticated request headers.
- Standard Instagram 2FA may be automated with `instagram/totp.py`; challenge, CAPTCHA, identity confirmation, and risk-control screens must stop with `needs_human`.
- Never retry or click Share again after the first Share click.
- A successful integration test creates a real public post. An unknown result must be checked manually and must not be automatically reposted.
- Do not initialize a Git repository as part of this work. If the workspace remains outside Git, replace each commit step with a recorded changed-file checkpoint.

## Review Focus

- A remote URL redirects to a non-HTTP scheme: reject it before upload; covered in Task 1 redirect test.
- Different source files resolve to the same filename: preserve both in order with unique task-local names; covered in Task 1 collision test.
- Instagram changes language from Chinese to English: role/property selectors still locate all stages; covered in Task 3 English-label test.
- Share succeeds server-side but the success toast never appears: return `unknown` and click Share exactly once; covered in Task 3 unknown-result test.
- Password, secret, or generated code appears inside an exception: sanitize logs and result messages; covered in Tasks 2 and 4 redaction tests.

---

### Task 1: Media preparation and caption composition

**Files:**
- Create: `instagram/media.py`
- Create: `tests/test_instagram_media.py`
- Modify: `requirements.txt`

**Interfaces:**
- Consumes: local filesystem paths, HTTP/HTTPS strings, and an optional `requests.Session`.
- Produces: `compose_caption(title: str | None, content: str | None) -> str`, `PreparedMedia` dataclass, and `MediaPreparer.prepare(sources: Sequence[str]) -> PreparedMediaBatch` context manager.

- [ ] **Step 1: Write failing caption and source-classification tests**

```python
from pathlib import Path
import pytest

from instagram.media import MediaInputError, classify_source, compose_caption


def test_compose_caption_preserves_unicode_and_spacing():
    assert compose_caption("산 여행 ⛰️", "저는 산과 강도 좋아합니다.") == "산 여행 ⛰️\n\n저는 산과 강도 좋아합니다."
    assert compose_caption("", "내용") == "내용"
    assert compose_caption("제목", None) == "제목"
    assert compose_caption(None, None) == ""


def test_classifies_only_local_http_and_https(tmp_path):
    local = tmp_path / "photo.png"
    local.write_bytes(b"png")
    assert classify_source(str(local)) == "local"
    assert classify_source("https://example.test/a.jpg") == "remote"
    with pytest.raises(MediaInputError):
        classify_source("file:///etc/passwd")
```

- [ ] **Step 2: Run tests and verify import failure**

Run: `python -m pytest tests/test_instagram_media.py -v`

Expected: FAIL because `instagram.media` does not exist.

- [ ] **Step 3: Implement data types and pure validation**

```python
@dataclass(frozen=True)
class PreparedMedia:
    source: str
    path: Path
    mime_type: str
    downloaded: bool


@dataclass
class PreparedMediaBatch:
    items: list[PreparedMedia]
    temporary_directory: tempfile.TemporaryDirectory[str] | None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        if self.temporary_directory:
            self.temporary_directory.cleanup()


def compose_caption(title, content):
    parts = [str(value).strip() for value in (title, content) if value and str(value).strip()]
    return "\n\n".join(parts)
```

Implement `classify_source` so only existing local files or HTTP/HTTPS URLs pass. Define allowed MIME/extension mappings for JPEG, PNG, AVIF, HEIC, HEIF, MP4, and QuickTime.

- [ ] **Step 4: Run the focused tests**

Run: `python -m pytest tests/test_instagram_media.py -v`

Expected: PASS for caption and classification tests.

- [ ] **Step 5: Add failing remote download, redirect, size, cleanup, ordering, and collision tests**

Use a fake session/response object with `iter_content`, `headers`, `url`, and `raise_for_status`. Assert:

```python
def test_prepare_preserves_order_and_unique_names_for_collisions(tmp_path, fake_session):
    with preparer.prepare([local_path, "https://example.test/photo.png"]) as batch:
        assert [item.source for item in batch.items] == [local_path, "https://example.test/photo.png"]
        assert batch.items[0].path.name != batch.items[1].path.name

def test_rejects_redirect_ending_in_non_http_scheme(fake_session):
    fake_session.response.url = "file:///tmp/photo.png"
    with pytest.raises(MediaInputError, match="HTTP/HTTPS"):
        MediaPreparer(session=fake_session).prepare(["https://example.test/photo.png"])

def test_rejects_response_larger_than_configured_limit(fake_session):
    fake_session.response.headers["Content-Length"] = "101"
    with pytest.raises(MediaInputError, match="大小"):
        MediaPreparer(session=fake_session, max_bytes=100).prepare(["https://example.test/photo.png"])

def test_temporary_downloads_are_removed_after_context_exit(fake_session):
    with MediaPreparer(session=fake_session).prepare(["https://example.test/photo.png"]) as batch:
        downloaded = batch.items[0].path
        assert downloaded.exists()
    assert not downloaded.exists()

def test_rejects_mime_and_file_signature_mismatch(fake_session):
    fake_session.response.headers["Content-Type"] = "image/png"
    fake_session.response.chunks = [b"not-a-png"]
    with pytest.raises(MediaInputError, match="类型"):
        MediaPreparer(session=fake_session).prepare(["https://example.test/photo.png"])
```

- [ ] **Step 6: Implement streamed download and file-signature validation**

`MediaPreparer(session=None, timeout=(10, 60), max_bytes=200 * 1024 * 1024)` must stream in chunks, stop as soon as the limit is exceeded, validate the final response URL scheme, generate index-prefixed unique filenames, and sniff common image/video signatures. Add `requests` to `requirements.txt` only if it is not already present.

- [ ] **Step 7: Run Task 1 tests**

Run: `python -m pytest tests/test_instagram_media.py -v`

Expected: all tests PASS.

- [ ] **Step 8: Checkpoint**

If Git is available:

```powershell
git add instagram/media.py tests/test_instagram_media.py requirements.txt
git commit -m "feat: prepare Instagram post media"
```

Otherwise record `instagram/media.py`, `tests/test_instagram_media.py`, and `requirements.txt` as the Task 1 changed-file checkpoint.

---

### Task 2: Login session handoff and safe TOTP handling

**Files:**
- Modify: `instagram/login.py`
- Modify: `instagram/totp.py`
- Modify: `tests/test_instagram_login.py`
- Modify: `tests/test_instagram_totp.py`

**Interfaces:**
- Consumes: account Markdown columns `username`, `password`, `cookie`, and `two_factor_secret`; `generate_totp(secret, log=None)`.
- Produces: `Account(username, password, cookie, two_factor_secret)`, `LoginSession(result: LoginResult, browser: object, context: object, page: object)`, and `InstagramLoginService.open_session(account_file, relogin=False) -> LoginSession`.

- [ ] **Step 1: Write failing account and session tests**

Extend fixtures with `two_factor_secret` and assert it is parsed without printing it. Add a fake Playwright page that begins on `/accounts/login/two_factor`, exposes `input[name="verificationCode"]`, and records fills/clicks.

```python
def test_standard_two_factor_uses_generated_code_without_logging_secret_or_code(tmp_path):
    messages = []
    session = asyncio.run(service.open_session(source, totp_factory=lambda _: "123456"))
    assert session.result.status is LoginStatus.SUCCESS
    assert fake_code_input.filled == "123456"
    assert all("SECRET" not in msg and "123456" not in msg for msg in messages)

def test_challenge_returns_needs_human_without_attempting_totp(tmp_path):
    fake_page.url = "https://www.instagram.com/challenge/"
    result = asyncio.run(service.open_session(source, totp_factory=totp_factory)).result
    assert result.status is LoginStatus.NEEDS_HUMAN
    assert totp_factory.call_count == 0
```

- [ ] **Step 2: Run the focused login tests**

Run: `python -m pytest tests/test_instagram_login.py tests/test_instagram_totp.py -v`

Expected: FAIL because the account model and `open_session` do not expose the required fields/session.

- [ ] **Step 3: Make TOTP silent by default for automation callers**

Keep the interactive `python -m instagram.totp` command printing the generated code, but make automated login call `generate_totp(secret, log=None)`. Add a test proving `log=None` emits nothing.

- [ ] **Step 4: Refactor login without breaking `login_first`**

Implement `open_session` as the primary method. Keep `login_first` as a compatibility wrapper returning `session.result`. Do not close the Playwright browser because the posting service consumes the returned page.

Use these exact explicit helper signatures:

```python
async def _submit_password(self, page, account: Account) -> None
async def _submit_totp(self, page, secret: str, totp_factory) -> bool
async def _detect_verification_state(self, page) -> str
```

Recognize a standard 2FA form only when its URL or form fields match. Treat `/challenge`, CAPTCHA text/iframe, and identity confirmation as `NEEDS_HUMAN`.

- [ ] **Step 5: Add and pass secret-redaction tests**

Raise fake exceptions containing the password, secret, and generated code. Assert `LoginResult.message` and every captured log replace these values with `[REDACTED]`. Implement one `redact_secrets(text, secrets)` helper and use it at every login exception boundary.

- [ ] **Step 6: Run Task 2 and compatibility tests**

Run: `python -m pytest tests/test_instagram_login.py tests/test_instagram_totp.py tests/test_public_api.py -v`

Expected: all tests PASS, including existing cookie-login behavior and CLI help.

- [ ] **Step 7: Checkpoint**

If Git is available:

```powershell
git add instagram/login.py instagram/totp.py tests/test_instagram_login.py tests/test_instagram_totp.py
git commit -m "feat: return Instagram login session with safe 2FA"
```

Otherwise record those four files as the Task 2 changed-file checkpoint.

---

### Task 3: Playwright Feed-post state machine

**Files:**
- Create: `instagram/posting.py`
- Create: `tests/test_instagram_posting.py`

**Interfaces:**
- Consumes: a logged-in Playwright-compatible `page`, `Sequence[PreparedMedia]`, and caption text.
- Produces: `PostStatus` enum, `PostResult(status, stage, message, post_url, media_count, share_clicked)`, and `InstagramPostService.publish(page, media, caption) -> PostResult`.

- [ ] **Step 1: Write failing success-path state-machine test**

Build a purpose-specific fake page that records semantic actions instead of reproducing Playwright internals. The test must assert this ordered trace:

```python
[
    "click:create",
    "set_files:[one.png,two.mp4]",
    "click:next:crop",
    "click:next:edit",
    "fill:caption:제목\n\n내용",
    "click:share",
    "wait:success",
]
```

Expected result: `PostStatus.SUCCESS`, `stage == "complete"`, `share_clicked is True`, and the discovered post URL is returned.

- [ ] **Step 2: Run the success test**

Run: `python -m pytest tests/test_instagram_posting.py::test_publishes_ordered_carousel_once -v`

Expected: FAIL because `instagram.posting` does not exist.

- [ ] **Step 3: Implement result types, selectors, and happy path**

Define selector groups for Chinese and English accessible names. Prefer role and input properties:

```python
CREATE_NAMES = re.compile(r"^(新帖子|创建|Create|New post)$", re.I)
NEXT_NAMES = re.compile(r"^(继续|Next)$", re.I)
SHARE_NAMES = re.compile(r"^(分享|Share)$", re.I)
FILE_INPUT = 'input[type="file"][multiple]'
```

Implement stage-specific timeouts and set all prepared paths in one `set_input_files([str(item.path) for item in media])` call.

- [ ] **Step 4: Add failing language and media-ready tests**

Add tests for English labels and for delayed preview readiness. The service must not click Next until the file input has accepted all items and the crop/edit dialog heading becomes visible.

- [ ] **Step 5: Implement stable locator fallbacks**

Use exact role/name locators first, then heading/context-scoped buttons. Never select the long dynamic Instagram class strings from the requirements document.

- [ ] **Step 6: Add failing error-boundary tests**

Cover:

```python
def test_upload_timeout_returns_upload_failure_without_share(fake_page):
    fake_page.fail_stage = "upload"
    result = asyncio.run(service.publish(fake_page, media, "caption"))
    assert (result.status, result.stage, result.share_clicked) == (PostStatus.FAILED, "upload", False)

def test_challenge_during_compose_returns_needs_human(fake_page):
    fake_page.challenge_stage = "compose"
    result = asyncio.run(service.publish(fake_page, media, "caption"))
    assert result.status is PostStatus.NEEDS_HUMAN

def test_share_click_failure_returns_publish_failure(fake_page):
    fake_page.fail_stage = "share_click"
    result = asyncio.run(service.publish(fake_page, media, "caption"))
    assert (result.status, result.share_clicked) == (PostStatus.FAILED, False)

def test_missing_success_after_share_returns_unknown_and_never_reclicks(fake_page):
    fake_page.fail_stage = "success_wait"
    result = asyncio.run(service.publish(fake_page, media, "caption"))
    assert (result.status, result.share_clicked) == (PostStatus.UNKNOWN, True)
    assert fake_page.share_click_count == 1

def test_english_labels_complete_same_state_machine(fake_page):
    fake_page.language = "en"
    result = asyncio.run(service.publish(fake_page, media, "caption"))
    assert result.status is PostStatus.SUCCESS
```

For the unknown test, assert `fake_page.share_click_count == 1` even when success waiting times out.

- [ ] **Step 7: Implement failure classification and irreversible boundary**

Set `share_clicked = True` immediately after the Share click resolves. Wrap every earlier stage separately. After `share_clicked` becomes true, all exceptions and timeouts return `PostStatus.UNKNOWN`; no retry loop may contain the Share operation.

- [ ] **Step 8: Run Task 3 tests**

Run: `python -m pytest tests/test_instagram_posting.py -v`

Expected: all tests PASS.

- [ ] **Step 9: Checkpoint**

If Git is available:

```powershell
git add instagram/posting.py tests/test_instagram_posting.py
git commit -m "feat: automate Instagram Feed publishing"
```

Otherwise record both files as the Task 3 changed-file checkpoint.

---

### Task 4: CLI composition and non-secret reporting

**Files:**
- Create: `scripts/publish_instagram_post.py`
- Create: `tests/test_publish_instagram_post_script.py`
- Modify: `instagram/__init__.py`
- Modify: `README.md` if present; otherwise create `docs/instagram-auto-post.md`

**Interfaces:**
- Consumes: `MediaPreparer`, `compose_caption`, `InstagramLoginService.open_session`, and `InstagramPostService.publish`.
- Produces: CLI command `python scripts/publish_instagram_post.py --media PATH_OR_URL --media SECOND_PATH_OR_URL [--title TEXT] [--content TEXT] [--account-file PATH] [--relogin]`.

- [ ] **Step 1: Write failing CLI parser and help tests**

```python
def test_help_lists_repeatable_media_and_caption_options():
    result = subprocess.run(
        [sys.executable, "scripts/publish_instagram_post.py", "--help"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0
    assert "--media" in result.stdout
    assert "--title" in result.stdout
    assert "--content" in result.stdout

def test_parser_preserves_repeated_media_order():
    args = build_parser().parse_args(["--media", "first.png", "--media", "second.mp4"])
    assert args.media == ["first.png", "second.mp4"]
```

- [ ] **Step 2: Run CLI tests**

Run: `python -m pytest tests/test_publish_instagram_post_script.py -v`

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement dependency-injected `run` and parser**

Implement exact signatures `async def run(args, *, browser_service=None, connect=None, media_preparer=None, login_service=None, post_service=None) -> int` and `def build_parser() -> argparse.ArgumentParser`. Inside `run`, enter the prepared-media context, open the login session, call `publish(session.page, batch.items, compose_caption(args.title, args.content))`, print the sanitized result, and map its status to the documented exit code.

Use `action="append", required=True` for `--media`. Default `--account-file` to `instagram/ins_account.md`. Return exit codes: `0` success, `1` known failure, `2` invalid input/dependency, `3` needs human, `4` unknown after Share.

- [ ] **Step 4: Add orchestration and redaction tests**

Inject fakes and assert media preparation exits after publishing, the exact caption reaches `publish`, and the browser/page from `open_session` is reused. Inject exceptions containing fixture credentials and assert captured stdout/stderr contain neither secret values nor six-digit codes.

- [ ] **Step 5: Implement concise safe output and exports**

Output one human-readable status line and one JSON line containing only status, stage, username, media count, post URL, and sanitized message. Export safe public result/model types from `instagram/__init__.py`; never export stored credentials.

- [ ] **Step 6: Document exact commands**

Document local and remote examples without real credentials:

```powershell
python.exe .\scripts\publish_instagram_post.py `
  --media 'C:\path\photo.png' `
  --title '标题 ⛰️' `
  --content '正文'

python.exe .\scripts\publish_instagram_post.py `
  --media 'https://example.com/a.jpg' `
  --media 'https://example.com/b.mp4' `
  --content '轮播内容'
```

- [ ] **Step 7: Run Task 4 tests**

Run: `python -m pytest tests/test_publish_instagram_post_script.py tests/test_public_api.py -v`

Expected: all tests PASS.

- [ ] **Step 8: Checkpoint**

If Git is available:

```powershell
git add scripts/publish_instagram_post.py tests/test_publish_instagram_post_script.py instagram/__init__.py README.md docs/instagram-auto-post.md
git commit -m "feat: add Instagram auto-post command"
```

Add only the documentation file that actually exists. Otherwise record the Task 4 changed files as a checkpoint.

---

### Task 5: Full verification and authorized public-post test

**Files:**
- Modify only if a defect is exposed: files from Tasks 1–4 and their owning tests
- Record result: `docs/test-results/2026-09-24-instagram-auto-post.md`

**Interfaces:**
- Consumes: completed CLI and the controlled account/media inputs described by the approved spec.
- Produces: automated-suite evidence and one real public Feed-post result without storing secrets.

- [ ] **Step 1: Run the complete automated suite**

Run:

```powershell
python -m pytest -v
python -m compileall bitbrowser instagram scripts
```

Expected: all tests PASS and compilation completes without syntax errors.

- [ ] **Step 2: Verify prerequisites without exposing secrets**

Check BitBrowser `/health`, verify the local test media exists, and parse the configured account. Print only booleans such as `bitbrowser_ready=true`, `media_exists=true`, `account_configured=true`, and `two_factor_configured=true`.

- [ ] **Step 3: Execute exactly one authorized public post**

Run from the repository root using the approved local test media and first approved Korean content. Pass text at invocation time; do not hard-code it in product code or test fixtures. Do not echo the account password or 2FA secret.

Expected: exit code `0`, `status=success`, and `media_count=1`. If exit code `4`/`unknown`, stop and inspect the open browser manually; do not rerun.

- [ ] **Step 4: Confirm the post on the profile**

Navigate within the same BitBrowser environment to the logged-in account profile. Verify the newest Feed item has the expected media and caption. Record only the public post URL, timestamp, media count, status, and sanitized observations.

- [ ] **Step 5: Handle a development retry safely**

Only if the first attempt failed before Share and the defect has a new failing automated test, fix it under TDD and rerun with the next approved Korean content. If Share was clicked or result is unknown, do not retry automatically.

- [ ] **Step 6: Write the sanitized test report**

Create `docs/test-results/2026-09-24-instagram-auto-post.md` with commands (credentials omitted), automated test counts, final status, and public URL if available. Confirm the file contains no password, Cookie, 2FA secret, or generated six-digit code.

- [ ] **Step 7: Final verification**

Run:

```powershell
python -m pytest -v
python -m compileall bitbrowser instagram scripts
rg -n "password=|sessionid=|two_factor_secret=|当前验证码" docs/test-results instagram scripts tests
```

Expected: tests and compilation PASS; secret scan has no credential values or generated-code logs. Field names in safe fixture/documentation contexts are acceptable after manual review.

- [ ] **Step 8: Checkpoint**

If Git is available:

```powershell
git add docs/test-results/2026-09-24-instagram-auto-post.md
git commit -m "test: verify Instagram auto posting"
```

Otherwise record the final report and complete changed-file list as the Task 5 checkpoint.
