# SuperDM-SendTest · 插件端（会员系统改造后）

在「纯净版」批量私信插件基础上，新增了完整的账号 + 会员 + License + 设备限制体系。
**核心原则：完全保留原有发送逻辑，会员系统只在边界做拦截。**
未改动 `content.js` 与 `paho-src.js` 任何一行；原有发送主循环、草稿、去重、账号级错误自动停手等全部原样保留。

---

## 一、新增 / 修改的文件

**新增（全部经典脚本，可被 SW `importScripts` 与 popup `<script>` 共用）：**
- `lib/config.js` —— 公开配置（API 地址、Storage 键、心跳间隔、离线宽限）
- `lib/device.js` —— 设备识别（首次随机 UUID，存 `chrome.storage.local`）
- `lib/api.js` —— **仅 SW 侧**网络层，所有会员 API 由后台统一发出
- `lib/auth.js` —— **仅 popup 侧**登录态管理与会员守卫 `requireMembership()`

**修改：**
- `manifest.json` —— 新增 `alarms` 权限；`host_permissions` 增加后端域名
- `background.js` —— 顶部 `importScripts(lib/*)`；新增独立消息监听（只处理 `SDM_*` 消息）；`chrome.alarms` 心跳（每 5 分钟，绕开 SW 休眠）
- `popup.html` —— 新增账户条 / 登录注册视图 / 会员面板 / 设备面板（新 UI 全用 `auth-` 前缀 class，不污染现有样式）
- `popup.js` —— 发送按钮**首行**插入会员守卫（唯一拦截点）；追加登录/注册/会员/License/设备全套 UI 绑定

---

## 二、如何加载

1. 确保后端服务已启动（见 `../SuperDM-Server/README.md`），默认 `http://127.0.0.1:8787`。
2. Chrome 打开 `chrome://extensions` → 开启「开发者模式」→ 「加载已解压的扩展程序」→ 选择本目录 `SuperDM-SendTest`。
3. 点击扩展图标打开侧边栏：
   - 未登录 → 显示登录/注册；此时发送功能被拦截。
   - 登录且无会员 → 提示去「会员」面板激活 License 或购买。
   - 登录且有有效会员 → 正常显示发送界面，可批量发送。

---

## 三、关键行为

- **单点守卫**：只有 `popup.js` 发送按钮处理器首行 `await SDMAuth.requireMembership()` 一处拦截，不污染原有发送逻辑。
- **离线宽限**：服务器不可达时，允许在最近一次成功校验后的 24 小时内（服务端可下发覆盖）继续使用；超过则要求重新联网验证。
- **心跳**：`chrome.alarms` 每 5 分钟上报并刷新本地校验时间戳；设备被移除 / token 失效会自动清登录态并强制重新激活。
- **设备上限**：最多 3 台，由**后端**判定；客户端超限提示「请先移除一台设备」。
- **Token 与设备绑定**：Access Token 含设备哈希，被复制到别的设备会被后端拒绝。

---

## 四、需要改的地方（部署相关）

- **后端地址**：`lib/config.js` 的 `API_BASE`。生产环境改为你的 HTTPS 域名，并同步修改 `manifest.json` 的 `host_permissions`。
- **插件不持有任何 Secret**：所有密钥只在后端 `.env`，插件里只有 `API_BASE`。

---

## 五、完整流程

```
插件启动 → 读本地 Token → 无 Token 显示登录/注册
         → 有 Token → GET /api/me（后端判定）
             有效+会员有效+设备有效 → 允许发送
             Token 失效 → 自动 refresh 一次 → 仍失败则重新登录
             会员过期 → 显示续费入口
             设备被移除 → 要求重新激活
             账号封禁 → 禁止
```
