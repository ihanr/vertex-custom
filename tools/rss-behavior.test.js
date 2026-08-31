const assert = require('node:assert/strict');
const Module = require('module');
const path = require('node:path');

const rssApi = {
  getTorrentNameByBencode: async () => ({ name: 'matched data', hash: 'new-hash' })
};
const util = {
  getRecord: async () => undefined,
  runRecord: async () => {},
  sleep: async () => {},
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
const makeClient = (id, overrides = {}) => {
  const client = {
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
    addTorrentTag: async (hash, tag) => {
      calls.push([id, 'tag', hash, tag]);
      const taggedTorrent = client.maindata.torrents.find(item => item.hash === hash);
      if (taggedTorrent) taggedTorrent.tags = tag;
      else client.maindata.torrents.push({ hash, tags: tag });
      return { statusCode: 200 };
    },
    getMaindata: async () => {}
  };
  return Object.assign(client, overrides);
};

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
  rssApi.getTorrentNameByBencode = async () => ({ name: 'matched data', hash: 'new-hash' });
  util.runRecord = async () => {};
  util.sleep = async () => {};
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
      ['reseed', 'tag', torrent.hash, 'Reseed'],
      ['reseed', 'tag', 'old-hash', 'Brseed']
    ]);
  });

  await test('marks the original source torrent even when the new reseed tag fails', async () => {
    global.runningClient.reseed = makeClient('reseed', {
      maindata: { torrents: [{ size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data' }] },
      addTorrentTag: async (hash, tag) => {
        calls.push(['reseed', 'tag', hash, tag]);
        if (hash === torrent.hash) return { statusCode: 500 };
        const source = global.runningClient.reseed.maindata.torrents.find(item => item.hash === hash);
        source.tags = tag;
        return { statusCode: 200 };
      }
    });
    global.runningClient.normal = makeClient('normal');
    const rss = makeRss({ autoReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.ok(calls.some(call => call[1] === 'tag' && call[2] === 'old-hash' && call[3] === 'Brseed'));
  });

  await test('records a source Brseed confirmation failure instead of silently succeeding', async () => {
    const records = [];
    global.runningClient.reseed = makeClient('reseed', {
      maindata: { torrents: [{ size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data', tags: '' }] },
      addTorrentTag: async (hash, tag) => {
        calls.push(['reseed', 'tag', hash, tag]);
        if (hash === 'old-hash') return { statusCode: 200 };
        global.runningClient.reseed.maindata.torrents.push({ hash, tags: tag });
        return { statusCode: 200 };
      }
    });
    global.runningClient.normal = makeClient('normal');
    util.runRecord = async (_sql, values) => records.push(values);
    const rss = makeRss({ autoReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.equal(calls.filter(call => call[1] === 'tag' && call[2] === 'old-hash').length, 3);
    assert.ok(records.some(values => values.includes('辅种（标签失败）')));
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
      ['reseed', 'tag', torrent.hash, 'Reseed'],
      ['reseed', 'tag', 'old-hash', 'Brseed']
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
      ['reseed', 'tag', torrent.hash, 'Reseed'],
      ['reseed', 'tag', 'old-hash', 'Brseed']
    ]);
  });

  await test('auto reseed uses the completed-torrent size index when available', async () => {
    const completedTorrent = { size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data' };
    global.runningClient.reseed = makeClient('reseed', {
      maindata: { torrents: [] },
      reseedTorrentIndex: new Map([[100, [completedTorrent]]])
    });
    global.runningClient.normal = makeClient('normal');
    const rss = makeRss({ autoReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.equal(calls[0][0], 'reseed');
    assert.equal(calls[0][3], true);
  });

  await test('coalesces overlapping RSS runs', async () => {
    let runs = 0;
    let resolveRun;
    const rss = makeRss({
      rss: async () => {
        runs += 1;
        await new Promise((resolve) => { resolveRun = resolve; });
      }
    });

    const first = rss._runRss();
    const second = rss._runRss();

    assert.equal(runs, 1);
    resolveRun();
    await Promise.all([first, second]);
  });

  await test('auto reseed retries a failed tag request until qB confirms success', async () => {
    let newTagAttempts = 0;
    const reseedClient = makeClient('reseed', {
      maindata: { torrents: [{ size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data' }] },
      addTorrentTag: async (hash, tag) => {
        calls.push(['reseed', 'tag', hash, tag]);
        if (hash !== torrent.hash) {
          const source = reseedClient.maindata.torrents.find(item => item.hash === hash);
          source.tags = tag;
          return { statusCode: 200 };
        }
        newTagAttempts += 1;
        if (newTagAttempts === 3) reseedClient.maindata.torrents.push({ hash, tags: tag });
        return { statusCode: newTagAttempts === 3 ? 200 : 500 };
      }
    });
    global.runningClient.reseed = reseedClient;
    global.runningClient.normal = makeClient('normal');
    const rss = makeRss({ autoReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.equal(newTagAttempts, 3);
  });

  await test('a pending reseed add waits for qB registration before applying the tag', async () => {
    let maindataCalls = 0;
    let tagBeforeRegistration = false;
    const reseedClient = makeClient('reseed', {
      maindata: { torrents: [{ size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data' }] },
      addTorrent: async (...args) => {
        calls.push(['reseed', ...args]);
        return { statusCode: 202 };
      },
      getMaindata: async () => {
        maindataCalls += 1;
        if (maindataCalls === 2) reseedClient.maindata.torrents.push({ hash: torrent.hash, tags: '' });
      },
      addTorrentTag: async (hash, tag) => {
        calls.push(['reseed', 'tag', hash, tag]);
        const taggedTorrent = reseedClient.maindata.torrents.find(item => item.hash === hash);
        if (!taggedTorrent) tagBeforeRegistration = true;
        else taggedTorrent.tags = tag;
        return { statusCode: 200 };
      }
    });
    global.runningClient.reseed = reseedClient;
    global.runningClient.normal = makeClient('normal');
    const rss = makeRss({ autoReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.equal(tagBeforeRegistration, false);
    assert.ok(maindataCalls >= 2);
  });

  await test('a permanently failed tag is recorded as a tag failure', async () => {
    const records = [];
    global.runningClient.reseed = makeClient('reseed', {
      maindata: { torrents: [{ size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data' }] },
      addTorrentTag: async (hash, tag) => {
        calls.push(['reseed', 'tag', hash, tag]);
        return { statusCode: 500 };
      }
    });
    global.runningClient.normal = makeClient('normal');
    util.runRecord = async (_sql, values) => records.push(values);
    const rss = makeRss({ autoReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.equal(calls.filter(call => call[1] === 'tag' && call[2] === torrent.hash).length, 3);
    assert.equal(calls.filter(call => call[1] === 'tag' && call[2] === 'old-hash').length, 3);
    assert.ok(records.some(values => values.includes('辅种（标签失败）')));
    assert.ok(!records.some(values => values.includes('辅种')));
  });

  await test('a qB success response without the actual tag is retried and recorded as a tag failure', async () => {
    const records = [];
    let maindataCalls = 0;
    global.runningClient.reseed = makeClient('reseed', {
      maindata: { torrents: [{ size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data' }] },
      addTorrentTag: async (hash, tag) => {
        calls.push(['reseed', 'tag', hash, tag]);
        return { statusCode: 200 };
      },
      getMaindata: async () => { maindataCalls += 1; }
    });
    global.runningClient.normal = makeClient('normal');
    util.runRecord = async (_sql, values) => records.push(values);
    const rss = makeRss({ autoReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.equal(calls.filter(call => call[1] === 'tag' && call[2] === torrent.hash).length, 3);
    assert.equal(calls.filter(call => call[1] === 'tag' && call[2] === 'old-hash').length, 3);
    assert.equal(maindataCalls, 6);
    assert.ok(records.some(values => values.includes('辅种（标签失败）')));
  });

  await test('confirms a reseed tag with a forced maindata refresh', async () => {
    const refreshes = [];
    const reseedClient = makeClient('reseed', {
      maindata: { torrents: [{ size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data' }] },
      addTorrentTag: async (hash, tag) => {
        reseedClient.maindata.torrents.push({ hash, tags: tag });
        return { statusCode: 200 };
      },
      getMaindata: async force => refreshes.push(force)
    });
    global.runningClient.reseed = reseedClient;
    global.runningClient.normal = makeClient('normal');
    const rss = makeRss({ autoReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.ok(refreshes.includes(true));
  });

  await test('a failed reseed metadata lookup falls back to the normal downloader', async () => {
    global.runningClient.reseed = makeClient('reseed', {
      maindata: { torrents: [{ size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data' }] }
    });
    global.runningClient.normal = makeClient('normal');
    rssApi.getTorrentNameByBencode = async () => { throw new Error('metadata unavailable'); };
    const rss = makeRss({ autoReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.deepEqual(calls, [['normal', torrent.url, torrent.hash, false, 0, 0, '', '', undefined, undefined]]);
  });

  await test('a reseed failure record error does not prevent normal fallback', async () => {
    global.runningClient.reseed = makeClient('reseed', {
      maindata: { torrents: [{ size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data' }] },
      addTorrent: async () => { throw new Error('reseed add failed'); }
    });
    global.runningClient.normal = makeClient('normal');
    let recordAttempts = 0;
    util.runRecord = async () => {
      recordAttempts += 1;
      if (recordAttempts === 1) throw new Error('record unavailable');
    };
    const rss = makeRss({ autoReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.deepEqual(calls, [['normal', torrent.url, torrent.hash, false, 0, 0, '', '', undefined, undefined]]);
  });

  await test('a reseed failure notification error does not prevent normal fallback', async () => {
    global.runningClient.reseed = makeClient('reseed', {
      maindata: { torrents: [{ size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data' }] },
      addTorrent: async () => { throw new Error('reseed add failed'); }
    });
    global.runningClient.normal = makeClient('normal');
    const rss = makeRss({
      autoReseed: true,
      reseedClients: ['reseed'],
      ntf: {
        addTorrent: async () => {},
        addTorrentError: async () => { throw new Error('notification unavailable'); },
        rejectTorrent: async () => {},
        scrapeError: async () => {}
      }
    });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.deepEqual(calls, [['normal', torrent.url, torrent.hash, false, 0, 0, '', '', undefined, undefined]]);
  });

  await test('a failed reseed attempt does not consume an extra hourly add slot', async () => {
    global.runningClient.reseed = makeClient('reseed', {
      maindata: { torrents: [{ size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data' }] },
      addTorrent: async () => { throw new Error('reseed add failed'); }
    });
    global.runningClient.normal = makeClient('normal');
    const rss = makeRss({ autoReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.equal(rss.addCount, 1);
  });

  await test('records a reseed add failure with matching SQL parameters', async () => {
    const records = [];
    global.runningClient.reseed = makeClient('reseed', {
      maindata: { torrents: [{ size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data' }] },
      addTorrent: async () => { throw new Error('reseed add failed'); }
    });
    global.runningClient.normal = makeClient('normal');
    util.runRecord = async (sql, values) => records.push({ sql, values });
    const rss = makeRss({ autoReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    const failure = records.find(record => record.values.includes('辅种失败'));
    assert.ok(failure);
    assert.equal((failure.sql.match(/\?/g) || []).length, failure.values.length);
  });

  await test('does not put the reseed client object into an error log', async () => {
    const logs = [];
    global.runningClient.reseed = makeClient('reseed', {
      maindata: { torrents: [{ size: 100, completed: 100, name: 'matched data', hash: 'old-hash', savePath: '/data' }] },
      addTorrent: async () => { throw new Error('reseed add failed'); }
    });
    global.runningClient.normal = makeClient('normal');
    logger.error = (...args) => logs.push(args);
    const rss = makeRss({ autoReseed: true, reseedClients: ['reseed'] });

    await rss._pushTorrent(torrent, global.runningClient.normal);

    assert.ok(logs.some(args => args.includes('reseed')));
    assert.ok(logs.every(args => !args.includes(global.runningClient.reseed)));
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
