// lib/config.js —— 插件侧共享配置（经典脚本，SW 与 popup 通用）
// 只放公开配置：API 地址、插件版本、Storage 键名、心跳/离线宽限等。
// 绝不出现任何 Secret / 数据库地址 / 支付密钥。
(function (global) {
  'use strict';

  var SDM_CONFIG = {
    // 自有后端地址（公开）。开发期指向本机服务；生产期改为你的 HTTPS 域名。
    // 若需更换，只改这里即可。
    API_BASE: 'http://43.157.82.128:8787',

    PLUGIN_VERSION: '1.0.0',

    // chrome.storage.local 键名
    STORAGE: {
      AUTH: 'sdm_auth',            // 登录态：token / user / membership / device / 时间戳
      DEVICE_ID: 'sdm_device_id',  // 设备唯一标识（随机 UUID，首次运行生成）
    },

    // 心跳间隔（分钟）。由 chrome.alarms 驱动，不受 SW 30s 休眠影响。
    HEARTBEAT_MINUTES: 5,

    // 离线宽限（小时）：服务器暂时不可达时，允许在最近一次成功校验后的这段时间内继续使用。
    // 该值服务端可下发覆盖（system_settings.offline_grace_hours），此处仅为客户端默认值。
    OFFLINE_GRACE_HOURS: 24,

    // 设备名称前缀（便于后台识别）
    DEVICE_NAME_PREFIX: 'SuperDM',
  };

  global.SDM_CONFIG = SDM_CONFIG;
})(typeof self !== 'undefined' ? self : this);
