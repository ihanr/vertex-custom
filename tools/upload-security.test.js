const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const express = require('express');
const multipart = require('connect-multiparty');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-upload-test-'));
let parses = 0;
let uploaded = [];
const controller = new Proxy({}, { get: () => new Proxy({}, { get: () => (req, res) => {
  uploaded = req.files ? Object.values(req.files).flat().map(file => file.path) : [];
  res.json({ files: uploaded.length });
} }) });
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && /app[\\/]routes[\\/]router\.js$/.test(parent.filename)) {
    if (request === '../libs/config') return { getRedisConfig: () => ({}) };
    if (request === '../libs/logger') return { error() {} };
    if (request === '../controller') return controller;
    if (request === '../libs/util') return { uuid: { v4: () => 'id' } };
    if (request === 'redis') return { createClient: () => ({ on() {} }) };
    if (request === 'connect-redis') return () => class {};
    if (request === 'express-session') return () => (req, res, next) => {
      req.session = req.headers['x-test-auth'] ? { user: 'test' } : {};
      req._parsedOriginalUrl = { pathname: req.originalUrl.split('?')[0] };
      next();
    };
  }
  if (request === 'connect-multiparty') return function (options) {
    const parse = multipart({ ...options, uploadDir: temp });
    return (req, res, next) => { parses++; parse(req, res, next); };
  };
  return originalLoad.call(this, request, parent, isMain);
};
const configure = require('../app/routes/router');
Module._load = originalLoad;
const app = express();
const router = express.Router();
router.ws = () => {};
configure(app, express, router);
const server = http.createServer(app);
const request = auth => new Promise((resolve, reject) => {
  const body = '--testboundary\r\nContent-Disposition: form-data; name="file"; filename="backup.tar.gz"\r\nContent-Type: application/octet-stream\r\n\r\nok\r\n--testboundary--\r\n';
  const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/setting/restoreVertex', method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=testboundary', 'content-length': Buffer.byteLength(body), ...(auth ? { 'x-test-auth': '1' } : {}) }
  }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject); req.end(body);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  assert.equal(await request(false), 401);
  assert.equal(parses, 0, 'unauthenticated uploads must not reach file parser');
  assert.equal(await request(true), 200);
  assert.equal(uploaded.length, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(uploaded.every(file => !fs.existsSync(file)), 'finished upload must be cleaned');
  console.log('PASS A01: authentication precedes parsing and authorized temporary uploads are cleaned');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await new Promise(resolve => server.close(resolve));
  // Only the directory created by this test is removed.
  fs.rmSync(temp, { recursive: true, force: true });
});
