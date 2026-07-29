const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'grn');
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/octet-stream',
]);

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

function saveGrnAttachment({ fileName, mimeType, dataBase64, category }) {
  if (!dataBase64 || !fileName) {
    return {
      name: fileName || 'attachment',
      fileType: mimeType || 'application/octet-stream',
      category: category || 'PHOTO',
      url: '',
    };
  }

  const mime = mimeType || 'application/octet-stream';
  if (!ALLOWED_MIME.has(mime) && !String(mime).startsWith('image/')) {
    const err = new Error('GRN attachment must be PDF or image');
    err.statusCode = 400;
    throw err;
  }

  const ext =
    path.extname(fileName) ||
    (mime === 'application/pdf' ? '.pdf' : mime.includes('png') ? '.png' : '.jpg');
  const safeBase = crypto.randomBytes(12).toString('hex');
  ensureUploadDir();
  const storedName = `${safeBase}${ext}`;
  const fullPath = path.join(UPLOAD_ROOT, storedName);
  const buffer = Buffer.from(dataBase64, 'base64');
  if (buffer.length < 1 || buffer.length > 12 * 1024 * 1024) {
    const err = new Error('GRN attachment must be between 1 byte and 12 MB');
    err.statusCode = 400;
    throw err;
  }
  fs.writeFileSync(fullPath, buffer);
  return {
    name: fileName,
    fileType: mime,
    category: category || 'PHOTO',
    url: `/api/files/grn/${storedName}`,
  };
}

function persistGrnAttachments(attachments = []) {
  return (attachments || [])
    .filter((a) => a?.name)
    .map((a) =>
      saveGrnAttachment({
        fileName: a.name,
        mimeType: a.fileType,
        dataBase64: a.dataBase64 || a.contentBase64 || '',
        category: a.category || 'PHOTO',
      })
    );
}

module.exports = { saveGrnAttachment, persistGrnAttachments, UPLOAD_ROOT, ALLOWED_MIME };
