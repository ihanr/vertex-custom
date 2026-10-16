const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const page = fs.readFileSync(path.join(__dirname, '../webui/src/pages/metric/Site.vue'), 'utf8');
const document = new JSDOM(page).window.document;
const table = document.querySelector('template').content.querySelector('a-table');
const component = vm.runInNewContext(document.querySelector('script').textContent.replace('export default', 'module.exports ='), {
  module: { exports: {} }
});
const scroll = vm.runInNewContext(`(${table.getAttribute(':scroll')})`, component.data());

assert.strictEqual(scroll.y, undefined, 'site rows must expand naturally without a table-internal vertical scroll limit');
assert.ok(scroll.x > 0, 'narrow screens must retain horizontal scrolling to reach all columns');
assert.strictEqual(vm.runInNewContext(table.getAttribute(':pagination')), false, 'all sites must remain on the page without pagination');

console.log('PASS site metrics expand vertically while retaining horizontal access to every column');
