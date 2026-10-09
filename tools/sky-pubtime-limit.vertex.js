async () => {
  if (global.skyPubTimeLimitRunning) return;
  global.skyPubTimeLimitRunning = true;
  try {
    const clientIds = [
      // advin-2、advin-3、Advin-4
      'ce555222', '5aaf9a9e', '40efefa7',
      // HZ-01 ~ HZ-05
      '944c077d', '33435659', '6bf6a9be', '12398437', '88d9bbfa',
      // KS1B-DE-1 ~ KS1B-DE-3
      '7d1330da', '96184060', '2e0f7126',
      // KS2-CA-1 ~ KS2-CA-3
      '2d4a60dc', 'e04d34e1', '18d347a6',
      // KS2-FR-1 ~ KS2-FR-3
      'b9cbb8f5', '62e9d09f', 'f9e845d2',
      // KS2-UK-1 ~ KS2-UK-3
      '0193512b', 'e9785387', '59c16d6b'
    ];
    const limitSpeedAfter = 480 * 1000 * 1000;
    const publicationAge = 50 * 60;
    const readPubTime = torrent => {
      const tags = String(torrent.tags || '').split(',').map(tag => tag.trim())
        .filter(tag => tag.startsWith('SKYPubTime-'));
      if (tags.length !== 1 || !/^SKYPubTime-[1-9]\d*$/.test(tags[0])) return null;
      const time = Number(tags[0].slice('SKYPubTime-'.length));
      return Number.isSafeInteger(time) && time > 0 && time <= Date.now() / 1000 ? time : null;
    };
    for (const clientId of clientIds) {
      const client = global.runningClient?.[clientId];
      if (!client || !client.status || client._client?.type !== 'qBittorrent' || !client.findTorrent) continue;
      const data = client.maindata?.torrents;
      if (!data) continue;
      const torrents = Array.isArray(data) ? data : Object.values(data);
      for (const torrent of torrents) {
        if (!torrent?.hash || torrent.category !== 'SKY') continue;
        const time = readPubTime(torrent);
        if (time === null || Date.now() / 1000 - time < publicationAge) continue;
        try {
          // Confirm current category and metadata before changing a cached torrent.
          const live = await client.findTorrent(torrent.hash);
          if (!live || live.category !== 'SKY') continue;
          const liveTime = readPubTime(live);
          if (liveTime === null || Date.now() / 1000 - liveTime < publicationAge) continue;
          if (Number(live.up_limit) === limitSpeedAfter) continue;
          await client.setSpeedLimit(torrent.hash, 'upload', limitSpeedAfter);
          const confirmed = await client.findTorrent(torrent.hash);
          if (!confirmed || Number(confirmed.up_limit) !== limitSpeedAfter) throw new Error('qB 未确认上传限速生效');
          logger.info(`SKY 发车已确认：${torrent.name}，发布已满50分钟，上传限速 ${limitSpeedAfter} 字节/秒`);
        } catch (error) {
          logger.error(`SKY 发车失败或未确认：${torrent.name} (${torrent.hash})，${error?.message || error}`);
        }
      }
    }
  } finally {
    global.skyPubTimeLimitRunning = false;
  }
};
