const util = require('../util');
const { JSDOM } = require('jsdom');

function parseSize (text, field, siteName) {
  const match = text.trim().match(/^((?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?)\s*(B|[KMGTP]i?B)$/i);
  if (!match) throw new Error(`${siteName} 无法解析${field}，请检查站点页面结构`);
  const unit = match[2].toUpperCase().replace(/^([KMGTP])I?B$/, '$1iB');
  const size = util.calSize(match[1].replace(/,/g, ''), unit);
  if (!Number.isFinite(size)) throw new Error(`${siteName} ${field}数值无效`);
  return size;
}

function parseCount (text, field, siteName) {
  const value = text.trim();
  const count = Number(value.replace(/,/g, ''));
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value) || !Number.isSafeInteger(count)) {
    throw new Error(`${siteName} 无法解析${field}，请检查站点页面结构`);
  }
  return count;
}

class Site {
  constructor () {
    this.name = 'CrabPT';
    this.url = 'https://crabpt.vip/';
  }

  async getInfo () {
    const siteName = this.site || this.name || 'CrabPT';
    const document = await this._getDocument(`${this.index}index.php`, false, 10);
    const bar = document.querySelector('#info_block') || (siteName === 'CSPT' ? document.querySelector('#user-info-pannl') : null);
    const modernPanel = bar?.id === 'user-info-pannl';
    const user = bar?.querySelector(modernPanel ? '.nowrap a[href*="userdetails.php"]' : 'a[href*="userdetails.php"]');
    const uidMatch = user?.getAttribute('href')?.match(/[?&]id=(\d+)(?:&|$)/);
    const uid = Number(uidMatch?.[1]);
    const username = user?.textContent.trim();
    if (!username || !Number.isSafeInteger(uid) || uid <= 0) {
      throw new Error(`${siteName} 缺少用户信息，请检查登录状态或站点页面结构`);
    }

    const readMetric = (selector, field) => {
      let text;
      if (modernPanel && ['img.arrowup', 'img.arrowdown'].includes(selector)) {
        const title = selector === 'img.arrowup' ? '当前做种' : '正在下载';
        const item = [...bar.querySelectorAll('.menu-base-info-items')]
          .find(el => el.querySelector('svg title')?.textContent.trim() === title);
        text = item?.querySelector('a[href*="userdetails.php"]')?.textContent;
      } else {
        text = bar.querySelector(selector)?.nextSibling?.textContent;
      }
      if (!text || !text.trim()) throw new Error(`${siteName} 缺少${field}元素，请检查站点页面结构`);
      return text;
    };
    const info = {
      username,
      uid,
      upload: parseSize(readMetric('.color_uploaded', '上传量'), '上传量', siteName),
      download: parseSize(readMetric('.color_downloaded', '下载量'), '下载量', siteName),
      seeding: parseCount(readMetric('img.arrowup', '做种数量'), '做种数量', siteName),
      leeching: parseCount(readMetric('img.arrowdown', '下载数量'), '下载数量', siteName)
    };

    const body = await this._getDocument(`${this.index}getusertorrentlistajax.php?userid=${uid}&type=seeding`, true, 300, false, {
      referer: `${this.index}userdetails.php?id=${uid}`
    });
    const seedingDocument = new JSDOM(body).window.document;
    // This summary covers all pages; summing the displayed torrent rows would undercount.
    const summary = [...seedingDocument.querySelectorAll('div')]
      .map(el => el.textContent.match(/^\s*([\d,]+)\s*(?:条记录|條記錄)\s*\|\s*(?:总|總)大小\s*[:：]\s*([\d,.]+\s*(?:[KMGTP]i?B|B))\s*$/i))
      .find(Boolean);
    if (!summary) throw new Error(`${siteName} 无法解析做种体积，请检查做种列表接口响应`);
    parseCount(summary[1], '做种汇总记录数', siteName);
    info.seedingSize = parseSize(summary[2], '做种体积', siteName);
    return info;
  }
}

module.exports = Site;
