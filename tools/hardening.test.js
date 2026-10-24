const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const load = (file, mocks) => {
  const filename = path.resolve(__dirname, '..', file);
  const mod = { exports: {} };
  const requireReal = createRequire(filename);
  vm.runInThisContext('(function(require,module,exports,__dirname,__filename){' + fs.readFileSync(filename, 'utf8') + '\n})', { filename })(
    name => Object.prototype.hasOwnProperty.call(mocks, name) ? mocks[name] : requireReal(name), mod, mod.exports, path.dirname(filename), filename);
  return mod.exports;
};
let records = [];
const util = { runRecord: async (sql, args) => records.push({ sql, args }), getRecord: async () => undefined,
  listDeleteRule: () => [], sleep: async () => {}, uuid: { v4: () => 'mock' } };
const logger = { info() {}, error() {}, debug() {} };
const clock = () => ({ unix: () => 100 });
const Client = load('app/common/Client.js', {
  '../libs/util': util, '../libs/logger': logger, '../libs/redis': {},
  '../libs/client/qb': {}, '../libs/client/tr': {}, '../libs/client/de': {}, moment: clock, './Push': class {}
});
const rssApi = {};
const actions = new Map();
const actionStore = {
  get: async (id, hash) => actions.get(id + ':' + hash),
  save: async (id, hash, action) => actions.set(id + ':' + hash, JSON.parse(JSON.stringify(action))),
  remove: async (id, hash) => actions.delete(id + ':' + hash),
  list: async id => [...actions].filter(([key]) => key.startsWith(id + ':')).map(([key, action]) => ({ hash: key.slice(id.length + 1), action }))
};
const Rss = load('app/common/Rss.js', {
  '../libs/util': util, '../libs/logger': logger, '../libs/redis': {}, '../libs/rss': rssApi,
  '../libs/rss-actions': actionStore, moment: clock, './Push': class {}
});
const makeClient = (extra = {}) => Object.assign(Object.create(Client.prototype), {
  id: 'qb', alias: 'test-qb', status: true, _client: { type: 'qBittorrent' },
  clientUrl: 'https://qb.example', cookie: 'mock', maxLeechNum: 1,
  maindata: { torrents: [], leechingCount: 0 }, login: async () => {}, ntf: {},
  client: {}, ...extra
});
const makeRss = (extra = {}) => Object.assign(Object.create(Rss.prototype), {
  id: 'rss', alias: 'rss', _rss: {}, urls: ['https://feed.example'], lastRssTime: 100, maxSleepTime: 600,
  clientArr: ['qb'], clientSortBy: 'leechingCount', addCount: 0, addCountPerHour: 100,
  acceptRules: [{ type: 'javascript', code: '() => true' }], rejectRules: [],
  ntf: { addTorrent: async () => {}, addTorrentError: async () => {}, rejectTorrent: async () => {} }, ...extra
});
const torrent = { hash: 'a'.repeat(40), name: 'test', size: 100, url: 'https://feed.example/download', savePath: '/data' };
let failed = 0;
async function test(name, fn) {
  records = [];
  actions.clear();
  util.getRecord = async () => undefined;
  util.runRecord = async (sql, args) => records.push({ sql, args });
  try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name, e.message); }
}
(async () => {
  await test('A03: stopping while journal lookup waits does not overwrite recovery state', async () => {
    const originalGet = actionStore.get;
    let release; let adds = 0;
    actionStore.get = () => new Promise(resolve => { release = resolve; });
    const task = makeRss();
    const running = task._sendAction(torrent, makeClient(), null, async () => { adds++; });
    task.destroyed = true;
    release(undefined);
    try {
      await running;
      assert.equal(actions.size, 0);
      assert.equal(adds, 0);
    } finally { actionStore.get = originalGet; }
  });
  await test('A05: fifth uncertain add confirmed absent stops instead of reopening retries', async () => {
    await actionStore.save('rss', torrent.hash, { clientId: 'qb', hash: torrent.hash, phase: 'adding', attempts: 5, nextTry: 0 });
    global.runningClient = { qb: makeClient({ findTorrent: async () => undefined }) };
    await makeRss()._recoverActions();
    assert.equal((await actionStore.get('rss', torrent.hash)).phase, 'stopped');
  });
  await test('A03: destroyed RSS cannot add after feed fetch completes', async () => {
    let release; let adds = 0;
    rssApi.getTorrents = () => new Promise(resolve => { release = resolve; });
    global.runningClient = { qb: { status: true, maindata: { leechingCount: 0, torrents: [] }, addTorrent: async () => { adds++; } } };
    const task = makeRss({ rssJob: { stop() {} }, clearCount: { stop() {} } });
    global.runningRss = { rss: task };
    const run = task._runRss();
    task.destroy(); release([torrent]); await run;
    assert.equal(adds, 0);
  });
  await test('A04: shared client rejects a second concurrent slot, including file adds', async () => {
    let release; let adds = 0;
    const response = new Promise(resolve => { release = resolve; });
    const rawAdd = async () => { adds++; await response; return { statusCode: 200 }; };
    const client = makeClient({ client: { addTorrent: rawAdd, addTorrentByTorrentFile: rawAdd } });
    const first = client.addTorrent(torrent.url, torrent.hash);
    const second = client.addTorrentByTorrentFile('/mock.torrent', 'b'.repeat(40)).then(() => 'accepted', () => 'blocked');
    await new Promise(resolve => setImmediate(resolve));
    release(); await first;
    assert.equal(await second, 'blocked'); assert.equal(adds, 1);
  });
  await test('A04: reseed does not consume or require a normal download slot', async () => {
    const client = makeClient({ maindata: { torrents: [], leechingCount: 1 },
      client: { addTorrent: async () => ({ statusCode: 200 }) } });
    await client.addTorrent(torrent.url, torrent.hash, true);
    assert.equal(client.maindata.leechingCount, 1);
  });
  await test('A06: bookkeeping failure does not turn accepted qB add into rejection', async () => {
    util.runRecord = async () => { throw new Error('database busy'); };
    const client = makeClient({ client: { addTorrent: async () => ({ statusCode: 200 }) } });
    const result = await client.addTorrent(torrent.url, torrent.hash);
    assert.equal(result.statusCode, 200);
  });
  await test('A07: failed HTTP delete never sends success notification', async () => {
    let success = 0;
    const client = makeClient({ maindata: { torrents: [torrent] }, client: { deleteTorrent: async () => ({ statusCode: 403 }) },
      ntf: { deleteTorrent: async () => { success++; }, deleteTorrentError: async () => {} } });
    const result = await client.deleteTorrent(torrent, {});
    assert.equal(success, 0); assert.equal(result, undefined);
  });
  await test('A07: overlapping deletion runs cannot write false history or repeat a failed delete', async () => {
    let deletes = 0;
    const client = makeClient({ maindata: { torrents: [torrent] }, deleteRules: [{ alias: 'test', deleteNum: 1 }],
      rejectDeleteRules: [], pausedTorrentHashes: [], _fitDeleteRule: () => true, reannounceTorrent: async () => {},
      client: { deleteTorrent: async () => { deletes++; throw new Error('timeout'); } },
      ntf: { deleteTorrentError: async () => {} } });
    await Promise.all([client.autoDelete(), client.autoDelete()]);
    assert.equal(deletes, 1); assert.equal(records.length, 0);
  });
  await test('A05: uncertain accepted add is reconciled on original qB, never added again', async () => {
    let adds = 0;
    const accepted = [];
    const client = makeClient({ maxLeechNum: 0, client: {
      addTorrent: async () => { adds++; accepted.push({ ...torrent, tags: '' }); throw new Error('connection reset'); }
    }, findTorrent: async hash => accepted.find(t => t.hash === hash) });
    global.runningClient = { qb: client };
    const task = makeRss();
    await task.rss([torrent]);
    const stored = await actionStore.get('rss', torrent.hash);
    assert.equal(stored.phase, 'adding');
    stored.nextTry = 0;
    await actionStore.save('rss', torrent.hash, stored);
    util.getRecord = async () => ({ id: 1, record_type: 3 });
    await task._recoverActions();
    assert.equal(adds, 1);
    assert.ok(records.some(r => r.args && r.args.includes('添加种子')));
    assert.equal(await actionStore.get('rss', torrent.hash), undefined);
  });
  await test('A05: definitely rejected request can retry after backoff with the same client', async () => {
    let adds = 0;
    const client = makeClient({ maxLeechNum: 0, findTorrent: async () => undefined,
      client: { addTorrent: async () => ({ statusCode: ++adds === 1 ? 503 : 200 }) } });
    global.runningClient = { qb: client };
    const task = makeRss();
    await task.rss([torrent]);
    const stored = await actionStore.get('rss', torrent.hash);
    assert.equal(stored.phase, 'retry');
    stored.nextTry = 0; await actionStore.save('rss', torrent.hash, stored);
    util.getRecord = async () => ({ id: 1, record_type: 3 });
    await task.rss([torrent]);
    assert.equal(adds, 2);
  });
  await test('A08: a new RSS instance resumes missing tags without adding the torrent again', async () => {
    let adds = 0; let failTag = true;
    const source = { hash: 'b'.repeat(40), name: 'data', size: 100, completed: 100, savePath: '/data', tags: '' };
    const items = [source];
    const client = { id: 'qb', alias: 'test-qb', status: true, _client: { type: 'qBittorrent' },
      maindata: { torrents: items, leechingCount: 0 },
      findTorrent: async hash => items.find(t => t.hash === hash),
      getMaindata: async () => {},
      addTorrent: async () => { adds++; items.push({ ...torrent, tags: '' }); return { statusCode: 200 }; },
      addTorrentTag: async (hash, tag) => {
        if (failTag) throw new Error('temporary tag timeout');
        items.find(t => t.hash === hash).tags = tag;
        return { statusCode: 200 };
      }
    };
    global.runningClient = { qb: client };
    rssApi.getTorrentNameByBencode = async () => ({ name: 'data', hash: torrent.hash });
    const task = makeRss({ autoReseed: true, onlyReseed: true, reseedClients: ['qb'] });
    await task.rss([torrent]);
    const stored = await actionStore.get('rss', torrent.hash);
    assert.equal(stored.phase, 'accepted');
    assert.equal(source.tags, '');
    stored.nextTry = 0; await actionStore.save('rss', torrent.hash, stored);
    failTag = false;
    const restarted = makeRss({ autoReseed: true, onlyReseed: true, reseedClients: ['qb'] });
    await restarted._recoverActions();
    assert.equal(adds, 1);
    assert.equal(items.find(t => t.hash === torrent.hash).tags, 'Reseed');
    assert.equal(source.tags, 'Brseed');
    assert.equal(await actionStore.get('rss', torrent.hash), undefined);
  });
  for (const mode of ['missing', 'timeout', 'present']) {
    await test('source Brseed lookup: ' + mode, async () => {
      const source = { hash: 'b'.repeat(40), tags: '' };
      const target = { ...torrent, tags: '' };
      const tags = [];
      const items = [source, target]; // Deliberately stale cache when source is missing.
      const client = makeClient({ getMaindata: async () => {}, maindata: { torrents: items }, client: {
        findTorrent: async (url, cookie, hash) => {
          if (hash === target.hash) return target;
          assert.equal(hash, source.hash);
          if (mode === 'timeout') throw new Error('ETIMEDOUT');
          return mode === 'missing' ? undefined : source;
        },
        addTorrentTag: async (url, cookie, hash, tag) => {
          tags.push([hash, tag]);
          items.find(item => item.hash === hash).tags = tag;
          return { statusCode: 200 };
        }
      } });
      global.runningClient = { qb: client };
      await actionStore.save('rss', target.hash, { kind: 'reseed', phase: 'accepted', clientId: 'qb',
        hash: target.hash, sourceHash: source.hash, name: 'example', size: 100, nextTry: 0,
        tagAttempts: 5, failureRecorded: true });
      await makeRss()._recoverActions();
      assert.equal(target.tags, 'Reseed');
      assert.equal(source.tags, mode === 'present' ? 'Brseed' : '');
      assert.equal(tags.some(([, tag]) => tag === 'Brseed'), mode === 'present');
      const pending = await actionStore.get('rss', target.hash);
      if (mode === 'timeout') {
        assert.equal(pending.phase, 'accepted');
        assert.equal(pending.tagAttempts, 6);
      } else {
        assert.equal(pending, undefined);
        assert.ok(records.some(record => record.args.some(value => typeof value === 'string' &&
          value.includes(mode === 'missing' ? '原种已不存在' : '辅种（原种:'))));
      }
    });
  }
  const rotating = extra => makeRss({ allocationMode: 'roundRobin', clientArr: ['a', 'b'], ...extra });
  const normalClient = (id, raw, extra = {}) => makeClient({
    id, alias: id, maxLeechNum: 0,
    maindata: { torrents: [], leechingCount: 0, freeSpaceOnDisk: 100 },
    client: { addTorrent: raw, addTorrentByTorrentFile: raw }, ...extra
  });
  await test('rotation reserves a download slot while torrent-file metadata is still preparing', async () => {
    let release; let started; let adds = 0;
    const prepared = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const a = normalClient('a', async () => { adds++; return { statusCode: 200 }; }, { maxLeechNum: 1 });
    global.runningClient = { a };
    const task = rotating({ clientArr: ['a'], pushTorrentFile: true });
    task._downloadTorrent = async () => { started(); await gate; return { filepath: '/test.torrent', hash: torrent.hash }; };
    const first = task.rss([torrent]);
    await prepared;
    try {
      await rotating({ id: 'second', clientArr: ['a'] }).rss([{ ...torrent, hash: 'c'.repeat(40) }]);
      assert.equal(adds, 0, 'the second task must not send into a preparing slot');
    } finally { release(); await first; }
    assert.equal(adds, 1, 'the owner must not block itself when handing its slot to Client');
  });
  await test('preparation handoff does not count an in-flight add twice', async () => {
    let release; let started; let adds = 0;
    const sent = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const a = normalClient('a', async () => { adds++; started(); await gate; return { statusCode: 200 }; });
    global.runningClient = { a };
    const first = rotating({ clientArr: ['a'], maxClientDownloadCount: 2 }).rss([torrent]);
    await sent;
    const second = rotating({ id: 'second', clientArr: ['a'], maxClientDownloadCount: 2 })
      .rss([{ ...torrent, hash: 'c'.repeat(40) }]);
    try {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(adds, 2);
      assert.equal(a.getLeechingCount(), 2);
    } finally { release(); await Promise.all([first, second]); }
  });
  await test('stopping a preparing RSS releases its slot without sending the cancelled torrent', async () => {
    let release; let started; let adds = 0;
    const prepared = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const a = normalClient('a', async () => { adds++; return { statusCode: 200 }; }, { maxLeechNum: 1 });
    global.runningClient = { a };
    const task = rotating({ clientArr: ['a'], pushTorrentFile: true, rssJob: { stop() {} }, clearCount: { stop() {} } });
    global.runningRss = { rss: task };
    task._downloadTorrent = async () => { started(); await gate; return { filepath: '/test.torrent', hash: torrent.hash }; };
    const first = task.rss([torrent]);
    await prepared;
    try {
      task.destroy();
      await rotating({ id: 'second', clientArr: ['a'] }).rss([{ ...torrent, hash: 'c'.repeat(40) }]);
      assert.equal(adds, 1, 'the cancelled preparation must release its slot immediately');
    } finally { release(); await first; }
    assert.equal(adds, 1);
  });
  await test('rotation reconciles an uncertain add on the original qB without resending or rotating recovery', async () => {
    const added = [];
    const accepted = [];
    const a = normalClient('a', async () => { added.push('a'); accepted.push(torrent); throw new Error('reset after accept'); },
      { findTorrent: async hash => accepted.find(item => item.hash === hash) });
    const b = normalClient('b', async () => { added.push('b'); return { statusCode: 200 }; });
    global.runningClient = { a, b };
    const task = rotating();
    await task.rss([torrent]);
    assert.equal((await actionStore.get('rss', torrent.hash)).clientId, 'a');
    await rotating({ id: 'second' }).rss([{ ...torrent, hash: 'c'.repeat(40) }]);
    const stored = await actionStore.get('rss', torrent.hash);
    stored.nextTry = 0;
    await actionStore.save('rss', torrent.hash, stored);
    await task._recoverActions();
    assert.deepEqual(added, ['a', 'b']);
    assert.equal(await actionStore.get('rss', torrent.hash), undefined);
  });
  await test('normal retry waits on the original downloader when another task holds its preparation slot', async () => {
    let release; let started;
    const added = [];
    const prepared = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const a = normalClient('a', async () => { added.push('a'); return { statusCode: 200 }; }, { findTorrent: async () => undefined });
    const b = normalClient('b', async () => { added.push('b'); return { statusCode: 200 }; });
    global.runningClient = { a, b };
    const fresh = rotating({ id: 'fresh', clientArr: ['a'], maxClientDownloadCount: 1, pushTorrentFile: true });
    fresh._downloadTorrent = async () => { started(); await gate; return { filepath: '/fresh.torrent', hash: torrent.hash }; };
    const running = fresh.rss([torrent]);
    await prepared;
    const retryItem = { ...torrent, hash: 'c'.repeat(40) };
    await actionStore.save('retry', retryItem.hash, {
      clientId: 'a', hash: retryItem.hash, kind: 'normal', phase: 'retry', attempts: 1, nextTry: 0
    });
    try {
      await rotating({ id: 'retry', maxClientDownloadCount: 1 }).rss([retryItem]);
      assert.deepEqual(added, [], 'a fixed-client retry must wait, not steal or switch the preparing slot');
      assert.equal((await actionStore.get('retry', retryItem.hash)).attempts, 1);
    } finally { release(); await running; }
    assert.deepEqual(added, ['a']);
  });
  await test('normal retry owns a preparation slot but does not advance the rotation order', async () => {
    let release; let started;
    const added = [];
    const prepared = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const a = normalClient('a', async () => { added.push('a'); return { statusCode: 200 }; });
    const b = normalClient('b', async () => { added.push('b'); return { statusCode: 200 }; }, { findTorrent: async () => undefined });
    global.runningClient = { a, b };
    await actionStore.save('retry', torrent.hash, {
      clientId: 'b', hash: torrent.hash, kind: 'normal', phase: 'retry', attempts: 1, nextTry: 0
    });
    const task = rotating({ id: 'retry', maxClientDownloadCount: 1, pushTorrentFile: true });
    task._downloadTorrent = async () => { started(); await gate; return { filepath: '/retry.torrent', hash: torrent.hash }; };
    const running = task.rss([torrent]);
    await prepared;
    try {
      await rotating({ id: 'fresh', clientArr: ['b'], maxClientDownloadCount: 1 }).rss([{ ...torrent, hash: 'c'.repeat(40) }]);
      assert.deepEqual(added, []);
    } finally { release(); await running; }
    await rotating({ id: 'next', clientArr: ['b', 'a'] }).rss([{ ...torrent, hash: 'd'.repeat(40) }]);
    assert.deepEqual(added, ['b', 'b'], 'retry must not make b newer in rotation history');
  });
  await test('a stopped RSS cannot reserve after its asynchronous reseed metadata request fails', async () => {
    let failMetadata; let started; let releaseFree; let adds = 0;
    const previousLookup = rssApi.getTorrentNameByBencode;
    const previousScrape = util.scrapeFree;
    const prepared = new Promise(resolve => { started = resolve; });
    const metadata = new Promise((_resolve, reject) => { failMetadata = reject; });
    const freeGate = new Promise(resolve => { releaseFree = resolve; });
    rssApi.getTorrentNameByBencode = async () => { started(); return metadata; };
    util.scrapeFree = async () => { await freeGate; return true; };
    const source = { hash: 'b'.repeat(40), name: 'data', size: 100, completed: 100, savePath: '/existing' };
    const a = normalClient('a', async () => { adds++; return { statusCode: 200 }; }, {
      maxLeechNum: 1, maindata: { torrents: [source], leechingCount: 0, freeSpaceOnDisk: 100 }
    });
    global.runningClient = { a };
    const stopped = rotating({ autoReseed: true, reseedClients: ['a'], clientArr: ['a'], scrapeFree: true,
      rssJob: { stop() {} }, clearCount: { stop() {} } });
    global.runningRss = { rss: stopped };
    const running = stopped.rss([torrent]);
    await prepared;
    try {
      stopped.destroy();
      failMetadata(new Error('lookup failed after stopping'));
      await new Promise(resolve => setImmediate(resolve));
      await rotating({ id: 'active', clientArr: ['a'] }).rss([{ ...torrent, hash: 'c'.repeat(40) }]);
      assert.equal(adds, 1, 'a stopped task must not block a live task with a new preparation reservation');
    } finally {
      releaseFree(); await running;
      rssApi.getTorrentNameByBencode = previousLookup;
      util.scrapeFree = previousScrape;
    }
  });
  process.exitCode = failed ? 1 : 0;
})();
