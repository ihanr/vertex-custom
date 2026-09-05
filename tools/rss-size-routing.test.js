const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename.endsWith('app\\common\\Rss.js')) {
    if (request === '../libs/rss' || request === '../libs/redis' || request === '../libs/rss-actions') return {};
    if (request === '../libs/util') return {};
    if (request === '../libs/logger') return { info: () => {}, error: () => {} };
    if (request === 'node-cron') return { schedule: () => ({ stop: () => {} }) };
    if (request === 'bencode') return {};
    if (request === 'moment') return () => ({ unix: () => 0 });
    if (request === './Push') return class Push {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

const Rss = require('../app/common/Rss');
Module._load = originalLoad;

const makeClient = (id, overrides = {}) => ({
  id,
  alias: id,
  status: true,
  avgUploadSpeed: 10,
  avgDownloadSpeed: 20,
  maindata: {
    leechingCount: 1,
    uploadSpeed: 10,
    downloadSpeed: 20,
    freeSpaceOnDisk: 100
  },
  ...overrides
});

const makeRss = (overrides = {}) => Object.assign(Object.create(Rss.prototype), {
  clientArr: ['task-a', 'task-b'],
  clientSortBy: 'leechingCount',
  maxClientUploadSpeed: 0,
  maxClientDownloadSpeed: 0,
  maxClientDownloadCount: 0,
  ...overrides
});

const resetClients = () => {
  global.runningClient = {
    'task-a': makeClient('task-a'),
    'task-b': makeClient('task-b', { maindata: { leechingCount: 3, uploadSpeed: 10, downloadSpeed: 20, freeSpaceOnDisk: 200 } }),
    legacy: makeClient('legacy'),
    'group-a': makeClient('group-a', { maindata: { leechingCount: 4, uploadSpeed: 10, downloadSpeed: 20, freeSpaceOnDisk: 300 } }),
    'group-b': makeClient('group-b', { maindata: { leechingCount: 2, uploadSpeed: 10, downloadSpeed: 20, freeSpaceOnDisk: 400 } })
  };
};

const test = (name, fn) => {
  try {
    resetClients();
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
};

test('rule downloader group overrides legacy and task downloaders', () => {
  const rss = makeRss();
  assert.deepStrictEqual(
    rss._getClientIds({ clientArr: ['group-a', 'group-b'], client: 'legacy' }),
    ['group-a', 'group-b']
  );
  assert.strictEqual(rss._selectClient(rss._getClientIds({ clientArr: ['group-a', 'group-b'], client: 'legacy' })).id, 'group-b');
});

test('legacy single downloader remains a one-client group', () => {
  const rss = makeRss();
  assert.deepStrictEqual(rss._getClientIds({ client: 'legacy' }), ['legacy']);
  assert.strictEqual(rss._selectClient(rss._getClientIds({ client: 'legacy' })).id, 'legacy');
});

test('empty rule downloader group falls back to RSS task downloaders', () => {
  const rss = makeRss();
  assert.deepStrictEqual(rss._getClientIds({ clientArr: [] }), ['task-a', 'task-b']);
  assert.strictEqual(rss._selectClient(rss._getClientIds({ clientArr: [] })).id, 'task-a');
});

test('unavailable downloaders are excluded without falling into another group', () => {
  const rss = makeRss({ maxClientDownloadCount: 2 });
  global.runningClient['group-a'].status = false;
  global.runningClient['group-b'].maindata.leechingCount = 2;
  global.runningClient.legacy.maxUploadSpeed = 10;
  global.runningClient['task-a'].minFreeSpace = 100;
  assert.strictEqual(rss._selectClient(['group-a', 'group-b']), undefined);
  assert.strictEqual(rss._selectClient(['legacy']), undefined);
  assert.strictEqual(rss._selectClient(['task-a']), undefined);
});

test('free disk sorting picks the largest eligible free space', () => {
  const rss = makeRss({ clientSortBy: 'freeSpaceOnDisk' });
  assert.strictEqual(rss._selectClient(['group-a', 'group-b']).id, 'group-b');
});
