// lib/auth.js —— 仅 Popup 侧使用的认证/会员状态管理（经典脚本，由 popup.html 通过 <script> 加载）
// 职责：
//   - 维护 chrome.storage.local 里的登录态（token / user / membership）
//   - 通过 chrome.runtime.sendMessage({type:'IGX_API'}) 把请求转给 SW，自己不直连后端
//   - 提供 requireMembership() 作为插件核心功能（粉丝提取）的唯一拦截点
//   - 服务器是唯一权限判定方；客户端只缓存并尊重服务端下发的状态
(function (global) {
  'use strict';

  var CONFIG = global.IGX_CONFIG;

  /* ----------------------------- Storage 读写 ----------------------------- */
  function getState() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(CONFIG.STORAGE.AUTH, function (r) {
          resolve((r && r[CONFIG.STORAGE.AUTH]) || null);
        });
      } catch (e) { resolve(null); }
    });
  }
  function setState(state) {
    return new Promise(function (resolve) {
      var obj = {}; obj[CONFIG.STORAGE.AUTH] = state;
      chrome.storage.local.set(obj, function () { resolve(state); });
    });
  }
  function clearState() {
    return new Promise(function (resolve) {
      chrome.storage.local.remove(CONFIG.STORAGE.AUTH, function () { resolve(null); });
    });
  }

  /* --------------------- 与 SW 通信：转发到后端 --------------------- */
  // 仅发送消息给 SW，由 SW 完成 fetch 并返回 { ok, status, body }
  function igxApi(method, path, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(
          { type: 'IGX_API', method: method, path: path, body: opts.body, token: opts.token || null },
          function (r) {
            if (chrome.runtime.lastError || !r) {
              resolve({ ok: false, status: 0, body: { success: false, error: { code: 'NO_RESPONSE', message: '后台未响应' } } });
              return;
            }
            resolve(r);
          }
        );
      } catch (e) {
        resolve({ ok: false, status: 0, body: { success: false, error: { code: 'CLIENT_ERROR', message: String(e && e.message) } } });
      }
    });
  }

  /* --------------------- 带自动刷新的认证请求 --------------------- */
  // 所有需要登录态的接口统一走这里：access token 过期时自动用 refreshToken
  // 刷新一次并重试，用户无感知；刷新失败（会话真过期）才报 SESSION_EXPIRED。
  async function authed(method, path, body) {
    var state = await getState();
    if (!state || !state.accessToken) return { ok: false, error: { code: 'NOT_LOGGED_IN' } };
    var r = await igxApi(method, path, { token: state.accessToken, body: body });
    var code = r.body && r.body.error && r.body.error.code;
    if (!r.network && (code === 'TOKEN_EXPIRED' || code === 'INVALID_TOKEN')) {
      var refreshed = await tryRefresh(state);
      if (!refreshed) return { ok: false, error: { code: 'SESSION_EXPIRED', message: '登录已过期，请重新登录' } };
      r = await igxApi(method, path, { token: state.accessToken, body: body });
    }
    var success = !!(r.body && r.body.success);
    return {
      ok: success,
      data: success ? r.body.data : undefined,
      error: success ? undefined : ((r.body && r.body.error) || { code: r.network ? 'NETWORK_ERROR' : 'UNKNOWN' }),
      network: !!r.network,
    };
  }

  /* ----------------------------- 业务方法 ----------------------------- */
  async function syncMe(state) {
    var r = await igxApi('GET', '/api/me', { token: state.accessToken });
    if (r.network || !r.body || !r.body.success) return state;
    var d = r.body.data;
    state.user = d.user;
    state.membership = d.membership;
    state.device = d.device;
    if (d.offlineGraceHours) state.offlineGraceHours = d.offlineGraceHours;
    state.lastVerifiedAt = Date.now();
    return setState(state);
  }

  async function login(email, password) {
    var r = await igxApi('POST', '/api/auth/login', { body: { email: email, password: password } });
    if (r.network) return { ok: false, error: { code: 'NETWORK_ERROR', message: '无法连接服务器，请确认后端已启动', detail: r.body && r.body.error && r.body.error.detail } };
    if (!r.body || !r.body.success) return { ok: false, error: (r.body && r.body.error) || { code: 'UNKNOWN' } };
    var d = r.body.data;
    var state = {
      accessToken: d.accessToken,
      refreshToken: d.refreshToken,
      user: { id: d.userId, email: email, role: d.role },
      membership: null, device: null,
      lastVerifiedAt: Date.now(),
    };
    await setState(state);
    await syncMe(state);
    return { ok: true, state: await getState() };
  }

  async function register(email, password) {
    var r = await igxApi('POST', '/api/auth/register', { body: { email: email, password: password } });
    if (r.network) return { ok: false, error: { code: 'NETWORK_ERROR', message: '无法连接服务器，请确认后端已启动', detail: r.body && r.body.error && r.body.error.detail } };
    if (!r.body || !r.body.success) return { ok: false, error: (r.body && r.body.error) || { code: 'UNKNOWN' } };
    var d = r.body.data;
    var state = {
      accessToken: d.accessToken,
      refreshToken: d.refreshToken,
      user: { id: d.userId, email: email, role: d.role },
      membership: null, device: null,
      lastVerifiedAt: Date.now(),
    };
    await setState(state);
    await syncMe(state);
    return { ok: true, state: await getState() };
  }

  async function logout() {
    var state = await getState();
    if (state && state.accessToken) {
      await igxApi('POST', '/api/auth/logout', { token: state.accessToken });
    }
    await clearState();
    return { ok: true };
  }

  // Refresh Token Rotation：用 refreshToken 换新的 accessToken
  async function tryRefresh(state) {
    if (!state || !state.refreshToken) return false;
    var r = await igxApi('POST', '/api/auth/refresh', { token: null, body: { refreshToken: state.refreshToken } });
    if (r.body && r.body.success && r.body.data && r.body.data.accessToken) {
      state.accessToken = r.body.data.accessToken;
      if (r.body.data.refreshToken) state.refreshToken = r.body.data.refreshToken;
      await setState(state);
      return true;
    }
    await clearState();
    return false;
  }

  // 激活 License
  async function activateLicense(key) {
    var r = await authed('POST', '/api/license/activate', { licenseKey: key });
    if (r.network) return { ok: false, error: { code: 'NETWORK_ERROR', message: '无法连接服务器' } };
    if (!r.ok) return { ok: false, error: r.error || { code: 'UNKNOWN' } };
    var state = await getState();
    if (state) await syncMe(state);
    return { ok: true, state: await getState() };
  }

  async function loadPlans() {
    var r = await igxApi('GET', '/api/plans', {});
    if (r.body && r.body.success) return r.body.data.plans || [];
    return [];
  }

  async function loadDevices() {
    var r = await authed('GET', '/api/devices');
    if (r.network) return null;
    return r.ok ? r.data : null;
  }

  async function removeDevice(id) {
    var r = await authed('DELETE', '/api/devices/' + encodeURIComponent(id));
    if (r.network) return { ok: false, error: { code: 'NETWORK_ERROR', message: '无法连接服务器' } };
    if (r.ok) { var state = await getState(); if (state) await syncMe(state); return { ok: true }; }
    return { ok: false, error: r.error };
  }

  async function createCheckout(planId) {
    var r = await authed('POST', '/api/payment/create-checkout', { planId: planId });
    if (r.network) return { ok: false, error: { code: 'NETWORK_ERROR', message: '无法连接服务器' } };
    if (!r.ok) return { ok: false, error: r.error || { code: 'UNKNOWN' } };
    return { ok: true, data: r.data };
  }

  // 收款钱包信息（公开接口，无需登录）
  async function getWalletInfo() {
    var r = await igxApi('GET', '/api/payment/wallet-info');
    if (r.network) return { ok: false, error: { code: 'NETWORK_ERROR', message: '无法连接服务器' } };
    if (!r.body || !r.body.success) return { ok: false, error: (r.body && r.body.error) || { code: 'UNKNOWN' } };
    return { ok: true, data: r.body.data };
  }

  // 客服 Telegram（纸飞机）链接（公开接口，后台设置页可改）
  async function getSupportInfo() {
    var r = await igxApi('GET', '/api/support-info');
    if (r.network) return { ok: false, error: { code: 'NETWORK_ERROR', message: '无法连接服务器' } };
    if (!r.body || !r.body.success) return { ok: false, error: (r.body && r.body.error) || { code: 'UNKNOWN' } };
    return { ok: true, data: r.body.data };
  }

  /* --------------------- 核心守卫：requireMembership --------------------- */
  // 插件核心功能（粉丝提取）启动前唯一调用点。
  // 返回 { ok, reason, state, offline }
  //   reason 可能为：NOT_LOGGED_IN / MEMBERSHIP_REQUIRED / MEMBERSHIP_EXPIRED /
  //                  SESSION_EXPIRED / OFFLINE_GRACE_EXPIRED / ACCOUNT_BANNED / ACCOUNT_SUSPENDED
  async function requireMembership() {
    var state = await getState();
    if (!state || !state.accessToken) return { ok: false, reason: 'NOT_LOGGED_IN' };

    var graceHours = state.offlineGraceHours || CONFIG.OFFLINE_GRACE_HOURS;
    var graceMs = graceHours * 3600 * 1000;
    var lastVerified = state.lastVerifiedAt || 0;
    var withinGrace = (Date.now() - lastVerified) <= graceMs;
    var locallyActive = !!(state.membership && state.membership.active);

    // 联网校验优先：管理员撤销/封禁等操作即时生效；仅当服务器不可达时才退回本地宽限
    try {
      var r = await igxApi('GET', '/api/me', { token: state.accessToken });
      if (r.network) {
        if (locallyActive && withinGrace) return { ok: true, state: state, offline: true };
        return { ok: false, reason: 'OFFLINE_GRACE_EXPIRED' };
      }
      if (r.body && r.body.success) {
        var d = r.body.data;
        state.user = d.user; state.membership = d.membership; state.device = d.device;
        if (d.offlineGraceHours) state.offlineGraceHours = d.offlineGraceHours;
        state.lastVerifiedAt = Date.now();
        await setState(state);
        if (d.membership && d.membership.active) return { ok: true, state: state };
        return { ok: false, reason: (d.membership && d.membership.reason) || 'MEMBERSHIP_REQUIRED', state: state };
      }
      // 校验失败：token 失效 → 尝试刷新一次
      var code = r.body && r.body.error && r.body.error.code;
      if (code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED') {
        var refreshed = await tryRefresh(state);
        if (refreshed) return requireMembership(); // 重试一次
        return { ok: false, reason: 'SESSION_EXPIRED' };
      }
      if (code === 'ACCOUNT_BANNED') return { ok: false, reason: 'ACCOUNT_BANNED' };
      if (code === 'ACCOUNT_SUSPENDED') return { ok: false, reason: 'ACCOUNT_SUSPENDED' };
      return { ok: false, reason: code || 'MEMBERSHIP_REQUIRED' };
    } catch (e) {
      if (locallyActive && withinGrace) return { ok: true, state: state, offline: true };
      return { ok: false, reason: 'OFFLINE_GRACE_EXPIRED' };
    }
  }

  global.IGXAuth = {
    getState: getState,
    setState: setState,
    clearState: clearState,
    igxApi: igxApi,
    login: login,
    register: register,
    logout: logout,
    refresh: tryRefresh,
    requireMembership: requireMembership,
    activateLicense: activateLicense,
    loadPlans: loadPlans,
    loadDevices: loadDevices,
    removeDevice: removeDevice,
    createCheckout: createCheckout,
    getWalletInfo: getWalletInfo,
    getSupportInfo: getSupportInfo,
    syncMe: syncMe,
  };
})(typeof self !== 'undefined' ? self : this);
