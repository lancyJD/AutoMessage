// background.js —— SuperDM-SendTest
// 仅包含源文件 Super-DM-Bot-2.0.0 的「指定用户发送」所需后台逻辑：
//   1) FetchTargetUserInfo : topsearch 解析用户名 -> pk (GET /web/search/topsearch/)
//   2) CreateThread       : 建线程 (POST /direct_v2/create_group_thread/)
//   3) GetCookies         : 取 instagram.com cookie（用于构造 requestHeaders）
//   4) SDM_PREPARE        : 串联「解析 -> 建线程」，返回 threadId / viewerId / user
// 端点、body、headers 均与原版一致。
//
// 与原版的关键差异：原版请求跑在 instagram.com 页面内的 content script 上下文，
// 同域 fetch 会自动带 cookie；本测试版把请求放在后台 service worker，跨域 fetch
// 默认不带 cookie，因此必须显式把 Cookie 头拼进请求（否则 topsearch 返回空 users）。

// —— 会员系统：加载共享库（经典脚本，声明在全局），不改动下方任何现有逻辑 ——
importScripts('lib/config.js', 'lib/device.js', 'lib/api.js');

const IG_APP_ID = '936619743392459';
const APP_HEADERS = { 'x-asbd-id': '198387', 'X-IG-App-ID': IG_APP_ID };

// 原版 this.requestHeaders 构造方式（来自 botWork 的 startWorking）：
//   { "Content-Type":"application/x-www-form-urlencoded",
//     "X-CSRFToken": csrftoken, "x-requested-with":"XMLHttpRequest", "x-instagram-ajax":1 }
// 原版之所以不写 Cookie，是因为请求发在页面上下文、浏览器自动带 cookie。
// 后台 SW 跨域 fetch 不会自动带 cookie，所以这里额外补一个 Cookie 头。
function buildRequestHeaders(cookies) {
  const csrf = (cookies || []).find(c => c.name === 'csrftoken');
  const cookieStr = (cookies || []).map(c => `${c.name}=${c.value}`).join('; ');
  const h = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-CSRFToken': csrf ? csrf.value : '',
    'x-requested-with': 'XMLHttpRequest',
    'x-instagram-ajax': 1,
    'Cookie': cookieStr,
  };
  return h;
}

// 与源文件 static/background/index.js 完全一致的 topsearch 解析：
//   t.users 是数组，每个元素形如 { position, user: { pk, username, ... } }
//   先按 username 严格匹配，非严格时回退到 a[0].user
function parseTopsearch(json, username) {
  const users = (json && json.users) || [];
  if (!users.length) return null;
  const exact = users.find(u => u.user && u.user.username === username);
  const picked = (exact && exact.user) || (users[0] && users[0].user);
  if (!picked) return null;
  return {
    is_private: picked.is_private,
    is_verified: picked.is_verified,
    username: picked.username,
    full_name: picked.full_name,
    profile_pic_url: picked.profile_pic_url,
    id: Number(picked.pk),
  };
}

