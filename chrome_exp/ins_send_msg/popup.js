// popup.js —— SuperDM-SendTest 批量发送器
// 流程：解析用户名列表 → 逐个 SDM_PREPARE（topsearch+建线程）→ 确保 content 注入 → SDM_SEND（MQTT）
// 骨架能力：文件导入、进度显示、手动停止、跳过已发送、账号级错误自动停手、失败归类、收尾统计。

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

const SENT_KEY = 'sdm_sent_users'; // { "username_lower": timestamp }
const DRAFT_KEY = 'sdm_draft';     // 草稿：用户名/内容/间隔/跳过勾选，重开自动恢复

// 草稿持久化：输入框内容存盘，扩展面板重开（或侧边栏重新加载）后自动还原
async function saveDraft() {
  await chrome.storage.local.set({ [DRAFT_KEY]: {
    users: $('users').value,
    message: $('message').value,
    interval: $('interval').value,
    skipSent: $('skipSent').checked,
  }});
}
async function restoreDraft() {
  const d = await chrome.storage.local.get(DRAFT_KEY);
  const v = d[DRAFT_KEY];
  if (!v) return;
  if (v.users) $('users').value = v.users;
  if (v.message) $('message').value = v.message;
  if (v.interval) $('interval').value = v.interval;
  if (typeof v.skipSent === 'boolean') $('skipSent').checked = v.skipSent;
}
let draftTimer;
function scheduleSaveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 300);
}

function log(cls, text) {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = text;
  $('log').appendChild(div);
  $('log').scrollTop = $('log').scrollHeight;
}

// content 回传的 MQTT 过程日志
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SDM_LOG') log('info', '· ' + msg.text);
});

function cleanUsername(raw) {
  let s = String(raw || '').trim().replace(/^@/, '').split('?')[0];
  const segs = s.split('/').filter(Boolean);
  return segs.length > 1 ? segs[segs.length - 1] : (segs[0] || '');
}

// 账号级错误（需立刻停手，避免被 IG 强踢后还继续撞）：401/403/session/login/not-logged-in
function isAccountError(s) {
  return /401|403|session|login|not-logged-in|unauthorized|请登录|登[录出]/.test(s || '');
}

async function loadSent() {
  const s = await chrome.storage.local.get(SENT_KEY);
  return s[SENT_KEY] || {};
}
async function markSent(name) {
  const sent = await loadSent();
  sent[name.toLowerCase()] = Date.now();
  await chrome.storage.local.set({ [SENT_KEY]: sent });
}

async function getIgTab() {
  const tabs = await chrome.tabs.query({ url: 'https://*.instagram.com/*' });
  return tabs && tabs.length ? tabs[0] : null;
}

// 确保目标 IG 标签页里有我们的 content script
async function ensureContentScript(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'SDM_PING' });
    if (r && r.ok) return;
  } catch (_) { /* 无接收端，走注入 */ }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['paho-src.js', 'content.js'],
  });
  await sleep(250);
  try {
    const r2 = await chrome.tabs.sendMessage(tabId, { type: 'SDM_PING' });
    if (!r2 || !r2.ok) throw new Error('content script 注入后无响应');
  } catch (e) {
    throw new Error('content script 注入失败: ' + (e && e.message));
  }
}

