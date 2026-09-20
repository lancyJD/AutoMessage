// lib/device.js —— 设备识别（经典脚本，SW 与 popup 通用）
// 设计要点（对应需求 #11/#17）：
//   - 首次运行生成随机 UUID 存 chrome.storage.local，作为 device_id
//   - 服务端只保存 SHA-256(device_id + salt)，客户端全程只持有原始 device_id
//   - 设备头包含 device_id / 名称 / 浏览器 / 系统 / 插件版本，供后端风控与展示
(function (global) {
  'use strict';

  var CONFIG = global.SDM_CONFIG;

  function uuid() {
    // 优先用 crypto.randomUUID，回退到 Math.random 拼接
    try {
      if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    } catch (e) { /* ignore */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // 读取或生成 device_id（异步）
  function getDeviceId() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(CONFIG.STORAGE.DEVICE_ID, function (r) {
          var id = r && r[CONFIG.STORAGE.DEVICE_ID];
          if (id) return resolve(id);
          var newId = uuid();
          var obj = {};
          obj[CONFIG.STORAGE.DEVICE_ID] = newId;
          chrome.storage.local.set(obj, function () { resolve(newId); });
        });
      } catch (e) {
        resolve(uuid());
      }
    });
  }

  function detectBrowser() {
    try {
      var ua = navigator.userAgent || '';
      if (/Edg\//.test(ua)) return 'Edge';
      if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Chrome';
      if (/Firefox\//.test(ua)) return 'Firefox';
      if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
      return 'Chrome';
    } catch (e) {
      return 'Chrome';
    }
  }

  function detectOs() {
    return new Promise(function (resolve) {
      try {
        if (chrome.runtime && chrome.runtime.getPlatformInfo) {
          chrome.runtime.getPlatformInfo(function (info) {
            var map = { win: 'Windows', mac: 'macOS', linux: 'Linux', android: 'Android', cros: 'ChromeOS', openbsd: 'OpenBSD' };
            resolve(map[info.os] || info.os || 'Unknown');
          });
          return;
        }
      } catch (e) { /* ignore */ }
      resolve('Unknown');
    });
  }

  // 构建设备请求头（供后端识别设备）。返回 Promise。
  function buildDeviceHeaders() {
    return getDeviceId().then(function (deviceId) {
      return detectOs().then(function (os) {
        return {
          'x-device-id': deviceId,
          'x-device-name': CONFIG.DEVICE_NAME_PREFIX + '-' + deviceId.slice(0, 8),
          'x-browser': detectBrowser(),
          'x-os': os,
          'x-plugin-version': CONFIG.PLUGIN_VERSION,
        };
      });
    });
  }

  global.SDMDevice = {
    getDeviceId: getDeviceId,
    buildDeviceHeaders: buildDeviceHeaders,
    detectBrowser: detectBrowser,
    detectOs: detectOs,
  };
})(typeof self !== 'undefined' ? self : this);