function getCookies() {
  return new Promise(res => chrome.cookies.getAll({ domain: 'instagram.com' }, res));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ---- 取 cookie ----
  if (msg.action === 'PingApps-DMBot-GetCookies' || msg.type === 'SDM_GET_COOKIES') {
    chrome.cookies.getAll({ domain: 'instagram.com' }, (cookies) => { sendResponse({ cookies }); });
    return true;
  }

  // ---- 解析用户名 -> pk（原版 FetchTargetUserInfo，GET topsearch）----
  if (msg.action === 'PingApps-DMBot-FetchTargetUserInfo') {
    const username = msg.params.igUsername;
    const headers = msg.params.headers || {};
    const url = new URL('https://www.instagram.com/web/search/topsearch/');
    url.searchParams.set('context', 'user');
    url.searchParams.set('query', username);
    fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
      headers: Object.assign({}, headers, APP_HEADERS),
    })
      .then(r => { if (!r.ok) return Promise.reject({ status: r.status, message: `Http ${r.status} error` }); return r.json(); })
      .then(j => {
        if (!j || j.status !== 'ok') return sendResponse({ error: { status: 999, message: j && j.message ? j.message : 'request failed' } });
        const user = parseTopsearch(j, username);
        if (!user) return sendResponse({ error: { status: 999, message: `user "${username}" not found` } });
        sendResponse({ userInfo: user });
      })
      .catch(e => sendResponse({ error: e }));
    return true;
  }

  // ---- 建线程（原版 CreateThread，POST create_group_thread）----
  if (msg.action === 'PingApps-DMBot-CreateThread') {
    const user = msg.params.user;
    chrome.cookies.getAll({ domain: 'instagram.com' }, (cookies) => {
      const headers = buildRequestHeaders(cookies);
      const body = new URLSearchParams([['recipient_users', '["' + user.id + '"]']]).toString();
      fetch('https://i.instagram.com/api/v1/direct_v2/create_group_thread/', {
        method: 'post',
        body,
        credentials: 'include',
        headers: Object.assign({}, headers, APP_HEADERS),
      })
        .then(r => r.ok ? r.json() : Promise.reject({ status: r.status, message: `Instagram return [${r.status} error]` }))
        .then(j => sendResponse({ data: j }))
        .catch(e => sendResponse({ error: e }));
    });
    return true;
  }

  // ---- SDM_PREPARE：解析用户名 + 建线程，一次性返回线程信息 ----
  if (msg.type === 'SDM_PREPARE') {
    const username = msg.username;
    getCookies().then(cookies => {
      const headers = buildRequestHeaders(cookies);
      const url = new URL('https://www.instagram.com/web/search/topsearch/');
      url.searchParams.set('context', 'user');
      url.searchParams.set('query', username);
      fetch(url.toString(), { method: 'GET', credentials: 'include', headers: Object.assign({}, headers, APP_HEADERS) })
        .then(r => r.ok ? r.json() : Promise.reject({ status: r.status, message: `Http ${r.status} error` }))
        .then(j => {
          const user = parseTopsearch(j, username);
          if (!user) throw { status: 999, message: '用户未找到: ' + username };
          const body = new URLSearchParams([['recipient_users', '["' + user.id + '"]']]).toString();
          return fetch('https://i.instagram.com/api/v1/direct_v2/create_group_thread/', {
            method: 'post', body, credentials: 'include',
            headers: Object.assign({}, headers, APP_HEADERS),
          }).then(r => r.ok ? r.json() : Promise.reject({ status: r.status, message: `Instagram return [${r.status} error]` }))
            .then(thread => ({ user, thread }));
        })
        .then(({ user, thread }) => {
          if (!thread || !thread.thread_id) throw { status: 999, message: '建线程失败: ' + JSON.stringify(thread) };
          sendResponse({ ok: true, threadId: thread.thread_id, viewerId: thread.viewer_id, user: { id: user.id, username: user.username } });
        })
        .catch(e => sendResponse({ ok: false, error: e }));
    });
    return true;
  }
});

// 点击扩展图标即打开侧边栏（常驻，不会因点击页面其它位置而关闭）
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

/* =========================================================================
 * 会员系统后台支撑（新增，独立于上方「发送」逻辑，互不干扰）
 *
 * 设计原则：
 *   - popup 永不直连后端；所有会员 API 由这里统一发出（SW 拥有 host_permissions，
 *     跨域 fetch 不受 CORS 限制，且 token / device 头集中管理）。
 *   - 心跳用 chrome.alarms（每 5 分钟），绕开 MV3 SW 30 秒休眠导致 setInterval 失效的问题。
 *   - 真正的会员权限由后端判定，这里只负责转发与缓存刷新成功时间。
 * ======================================================================= */

const SDM_ALARM_HEARTBEAT = 'sdm_heartbeat';

// 独立消息监听：只处理会员系统相关的消息，对上方「发送」逻辑零侵入。
// 注意：返回 true 表示本监听已处理并会异步 sendResponse；其它消息由上方监听处理。
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false; // 交给其它监听

  if (msg.type === 'SDM_API') {
    // popup 转发的后端请求
    SDMApi.handleApiMessage(msg).then((r) => sendResponse(r)).catch((e) => {
      sendResponse({ ok: false, status: 0, body: { success: false, error: { code: 'CLIENT_ERROR', message: String(e && e.message) } } });
    });
    return true;
  }

  if (msg.type === 'SDM_GET_DEVICE_ID') {
    SDMDevice.getDeviceId().then((id) => sendResponse({ deviceId: id })).catch(() => sendResponse({ deviceId: null }));
    return true;
  }

  if (msg.type === 'SDM_START_HEARTBEAT') {
    chrome.alarms.create(SDM_ALARM_HEARTBEAT, { periodInMinutes: SDM_CONFIG.HEARTBEAT_MINUTES });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'SDM_STOP_HEARTBEAT') {
    chrome.alarms.clear(SDM_ALARM_HEARTBEAT);
    sendResponse({ ok: true });
    return true;
  }

  // 不是会员系统消息：交给上方监听处理
  return false;
});

