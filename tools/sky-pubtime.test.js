const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = path.resolve(__dirname, '../app/common/Rss.js');
const requireReal = createRequire(filename);
let records, logs, journal, now;
const util = { getRecord: async () => undefined, runRecord: async (sql, args) => records.push(args),
  sleep: async () => {}, uuid: { v4: () => 'random' } };
const actions = { get: async (id, hash) => journal.get(hash),
  save: async (id, hash, action) => journal.set(hash, JSON.parse(JSON.stringify(action))),
  remove: async (id, hash) => journal.delete(hash),
  list: async () => [...journal].map(([hash, action]) => ({ hash, action })) };
const rssApi = {};
const logger = { info: (...args) => logs.push(args), error: (...args) => logs.push(args) };
const mocks = { '../libs/util': util, '../libs/rss': rssApi, '../libs/logger': logger,
  '../libs/rss-actions': actions, '../libs/redis': {}, moment: () => ({ unix: () => now }), './Push': class {} };
const mod = { exports: {} };
vm.runInThisContext('(function(require,module,exports,__dirname,__filename){' + fs.readFileSync(filename, 'utf8') + '\n})', { filename })(
  name => Object.hasOwn(mocks, name) ? mocks[name] : requireReal(name), mod, mod.exports, path.dirname(filename), filename);
