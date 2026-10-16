const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { JSDOM } = require('jsdom');

// Exercise the real converter without opening production SQLite/Redis services.
const util = {};
const utilSource = fs.readFileSync(path.resolve(__dirname, '../app/libs/util.js'), 'utf8');
vm.runInNewContext(utilSource.match(/exports\.calSize = function \(size, unit\) \{[\s\S]*?\n};/)[0], { exports: util });
const siteDir = path.resolve(__dirname, '../app/libs/site');
function load (filename) {
  const mod = { exports: {} };
  const realRequire = createRequire(filename);
  const requireSite = name => {
    if (name === '../util') return util;
    if (name === '../logger') return { error: (...args) => { throw new Error(args.map(String).join(' ')); } };
    const resolved = path.resolve(path.dirname(filename), name);
    if ((path.isAbsolute(name) || name.startsWith('.')) && path.dirname(resolved) === siteDir) {
      return load(path.extname(resolved) ? resolved : resolved + '.js');
    }
    return realRequire(name);
  };
  vm.runInThisContext('(function(require,module,exports,__dirname){' + fs.readFileSync(filename, 'utf8') + '\n})', { filename })(
    requireSite, mod, mod.exports, path.dirname(filename));
  return mod.exports;
}
const registry = load(path.join(siteDir, 'index.js'));
const siteUrls = {
  CrabPT: 'https://crabpt.vip/',
  HDKylin: 'https://www.hdkyl.in/',
  ZMPT: 'https://zmpt.cc/',
  HDtime: 'https://hdtime.org/',
  NovaHD: 'https://pt.novahd.top/',
  CSPT: 'https://cspt.top/',
  PTzone: 'https://ptzone.xyz/'
};

// Same tags/classes/sibling layout observed in Chrome, with synthetic account data.
const legacyHome = `<a href="userdetails.php?id=999"><b>other-user</b></a>
  <font class="color_uploaded">全站上传：</font>999 PB
  <table id="info_block"><tbody><tr><td class="bottom"><span class="medium">
    欢迎回来, <span class="nowrap"><a class="VIP_Name" href="userdetails.php?id=42"><b class="rainbow">test-user</b></a><img class="star"></span>
    <br><font class="color_ratio">分享率:</font>100
    <font class="color_uploaded">上传量:</font> 2 PB
    <font class="color_downloaded">下载量:</font> 1.5 TB
    <font class="color_active">当前活动:</font><img class="arrowup" alt="Torrents seeding" title="当前做种">1,234
    <img class="arrowdown" alt="Torrents leeching" title="当前下载">2
    <font class="color_connectable">可连接:</font>是
  </span></td></tr></tbody></table>`;
const csptHome = `<a href="userdetails.php?id=999"><b>other-user</b></a>
  <font class="color_uploaded">全站上传：</font>999 PB
  <div class="menu-base-info-items"><svg><title>当前做种</title></svg><a>999</a></div>
  <div id="user-info-pannl" class="absolute-info"><div class="panel-content">
    <a href="userdetails.php?id=777"><img alt="avatar"></a>
    <span class="nowrap"><a class="EliteUser_Name" href="userdetails.php?id=42"><b>test-user</b></a></span>
    <div class="user-info"><div class="menu-base-info">
      <div class="menu-base-info-items"><svg><title>上传量</title></svg><a href="userdetails.php?id=42"><font class="color_uploaded" style="display: none;">上传量:</font> 2 PB</a></div>
      <div class="menu-base-info-items"><svg><title>下载量</title></svg><a href="userdetails.php?id=42"><font class="color_downloaded" style="display: none;">下载量:</font> 1.5 TB</a></div>
      <div class="menu-base-info-items"><svg><title id="downing">当前做种</title></svg><a href="userdetails.php?id=42">1,234</a></div>
      <div class="menu-base-info-items"><svg><title id="downing">正在下载</title></svg><a href="userdetails.php?id=42">2
      </a></div>
    </div></div>
  </div></div>`;
