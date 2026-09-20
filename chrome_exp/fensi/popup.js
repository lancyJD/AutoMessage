// ============== IG 粉丝提取器 - Popup ==============

function bg(action, data = {}) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action, ...data }, response => {
      resolve(response || { success: false, error: '无响应' });
    });
  });
}

const CHUNK_SIZE = 1000;   // 每块抓取数量（分块避免 Service Worker 超时）
const PREVIEW_MAX = 200;   // 列表最多预览条数

const App = {
  profile: null,
  usernames: [],
  seen: new Set(),
  dupCount: 0,
  target: 0,        // 目标数量，0 = 无限（抓完为止）
  running: false,
  stopped: false,
  sessionId: null,  // 本轮提取的唯一标识，用于停止控制 + 进度归属
  port: null,       // 与 background 的长连接，用于感知弹窗关闭
  lastCursor: null,
  baseCount: 0,     // 当前块开始前的累计数量
  chunkDone: 0,     // 当前块已抓取数量
  startTime: 0,
  logs: [],
  logSaved: false,
  hideFollowers: false,
  mode: 'followers',

  $: (id) => document.getElementById(id),

  async init() {
    // 恢复上次输入
    const saved = await chrome.storage.local.get(['igx_user', 'igx_count', 'igx_hide_followers', 'igx_interaction_user', 'igx_post_count', 'igx_per_post_comment_limit']);
    if (saved.igx_user) this.$('input-user').value = saved.igx_user;
    if (saved.igx_count) this.$('input-count').value = saved.igx_count;
    this.hideFollowers = saved.igx_hide_followers === true;
    this.$('hide-followers').checked = this.hideFollowers;
    if (saved.igx_interaction_user) this.$('interaction-user').value = saved.igx_interaction_user;
    if (saved.igx_post_count) this.$('post-count').value = saved.igx_post_count;
    if (saved.igx_per_post_comment_limit != null) this.$('per-post-comment-limit').value = saved.igx_per_post_comment_limit;

    this.$('btn-extract').addEventListener('click', () => this.startExtract());
    this.$('mode-followers').addEventListener('click', () => this.setMode('followers'));
    this.$('mode-interactions').addEventListener('click', () => this.setMode('interactions'));
    this.$('start-interactions').addEventListener('click', () => this.startInteractionExtract());
    this.$('btn-stop-interactions').addEventListener('click', () => this.stopExtract());
    this.$('btn-stop').addEventListener('click', () => this.stopExtract());
    this.$('btn-download').addEventListener('click', () => this.downloadTxt());
    this.$('btn-copy').addEventListener('click', () => this.copyUsernames(0));
    this.$('btn-copy-100').addEventListener('click', () => this.copyUsernames(100));
    this.$('btn-clear').addEventListener('click', () => this.clearResult());
    this.$('hide-followers').addEventListener('change', event => this.setFollowersHidden(event.target.checked));
    this.$('open-instagram').addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://www.instagram.com/' });
    });

    this.$('input-user').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.startExtract();
    });
    this.$('input-count').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.startExtract();
    });

    // 监听页面回传的抓取进度
    // 关键：只接受「本轮会话」的消息。否则上次残留的页面脚本会继续广播进度，
    // 重开弹窗时会误显示成"还在提取中"。
    chrome.runtime.onMessage.addListener(msg => {
      if (!msg || !['extract-progress', 'extract-log'].includes(msg.action)) return;
      if (!this.running || !this.sessionId) return;
      if (msg.sessionId && msg.sessionId !== this.sessionId) return;
      if (msg.action === 'extract-log') {
        this.addLog(msg.message || '收到空日志', msg.level || 'info');
        return;
      }
      this.chunkDone = msg.done || 0;
      this.updateProgress();
    });

    // 弹窗关闭/隐藏时断开长连接，background 收到 onDisconnect 会立即停止本轮抓取
    window.addEventListener('pagehide', () => this.teardownPort());

    await this.restoreInterrupted();
    await this.checkLogin();
  },

  setMode(mode) {
    this.mode = mode === 'interactions' ? 'interactions' : 'followers';
    const interactions = this.mode === 'interactions';
    this.$('mode-followers').setAttribute('aria-selected', String(!interactions));
    this.$('mode-interactions').setAttribute('aria-selected', String(interactions));
    this.$('followers-panel').hidden = interactions;
    this.$('interactions-panel').hidden = !interactions;
    this.hideMsg();
  },

  async startInteractionExtract() {
    if (this.running) return;
    const username = this.$('interaction-user').value.trim().replace(/^@+/, '');
    const postCount = parseInt(this.$('post-count').value, 10);
    const rawPerPostLimit = this.$('per-post-comment-limit').value.trim();
    const perPostLimit = rawPerPostLimit === '' ? 0 : parseInt(rawPerPostLimit, 10);
    if (!username) return this.showMsg('请输入博主用户名', 'error');
    if (!Number.isInteger(postCount) || postCount < 1) {
      return this.showMsg('帖子数量必须是正整数', 'error');
    }
    if (!Number.isInteger(perPostLimit) || perPostLimit < 0) {
      return this.showMsg('每个帖子提取数量必须是 0 或正整数', 'error');
    }
    if (!this.$('collect-comments').checked) return this.showMsg('请至少选择“获取评论用户”', 'error');
    if (typeof IGX_CONFIG === 'undefined' || IGX_CONFIG.AUTH_ENABLED !== false) {
      try {
        const guard = await IGXAuth.requireMembership();
        if (!guard.ok) { this.blockExtract(guard.reason, guard.offline); return; }
      } catch (e) {
        return this.showMsg('⛔ 会员校验异常，已阻止提取：' + (e && e.message), 'error');
      }
    }

    await chrome.storage.local.set({
      igx_interaction_user: username,
      igx_post_count: postCount,
      igx_per_post_comment_limit: rawPerPostLimit
    });
    this.sessionId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await chrome.storage.local.set({ igx_stop: null, igx_buffer: [], igx_state: null });
    try { await bg('clear-stop'); } catch (e) {}
    this.openPort(this.sessionId);
    this.running = true;
    this.stopped = false;
    this.usernames = [];
    this.seen = new Set();
    this.dupCount = 0;
    this.target = 0;
    this.startTime = Date.now();
    this.profile = { username, followerCount: 0 };
    this.resetExecutionLog(username);
    this.addLog(`当前博主 @${username}`);
    this.addLog(`准备查询最新 ${postCount} 个帖子`);
    this.addLog(perPostLimit > 0 ? `每个帖子最多提取 ${perPostLimit} 个评论用户` : '每个帖子提取全部评论用户');
    this.$('stat-total-label').textContent = '已处理帖子';
    this.$('stat-total').textContent = '0/' + postCount;
    this.setRunning(true);
    this.hideMsg();
    this.hideResult();
    this.updateProgress('正在查询帖子…');

    try {
      const postsRes = await bg('resolve-recent-posts', { username, limit: postCount, sessionId: this.sessionId });
      if (!postsRes.success) throw new Error(postsRes.error || '查询帖子失败');
      if (postsRes.stopped || this.stopped) {
        await this.saveBuffer(false);
        this.updateProgress('已手动停止', true);
        this.addLog('查询帖子时已停止，保留当前结果', 'warn');
        await this.saveExecutionLog('stopped');
        this.renderResult();
        this.showResult();
        this.showMsg('⏹ 已停止，可保存当前已获取的结果', 'info');
        return;
      }
      const posts = postsRes.posts || [];
      this.addLog(`查询到 ${posts.length} 个帖子`, 'success');
      if (posts.length < postCount) this.addLog(`账号公开帖子不足 ${postCount} 个`, 'warn');
      this.updateProgress(`正在获取 ${posts.length} 个帖子的评论用户…`);

      const result = await bg('extract-comment-users', {
        mediaIds: posts.map(post => post.mediaId), sessionId: this.sessionId, perPostLimit
      });
      if (!result.success) throw new Error(result.error || '评论用户采集失败');
      this.usernames = (result.users || []).map(user => user.username).filter(Boolean);
      this.seen = new Set(this.usernames);
      this.dupCount = Number(result.duplicateCount || 0);
      this.$('stat-total').textContent = `${result.processedPosts || 0}/${posts.length}`;
      await this.saveBuffer(!result.stopped);
      this.updateProgress(result.stopped ? '已手动停止' : '评论用户采集完成', true);
      this.addLog(`评论用户采集完成，共 ${this.usernames.length} 人，去重 ${this.dupCount} 条`, 'success');
      await this.saveExecutionLog(result.stopped ? 'stopped' : 'completed');
      this.renderResult();
      this.showResult();
      this.showMsg(
        result.stopped
          ? `⏹ 已停止，已保留 ${this.usernames.length} 个评论用户，可保存 TXT`
          : `✓ 已从 ${result.processedPosts || 0} 个帖子获取 ${this.usernames.length} 个评论用户`,
        result.stopped ? 'info' : 'success'
      );
    } catch (error) {
      this.addLog(`采集失败：${error.message || error}`, 'error');
      await this.saveExecutionLog('failed');
      this.showMsg('✗ ' + (error.message || error), 'error');
    } finally {
      this.endRun();
    }
  },

  // ============== 会话 / 停止控制 ==============

  // 建立与 background 的长连接，用于感知弹窗关闭
  openPort(sessionId) {
    this.teardownPort();
    try {
      this.port = chrome.runtime.connect({ name: 'igx-extract' });
      this.port.postMessage({ action: 'register', sessionId });
    } catch (e) {
      this.port = null;
    }
  },

  teardownPort() {
    try { if (this.port) this.port.disconnect(); } catch (e) {}
    this.port = null;
  },

  // 每块抓完落地一次，弹窗意外关闭也不丢数据
  async saveBuffer(completed = false) {
    try {
      await chrome.storage.local.set({
        igx_buffer: this.usernames,
        igx_state: {
          sessionId: this.sessionId,
          running: this.running,
          stopped: this.stopped,
          completed,
          profile: this.profile,
          target: this.target,
          dupCount: this.dupCount,
          cursor: this.lastCursor,
          at: Date.now()
        }
      });
    } catch (e) {}
  },

  // 恢复上次被中断（弹窗关闭 / 扩展重载）的结果
  async restoreInterrupted() {
    const st = await chrome.storage.local.get(['igx_state', 'igx_buffer']);
    const state = st.igx_state;
    const buf = st.igx_buffer;

    // 上次会话还标着 running，说明弹窗是被强制关闭/重载的，
    // Instagram 页面里的脚本很可能还在空跑 -> 立刻把那个会话标记为停止，让它自杀
    if (state && state.running && state.sessionId) {
      await chrome.storage.local.set({ igx_stop: state.sessionId });
      await chrome.storage.local.set({ igx_state: { ...state, running: false } });
    } else {
      // 没有残留会话，清掉可能遗留的停止标志，避免下一轮一开始就被判停
      await chrome.storage.local.set({ igx_stop: null });
    }

    if (!state || !Array.isArray(buf) || buf.length === 0) return;

    this.profile = state.profile || null;
    this.usernames = buf;
    this.seen = new Set(buf);
    this.dupCount = state.dupCount || 0;
    this.target = state.target || 0;
    this.lastCursor = state.cursor || null;

    if (this.profile) {
      this.$('stat-total').textContent = this.profile.followerCount > 0
        ? this.profile.followerCount.toLocaleString('en-US')
        : '未知';
      if (!this.$('input-user').value) {
        this.$('input-user').value = this.profile.username || '';
      }
    }

    const n = buf.length.toLocaleString('en-US');
    this.renderResult();
    this.showResult();
    this.showMsg(
      state.completed
        ? `已保留上次的提取结果：${n} 个用户名`
        : `⏸ 上次提取被中断，已保留 ${n} 个用户名，可直接保存或重新开始`,
      'info'
    );
  },

  // ============== 登录检测 ==============

  async checkLogin() {
    try {
      const res = await bg('check-login');
      const loggedIn = !!(res && res.loggedIn);
      this.$('login-notice').classList.toggle('show', !loggedIn);
      return loggedIn;
    } catch (e) {
      this.$('login-notice').classList.add('show');
      return false;
    }
  },

  // ============== 主流程 ==============

  async startExtract() {
    if (this.running) return;
    this.mode = 'followers';
    this.$('stat-total-label').textContent = '博主粉丝总数';

    // ===== 会员守卫：未登录 / 会员失效 / 设备超限 一律在此拦截（核心功能唯一校验点）=====
    if (typeof IGX_CONFIG === 'undefined' || IGX_CONFIG.AUTH_ENABLED !== false) {
      try {
        const guard = await IGXAuth.requireMembership();
        if (!guard.ok) { this.blockExtract(guard.reason, guard.offline); return; }
        if (guard.offline) this.toast('离线宽限模式（服务器暂不可达），会员状态为上次校验结果');
      } catch (e) {
        this.showMsg('⛔ 会员校验异常，已阻止提取：' + (e && e.message), 'error');
        return;
      }
    }

    const rawUser = this.$('input-user').value.trim().replace(/^@+/, '');
    const rawCount = this.$('input-count').value.trim();
    const count = rawCount === '' ? 0 : parseInt(rawCount, 10);

    if (!rawUser) return this.showMsg('请输入博主用户名', 'error');
    if (rawCount !== '' && (isNaN(count) || count < 0)) {
      return this.showMsg('提取数量必须是 0 或正整数', 'error');
    }

    // 保存输入
    await chrome.storage.local.set({ igx_user: rawUser, igx_count: rawCount });

    // 新一轮：生成会话 ID，清掉停止标志与旧结果
    this.sessionId = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await chrome.storage.local.set({ igx_stop: null, igx_buffer: [], igx_state: null });
    try { await bg('clear-stop'); } catch (e) {}

    // 建立长连接：弹窗一关，background 立刻把本会话标记为停止
    this.openPort(this.sessionId);

    this.running = true;
    this.stopped = false;
    this.usernames = [];
    this.seen = new Set();
    this.dupCount = 0;
    this.target = count > 0 ? count : 0;
    this.lastCursor = null;
    this.baseCount = 0;
    this.chunkDone = 0;
    this.startTime = 0;
    this.resetExecutionLog(rawUser);
    this.addLog(`当前博主 @${rawUser}`);
    this.addLog('正在解析博主主页…');

    const stopBtn = this.$('btn-stop');
    stopBtn.disabled = false;
    stopBtn.textContent = '停止';

    this.setRunning(true);
    this.hideMsg();
    this.hideResult();
    this.updateProgress('正在解析博主信息...');

    // 第 1 步：解析博主
    const resolveRes = await bg('resolve-profile', { username: rawUser });
    if (!resolveRes.success || this.stopped) {
      this.addLog(this.stopped ? '已取消解析博主' : `解析失败：${resolveRes.error || '未知错误'}`, 'error');
      this.saveExecutionLog(this.stopped ? 'stopped' : 'failed');
      this.endRun();
      if (!resolveRes.success) this.showMsg('✗ ' + resolveRes.error, 'error');
      else this.showMsg('⏹ 已取消', 'info');
      return;
    }

    this.profile = resolveRes.profile;
    this.$('stat-total').textContent = this.profile.followerCount > 0
      ? this.profile.followerCount.toLocaleString('en-US')
      : '未知';

    this.updateProgress(`已找到 @${this.profile.username}，开始提取粉丝...`);
    this.addLog(`已解析博主 ID：${this.profile.userId}`, 'success');
    this.addLog('开始请求粉丝列表');

    // 第 2 步：分块抓取
    await this.extractLoop();

    this.endRun();
  },

  // 停止：把标志写进 storage，页面内的抓取循环每 300ms 检查一次，
  // 不再需要等当前 1000 个抓完（原来要等 15~30 秒）
  async stopExtract() {
    if (!this.running || this.stopped) return;
    this.stopped = true;
    this.addLog('收到停止请求，正在结束当前页…', 'warn');

    const btn = this.$('btn-stop');
    btn.disabled = true;
    btn.textContent = '停止中...';
    const interactionBtn = this.$('btn-stop-interactions');
    interactionBtn.disabled = true;
    interactionBtn.textContent = '停止中...';
    this.updateProgress('正在停止...');

    try { await chrome.storage.local.set({ igx_stop: this.sessionId }); } catch (e) {}
    try { await bg('stop-extraction', { sessionId: this.sessionId }); } catch (e) {}

    // 当前块返回后 extractLoop 会自然退出并走 finishExtract
  },

  endRun() {
    this.running = false;
    this.teardownPort();
    this.setRunning(false);
    this.$('btn-stop').disabled = false;
    this.$('btn-stop').textContent = '停止';
    this.$('btn-stop-interactions').disabled = false;
    this.$('btn-stop-interactions').textContent = '停止';
  },

  // 会员校验不通过时：提示原因并引导到登录页 / 会员面板
  blockExtract(reason, offline) {
    const map = {
      NOT_LOGGED_IN: '请先登录后再使用提取功能。',
      MEMBERSHIP_REQUIRED: '本功能需要有效会员，请先购买或激活 License。',
      MEMBERSHIP_EXPIRED: '您的会员已到期，请续费后继续使用。',
      SESSION_EXPIRED: '登录已失效，请重新登录。',
      OFFLINE_GRACE_EXPIRED: '离线已超过宽限期，请联网后重新验证会员状态。',
      ACCOUNT_BANNED: '账号已被封禁，请联系客服。',
      ACCOUNT_SUSPENDED: '账号已被暂停，请联系客服。',
      MAX_DEVICES_REACHED: '设备数量已达上限，请先在其他设备退出登录后再试。',
    };
    this.showMsg('⛔ ' + (map[reason] || ('当前无法使用提取功能（' + reason + '）')), 'error');
    if (reason === 'NOT_LOGGED_IN' || reason === 'SESSION_EXPIRED') {
      showAuthView(true);
    } else {
      openMembershipPanel();
    }
  },

  async extractLoop() {
    let cursor = null;
    this.startTime = Date.now();

    while (!this.stopped) {
      // 计算本次要抓的数量
      let want = CHUNK_SIZE;
      if (this.target > 0) {
        const remain = this.target - this.usernames.length;
        if (remain <= 0) break;
        want = Math.min(CHUNK_SIZE, remain);
      }

      this.baseCount = this.usernames.length;
      this.chunkDone = 0;

      const res = await bg('extract-followers', {
        userId: this.profile.userId,
        chunkSize: want,
        cursor,
        sessionId: this.sessionId
      });

      // 合并本块结果（即使已停止也保留，不白抓）
      if (res.success && Array.isArray(res.users)) {
        for (const u of res.users) {
          const name = u.username;
          if (!name) continue;
          if (this.seen.has(name)) { this.dupCount++; continue; }
          this.seen.add(name);
          this.usernames.push(name);
        }
        this.lastCursor = res.cursor || null;
        await this.saveBuffer(false);
      }

      if (this.stopped) break;
      if (!res.success) { this.showMsg('✗ ' + res.error, 'error'); break; }
      if (res.stopped) break;                                  // 页面内循环被停止
      if ((res.users || []).length === 0) break;               // 没有更多数据
      if (!res.hasNext) break;
      if (this.target > 0 && this.usernames.length >= this.target) break;

      cursor = res.cursor;
    }

    await this.saveBuffer(!this.stopped);
    this.finishExtract();
  },

  finishExtract() {
    const total = this.usernames.length;
    this.updateProgress(this.stopped ? '已手动停止' : '提取完成', true);
    this.$('progress-rate').textContent = '';

    if (total === 0) {
      this.addLog('未提取到粉丝', 'warn');
      this.saveExecutionLog(this.stopped ? 'stopped' : 'completed');
      this.showMsg('未提取到任何用户名。请确认已登录 Instagram，且该博主存在。', 'error');
      return;
    }

    if (this.stopped) {
      this.showMsg(`⏹ 已停止，共提取到 ${total.toLocaleString('en-US')} 个用户名`, 'info');
    } else if (this.target > 0 && total < this.target) {
      this.showMsg(
        `✓ 提取结束，共 ${total.toLocaleString('en-US')} 个（目标 ${this.target.toLocaleString('en-US')} 个，该博主粉丝不足或无更多公开粉丝）`,
        'success'
      );
    } else {
      this.showMsg(`✓ 提取完成，共 ${total.toLocaleString('en-US')} 个用户名`, 'success');
    }

    this.addLog(this.stopped ? `采集已停止，共 ${total} 人` : `采集完成，共 ${total} 人`, this.stopped ? 'warn' : 'success');
    this.saveExecutionLog(this.stopped ? 'stopped' : 'completed');

    this.renderResult();
    this.showResult();
  },

  // ============== UI 更新 ==============

  updateProgress(text, done = false) {
    const area = this.$('progress-area');
    area.classList.add('show');

    const total = this.baseCount + this.chunkDone;
    const fill = this.$('progress-fill');

    if (this.target > 0) {
      const pct = Math.min(100, (total / this.target) * 100);
      fill.style.width = pct.toFixed(1) + '%';
    } else if (this.profile && this.profile.followerCount > 0) {
      const pct = Math.min(100, (total / this.profile.followerCount) * 100);
      fill.style.width = pct.toFixed(1) + '%';
    } else if (done) {
      fill.style.width = '100%';
    } else {
      // 未知总数：按耗时单调递增爬升（不会回跳），封顶 92% 表示仍在进行
      const sec = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
      const pct = Math.min(92, 8 + 84 * (1 - Math.exp(-sec / 60)));
      fill.style.width = pct.toFixed(1) + '%';
    }

    if (text) this.$('progress-text').textContent = text;
    else {
      const targetTxt = this.target > 0
        ? ` / ${this.target.toLocaleString('en-US')}`
        : (this.profile && this.profile.followerCount > 0 ? ` / ${this.profile.followerCount.toLocaleString('en-US')}` : '');
      this.$('progress-text').textContent = `已提取 ${total.toLocaleString('en-US')}${targetTxt}`;
    }

    // 速率
    if (!done && this.startTime) {
      const sec = (Date.now() - this.startTime) / 1000;
      if (sec > 1) {
        const rate = (total / sec).toFixed(1);
        const eta = this.target > 0 && total > 0
          ? ` · 预计剩余 ${Math.max(0, Math.round((this.target - total) / (total / sec)))} 秒`
          : '';
        this.$('progress-rate').textContent = `${rate} 个/秒${eta}`;
      }
    }
  },

  renderResult() {
    this.$('stat-extracted').textContent = this.usernames.length.toLocaleString('en-US');
    this.$('stat-dup').textContent = this.dupCount.toLocaleString('en-US');

    const list = this.$('user-list');
    if (this.hideFollowers) {
      list.innerHTML = '<div class="u-hidden">粉丝列表已隐藏</div>';
      this.$('list-count').textContent = `共 ${this.usernames.length.toLocaleString('en-US')} 个（已隐藏）`;
      return;
    }
    const preview = this.usernames.slice(0, PREVIEW_MAX);
    let html = preview.map((u, i) =>
      `<div class="u-item"><span class="u-idx">${i + 1}.</span><span class="u-name">@${this.esc(u)}</span></div>`
    ).join('');

    if (this.usernames.length > PREVIEW_MAX) {
      html += `<div class="u-more">... 还有 ${(this.usernames.length - PREVIEW_MAX).toLocaleString('en-US')} 个未显示</div>`;
    }
    list.innerHTML = html;
    this.$('list-count').textContent = `共 ${this.usernames.length.toLocaleString('en-US')} 个`;
  },

  async clearResult() {
    this.usernames = [];
    this.seen = new Set();
    this.dupCount = 0;
    this.profile = null;
    this.lastCursor = null;
    await chrome.storage.local.set({ igx_buffer: [], igx_state: null });
    this.hideResult();
    this.hideMsg();
    this.$('progress-area').classList.remove('show');
    this.$('execution-log').classList.remove('show');
    this.$('progress-fill').style.width = '0%';
    this.$('stat-total').textContent = '-';
    this.toast('结果已清空');
  },

  setRunning(running) {
    const btn = this.$('btn-extract');
    const stop = this.$('btn-stop');
    const interactionStop = this.$('btn-stop-interactions');
    btn.disabled = running;
    btn.textContent = running ? '提取中...' : '开始提取';
    stop.style.display = running ? 'block' : 'none';
    interactionStop.style.display = running && this.mode === 'interactions' ? 'block' : 'none';
    this.$('input-user').disabled = running;
    this.$('input-count').disabled = running;
    this.$('start-interactions').disabled = running;
    this.$('start-interactions').textContent = running && this.mode === 'interactions' ? '获取中...' : '开始获取评论用户';
    this.$('interaction-user').disabled = running;
    this.$('post-count').disabled = running;
    this.$('per-post-comment-limit').disabled = running;
  },

  showResult() { this.$('result-area').classList.add('show'); },
  hideResult() { this.$('result-area').classList.remove('show'); },

  showMsg(text, type) {
    const box = this.$('msg-box');
    box.textContent = text;
    box.className = 'msg-box show ' + type;
  },
  hideMsg() { this.$('msg-box').className = 'msg-box'; },

  async setFollowersHidden(hidden) {
    this.hideFollowers = hidden;
    await chrome.storage.local.set({ igx_hide_followers: hidden });
    if (this.usernames.length) this.renderResult();
  },

  resetExecutionLog(username) {
    this.logs = [];
    this.logSaved = false;
    this.$('execution-log').classList.add('show');
    this.$('execution-log-profile').textContent = username ? `当前博主 @${username}` : '';
    this.$('execution-log-list').replaceChildren();
  },

  addLog(message, level = 'info') {
    const now = new Date();
    const time = now.toLocaleTimeString('zh-CN', { hour12: false });
    const entry = { time, message: String(message), level };
    this.logs.push(entry);
    if (this.logs.length > 300) this.logs.shift();

    const list = this.$('execution-log-list');
    const line = document.createElement('div');
    line.className = `execution-log-line ${level}`;
    const stamp = document.createElement('span');
    stamp.className = 'execution-log-time';
    stamp.textContent = time;
    const text = document.createElement('span');
    text.textContent = entry.message;
    line.append(stamp, text);
    list.appendChild(line);
    while (list.children.length > 300) list.firstChild.remove();
    list.scrollTop = list.scrollHeight;
  },

  async saveExecutionLog(outcome) {
    if (this.logSaved || !this.logs.length) return;
    this.logSaved = true;
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const clock = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const username = ((this.profile && this.profile.username) || (this.mode === 'interactions' ? this.$('interaction-user').value : this.$('input-user').value) || 'unknown')
      .replace(/[\\/:*?"<>|]/g, '_');
    const content = [
      `博主：@${username}`,
      `结果：${outcome}`,
      ...this.logs.map(log => `${log.time} ${log.message}`),
      ''
    ].join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    try {
      await chrome.downloads.download({
        url,
        filename: `${this.mode === 'interactions' ? 'IG-comment-logs' : 'IG-follower-logs'}/${date}/${clock}_${username}.log`,
        saveAs: false,
        conflictAction: 'uniquify'
      });
    } catch (error) {
      this.logSaved = false;
      this.addLog(`日志文件保存失败：${error.message || error}`, 'error');
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  },

  // ============== 导出 ==============

  buildText(limit = 0) {
    const arr = limit > 0 ? this.usernames.slice(0, limit) : this.usernames;
    return arr.join('\n');
  },

  downloadTxt() {
    if (!this.usernames.length) return this.toast('暂无可保存的数据');

    const name = (this.profile && this.profile.username) || (this.mode === 'interactions' ? this.$('interaction-user').value : this.$('input-user').value).trim().replace(/^@+/, '') || 'followers';
    const ts = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}`;
    const filename = this.mode === 'interactions'
      ? `评论用户_${name}_${this.usernames.length}个_${stamp}.txt`
      : `IG_${name}_粉丝${this.usernames.length}个_${stamp}.txt`;

    const content = this.buildText();
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);

    this.toast(`已保存 ${filename}`);
  },

  async copyUsernames(limit = 0) {
    if (!this.usernames.length) return this.toast('暂无可复制的数据');
    const text = this.buildText(limit);

    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (e) {
      // 回退方案
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch (e2) { ok = false; }
    }

    this.toast(ok
      ? `已复制 ${limit > 0 ? Math.min(limit, this.usernames.length) : this.usernames.length} 个用户名`
      : '复制失败，请手动选择');
  },

  // ============== 工具 ==============

  toast(msg) {
    const el = this.$('toast');
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.style.display = 'none'; }, 2600);
  },

  esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());

/* =========================================================================
 * 会员系统 UI（新增，独立于上方提取逻辑）
 * ======================================================================= */

const $ = (id) => document.getElementById(id); // 会员 UI 用的快捷选择器（提取逻辑用 App.$）

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
    MAX_DEVICES_REACHED: '设备数量已达上限，请先在其他设备退出登录后再试',
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
  const authView = $('auth-view');
  const appView = $('app-view');
  if (authView) authView.hidden = !show;
  // 账户 UI 已从页面去掉时，始终展示提取主体
  if (appView) appView.hidden = !!(show && authView);
  if (show) {
    ['membership-panel', 'devices-panel', 'wallet-panel'].forEach(id => {
      const el = $(id);
      if (el) el.hidden = true;
    });
  }
}

function mkBtn(text, cls, onClick) {
  const b = document.createElement('button');
  b.className = cls || 'auth-link';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

async function renderAccount() {
  const state = await IGXAuth.getState();
  const actions = $('auth-actions');
  const status = $('auth-status');
  if (!actions || !status) return;
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
  await IGXAuth.logout();
  try { chrome.runtime.sendMessage({ type: 'IGX_STOP_HEARTBEAT' }); } catch (e) {}
  renderAccount();
}

async function doAuthSubmit() {
  const email = $('auth-email').value.trim();
  const pwd = $('auth-password').value;
  if (!email || !pwd) { setAuthMsg('请填写邮箱和密码', 'err'); return; }
  setAuthMsg(AUTH_MODE.mode === 'login' ? '登录中…' : '注册中…', '');
  const res = AUTH_MODE.mode === 'login'
    ? await IGXAuth.login(email, pwd)
    : await IGXAuth.register(email, pwd);
  if (!res.ok) { setAuthMsg(friendlyError(res.error), 'err'); return; }
  setAuthMsg('成功，正在载入…', 'ok');
  try { chrome.runtime.sendMessage({ type: 'IGX_START_HEARTBEAT' }); } catch (e) {}
  await renderAccount();
  await openMembershipPanel();
}

function togglePanel(id) {
  ['membership-panel', 'devices-panel', 'wallet-panel'].forEach(p => {
    const el = $(p);
    if (el && p !== id) el.hidden = true;
  });
  const target = $(id);
  if (target) target.hidden = !target.hidden;
}

async function openMembershipPanel() {
  const panel = $('membership-panel');
  if (!panel) return;
  panel.hidden = false;
  const devices = $('devices-panel');
  if (devices) devices.hidden = true;
  await renderMembership();
}
async function openDevicesPanel() {
  const panel = $('devices-panel');
  if (!panel) return;
  panel.hidden = false;
  const membership = $('membership-panel');
  if (membership) membership.hidden = true;
  await renderDevices();
}

async function renderMembership() {
  if (!$('mem-plan')) return;
  const state = await IGXAuth.getState();
  if (!state) return;
  const mem = state.membership || {};
  $('mem-plan').textContent = mem.planName || (mem.active ? '会员' : '免费');
  $('mem-state').textContent = mem.active ? '● 有效' : (mem.reason === 'EXPIRED' ? '已过期' : '未开通');
  $('mem-expire').textContent = mem.expiresAt ? new Date(mem.expiresAt).toLocaleDateString() : (mem.isLifetime ? '永久' : '—');
  const dev = state.device || {};
  $('mem-devices').textContent = (dev.used != null ? dev.used : '?') + ' / ' + (dev.maxDevices || '?');
  $('mem-expired-note').hidden = !!mem.active;
}

async function renderDevices() {
  const data = await IGXAuth.loadDevices();
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
        const r = await IGXAuth.removeDevice(d.id);
        if (r.ok) { await renderDevices(); await renderAccount(); await renderMembership(); }
        else { alert('移除失败：' + friendlyError(r.error)); btn.disabled = false; }
      });
      row.appendChild(btn);
    }
    list.appendChild(row);
  });
}

async function renderPlans() {
  const plans = await IGXAuth.loadPlans();
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
    const sup = await IGXAuth.getSupportInfo();
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
  const r = await IGXAuth.createCheckout(planId);
  if (!r.ok) { alert(friendlyError(r.error)); return; }
  const order = r.data || {};
  // 优先展示钱包支付（地址 + 二维码）；钱包信息不可用时退回打开支付页
  const w = await IGXAuth.getWalletInfo();
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
}

function initAuthUI() {
  // 账户 / 登录 / 会员 / 钱包 UI 已从页面去掉时，只保留仍存在节点的绑定
  if (!$('auth-view')) {
    document.querySelectorAll('.auth-close').forEach(b => {
      b.addEventListener('click', () => { const id = b.getAttribute('data-close'); if (id && $(id)) $(id).hidden = true; });
    });
    return;
  }

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
    const r = await IGXAuth.activateLicense(key);
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
    const s = await IGXAuth.getState();
    if (s) { await IGXAuth.syncMe(s); await renderMembership(); await renderAccount(); }
    b.disabled = false;
    const st = await IGXAuth.getState();
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
      const s = await IGXAuth.getState();
      if (s) { await IGXAuth.syncMe(s); await renderMembership(); await renderAccount(); }
    });
    row.appendChild(b);
  }

  renderAccount();
}

if (typeof IGX_CONFIG === 'undefined' || IGX_CONFIG.AUTH_ENABLED !== false) {
  initAuthUI();

  // 打开插件时强制向服务器同步一次登录/会员/设备状态：
  // 管理员在后台撤销会员、封禁等操作，用户一打开插件界面即刻反映，无需手动点刷新
  (async function syncOnOpen() {
    const s = await IGXAuth.getState();
    if (!(s && s.accessToken)) return;
    const before = s.lastVerifiedAt || 0;
    const after = await IGXAuth.syncMe(s);
    if ((after && after.lastVerifiedAt || 0) !== before) {
      await renderAccount();
      await renderMembership();
    }
  })();
}
