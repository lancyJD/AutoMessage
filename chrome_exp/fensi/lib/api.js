// lib/api.js —— 仅 Service Worker 侧使用的网络层（经典脚本，由 background.js importScripts 加载）
// 所有会员系统 API 都从这里发出：SW 拥有 host_permissions，可跨域 fetch 且不受 CORS 限制，
// 同时把 token / device 头集中管理，popup 永远不直连后端。
(function (global) {
  'use strict';

  var CONFIG = global.IGX_CONFIG;

  // API 基地址解析：默认用 lib/config.js 的 API_BASE；
  // 可用 chrome.storage.local 的 'igx_api_base' 覆盖（例如后端跑在另一台机器时填 http://192.168.x.x:8788），
  // 覆盖后记得同步 manifest.json 的 host_permissions。结果缓存，避免每次请求都读 storage。
  var API_BASE_OVERRIDE_KEY = 'igx_api_base';
  var apiBasePromise = null;
  function getApiBase() {
    if (apiBasePromise) return apiBasePromise;
    apiBasePromise = new Promise(function (resolve) {
      try {
        chrome.storage.local.get(API_BASE_OVERRIDE_KEY, function (r) {
          var ov = r && r[API_BASE_OVERRIDE_KEY];
          resolve(ov && typeof ov === 'string' && ov.indexOf('http') === 0 ? ov.replace(/\/+$/, '') : CONFIG.API_BASE);
        });
      } catch (e) { resolve(CONFIG.API_BASE); }
    });
    return apiBasePromise;
  }

  // 统一的后端请求。返回 { ok, status, body }。
  function igxRequest(method, path, opts) {
    opts = opts || {};
    return getApiBase().then(function (base) {
      if (!base) {
        var empty = new Error('NETWORK_ERROR');
        empty.network = true;
        empty.detail = 'API_BASE 未配置';
        return Promise.reject(empty);
      }
      return global.IGXDevice.buildDeviceHeaders().then(function (devHeaders) {
        var headers = Object.assign({}, devHeaders);
        headers['Content-Type'] = 'application/json';
        if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token;

        var url = base + path;
        var init = { method: method, headers: headers };
        if (opts.body !== undefined) {
          init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
        }

        return fetch(url, init).then(function (res) {
          return res.text().then(function (text) {
            var body = null;
            try { body = text ? JSON.parse(text) : null; } catch (e) { body = { raw: text }; }
            return { ok: res.ok, status: res.status, body: body };
          });
        }).catch(function (err) {
          // 网络层错误（断网 / 服务未启动 / 域名不可达）：抛出，由调用方决定离线策略
          // 关键：把浏览器真实的失败原因（err.message / err.cause）带出去，便于定位是「服务没起」还是「地址不通」
          var e = new Error('NETWORK_ERROR');
          e.network = true;
          e.cause = err;
          e.detail = (err && (err.message || (err.cause && err.cause.message))) || String(err);
          throw e;
        });
      });
    });
  }

  // 处理来自 popup 的 IGX_API 消息：{ method, path, body, token }
  // 返回可直接 sendResponse 的对象 { ok, status, body } 或 { error }
  function handleApiMessage(msg) {
    return igxRequest(msg.method || 'GET', msg.path, { body: msg.body, token: msg.token })
      .then(function (r) { return r; })
      .catch(function (e) {
        if (e && e.network) {
          console.error('[IGX] API 请求失败:', (msg.method || 'GET'), msg.path, '->', e.detail, e.cause || '');
          return { ok: false, network: true, status: 0, body: { success: false, error: { code: 'NETWORK_ERROR', message: '无法连接服务器', detail: e.detail } } };
        }
        return { ok: false, status: 0, body: { success: false, error: { code: 'CLIENT_ERROR', message: String(e && e.message) } } };
      });
  }

  global.IGXApi = {
    igxRequest: igxRequest,
    handleApiMessage: handleApiMessage,
  };
})(typeof self !== 'undefined' ? self : this);
