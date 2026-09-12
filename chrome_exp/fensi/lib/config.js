// lib/config.js —— IG 粉丝提取器 · 会员系统共享配置（经典脚本，SW 与 popup 通用）
// 只放公开配置：API 地址、插件版本、Storage 键名、心跳/离线宽限等。
// 绝不出现任何 Secret / 数据库地址 / 支付密钥。
// 注意：本插件使用独立后端（127.0.0.1:8788），与 SuperDM 后端（8787）完全隔离；
//       存储键与消息类型均用 igx_ 前缀，避免与 SuperDM 插件同浏览器安装时互相干扰。
(function (global) {
  'use strict';

  var IGX_CONFIG = {
    // 自有后端地址。本地测试先留空，上线后再填正式域名（如 https://api.example.com）。
    API_BASE: '',

    // 本地测试关掉认证 / 会员守卫；接上域名后改回 true。
    AUTH_ENABLED: false,

    PLUGIN_VERSION: '2.1.0',

    // chrome.storage.local 键名（igx_ 前缀，独立于其他插件）
    STORAGE: {
      AUTH: 'igx_auth',            // 登录态：token / user / membership / device / 时间戳
      DEVICE_ID: 'igx_device_id',  // 设备唯一标识（随机 UUID，首次运行生成）
    },

    // 心跳间隔（分钟）。由 chrome.alarms 驱动，不受 SW 30s 休眠影响。
    HEARTBEAT_MINUTES: 5,

    // 离线宽限（小时）：服务器暂时不可达时，允许在最近一次成功校验后的这段时间内继续使用。
    // 该值服务端可下发覆盖（system_settings.offline_grace_hours），此处仅为客户端默认值。
    OFFLINE_GRACE_HOURS: 24,

    // 设备名称前缀（便于后台识别）
    DEVICE_NAME_PREFIX: 'IGX',
  };

  global.IGX_CONFIG = IGX_CONFIG;
})(typeof self !== 'undefined' ? self : this);
