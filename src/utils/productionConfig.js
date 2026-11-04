function validateProductionConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const access = env.JWT_ACCESS_SECRET || '';
  const refresh = env.JWT_REFRESH_SECRET || '';
  if (access.length < 32 || refresh.length < 32 || access === refresh) {
    throw new Error('Production requires distinct JWT access and refresh secrets of at least 32 characters');
  }
  const origins = String(env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origins.length || origins.some((origin) => {
    try {
      const url = new URL(origin);
      return url.protocol !== 'https:' || url.origin !== origin.replace(/\/$/, '') || ['localhost', '127.0.0.1'].includes(url.hostname);
    } catch { return true; }
  })) throw new Error('Production CORS_ORIGIN must list explicit HTTPS frontend origins');
  if (!env.DOCUMENT_STORAGE_PATH || !require('path').isAbsolute(env.DOCUMENT_STORAGE_PATH)) {
    throw new Error('Production DOCUMENT_STORAGE_PATH must be an absolute path on durable storage');
  }
}

module.exports = { validateProductionConfig };
