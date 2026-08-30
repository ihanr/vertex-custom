const assert = require('node:assert/strict');
const Module = require('module');
const path = require('node:path');

const redisStore = new Map();
const redis = {
  get: async key => redisStore.get(key),
  set: async (key, value) => redisStore.set(key, value),
  setWithExpire: async (key, value) => redisStore.set(key, value)
};
const util = {
  getRecord: async () => undefined,
  getRecords: async () => [],
  runRecord: async () => {},
  runRecords: async () => {},
  listPush: () => [],
  listDeleteRule: () => [],
  calSize: value => value || 0,
  sleep: async () => {}
};
const logger = { debug: () => {}, error: () => {}, info: () => {} };
const moment = () => ({
  unix: () => 100,
  startOf: () => ({ unix: () => 100, subtract: () => ({ unix: () => 95 }) })
});

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && path.normalize(parent.filename).endsWith(path.join('app', 'common', 'Client.js'))) {
    if (request === '../libs/client/qb' || request === '../libs/client/de' || request === '../libs/client/tr') return {};
    if (request === '../libs/util') return util;
    if (request === '../libs/redis') return redis;
    if (request === '../libs/logger') return logger;
    if (request === 'moment') return moment;
    if (request === 'node-cron') return { schedule: () => ({ stop: () => {} }) };
    if (request === './Push') return class Push {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

const Client = require('../app/common/Client');
Module._load = originalLoad;

const makeClient = (overrides = {}) => Object.assign(Object.create(Client.prototype), {
  alias: 'test-client',
  _client: { type: 'qBittorrent' },
  clientUrl: 'http://qb.example',
  cookie: {},
  lastCookie: 100,
  client: {},
  trackerStatus: {},
  avgUploadSpeed: 0,
  avgDownloadSpeed: 0,
  errorCount: 0,
  monitor: { push: false },
  mnt: { edit: async () => {} },
  ntf: { getMaindataError: async () => {} },
  login: async () => {},
  ...overrides
});

const reset = () => {
  redisStore.clear();
  util.getRecord = async () => undefined;
  util.getRecords = async () => [];
  util.runRecord = async () => {};
  util.runRecords = async () => {};
};

const test = async (name, fn) => {
  reset();
  await fn();
  console.log(`PASS ${name}`);
};

(async () => {
  await test('coalesces overlapping maindata refreshes', async () => {
    let calls = 0;
    let resolveResponse;
    const response = new Promise((resolve) => { resolveResponse = resolve; });
    const client = makeClient({ client: { getMaindata: async () => { calls += 1; return response; } } });

    const first = client.getMaindata();
    const second = client.getMaindata();

    assert.equal(calls, 1);
    resolveResponse({ torrents: [], uploadSpeed: 0, downloadSpeed: 0 });
    await Promise.all([first, second]);
  });

  await test('builds a completed-torrent size index during maindata refresh', async () => {
    const client = makeClient({
      client: { getMaindata: async () => ({ torrents: [{ hash: 'done', size: 100, completed: 100, state: 'Seeding' }], uploadSpeed: 0, downloadSpeed: 0 }) }
    });

    await client.getMaindata();

    assert.equal(client.reseedTorrentIndex.get(100)[0].hash, 'done');
  });

  await test('uses cached tracker status without another qB tracker request', async () => {
    let requests = 0;
    redisStore.set('vertex:torrent_tracker_status:hash-1', JSON.stringify('cached tracker status'));
    const client = makeClient({
      maindata: { torrents: [{ hash: 'hash-1', name: 'torrent', tracker: 'tracker.example' }] },
      client: { getTrackerList: async () => { requests += 1; return { statusCode: 200, body: '[]' }; } }
    });

    await client.trackerSync();

    assert.equal(requests, 0);
    assert.equal(client.trackerStatus['hash-1'], 'cached tracker status');
  });

  await test('limits tracker status requests to four concurrent qB calls', async () => {
    let active = 0;
    let maxActive = 0;
    util.getRecord = async () => ({ id: 1 });
    const client = makeClient({
      maindata: { torrents: Array.from({ length: 5 }, (_, index) => ({ hash: `hash-${index}`, name: 'torrent', tracker: 'tracker.example' })) },
      client: {
        getTrackerList: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setImmediate(resolve));
          active -= 1;
          return { statusCode: 200, body: '[]' };
        }
      }
    });

    await client.trackerSync();

    assert.equal(maxActive, 4);
  });

  await test('records a client snapshot through one batch transaction', async () => {
    const batches = [];
    let singleWrites = 0;
    redisStore.set('vertex:torrent:hash-1', '1');
    util.runRecord = async () => { singleWrites += 1; };
    util.runRecords = async records => batches.push(records);
    const client = makeClient({
      maindata: { torrents: [{ hash: 'hash-1', size: 1, tracker: 'tracker.example', uploaded: 2, downloaded: 3 }] }
    });

    await client.record();

    assert.equal(singleWrites, 0);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 3);
  });
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
