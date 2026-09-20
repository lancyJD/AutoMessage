# Instagram Comment Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interaction-user mode to the `chrome_exp/fensi` side panel that scans the latest 2 posts and exports unique comment users.

**Architecture:** Keep the existing follower flow intact. Add popup mode state and a separate comment-user result buffer, while background MAIN-world functions resolve recent media IDs and collect comment users with pagination/load-more termination rules.

**Tech Stack:** Chrome Extension Manifest V3, plain HTML/CSS/JavaScript, Node.js `assert`/`vm` tests.

**Spec:** `docs/superpowers/specs/2026-09-20-instagram-engagement-collector-design.md`

## Global Constraints

- Default mode is follower extraction.
- Default recent-post count is exactly 2.
- Phase one implements comment users only; likes remain visible but disabled/unavailable.
- Existing follower extraction behavior and tests must remain intact.
- Credentials, cookies, 2FA secrets, and complete request headers must never be logged.

## Review Focus

- 主页缺少或无法解析帖子媒体数据时，必须返回明确失败结果，且不得调用 `web_profile_info` 作为备用接口。
- Duplicate commenters across comments and posts must be exported once.
- Comment collection must stop when either `comment_count` is reached or no load-more control/cursor remains.
- Likes-only selection must be rejected as unavailable in phase one.
- Switching modes must not leak follower state into comment-user results.

---

### Task 1: Interaction-mode UI

**Files:**
- Modify: `chrome_exp/fensi/popup.html`
- Modify: `chrome_exp/fensi/popup.js`
- Create: `chrome_exp/fensi/tests/popup_interaction_mode.test.js`

**Interfaces:**
- Produces: mode controls `mode-followers`, `mode-interactions`, fields `interaction-user`, `post-count`, `collect-comments`, `collect-likes`, and `start-interactions`.
- Consumes: existing result, progress, stop, and execution-log elements.

- [ ] Write a failing static/UI contract test asserting default follower mode, post count `2`, bright selected state, comment enabled, likes visible but disabled, and shared execution log.
- [ ] Run `node chrome_exp/fensi/tests/popup_interaction_mode.test.js`; expect assertion failure for missing controls.
- [ ] Add the two-mode UI and popup mode switching without changing follower extraction.
- [ ] Run the test again; expect PASS.

### Task 2: Recent-post and comment collection engine

**Files:**
- Modify: `chrome_exp/fensi/background.js`
- Create: `chrome_exp/fensi/tests/background_comment_users.test.js`

**Interfaces:**
- Produces: `extractRecentMediaIds(value, limit)`, `fetchCommentsPageInMainWorld(mediaId, cursor)`, and `collectCommentUsersForMediaIds(tabId, mediaIds, sessionId)`.
- Consumes: existing stop flag and `extract-log` message channel.

- [ ] Write failing VM tests with literal fixtures for exactly two media IDs, `comments[].user`, `comment_count`, duplicate usernames, and pagination termination.
- [ ] Run `node chrome_exp/fensi/tests/background_comment_users.test.js`; expect missing-function failure.
- [ ] Implement pure media-ID extraction plus MAIN-world comments requests and deduplicating orchestration.
- [ ] Add background actions `resolve-recent-posts` and `extract-comment-users`.
- [ ] Run the test again; expect PASS.

### Task 3: Popup orchestration, logs, and export

**Files:**
- Modify: `chrome_exp/fensi/popup.js`
- Modify: `chrome_exp/fensi/popup.html`
- Create: `chrome_exp/fensi/tests/popup_comment_export.test.js`

**Interfaces:**
- Consumes: background actions from Task 2.
- Produces: comment-user start/stop flow, per-post progress, shared execution log, and `评论用户_` TXT filename.

- [ ] Write a failing contract test asserting interaction start wiring, background actions, comment-user buffer, per-post logs, and the `评论用户_` filename prefix.
- [ ] Run `node chrome_exp/fensi/tests/popup_comment_export.test.js`; expect assertion failure.
- [ ] Implement the interaction flow while preserving partial data on stop/failure.
- [ ] Run all extension tests with `Get-ChildItem chrome_exp/fensi/tests/*.test.js | ForEach-Object { node $_.FullName }`; expect all PASS.
- [ ] Run `node --check chrome_exp/fensi/popup.js` and `node --check chrome_exp/fensi/background.js`; expect no syntax errors.
