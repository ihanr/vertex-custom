const util = require('../util');
const moment = require('moment');
const { JSDOM } = require('jsdom');

function parseSize (text, field) {
  const match = text.trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*(B|[KMGTP]i?B)$/i);
  if (!match) throw new Error(`Audiences 无法解析${field}，请检查站点页面结构`);
  const unit = match[2].toUpperCase().replace(/^([KMGTP])I?B$/, '$1iB');
  const size = util.calSize(match[1], unit);
  if (!Number.isFinite(size)) throw new Error(`Audiences ${field}数值无效`);
  return size;
}

function parseCount (text, field) {
  const value = text.trim().replace(/^[↑↓]\s*/, '').replace(/,/g, '');
  const count = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(count)) {
    throw new Error(`Audiences 无法解析${field}，请检查站点页面结构`);
  }
  return count;
}

class Site {
  constructor () {
    this.name = 'Audiences';
    this.downloadLink = 'https://audiences.me/download.php?id={ID}';
    this.url = 'https://audiences.me/';
    this.id = 14;
  };

  async getInfo () {
    const info = {};
    const document = await this._getDocument(this.index, false, 10);
    const readMetric = (selector, legacySelector, field) => {
      const modern = document.querySelector(selector);
      const legacy = document.querySelector(legacySelector);
      const text = modern ? modern.textContent : legacy?.nextSibling?.textContent;
      if (!text || !text.trim()) throw new Error(`Audiences 缺少${field}元素，请检查站点页面结构`);
      return text;
    };
    // 用户名
    const user = document.querySelector('a[href*="userdetails"] b');
    const uid = document.querySelector('a[href*="userdetails"]')?.getAttribute('href')?.match(/[?&]id=(\d+)/);
    if (!user || !user.textContent.trim() || !uid || +uid[1] <= 0) {
      throw new Error('Audiences 缺少用户信息，请检查登录状态或站点页面结构');
    }
    info.username = user.textContent.trim();
    // uid
    info.uid = +uid[1];
    // 上传
    info.upload = parseSize(readMetric('.site-userbar__compact-metric--uploaded', '.color_uploaded', '上传量'), '上传量');
    // 下载
    info.download = parseSize(readMetric('.site-userbar__compact-metric--downloaded', '.color_downloaded', '下载量'), '下载量');
    // 做种
    info.seeding = parseCount(readMetric('.site-userbar__compact-metric-inline-link--seeding', 'img.arrowup', '做种数量'), '做种数量');
    // 下载
    info.leeching = parseCount(readMetric('.site-userbar__compact-metric-inline-link--leeching', 'img.arrowdown', '下载数量'), '下载数量');
    // 做种体积
    const seedingDocument = await this._getDocument(`${this.index}getusertorrentlistajax.php?userid=${info.uid}&type=seeding`, true, 300, false, { referer: `https://audiences.me/userdetails.php?id=${info.uid}` });
    const seedingText = new JSDOM(seedingDocument).window.document.body.textContent;
    const seedingSize = seedingText.match(/\bTotal\s*:\s*([\d,.]+\s*(?:[KMGTP]i?B|B))\b/i);
    if (!seedingSize) throw new Error('Audiences 无法解析做种体积，请检查做种列表接口响应');
    info.seedingSize = parseSize(seedingSize[1], '做种体积');
    return info;
  };

  async searchTorrent (keyword) {
    const torrentList = [];
    const document = await this._getDocument(`${this.index}torrents.php?notnewword=1&incldead=0&spstate=0&inclbookmarked=0&search=${encodeURIComponent(keyword)}&search_area=${keyword.match(/tt\d+/) ? 4 : 0}&search_mode=0&tag=`);
    const torrents = document.querySelectorAll('.torrents tbody tr:not(:first-child)');
    for (const _torrent of torrents) {
      const torrent = {};
      torrent.site = this.site;
      torrent.title = _torrent.querySelector('td[class="embedded"] > a[href*="details"]').title.trim();
      torrent.subtitle = _torrent.querySelector('.torrentname > tbody > tr .embedded').lastChild.innerHTML.trim();
      torrent.category = _torrent.querySelector('td a[href*=cat] img').title.trim();
      torrent.link = this.index + _torrent.querySelector('a[href*=details]').href.trim();
      torrent.id = +torrent.link.match(/id=(\d*)/)[1];
      torrent.seeders = +(_torrent.querySelector('a[href*=seeders] font') || _torrent.querySelector('a[href*=seeders]') || _torrent.querySelector('span[class=red]')).innerHTML.trim().replace(',', '');
      torrent.leechers = +(_torrent.querySelector('a[href*=leechers]') || _torrent.childNodes[9]).innerHTML.trim().replace(',', '');
      torrent.snatches = +(_torrent.querySelector('a[href*=snatches] b') || _torrent.childNodes[11]).innerHTML.trim().replace(',', '');
      torrent.size = _torrent.childNodes[6].innerHTML.trim().replace('<br>', ' ').replace(/([KMGPT])B/, '$1iB');
      torrent.time = moment(_torrent.childNodes[5].querySelector('span') ? _torrent.childNodes[5].querySelector('span').title : _torrent.childNodes[5].innerHTML.replace(/<br>/, ' ')).unix();
      torrent.size = util.calSize(...torrent.size.split(' '));
      torrent.tags = [];
      const tagsDom = _torrent.querySelectorAll('span[class*=tags]');
      for (const tag of tagsDom) {
        torrent.tags.push(tag.innerHTML.trim());
      }
      torrentList.push(torrent);
    }
    return {
      site: this.site,
      torrentList
    };
  };
};
module.exports = Site;
