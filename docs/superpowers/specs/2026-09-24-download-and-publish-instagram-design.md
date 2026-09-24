# 素材下载后自动发布 Instagram 设计

## 1. 目标

新增一个全自动编排入口。用户只提供一个受支持的公开素材页面地址，程序自动下载或复用本地素材，生成 `.txt` 元数据，随后立即调用现有 Instagram Feed 自动发帖流程，不再要求人工确认。

下载结果无论发布成功或失败都永久保留在 `C:\Users\DELL\Pictures\sucai`。本阶段不写数据库，但输出字段保持结构化，方便后续直接持久化任务、素材和发布结果。

## 2. 范围

### 2.1 包含

- 接收一个 YouTube、TikTok 或 Instagram 内容链接。
- 使用现有 `MaterialDownloader.download_url()` 下载或复用素材。
- 每条内容生成 `.txt` 元数据文件。
- 使用下载结果的全部本地素材立即发布一个 Instagram Feed 帖子。
- 使用下载标题与内容自动生成 Caption。
- 保留素材、元数据和下载目录。
- 支持现有账号文件、`--relogin` 和现有登录/2FA流程。
- 输出可序列化的阶段、下载状态、元数据路径、账号、发布状态、帖子URL和错误信息。

### 2.2 不包含

- 数据库表、数据库写入或迁移。
- 定时发布、任务队列、重试调度。
- Reels、Story 或跨平台发布。
- 下载完成后的人工确认。
- 自动删除本地素材。

## 3. 架构

采用独立编排命令，不把下载职责塞入现有发帖脚本：

- `instagram/material_downloader.py`：继续负责下载、去重和 `.txt` 元数据。
- `scripts/publish_instagram_post.py`：继续负责本地素材准备、登录和 Instagram 发布。
- `scripts/download_and_publish_instagram.py`：新增；负责按顺序连接上述两个流程、执行前置校验并汇总最终结果。
- `tests/test_download_and_publish_instagram_script.py`：新增；使用依赖注入测试流程，不访问外网或真实 Instagram。

编排层只依赖两个公开边界：下载器返回 `DownloadResult.record`；发帖入口接收本地素材路径、标题、内容、账号文件和重新登录选项。

## 4. 命令行

```powershell
python -m scripts.download_and_publish_instagram "素材页面地址"
python -m scripts.download_and_publish_instagram "素材页面地址" --account-file ".\instagram\ins_account.md"
python -m scripts.download_and_publish_instagram "素材页面地址" --relogin
```

参数：

- 必填位置参数 `source_url`：一个 HTTP/HTTPS 素材页面地址。
- `--output-dir`：默认 `C:\Users\DELL\Pictures\sucai`。
- `--account-file`：沿用现有 Instagram 账号文件默认值。
- `--relogin`：沿用现有重新登录行为。

第一版一次只发布一个来源链接。批量自动发布和关键词搜索后自动发布留待数据库任务系统实现，避免一次命令产生不受控的多个帖子。

## 5. 元数据契约

### 5.1 新后缀

所有新元数据统一写为：

```text
平台_标题_素材ID.txt
```

内容仍为 UTF-8 三行：

```text
标题:标题内容
内容:正文内容
素材:C:\绝对路径\a.mp4,C:\绝对路径\b.jpg
```

### 5.2 旧文件兼容

- 查找已有下载记录时优先读取 `.txt`。
- 如果没有 `.txt`，允许读取一个旧 `.text` 文件。
- 复用旧 `.text` 时不强制重命名，防止破坏已经存在的外部引用。
- 新下载、损坏记录修复和重新生成一律写 `.txt`。
- 同一目录同时存在有效 `.txt` 和 `.text` 时使用 `.txt`。

## 6. 数据流

1. 校验 `source_url` 是 HTTP/HTTPS 地址。
2. 调用 `MaterialDownloader.download_url(source_url)`。
3. 要求结果恰好对应一个可发布内容记录；下载失败或返回多个独立内容时停止。
4. 校验 `MaterialRecord.metadata_path` 存在，全部 `media_paths` 存在且位于素材根目录。
5. 将本地绝对路径传给现有 `MediaPreparer`；它负责文件签名、类型、大小和数量限制。
6. 构造 Caption：
   - 标题与内容都存在且不同：`标题 + 两个换行 + 内容`。
   - 标题与内容完全相同：只使用一份。
   - 只有一个字段存在：只使用该字段。
7. 调用现有 Instagram 登录与发布流程，不询问用户。
8. 保留所有下载文件和元数据。
9. 输出最终结构化结果并返回退出码。

## 7. 状态与退出码

最终结果至少包含：

```json
{
  "status": "success",
  "stage": "publish",
  "source_url": "...",
  "download_status": "success或skipped",
  "metadata_path": "C:\\...\\record.txt",
  "media_count": 1,
  "username": "...",
  "post_url": "https://www.instagram.com/p/.../",
  "message": "..."
}
```

退出码沿用发帖流程语义：

- `0`：发布成功。
- `1`：下载或发布失败。
- `2`：输入、元数据或依赖错误。
- `3`：需要人工处理登录验证。
- `4`：提交后结果不确定，禁止自动重试以避免重复发帖。

错误阶段使用 `download`、`metadata`、`media`、`login`、`publish` 或 `runtime`。任何阶段失败都不得继续执行后续阶段。

## 8. 安全与保留策略

- 下载器和发帖日志继续执行凭据脱敏。
- 最终JSON不得包含密码、Cookie、2FA密钥或URL认证信息。
- 元数据中的每个素材路径必须真实存在并位于输出根目录。
- 发布失败不删除素材；发布成功也不删除素材。
- 重复输入同一链接可以复用下载结果，但每次显式运行编排命令都允许创建一次新帖子。
- 发布状态为 `UNKNOWN` 时不自动重试。

## 9. 测试

自动测试覆盖：

- 新下载生成 `.txt` 而不是 `.text`。
- `.txt` 优先、旧 `.text` 回退。
- 下载成功后立即调用发帖且无需确认。
- 下载为 `skipped` 时仍然允许发帖。
- 下载失败、多个独立记录、元数据缺失、素材缺失时不调用发帖。
- 标题与内容相同只生成一份 Caption。
- 多素材保持原有顺序传给发帖流程。
- 登录需要人工处理、发布失败和发布结果不确定时保留正确退出码。
- 素材和元数据在成功与失败后均存在。
- 输出不泄露账号密码、Cookie或2FA密钥。

完成自动测试后，使用用户授权的公开素材链接执行一次真实下载与发帖验收。真实发布是外部副作用，执行前应由用户明确提供本次要发布的链接；编排流程本身不会在下载和发布之间再次询问。
