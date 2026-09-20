const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const readOptional = name => {
  const file = path.join(root, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};
const main = readOptional('network-listener-main.js');
const bridge = readOptional('network-listener-bridge.js');

const scripts = manifest.content_scripts || [];
assert.ok(scripts.some(entry => entry.world === 'MAIN' && entry.run_at === 'document_start' && entry.js.includes('network-listener-main.js')));
assert.ok(scripts.some(entry => entry.world === 'ISOLATED' && entry.run_at === 'document_start' && entry.js.includes('network-listener-bridge.js')));
assert.match(main, /\/graphql\/query/);
assert.match(main, /window\.fetch/);
assert.match(main, /XMLHttpRequest/);
assert.match(main, /postMessage/);
assert.match(bridge, /IGX_GRAPHQL_RESPONSE/);
assert.match(bridge, /chrome\.runtime\.sendMessage/);
assert.match(background, /waitForGraphqlPosts/);
assert.match(background, /aria-label="帖子"/);
assert.match(background, /clickPostsTabInMainWorld/);

console.log('graphql post capture wiring test passed');