const legacySeeding = '<div><b>612</b> 条记录 | 总大小：12.500 TB</div><p>1 - 100 | 101 - 200 | ...</p><table><tr><td>1 GB</td></tr></table>';
const expected = {
  username: 'test-user',
  uid: 42,
  upload: 2251799813685248,
  download: 1649267441664,
  seeding: 1234,
  leeching: 2,
  seedingSize: 13743895347200
};

async function getSiteInfo (siteName, html, body) {
  const calls = [];
  const base = registry.siteUrlMap[siteName];
  const result = await registry.getInfoWrapper[siteName].call({
    site: siteName,
    index: base,
    _getDocument: async (url, origin, expire, retCookies, headers) => {
      calls.push(url);
      if (url === `${base}index.php`) {
        assert.ok(!origin, 'homepage must be parsed as a document');
        return new JSDOM(html).window.document;
      }
      assert.strictEqual(url, `${base}getusertorrentlistajax.php?userid=42&type=seeding`);
      assert.strictEqual(origin, true, 'retain the original AJAX HTML summary');
      assert.strictEqual(headers.referer, `${base}userdetails.php?id=42`);
      if (body instanceof Error) throw body;
      return body;
    }
  });
  assert.strictEqual(calls.length, 2, 'use the aggregate total rather than requesting every torrent page');
  return result;
}

