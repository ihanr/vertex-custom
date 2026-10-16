const NexusSite = require('./CrabPT');

class Site extends NexusSite {
  constructor () {
    super();
    this.name = 'PTzone';
    this.url = 'https://ptzone.xyz/';
  }
}

module.exports = Site;
