const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');

const filename = path.resolve(__dirname, '../app/routes/router.js');
const realRequire = createRequire(filename);
let clientProxy;
let targetUrl;
const noop = () => {};
const controller = new Proxy({}, { get: () => new Proxy({}, { get: () => noop }) });
const mocks = {
  'connect-multiparty': class {},
  'express-session': Object.assign(() => noop, { Store: class {} }),
  'connect-redis': () => class {},
  redis: { createClient: () => ({ on: noop }) },
  '../libs/config': { getRedisConfig: () => ({}) },
  '../libs/logger': { error: noop },
  '../controller': controller,
  '../libs/util': { listClient: () => [{ id: 'qb', type: 'qBittorrent', clientUrl: targetUrl }] }
};
const mod = { exports: {} };
vm.runInThisContext('(function(require,module,exports,__dirname,__filename){' + fs.readFileSync(filename, 'utf8') + '\n})', { filename })(
  name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), mod, mod.exports, path.dirname(filename), filename);
mod.exports({ use: (route, handler) => {
  if (route === '/proxy/client/:client') clientProxy = handler;
} }, { text: () => noop, json: () => noop, urlencoded: () => noop }, new Proxy({}, { get: () => noop }));

(async () => {
  const upstream = http.createServer((req, res) => {
    const origin = new URL(targetUrl).origin;
    const refererOk = !req.headers.referer || new URL(req.headers.referer).origin === origin;
    const originOk = !req.headers.origin || req.headers.origin === origin;
    res.writeHead(refererOk && originOk ? 200 : 401);
    res.end(refererOk && originOk ? 'OK' : 'Unauthorized');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  targetUrl = `http://127.0.0.1:${upstream.address().port}`;
  global.runningClient = { qb: { cookie: 'QBT_SID_test=test' } };
  const app = express();
  app.use('/proxy/client/:client', clientProxy);
  const vertex = http.createServer(app);
  await new Promise(resolve => vertex.listen(0, '127.0.0.1', resolve));

  try {
    const url = `http://127.0.0.1:${vertex.address().port}/proxy/client/qb/`;
    for (const headers of [
      { Referer: 'https://vertex.example/base/downloader' },
      { Origin: 'https://vertex.example' }
    ]) {
      const response = await fetch(url, { headers });
      assert.equal(response.status, 200, `qB proxy must normalize ${Object.keys(headers)[0]} to target origin`);
    }
    console.log('PASS qB proxy normalizes browser origin headers to its target');
  } finally {
    await new Promise(resolve => vertex.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
