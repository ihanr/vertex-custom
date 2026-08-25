const assert = require('node:assert/strict');
const Module = require('module');
const path = require('node:path');

const util = {
  listRss: () => [{ client: 'other-client' }],
  listDouban: () => [],
  listClient: () => [{ id: 'client-id', enable: false }],
  listWatch: () => []
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && path.normalize(parent.filename).endsWith(path.join('app', 'model', 'ClientMod.js'))) {
    if (request === '../common/Client') return class Client {};
    if (request === '../libs/util') return util;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const ClientMod = require('../app/model/ClientMod');
Module._load = originalLoad;

global.ignoreDependCheck = false;
global.runningClient = {};

const clients = new ClientMod().list();
assert.equal(clients.length, 1);
assert.equal(clients[0].used, false);
console.log('PASS legacy RSS without reseedClients can list downloaders');
