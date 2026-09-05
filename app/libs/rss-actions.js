const util = require('./util');
let ready;
const ensure = () => {
  if (!ready) {
    ready = util.runRecord('CREATE TABLE IF NOT EXISTS rss_actions (rss_id TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (rss_id, hash))')
      .catch(error => { ready = null; throw error; });
  }
  return ready;
};
exports.get = async (id, hash) => {
  await ensure();
  const row = await util.getRecord('SELECT data FROM rss_actions WHERE rss_id = ? AND hash = ?', [id, hash]);
  return row ? JSON.parse(row.data) : undefined;
};
exports.save = async (id, hash, action) => {
  await ensure();
  await util.runRecord('INSERT OR REPLACE INTO rss_actions (rss_id, hash, data) VALUES (?, ?, ?)', [id, hash, JSON.stringify(action)]);
};
exports.remove = async (id, hash) => {
  await ensure();
  await util.runRecord('DELETE FROM rss_actions WHERE rss_id = ? AND hash = ?', [id, hash]);
};
exports.list = async id => {
  await ensure();
  const rows = await util.getRecords('SELECT hash, data FROM rss_actions WHERE rss_id = ?', [id]);
  return rows.map(row => ({ hash: row.hash, action: JSON.parse(row.data) }));
};
