module.exports = function assertClientResult (result) {
  if (!result || ![200, 202, 204].includes(result.statusCode)) {
    throw new Error('下载器接口状态码: ' + (result && result.statusCode));
  }
  let body = result.body;
  if (typeof body === 'string') {
    if (/^fails\.?$/i.test(body.trim())) throw new Error('下载器拒绝操作');
    try { body = JSON.parse(body); } catch (_) {}
  }
  if (body && typeof body === 'object' && (body.error || (typeof body.result === 'string' && body.result !== 'success'))) {
    // Deluge torrent-add returns a hash as result; only RPC errors are failures.
    if (body.error || body.arguments) throw new Error('下载器 RPC 操作失败');
  }
  return result;
};
