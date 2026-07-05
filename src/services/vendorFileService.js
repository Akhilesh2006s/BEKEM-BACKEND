const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'msme');
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

function saveMsmeCertificate({ fileName, mimeType, dataBase64 }) {
  if (!dataBase64 || !fileName) {
    const err = new Error('MSME certificate file is required');
    err.statusCode = 400;
    throw err;
  }
  const mime = mimeType || 'application/octet-stream';
  if (!ALLOWED_MIME.has(mime)) {
    const err = new Error('MSME certificate must be PDF or image (JPEG/PNG/WebP)');
    err.statusCode = 400;
    throw err;
  }

  const ext = path.extname(fileName) || (mime === 'application/pdf' ? '.pdf' : '.jpg');
  const safeBase = crypto.randomBytes(12).toString('hex');
  ensureUploadDir();
  const storedName = `${safeBase}${ext}`;
  const fullPath = path.join(UPLOAD_ROOT, storedName);
  const buffer = Buffer.from(dataBase64, 'base64');
  if (buffer.length < 1 || buffer.length > 8 * 1024 * 1024) {
    const err = new Error('MSME certificate file size must be between 1 byte and 8 MB');
    err.statusCode = 400;
    throw err;
  }
  fs.writeFileSync(fullPath, buffer);
  return `/api/files/msme/${storedName}`;
}

module.exports = { saveMsmeCertificate, UPLOAD_ROOT, ALLOWED_MIME };