async function sendOne(username, message) {
  // 1) 后台解析 + 建线程
  let prep;
  try {
    prep = await chrome.runtime.sendMessage({ type: 'SDM_PREPARE', username });
  } catch (e) {
    return { username, ok: false, error: 'PREPARE 异常: ' + (e && e.message) };
  }
  if (!prep || !prep.ok) {
    const e = prep && prep.error;
    return { username, ok: false, error: e ? (e.message || JSON.stringify(e)) : '解析/建线程失败' };
  }
  log('info', `▶ ${username} → thread ${prep.threadId}`);

  // 2) 找 IG 标签页，确保 content script 在
  const tab = await getIgTab();
  if (!tab) return { username, ok: false, error: '未找到 instagram.com 标签页，请先打开' };
  try {
    await ensureContentScript(tab.id);
  } catch (e) {
    return { username, ok: false, error: '注入失败: ' + (e && e.message) };
  }

  // 3) MQTT 发送。仅「连接级失败」(未收到 IG 回执) 才重试；
  //    收到 IG 回执（200 成功 或 403 等拒绝/账号错误）一律视为已处理，不重试、不误判
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res;
    try {
      res = await chrome.tabs.sendMessage(tab.id, {
        type: 'SDM_SEND',
        threadId: prep.threadId,
        viewerId: prep.viewerId,
        message,
        user: prep.user,
      });
    } catch (e) {
      lastErr = '发送异常: ' + (e && e.message);
      if (attempt < 2) { log('info', `· ${username} 发送异常，3s 后重试(${attempt}/2)`); await sleep(3000); continue; }
      break;
    }
    if (res && res.ok) return { username, ok: true };
    lastErr = (res && res.error) || 'unknown';
    // 收到 IG 回执（level='ack'，含 200/403/1545120 等）都算已处理，不重试
    if (res && res.level === 'conn' && attempt < 2) {
      log('info', `· ${username} 连接级失败，3s 后重试(${attempt}/2)`);
      await sleep(3000);
      continue;
    }
    break;
  }
  return { username, ok: false, error: lastErr };
}

/* ------------------------------ 批量主循环 ------------------------------ */

let stopFlag = false;

function setRunning(run) {
  $('send').disabled = run;
  $('stop').disabled = !run;
  $('users').disabled = run;
  $('message').disabled = run;
  $('import').disabled = run;
  $('file').disabled = run;
  $('clear').disabled = run;
  if (run) stopFlag = false;
}

$('stop').addEventListener('click', () => { stopFlag = true; });

$('clear').addEventListener('click', () => {
  $('users').value = '';
  $('log').innerHTML = '';
  $('progress').textContent = '';
  saveDraft();
});

// 导入文件：.txt 每行一个；.csv 取第一列（用户名）
$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const names = String(reader.result)
      .split(/[\r\n]+/)
      .map((s) => s.split(',')[0].trim()) // csv 取第一列
      .filter(Boolean);
    if (!names.length) { log('fail', '文件里没读到任何用户名'); return; }
    $('users').value = names.join('\n');
    log('info', `已导入 ${names.length} 个用户名`);
    saveDraft();
  };
  reader.onerror = () => log('fail', '文件读取失败');
  reader.readAsText(file);
  e.target.value = ''; // 允许重复选择同一文件
});