const Rss = mod.exports;
const feedHash = 'a'.repeat(40), sourceHash = 'b'.repeat(40), actualHash = 'c'.repeat(40);
const pubTag = 'SKYPubTime-6000';
const setup = (options = {}) => {
  records = []; logs = []; journal = new Map(); now = 10000;
  const items = options.reseed ? [{ hash: sourceHash, name: 'resource', size: 100, completed: 100, savePath: '/data', tags: 'keep' }] : [];
  if (options.existing) items.push({ hash: actualHash, category: 'SKY', tags: 'keep' });
  const sends = [], writes = [];
  let refreshes = 0, failTag = options.failTag;
  const client = { id: 'qb', alias: 'qb', status: true, _client: { type: 'qBittorrent' },
    maindata: { torrents: items, leechingCount: 0 },
    findTorrent: async hash => {
      if (options.lookupFailure && !sends.length) throw new Error('query unavailable');
      return items.find(item => item.hash === hash);
    },
    getMaindata: async () => {
      refreshes++;
      if (options.delay && sends.length && refreshes >= 3 && !items.some(t => t.hash === actualHash)) addItem();
    },
    addTorrent: async (...args) => { sends.push(args); if (!options.delay) addItem(); return { statusCode: 200 }; },
    addTorrentByTorrentFile: async (...args) => { sends.push(args); addItem(); return { statusCode: 200 }; },
    addTorrentTag: async (hash, tag) => {
      writes.push([hash, tag]);
      if (tag.startsWith('SKYPubTime-') && failTag) {
        if (failTag === 'silent') return { statusCode: 200 };
        throw new Error('tag connection reset');
      }
      const item = items.find(t => t.hash === hash);
      assert.ok(item, 'must write to an actual qB hash');
      item.tags = [...new Set((item.tags || '').split(',').map(t => t.trim()).filter(Boolean).concat(tag))].join(', ');
      return { statusCode: 200 };
    }
  };
  function addItem () {
    if (!items.some(t => t.hash === actualHash)) items.push({ hash: actualHash, name: 'resource', category: options.actualCategory || 'SKY', tags: 'Brseed, Reseed, keep' });
  }
  global.runningClient = { qb: client };
  rssApi.getTorrentNameByBencode = async () => ({ exists: true, name: 'resource', hash: actualHash, size: 100 });
  const task = Object.assign(Object.create(Rss.prototype), {
    id: 'rss', alias: 'rss', _rss: {}, category: options.category || 'SKY', tag: '',
    autoReseed: !!options.reseed, onlyReseed: !!options.reseed, reseedClients: ['qb'], acceptRules: [],
    uploadLimit: 2000000, downloadLimit: 0, addCount: 0,
    pushTorrentFile: !!options.file, ntf: { addTorrent: async () => {}, addTorrentError: async () => { throw new Error('must not report a tag failure as an add failure'); } }
  });
  task._downloadTorrent = async () => ({ filepath: 'fixture.torrent', hash: actualHash });
  const torrent = { hash: feedHash, name: 'resource', size: 100, url: 'https://feed.example/download', link: '', pubTime: 6000 };
  return { task, client, torrent, items, sends, writes, recover: () => { failTag = false; now += 1000; } };
};
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log('PASS ' + name); } catch (error) { failed++; console.error('FAIL ' + name, error); }
};
(async () => {
  for (const [name, options] of [['URL', {}], ['file', { file: true }], ['reseed', { reseed: true }]]) {
    await test('SKY publication tag: ' + name + ' uses actual hash and preserves all existing tags', async () => {
      const s = setup(options);
      await s.task._pushTorrent(s.torrent, s.client);
      assert.equal(s.sends.length, 1);
      assert.equal(s.sends[0][1], actualHash);
      assert.equal(s.sends[0][3], 2000000, 'initial upload limit stays unchanged');
      const tags = s.items.find(t => t.hash === actualHash).tags.split(',').map(t => t.trim());
      for (const tag of ['Brseed', 'Reseed', 'keep', pubTag]) assert.ok(tags.includes(tag));
      assert.ok(!s.writes.some(([hash, tag]) => hash === sourceHash && tag.startsWith('SKYPubTime-')));
    });
  }
  await test('SKY publication tag waits for qB registration', async () => {
    const s = setup({ delay: true }); await s.task._pushTorrent(s.torrent, s.client);
    assert.ok(s.items.find(t => t.hash === actualHash).tags.includes(pubTag));
  });
  await test('file hashes are normalized before sending and verifying the label', async () => {
    const s = setup({ file: true }); s.task._downloadTorrent = async () => ({ filepath: 'fixture.torrent', hash: actualHash.toUpperCase() });
    await s.task._pushTorrent(s.torrent, s.client);
    assert.equal(s.sends[0][1], actualHash);
    assert.ok(s.writes.some(([hash, tag]) => hash === actualHash && tag === pubTag));
  });
  await test('metadata failure skips the time label without failing the URL add', async () => {
    const s = setup(); s.task._downloadTorrent = async () => { throw new Error('metadata unavailable'); };
    await s.task._pushTorrent(s.torrent, s.client);
    assert.equal(s.sends.length, 1); assert.equal(s.writes.length, 0);
    assert.ok(records.every(args => args[8] === 1));
  });
  await test('the custom rewritten URL is used to resolve the actual hash', async () => {
    const s = setup(); s.task.useCustomRegex = true; s.task.regexStr = '/download/'; s.task.replaceStr = 'rewritten';
    const lookups = []; s.task._downloadTorrent = async url => { lookups.push(url); return { hash: actualHash }; };
    await s.task._pushTorrent(s.torrent, s.client);
    assert.deepEqual(lookups, ['https://feed.example/rewritten']);
    assert.equal(s.sends[0][0], 'https://feed.example/rewritten');
  });
  for (const value of [undefined, null, '', false, NaN, Infinity, -1, 0, 10001, 6000.5, 6000000]) {
    await test('invalid RSS publication time is skipped: ' + String(value), async () => {
      const s = setup(); s.torrent.pubTime = value;
      await s.task._pushTorrent(s.torrent, s.client);
      assert.equal(s.sends.length, 1);
      assert.ok(!s.writes.some(([, tag]) => tag.startsWith('SKYPubTime-')));
      assert.ok(logs.some(args => args.join(' ').includes('SKY')));
    });
  }
  for (const options of [{ existing: true }, { lookupFailure: true }, { actualCategory: 'OTHER' }]) {
    await test('old or unconfirmed or non-SKY qB torrent gets no publication tag: ' + JSON.stringify(options), async () => {
      const s = setup(options); await s.task._pushTorrent(s.torrent, s.client);
      assert.ok(!s.writes.some(([, tag]) => tag.startsWith('SKYPubTime-')));
    });
  }
  await test('a selection rule overriding the task category to SKY is handled', async () => {
    const s = setup({ category: 'OTHER' }); await s.task._pushTorrent(s.torrent, s.client, { category: 'SKY' });
    assert.ok(s.writes.some(([, tag]) => tag === pubTag));
  });
  await test('a selection rule overriding SKY to another category is not handled', async () => {
    const s = setup(); await s.task._pushTorrent(s.torrent, s.client, { category: 'OTHER' });
    assert.ok(!s.writes.some(([, tag]) => tag.startsWith('SKYPubTime-')));
  });
  for (const failTag of [true, 'silent']) {
    await test('failed or unconfirmed publication tag remains accepted and retries without adding again: ' + failTag, async () => {
      const s = setup({ failTag }); await s.task._pushTorrent(s.torrent, s.client);
      assert.equal(journal.get(feedHash).phase, 'accepted');
      assert.ok(records.length && records.every(args => args[8] === 1));
      s.recover(); await s.task._recoverActions();
      assert.equal(s.sends.length, 1);
      assert.ok(s.items.find(t => t.hash === actualHash).tags.includes(pubTag));
      assert.equal(journal.size, 0);
    });
  }
  await test('historical accepted actions without publication metadata are never backfilled', async () => {
    const s = setup({ existing: true });
    await journal.set(feedHash, { clientId: 'qb', hash: actualHash, kind: 'normal', phase: 'accepted', nextTry: 0, category: 'SKY', name: 'resource', size: 100 });
    await s.task._recoverActions(); assert.deepEqual(s.writes, []);
  });
  for (const reseed of [false, true]) {
    await test('late qB registration keeps waiting across RSS restart without re-adding: ' + (reseed ? 'reseed' : 'normal'), async () => {
      const s = setup({ delay: true, reseed }); s.client.getMaindata = async () => {};
      await s.task._pushTorrent(s.torrent, s.client);
      assert.equal(journal.get(feedHash).phase, 'accepted');
      s.recover(); await s.task._recoverActions();
      const waiting = journal.get(feedHash);
      assert.equal(waiting.phase, 'accepted');
      assert.equal(waiting.registrationConfirmed, false);
      assert.ok(waiting.nextTry > now);
      s.items.push({ hash: actualHash, category: 'SKY', tags: 'Reseed, keep' });
      now += 4000;
      const restarted = Object.assign(Object.create(Rss.prototype), s.task);
      await restarted._recoverActions();
      assert.equal(s.sends.length, 1);
      assert.ok(s.items.find(t => t.hash === actualHash).tags.includes(pubTag));
      assert.equal(journal.size, 0);
    });
  }
  await test('an observed qB torrent later deleted stops publication recovery', async () => {
    const s = setup({ failTag: true }); await s.task._pushTorrent(s.torrent, s.client);
    assert.equal(journal.get(feedHash).registrationConfirmed, true);
    s.items.splice(0, s.items.length); s.recover(); await s.task._recoverActions();
    assert.equal(journal.get(feedHash).phase, 'stopped');
    assert.equal(s.sends.length, 1);
  });
  await test('unregistered SKY torrents stop after 24 absence checks without re-adding', async () => {
    const s = setup({ delay: true }); s.client.getMaindata = async () => {};
    await s.task._pushTorrent(s.torrent, s.client);
    for (let check = 1; check <= 24; check++) {
      now += 4000;
      await s.task._recoverActions();
      assert.equal(journal.get(feedHash).phase, check < 24 ? 'accepted' : 'stopped');
    }
    assert.equal(journal.get(feedHash).registrationChecks, 24);
    assert.equal(s.sends.length, 1);
    s.items.push({ hash: actualHash, category: 'SKY', tags: '' }); now += 4000;
    await s.task._recoverActions();
    assert.equal(s.writes.length, 0, 'stopped tasks must not restart themselves');
  });
  await test('legacy accepted actions without an explicit registration flag retain the stop behavior', async () => {
    const s = setup();
    journal.set(feedHash, { clientId: 'qb', hash: actualHash, kind: 'normal', phase: 'accepted', nextTry: 0,
      category: 'SKY', skyPubTime: 6000, name: 'resource', size: 100 });
    await s.task._recoverActions();
    assert.equal(journal.get(feedHash).phase, 'stopped');
    assert.equal(s.sends.length, 0);
  });
  const scriptFile = path.join(__dirname, 'sky-pubtime-limit.vertex.js');
  for (const scenario of [
    { name: 'publication age wins over qB added time', tags: 'SKYPubTime-7000', addedTime: 9999, want: 1 },
    { name: 'recent publication stays limited even on an old qB torrent', tags: 'SKYPubTime-7001', addedTime: 1, want: 0 },
    { name: 'missing publication tag never uses qB added time', tags: 'Reseed, Brseed', addedTime: 1, want: 0 },
    { name: 'future publication is skipped', tags: 'SKYPubTime-10001', want: 0 },
    { name: 'milliseconds are not interpreted as publication seconds', tags: 'SKYPubTime-6000000', want: 0 },
    { name: 'conflicting publication labels are skipped', tags: 'SKYPubTime-6000, SKYPubTime-5000', want: 0 },
    { name: 'malformed publication labels are skipped', tags: 'SKYPubTime-NaN', want: 0 },
    { name: 'other categories are skipped', tags: 'SKYPubTime-6000', category: 'OTHER', want: 0 },
    { name: 'already configured live limit is skipped', tags: 'SKYPubTime-6000', up_limit: 480000000, want: 0 },
    { name: 'live category change is honored', tags: 'SKYPubTime-6000', liveCategory: 'OTHER', want: 0 }
  ]) {
    await test('SKY publication timer: ' + scenario.name, async () => {
      const code = fs.readFileSync(scriptFile, 'utf8');
      const item = { hash: actualHash, category: 'SKY', name: 'resource', ...scenario };
      const changed = [];
      const state = { runningClient: { ce555222: {
        status: true, _client: { type: 'qBittorrent' }, maindata: { torrents: [item] },
        findTorrent: async () => ({ ...item, category: item.liveCategory || item.category }),
        setSpeedLimit: async (...args) => { changed.push(args); item.up_limit = args[2]; }
      } } };
      const run = vm.runInNewContext(code, { global: state, logger, Date: { now: () => 10000 * 1000 } });
      await run();
      assert.equal(changed.length, scenario.want);
      if (scenario.want) assert.deepEqual(Array.from(changed[0]), [actualHash, 'upload', 480000000]);
      assert.equal(state.skyPubTimeLimitRunning, false);
    });
  }
  await test('SKY publication timer does not log success when qB fails readback verification', async () => {
    const item = { hash: actualHash, category: 'SKY', name: 'resource', tags: 'SKYPubTime-6000', up_limit: 2000000 };
    const output = [], changes = [];
    const state = { runningClient: { ce555222: { status: true, _client: { type: 'qBittorrent' }, maindata: { torrents: [item] },
      findTorrent: async () => item, setSpeedLimit: async (...args) => changes.push(args) } } };
    const run = vm.runInNewContext(fs.readFileSync(scriptFile, 'utf8'), { global: state,
      logger: { info: text => output.push(['info', text]), error: text => output.push(['error', text]) }, Date: { now: () => 10000 * 1000 } });
    await run(); assert.equal(changes.length, 1);
    assert.ok(output.some(([level]) => level === 'error'));
    assert.ok(!output.some(([level]) => level === 'info'));
    assert.equal(state.skyPubTimeLimitRunning, false);
  });
  await test('SKY publication timer prevents overlapping runs and only uses the configured 20 clients', async () => {
    const code = fs.readFileSync(scriptFile, 'utf8');
    const ids = [...code.matchAll(/'([a-f0-9]{8})'/g)].map(match => match[1]);
    assert.equal(ids.length, 20); assert.equal(new Set(ids).size, 20);
    const item = { hash: actualHash, category: 'SKY', tags: 'SKYPubTime-6000', up_limit: 2000000 };
    let release, sends = 0;
    const qb = { status: true, _client: { type: 'qBittorrent' }, maindata: { torrents: [item] }, findTorrent: async () => item,
      setSpeedLimit: async () => { sends++; await new Promise(resolve => { release = resolve; }); item.up_limit = 480000000; } };
    const state = { runningClient: { ce555222: qb, excluded: { ...qb, setSpeedLimit: async () => assert.fail('unconfigured client must not be modified') } } };
    const run = vm.runInNewContext(code, { global: state, logger, Date: { now: () => 10000 * 1000 } });
    const first = run();
    while (!release) await Promise.resolve();
    await run(); assert.equal(sends, 1); release(); await first;
    assert.equal(state.skyPubTimeLimitRunning, false);
  });
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
