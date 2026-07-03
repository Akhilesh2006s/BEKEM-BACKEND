/**
 * Build allowed CORS origins from env.
 * Accepts comma-separated list. Paths (e.g. /login) and trailing slashes are stripped.
 */
function normalizeOrigin(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.origin;
  } catch {
    return trimmed.replace(/\/+$/, '').replace(/\/(login|index\.html).*$/i, '') || null;
  }
}

function getAllowedOrigins() {
  const defaults = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://bekem-frontend-zeta.vercel.app',
  ];
  const fromEnv = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
  return [...new Set([...defaults, ...fromEnv])];
}

/** cors package origin callback — reflects request origin when allowed. */
function corsOriginCallback(origin, callback) {
  const allowed = getAllowedOrigins();
  // Non-browser clients (no Origin header)
  if (!origin) return callback(null, true);
  const normalized = normalizeOrigin(origin);
  if (normalized && allowed.includes(normalized)) {
    return callback(null, normalized);
  }
  // Also allow any *.vercel.app preview deployments when enabled
  if (
    process.env.CORS_ALLOW_VERCEL_PREVIEWS === 'true' &&
    normalized &&
    /\.vercel\.app$/i.test(normalized)
  ) {
    return callback(null, normalized);
  }
  console.warn(`[CORS] blocked origin: ${origin} (allowed: ${allowed.join(', ')})`);
  return callback(null, false);
}

function socketCorsConfig() {
  return {
    origin: getAllowedOrigins(),
    credentials: true,
  };
}

function expressCorsConfig() {
  return {
    origin: corsOriginCallback,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}

module.exports = {
  normalizeOrigin,
  getAllowedOrigins,
  corsOriginCallback,
  socketCorsConfig,
  expressCorsConfig,
};
