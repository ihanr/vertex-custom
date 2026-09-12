// Only for an isolated CI installation, never run against production data.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
assert.equal(process.env.VERTEX_SMOKE_TEST, '1', 'Isolated smoke test opt-in required');
const settings = JSON.parse(fs.readFileSync('/vertex/data/setting.json', 'utf8'));
assert.equal(settings.username, 'admin');
assert.ok(settings.password);
for (const directory of ['rss', 'client', 'script']) {
  assert.equal(fs.readdirSync('/vertex/data/' + directory).length, 0, 'Defaults must not include user tasks');
}
const Database = require('better-sqlite3');
const db = new Database('/vertex/db/sql.db', { readonly: true, fileMustExist: true });
assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
db.close();
const request = (url, body, cookie) => new Promise((resolve, reject) => {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const req = http.request({ hostname: '127.0.0.1', port: 3000, path: url, method: body ? 'POST' : 'GET', headers, timeout: 5000 }, res => {
    let text = '';
    res.on('data', data => { text += data; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
  });
  req.on('error', reject);
  req.on('timeout', () => req.destroy(new Error('Request timed out')));
  req.end(body && JSON.stringify(body));
});
(async () => {
  const page = await request('/user/login');
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('<html'));
  const login = await request('/api/user/login', { username: settings.username, password: settings.password });
  assert.equal(JSON.parse(login.text).success, true, 'Fresh login failed');
  const cookies = login.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
  const user = await request('/api/user/get', null, cookies);
  assert.equal(JSON.parse(user.text).success, true, 'Session did not persist');
  const marker = '/vertex/data/docker-install-test-marker';
  const fingerprint = crypto.createHash('sha256').update(settings.password).digest('hex');
  if (process.env.SMOKE_RESTART === '1') assert.equal(fs.readFileSync(marker, 'utf8'), fingerprint);
  else fs.writeFileSync(marker, fingerprint, { flag: 'wx', mode: 0o600 });
  console.log('PASS login, empty defaults, native SQLite and persistent settings');
})().catch(() => { console.error('Docker installation smoke test failed (credentials and responses withheld)'); process.exitCode = 1; });
