# SuperDM-SendTest

Instagram 批量私信 Chrome 扩展，使用 Manifest V3 侧边栏运行。

## 当前功能

- 导入或手动填写 Instagram 用户名
- 批量发送私信，并显示实时进度与日志
- 可随时停止发送
- 可跳过本机记录中已经发送过的用户
- 检测登录失效、限流等账号级错误后自动停止

## 文件说明

- `popup.html`：侧边栏发送界面
- `popup.js`：导入、草稿、发送队列、停止及日志逻辑
- `background.js`：读取 Instagram Cookie、查找用户并创建私信线程
- `content.js`：在 Instagram 页面内执行消息发送
- `manifest.json`：扩展权限和入口配置

登录、注册、会员、钱包支付、设备管理及其后端接口已从当前版本移除，后续将采用新的支付与终端检测方案。

## 本地加载

1. 打开 Chromium 浏览器的扩展管理页面。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择本目录 `chrome_exp/ins_send_msg`。
5. 修改代码后，在扩展管理页面点击“重新加载”。

## 测试

```powershell
node chrome_exp/ins_send_msg/tests/auth_removal.test.js
node --check chrome_exp/ins_send_msg/popup.js
node --check chrome_exp/ins_send_msg/background.js
```
