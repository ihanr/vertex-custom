const multipart = require('connect-multiparty');
const fs = require('fs');

const maxFilesSize = Number(process.env.VERTEX_BACKUP_UPLOAD_MAX_BYTES || 512 * 1024 * 1024);
if (!Number.isSafeInteger(maxFilesSize) || maxFilesSize <= 0) throw new Error('备份上传大小限制无效');
const parse = multipart({ maxFilesSize, maxFields: 10, maxFieldsSize: 64 * 1024 });

module.exports = function backupUpload (req, res, next) {
  const cleanup = () => {
    for (const file of Object.values(req.files || {}).flat()) {
      if (file && file.path) {
        try { fs.unlinkSync(file.path); } catch (_) {}
      }
    }
  };
  parse(req, res, error => {
    if (res.destroyed || res.writableEnded) { cleanup(); return; }
    res.once('finish', cleanup);
    res.once('close', cleanup);
    if (error) {
      cleanup();
      return res.status(error.status || 400).send({ success: false, message: '上传失败或超过大小限制' });
    }
    next();
  });
};
