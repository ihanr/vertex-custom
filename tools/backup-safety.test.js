const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const tar = require('tar');
let Database = require('better-sqlite3');
try { const probe = new Database(':memory:'); probe.close(); } catch (_) {
  const { DatabaseSync } = require('node:sqlite');
  Database = class {
    constructor(file, options = {}) { this.db = new DatabaseSync(file, { readOnly: !!options.readonly }); }
    exec(sql) { return this.db.exec(sql); }
    prepare(sql) { return this.db.prepare(sql); }
    pragma(sql, options = {}) { const rows = this.db.prepare('PRAGMA ' + sql).all(); return options.simple ? Object.values(rows[0])[0] : rows; }
    close() { this.db.close(); }
    backup(file) { return require('node:sqlite').backup(this.db, file); }
  };
  console.log('INFO backup tests use real node:sqlite because local better-sqlite3 binding is unavailable');
}
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === 'better-sqlite3' && parent.filename.endsWith(path.join('libs', 'backup.js'))) return Database;
  return originalLoad.call(this, name, parent, isMain);
};
const backup = require('../app/libs/backup');
Module._load = originalLoad;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-restore-test-'));
const root = path.join(temp, 'live');
const source = path.join(temp, 'source', 'vertex');
const mkdir = name => fs.mkdirSync(name, { recursive: true });
const read = name => fs.readFileSync(name, 'utf8');
(async () => {
  for (const directory of ['db', 'data', 'config']) { mkdir(path.join(source, directory)); mkdir(path.join(root, directory)); }
  fs.writeFileSync(path.join(root, 'data', 'original'), 'keep me');
  fs.writeFileSync(path.join(source, 'data', 'setting.json'), '{}');
  fs.writeFileSync(path.join(source, 'config', 'config.yaml'), 'port: 3000\n');
  fs.writeFileSync(path.join(temp, 'outside'), 'not a backup');
  const unsafe = path.join(temp, 'unsafe.tar');
  await tar.c({ file: unsafe, cwd: temp }, ['outside']);
  await assert.rejects(backup.stageRestore(unsafe, root), /不安全/);
  const incomplete = path.join(temp, 'incomplete.tar.gz');
  await tar.c({ file: incomplete, cwd: path.dirname(source), gzip: true }, ['vertex']);
  await assert.rejects(backup.stageRestore(incomplete, root));
  assert.equal(read(path.join(root, 'data', 'original')), 'keep me');
  assert.ok(!fs.existsSync(path.join(root, '.restore-pending.json')));
  const db = new Database(path.join(source, 'db', 'sql.db'));
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE torrents (hash TEXT, record_type INTEGER)');
  db.exec("INSERT INTO torrents VALUES ('live-wal-row', 1)");
  const loadActions = connection => {
    delete require.cache[require.resolve('../app/libs/rss-actions')];
    Module._load = function (name, parent, isMain) {
      if (name === './util' && parent.filename.endsWith(path.join('libs', 'rss-actions.js'))) return {
        runRecord: async (sql, values = []) => connection.prepare(sql).run(...values),
        getRecord: async (sql, values = []) => connection.prepare(sql).get(...values),
        getRecords: async (sql, values = []) => connection.prepare(sql).all(...values)
      };
      return originalLoad.call(this, name, parent, isMain);
    };
    try { return require('../app/libs/rss-actions'); } finally { Module._load = originalLoad; }
  };
  await loadActions(db).save('task', 'hash', { phase: 'accepted', sourceHash: 'source', clientId: 'qb' });
  const snapshot = await backup.createArchive(source, false, file => db.backup(file));
  const unpack = path.join(temp, 'snapshot');
  mkdir(unpack);
  try {
    await tar.x({ file: snapshot, cwd: unpack });
    const saved = new Database(path.join(unpack, 'vertex', 'db', 'sql.db'), { readonly: true });
    assert.equal(saved.prepare('SELECT hash FROM torrents').all()[0].hash, 'live-wal-row');
    assert.equal(JSON.parse(saved.prepare('SELECT data FROM rss_actions').get().data).phase, 'accepted');
    saved.close();
  } finally { fs.rmSync(path.dirname(snapshot), { recursive: true, force: true }); }
  db.close();
  const reopened = new Database(path.join(source, 'db', 'sql.db'));
  try {
    const store = loadActions(reopened);
    assert.deepEqual(await store.get('task', 'hash'), { phase: 'accepted', sourceHash: 'source', clientId: 'qb' });
    assert.equal((await store.list('task')).length, 1);
    await store.remove('task', 'hash');
    assert.equal(await store.get('task', 'hash'), undefined);
  } finally { reopened.close(); }
  const archive = path.join(temp, 'valid.tar.gz');
  await tar.c({ file: archive, cwd: path.dirname(source), gzip: true }, ['vertex']);
  await backup.stageRestore(archive, root);
  assert.equal(read(path.join(root, 'data', 'original')), 'keep me');
  await assert.rejects(backup.stageRestore(archive, root), /待恢复/);
  const pending = JSON.parse(read(path.join(root, '.restore-pending.json')));
  await backup.applyRestore(root);
  assert.equal(read(path.join(root, 'data', 'setting.json')), '{}');
  assert.equal(read(path.join(root, pending.previous, 'data', 'original')), 'keep me');
  assert.ok(!fs.existsSync(path.join(root, '.restore-pending.json')));
  // Simulate process death after the first directory replacement. Startup must
  // roll back the partial application rather than treating it as a fresh restore.
  await backup.stageRestore(archive, root);
  const jobPath = path.join(root, '.restore-pending.json');
  const job = JSON.parse(read(jobPath));
  job.phase = 'applying';
  fs.writeFileSync(jobPath, JSON.stringify(job));
  mkdir(path.join(root, job.previous));
  fs.renameSync(path.join(root, 'data'), path.join(root, job.previous, 'data'));
  fs.renameSync(path.join(root, job.stage, 'vertex', 'data'), path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'partial'), 'not committed');
  await backup.applyRestore(root);
  assert.equal(read(path.join(root, 'data', 'setting.json')), '{}');
  assert.ok(!fs.existsSync(path.join(root, 'data', 'partial')));
  assert.ok(!fs.existsSync(jobPath));
  // Invalid manifest paths must not touch anything outside the named root.
  fs.writeFileSync(jobPath, JSON.stringify({ ...job, stage: '..', phase: 'ready' }));
  await assert.rejects(backup.applyRestore(root));
  assert.equal(read(path.join(root, 'data', 'setting.json')), '{}');
  console.log('PASS A02/A08: WAL snapshot, durable journal reopen, invalid backup rejection, retained originals and interrupted rollback');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.rmSync(temp, { recursive: true, force: true });
});
