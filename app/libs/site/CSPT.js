const NexusSite = require('./CrabPT');

class Site extends NexusSite {
  constructor () {
    super();
    this.name = 'CSPT';
    this.url = 'https://cspt.top/';
  }
}

module.exports = Site;
