// ============== IG 粉丝提取器 - Background Service Worker ==============
// 提取任意博主的粉丝用户名：分块抓取 + 进度回传 + 随时可停

// —— 会员系统：加载共享库（经典脚本，声明在全局），不改动下方任何现有提取逻辑 ——
importScripts('lib/config.js', 'lib/device.js', 'lib/api.js');

// ============== 工具 ==============

// 查找已打开的 Instagram 标签页（优先最近活跃的）
async function findInstagramTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  if (tabs.length === 0) {
    throw new Error('请先打开 instagram.com 并登录');
  }
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return tabs[0];
}

function resolveProfileFromGraphqlData(value, rawUsername) {
  const username = String(rawUsername || '').trim().toLowerCase().replace(/^@+/, '');
  if (Array.isArray(value)) {
    for (const item of value) {
      const profile = resolveProfileFromGraphqlData(item, username);
      if (profile) return profile;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  if (String(value.username || '').toLowerCase() === username && (value.id || value.pk)) {
    return {
      userId: String(value.id || value.pk),
      username: value.username || username,
      fullName: value.full_name || '',
      followerCount: Number(value.follower_count || (value.edge_followed_by && value.edge_followed_by.count) || 0),
      picUrl: value.profile_pic_url || (value.hd_profile_pic_url_info && value.hd_profile_pic_url_info.url) || ''
    };
  }
  for (const child of Object.values(value)) {
    const profile = resolveProfileFromGraphqlData(child, username);
    if (profile) return profile;
  }
  return null;
}

function resolveProfileFromHtml(html, rawUsername) {
  const username = String(rawUsername || '').trim().toLowerCase().replace(/^@+/, '');
  const idMatch = html.match(/"profile_id"\s*:\s*"?(\d+)"?/);
  if (!idMatch) return null;
  const countMatch = html.match(/"(?:follower_count|edge_followed_by)"\s*:\s*(?:\{[^}]*?"count"\s*:\s*)?(\d+)/);
  const nameMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
  const picMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
  return {
    userId: idMatch[1],
    username,
    fullName: nameMatch ? nameMatch[1].split('(@')[0].trim() : username,
    followerCount: countMatch ? Number(countMatch[1]) : 0,
    picUrl: picMatch ? picMatch[1] : ''
  };
}

// ---- 停止控制：以 storage.local 为唯一真相 ----
// igx_stop = 被请求停止的 sessionId；'ALL' 表示停止一切（兜底）
async function markStopped(sessionId) {
  await chrome.storage.local.set({ igx_stop: sessionId || 'ALL' });
}
async function clearStopped() {
  await chrome.storage.local.set({ igx_stop: null });
}

// ============== 在页面上下文中执行的函数 ==============
// 注意：这几个函数会被序列化注入到页面，函数体内部不能引用外部变量/常量

// 解析博主信息：username -> userId + 粉丝总数
async function resolveProfileInPage(rawUsername) {
  const BASE = 'https://www.instagram.com';
  const clean = String(rawUsername || '').trim().toLowerCase().replace(/^@+/, '');
  const resp = await fetch(`${BASE}/${encodeURIComponent(clean)}/`, {
    credentials: 'include',
    headers: { 'Accept': 'text/html,application/xhtml+xml' }
  });
  if (!resp.ok) throw new Error('找不到该博主，请检查用户名是否正确');
  const html = await resp.text();
  const idMatch = html.match(/"profile_id"\s*:\s*"?(\d+)"?/);
  if (!idMatch) throw new Error('无法从博主主页解析数字 ID（可能需要重新登录 Instagram）');
  const countMatch = html.match(/"(?:follower_count|edge_followed_by)"\s*:\s*(?:\{[^}]*?"count"\s*:\s*)?(\d+)/);
  const nameMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
  const picMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);

  return {
    userId: idMatch[1],
    username: clean,
    fullName: nameMatch ? nameMatch[1].split('(@')[0].trim() : clean,
    followerCount: countMatch ? parseInt(countMatch[1], 10) : 0,
    picUrl: picMatch ? picMatch[1] : ''
  };
}

// 检测登录状态（页面上下文中读 sessionid cookie）
async function checkLoginInPage() {
  const m = document.cookie.match(/(?:^|;\s*)sessionid=([^;]+)/);
  return !!(m && m[1]);
}

// 分块提取粉丝（每次调用最多抓 maxCount 个，返回游标供下次继续）
// sessionId 用于停止控制与进度归属：
//   1) 每翻一页前读一次 storage 里的停止标志
//   2) 进度回报带上 sessionId，popup 只认自己会话的消息
async function extractFollowersInPage(rawUserId, maxCount, startCursor, sessionId) {
  const BASE = 'https://www.instagram.com';
  const APP_ID = '936619743392459';
  const userId = String(rawUserId || '').trim();
  if (!userId) throw new Error('缺少博主数字 ID');
  const PAGE_COUNT = 12;
  const SEARCH_SURFACE = 'follow_list_page';

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // 停止检查：storage 里的 igx_stop 等于本会话 id（或 'ALL'）即停止
  const isStopped = async () => {
    try {
      const s = await chrome.storage.local.get(['igx_stop']);
      const v = s && s.igx_stop;
      if (!v) return false;
      return v === 'ALL' || (!!sessionId && v === sessionId);
    } catch (e) {
      return false;
    }
  };

  // 可中断的睡眠：把长延时切成 300ms 小段，边睡边检查停止标志
  // 这样「停止」最多 300ms 内生效，而不是等完整个 6 秒的限流退避
  const sleep = async (ms) => {
    const STEP = 300;
    let left = ms;
    while (left > 0) {
      if (await isStopped()) return true;
      const t = Math.min(STEP, left);
      await delay(t);
      left -= t;
    }
    return false;
  };

  // 进度回报（失败不影响主流程）
  const report = (done) => {
    try {
      const p = chrome.runtime.sendMessage({
        action: 'extract-progress',
        done,
        sessionId: sessionId || null
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {}
  };

  const allUsers = [];
  let cursor = startCursor || null;
  let hasNext = true;
  let guard = 0;
  let stopped = false;

  while (hasNext && allUsers.length < maxCount && guard < 3000) {
    if (await isStopped()) { stopped = true; break; }
    guard++;

    const url = new URL(`${BASE}/api/v1/friendships/${encodeURIComponent(userId)}/followers/`);
    url.searchParams.set('count', String(PAGE_COUNT));
    url.searchParams.set('search_surface', SEARCH_SURFACE);
    if (cursor) url.searchParams.set('max_id', cursor);

    let resp;
    try {
      resp = await fetch(url.toString(), {
        headers: {
          'X-IG-App-ID': APP_ID,
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': '*/*'
        },
        credentials: 'include'
      });
    } catch (e) {
      if (await sleep(2000)) { stopped = true; break; }
      continue;
    }

    // 429 限流：等待后重试同一页（等待期间可被停止打断）
    if (resp.status === 429) {
      if (await sleep(6000)) { stopped = true; break; }
      continue;
    }
    if (resp.status !== 200) break;

    let data;
    try { data = await resp.json(); } catch (e) { break; }

    if (data && data.require_login) {
      throw new Error('登录已过期，请重新登录 Instagram');
    }

    const users = Array.isArray(data && data.users) ? data.users : [];
    if (users.length === 0) { hasNext = false; break; }

    for (const user of users) {
      if (user.username) {
        allUsers.push({
          id: String(user.pk || user.id || ''),
          username: user.username,
          fullName: user.full_name || ''
        });
        if (allUsers.length >= maxCount) break;
      }
    }

    report(allUsers.length);

    cursor = data.next_max_id != null ? String(data.next_max_id) : null;
    hasNext = !!cursor;

    if (hasNext && allUsers.length < maxCount) {
      // 随机延时，降低被限流概率（可被停止打断）
      if (await sleep(800 + Math.random() * 900)) { stopped = true; break; }
    }
  }

  return { users: allUsers, hasNext, cursor, stopped };
}

// ============== 消息处理 ==============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = {
    // 检测是否已登录 Instagram
    async 'check-login'() {
      try {
        const tab = await findInstagramTab();
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: checkLoginInPage
        });
        return { success: true, loggedIn: !!(result && result.result) };
      } catch (e) {
        return { success: true, loggedIn: false, error: e.message || String(e) };
      }
    },

    // 解析博主 -> userId / 粉丝总数
    async 'resolve-profile'(msg) {
      try {
        const username = String(msg.username || '').trim().toLowerCase().replace(/^@+/, '');
        if (!username) throw new Error('请输入博主用户名');

        const tab = await findInstagramTab();
        await chrome.tabs.update(tab.id, { url: `https://www.instagram.com/${encodeURIComponent(username)}/` });
        await new Promise(resolve => setTimeout(resolve, 800));
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: resolveProfileInPage,
          args: [username]
        });

        if (result && result.result && result.result.userId) {
          return { success: true, profile: result.result };
        }
        throw new Error('解析博主失败，请确认已登录 Instagram');
      } catch (e) {
        return { success: false, error: e.message || String(e) };
      }
    },

    // 分块抓取粉丝
    async 'extract-followers'(msg) {
      try {
        const userId = msg.userId;
        if (!userId) throw new Error('缺少博主 ID，请先解析');

        const chunkSize = Math.max(1, Math.min(Number(msg.chunkSize) || 1000, 1000));
        const cursor = msg.cursor || null;
        const sessionId = msg.sessionId || null;

        const tab = await findInstagramTab();
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractFollowersInPage,
          args: [userId, chunkSize, cursor, sessionId]
        });

        if (result && result.result) {
          return { success: true, ...result.result };
        }
        throw new Error('提取失败，请确认已登录 Instagram');
      } catch (e) {
        return { success: false, error: e.message || String(e) };
      }
    },

    // 请求停止：写入停止标志，页面内的抓取循环最多 300ms 内退出
    async 'stop-extraction'(msg) {
      await markStopped(msg.sessionId);
      return { success: true };
    },

    // 开始新一轮前清除停止标志
    async 'clear-stop'() {
      await clearStopped();
      return { success: true };
    },
  };

  const h = handler[message.action];
  if (h) {
    h(message, sender)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: (err && err.message) || String(err) }));
    return true; // 保持消息通道开放
  }
});

// 弹窗关闭检测：popup 会建立名为 igx-extract 的长连接。
// 连接一断（弹窗关闭 / 扩展重载）立刻把该会话标记为停止，
// 避免注入到 Instagram 页面里的脚本变成"孤儿"继续空跑。
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'igx-extract') return;
  let sid = null;
  port.onMessage.addListener((m) => {
    if (m && m.action === 'register' && m.sessionId) sid = m.sessionId;
  });
  port.onDisconnect.addListener(() => {
    if (sid) markStopped(sid);
  });
});

console.log('IG 粉丝提取器已启动');

// 点击扩展图标即打开侧边栏（常驻，不会因点击页面其它位置而关闭）
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

/* =========================================================================
 * 会员系统后台支撑（新增，独立于上方「粉丝提取」逻辑，互不干扰）
 *
 * 设计原则：
 *   - popup 永不直连后端；所有会员 API 由这里统一发出（SW 拥有 host_permissions，
 *     跨域 fetch 不受 CORS 限制，且 token / device 头集中管理）。
 *   - 心跳用 chrome.alarms（每 5 分钟），绕开 MV3 SW 30 秒休眠导致 setInterval 失效的问题。
 *   - 真正的会员权限由后端判定，这里只负责转发与缓存刷新成功时间。
 * ======================================================================= */

const IGX_ALARM_HEARTBEAT = 'igx_heartbeat';

// 独立消息监听：只处理会员系统相关的消息，对上方「提取」逻辑零侵入。
// 注意：返回 true 表示本监听已处理并会异步 sendResponse；其它消息由上方监听处理。
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false; // 交给其它监听

  if (msg.type === 'IGX_API') {
    // popup 转发的后端请求
    IGXApi.handleApiMessage(msg).then((r) => sendResponse(r)).catch((e) => {
      sendResponse({ ok: false, status: 0, body: { success: false, error: { code: 'CLIENT_ERROR', message: String(e && e.message) } } });
    });
    return true;
  }

  if (msg.type === 'IGX_GET_DEVICE_ID') {
    IGXDevice.getDeviceId().then((id) => sendResponse({ deviceId: id })).catch(() => sendResponse({ deviceId: null }));
    return true;
  }

  if (msg.type === 'IGX_START_HEARTBEAT') {
    if (IGX_CONFIG.AUTH_ENABLED !== false) {
      chrome.alarms.create(IGX_ALARM_HEARTBEAT, { periodInMinutes: IGX_CONFIG.HEARTBEAT_MINUTES });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'IGX_STOP_HEARTBEAT') {
    chrome.alarms.clear(IGX_ALARM_HEARTBEAT);
    sendResponse({ ok: true });
    return true;
  }

  // 不是会员系统消息：交给上方监听处理
  return false;
});

// 用 refreshToken 换新 access token（轮换），成功则写回 storage
function igxTryRefresh(state) {
  return new Promise((resolve) => {
    if (!state.refreshToken) return resolve(false);
    IGXApi.igxRequest('POST', '/api/auth/refresh', { token: null, body: { refreshToken: state.refreshToken } })
      .then((r) => {
        if (r.ok && r.body && r.body.success && r.body.data && r.body.data.accessToken) {
          state.accessToken = r.body.data.accessToken;
          if (r.body.data.refreshToken) state.refreshToken = r.body.data.refreshToken;
          const obj = {}; obj[IGX_CONFIG.STORAGE.AUTH] = state;
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
function igxDoHeartbeat() {
  if (IGX_CONFIG.AUTH_ENABLED === false) return;
  chrome.storage.local.get(IGX_CONFIG.STORAGE.AUTH, (r) => {
    const state = r && r[IGX_CONFIG.STORAGE.AUTH];
    if (!state || !state.accessToken) return; // 未登录，无需心跳
    const ping = () => IGXApi.igxRequest('POST', '/api/device/heartbeat', { token: state.accessToken })
      .then(() => IGXApi.igxRequest('GET', '/api/me', { token: state.accessToken }));
    ping()
      .then((res) => {
        const code = res.body && res.body.error && res.body.error.code;
        if (!res.ok && (code === 'TOKEN_EXPIRED' || code === 'INVALID_TOKEN')) {
          // token 过期：自动刷新后重试一次
          igxTryRefresh(state).then((ok) => {
            if (!ok) {
              // 刷新也失败：会话真过期，清登录态要求重新登录
              chrome.storage.local.remove(IGX_CONFIG.STORAGE.AUTH);
              return;
            }
            ping().then((res2) => {
              if (res2.ok && res2.body && res2.body.success) {
                const d = res2.body.data;
                state.membership = d.membership;
                state.device = d.device;
                if (d.offlineGraceHours) state.offlineGraceHours = d.offlineGraceHours;
                state.lastVerifiedAt = Date.now();
                const obj = {}; obj[IGX_CONFIG.STORAGE.AUTH] = state;
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
          const obj = {}; obj[IGX_CONFIG.STORAGE.AUTH] = state;
          chrome.storage.local.set(obj);
        }
        // 设备被移除：清登录态，强制重新激活
        if (res.body && res.body.success === false) {
          const code2 = res.body.error && res.body.error.code;
          if (code2 === 'DEVICE_REVOKED' || code2 === 'SESSION_EXPIRED') {
            chrome.storage.local.remove(IGX_CONFIG.STORAGE.AUTH);
          }
        }
      })
      .catch(() => { /* 网络抖动忽略，下次心跳再试 */ });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === IGX_ALARM_HEARTBEAT) igxDoHeartbeat();
});

// 启动时确保 device_id 存在，并按需开启心跳
chrome.runtime.onInstalled.addListener(() => {
  IGXDevice.getDeviceId().then(() => {
    if (IGX_CONFIG.AUTH_ENABLED === false) return;
    chrome.storage.local.get(IGX_CONFIG.STORAGE.AUTH, (r) => {
      const state = r && r[IGX_CONFIG.STORAGE.AUTH];
      if (state && state.accessToken) {
        chrome.alarms.create(IGX_ALARM_HEARTBEAT, { periodInMinutes: IGX_CONFIG.HEARTBEAT_MINUTES });
      }
    });
  });
});
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(() => {
  if (IGX_CONFIG.AUTH_ENABLED === false) return;
  chrome.storage.local.get(IGX_CONFIG.STORAGE.AUTH, (r) => {
    const state = r && r[IGX_CONFIG.STORAGE.AUTH];
    if (state && state.accessToken) {
      chrome.alarms.create(IGX_ALARM_HEARTBEAT, { periodInMinutes: IGX_CONFIG.HEARTBEAT_MINUTES });
    }
  });
});
