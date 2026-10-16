const NexusSite = require('./CrabPT');

class Site extends NexusSite {
  constructor () {
    super();
    this.name = 'NovaHD';
    this.url = 'https://pt.novahd.top/';
  }
}

module.exports = Site;
