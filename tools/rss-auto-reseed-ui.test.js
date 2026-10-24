const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rssTaskPage = fs.readFileSync(
  path.join(__dirname, '../webui/src/pages/task/Rss.vue'),
  'utf8'
);

assert.match(
  rssTaskPage,
  /v-model:checked="rss\.autoReseed"/,
  'RSS task form should expose the auto reseed switch'
);
assert.match(
  rssTaskPage,
  /v-model:checked="rss\.onlyReseed"/,
  'RSS task form should expose the only reseed switch'
);
assert.match(
  rssTaskPage,
  /v-model:value="rss\.reseedClients"/,
  'RSS task form should expose the reseed downloader multi-select'
);
assert.match(
  rssTaskPage,
  /v-if="rss\.autoReseed"/,
  'reseed-only controls should be hidden until auto reseed is enabled'
);
assert.doesNotMatch(
  rssTaskPage,
  /自动辅种会跳过校验添加/,
  'RSS task form should not show the skip-checking warning banner'
);
assert.match(
  rssTaskPage,
  /v-model:value="rss\.tag"/,
  'RSS task form should expose a task tag input'
);
assert.ok(
  rssTaskPage.indexOf('label="分类"') < rssTaskPage.indexOf('v-model:value="rss.tag"'),
  'RSS task tag input should be below the category input'
);

console.log('PASS RSS auto reseed controls are exposed in the task form');

// Execute the actual Vue options rather than only checking field names in source text.
const script = rssTaskPage.match(/<script>([\s\S]*?)<\/script>/)[1];
const page = vm.runInThisContext('(function () {' + script.replace('export default', 'return') + '\n})()');
const form = page.data();
page.methods.clearRss.call(form);
assert.strictEqual(form.rss.allocationMode, 'original');
for (const [allocationMode, expected] of [[undefined, 'original'], ['unknown', 'original'], ['roundRobin', 'roundRobin']]) {
  const row = { id: 'saved', alias: 'saved task', allocationMode, autoReseed: true, onlyReseed: true, reseedClients: ['qb'] };
  page.methods.modifyClick.call(form, row);
  assert.strictEqual(form.rss.allocationMode, expected);
  assert.strictEqual(form.rss.onlyReseed, true);
  assert.deepStrictEqual(form.rss.reseedClients, ['qb']);
  page.methods.cloneClick.call(form, form.rss);
  assert.strictEqual(form.rss.id, null);
  assert.strictEqual(form.rss.allocationMode, expected);
  assert.strictEqual(row.id, 'saved', 'editing or cloning must not mutate the saved list row');
}
console.log('PASS RSS form defaults, editing and cloning retain allocation and reseed settings');
