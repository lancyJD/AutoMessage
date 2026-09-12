const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const listeners = { message: [], connect: [], alarm: [] };
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
      onMessage: { addListener(fn) { listeners.message.push(fn); } },
      onConnect: { addListener(fn) { listeners.connect.push(fn); } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
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

console.log('background profile resolution test passed');