function testsFor (siteName) {
  const home = siteName === 'CSPT' ? csptHome : legacyHome;
  const seeding = siteName === 'PTzone' ? legacySeeding.replace('条记录', '條記錄').replace('总大小', '總大小') : legacySeeding;
  const getInfo = (html = home, body = seeding) => getSiteInfo(siteName, html, body);
  const siteError = error => error.message.includes(siteName) &&
    Object.keys(siteUrls).filter(name => name !== siteName).every(name => !error.message.includes(name));
  return [
    ['registers statistics without advertising unsupported search or push', async () => {
      assert.strictEqual(typeof registry.getInfoWrapper[siteName], 'function');
      assert.strictEqual(registry.searchTorrentWrapper[siteName], undefined);
      assert.strictEqual(registry.torrentDownloadLinkMap[siteName], undefined);
      assert.strictEqual(registry.siteUrlMap[siteName], siteUrls[siteName]);
      assert.strictEqual(typeof registry.getInfoWrapper.Audiences, 'function');
    }],
    ['ships the local icon at the existing site-list asset path', async () => {
      const filename = path.resolve(__dirname, `../webui/public/assets/icons/${siteName}.ico`);
      assert.ok(fs.existsSync(filename), `${siteName} needs its local site-list icon`);
      const icon = fs.readFileSync(filename);
      assert.strictEqual(icon.readUInt16LE(2), 1);
      assert.strictEqual(icon.readUInt16LE(4), 1);
      assert.strictEqual(icon[6], 32);
      assert.strictEqual(icon[7], 32);
      const offset = icon.readUInt32LE(18);
      assert.strictEqual(icon.length, offset + icon.readUInt32LE(14));
      assert.strictEqual(icon.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a');
    }],
    ['parses the observed header and aggregate summary, ignoring unrelated site totals', async () => {
      assert.deepStrictEqual(await getInfo(), expected);
    }],
    ['accepts absolute profile links, extra CSS classes and formatted aggregate totals', async () => {
      const html = home.replace(/class="/g, 'class="extra ').replace('2 PB', '2\u00a0PiB').replace('1.5 TB', '1.5 TiB')
        .replace('href="userdetails.php?id=42"', `href="${siteUrls[siteName]}userdetails.php?id=42"`);
      const body = '<div id="ka1"><br><div style="display: flex;justify-content: space-between"><div> <b>1,234</b> 条记录 | 总大小: <span>12.500&nbsp;TiB</span> </div><div></div></div><p>1 - 100 | 101 - 200</p><table><tr><td>1 GB</td></tr></table></div>';
      assert.deepStrictEqual(await getInfo(html, body), expected);
    }],
    ['records genuine zero metrics without treating an empty response as zero', async () => {
      const html = home.replace('2 PB', '0 B').replace('1.5 TB', '0 B').replace('>1,234', '>0').replace('>2\n', '>0\n');
      assert.deepStrictEqual(await getInfo(html, '<div><b>0</b> 条记录 | 总大小：0 B</div>'), {
        ...expected, upload: 0, download: 0, seeding: 0, leeching: 0, seedingSize: 0
      });
      await assert.rejects(() => getInfo(html, ''), siteError);
    }],
    ['rejects missing/invalid account metrics instead of returning zero or NaN', async () => {
      for (const html of [
        home.replace(siteName === 'CSPT' ? 'id="user-info-pannl"' : 'id="info_block"', 'id="missing"'),
        home.replace('id=42', 'id=0'),
        home.replace('id=42', 'id=42invalid'),
        home.replace('test-user', ' '),
        home.replace('class="color_uploaded"', 'class="missing"').replace('class="color_uploaded"', 'class="missing"'),
        home.replace('color_downloaded', 'missing'),
        home.replace(/arrowup|当前做种/g, 'missing'),
        home.replace(/arrowdown|正在下载/g, 'missing'),
        home.replace('2 PB', '-2 PB'),
        home.replace('1.5 TB', 'NaN TB'),
        home.replace('2 PB', '1,2 PB'),
        home.replace('>1,234', '>1,23'),
        home.replace('>1,234', '>1.5'),
        home.replace('>2\n', '>-2\n'),
        '<h1>Verify you are human</h1><form><input type="password"></form>'
      ]) await assert.rejects(() => getInfo(html), siteError);
    }],
    ['rejects login/challenge/malformed seeding summaries and propagates request errors', async () => {
      for (const body of [
        '', '<h1>Forbidden</h1>', '<form><input type="password"></form>',
        '<div>总大小：12.5 TB</div>',
        '<div>612 条记录 | 总大小：NaN TB</div>',
        '<div>612 条记录 | 总大小：-1 TB</div>',
        '<div>612 条记录 | 总大小：12.5 XB</div>',
        '<div>1,23 条记录 | 总大小：12.5 TB</div>'
      ]) await assert.rejects(() => getInfo(home, body), siteError);
      await assert.rejects(() => getInfo(home, new Error('request timed out')), /request timed out/);
    }],
    ...(siteName === 'CSPT'
      ? [
        ['does not use metric links or an avatar as the username when the identity link is missing', async () => {
          await assert.rejects(() => getInfo(home.replace('class="nowrap"', 'class="missing"')), siteError);
        }],
        ['never substitutes the other activity count or an unrelated page total for missing counts', async () => {
          await assert.rejects(() => getInfo(home.replace(/<div class="menu-base-info-items"><svg><title id="downing">当前做种<\/title>[\s\S]*?<\/div>/, '')), siteError);
          await assert.rejects(() => getInfo(home.replace('>1,234</a>', '></a>')), siteError);
        }]
      ]
      : []),
    ...(siteName === 'PTzone'
      ? [
        ['reads traditional totals with no space after the count and preserves zero', async () => {
          assert.deepStrictEqual(await getInfo(home, '<div><b>612</b>條記錄 | 總大小：12.500 TB</div>'), expected);
          assert.strictEqual((await getInfo(home, '<div><b>0</b>條記錄 | 總大小：0 B</div>')).seedingSize, 0);
        }],
        ['rejects malformed traditional totals instead of inventing a seeding size', async () => {
          for (const body of ['<div>1,23條記錄 | 總大小：12.5 TB</div>', '<div>612條記錄 | 總大小：-1 TB</div>', '<div>612條記錄 | 總大小：NaN TB</div>']) {
            await assert.rejects(() => getInfo(home, body), siteError);
          }
        }]
      ]
      : [])
  ];
}

(async () => {
  let failures = 0;
  for (const siteName of Object.keys(siteUrls)) {
    for (const [name, test] of testsFor(siteName)) {
      try {
        await test();
        console.log(`PASS ${siteName}: ${name}`);
      } catch (error) {
        failures++;
        console.error(`FAIL ${siteName}: ${name}`);
        console.error(error);
      }
    }
  }
  if (failures) process.exitCode = 1;
})();
