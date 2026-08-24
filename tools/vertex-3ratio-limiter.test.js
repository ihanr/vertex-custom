const assert = require('node:assert/strict');
const fs = require('node:fs');
const limiter = require('./vertex-3ratio-limiter');

const makeClient = (alias, torrents, calls, overrides = {}) => ({
  alias,
  _client: { type: 'qBittorrent' },
  status: true,
  clientUrl: `http://${alias}`,
  cookie: `sid=${alias}`,
  maindata: { torrents },
  client: {
    setSpeedLimit: async (_url, _cookie, hash, type, speed) => {
      calls.push(['limit', alias, hash, type, speed]);
      return { statusCode: overrides.limitStatus || 200 };
    },
    addTorrentTag: async (_url, _cookie, hash, tag) => {
      calls.push(['tag', alias, hash, tag]);
      return { statusCode: 200 };
    }
  },
  ...overrides
});

const eligible = {
  hash: 'eligible',
  name: 'eligible MTV torrent',
  category: 'MTV',
  progress: 1,
  state: 'uploading',
  uploaded: 330,
  totalSize: 100,
  tags: ''
};

const run = async () => {
  const calls = [];
  const logs = [];
  global.logger = {
    info: (...args) => logs.push(['info', ...args]),
    error: (...args) => logs.push(['error', ...args])
  };
  global.runningClient = {
    first: makeClient('HZ-01', [
      eligible,
      { ...eligible, hash: 'eligible-aud', name: 'eligible AUD torrent', category: 'AUD' },
      { ...eligible, hash: 'tagged', category: 'HH', tags: 'rss,3ratio' },
      { ...eligible, hash: 'excluded-category', category: 'OTHER' },
      { ...eligible, hash: 'not-seeding', category: 'TTG', state: 'downloading' },
      { ...eligible, hash: 'under-ratio', category: 'MTV', uploaded: 329 },
      { ...eligible, hash: 'zero-size', category: 'MTV', totalSize: 0 }
    ], calls),
    second: makeClient('NOT-SELECTED', [{ ...eligible, hash: 'outside-scope' }], calls),
    third: makeClient('HZ-02', [{ ...eligible, hash: 'offline' }], calls, { status: false }),
    fourth: makeClient('HZ-03', [{ ...eligible, hash: 'rejected-limit' }], calls, { limitStatus: 202 })
  };

  const result = await limiter({ dryRun: false });

  assert.deepEqual(calls, [
    ['limit', 'HZ-01', 'eligible', 'upload', 10240],
    ['tag', 'HZ-01', 'eligible', '3ratio'],
    ['limit', 'HZ-01', 'eligible-aud', 'upload', 10240],
    ['tag', 'HZ-01', 'eligible-aud', '3ratio'],
    ['limit', 'HZ-03', 'rejected-limit', 'upload', 10240]
  ]);
  assert.equal(result.limited, 2);
  assert.equal(result.skipped, 6);
  assert.equal(result.failed, 1);
  assert.equal(logs.filter(([level]) => level === 'error').length, 1);

  const dryRunCalls = [];
  const dryRunLogs = [];
  global.logger = {
    info: (...args) => dryRunLogs.push(args),
    error: (...args) => dryRunLogs.push(args)
  };
  global.runningClient = {
    first: makeClient('HZ-01', [{ ...eligible, hash: 'dry-run' }], dryRunCalls)
  };
  const vertexTask = eval(fs.readFileSync('./tools/vertex-3ratio-limiter.vertex.js', 'utf8'));
  await vertexTask();
  assert.deepEqual(dryRunCalls, []);
  assert.ok(dryRunLogs.some(([message]) => String(message).includes('[3ratio][演练]')));
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
