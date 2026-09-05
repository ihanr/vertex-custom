const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tar = require('tar');
const yaml = require('js-yaml');
const Database = require('better-sqlite3');
const os = require('os');

const names = ['db', 'data', 'config', 'torrents'];
const copyDirectory = (source, target) => {
  if (!fs.lstatSync(source).isDirectory()) throw new Error('备份源不是普通目录');
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(source)) {
    const from = path.join(source, name);
    const to = path.join(target, name);
    const stat = fs.lstatSync(from);
    if (stat.isDirectory()) copyDirectory(from, to);
    else if (stat.isFile()) fs.copyFileSync(from, to);
    else throw new Error('备份源包含链接或特殊文件，拒绝跟随');
  }
};

exports.createArchive = async function (root, includeTorrents, snapshotDatabase) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-backup-'));
  const staged = path.join(temporary, 'vertex');
  try {
    for (const name of ['data', 'config', ...(includeTorrents ? ['torrents'] : [])]) {
      copyDirectory(path.join(root, name), path.join(staged, name));
    }
    fs.mkdirSync(path.join(staged, 'db'));
    await snapshotDatabase(path.join(staged, 'db', 'sql.db'));
    validate(staged);
    const archive = path.join(temporary, 'Vertex-backups.tar.gz');
    await tar.c({ file: archive, cwd: temporary, gzip: true }, ['vertex']);
    return archive;
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
};
const pendingPath = root => path.join(root, '.restore-pending.json');
const writeJob = (file, job) => {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(job));
  fs.renameSync(temporary, file);
};
const validate = directory => {
  let db;
  try {
    for (const name of ['db/sql.db', 'data/setting.json', 'config/config.yaml']) {
      if (!fs.lstatSync(path.join(directory, name)).isFile()) throw new Error();
    }
    const settings = JSON.parse(fs.readFileSync(path.join(directory, 'data/setting.json'), 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error();
    if (!yaml.load(fs.readFileSync(path.join(directory, 'config/config.yaml'), 'utf8'))) throw new Error();
    db = new Database(path.join(directory, 'db/sql.db'), { readonly: true, fileMustExist: true });
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error();
    db.prepare('SELECT hash, record_type FROM torrents LIMIT 0').all();
  } catch (_) {
    throw new Error('备份缺少必要文件、配置无效或数据库校验失败；未替换运行数据');
  } finally {
    if (db) db.close();
  }
};

exports.stageRestore = async function (archive, root) {
  root = fs.realpathSync(root);
  if (fs.existsSync(pendingPath(root))) throw new Error('已有待恢复备份，请先重启完成或处理待恢复任务');
  let bytes = 0;
  let entries = 0;
  let invalid;
  await tar.t({
    file: archive,
    strict: true,
    onentry: entry => {
      const parts = entry.path.replace(/\/$/, '').split('/');
      if (parts[0] !== 'vertex' || parts.some(p => p === '..' || p === '.' || p.includes('\\') || p.includes(':')) ||
        (parts.length > 1 && !names.includes(parts[1])) || !['File', 'Directory'].includes(entry.type)) {
        invalid = new Error('备份包含不安全路径、链接或不支持的目录');
      }
      bytes += entry.size;
      if (++entries > 100000 || bytes > 8 * 1024 * 1024 * 1024) invalid = new Error('备份解压大小或文件数量超限');
    }
  });
  if (invalid) throw invalid;
  const stage = fs.mkdtempSync(path.join(root, '.restore-stage-'));
  try {
    await tar.x({ file: archive, cwd: stage, strict: true, preservePaths: false });
    validate(path.join(stage, 'vertex'));
    const folders = names.filter(name => fs.existsSync(path.join(stage, 'vertex', name)));
    const originals = {};
    for (const name of folders) {
      const target = path.join(root, name);
      originals[name] = fs.existsSync(target);
      if (originals[name] && !fs.lstatSync(target).isDirectory()) throw new Error('运行目录不是普通目录，拒绝自动恢复');
    }
    const job = {
      phase: 'ready',
      stage: path.basename(stage),
      previous: '.restore-previous-' + crypto.randomBytes(8).toString('hex'),
      folders,
      originals
    };
    // Exclusive publication: concurrent uploads may not replace an existing job.
    fs.writeFileSync(pendingPath(root), JSON.stringify(job), { flag: 'wx' });
    return job;
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
};

exports.applyRestore = async function (root) {
  root = fs.realpathSync(root);
  const file = pendingPath(root);
  if (!fs.existsSync(file)) return '没有待恢复备份';
  const job = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!/^\.restore-stage-[a-zA-Z0-9]+$/.test(job.stage) ||
      !/^\.restore-previous-[a-f0-9]+$/.test(job.previous) ||
      !['ready', 'applying', 'committed'].includes(job.phase) ||
      !Array.isArray(job.folders) || new Set(job.folders).size !== job.folders.length ||
      !['db', 'data', 'config'].every(name => job.folders.includes(name)) ||
      job.folders.some(name => !names.includes(name) || typeof job.originals?.[name] !== 'boolean')) {
    throw new Error('恢复清单无效，拒绝操作运行目录');
  }
  const stage = path.join(root, job.stage, 'vertex');
  const previous = path.join(root, job.previous);
  for (const directory of [path.join(root, job.stage), stage, previous, ...job.folders.flatMap(name => [path.join(root, name), path.join(stage, name), path.join(previous, name)])]) {
    if (fs.existsSync(directory) && !fs.lstatSync(directory).isDirectory()) throw new Error('恢复路径不是普通目录');
  }
  const rollback = () => {
    for (const name of [...job.folders].reverse()) {
      const old = path.join(previous, name);
      const live = path.join(root, name);
      const staged = path.join(stage, name);
      if (fs.existsSync(old)) {
        if (fs.existsSync(live)) fs.renameSync(live, staged);
        fs.renameSync(old, live);
      } else if (!job.originals[name] && !fs.existsSync(staged) && fs.existsSync(live)) {
        fs.renameSync(live, staged);
      }
    }
    fs.renameSync(file, path.join(root, job.stage, 'restore-rolled-back.json'));
  };
  if (job.phase === 'applying') {
    rollback();
    return '检测到中断的恢复，已回滚旧数据';
  }
  if (job.phase === 'ready') {
    validate(stage);
    for (const name of job.folders) job.originals[name] = fs.existsSync(path.join(root, name));
    if (fs.existsSync(previous)) throw new Error('恢复暂存目标已存在，拒绝覆盖');
    job.phase = 'applying';
    writeJob(file, job);
    try {
      fs.mkdirSync(previous);
      for (const name of job.folders) {
        if (job.originals[name]) fs.renameSync(path.join(root, name), path.join(previous, name));
        fs.renameSync(path.join(stage, name), path.join(root, name));
      }
      job.phase = 'committed';
      writeJob(file, job);
    } catch (error) {
      rollback();
      throw new Error('恢复切换失败，已回滚旧数据: ' + error.code);
    }
  }
  fs.renameSync(file, path.join(root, '.restore-last.json'));
  return '恢复完成，原数据保留在 ' + job.previous;
};

if (require.main === module) {
  exports.applyRestore(process.argv[2] || '/vertex').then(console.log).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
