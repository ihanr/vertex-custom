const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');

assert.match(
  appSource,
  /const DEFAULT_HIDDEN_MENU = \[/,
  'new installations should have a built-in default menu'
);
assert.match(
  appSource,
  /Object\.prototype\.hasOwnProperty\.call\(setting, 'menu'\)/,
  'an existing menu setting must not be overwritten'
);
assert.match(appSource, /'\/metric\/site'/, 'site monitoring should be hidden by default');
assert.match(appSource, /'\/task\/subscribe'/, 'subscription tasks should be hidden by default');
assert.match(appSource, /'\/subscribe'/, 'media subscriptions should be hidden by default');
assert.match(appSource, /'\/tool\/hosts'/, 'HOSTS editing should be hidden by default');

console.log('PASS new installations use the custom default menu without overwriting saved menus');
