const reservedTags = new Set(['reseed', 'brseed']);

exports.normalize = tag => String(tag || '')
  .split(',')
  .map(item => item.trim())
  .filter(item => item && !reservedTags.has(item.toLowerCase()))
  .join(',');
