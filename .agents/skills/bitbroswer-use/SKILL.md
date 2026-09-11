---
name: bitbroswer-use
description: "接管本机比特浏览器（BitBrowser）多开指纹浏览器。用于列出/创建/打开/关闭/删除 BitBrowser 环境、管理指纹/代理/Cookie/标签页/窗口布局/缓存/RPA，获得 CDP 调试端口，并通过 CDP 直接控制已登录网页。Triggers: 比特浏览器, BitBrowser, bitbrowser, bitbroswer-use, 指纹浏览器环境/窗口, AE/亚马逊等店铺浏览器接管, 批量管理浏览器环境。"
---

# BitBrowser（比特浏览器）全局接管 Skill

本机 BitBrowser 架构：

```text
Agent / 脚本
   │  ① HTTP POST JSON（本地 API）
   ▼
比特浏览器客户端（比特浏览器.exe）
   │  ② 启动/管理 Chromium 环境
   ▼
BitBrowser.exe（每个环境一个 Chromium 进程）
   │  ③ CDP WebSocket / HTTP
   ▼
控制页面、执行 JS、截图、操作 Cookie
```

核心原则：**不要另开普通 Chrome/Edge 代替 BitBrowser 环境**。必须通过 BitBrowser 自己的环境获取 CDP。

## 0. 本机关键位置（Windows）

- 主程序：`E:\bitbrowser\比特浏览器.exe`
- 用户数据目录：`C:\Users\Win10\AppData\Roaming\BitBrowser`
- 本地 API 配置：`C:\Users\Win10\AppData\Roaming\BitBrowser\config.json`
  ```json
  {"localServerAddress":"http://127.0.0.1:54345"}
  ```
- 默认本地 API：`http://127.0.0.1:54345`
- 环境缓存目录：`E:\bitbrowser-cache\<32位环境ID>\`
- 每个环境的 Chromium 命令行通常有：
  - `--user-data-dir=E:\bitbrowser-cache\<环境ID>`
  - `--remote-debugging-port`（可能显示为 `0`，实际端口由系统分配，不要信命令行数字）

## 1. Agent 调用方式

所有 BitBrowser 本地 API 均为 **POST + JSON**。

响应统一为：

```json
{"success":true,"data":...}
```

失败时：

```json
{"success":false,"msg":"错误原因"}
```

PowerShell 基础函数：

```powershell
$base = 'http://127.0.0.1:54345'
$headers = @{ 'Content-Type' = 'application/json' }

# 若 config.json 含 authToken，则加上：
# $headers['x-api-key'] = '<authToken>'