// 用 refreshToken 换新 access token（轮换），成功则写回 storage
function sdmTryRefresh(state) {
  return new Promise((resolve) => {
    if (!state.refreshToken) return resolve(false);
    SDMApi.sdmRequest('POST', '/api/auth/refresh', { token: null, body: { refreshToken: state.refreshToken } })
      .then((r) => {
        if (r.ok && r.body && r.body.success && r.body.data && r.body.data.accessToken) {
          state.accessToken = r.body.data.accessToken;
          if (r.body.data.refreshToken) state.refreshToken = r.body.data.refreshToken;
          const obj = {}; obj[SDM_CONFIG.STORAGE.AUTH] = state;
          chrome.storage.local.set(obj, () => resolve(true));
        } else {
          resolve(false);
        }
      })
      .catch(() => resolve(false));
  });
}

// 心跳：每 5 分钟上报一次，并顺便用 /api/me 续期本地校验时间戳。
// access token 过期时自动刷新重试；仅刷新也失败（会话真过期）或设备被移除才清登录态。
function sdmDoHeartbeat() {
  chrome.storage.local.get(SDM_CONFIG.STORAGE.AUTH, (r) => {
    const state = r && r[SDM_CONFIG.STORAGE.AUTH];
    if (!state || !state.accessToken) return; // 未登录，无需心跳
    const ping = () => SDMApi.sdmRequest('POST', '/api/device/heartbeat', { token: state.accessToken })
      .then(() => SDMApi.sdmRequest('GET', '/api/me', { token: state.accessToken }));
    ping()
      .then((res) => {
        const code = res.body && res.body.error && res.body.error.code;
        if (!res.ok && (code === 'TOKEN_EXPIRED' || code === 'INVALID_TOKEN')) {
          // token 过期：自动刷新后重试一次
          sdmTryRefresh(state).then((ok) => {
            if (!ok) {
              // 刷新也失败：会话真过期，清登录态要求重新登录
              chrome.storage.local.remove(SDM_CONFIG.STORAGE.AUTH);
              return;
            }
            ping().then((res2) => {
              if (res2.ok && res2.body && res2.body.success) {
                const d = res2.body.data;
                state.membership = d.membership;
                state.device = d.device;
                if (d.offlineGraceHours) state.offlineGraceHours = d.offlineGraceHours;
                state.lastVerifiedAt = Date.now();
                const obj = {}; obj[SDM_CONFIG.STORAGE.AUTH] = state;
                chrome.storage.local.set(obj);
              }
            });
          });
          return;
        }
        if (res.ok && res.body && res.body.success) {
          const d = res.body.data;
          state.membership = d.membership;
          state.device = d.device;
          if (d.offlineGraceHours) state.offlineGraceHours = d.offlineGraceHours;
          state.lastVerifiedAt = Date.now();
          const obj = {}; obj[SDM_CONFIG.STORAGE.AUTH] = state;
          chrome.storage.local.set(obj);
        }
        // 设备被移除：清登录态，强制重新激活
        if (res.body && res.body.success === false) {
          const code2 = res.body.error && res.body.error.code;
          if (code2 === 'DEVICE_REVOKED' || code2 === 'SESSION_EXPIRED') {
            chrome.storage.local.remove(SDM_CONFIG.STORAGE.AUTH);
          }
        }
      })
      .catch(() => { /* 网络抖动忽略，下次心跳再试 */ });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SDM_ALARM_HEARTBEAT) sdmDoHeartbeat();
});

// 启动时确保 device_id 存在，并按需开启心跳
chrome.runtime.onInstalled.addListener(() => {
  SDMDevice.getDeviceId().then(() => {
    chrome.storage.local.get(SDM_CONFIG.STORAGE.AUTH, (r) => {
      const state = r && r[SDM_CONFIG.STORAGE.AUTH];
      if (state && state.accessToken) {
        chrome.alarms.create(SDM_ALARM_HEARTBEAT, { periodInMinutes: SDM_CONFIG.HEARTBEAT_MINUTES });
      }
    });
  });
});
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(SDM_CONFIG.STORAGE.AUTH, (r) => {
    const state = r && r[SDM_CONFIG.STORAGE.AUTH];
    if (state && state.accessToken) {
      chrome.alarms.create(SDM_ALARM_HEARTBEAT, { periodInMinutes: SDM_CONFIG.HEARTBEAT_MINUTES });
    }
  });
});
