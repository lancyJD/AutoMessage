const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const backgroundSource = fs.readFileSync(require.resolve('../background.js'), 'utf8');
const listeners = { message: [] };
const sentMessages = [];
const context = {
  console, URL, URLSearchParams, setTimeout, clearTimeout,
  importScripts() {},
  chrome: {
    tabs: { query: async () => [] },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    runtime: {
      sendMessage: async message => { sentMessages.push(message); },
      onMessage: { addListener(fn) { listeners.message.push(fn); } },
      onConnect: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} },
    },
    scripting: { executeScript: async () => [] },
    alarms: { create() {}, clear: async () => {}, onAlarm: { addListener() {} } },
    sidePanel: { setPanelBehavior: async () => {} },
  },
};
vm.createContext(context);
vm.runInContext(backgroundSource, context, { filename: 'background.js' });

assert.doesNotMatch(backgroundSource, /web_profile_info/);
context.document = {
  querySelectorAll() {
    return [{ textContent: JSON.stringify({ data: { edges: [
      { node: { id: 'page-post-1', shortcode: 'PAGE1' } },
      { node: { id: 'page-post-2', shortcode: 'PAGE2' } },
      { node: { id: 'page-post-3', shortcode: 'PAGE3' } },
    ] } }) }];
  },
};

const media = context.extractRecentMediaIds({
  data: { user: { edge_owner_to_timeline_media: { edges: [
    { node: { id: 'post-1', shortcode: 'AAA' } },
    { node: { id: 'post-2', shortcode: 'BBB' } },
    { node: { id: 'post-3', shortcode: 'CCC' } },
  ] } } },
}, 2);
assert.deepEqual(JSON.parse(JSON.stringify(media)), [
  { mediaId: 'post-1', shortcode: 'AAA' },
  { mediaId: 'post-2', shortcode: 'BBB' },
]);

(async () => {
  const pagePosts = await context.extractRecentPostsFromCurrentPageInMainWorld(2);
  assert.deepEqual(JSON.parse(JSON.stringify(pagePosts)), [
    { mediaId: 'page-post-1', shortcode: 'PAGE1' },
    { mediaId: 'page-post-2', shortcode: 'PAGE2' },
  ]);

  context.document = {
    querySelectorAll(selector) {
      if (selector.startsWith('script')) return [];
      return [{ getAttribute: () => '/reel/BA/' }];
    },
  };
  const linkPosts = await context.extractRecentPostsFromCurrentPageInMainWorld(2);
  assert.deepEqual(JSON.parse(JSON.stringify(linkPosts)), [{ mediaId: '64', shortcode: 'BA' }]);

  let requestedUrl = '';
  context.fetch = async (url, options) => {
    requestedUrl = String(url);
    assert.equal(options.credentials, 'include');
    return { status: 200, json: async () => ({
      comment_count: 2,
      comments: [
        { user: { pk: '1', username: 'alice', full_name: 'Alice' } },
        { user: { pk: '2', username: 'bob', full_name: 'Bob' } },
      ],
      has_more_comments: true,
      next_min_id: 'cursor-2',
    }) };
  };
  const page = await context.fetchCommentsPageInMainWorld('post-1', 'cursor-1');
  assert.match(requestedUrl, /media\/post-1\/comments/);
  assert.match(requestedUrl, /min_id=cursor-1/);
  assert.equal(page.commentCount, 2);
  assert.equal(page.comments[0].user.username, 'alice');
  assert.equal(page.nextMinId, 'cursor-2');
  assert.equal(page.hasMore, true);

  const pages = {
    'post-1:': { status: 200, commentCount: 3, comments: [
      { user: { pk: '1', username: 'alice', full_name: 'Alice' } },
      { user: { pk: '2', username: 'bob', full_name: 'Bob' } },
    ], nextMinId: 'next', hasMore: true },
    'post-1:next': { status: 200, commentCount: 3, comments: [
      { user: { pk: '3', username: 'carol', full_name: 'Carol' } },
    ], nextMinId: null, hasMore: false },
    'post-2:': { status: 200, commentCount: 2, comments: [
      { user: { pk: '2', username: 'bob', full_name: 'Bob' } },
      { user: { pk: '4', username: 'dave', full_name: 'Dave' } },
    ], nextMinId: null, hasMore: false },
  };
  context.chrome.scripting.executeScript = async ({ args }) => [{ result: pages[`${args[0]}:${args[1] || ''}`] }];
  const result = await context.collectCommentUsersInMainWorld('tab-1', ['post-1', 'post-2'], 'session-comments');
  assert.deepEqual(JSON.parse(JSON.stringify(result.users.map(user => user.username))), ['alice', 'bob', 'carol', 'dave']);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.processedPosts, 2);
  assert.ok(sentMessages.some(message => message.message && message.message.includes('评论用户总数=3')));

  let stopRequested = false;
  let requestCount = 0;
  context.chrome.storage.local.get = async () => ({ igx_stop: stopRequested ? 'stop-session' : null });
  context.chrome.scripting.executeScript = async () => {
    requestCount++;
    stopRequested = true;
    return [{ result: {
      status: 200, commentCount: 10,
      comments: [{ user: { pk: '9', username: 'partial-user', full_name: 'Partial User' } }],
      nextMinId: 'next-page', hasMore: true,
    } }];
  };
  const stoppedResult = await context.collectCommentUsersInMainWorld('tab-1', ['post-stop'], 'stop-session');
  assert.equal(requestCount, 1);
  assert.equal(stoppedResult.stopped, true);
  assert.deepEqual(JSON.parse(JSON.stringify(stoppedResult.users.map(user => user.username))), ['partial-user']);

  const waitStarted = Date.now();
  const stoppedPosts = await context.waitForGraphqlPosts('stop-tab', 2000, 'stop-session');
  assert.deepEqual(JSON.parse(JSON.stringify(stoppedPosts)), []);
  assert.ok(Date.now() - waitStarted < 500, 'GraphQL wait should react to stop within 500ms');

  context.chrome.storage.local.get = async () => ({ igx_stop: null });
  let limitedRequests = 0;
  context.chrome.scripting.executeScript = async () => {
    limitedRequests++;
    return [{ result: {
      status: 200, commentCount: 3,
      comments: [
        { user: { pk: '1', username: 'limit-one', full_name: 'One' } },
        { user: { pk: '2', username: 'limit-two', full_name: 'Two' } },
      ],
      nextMinId: 'unused-next', hasMore: true,
    } }];
  };
  const limitedResult = await context.collectCommentUsersInMainWorld('tab-1', ['post-limit'], 'limit-session', 1);
  assert.equal(limitedRequests, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(limitedResult.users.map(user => user.username))), ['limit-one']);

  limitedRequests = 0;
  context.chrome.scripting.executeScript = async () => {
    limitedRequests++;
    return [{ result: {
      status: 200, commentCount: 2,
      comments: [
        { user: { pk: '1', username: 'limit-one', full_name: 'One' } },
        { user: { pk: '2', username: 'limit-two', full_name: 'Two' } },
      ],
      nextMinId: 'unused-next', hasMore: true,
    } }];
  };
  const cappedResult = await context.collectCommentUsersInMainWorld('tab-1', ['post-cap'], 'cap-session', 99);
  assert.equal(limitedRequests, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(cappedResult.users.map(user => user.username))), ['limit-one', 'limit-two']);
  console.log('background comment users tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
