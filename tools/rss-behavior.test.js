const assert = require('node:assert/strict');
const Module = require('module');
const path = require('node:path');

const rssApi = {
  getTorrentNameByBencode: async () => ({ name: 'matched data', hash: 'new-hash' })
};
const util = {
  getRecord: async () => undefined,
  runRecord: async () => {},
  uuid: { v4: () => 'test-uuid' }
};
const logger = { info: () => {}, error: () => {} };
const moment = () => ({ unix: () => 100 });

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && path.normalize(parent.filename).endsWith(path.join('app', 'common', 'Rss.js'))) {
    if (request === '../libs/rss') return rssApi;
    if (request === '../libs/redis') return {};
    if (request === '../libs/util') return util;
    if (request === '../libs/logger') return logger;
    if (request === 'node-cron') return { schedule: () => ({ stop: () => {} }) };
    if (request === 'bencode') return {};
    if (request === 'moment') return moment;
    if (request === './Push') return class Push {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

const Rss = require('../app/common/Rss');
Module._load = originalLoad;

const calls = [];
const makeClient = (id, overrides = {}) => ({
  id,
  alias: id,
  status: true,
  _client: { type: 'qBittorrent' },
  avgUploadSpeed: 0,
  avgDownloadSpeed: 0,
  maindata: {
    torrents: [],
    leechingCount: 0,
    uploadSpeed: 0,
    downloadSpeed: 0,
    freeSpaceOnDisk: 100
  },
  addTorrent: async (...args) => calls.push([id, ...args]),
  addTorrentTag: async (hash, tag) => calls.push([id, 'tag', hash, tag]),
  ...overrides
});

const makeRss = (overrides = {}) => Object.assign(Object.create(Rss.prototype), {
  id: 'rss-id',
  alias: 'rss-test',
  _rss: {},
  clientArr: ['task-client'],
  clientSortBy: 'leechingCount',
  maxClientUploadSpeed: 0,
  maxClientDownloadSpeed: 0,
  maxClientDownloadCount: 0,
  maxSleepTime: 600,
  lastRssTime: 100,
  addCount: 0,
  addCountPerHour: 100,
  uploadLimit: 0,
  downloadLimit: 0,
  category: '',
  savePath: '',
  pushTorrentFile: false,
  useCustomRegex: false,
  skipSameTorrent: false,
  scrapeFree: false,
  scrapeHr: false,
  autoReseed: false,
  onlyReseed: false,
  acceptRules: [],
  rejectRules: [],
  ntf: {
    addTorrent: async () => {},
    addTorrentError: async () => {},
    rejectTorrent: async () => {},
    scrapeError: async () => {}
  },
  ...overrides
});

const torrent = {
  hash: 'new-hash',
  name: 'new torrent',
  size: 100,
  url: 'https://tracker.example/download',
  link: 'https://tracker.example/details'
};

const reset = () => {
  calls.length = 0;
  global.runningClient = {};
};

const test = async (name, fn) => {
  try {
    reset();
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
};

(async () => {
  await test('auto reseed adds to the matching completed-data downloader', async () => {
    global.runningClient.reseed = makeClient('reseed', {
      maindata: { torrents: [{ size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data' }] }
    });
    global.runningClient.normal = makeClient('normal');
    const rss = makeRss({ autoReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.deepEqual(calls, [
      ['reseed', torrent.url, torrent.hash, true, 0, 0, '/data', ''],
      ['reseed', 'tag', torrent.hash, 'Reseed']
    ]);
  });

  await test('auto reseed falls back to the selected normal downloader when no data matches', async () => {
    global.runningClient.reseed = makeClient('reseed');
    global.runningClient.normal = makeClient('normal');
    const rss = makeRss({ autoReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.deepEqual(calls, [['normal', torrent.url, torrent.hash, false, 0, 0, '', '', undefined, undefined]]);
  });

  await test('only reseed does not start a normal download when no data matches', async () => {
    global.runningClient.reseed = makeClient('reseed');
    global.runningClient.normal = makeClient('normal');
    const rss = makeRss({ autoReseed: true, onlyReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.deepEqual(calls, []);
  });

  await test('only reseed does not suppress normal downloads when auto reseed is disabled', async () => {
    global.runningClient.normal = makeClient('normal');
    const rss = makeRss({ autoReseed: false, onlyReseed: true });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.deepEqual(calls, [['normal', torrent.url, torrent.hash, false, 0, 0, '', '', undefined, undefined]]);
  });

  await test('an unavailable reseed downloader is skipped and normal download continues', async () => {
    global.runningClient.reseed = makeClient('reseed', { maindata: undefined });
    global.runningClient.normal = makeClient('normal');
    const rss = makeRss({ autoReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.deepEqual(calls, [['normal', torrent.url, torrent.hash, false, 0, 0, '', '', undefined, undefined]]);
  });

  await test('only reseed still uses completed data when the normal downloader group is unavailable', async () => {
    global.runningClient.reseed = makeClient('reseed', {
      maindata: { torrents: [{ size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data' }] }
    });
    global.runningClient.normal = makeClient('normal', { status: false });
    const rss = makeRss({
      autoReseed: true,
      onlyReseed: true,
      reseedClients: ['reseed'],
      acceptRules: [{ type: 'javascript', code: '() => true', clientArr: ['normal'] }]
    });

    await rss.rss([torrent]);

    assert.deepEqual(calls, [
      ['reseed', torrent.url, torrent.hash, true, 0, 0, '/data', ''],
      ['reseed', 'tag', torrent.hash, 'Reseed']
    ]);
  });

  await test('a reseed notification failure does not fall back to a normal download', async () => {
    global.runningClient.reseed = makeClient('reseed', {
      maindata: { torrents: [{ size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data' }] }
    });
    global.runningClient.normal = makeClient('normal');
    const rss = makeRss({
      autoReseed: true,
      reseedClients: ['reseed'],
      ntf: {
        addTorrent: async () => { throw new Error('notification unavailable'); },
        addTorrentError: async () => {},
        rejectTorrent: async () => {},
        scrapeError: async () => {}
      }
    });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.deepEqual(calls, [
      ['reseed', torrent.url, torrent.hash, true, 0, 0, '/data', ''],
      ['reseed', 'tag', torrent.hash, 'Reseed']
    ]);
  });

  await test('missing legacy reseedClients behaves as an empty downloader list', async () => {
    global.runningClient.normal = makeClient('normal');
    const rss = makeRss({ autoReseed: true });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.equal(calls[0][0], 'normal');
    assert.equal(calls[0][3], false);
  });

  await test('RSS processing uses the matching rule group instead of task downloaders', async () => {
    global.runningClient['task-client'] = makeClient('task-client');
    global.runningClient['group-client'] = makeClient('group-client');
    const rss = makeRss({
      acceptRules: [{ type: 'javascript', code: '() => true', clientArr: ['group-client'] }]
    });

    await rss.rss([torrent]);

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'group-client');
  });

  await test('RSS does not fall back to task downloaders when the matching rule group is unavailable', async () => {
    global.runningClient['task-client'] = makeClient('task-client');
    global.runningClient['group-client'] = makeClient('group-client', { status: false });
    const rss = makeRss({
      acceptRules: [{ type: 'javascript', code: '() => true', clientArr: ['group-client'] }]
    });

    await rss.rss([torrent]);

    assert.deepEqual(calls, []);
  });
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
