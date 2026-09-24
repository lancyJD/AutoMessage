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
