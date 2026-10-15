const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

// Load the real converter without starting util.js's SQLite/Redis/browser services.
const util = {};
const utilSource = fs.readFileSync(path.resolve(__dirname, '../app/libs/util.js'), 'utf8');
vm.runInNewContext(utilSource.match(/exports\.calSize = function \(size, unit\) \{[\s\S]*?\n};/)[0], { exports: util });
const filename = path.resolve(__dirname, '../app/libs/site/Audiences.js');
const mod = { exports: {} };
vm.runInThisContext('(function(require,module,exports){' + fs.readFileSync(filename, 'utf8') + '\n})', { filename })(
  name => name === '../util' ? util : require(name), mod, mod.exports);
const Audiences = mod.exports;

const identity = '<a href="userdetails.php?id=42"><b>test-user</b></a>';
const modern = `${identity}
  <span class="site-userbar__compact-metric site-userbar__compact-metric--uploaded"><i></i><span>2 PB</span></span>
  <span class="site-userbar__compact-metric site-userbar__compact-metric--downloaded"><i></i><span>1.5 TB</span></span>
  <span class="site-userbar__compact-metric site-userbar__compact-metric--active">
    <a class="site-userbar__compact-metric-inline-link site-userbar__compact-metric-inline-link--seeding">↑ 967</a> /
    <a class="site-userbar__compact-metric-inline-link site-userbar__compact-metric-inline-link--leeching">↓ 2</a>
  </span>`;
const legacy = `${identity}
  <font class="color_uploaded">上传：</font>2 PB<span></span>
  <font class="color_downloaded">下载：</font>1.5 TB<span></span>
  <img class="arrowup">967<span></span><img class="arrowdown">2<span></span>`;

async function getInfo (html, seeding = 'Total: 12.50 GB') {
  const site = new Audiences();
  site.index = 'https://audiences.me/';
  site._getDocument = async (url, origin, expire, retCookies, headers) => {
    if (url === site.index) return new JSDOM(html).window.document;
    assert.strictEqual(url, 'https://audiences.me/getusertorrentlistajax.php?userid=42&type=seeding');
    assert.strictEqual(origin, true);
    assert.strictEqual(headers.referer, 'https://audiences.me/userdetails.php?id=42');
    return seeding;
  };
  return site.getInfo();
}

const expected = {
  username: 'test-user',
  uid: 42,
  upload: 2251799813685248,
  download: 1649267441664,
  seeding: 967,
  leeching: 2,
  seedingSize: 13421772800
};

const tests = [
  ['parses observed modern userbar without legacy selectors', async () => {
    assert.deepStrictEqual(await getInfo(modern), expected);
  }],
  ['retains legacy page compatibility including extra CSS classes', async () => {
    assert.deepStrictEqual(await getInfo(legacy), expected);
    assert.deepStrictEqual(await getInfo(legacy.replace(/class="/g, 'class="extra ')), expected);
  }],
  ['accepts comma counts, binary units, whitespace and formatted totals', async () => {
    const html = modern.replace('↑ 967', '↑ 1,234').replace('2 PB', ' 2\u00a0PiB ');
    assert.deepStrictEqual(await getInfo(html, '<b>Total:</b> <span>12.50&nbsp;GiB</span>'), { ...expected, seeding: 1234 });
  }],
  ['preserves actual zero metrics and zero seeding totals', async () => {
    const html = modern.replace('2 PB', '0 B').replace('1.5 TB', '0 B').replace('↑ 967', '↑ 0').replace('↓ 2', '↓ 0');
    assert.deepStrictEqual(await getInfo(html, 'Total: 0 B'), {
      ...expected, upload: 0, download: 0, seeding: 0, leeching: 0, seedingSize: 0
    });
  }],
  ['rejects missing and invalid userbar metrics instead of inventing zero', async () => {
    for (const html of [
      modern.replace('site-userbar__compact-metric--uploaded', 'missing-upload'),
      modern.replace('site-userbar__compact-metric--downloaded', 'missing-download'),
      modern.replace('site-userbar__compact-metric-inline-link--seeding', 'missing-seeding'),
      modern.replace('site-userbar__compact-metric-inline-link--leeching', 'missing-leeching'),
      modern.replace('2 PB', 'unknown'),
      modern.replace('1.5 TB', '-1 TB'),
      modern.replace('↑ 967', '↑ N/A'),
      modern.replace('↓ 2', '↓ -2')
    ]) await assert.rejects(() => getInfo(html), /Audiences/);
  }],
  ['rejects login/challenge responses and unparseable seeding totals', async () => {
    await assert.rejects(() => getInfo('<form>login</form>'), /Audiences/);
    for (const body of ['<h1>Forbidden</h1>', '<table></table>', 'Total: NaN GB', 'Total: -1 GB']) {
      await assert.rejects(() => getInfo(legacy, body), /Audiences/);
    }
  }]
];

(async () => {
  let failures = 0;
  for (const [name, test] of tests) {
    try {
      await test();
      console.log('PASS ' + name);
    } catch (error) {
      failures++;
      console.error('FAIL ' + name);
      console.error(error);
    }
  }
  if (failures) process.exitCode = 1;
})();
