const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');

assert.match(html, /id="mode-followers"[^>]*aria-selected="true"/);
assert.match(html, /id="mode-interactions"[^>]*aria-selected="false"/);
assert.match(html, /id="post-count"[^>]*value="2"/);
assert.match(html, /id="per-post-comment-limit"[^>]*placeholder="留空或填 0 = 获取全部"/);
assert.match(html, /id="collect-comments"[^>]*checked/);
assert.match(html, /id="collect-likes"[^>]*disabled/);
assert.match(html, /class="choice-grid"/);
assert.match(html, /\.field label\.choice-row[^}]*display:\s*flex/s);
assert.match(html, /\.field \.choice-row input[^}]*width:\s*17px/s);
assert.match(html, /\.mode-tab\[aria-selected="true"\][^{]*\{[^}]*linear-gradient/s);
assert.match(script, /setMode\(/);
assert.match(script, /startInteractionExtract\(/);
assert.match(script, /resolve-recent-posts/);
assert.match(script, /extract-comment-users/);
assert.match(script, /perPostLimit/);
assert.match(script, /评论用户_/);
assert.match(script, /result\.stopped\s*\?\s*['`]⏹/);
assert.match(html, /id="execution-log"/);

console.log('popup interaction mode test passed');
