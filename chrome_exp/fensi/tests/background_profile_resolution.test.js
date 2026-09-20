const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const listeners = { message: [], connect: [], alarm: [] };
const sentMessages = [];
const context = {
  console,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  importScripts() {},
  chrome: {
    tabs: { query: async () => [] },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    runtime: {
      sendMessage(message) { sentMessages.push(message); return Promise.resolve(); },
      onMessage: { addListener(fn) { listeners.message.push(fn); } },
      onConnect: { addListener(fn) { listeners.connect.push(fn); } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
    },
    scripting: {
      async executeScript({ func, args }) { return [{ result: await func(...args) }]; },
    },
    alarms: { create() {}, clear: async () => {}, onAlarm: { addListener(fn) { listeners.alarm.push(fn); } } },
    sidePanel: { setPanelBehavior: async () => {} },
  },
};

vm.createContext(context);
vm.runInContext(
  fs.readFileSync(require.resolve('../background.js'), 'utf8'),
  context,
  { filename: 'background.js' },
);

const profile = context.resolveProfileFromGraphqlData({
  data: {
    profile: {
      user: {
        id: '76144636285',
        username: 'money._.journey',
        full_name: 'Profile Name',
        follower_count: 321,
        profile_pic_url: 'https://example.test/profile.jpg',
      },
    },
  },
}, 'money._.journey');

assert.deepEqual(JSON.parse(JSON.stringify(profile)), {
  userId: '76144636285',
  username: 'money._.journey',
  fullName: 'Profile Name',
  followerCount: 321,
  picUrl: 'https://example.test/profile.jpg',
});

const htmlProfile = context.resolveProfileFromHtml(`
  <meta property="og:title" content="Profile Name (@money._.journey) · Instagram" />
  <meta property="og:image" content="https://example.test/profile.jpg" />
  <script>{"profile_id":"76144636285","edge_followed_by":{"count":321}}</script>
`, 'money._.journey');

assert.deepEqual(JSON.parse(JSON.stringify(htmlProfile)), {
  userId: '76144636285',
  username: 'money._.journey',
  fullName: 'Profile Name',
  followerCount: 321,
  picUrl: 'https://example.test/profile.jpg',
});

assert.deepEqual(JSON.parse(JSON.stringify(context.describeNextMaxId('1048|QVFEcU9Jb2g='))), {
  raw: '1048|QVFEcU9Jb2g=',
  numericPrefix: '1048',
});
assert.deepEqual(JSON.parse(JSON.stringify(context.describeNextMaxId(null))), {
  raw: null,
  numericPrefix: null,
});

context.fetch = async () => ({
  status: 200,
  json: async () => ({ users: [{ id: '1', username: 'one', full_name: 'One' }], next_max_id: null }),
});

(async () => {
  let requestedUrl = '';
  context.fetch = async (url, options) => {
    requestedUrl = String(url);
    assert.equal(options.credentials, 'include');
    return {
      status: 200,
      json: async () => ({
        users: [{ id: '1', username: 'one', full_name: 'One' }],
        next_max_id: null,
        should_limit_list_of_followers: true,
        has_more: false,
      }),
    };
  };
  const page = await context.fetchFollowersPageInMainWorld('76144636285', '12');
  assert.equal(page.status, 200);
  assert.equal(page.users.length, 1);
  assert.equal(page.shouldLimitListOfFollowers, true);
  assert.equal(page.hasMore, false);
  assert.equal(page.nextMaxId, null);
  assert.match(requestedUrl, /friendships\/76144636285\/followers/);
  assert.match(requestedUrl, /max_id=12/);

  sentMessages.length = 0;
  const mainWorldResult = await context.extractFollowersInMainWorld('tab-1', '76144636285', 1, null, 'session-main');
  assert.equal(mainWorldResult.users.length, 1);
  assert.ok(sentMessages.some(message => (
    message.action === 'extract-log'
    && message.sessionId === 'session-main'
    && message.message.includes('should_limit_list_of_followers=true')
    && message.message.includes('has_more=false')
    && message.message.includes('next_max_id=null')
  )));

  const result = await context.extractFollowersInPage('76144636285', 1, null, 'session-1');
  assert.equal(result.users.length, 1);
  assert.ok(sentMessages.some(message => (
    message.action === 'extract-log'
    && message.sessionId === 'session-1'
    && message.message.includes('第 1 页')
  )));
  console.log('background profile resolution and execution log tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