$('send').addEventListener('click', async () => {
  // ===== 会员守卫：未登录 / 会员失效 / 设备超限 一律在此拦截（核心功能唯一校验点）=====
  try {
    const guard = await SDMAuth.requireMembership();
    if (!guard.ok) { blockSend(guard.reason, guard.offline); return; }
    if (guard.offline) log('info', '· 离线宽限模式（服务器暂不可达），会员状态为上次成功校验结果');
  } catch (e) {
    log('fail', '⛔ 会员校验异常，已阻止发送：' + (e && e.message));
    return;
  }

  const rawUsers = $('users').value.split('\n').map(cleanUsername).filter(Boolean);
  const message = $('message').value.trim();
  if (!rawUsers.length) { log('fail', '请填写至少一个用户名（或导入文件）'); return; }
  if (!message) { log('fail', '请填写发送内容'); return; }

  // 去重（同一批内重复用户名）
  const seen = new Set();
  const unique = rawUsers.filter((u) => {
    const k = u.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 跳过已发送
  let queue = unique;
  if ($('skipSent').checked) {
    const sent = await loadSent();
    const before = queue.length;
    queue = queue.filter((u) => !sent[u.toLowerCase()]);
    const skipped = before - queue.length;
    if (skipped) log('info', `跳过已发送 ${skipped} 个`);
  }

  const total = queue.length;
  if (!total) { log('info', '没有需要发送的用户（都已发送过）'); return; }

  setRunning(true);
  log('info', `开始：共 ${total} 个用户（已从导入 ${rawUsers.length} 个去重）`);
  let okCount = 0, failCount = 0, accountStopped = false;

  for (let i = 0; i < queue.length; i++) {
    if (stopFlag) { log('info', '—— 已手动停止 ——'); break; }
    const u = queue[i];
    $('progress').textContent = `进度 ${i + 1}/${total} · 成功 ${okCount} · 失败 ${failCount}`;

    const r = await sendOne(u, message);
    if (r.ok) {
      okCount++;
      await markSent(u);
      log('ok', `✔ ${u} 发送成功`);
    } else {
      const err = r.error || '';
      if (isAccountError(err)) {
        log('fail', `✘ ${u} 账号异常：${err}`);
        log('fail', '⚠ 检测到账号级错误，停止发送以保护账号（请检查登录态/是否被限流）');
        accountStopped = true;
        break;
      }
      failCount++;
      log('fail', `✘ ${u} 失败：${err}`);
    }

    // 间隔（±1s 抖动），最后一条不等待
    if (i < queue.length - 1 && !stopFlag && !accountStopped) {
      const base = clamp(parseInt($('interval').value, 10) || 4, 1, 600);
      const wait = Math.max(500, (base + (Math.random() * 2 - 1)) * 1000);
      await sleep(wait);
    }
  }

  $('progress').textContent = `完成：成功 ${okCount} · 失败 ${failCount} · 共 ${total}`;
  log('info', '—— 完成 ——');
  setRunning(false);
});

// 绑定草稿自动保存（输入即存），并在面板打开时恢复上次内容
['users', 'message', 'interval'].forEach(id => $(id).addEventListener('input', scheduleSaveDraft));
$('skipSent').addEventListener('change', scheduleSaveDraft);
restoreDraft();

/* =========================================================================
 * 会员系统 UI（新增，独立于上方发送逻辑）
 * ======================================================================= */

const AUTH_MODE = { mode: 'login' };

function setAuthMsg(text, cls) {
  const m = $('auth-msg');
  if (!m) return;
  m.textContent = text || '';
  m.className = 'auth-msg' + (cls ? ' ' + cls : '');
}
function setLicMsg(text, cls) {
  const m = $('license-msg');
  if (!m) return;
  m.textContent = text || '';
  m.className = 'auth-msg' + (cls ? ' ' + cls : '');
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtAgo(iso) {
  if (!iso) return '未知';
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 0) return '刚刚';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  return d + ' 天前';
}
function friendlyError(err) {
  if (!err) return '操作失败，请稍后重试';
  const code = err.code;
  const map = {
    EMAIL_ALREADY_EXISTS: '该邮箱已注册，请直接登录',
    INVALID_CREDENTIALS: '邮箱或密码错误',
    VALIDATION_ERROR: err.message || '输入格式不正确',
    INVALID_LICENSE: 'License 无效',
    LICENSE_EXPIRED: 'License 已过期',
    LICENSE_REVOKED: 'License 已被撤销',
    LICENSE_ALREADY_ACTIVATED: '该 License 已绑定其他账号',
    MAX_DEVICES_REACHED: '该账号已有 3 台设备同时在线，请先在其他设备退出登录后再试',
    ACCOUNT_BANNED: '账号已被封禁，请联系客服',
    ACCOUNT_SUSPENDED: '账号已被暂停，请联系客服',
    NETWORK_ERROR: '无法连接服务器，请确认后端已启动' + (err.detail ? '（' + err.detail + '）' : ''),
    PAYMENT_FAILED: '支付失败，请重试',
    RATE_LIMITED: '操作过于频繁，请稍后再试',
    SESSION_EXPIRED: '登录已过期，请点击「退出」后重新登录',
    TOKEN_EXPIRED: '登录已过期，请点击「退出」后重新登录',
    NOT_LOGGED_IN: '请先登录后再操作',
  };
  return map[code] || (err.message || '操作失败');
}

function showAuthView(show) {
  $('auth-view').hidden = !show;
  $('app-view').hidden = show;
  if (show) {
    $('membership-panel').hidden = true;
    $('devices-panel').hidden = true;
  }
}

function mkBtn(text, cls, onClick) {
  const b = document.createElement('button');
  b.className = cls || 'auth-link';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function blockSend(reason, offline) {
  const map = {
    NOT_LOGGED_IN: '请先登录后再使用发送功能。',
    MEMBERSHIP_REQUIRED: '本功能需要有效会员，请先购买或激活 License。',
    MEMBERSHIP_EXPIRED: '您的会员已到期，请续费后继续使用。',
    SESSION_EXPIRED: '登录已失效，请重新登录。',
    OFFLINE_GRACE_EXPIRED: '离线已超过宽限期，请联网后重新验证会员状态。',
    ACCOUNT_BANNED: '账号已被封禁，请联系客服。',
    ACCOUNT_SUSPENDED: '账号已被暂停，请联系客服。',
  };
  const msg = map[reason] || ('当前无法使用发送功能（' + reason + '）');
  log('fail', '⛔ ' + msg);
  if (reason === 'NOT_LOGGED_IN' || reason === 'SESSION_EXPIRED') {
    showAuthView(true);
  } else {
    openMembershipPanel();
  }
}

async function renderAccount() {
  const state = await SDMAuth.getState();
  const actions = $('auth-actions');
  const status = $('auth-status');
  actions.innerHTML = '';
  if (!state || !state.accessToken) {
    status.textContent = '未登录';
    showAuthView(true);
    return;
  }
  showAuthView(false);
  const u = state.user || {};
  const mem = state.membership || {};
  status.textContent = u.email || '已登录';

  const badge = document.createElement('span');
  badge.className = 'auth-plan' + (mem.active ? '' : ' expired');
  badge.textContent = mem.active ? (mem.planName || '会员') : (mem.reason === 'EXPIRED' ? '已过期' : '未开通');
  actions.appendChild(badge);
  actions.appendChild(mkBtn('会员', 'auth-link', () => openMembershipPanel()));
  actions.appendChild(mkBtn('设备', 'auth-link', () => openDevicesPanel()));
  actions.appendChild(mkBtn('退出', 'auth-link', () => doLogout()));
}

async function doLogout() {
  await SDMAuth.logout();
  try { chrome.runtime.sendMessage({ type: 'SDM_STOP_HEARTBEAT' }); } catch (e) {}
  log('info', '已退出登录');
  renderAccount();
}

async function doAuthSubmit() {
  const email = $('auth-email').value.trim();
  const pwd = $('auth-password').value;
  if (!email || !pwd) { setAuthMsg('请填写邮箱和密码', 'err'); return; }
  setAuthMsg(AUTH_MODE.mode === 'login' ? '登录中…' : '注册中…', '');
  const res = AUTH_MODE.mode === 'login'
    ? await SDMAuth.login(email, pwd)
    : await SDMAuth.register(email, pwd);
  if (!res.ok) { setAuthMsg(friendlyError(res.error), 'err'); return; }
  setAuthMsg('成功，正在载入…', 'ok');
  try { chrome.runtime.sendMessage({ type: 'SDM_START_HEARTBEAT' }); } catch (e) {}
  await renderAccount();
  await openMembershipPanel();
}

function togglePanel(id) {
  ['membership-panel', 'devices-panel'].forEach(p => {
    if (p !== id) $(p).hidden = true;
  });
  $(id).hidden = !$(id).hidden;
}

async function openMembershipPanel() {
  $('membership-panel').hidden = false;
  $('devices-panel').hidden = true;
  await renderMembership();
}
async function openDevicesPanel() {
  $('devices-panel').hidden = false;
  $('membership-panel').hidden = true;
  await renderDevices();
}

async function renderMembership() {
  const state = await SDMAuth.getState();
  if (!state) return;
  const mem = state.membership || {};
  $('mem-plan').textContent = mem.planName || (mem.active ? '会员' : '免费');
  $('mem-state').textContent = mem.active ? '● 有效' : (mem.reason === 'EXPIRED' ? '已过期' : '未开通');
  $('mem-expire').textContent = mem.expiresAt ? new Date(mem.expiresAt).toLocaleDateString() : (mem.isLifetime ? '永久' : '—');
  const dev = state.device || {};
  $('mem-devices').textContent = (dev.used != null ? dev.used : '?') + ' / ' + (dev.maxDevices || 3);
  $('mem-expired-note').hidden = !!mem.active;
}

async function renderDevices() {
  const data = await SDMAuth.loadDevices();
  const list = $('devices-list');
  if (!data) { list.innerHTML = '<div class="auth-center">加载失败或无法连接服务器</div>'; return; }
  list.innerHTML = '';
  if (!data.devices.length) { list.innerHTML = '<div class="auth-center">暂无设备</div>'; return; }
  data.devices.forEach(d => {
    const row = document.createElement('div');
    row.className = 'auth-device' + (d.isCurrent ? ' current' : '');
    const sub = (d.browser || '?') + ' / ' + (d.os || '?') + ' · 最近活动 ' + fmtAgo(d.lastSeenAt) + (d.isCurrent ? ' · 当前设备' : '');
    row.innerHTML = '<div class="meta"><div class="name">' + escapeHtml(d.deviceName || '未命名设备') + '</div><div class="sub">' + escapeHtml(sub) + '</div></div>';
    if (!d.isCurrent && d.status === 'ACTIVE') {
      const btn = document.createElement('button');
      btn.textContent = '移除';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const r = await SDMAuth.removeDevice(d.id);
        if (r.ok) { await renderDevices(); await renderAccount(); await renderMembership(); }
        else { alert('移除失败：' + friendlyError(r.error)); btn.disabled = false; }
      });
      row.appendChild(btn);
    }
    list.appendChild(row);
  });
}

async function renderPlans() {
  const plans = await SDMAuth.loadPlans();
  const box = $('plans-list');
  if (!plans.length) { box.innerHTML = '<div class="auth-center">暂无套餐或无法连接服务器</div>'; return; }
  box.innerHTML = '';
  // 购买前引导：先添加管理员（链接来自后台"设置"页 support_telegram_url，随后台更新实时生效）
  const note = document.createElement('div');
  note.className = 'support-note';
  note.innerHTML = '<div class="txt">⚠️ 购买前请先添加管理员，付款后凭订单号联系开通</div>';
  const sbtn = document.createElement('button');
  sbtn.className = 'support-btn';
  sbtn.textContent = '✈ 添加管理员（Telegram）';
  sbtn.addEventListener('click', async () => {
    const sup = await SDMAuth.getSupportInfo();
    const url = sup.ok && sup.data && sup.data.telegramUrl;
    if (url) { window.open(url, '_blank'); }
    else { alert('管理员尚未配置客服链接，请通过其他方式联系管理员'); }
  });
  note.appendChild(sbtn);
  box.appendChild(note);
  plans.forEach(p => {
    const row = document.createElement('div');
    row.className = 'auth-kv';
    row.innerHTML = '<span>' + escapeHtml(p.name) + '（' + (p.durationDays ? p.durationDays + ' 天' : '永久') + '）</span><b>' + (p.priceCents / 100).toFixed(0) + ' ' + escapeHtml(p.currency || 'USDT') + '</b>';
    const btn = document.createElement('button');
    btn.className = 'ghost'; btn.textContent = '购买'; btn.style.marginLeft = '8px';
    btn.addEventListener('click', () => doCheckout(p.id));
    row.appendChild(btn);
    box.appendChild(row);
  });
}

// 钱包支付上下文（当前订单 + 收款地址）
let WALLET_CTX = null;

async function doCheckout(planId) {
  const r = await SDMAuth.createCheckout(planId);
  if (!r.ok) { alert(friendlyError(r.error)); return; }
  const order = r.data || {};
  // 优先展示钱包支付（地址 + 二维码）；钱包信息不可用时退回打开支付页
  const w = await SDMAuth.getWalletInfo();
  if (!w.ok) {
    if (order.checkoutUrl) { window.open(order.checkoutUrl, '_blank'); return; }
    alert(friendlyError(w.error)); return;
  }
  const addr = (w.data.address || '').trim();
  if (!addr) {
    if (order.checkoutUrl) { window.open(order.checkoutUrl, '_blank'); return; }
    alert('服务器未配置收款地址'); return;
  }
  WALLET_CTX = { orderId: order.orderId || null, address: addr };
  $('wallet-network').textContent = w.data.network || 'USDT (TRC-20)';
  $('wallet-qr').src = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' + encodeURIComponent(addr);
  $('wallet-amount').textContent = order.amountCents != null
    ? ('应付 ' + (order.amountCents / 100).toFixed(0) + ' ' + (order.currency || 'USDT'))
    : '按套餐价格转账';
  $('wallet-order').textContent = order.orderId ? ('订单号 ' + order.orderId) : '';
  $('wallet-addr').textContent = addr;
  const msg = $('wallet-msg');
  msg.textContent = ''; msg.className = 'auth-msg';
  const panel = $('wallet-panel');
  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  log('info', '已显示钱包支付信息，转账完成后点击「我已支付·刷新会员」');
}

function initAuthUI() {
  // tabs
  $('tab-login').addEventListener('click', () => {
    AUTH_MODE.mode = 'login';
    $('tab-login').classList.add('active'); $('tab-register').classList.remove('active');
    $('auth-submit').textContent = '登录'; setAuthMsg('', '');
  });
  $('tab-register').addEventListener('click', () => {
    AUTH_MODE.mode = 'register';
    $('tab-register').classList.add('active'); $('tab-login').classList.remove('active');
    $('auth-submit').textContent = '注册'; setAuthMsg('', '');
  });
  $('auth-submit').addEventListener('click', doAuthSubmit);

  // 会员面板关闭 / 展开
  document.querySelectorAll('.auth-close').forEach(b => {
    b.addEventListener('click', () => { const id = b.getAttribute('data-close'); if (id) $(id).hidden = true; });
  });
  // 激活 License / 续费
  $('mem-activate').addEventListener('click', () => { $('license-box').hidden = !$('license-box').hidden; $('plans-box').hidden = true; });
  $('license-submit').addEventListener('click', async () => {
    const key = $('license-key').value.trim();
    if (!key) { setLicMsg('请输入 License Key', 'err'); return; }
    setLicMsg('激活中…', '');
    const r = await SDMAuth.activateLicense(key);
    if (!r.ok) { setLicMsg(friendlyError(r.error), 'err'); return; }
    setLicMsg('激活成功，会员已生效', 'ok');
    $('license-key').value = ''; $('license-box').hidden = true;
    await renderAccount(); await renderMembership();
  });
  $('mem-renew').addEventListener('click', async () => {
    $('plans-box').hidden = !$('plans-box').hidden; $('license-box').hidden = true;
    if (!$('plans-box').hidden) await renderPlans();
  });

  // 钱包支付：复制地址 / 已支付刷新
  $('wallet-copy').addEventListener('click', async () => {
    if (!WALLET_CTX || !WALLET_CTX.address) return;
    const addr = WALLET_CTX.address;
    try { await navigator.clipboard.writeText(addr); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = addr;
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) {}
      document.body.removeChild(ta);
    }
    const b = $('wallet-copy'); b.textContent = '已复制 ✓';
    setTimeout(() => { b.textContent = '复制钱包地址'; }, 1500);
  });
  $('wallet-paid').addEventListener('click', async () => {
    const b = $('wallet-paid'); b.disabled = true;
    const msg = $('wallet-msg');
    msg.className = 'auth-msg';
    msg.textContent = '正在刷新会员状态…';
    const s = await SDMAuth.getState();
    if (s) { await SDMAuth.syncMe(s); await renderMembership(); await renderAccount(); }
    b.disabled = false;
    const st = await SDMAuth.getState();
    if (st && st.membership && st.membership.active) {
      msg.className = 'auth-msg ok';
      msg.textContent = '会员已生效，感谢支持！';
    } else {
      msg.textContent = '会员暂未生效：转账后需管理员确认到账，确认后自动开通，可稍后再点刷新。';
    }
  });

  // 刷新状态按钮（动态加入会员面板按钮行，仅一次）
  const row = document.querySelector('#membership-panel .auth-btn-row');
  if (row && !row.querySelector('#mem-refresh')) {
    const b = document.createElement('button');
    b.id = 'mem-refresh'; b.className = 'ghost'; b.textContent = '刷新状态';
    b.addEventListener('click', async () => {
      const s = await SDMAuth.getState();
      if (s) { await SDMAuth.syncMe(s); await renderMembership(); await renderAccount(); }
    });
    row.appendChild(b);
  }

  // 设备面板：点击外部按钮展开已由 renderAccount 绑定；此处无需额外处理
  renderAccount();
}

initAuthUI();

// 打开插件时强制向服务器同步一次登录/会员/设备状态：
// 管理员在后台撤销会员、封禁等操作，用户一打开插件界面即刻反映，无需手动点刷新
(async function syncOnOpen() {
  const s = await SDMAuth.getState();
  if (!(s && s.accessToken)) return;
  const before = s.lastVerifiedAt || 0;
  const after = await SDMAuth.syncMe(s);
  if ((after && after.lastVerifiedAt || 0) !== before) {
    await renderAccount();
    await renderMembership();
  }
})();
