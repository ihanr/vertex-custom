const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

console.log('PASS RSS auto reseed controls are exposed in the task form');
