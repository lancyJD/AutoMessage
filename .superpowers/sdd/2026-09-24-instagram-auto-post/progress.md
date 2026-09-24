# SDD ledger — plan: docs/superpowers/plans/2026-09-24-instagram-auto-post.md

Pre-flight: Task 1 `PreparedMedia`/`compose_caption` feed Task 3 and Task 4; signatures agree.
Pre-flight: Task 2 `LoginSession.page` feeds Task 4; signatures agree.
Pre-flight: Task 3 `PostResult` feeds Task 4; status and fields agree.
Ruling: workspace is not a Git repository — use changed-file checkpoints required by the approved plan — cost if wrong: no per-task commit history.
Task 1: Ruling: use standard-library urllib instead of requests — the active Conda environment lacks requests and the same streamed interface is sufficient — cost if wrong: fewer advanced HTTP session features.
Task 1: complete (checkpoint: instagram/media.py, tests/test_instagram_media.py; tests: 7 passed).
Task 2: Ruling: add `instagram/posting_login.py` instead of modifying protected existing `instagram/login.py` — preserves the current login command and provides the page-bearing session needed by posting — cost if wrong: some login flow duplication until the filesystem restriction is removed.
Task 2: Ruling: existing `test_reads_first_real_account...` requires `sessionid=` but the user intentionally cleared the Cookie to exercise password login — leave production account data unchanged — cost if wrong: the legacy full suite remains red until that obsolete assertion is updated.
Task 2: complete (checkpoint: instagram/posting_login.py, new login/TOTP tests; focused new tests: 3 passed; legacy login suite: 1 incompatible data assertion failed, 11 passed).
Task 3: complete (checkpoint: instagram/posting.py, tests/test_instagram_posting.py; tests: 5 passed).
Task 4: complete (checkpoint: scripts/publish_instagram_post.py, tests/test_publish_instagram_post_script.py, docs/instagram-auto-post.md; tests: 3 passed).
Task 5: first live attempt stopped before Share at login; root cause evidence showed the current Meta login form uses `name=email`, `name=pass`, and `input[type=submit]`, not Instagram's older username/password/button selectors.
Task 5: second live attempt stopped before Share; root cause evidence showed the submit input is hidden and the visible action is a role=button named 登录 — covered by a RED→GREEN locator test before retry.
Task 5: third live attempt stopped before opening a page; BitBrowser lists four closed profiles named `instagram-PaulHernandez1675843`, and creating another profile hit the plan limit. No Share click occurred. Architecture review required before another attempt: reuse one existing named profile and persist its ID instead of creating a profile on each pre-login failure.
Task 5: after user approval, profile reuse test passed. Next live login reached `/accounts/login/two_factor`; the transition arrived after the fixed 3-second check and its visible submit action is role=button named 确认. Replaced the fixed wait with condition polling and added a RED→GREEN visible-confirm test.
Task 5: TOTP submission succeeded and the page later reached the logged-in Feed, but the first poll still saw the stale 2FA page and returned too early. Added `accept_two_factor=False` for the post-TOTP wait with a RED→GREEN transition test.
Task 5: authenticated posting attempt stopped at create before Share because the notification invitation overlay intercepted the New post icon. Added a RED→GREEN overlay-dismissal test and close “以后再说 / Not Now” before opening create.
Task 5: live public post succeeded once; status=success, media_count=1, URL=https://www.instagram.com/p/DdqZc5Mm1C9/.
Final: fixed ambiguous Share errors — dispatch-error test RED→GREEN; all click-time errors now return unknown and cannot be safely retried.
Final: fixed reused-profile authentication bypass — existing sessions now navigate, verify login, and verify the requested account before posting.
Final: fixed unrelated post URL reporting — real Playwright driver no longer selects an arbitrary feed `/p/` link.
Final: fixed empty CLI redaction set — credentials are loaded only for redaction before credential-bearing operations; injected leak test RED→GREEN.
Final: fixed challenge/2FA priority and resumable 2FA — challenge wins classification and initial 2FA screens enter the TOTP branch.
Final: fixed local media memory/limit handling — prefix-only signature reads, local size limit, and configurable media-count limit; tests RED→GREEN.
Final: fixed owned Playwright runtime leak — CLI stops only its own runtime in `finally`.
Final: minor (deferred): English selector test uses the abstract fake driver and does not exercise real Playwright selectors.
Task 5: complete (live post succeeded; targeted feature suite 30 passed; compileall passed; full suite 62 passed / 1 legacy Cookie assertion failed by intentional empty-Cookie configuration).
