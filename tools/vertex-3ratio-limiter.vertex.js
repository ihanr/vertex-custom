async ({ dryRun = false } = {}) => {
  const DRY_RUN = dryRun;
  const TARGET_ALIASES = new Set([
    'HZ-01', 'HZ-02', 'HZ-03', 'HZ-04', 'HZ-05',
    'KS1B-DE-1', 'KS1B-DE-2',
    'KS2-CA-1', 'KS2-CA-2',
    'KS2-FR-1', 'KS2-FR-2',
    'KS2-UK-1', 'KS2-UK-2'
  ]);
  const TARGET_CATEGORIES = new Set(['MTV', 'HH', 'TTG']);
  const SEEDING_STATES = new Set(['uploading', 'stalledUP', 'Seeding']);
  const RATIO_THRESHOLD = 3.3;
  const UPLOAD_LIMIT = 10 * 1024;
  const TAG_DONE = '3ratio';
  const SUCCESS_STATUS_CODES = new Set([200, 204]);
  const log = global.logger || global.LOGGER || console;
  const result = { limited: 0, skipped: 0, failed: 0 };

  const hasTag = (tags, tag) => String(tags || '')
    .split(',')
    .map(item => item.trim())
    .includes(tag);

  for (const client of Object.values(global.runningClient || {})) {
    if (!TARGET_ALIASES.has(client.alias)) continue;
    if (client._client?.type !== 'qBittorrent' || !client.status || !client.maindata?.torrents) {
      result.skipped += 1;
      log.info('[3ratio] 跳过不可用下载器:', client.alias);
      continue;
    }

    for (const torrent of client.maindata.torrents) {
      const ratio = torrent.totalSize > 0 ? torrent.uploaded / torrent.totalSize : 0;
      const eligible = TARGET_CATEGORIES.has(torrent.category) &&
        torrent.progress >= 1 &&
        SEEDING_STATES.has(torrent.state) &&
        ratio >= RATIO_THRESHOLD &&
        !hasTag(torrent.tags, TAG_DONE);

      if (!eligible) {
        result.skipped += 1;
        continue;
      }

      if (DRY_RUN) {
        log.info(`[3ratio][演练] ${client.alias} | ${torrent.category} | R=${ratio.toFixed(3)} | ${torrent.name}`);
        continue;
      }

      try {
        const limitResult = await client.client.setSpeedLimit(
          client.clientUrl, client.cookie, torrent.hash, 'upload', UPLOAD_LIMIT
        );
        if (!SUCCESS_STATUS_CODES.has(limitResult.statusCode)) {
          throw new Error(`限速接口状态码: ${limitResult.statusCode}`);
        }

        const tagResult = await client.client.addTorrentTag(
          client.clientUrl, client.cookie, torrent.hash, TAG_DONE
        );
        if (!SUCCESS_STATUS_CODES.has(tagResult.statusCode)) {
          throw new Error(`标签接口状态码: ${tagResult.statusCode}`);
        }

        result.limited += 1;
        log.info(`[3ratio] 已限速并标记: ${client.alias} | ${torrent.category} | R=${ratio.toFixed(3)} | ${torrent.name}`);
      } catch (error) {
        result.failed += 1;
        log.error(`[3ratio] 处理失败: ${client.alias} | ${torrent.hash} | ${torrent.name}`, error);
      }
    }
  }

  log.info(`[3ratio] 汇总: 限速 ${result.limited}，跳过 ${result.skipped}，失败 ${result.failed}`);
  return result;
}
