const NexusSite = require('./CrabPT');

class Site extends NexusSite {
  constructor () {
    super();
    this.name = 'ZMPT';
    this.url = 'https://zmpt.cc/';
  }
}

module.exports = Site;
