const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

const requests = [];
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && path.normalize(parent.filename).endsWith(path.join('app', 'libs', 'client', 'qb.js')) && request === '../util') {
    return { requestPromise: async request => { requests.push(request); return { statusCode: 200, body: '' }; } };
  }
  if (parent && path.normalize(parent.filename).endsWith(path.join('app', 'libs', 'client', 'qb.js')) && request === '../logger') return { debug: () => {} };
  return originalLoad.call(this, request, parent, isMain);
};
const qb = require('../app/libs/client/qb');
Module._load = originalLoad;

(async () => {
  await qb.addTorrent('http://qb.example', 'SID=test', 'https://tracker.example/torrent', false, 0, 0, '', '', false, false, false, 'RSS-影视');
  let addRequests = requests.filter(request => request.url.endsWith('/api/v2/torrents/add'));
  assert.equal(addRequests[0].formData.tags, 'RSS-影视', 'URL RSS add must send the task tag to qB');

  await qb.addTorrentByTorrentFile('http://qb.example', 'SID=test', 'tools/qb-rss-tag.test.js', false, 0, 0, '', '', false, false, false, 'RSS-影视');
  addRequests = requests.filter(request => request.url.endsWith('/api/v2/torrents/add'));
  assert.equal(addRequests[1].formData.tags, 'RSS-影视', 'torrent-file RSS add must send the task tag to qB');

  console.log('PASS qB RSS task tags are sent for URL and torrent-file adds');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