function BB($path, $body = @{}) {
  $json = if ($null -eq $body) { '{}' } else { $body | ConvertTo-Json -Compress -Depth 10 }
  Invoke-RestMethod -Uri ($base + $path) -Method Post -Headers $headers -ContentType 'application/json' -Body $json
}
```

Node/axios 等价写法：

```ts
const base = "http://127.0.0.1:54345";
const res = await fetch(base + "/browser/opened/ids", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
const json = await res.json();
```

## 2. 推荐的接管流程

### 2.1 先做健康检查

```powershell
BB '/health'
# {"success":true}
```

如果失败，说明比特浏览器客户端未启动。不要尝试直接启动 Chromium，而是询问用户或启动 `E:\bitbrowser\比特浏览器.exe`。

### 2.2 找出目标环境 ID

环境 ID 是 32 位十六进制字符串，例如 `fbf28c19c9534cdebea17d1bf82a309d`。

获取来源按优先级：

1. 用户直接提供；
2. BitBrowser 环境详情 URL：`https://console.bitbrowser.net/?id=<32位ID>&...`；
3. 查询已打开环境：
   ```powershell
   BB '/browser/opened/ids'
   ```
4. 列表接口（可分页、按名称/序号/分组过滤）：
   ```powershell
   BB '/browser/list' @{ page = 1; pageSize = 100 }
   BB '/browser/list' @{ page = 1; pageSize = 100; name = 'AE'; opened = $true }
   ```
   - 已知问题：部分情况下 `totalNum>0` 但 `list:[]`，这是 BitBrowser 云端列表代理偶发返回空；此时改用 `/browser/opened/ids` 或让用户提供 ID。

### 2.3 打开环境并获取 CDP

```powershell
$result = BB '/browser/open' @{
  id               = '<32位环境ID>'
  queue            = $true
  ignoreDefaultUrls = $false
}

$ws   = $result.data.ws
$http = $result.data.http
$pid  = $result.data.pid
```

- 如果环境已打开，`/browser/open` 不会重复启动，而是直接返回当前 CDP。
- 返回的 `data.http` 是 CDP HTTP 地址，例如 `127.0.0.1:62794`；
- `data.ws` 是浏览器级 CDP WebSocket。

验证 CDP：

```powershell
Invoke-RestMethod 'http://127.0.0.1:62794/json/version'
Invoke-RestMethod 'http://127.0.0.1:62794/json/list'
```

### 2.4 CDP 接管页面

有两条路：

1. 如果已安装 `browser-use` skill：
   ```bash
   export BU_CDP_URL="http://127.0.0.1:62794"
   browser-use <<'PY'
   print(page_info())
   PY
   ```

2. Node 原生 WebSocket（无需 npm 包）：
   ```js
   // 先从 /json/list 找到目标页面 webSocketDebuggerUrl
   const pageWs = "ws://127.0.0.1:62794/devtools/page/<targetId>";
   const ws = new WebSocket(pageWs);
   let id = 0;
   const pending = new Map();
   ws.onmessage = ev => {
     const msg = JSON.parse(ev.data);
     if (msg.id && pending.has(msg.id)) {
       pending.get(msg.id)(msg);
       pending.delete(msg.id);
     }
   };
   const send = (method, params = {}) => new Promise(resolve => {
     const mid = ++id;
     pending.set(mid, resolve);
     ws.send(JSON.stringify({ id: mid, method, params }));
   });
   ws.onopen = async () => {
     const r = await send("Runtime.evaluate", { expression: "document.title" });
     console.log(r.result?.result?.value);
     ws.close();
   };
   ```

## 3. 完整本地 API 速查表

> 以下接口均来自 GitHub SDK 与本机 Electron 主程序核对，确认真实存在。普通“接管任务”用不到全部，但 Agent 可以做更全面的环境管理。

### 3.1 环境生命周期

| 端点 | 关键 body | 用途 |
|---|---|---|
| `POST /health` | `{}` | 健康检查 |
| `POST /browser/list` | `page`, `pageSize`, `name?`, `groupId?`, `seq?`, `opened?` | 分页列表 |
| `POST /browser/list/concise` | `page`, `pageSize` | 精简列表 |
| `POST /browser/opened/ids` | `{}` | 已打开 ID |
| `POST /browser/detail` | `id` | 环境详情（敏感） |
| `POST /browser/open` | `id`, `args?`, `queue?`, `ignoreDefaultUrls?`, `newPageUrl?` | 打开并返回 CDP |
| `POST /browser/close` | `id` | 关闭单个 |
| `POST /browser/close/byseqs` | `seqs: number[]` | 按序号关闭 |
| `POST /browser/close/all` | `{}` | 关闭全部 |
| `POST /browser/closing/reset` | `id` | 重置关闭状态 |
| `POST /browser/update` | `id?`, `name`, `browserFingerPrint`, `proxy...` | 创建/更新环境 |
| `POST /browser/update/partial` | `ids`, `...部分字段` | 批量局部更新 |
| `POST /browser/delete` | `id` | 删除单个环境 |
| `POST /browser/delete/ids` | `ids: string[]` | 批量删除 |
| `POST /browser/pids` | `ids: string[]` | 指定 ID → PID |
| `POST /browser/pids/alive` | `ids: string[]` | 存活 PID |
| `POST /browser/pids/all` | `{}` | 全部已打开 PID |
| `POST /browser/ports` | `{}` | 已打开环境 → 调试端口 |

### 3.2 指纹与代理

| 端点 | 关键 body | 用途 |
|---|---|---|
| `POST /browser/fingerprint/random` | `browserId` | 随机指纹 |
| `POST /browser/update/partial` | `ids`, `browserFingerPrint` | 局部改指纹字段 |
| `POST /browser/proxy/update` | `ids`, `proxyMethod`, `proxyType`, `host`, `port`, `proxyUserName?`, `proxyPassword?` | 批量改代理 |
| `POST /checkagent` | `proxyType`, `host`, `port`, `proxyUserName?`, `proxyPassword?` | 代理检测 |
| `POST /browser/group/update` | `groupId`, `browserIds` | 修改分组 |
| `POST /browser/remark/update` | `browserIds`, `remark` | 批量改备注 |

### 3.3 Cookie

| 端点 | 关键 body | 用途 |
|---|---|---|
| `POST /browser/cookies/get` | `browserId` | 获取实时 Cookie（敏感） |
| `POST /browser/cookies/set` | `browserId`, `cookies: []` | 设置 Cookie |
| `POST /browser/cookies/clear` | `browserId`, `saveSynced?` | 清除 Cookie |
| `POST /browser/cookies/format` | `cookie`, `hostname` | 格式化 Cookie |

### 3.4 标签页 / 截图

| 端点 | 关键 body | 用途 |
|---|---|---|
| `POST /tabs/list` | `browserId` | 列出标签页 |
| `POST /tabs/openurl` | `browserId`, `url`, `active: bool` | 打开 URL |
| `POST /tabs/openurls` | `browserId`, `urls: string[]`, `closeOthers?` | 批量打开 |
| `POST /tabs/close` | `browserId`, `urls: string[]` | 关闭指定 URL |
| `POST /tabs/close/except` | `browserId`, `url` | 保留某个 URL |
| `POST /tabs/close/active` | `ids?`, `keepSafe?` | 关闭当前活动标签 |
| `POST /tabs/deduplication` | `browserId` | 去重标签 |
| `POST /tabs/refresh` | `browserId`, `url`, `ignoreCache?` | 刷新 |
| `POST /tabs/save` | `browserId`, `tabs` | 保存标签状态 |
| `POST /screenshot` | `browserId`, `path` | 截图到文件 |

### 3.5 窗口布局 / 缓存 / RPA / 工具

| 端点 | 关键 body | 用途 |
|---|---|---|
| `POST /windowbounds` | `type`, `width`, `height`, `col`, `spaceX`, `spaceY`, `ids` | 排列窗口 |
| `POST /windowbounds/flexable` | `seqlist?` | 自适应排列 |
| `POST /alldisplays` | `{}` | 获取显示器 |
| `POST /cache/clear` | `ids` | 清缓存 |
| `POST /cache/clear/exceptExtensions` | `ids` | 保留扩展数据清缓存 |
| `POST /rpa/run` | `id` | 运行 RPA 任务 |
| `POST /rpa/stop` | `id` | 停止 RPA 任务 |
| `POST /autopaste` | `browserId`, `url` | 从剪贴板仿真输入 |
| `POST /utils/readexcel` | `filepath` | 读 Excel |
| `POST /utils/readfile` | `filepath` | 读本地文本文件 |

## 4. 高效使用建议

### 4.1 能用列表就列表，不要遍历 detail

需要枚举环境时优先：

```powershell
BB '/browser/list' @{ page = 1; pageSize = 100; opened = $true }
```

`/browser/detail` 返回完整 Cookie/账号密码，**只在必须拿详情时才调用**，且不要把完整响应写进对话。

### 4.2 批量打开必须排队

多个环境同时打开时：

```powershell
BB '/browser/open' @{ id = 'id1'; queue = $true }
BB '/browser/open' @{ id = 'id2'; queue = $true }
```

否则容易触发 BitBrowser 本地 API 的并发限制。

### 4.3 拿到 CDP 后优先用 CDP 做页面操作

环境管理类操作（开/关/建/删/代理/Cookie）用本地 HTTP API；页面交互类操作（点击、填表、跳转、截图）用 CDP。这样比模拟键鼠更稳定。

### 4.4 避免重复创建环境

创建前先查列表，能复用就复用：

```powershell
$list = BB '/browser/list' @{ page = 1; pageSize = 100; name = '目标名称' }
```

### 4.5 利用 GitHub SDK 作为可选的代码封装

如果任务需要写复杂 Node.js 程序而不是一次性的 Agent 对话，可以直接在 Node 项目中使用 npm 包：

```bash
npm install bitbrowser
```

```ts
import { BitBrowser } from "bitbrowser";

const bb = new BitBrowser("http://127.0.0.1:54345");
const list = (await bb.browser.list({ page: 1, pageSize: 100 })).data.list;

for (const item of list) {
  const open = await bb.browser.open({ id: item.id, queue: true });
  console.log(open.data?.http);
}
```

但这个 SDK 只是“API 封装层”，**页面级 CDP 控制仍需配合 Puppeteer/Playwright/browser-use**。Skill 本体建议保持“直接调用本地 API”，不把 npm 包作为强依赖。

## 5. 安全与纪律

1. `/browser/detail`、`/browser/cookies/get`、`/browser-info` 含明文账号密码、Cookie、2FA，禁止整段输出；
2. 不要用普通 Chrome/Edge 替代 BitBrowser 环境；
3. 只关闭自己为任务打开的环境；用户原本打开的环境不主动 close；
4. 删除环境 `/browser/delete` 是不可恢复操作，必须先和用户确认；
5. 修改指纹/代理会影响目标账号登录态，执行前向用户说明；
6. 遇到验证码、双重验证、账号风控时停止并询问用户，不要自行绕过；
7. 如果本地 API 返回 403 / API Token 错误，从 `config.json` 读取 `authToken`，在请求头加 `x-api-key`。