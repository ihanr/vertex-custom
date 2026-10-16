const NexusSite = require('./CrabPT');

class Site extends NexusSite {
  constructor () {
    super();
    this.name = 'HDtime';
    this.url = 'https://hdtime.org/';
  }
}

module.exports = Site;
