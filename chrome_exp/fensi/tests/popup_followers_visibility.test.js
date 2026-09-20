const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');

assert.match(html, /id="hide-followers"/);
assert.match(script, /igx_hide_followers/);
assert.match(script, /setFollowersHidden\(/);

console.log('popup followers visibility test passed');
