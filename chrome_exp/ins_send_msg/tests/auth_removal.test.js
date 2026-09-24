const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const html = read('popup.html');
const popup = read('popup.js');
const background = read('background.js');
const manifest = JSON.parse(read('manifest.json'));

for (const id of ['account-bar', 'auth-view', 'membership-panel', 'wallet-panel', 'devices-panel']) {
  assert.doesNotMatch(html, new RegExp(`id=["']${id}["']`), `popup.html should not contain #${id}`);
}

for (const script of ['lib/config.js', 'lib/device.js', 'lib/auth.js']) {
  assert.doesNotMatch(html, new RegExp(script.replace('.', '\\.'), 'i'), `popup.html should not load ${script}`);
}

for (const marker of ['SDMAuth', 'requireMembership', 'wallet-panel', 'membership-panel', 'devices-panel']) {
  assert.ok(!popup.includes(marker), `popup.js should not contain ${marker}`);
}

for (const marker of [
  'lib/config.js', 'lib/device.js', 'lib/api.js', 'SDM_API', 'SDM_GET_DEVICE_ID',
  'SDM_START_HEARTBEAT', 'SDM_STOP_HEARTBEAT', 'SDM_ALARM_HEARTBEAT',
  '/api/device/heartbeat', '/api/auth/refresh'
]) {
  assert.ok(!background.includes(marker), `background.js should not contain ${marker}`);
}

assert.ok(!manifest.permissions.includes('alarms'), 'manifest should not request alarms permission');
assert.ok(!manifest.host_permissions.some((host) => host.includes('43.157.82.128')), 'manifest should not allow the removed backend');
for (const obsoleteFile of ['config.js', 'device.js', 'api.js', 'auth.js']) {
  assert.ok(!fs.existsSync(path.join(root, 'lib', obsoleteFile)), `obsolete member module lib/${obsoleteFile} should be removed`);
}

for (const id of ['app-view', 'users', 'message', 'send', 'stop']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `core UI #${id} should remain`);
}
assert.ok(popup.includes('SDM_PREPARE'), 'popup send preparation should remain');
assert.ok(popup.includes('sendOne'), 'popup send loop should remain');
assert.ok(background.includes('SDM_PREPARE'), 'background send preparation should remain');
assert.ok(background.includes('PingApps-DMBot-CreateThread'), 'Instagram thread creation should remain');

console.log('auth removal structure test passed');
