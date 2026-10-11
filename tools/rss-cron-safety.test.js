const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const realCron = require('node-cron');

const repo = path.join(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-cron-safety-'));
fs.mkdirSync(path.join(temporary, 'data/rss'), { recursive: true });
const jobs = [];
const logs = [];
const noop = () => {};
const cron = {
  validate: realCron.validate,
  schedule (...args) {
    const job = realCron.schedule(...args);
    jobs.push(job);
    return job;
  }
};
const logger = { info: noop, debug: noop, use: noop, error: (...args) => logs.push(args) };
const util = {
  listPush: () => [], listRssRule: () => [], calSize: () => 0,
  uuid: { v4: () => 'new-task-uuid' }
};

// Keep actual constructors, file writes and node-cron validation/scheduling;
// replace only external services and startup listeners.
function load (relative, dependencies, dirname) {
  const filename = path.join(repo, relative);
  const actualRequire = createRequire(filename);
  const module = { exports: {} };
  const code = '(function (require, module, exports, __dirname) {' + fs.readFileSync(filename, 'utf8') + '\n})';
  vm.runInThisContext(code, { filename })(
    name => Object.prototype.hasOwnProperty.call(dependencies, name) ? dependencies[name] : actualRequire(name),
    module, module.exports, dirname || path.dirname(filename)
  );
  return module.exports;
}

const Push = load('app/common/Push.js', {
  'node-cron': cron, '../libs/logger': logger,
  '../libs/push/wechat': class {}, '../libs/push/slack': class {},
  '../libs/push/telegram': class {}, '../libs/push/ntfy': class {}, '../libs/push/webhook': class {}
});
const Rss = load('app/common/Rss.js', {
  'node-cron': cron, '../libs/util': util, '../libs/logger': logger,
  '../libs/rss': {}, '../libs/redis': {}, '../libs/rss-actions': {}, './Push': Push
});
const RssMod = load('app/model/RssMod.js', {
  'node-cron': cron, '../libs/util': util, '../common/Rss': Rss
}, path.join(temporary, 'model'));
const Script = load('app/common/Script.js', { 'node-cron': cron, '../libs/logger': logger });
const Server = load('app/common/Server.js', {
  '../libs/logger': logger,
  ssh2: { Client: class extends EventEmitter { connect () { this.emit('ready'); } end () {} } }
});
const rssMod = new RssMod();
const valid = { id: 'existing', enable: true, alias: 'RSS test', cron: '0 0 1 1 *', rssUrls: [], cookie: 'private-cookie' };
const existingFile = path.join(temporary, 'data/rss/existing.json');
const addedFile = path.join(temporary, 'data/rss/new.json');

function test (name, run) {
  global.runningRss = {};
  logs.length = 0;
  try {
    run();
    console.log('PASS ' + name);
  } catch (error) {
    console.error('FAIL ' + name + ': ' + error.message);
    process.exitCode = 1;
  } finally {
    for (const job of jobs.splice(0)) job.stop();
    for (const file of [existingFile, addedFile]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
}

try {
  for (const invalidCron of ['not-a-cron', '61 * * * *', '', null, undefined]) {
    test('invalid RSS modify preserves saved config and running instance: ' + String(invalidCron), () => {
      rssMod.modify(valid);
      const before = fs.readFileSync(existingFile, 'utf8');
      const running = global.runningRss.existing;
      const job = running.rssJob;
      assert.throws(() => rssMod.modify({ ...valid, cron: invalidCron }));
      assert.equal(fs.readFileSync(existingFile, 'utf8'), before, 'invalid cron must not overwrite the saved config');
      assert.equal(global.runningRss.existing, running, 'invalid cron must not destroy the working instance');
      assert.equal(job.getStatus(), 'scheduled');
    });
  }

  test('invalid RSS add does not create a file or a running task', () => {
    assert.throws(() => rssMod.add({ ...valid, cron: 'not-a-cron' }));
    assert.equal(fs.existsSync(addedFile), false);
    assert.deepEqual(Object.keys(global.runningRss), []);
  });

  test('disabled RSS rejects an explicitly invalid cron before saving', () => {
    assert.throws(() => rssMod.add({ enable: false, cron: 'not-a-cron' }));
    assert.equal(fs.existsSync(addedFile), false);
  });

  test('legacy disabled RSS without a cron remains editable', () => {
    rssMod.modify({ id: 'existing', enable: false });
    assert.equal(JSON.parse(fs.readFileSync(existingFile)).enable, false);
    assert.deepEqual(Object.keys(global.runningRss), []);
  });

  test('valid five- and six-field RSS cron values still save and replace jobs', () => {
    rssMod.add({ ...valid, tag: ' rss ' });
    const first = global.runningRss.new;
    const firstJob = first.rssJob;
    assert.equal(firstJob.getStatus(), 'scheduled');
    assert.equal(JSON.parse(fs.readFileSync(addedFile)).tag, 'rss');
    rssMod.modify({ ...valid, id: 'new', cron: '15 0 0 1 1 *' });
    assert.equal(firstJob.getStatus(), 'stoped');
    assert.notEqual(global.runningRss.new, first);
    assert.equal(global.runningRss.new.rssJob.getStatus(), 'scheduled');
    assert.equal(JSON.parse(fs.readFileSync(addedFile)).cron, '15 0 0 1 1 *');
  });

  function start (options = {}) {
    let listening = false;
    let cookieCloudStarted = false;
    const setting = { username: 'test', password: 'private-password', webhookPushTo: 'bad-push', doubanPush: 'good-push' };
    const startupUtil = {
      listPush: () => options.pushes || [], listClient: () => [],
      listRss: () => options.rss || [], listServer: () => [{ id: 'later-server', enable: true }],
      listSite: () => [], listDouban: () => [],
      listCrontabJavaScript: () => [
        { id: 'bad-script', enable: true, cron: 'not-a-cron' },
        { id: 'good-script', enable: true, cron: '0 0 1 1 *', script: '() => {}' }
      ],
      listWatch: () => [], listIRC: () => [],
      initCookieCloud: () => { cookieCloudStarted = true; }
    };
    load('app/app.js', {
      express: Object.assign(() => ({}), { Router: () => ({}) }),
      fs: { readFileSync: file => JSON.stringify(path.basename(file) === 'setting.json' ? setting : {}) },
      http: { createServer: () => ({ listen: () => { listening = true; return {}; } }) },
      https: {}, 'express-ws': noop, 'node-cron': cron, 'child_process': { execSync: noop },
      './common/Push': Push, './common/Rss': Rss, './common/Server': Server, './common/Script': Script,
      './common/Client': class {}, './common/Site': class {}, './common/Douban': class {},
      './common/Watch': class {}, './common/IRC': class {},
      './libs/site': {}, './libs/logger': logger, './libs/util': startupUtil,
      './libs/config': {}, './routes/router.js': noop
    });
    return { listening, cookieCloudStarted };
  }

  test('bad persisted RSS and Script cron values do not abort later tasks or startup', () => {
    const result = start({ rss: [{ ...valid, id: 'bad-rss', cron: 'not-a-cron' }, { ...valid, id: 'good-rss' }] });
    assert.equal(global.runningRss['bad-rss'], undefined);
    assert.ok(global.runningRss['good-rss'] instanceof Rss, 'later RSS must initialize');
    assert.ok(global.runningServer['later-server'] instanceof Server, 'later task types must initialize');
    assert.equal(global.runningScript['bad-script'], undefined);
    assert.ok(global.runningScript['good-script'] instanceof Script);
    assert.equal(result.cookieCloudStarted, true);
    assert.equal(result.listening, true);
    assert.ok(logs.some(args => args.join(' ').includes('bad-rss')), 'log must identify the skipped RSS');
    assert.ok(logs.some(args => args.join(' ').includes('bad-script')), 'log must identify the skipped Script');
    assert.ok(!JSON.stringify(logs).includes('private-cookie'));
    assert.ok(!JSON.stringify(logs).includes('private-password'));
  });

  test('bad global push cron does not abort the other push or remaining tasks', () => {
    global.webhookPush = undefined;
    global.doubanPush = undefined;
    const result = start({ pushes: [
      { id: 'bad-push', type: 'webhook', clearCountCron: 'not-a-cron' },
      { id: 'good-push', type: 'webhook', clearCountCron: '0 0 1 1 *' }
    ] });
    assert.equal(global.webhookPush, undefined);
    assert.ok(global.doubanPush instanceof Push);
    assert.ok(global.runningServer['later-server'] instanceof Server);
    assert.ok(global.runningScript['good-script'] instanceof Script);
    assert.equal(result.cookieCloudStarted, true);
    assert.ok(logs.some(args => args.join(' ').includes('bad-push')));
  });
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
